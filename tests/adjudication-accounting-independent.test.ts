import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { digestBytes } from '../packages/contracts/src/digest.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { createAccountedAdjudicator } from '../workers/evaluator/adjudication-accounting.ts';
import type { AccountedAdjudicatorOptions, AdjudicationAccountingCheckpoint } from '../workers/evaluator/adjudication-accounting.ts';
import { ExperimentDispatcher, ExperimentExecutionError } from '../workers/evaluator/dispatcher.ts';
import type { AdjudicationInput, AggregateAdjudication, DispatcherTransport } from '../workers/evaluator/dispatcher.ts';
import { createReservationProjection } from '../workers/evaluator/experiment-session.ts';
import { hashJson, planExperiment } from '../workers/evaluator/protocol.ts';

// Invented accounting metadata only. Empty selection markers are never executed.
const H = digestBytes('invented accounting source'), J = digestBytes('invented accounting policy');
const usage = () => ({ inferenceCalls: 0, inputTokens: 0, outputTokens: 0, runtimeFeedbackRounds: 0,
  elapsedMs: 0, sandboxCpuSeconds: 1, measuredCostUsd: 0.1 });
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-adjudication-independent-')), filename = join(directory, 'dispatch.db');
  const limits = { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 30, maxApprovedSpendUsd: 0.2 };
  const plan = planExperiment({ kind: 'pilot', tasks: Array.from({ length: 20 }, (_, i) => ({ id: `invented-${i}`, repoId: `invented-repo-${Math.floor(i / 5)}`,
    split: 'development' as const, fixtureDigest: H, oracleDigest: J })), limits, sourceManifestDigest: H, modelLockDigest: H, policyDigest: J,
    approvedExperimentBudgetUsd: 14.4, estimatedExperimentCostUsd: 10, createdAt: '2026-09-27T00:00:00.000Z' });
  const ledger = new BudgetLedger({ filename: join(directory, 'ledger.db'), budget: {
    schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 25,
    ownerApproval: { approvedBy: 'invented owner', approvedAt: '2026-09-26T00:00:00.000Z', expiresAt: null, reference: 'invented accounting test' }, verifiedCredits: [],
    stages: { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 },
    episodeLimits: { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 30, candidateBranchLimit: 3 }, note: 'synthetic metadata only' } });
  const planDigest = hashJson(plan), episode = plan.episodes[0]!, h = hashJson([planDigest, episode.id]).slice(7);
  const dispatchId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const publicInput = { episodeId: episode.id, dispatchId, taskId: episode.taskId, repoId: episode.repoId, variant: episode.variant, repetition: episode.repetition,
    seed: episode.seed, limits, fixtureDigest: H, planDigest, modelLockDigest: H, policyDigest: J };
  const checkpoints: AdjudicationAccountingCheckpoint[] = [], state = { adjudications: 0, observations: 0, finalCost: 0.02, observedCost: 0.02, complete: true };
  let savedInput: AdjudicationInput | undefined;
  const verdict = (input: AdjudicationInput): AggregateAdjudication => ({ episodeId: input.episodeId, taskId: input.taskId, selectedCandidateDigest: input.selectedCandidateDigest,
    outcome: 'unverified', sealedChecksExecuted: false, checkCount: 0, passedCheckCount: 0, infrastructureError: null,
    evaluationUsage: { measuredCostUsd: state.finalCost, sandboxCpuSeconds: 2 }, sandboxOperationIds: ['invented-adjudication-operation'], artifactsDigest: H, finalOracleFeedbackRounds: 0 });
  const options: AccountedAdjudicatorOptions = { sourceDigest: H, executionMode: 'live', publicEpisodes: [publicInput], reservationForExecution: createReservationProjection(plan),
    saveCheckpoint: checkpoint => { checkpoints.push(checkpoint); },
    adjudicate: async input => { state.adjudications++; savedInput = input; input.onOperation('invented-adjudication-operation'); return verdict(input); },
    observer: async request => { state.observations++; return { receiptDigest: J, checkpointDigest: request.checkpointDigest,
      measuredCostUsd: state.observedCost, sandboxCpuSeconds: 3, billingComplete: state.complete, cpuComplete: state.complete,
      inventoryComplete: state.complete, cleanupComplete: state.complete, retentionFinal: state.complete, coveredOperationIds: request.operationIds }; } };
  const transport: DispatcherTransport = { executionMode: 'live', modelLockDigest: H, policyDigest: J,
    adjudicationBounds: { maxConcurrentCpuUnits: 1, maxCostUsdPerSecond: 0, fixedCostUsd: 0 },
    execute: async () => ({ selectionFinalized: true, selectedCandidate: { files: {}, digest: hashJson({}) }, runtimeApproved: false,
      usage: usage(), billingComplete: true, artifactsDigest: H, infrastructureExclusion: null }),
    adjudicate: async () => { throw new Error('accounted metadata callback must be installed'); } };
  const open = () => new ExperimentDispatcher({ filename, plan, transport, ledger, gates: () => ({ accountAccessVerified: true, sandboxEntitlementVerified: true,
    modelVerified: true, realIntegrationPassed: true, oracleIndependentlyReviewed: true, experimentApproved: true, approvedRemainingSpendUsd: 20, pricesVerified: true, finalProtocolFrozen: true }) });
  t.after(() => { ledger.close(); rmSync(directory, { recursive: true, force: true }); });
  const checkpoint = () => { const db = new DatabaseSync(filename, { readOnly: true });
    try { return JSON.parse(String(db.prepare('SELECT usage_json FROM episodes WHERE episode_id=?').get(episode.id)!.usage_json)); } finally { db.close(); } };
  return { ledger, plan, options, transport, open, state, checkpoints, verdict, checkpoint, retainedInput: () => savedInput };
}

test('composed wrapper retains an already measured verdict overrun instead of hiding its final cost', async t => {
  const s = setup(t); s.state.finalCost = s.state.observedCost = 0.15; s.transport.adjudicate = createAccountedAdjudicator(s.options);
  const dispatcher = s.open(); try {
    const row = await dispatcher.dispatch(s.plan.episodes[0]!.id);
    assert.equal(row.reason, 'completed'); assert.equal(row.result!.usage.measuredCostUsd, 0.25);
    assert.equal(row.result!.usage.sandboxCpuSeconds, 4); assert.equal(s.state.adjudications, 1); assert.equal(s.state.observations, 1);
    assert.equal(s.ledger.snapshot().chargedMicros, '250000'); assert.ok(s.ledger.snapshot().freezeReasons.includes('reservation_overrun'));
  } finally { dispatcher.close(); }
});

test('a larger final accepted observation preserves measured overrun and never counts cumulative values twice', async t => {
  const s = setup(t); s.state.finalCost = 0.02; s.state.observedCost = 0.15; s.transport.adjudicate = createAccountedAdjudicator(s.options);
  const dispatcher = s.open(); try {
    const row = await dispatcher.dispatch(s.plan.episodes[0]!.id);
    assert.equal(row.reason, 'completed'); assert.equal(row.result!.usage.measuredCostUsd, 0.25);
    assert.equal(s.checkpoint().measuredCostUsd, 0.25); assert.equal(s.ledger.snapshot().chargedMicros, '250000');
    assert.ok(s.ledger.snapshot().freezeReasons.includes('reservation_overrun'));
  } finally { dispatcher.close(); }
});

test('incomplete final observation retains all known charges while final fields remain unknown', async t => {
  const s = setup(t); s.state.observedCost = 0.15; s.state.complete = false; s.transport.adjudicate = createAccountedAdjudicator(s.options);
  const dispatcher = s.open(); try {
    const row = await dispatcher.dispatch(s.plan.episodes[0]!.id);
    assert.equal(row.reason, 'billing_incomplete'); assert.equal(row.result!.usage.measuredCostUsd, null); assert.equal(row.result!.usage.sandboxCpuSeconds, null);
    assert.equal(s.checkpoint().measuredCostUsd, 0.25); assert.equal(s.ledger.snapshot().chargedMicros, '250000');
    assert.equal(s.ledger.snapshot().pendingBillingCount, 1); assert.ok(s.ledger.snapshot().freezeReasons.includes('reservation_overrun'));
  } finally { dispatcher.close(); }
});

test('prospective usage still stops work and retains measured lower bounds before any final observation', async t => {
  const s = setup(t); s.options.adjudicate = async input => { s.state.adjudications++; input.onUsage!({ measuredCostUsd: 0.15, sandboxCpuSeconds: 2 }); return s.verdict(input); };
  s.transport.adjudicate = createAccountedAdjudicator(s.options); const dispatcher = s.open(); try {
    const row = await dispatcher.dispatch(s.plan.episodes[0]!.id);
    assert.equal(s.state.observations, 0); assert.notEqual(row.reason, 'completed');
    assert.equal(s.checkpoint().measuredCostUsd, 0.25); assert.equal(s.ledger.snapshot().chargedMicros, '250000');
    assert.equal(s.ledger.snapshot().pendingBillingCount, 1);
  } finally { dispatcher.close(); }
});

test('final accounting cannot reopen prospective callbacks or change a terminal row', async t => {
  const s = setup(t); s.transport.adjudicate = async input => {
    input.onFinalUsage!({ measuredCostUsd: 0.02, sandboxCpuSeconds: 2 });
    assert.throws(() => input.onUsage!({ measuredCostUsd: 0.03, sandboxCpuSeconds: 3 }));
    return s.verdict(input);
  };
  const dispatcher = s.open(); try {
    const row = await dispatcher.dispatch(s.plan.episodes[0]!.id); assert.equal(row.result!.usage.measuredCostUsd, 0.12);
    assert.equal(s.ledger.snapshot().chargedMicros, '120000');
  } finally { dispatcher.close(); }
});

test('retained wrapped callbacks cannot append operations after adjudication has quiesced', async t => {
  const s = setup(t), original = s.options.observer;
  s.options.observer = async (request, signal) => {
    assert.throws(() => s.retainedInput()!.onOperation('invented-late-operation'), /runtime_binding_changed/);
    assert.throws(() => s.retainedInput()!.onUsage!({ measuredCostUsd: 0.03, sandboxCpuSeconds: 3 }), /runtime_binding_changed/);
    return original(request, signal);
  };
  s.transport.adjudicate = createAccountedAdjudicator(s.options); const dispatcher = s.open(); try {
    const row = await dispatcher.dispatch(s.plan.episodes[0]!.id); assert.equal(row.reason, 'completed');
    assert.equal(row.operationIds.includes('invented-late-operation'), false);
    assert.equal(s.ledger.snapshot().chargedMicros, '120000');
  } finally { dispatcher.close(); }
});

test('bad observer binding cannot erase the cost already reported by completed adjudication', async t => {
  const s = setup(t), original = s.options.observer;
  s.options.observer = async (request, signal) => ({ ...await original(request, signal), checkpointDigest: H });
  s.transport.adjudicate = createAccountedAdjudicator(s.options); const dispatcher = s.open(); try {
    const row = await dispatcher.dispatch(s.plan.episodes[0]!.id); assert.equal(row.result!.usage.measuredCostUsd, null);
    assert.equal(s.checkpoint().measuredCostUsd, 0.12); assert.equal(s.ledger.snapshot().chargedMicros, '120000');
    assert.equal(s.ledger.snapshot().pendingBillingCount, 1); assert.equal(s.checkpoints.at(-1)!.state, 'failed');
  } finally { dispatcher.close(); }
});

function directInput(options: AccountedAdjudicatorOptions): AdjudicationInput {
  const input = options.publicEpisodes[0]!;
  return { episodeId: input.dispatchId, taskId: input.taskId, ownerRunId: input.dispatchId, expectedFixtureDigest: input.fixtureDigest,
    expectedOracleDigest: J, selectedCandidateDigest: hashJson({}), selectionFinalized: true, files: {}, timeoutSeconds: 10,
    sandboxCpuSecondsLimit: 10, maxApprovedSpendUsd: 0.1, onOperation: () => {} };
}

test('the 1001st operation cannot corrupt the retained inventory or hide the failed checkpoint', async t => {
  const s = setup(t); let forwarded = 0, last: AdjudicationAccountingCheckpoint | undefined;
  s.options.saveCheckpoint = value => { last = value; };
  s.options.adjudicate = async input => {
    for (let i = 0; i < 1001; i++) input.onOperation(`invented-overflow-${i}`);
    return s.verdict(input);
  };
  const input = directInput(s.options); input.onOperation = () => { forwarded++; };
  await assert.rejects(createAccountedAdjudicator(s.options)(input, new AbortController().signal), error => error instanceof ExperimentExecutionError && error.reason === 'resource_limit');
  assert.equal(forwarded, 1000); assert.equal(last!.state, 'failed'); assert.equal(last!.operationIds.length, 1000);
  assert.equal(last!.operationIds.includes('invented-overflow-1000'), false); assert.equal(s.state.observations, 0);
});

test('checkpoint persistence failure cannot escape as private raw error text or start adjudication', async t => {
  const s = setup(t); s.options.saveCheckpoint = () => { throw new Error('private-storage-error-sentinel'); };
  await assert.rejects(createAccountedAdjudicator(s.options)(directInput(s.options), new AbortController().signal),
    error => error instanceof ExperimentExecutionError && error.reason === 'execution_or_setup_failed' && !error.message.includes('private-storage'));
  assert.equal(s.state.adjudications, 0); assert.equal(s.state.observations, 0);
});
