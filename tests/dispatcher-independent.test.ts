import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { ExperimentDispatcher } from '../workers/evaluator/dispatcher.ts';
import type { AggregateAdjudication, DispatcherTransport, ExecutionInput } from '../workers/evaluator/dispatcher.ts';
import { hashJson, planExperiment } from '../workers/evaluator/protocol.ts';

// Independent controls use only invented metadata and inert text. They perform
// no provider calls, sandbox work, fixture reads, or benchmark experiments.
const DIGEST = 'sha256:' + 'e'.repeat(64);
const FILES = { 'inert.txt': 'Independent dispatcher control. This text is never executed.' };
const usage = (cpu: number | null = 1) => ({ inferenceCalls: 2, inputTokens: 20, outputTokens: 10,
  runtimeFeedbackRounds: 2, elapsedMs: 5, sandboxCpuSeconds: cpu, measuredCostUsd: 0 });
function plan(live = false) {
  return planExperiment({ kind: 'pilot', tasks: Array.from({ length: 4 }, (_, repo) =>
    Array.from({ length: 5 }, (_, task) => ({ id: `independent-${repo}-${task}`, repoId: `invented-repo-${repo}`,
      split: 'development' as const, fixtureDigest: DIGEST, oracleDigest: DIGEST }))).flat(),
    limits: { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000,
      wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 30, maxApprovedSpendUsd: live ? 0.1 : 0 },
    sourceManifestDigest: DIGEST, modelLockDigest: live ? DIGEST : null, policyDigest: DIGEST,
    approvedExperimentBudgetUsd: live ? 7.2 : 0, estimatedExperimentCostUsd: live ? 2 : null,
    createdAt: '2026-09-27T00:00:00.000Z' });
}
function transport(): DispatcherTransport {
  return { executionMode: 'synthetic', modelLockDigest: null, policyDigest: DIGEST,
    async execute() { return { selectionFinalized: true, selectedCandidate: { files: structuredClone(FILES), digest: hashJson(FILES) },
      runtimeApproved: true, usage: usage(), billingComplete: true, artifactsDigest: DIGEST, infrastructureExclusion: null }; },
    async adjudicate(input) { return { episodeId: input.episodeId, taskId: input.taskId, selectedCandidateDigest: input.selectedCandidateDigest,
      outcome: 'correct', sealedChecksExecuted: true, checkCount: 2, passedCheckCount: 2, infrastructureError: null,
      evaluationUsage: { measuredCostUsd: 0, sandboxCpuSeconds: 1 }, sandboxOperationIds: [], artifactsDigest: DIGEST, finalOracleFeedbackRounds: 0 }; } };
}

// These invented approvals reach accounting code in unit tests only. They are
// never loaded from or copied into the owner's real budget or readiness state.
const unitBudget = { schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 25,
  ownerApproval: { approvedBy: 'invented-test-only', approvedAt: '2026-09-27T00:00:00.000Z', expiresAt: null, reference: 'unit test only' },
  verifiedCredits: [], stages: { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 },
  episodeLimits: { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000,
    wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 30, candidateBranchLimit: 3 }, note: 'invented unit test accounting only' };
const unitGates = () => ({ accountAccessVerified: true, sandboxEntitlementVerified: true, modelVerified: true,
  realIntegrationPassed: true, oracleIndependentlyReviewed: true, experimentApproved: true,
  approvedRemainingSpendUsd: 25, pricesVerified: true, finalProtocolFrozen: true });
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-independent-dispatch-'));
  const dispatchers: ExperimentDispatcher[] = [];
  t.after(async () => { for (const dispatcher of dispatchers) dispatcher.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, open(adapter = transport(), filename = join(directory, 'state.sqlite')) {
    const frozen = plan(), dispatcher = new ExperimentDispatcher({ filename, plan: frozen, transport: adapter });
    dispatchers.push(dispatcher); return { dispatcher, id: frozen.episodes[0]!.id }; } };
}

const inconsistentVerdicts: Array<[string, Partial<AggregateAdjudication>]> = [
  ['correct with no checks', { checkCount: 0, passedCheckCount: 0 }],
  ['correct with a failed check', { passedCheckCount: 1 }],
  ['incorrect with every check passing', { outcome: 'incorrect' }],
  ['incorrect with no checks', { outcome: 'incorrect', checkCount: 0, passedCheckCount: 0 }],
  ['correct with an infrastructure error', { infrastructureError: 'invented control error' }],
  ['unverified with completed sealed checks', { outcome: 'unverified' }],
  ['infrastructure failure without an error', { outcome: 'infrastructure_error', sealedChecksExecuted: false }],
];
for (const [name, changed] of inconsistentVerdicts) test(`independent: inconsistent adjudication rejects ${name}`, async t => {
  const context = await fixture(t), adapter = transport(), adjudicate = adapter.adjudicate;
  adapter.adjudicate = async (input, signal) => ({ ...await adjudicate(input, signal), ...changed });
  const { dispatcher, id } = context.open(adapter), row = await dispatcher.dispatch(id);
  assert.equal(row.result!.outcome, 'infrastructure_error');
  assert.equal(row.result!.sealedChecksExecuted, false);
  assert.notEqual(row.reason, 'completed');
  assert.equal(dispatcher.snapshot().plannedEpisodes, 72);
  assert.equal(dispatcher.snapshot().episodes.length, 72);
});

test('independent: an execution checkpoint cannot alter usage after selection is finalized', async t => {
  const context = await fixture(t), adapter = transport(), execute = adapter.execute, adjudicate = adapter.adjudicate;
  let checkpoint: ExecutionInput['checkpoint'] | undefined, rejection: unknown;
  adapter.execute = async (input, signal) => { checkpoint = input.checkpoint; return execute(input, signal); };
  adapter.adjudicate = async (input, signal) => {
    try { checkpoint!({ usage: { ...usage(), inferenceCalls: 3 }, operationIds: ['invented:late-execution'] }); }
    catch (error) { rejection = error; }
    return adjudicate(input, signal);
  };
  const { dispatcher, id } = context.open(adapter), row = await dispatcher.dispatch(id);
  assert.ok(rejection instanceof Error, 'finalized execution callbacks must reject before mutating usage');
  assert.equal(row.result!.usage.inferenceCalls, 2);
  assert.deepEqual(row.operationIds, []);
});

test('independent: transport configuration and callbacks cannot drift after construction', async t => {
  const context = await fixture(t), adapter = transport();
  const { dispatcher, id } = context.open(adapter);
  let replacementCalls = 0;
  adapter.executionMode = 'live'; adapter.modelLockDigest = DIGEST;
  adapter.policyDigest = 'sha256:' + 'a'.repeat(64);
  adapter.execute = async () => { replacementCalls++; throw new Error('replacement executor must not run'); };
  adapter.adjudicate = async () => { replacementCalls++; throw new Error('replacement adjudicator must not run'); };
  const row = await dispatcher.dispatch(id);
  assert.equal(row.reason, 'completed');
  assert.equal(row.result!.executionMode, 'synthetic');
  assert.equal(row.result!.modelLockDigest, null);
  assert.equal(row.result!.policyDigest, DIGEST);
  assert.equal(replacementCalls, 0);
});

test('independent: unknown CPU does not erase the last known cumulative lower bound', async t => {
  const context = await fixture(t), adapter = transport(), execute = adapter.execute;
  let adjudications = 0;
  adapter.execute = async (input, signal) => {
    input.checkpoint({ usage: usage(20), operationIds: [] });
    input.checkpoint({ usage: usage(null), operationIds: [] });
    input.checkpoint({ usage: usage(1), operationIds: [] });
    return execute(input, signal);
  };
  const adjudicate = adapter.adjudicate;
  adapter.adjudicate = async (input, signal) => { adjudications++; return adjudicate(input, signal); };
  const { dispatcher, id } = context.open(adapter), row = await dispatcher.dispatch(id);
  assert.equal(row.reason, 'usage_regression');
  assert.equal(adjudications, 0);
  assert.equal(row.result!.usage.sandboxCpuSeconds, null);
});

test('independent: cancelled work retains its row and rejects subsequent stale callbacks', async t => {
  const context = await fixture(t), adapter = transport();
  let input: ExecutionInput | undefined, announce!: () => void;
  const ready = new Promise<void>(resolve => { announce = resolve; });
  adapter.execute = async value => {
    input = value; value.checkpoint({ usage: usage(), operationIds: ['invented:before-cancel'] });
    announce(); return new Promise(() => {});
  };
  const { dispatcher, id } = context.open(adapter), running = dispatcher.dispatch(id);
  await ready; dispatcher.cancel(id); const row = await running;
  const saved = dispatcher.snapshot(), events = dispatcher.events();
  assert.equal(row.result!.outcome, 'unverified');
  assert.equal(row.result!.usage.measuredCostUsd, null);
  assert.throws(() => input!.checkpoint({ usage: usage(2), operationIds: ['invented:after-cancel'] }));
  assert.deepEqual(dispatcher.snapshot(), saved);
  assert.deepEqual(dispatcher.events(), events);
  assert.equal(saved.episodes.length, 72);
});

test('independent: dispatcher state rejects a symlink parent directory', async t => {
  const context = await fixture(t), actual = join(context.directory, 'actual'), alias = join(context.directory, 'alias');
  await mkdir(actual, { mode: 0o700 }); await symlink(actual, alias);
  assert.throws(() => context.open(transport(), join(alias, 'state.sqlite')));
});

test('independent: dispatcher state requires a private parent directory', async t => {
  const context = await fixture(t), shared = join(context.directory, 'shared');
  await mkdir(shared, { mode: 0o700 }); await chmod(shared, 0o755);
  assert.throws(() => context.open(transport(), join(shared, 'state.sqlite')));
});

test('independent: pre-existing SQLite sidecar symlinks are rejected without touching their targets', async t => {
  const context = await fixture(t), target = join(context.directory, 'inert-marker.txt');
  await writeFile(target, 'must remain unchanged\n', { mode: 0o600 });
  await symlink(target, join(context.directory, 'state.sqlite-journal'));
  assert.throws(() => context.open());
  assert.equal(await readFile(target, 'utf8'), 'must remain unchanged\n');
});

test('independent: the episode deadline is distinct from user cancellation', async t => {
  const context = await fixture(t), adapter = transport();
  let announce!: () => void;
  const ready = new Promise<void>(resolve => { announce = resolve; });
  adapter.execute = async () => { announce(); return new Promise(() => {}); };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { dispatcher, id } = context.open(adapter), running = dispatcher.dispatch(id);
  await ready; t.mock.timers.tick(900_000); const row = await running;
  assert.equal(row.reason, 'episode_timeout');
  assert.equal(row.cancelRequested, false);
  assert.equal(row.result!.outcome, 'infrastructure_error');
  assert.equal(row.result!.usage.measuredCostUsd, null);
});

test('independent: cancellation holds unknown billing across reopened accounting and prevents another dispatch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-independent-accounting-'));
  const frozen = plan(true), adapter = transport(), accountingPath = join(directory, 'accounting.sqlite');
  const ledger = new BudgetLedger({ filename: accountingPath, budget: unitBudget });
  const reopened = new BudgetLedger({ filename: accountingPath, budget: unitBudget });
  adapter.executionMode = 'live'; adapter.modelLockDigest = DIGEST;
  adapter.adjudicationBounds = { maxConcurrentCpuUnits: 1, maxCostUsdPerSecond: 0, fixedCostUsd: 0 };
  let calls = 0, checkpoint: ExecutionInput['checkpoint'] | undefined, announce!: () => void;
  const ready = new Promise<void>(resolve => { announce = resolve; });
  adapter.execute = async input => {
    calls++; checkpoint = input.checkpoint;
    input.checkpoint({ usage: { ...usage(), measuredCostUsd: 0.02 }, operationIds: ['invented:charged-operation'] });
    announce(); return new Promise(() => {});
  };
  const dispatcher = new ExperimentDispatcher({ filename: join(directory, 'dispatch.sqlite'), plan: frozen,
    transport: adapter, ledger, gates: unitGates });
  t.after(async () => { dispatcher.close(); ledger.close(); reopened.close(); await rm(directory, { recursive: true, force: true }); });
  const firstId = frozen.episodes[0]!.id, running = dispatcher.dispatch(firstId);
  await ready; dispatcher.cancel(firstId); const result = await running;
  assert.equal(result.reason, 'cancelled');
  assert.equal(reopened.snapshot().chargedMicros, '20000');
  assert.equal(reopened.snapshot().heldMicros, '80000');
  assert.equal(reopened.snapshot().pendingBillingCount, 1);
  assert.equal(reopened.get(result.dispatchId).state, 'cancelled');
  const before = reopened.snapshot();
  assert.throws(() => checkpoint!({ usage: { ...usage(), measuredCostUsd: 0.03 }, operationIds: ['invented:stale-charge'] }));
  assert.deepEqual(reopened.snapshot(), before);
  await dispatcher.dispatch(frozen.episodes[1]!.id);
  assert.equal(calls, 1);
  assert.equal(dispatcher.snapshot().episodes.length, 72);
  assert.equal(reopened.snapshot().pendingBillingCount, 1);
});

test('independent: live adjudication gets only the remaining aggregate allowance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-independent-allowance-'));
  const frozen = plan(true), adapter = transport();
  const ledger = new BudgetLedger({ filename: join(directory, 'accounting.sqlite'), budget: unitBudget });
  adapter.executionMode = 'live'; adapter.modelLockDigest = DIGEST;
  adapter.adjudicationBounds = { maxConcurrentCpuUnits: 2, maxCostUsdPerSecond: 0.01, fixedCostUsd: 0.01 };
  const execute = adapter.execute, adjudicate = adapter.adjudicate;
  adapter.execute = async (input, signal) => ({ ...await execute(input, signal), usage: { ...usage(20), measuredCostUsd: 0.02 } });
  adapter.adjudicate = async (input, signal) => {
    assert.equal(input.timeoutSeconds, 5); // Remaining CPU (10) / 2 is the tightest cap.
    assert.equal(input.sandboxCpuSecondsLimit, 10);
    assert.equal(input.maxApprovedSpendUsd, 0.08);
    assert.equal(input.ownerRunId, input.episodeId);
    assert.equal(signal.aborted, false);
    return adjudicate(input, signal);
  };
  const dispatcher = new ExperimentDispatcher({ filename: join(directory, 'dispatch.sqlite'), plan: frozen,
    transport: adapter, ledger, gates: unitGates });
  t.after(async () => { dispatcher.close(); ledger.close(); await rm(directory, { recursive: true, force: true }); });
  const row = await dispatcher.dispatch(frozen.episodes[0]!.id);
  assert.equal(row.reason, 'completed');
  assert.equal(row.result!.usage.sandboxCpuSeconds, 21);
  assert.equal(row.result!.usage.measuredCostUsd, 0.02);
  assert.equal(ledger.snapshot().heldMicros, '0');
});
