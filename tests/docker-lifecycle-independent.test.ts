import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DockerCheckRunner, LOCAL_IMAGE_ID } from '../workers/sandbox/index.ts';
import type { FunctionCase } from '../packages/contracts/src/product.ts';
import type { ProcessResult, ProcessRunner } from '../workers/sandbox/process.ts';

// All process replies are invented. No Docker daemon, candidate, model or provider is invoked.
const ID = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const ok = (stdout = ''): ProcessResult => ({ code: 0, error: null, stdout, stderr: '' });
const absent = (): ProcessResult => ({ code: 1, error: null, stdout: '', stderr: 'Error: No such container' });
const cases: FunctionCase[] = [1, 2].map(n => ({ id: `invented-${n}`, requirementId: 'R01', function: 'identity', args: [7], kwargs: {}, expected: 7, assertArgsUnchanged: false }));
type Inspection = { Id: string; Name: string; Image: string; Config: { Labels: Record<string, string> } };
function harness() {
  const controller = new AbortController(), ownerRunId = randomUUID();
  const calls: { args: string[]; signal: AbortSignal | undefined; timeoutMs: number | undefined }[] = [];
  const state = { name: '', exists: false, createCount: 0, startCount: 0, inspectCount: 0, removals: [] as string[], labels: {} as Record<string, string> };
  const hooks: { inspect?: (value: Inspection, index: number) => void; remove?: (id: string) => void } = {};
  const process: ProcessRunner = async (args, options) => {
    calls.push({ args: [...args], signal: options?.signal, timeoutMs: options?.timeoutMs });
    if (args[0] === 'image') return ok(JSON.stringify({ Id: LOCAL_IMAGE_ID, Os: 'linux', Architecture: globalThis.process.arch === 'arm64' ? 'arm64' : 'amd64' }));
    if (args[0] === 'create') {
      state.createCount++; state.exists = true; state.name = args[args.indexOf('--name') + 1]!;
      state.labels = Object.fromEntries(args.flatMap((arg, i) => arg === '--label' ? [args[i + 1]!.split('=', 2)] : []));
      return ok(ID + '\n');
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      state.inspectCount++;
      if (!state.exists) return absent();
      const value: Inspection = { Id: ID, Name: '/' + state.name, Image: LOCAL_IMAGE_ID, Config: { Labels: { ...state.labels } } };
      hooks.inspect?.(value, state.inspectCount);
      return ok(JSON.stringify(value));
    }
    if (args[0] === 'start') {
      state.startCount++; assert.deepEqual(args, ['start', '--attach', '--interactive', ID]);
      const invocation = JSON.parse(options!.stdin!);
      return ok(JSON.stringify({ kind: 'return', value: 7, argsAfter: invocation.args, kwargsAfter: invocation.kwargs }));
    }
    if (args[0] === 'rm') {
      state.removals.push(args[2]!); hooks.remove?.(args[2]!); state.exists = false; return ok();
    }
    throw new Error('Unexpected invented process call: ' + args[0]);
  };
  const run = (count = 2, timeoutSeconds = 10) => new DockerCheckRunner({ process }).run({
    files: { 'solution.py': '# Inert test input; no interpreter is launched.\n' }, entrypoint: 'solution.py',
    cases: cases.slice(0, count), ownerRunId, timeoutSeconds,
  }, controller.signal);
  return { controller, ownerRunId, calls, state, hooks, run };
}

test('cancellation returned with ownership inspection cannot start the acknowledged container', async () => {
  const h = harness(); h.hooks.inspect = (_value, index) => { if (index === 1) h.controller.abort(); };
  const result = await h.run();
  assert.equal(h.state.createCount, 1); assert.equal(h.state.startCount, 0);
  assert.deepEqual(h.state.removals, [ID]); assert.equal(result.infrastructureError, 'cancelled');
  assert.deepEqual(result.checks.map(row => row.status), ['error', 'error']);
  const inspections = h.calls.filter(call => call.args[0] === 'container');
  assert.equal(inspections[0]!.signal, h.controller.signal);
  assert.ok(inspections.slice(1).every(call => call.signal === undefined));
  assert.ok(h.calls.filter(call => call.args[0] === 'rm').every(call => call.signal === undefined));
  assert.equal(JSON.parse(result.checks[0]!.log).dockerLifecycle.cleanupConfirmed, true);
});

test('monotonic deadline consumed by ownership inspection forbids start but permits bounded independent cleanup', async t => {
  let now = 1000; t.mock.method(performance, 'now', () => now);
  const h = harness(); h.hooks.inspect = (_value, index) => { if (index === 1) now += 1001; };
  const result = await h.run(2, 1);
  assert.equal(h.state.createCount, 1); assert.equal(h.state.startCount, 0);
  assert.deepEqual(h.state.removals, [ID]); assert.equal(result.infrastructureError, 'timeout');
  assert.deepEqual(result.checks.map(row => row.status), ['error', 'error']);
  assert.ok(h.calls.filter(call => call.args[0] === 'rm').every(call => call.timeoutMs! > 0 && call.timeoutMs! <= 1000));
  assert.equal(JSON.parse(result.checks[0]!.log).dockerLifecycle.cleanupConfirmed, true);
});

test('cleanup identity substitution never removes a foreign object or starts a second case', async t => {
  const mutations: Record<string, (value: Inspection) => void> = {
    immutableId: value => { value.Id = OTHER; },
    name: value => { value.Name = '/unrelated-object'; },
    image: value => { value.Image = 'sha256:' + OTHER; },
    ownedLabel: value => { value.Config.Labels['org.patchproof.owned'] = 'false'; },
    operationLabel: value => { value.Config.Labels['org.patchproof.operation'] = 'unrelated-operation'; },
    ownerLabel: value => { value.Config.Labels['org.patchproof.run-id'] = randomUUID(); },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const h = harness(); h.hooks.inspect = (value, index) => { if (index >= 2) mutate(value); };
    const result = await h.run();
    assert.equal(h.state.createCount, 1); assert.equal(h.state.startCount, 1);
    assert.deepEqual(h.state.removals, []); assert.equal(result.infrastructureError, 'container_cleanup_unconfirmed');
    assert.equal(result.checks.length, 2); assert.equal(result.checks[1]!.status, 'error');
    assert.equal(result.checks[1]!.message, 'container_cleanup_unconfirmed');
    const lifecycle = JSON.parse(result.checks[0]!.log).dockerLifecycle;
    assert.equal(lifecycle.cleanupConfirmed, false); assert.equal(lifecycle.cleanupReason, 'ownership_mismatch');
  });
});

test('name reuse between cleanup inspection and removal never changes the immutable removal target', async () => {
  const h = harness(); let replacementRetained = false;
  h.hooks.remove = id => {
    // Another object acquires the old name after inspection. Only the verified ID may be removed.
    replacementRetained = true; assert.equal(id, ID); assert.notEqual(id, h.state.name);
  };
  const result = await h.run(1);
  assert.equal(result.infrastructureError, null); assert.equal(replacementRetained, true);
  assert.deepEqual(h.state.removals, [ID]);
  assert.ok(h.calls.filter(call => call.args[0] === 'container').every(call => call.args[2] === ID));
  assert.equal(JSON.parse(result.checks[0]!.log).dockerLifecycle.cleanupConfirmed, true);
});
