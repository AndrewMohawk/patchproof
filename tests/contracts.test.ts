import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogue } from '../packages/contracts/src/catalogue.ts';
import { canonicalJson, digestJson } from '../packages/contracts/src/digest.ts';
import { parseRunRequest, RunSpecSchema, RunViewSchema, EvidenceManifestSchema } from '../packages/contracts/src/index.ts';
import type { RunView } from '../packages/contracts/src/index.ts';
import { MockCoordinator } from '../packages/mock/src/coordinator.ts';
import { buildBundle, verifyBundle } from '../packages/mock/src/bundle.ts';

const request = { taskId: 'contract-smoke', mode: 'mock', variant: 'baseline', idempotencyKey: 'contract-test-01' };
const runtimeLock = { mode: 'mock', model: null };

async function completed(): Promise<RunView> {
  const coordinator = new MockCoordinator(runtimeLock);
  const { run } = coordinator.create(request);
  await coordinator.settled();
  return coordinator.get(run.id);
}

test('curated contract accepts known tasks; rejects unknown tasks and extra execution inputs', () => {
  const ids = catalogue().map(task => task.id);
  assert.equal(parseRunRequest(request, ids).taskId, 'contract-smoke');
  for (const input of [
    { ...request, taskId: 'unknown' }, { ...request, repositoryUrl: 'https://example.com/source' },
    { ...request, command: 'arbitrary-command' }, { ...request, maxApprovedSpendUsd: 5 },
    { ...request, idempotencyKey: '' }, { ...request, mode: 'automatic' },
  ]) assert.throws(() => parseRunRequest(input, ids));
});

test('budgets reject nonfinite, negative, fractional and excessive caps', async () => {
  const run = await completed();
  for (const [key, value] of [
    ['maxApprovedSpendUsd', -1], ['maxApprovedSpendUsd', Infinity],
    ['inputTokenLimit', NaN], ['inputTokenLimit', 0], ['outputTokenLimit', 1.5],
    ['inferenceCallLimit', 25], ['wallTimeLimitSeconds', 901], ['sandboxCpuSecondsLimit', -1],
  ]) assert.equal(RunSpecSchema.safeParse({ ...run.spec, [key as string]: value }).success, false);
});

test('canonical digest is key-order independent and rejects non-JSON values', () => {
  assert.equal(digestJson({ a: 1, b: 2 }), digestJson({ b: 2, a: 1 }));
  assert.notEqual(digestJson([1, 2]), digestJson([2, 1]));
  for (const value of [undefined, Infinity, NaN, new Date(), Array(1), [undefined]]) {
    assert.throws(() => canonicalJson(value));
  }
});

test('catalogue and returned views are isolated from callers', async () => {
  catalogue()[0]!.requirements[0]!.text = 'changed';
  assert.notEqual(catalogue()[0]!.requirements[0]!.text, 'changed');
  const coordinator = new MockCoordinator(runtimeLock);
  const { run } = coordinator.create(request);
  run.task.title = 'changed';
  await coordinator.settled();
  assert.notEqual(coordinator.get(run.id).task.title, 'changed');
});

test('idempotency retains one run and rejects reuse with different variants', async () => {
  const coordinator = new MockCoordinator(runtimeLock);
  const first = coordinator.create(request);
  const again = coordinator.create(request);
  assert.equal(again.reused, true);
  assert.equal(again.run.id, first.run.id);
  assert.throws(() => coordinator.create({ ...request, variant: 'patchproof' }), /Idempotency/);
  assert.throws(() => coordinator.create({ ...request, mode: 'live' }), /G0\/G1/);
  await coordinator.settled();
});

test('all mock variants have identical aggregate caps and zero actual use', async () => {
  const coordinator = new MockCoordinator(runtimeLock);
  const runs = ['baseline', 'checks_only', 'patchproof'].map(variant => coordinator.create({
    ...request, variant, idempotencyKey: `variant-${variant}`,
  }).run);
  await coordinator.settled();
  const limits = runs.map(run => { const { variant, ...limits } = coordinator.get(run.id).spec; return limits; });
  assert.deepEqual(limits[0], limits[1]);
  assert.deepEqual(limits[0], limits[2]);
  for (const run of runs) assert.equal(coordinator.get(run.id).usage.inferenceCalls, 0);
});

test('cancellation records partial mock work and never creates provider operations', async () => {
  const coordinator = new MockCoordinator(runtimeLock);
  const { run } = coordinator.create(request);
  coordinator.cancel(run.id);
  await coordinator.settled();
  const done = coordinator.get(run.id);
  assert.equal(done.cancelled, true);
  assert.equal(done.evidence!.terminationReason, 'cancelled');
  assert.deepEqual(done.evidence!.sandboxOperationIds, []);
  assert.equal(done.events.filter(e => e.kind === 'cancel_requested').length, 1);
  assert.deepEqual(coordinator.cancel(run.id), done);
});

test('subscriber failures cannot interrupt finalization; handler errors stay unverified', async () => {
  const coordinator = new MockCoordinator(runtimeLock);
  const { run } = coordinator.create(request);
  coordinator.subscribe(run.id, () => { throw new Error('subscriber failed'); });
  await coordinator.settled();
  assert.equal(coordinator.get(run.id).phase, 'terminal');
  const faulty = new MockCoordinator(runtimeLock, { step: async () => { throw new Error('step failed'); } });
  const failure = faulty.create(request);
  await faulty.settled();
  assert.equal(faulty.get(failure.run.id).evidence!.terminationReason, 'mock_error');
  assert.equal(faulty.get(failure.run.id).terminalStatus, 'needs_review');
});

test('completed mock evidence cannot claim inference, execution or approval', async () => {
  const run = await completed();
  assert.equal(run.phase, 'terminal');
  assert.equal(run.terminalStatus, 'needs_review');
  assert.equal(run.competitionReady, false);
  for (const edit of [
    { mode: 'live' }, { competitionReady: true }, { executionPerformed: true },
    { terminalStatus: 'verified_for_declared_checks' }, { modelId: 'invented-model' },
    { sandboxOperationIds: ['invented-operation'] },
  ]) assert.equal(EvidenceManifestSchema.safeParse({ ...run.evidence, ...edit }).success, false);
});

test('cross-field validation rejects contradictory manifest, events and requirement mappings', async () => {
  const run = await completed();
  const mutators: Array<(run: RunView) => void> = [
    r => { r.spec.taskId = 'unknown'; },
    r => { r.spec.repoDigest = digestJson('changed'); },
    r => { r.evidence!.runId = crypto.randomUUID(); },
    r => { r.evidence!.coverage[0]!.requirementId = 'R99'; },
    r => { r.evidence!.checks[0]!.requirementId = 'R99'; },
    r => { r.events[0]!.sequence = 99; },
    r => { r.events[0]!.runId = crypto.randomUUID(); },
    r => { r.phase = 'repair'; },
    r => { r.terminalStatus = null; },
    r => { r.evidence = null; },
  ];
  for (const mutate of mutators) {
    const value = structuredClone(run); mutate(value);
    assert.equal(RunViewSchema.safeParse(value).success, false);
  }
});

test('bundle verification detects modifications and explicitly remains integrity-only', async () => {
  const run = await completed();
  const bundle = buildBundle(run, runtimeLock);
  assert.deepEqual(verifyBundle(bundle), bundle);
  assert.equal(bundle.replayScope, 'integrity_only_no_execution');
  for (const changed of [
    { ...bundle, log: 'fabricated log' },
    { ...bundle, runtimeLock: { changed: true } },
    { ...bundle, competitionReady: true },
    { ...bundle, run: { ...bundle.run, task: { ...bundle.run.task, title: 'changed' } } },
  ]) assert.throws(() => verifyBundle(changed));
  const { bundleDigest, ...body } = bundle;
  const changedBody = { ...body, run: { ...body.run, task: { ...body.run.task, title: 'changed' } } };
  const selfConsistent = { ...changedBody, bundleDigest: digestJson(changedBody) };
  assert.throws(() => verifyBundle(selfConsistent, bundleDigest));
});

test('capacity caps mock records; idempotent retries still succeed at capacity', async () => {
  const coordinator = new MockCoordinator(runtimeLock, { capacity: 1 });
  const first = coordinator.create(request);
  assert.throws(() => coordinator.create({ ...request, idempotencyKey: 'second-record' }), /capacity/);
  assert.equal(coordinator.create(request).run.id, first.run.id);
  await coordinator.settled();
});
