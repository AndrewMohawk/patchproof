import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { FunctionCaseSchema } from '../packages/contracts/src/product.ts';
import { DockerCheckRunner, LOCAL_IMAGE_ID } from '../workers/sandbox/index.ts';
import { cleanupOwnedContainer } from '../workers/sandbox/local-cleanup.ts';
import { GUEST_DEADLINE_LAUNCHER } from '../workers/sandbox/driver.ts';
import { runDocker } from '../workers/sandbox/process.ts';
import type { ProcessRunner, ProcessResult } from '../workers/sandbox/process.ts';

const missing: ProcessResult = { code: 1, error: null, stdout: '', stderr: 'No such container' };
const success = (stdout = ''): ProcessResult => ({ code: 0, error: null, stdout, stderr: '' });
const image = () => success(JSON.stringify({ Id: LOCAL_IMAGE_ID, Os: 'linux', Architecture: process.arch === 'arm64' ? 'arm64' : 'amd64' }));
const identity = () => ({ name: `patchproof-check-${randomUUID()}`, image: LOCAL_IMAGE_ID, ownerRunId: randomUUID() });
const inspected = (value: ReturnType<typeof identity>, id: string) => success(JSON.stringify({ Id: id, Name: '/' + value.name, Image: value.image,
  Config: { Labels: { 'org.patchproof.owned': 'true', 'org.patchproof.operation': value.name, 'org.patchproof.run-id': value.ownerRunId } } }));
const input = () => ({ files: { 'solution.py': 'def example(value):\n    return value\n' }, entrypoint: 'solution.py', timeoutSeconds: 10,
  cases: [FunctionCaseSchema.parse({ id: 'case', requirementId: 'R01', function: 'example', args: [1], expected: 1 })] });

test('unacknowledged absent creation remains uncertain after its bounded cleanup deadline', async () => {
  let inspections = 0;
  const result = await cleanupOwnedContainer(async (args, options) => {
    assert.equal(args[0], 'container'); assert.equal(options?.signal, undefined); inspections++; return missing;
  }, identity(), false, { timeoutMs: 40, pollMs: 5 });
  assert.ok(inspections >= 2); assert.deepEqual(result, { confirmed: false, id: null, reason: 'create_unacknowledged' });
});

test('cleanup catches delayed appearance after missing inspections and removes only the observed immutable ID', async () => {
  const expected = identity(), id = 'd'.repeat(64); let inspections = 0, removed = false;
  const result = await cleanupOwnedContainer(async args => {
    if (args[0] === 'rm') { assert.deepEqual(args, ['rm', '-f', id]); removed = true; return success(); }
    assert.equal(args[0], 'container');
    return removed || ++inspections <= 2 ? missing : inspected(expected, id);
  }, expected, false, { timeoutMs: 200, pollMs: 5 });
  assert.equal(removed, true); assert.deepEqual(result, { confirmed: true, id, reason: null });
});

test('failed removal remains uncertain and preserves the observed identity under the cleanup bound', async () => {
  const expected = identity(), id = 'e'.repeat(64);
  const result = await cleanupOwnedContainer(async args => args[0] === 'rm' ?
    { code: null, error: 'timeout', stdout: '', stderr: '' } : inspected(expected, id), expected, false, { timeoutMs: 40, pollMs: 5 });
  assert.deepEqual(result, { confirmed: false, id, reason: 'removal_failed' });
});

test('journal-triggered cancellation and exhausted image inspection allowance never create a container', async () => {
  const controller = new AbortController(), calls: string[][] = [], handles: string[] = [];
  const runner = new DockerCheckRunner({ process: async args => { calls.push(args); return image(); } });
  const cancelled = await runner.run({ ...input(), onOperation: id => { handles.push(id); controller.abort(); } }, controller.signal);
  assert.equal(cancelled.infrastructureError, 'cancelled'); assert.deepEqual(cancelled.operationIds, handles); assert.equal(handles.length, 1);
  assert.ok(calls.every(args => args[0] === 'image'));
  const slow = new DockerCheckRunner({ process: async args => { calls.push(args); await new Promise(resolve => setTimeout(resolve, 30)); return image(); } });
  const timedOut = await slow.run({ ...input(), timeoutSeconds: 0.01 }, new AbortController().signal);
  assert.equal(timedOut.infrastructureError, 'timeout'); assert.deepEqual(timedOut.operationIds, []);
  assert.ok(calls.every(args => args[0] === 'image'));
});

test('unobservable interrupted create is never retried or started and blocks the next case', async () => {
  let creates = 0, starts = 0;
  const fake: ProcessRunner = async args => {
    if (args[0] === 'image') return image();
    if (args[0] === 'create') { creates++; return { code: null, error: 'timeout', stdout: '', stderr: '' }; }
    if (args[0] === 'start') starts++;
    assert.equal(args[0], 'container'); return missing;
  };
  const request = input(), result = await new DockerCheckRunner({ process: fake }).run({ ...request,
    cases: [...request.cases, { ...request.cases[0]!, id: 'second-case' }] }, new AbortController().signal);
  assert.equal(result.infrastructureError, 'container_cleanup_unconfirmed'); assert.equal(result.operationIds.length, 1);
  assert.deepEqual(result.checks.map(row => row.status), ['error', 'error']); assert.equal(creates, 1); assert.equal(starts, 0);
  const log = JSON.parse(result.checks[0]!.log).dockerLifecycle;
  assert.equal(log.createAcknowledged, false); assert.equal(log.cleanupConfirmed, false); assert.equal(log.cleanupReason, 'create_unacknowledged');
});

test('real delayed create after initial missing cleanup remains inert and is removed without starting', async () => {
  const controller = new AbortController(), ownerRunId = randomUUID(); let name = '', starts = 0, firstMissing = false;
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  let delayedCreate: Promise<ProcessResult> | undefined;
  const runner = new DockerCheckRunner({ process: async (args, options) => {
    if (args[0] === 'create') {
      name = args[args.indexOf('--name') + 1]!;
      // Model an already accepted daemon create completing after its client has died.
      delayedCreate = barrier.then(() => runDocker(args, { timeoutMs: 10_000 }));
      controller.abort(); return { code: null, error: 'cancelled', stdout: '', stderr: '' };
    }
    if (args[0] === 'start') starts++;
    const result = await runDocker(args, options);
    if (args[0] === 'container' && !firstMissing && result.code !== 0 && /No such (container|object)/i.test(result.stderr)) {
      firstMissing = true; release();
    }
    return result;
  } });
  try {
    const result = await runner.run({ ...input(), ownerRunId }, controller.signal);
    const created = await delayedCreate!;
    assert.equal(created.code, 0, created.error ?? created.stderr); assert.equal(firstMissing, true); assert.equal(starts, 0);
    assert.equal(result.infrastructureError, 'cancelled'); assert.equal(result.operationIds.length, 1);
    const evidence = JSON.parse(result.checks[0]!.log).dockerLifecycle;
    assert.equal(evidence.createAcknowledged, false); assert.equal(evidence.cleanupConfirmed, true);
    assert.equal(evidence.containerId, created.stdout.trim());
    const after = await runDocker(['container', 'inspect', created.stdout.trim()]);
    assert.notEqual(after.code, 0); assert.match(after.stderr, /No such (container|object)/i);
  } finally {
    release(); const created = await delayedCreate;
    if (created?.code === 0) await runDocker(['rm', '-f', created.stdout.trim()]);
  }
});

test('real container with an already expired absolute guest deadline never invokes candidate source', async () => {
  let name = '';
  const runner = new DockerCheckRunner({ process: async (args, options) => {
    if (args[0] !== 'create') return runDocker(args, options);
    name = args[args.indexOf('--name') + 1]!;
    const changed = [...args]; changed[changed.indexOf(GUEST_DEADLINE_LAUNCHER) + 1] = String(Date.now() - 1000);
    return runDocker(changed, options);
  } });
  const result = await runner.run({ ...input(), files: { 'solution.py': 'print("MUST-NOT-EXECUTE")\ndef example(value):\n    return value\n' } }, new AbortController().signal);
  assert.equal(result.checks[0]!.status, 'error'); assert.equal(result.checks[0]!.message, 'candidate_process_error');
  assert.equal(result.infrastructureError, null); // Expected candidate timer exit; cleanup is verified.
  const after = await runDocker(['container', 'inspect', name]); assert.notEqual(after.code, 0); assert.match(after.stderr, /No such (container|object)/i);
});
