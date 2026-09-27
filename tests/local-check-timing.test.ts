import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { CheckRunner, ProductContractVersion, ProductRun, RepairProvider, SandboxCheckResult } from '../packages/contracts/src/product.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { Coordinator, LOCAL_LIMITS } from '../packages/orchestrator/src/coordinator.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore, buildEvidence, reproduceEvidence } from '../packages/orchestrator/src/evidence.ts';
import { fixtureDigests } from '../packages/orchestrator/src/fixtures.ts';
import { createPatch } from '../packages/orchestrator/src/patch.ts';
import { RepeatedCheckRunner, REPEATED_CHECK_PROTOCOL } from '../packages/orchestrator/src/repeated-checks.ts';
import { LOCAL_MOCK_CHECK_TIMING_POLICY, resolveCheckBatchSeconds } from '../packages/orchestrator/src/local-check-timing.ts';

// Invented inert inputs and simulated observations only. No Python, containers,
// provider transport, current corpus, or actual replay runner is used.
const fixture = FixtureSchema.parse({ id: 'timing-unit', repoId: 'invented-timing-repo', split: 'development',
  title: 'Timing unit metadata', description: 'Inert metadata only.', requirements: [{ id: 'R01', text: 'Return one.' }],
  files: { 'solution.py': '# inert original\n' }, entrypoint: 'solution.py', editAllowlist: ['solution.py'],
  visibleCases: [{ id: 'visible', requirementId: 'R01', function: 'f', args: [], expected: 1 }],
  acceptanceCases: [{ id: 'acceptance', requirementId: 'R01', function: 'f', args: [0], expected: 1 }],
  license: 'CC0-1.0', provenance: 'Original invented unit metadata.' });
const newLock = () => ({ localCheckTimingPolicy: { ...LOCAL_MOCK_CHECK_TIMING_POLICY } });
const result = (input: Parameters<CheckRunner['run']>[0]): SandboxCheckResult => ({
  checks: input.cases.map(c => ({ id: c.id, requirementId: c.requirementId, status: 'fail', message: 'Invented nonpassing observation.',
    actual: 2, expected: 1, durationMs: 0, log: 'Synthetic observation; no execution.' })),
  operationIds: [], isolation: 'local_container', cpuSeconds: 0, measuredCostUsd: 0, infrastructureError: null,
});
async function coordinatorFor(t: TestContext, runtimeLock: unknown, checks: CheckRunner, onProposal: () => void = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-timing-unit-'));
  const journal = new RunJournal(join(directory, 'runs.sqlite'));
  const provider: RepairProvider = { mode: 'mock', async propose(input) {
    onProposal();
    return { files: { 'solution.py': `# inert proposal ${input.attempt}\n` }, summary: 'Synthetic metadata proposal.',
      usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 }, modelId: null, providerRequestId: null };
  } };
  let coordinator: Coordinator | undefined;
  t.after(async () => { if (coordinator) await coordinator.close(); else journal.close(); await rm(directory, { recursive: true, force: true }); });
  coordinator = new Coordinator({ fixtures: [fixture], runtimeLock, checks, provider, journal, store: new EvidenceStore(join(directory, 'evidence')) });
  return coordinator;
}
function evidenceFor(mode: 'mock' | 'live', version: ProductContractVersion, runtimeLock: unknown) {
  const files = { 'solution.py': '# inert selected\n' };
  const observations = result({ files, entrypoint: fixture.entrypoint, cases: [...fixture.visibleCases, ...fixture.acceptanceCases], timeoutSeconds: 1 });
  const usage = { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 };
  const run: ProductRun = { schemaVersion: version, id: randomUUID(), taskId: fixture.id, variant: 'baseline', mode,
    competitionReady: false, notice: 'Invented metadata, not execution.', phase: 'terminal', terminalStatus: 'failed', reason: 'declared_checks_not_satisfied',
    createdAt: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T00:00:01.000Z', ...fixtureDigests(fixture, version),
    runtimeLockDigest: digestJson(runtimeLock), limits: { ...LOCAL_LIMITS }, usage: { ...usage, sandboxCpuSeconds: 0, costIsEstimate: false, elapsedMs: 1000 },
    baselineChecks: null, selectedCandidateId: 1, candidates: [{ id: 1, parentId: null, summary: 'Inert selected record.', files,
      diff: createPatch(fixture.files, files), visibleChecks: observations.checks.slice(0, 1), acceptanceChecks: observations.checks.slice(1),
      accepted: false, rejectionReason: 'Invented nonpassing observation.', modelId: null, providerRequestId: null, sandboxOperationIds: [], elapsedMs: 0, usage }],
    coverage: [{ requirementId: 'R01', status: 'fail', checkIds: ['visible', 'acceptance'] }],
    events: [{ sequence: 1, timestamp: '2026-09-27T00:00:01.000Z', phase: 'terminal', message: 'Inert record.' }], sandboxOperationIds: [] };
  return buildEvidence(run, fixture, runtimeLock);
}

test('only the exact recorded local policy increases mock timing; live and absent policy stay historical', () => {
  assert.equal(resolveCheckBatchSeconds('mock', {}), 30);
  assert.equal(resolveCheckBatchSeconds('mock', { unrelated: 'retained' }), 30);
  assert.equal(resolveCheckBatchSeconds('live', {}), 30);
  assert.equal(resolveCheckBatchSeconds('mock', newLock()), 60);
  assert.equal(resolveCheckBatchSeconds('live', newLock()), 30);
  for (const policy of [undefined, null, {}, '60', { ...LOCAL_MOCK_CHECK_TIMING_POLICY, id: 'unknown' },
    { ...LOCAL_MOCK_CHECK_TIMING_POLICY, maximumBatchWallSeconds: 61 }, { ...LOCAL_MOCK_CHECK_TIMING_POLICY, maximumBatchWallSeconds: '60' },
    { ...LOCAL_MOCK_CHECK_TIMING_POLICY, extra: true }]) {
    for (const mode of ['mock', 'live'] as const) assert.throws(() => resolveCheckBatchSeconds(mode, { localCheckTimingPolicy: policy }), /recorded check timing policy/);
  }
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'localCheckTimingPolicy', { enumerable: true, get() { getterCalls++; return LOCAL_MOCK_CHECK_TIMING_POLICY; } });
  assert.throws(() => resolveCheckBatchSeconds('mock', accessor), /recorded check timing policy/);
  assert.equal(getterCalls, 0);
});

test('all three mock arms keep equal 60-second batches, three proposals and the unchanged aggregate allowance', async t => {
  const caps: number[] = []; let proposals = 0;
  const lock: { localCheckTimingPolicy: { id: string; maximumBatchWallSeconds: number } } = newLock();
  const coordinator = await coordinatorFor(t, lock, { async run(input) { caps.push(input.timeoutSeconds); return result(input); } }, () => proposals++);
  lock.localCheckTimingPolicy.maximumBatchWallSeconds = 1; // Caller mutation cannot relabel the recorded choice.
  for (const variant of ['baseline', 'checks_only', 'patchproof'] as const) {
    const { run } = coordinator.create({ taskId: fixture.id, variant, mode: 'mock', idempotencyKey: `timing-arm-${variant}` });
    await coordinator.settled();
    const done = coordinator.get(run.id), bundle = await coordinator.evidence(run.id);
    assert.deepEqual(done.limits, LOCAL_LIMITS); assert.equal(done.limits.wallTimeLimitSeconds, 120);
    assert.equal(done.candidates.length, 3); assert.equal(done.terminalStatus, 'failed');
    assert.deepEqual(bundle.runtimeLock, newLock());
    assert.equal(done.runtimeLockDigest, digestJson(newLock()));
  }
  assert.equal(proposals, 9); assert.deepEqual(caps, Array(12).fill(60));
});

test('remaining aggregate deadline shrinks later batches and prevents a third proposal at 120 seconds', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-27T00:00:00.000Z') });
  const caps: number[] = []; let proposals = 0;
  const elapsed = [70_000, 49_000, 1000];
  const coordinator = await coordinatorFor(t, newLock(), { async run(input) {
    caps.push(input.timeoutSeconds); const observed = result(input); t.mock.timers.tick(elapsed[caps.length - 1]!); return observed;
  } }, () => proposals++);
  const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'timing-remaining' });
  await coordinator.settled();
  assert.deepEqual(caps, [60, 50, 1]); assert.equal(proposals, 2);
  const done = coordinator.get(run.id); assert.equal(done.reason, 'timeout'); assert.equal(done.usage.elapsedMs, 120_000);
  assert.equal(done.limits.wallTimeLimitSeconds, 120);
});

test('legacy coordinator locks retain 30-second batches without rewriting historical policy', async t => {
  const caps: number[] = [];
  const coordinator = await coordinatorFor(t, {}, { async run(input) { caps.push(input.timeoutSeconds); return result(input); } });
  const { run } = coordinator.create({ taskId: fixture.id, variant: 'baseline', mode: 'mock', idempotencyKey: 'timing-historical' });
  await coordinator.settled(); assert.deepEqual(caps, [30, 30, 30, 30]);
  assert.deepEqual((await coordinator.evidence(run.id)).runtimeLock, {});
});

test('malformed policy prevents coordinator construction before checker or proposal entry', async t => {
  let calls = 0;
  await assert.rejects(coordinatorFor(t, { localCheckTimingPolicy: { ...LOCAL_MOCK_CHECK_TIMING_POLICY, extra: true } },
    { async run(input) { calls++; return result(input); } }, () => calls++), /Unsupported recorded check timing policy/);
  assert.equal(calls, 0);
});

test('historical2.0/2.1/2.2 replays retain30, new mock policy uses60, and live replay never increases', async () => {
  for (const version of ['2.0', '2.1', '2.2'] as const) {
    for (const [mode, lock, expectedCap] of [['mock', {}, 30], ['mock', newLock(), 60], ['live', newLock(), 30]] as const) {
      const bundle = evidenceFor(mode, version, lock), original = JSON.stringify(bundle), caps: number[] = [];
      const replay = await reproduceEvidence(bundle, { async run(input) { caps.push(input.timeoutSeconds); return result(input); } }, new AbortController().signal);
      assert.equal(replay.status, 'reproduced'); assert.deepEqual(caps, [expectedCap]);
      assert.equal(JSON.stringify(bundle), original);
    }
  }
});

test('recorded repeats share one accepted mock60 or historical30 budget', async () => {
  for (const [lock, cap] of [[{ checkProtocol: REPEATED_CHECK_PROTOCOL }, 30], [{ ...newLock(), checkProtocol: REPEATED_CHECK_PROTOCOL }, 60]] as const) {
    const bundle = evidenceFor('mock', '2.2', lock), caps: number[] = [];
    // The replay wrapper uses its actual monotonic clock; both inner calls must
    // fit one total allowance rather than each receiving a new full allowance.
    const replay = await reproduceEvidence(bundle, { async run(input) { caps.push(input.timeoutSeconds); return result(input); } }, new AbortController().signal);
    assert.equal(replay.status, 'reproduced'); assert.equal(caps.length, 2);
    assert.ok(caps[0]! <= cap && caps[1]! <= caps[0]!);
  }
  let now = 0; const caps: number[] = [];
  const runner = new RepeatedCheckRunner({ async run(input) { caps.push(input.timeoutSeconds); now += 20_000; return result(input); } }, () => now);
  await runner.run({ files: fixture.files, entrypoint: fixture.entrypoint, cases: fixture.visibleCases, timeoutSeconds: resolveCheckBatchSeconds('mock', newLock()) }, new AbortController().signal);
  assert.deepEqual(caps, [60, 40]);
});

test('unknown replay policy fails before any runner entry, even when hashes are internally consistent', async () => {
  let calls = 0;
  const runner: CheckRunner = { async run(input) { calls++; return result(input); } };
  for (const mode of ['mock', 'live'] as const) {
    const bundle = evidenceFor(mode, '2.2', { localCheckTimingPolicy: { ...LOCAL_MOCK_CHECK_TIMING_POLICY, id: 'future-unaccepted' } });
    await assert.rejects(reproduceEvidence(bundle, runner, new AbortController().signal), /Unsupported recorded check timing policy/);
  }
  assert.equal(calls, 0);
});
