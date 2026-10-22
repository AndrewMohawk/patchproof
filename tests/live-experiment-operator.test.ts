import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { PhaseAccountingStore, phaseAccountingReceiptDigest, phaseInventoryDigest } from '../packages/orchestrator/src/phase-accounting.ts';
import { buildLiveExperimentModelLock, buildLiveExperimentPolicy } from '../packages/orchestrator/src/live-experiment-policy.ts';
import { planExperiment, hashJson } from '../workers/evaluator/protocol.ts';
import { experimentSessionConfigDigest, ExperimentSessionConfigSchema } from '../workers/evaluator/experiment-session.ts';
import { captureExperimentSnapshot, liveReadinessReceiptDigest } from '../workers/evaluator/experiment-export.ts';
import { LiveExperimentOperatorConfigSchema, liveExperimentFactoryDigest, liveExperimentOperatorConfigDigest, prepareLiveExperimentOperator, runLiveExperimentOperator } from '../scripts/live-experiment-operator.ts';
import { operatorJsonDigest } from '../scripts/operator-files.ts';
import { operatorData, privateJson } from './helpers/smoke-operator-data.ts';

// Everything here is invented and private: fake HTTP, local receipts and an ephemeral unit oracle.
// These tests never access the project's evaluation corpus or a real provider.
function setup(t: TestContext, withFixture = true) {
  const data = operatorData(), expiry = new Date(Date.now() + 7_200_000).toISOString();
  t.after(() => rmSync(data.directory, { recursive: true, force: true }));
  data.budget.maxApprovedSpendUsd = 25; data.budget.stages = { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 };
  data.budget.episodeLimits = { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 100, candidateBranchLimit: 3 };
  data.budget.ownerApproval!.expiresAt = expiry; privateJson(join(data.projectRoot, 'budget.json'), data.budget);
  data.artifact.verification.validUntil = expiry; privateJson(data.config.tokenizerArtifactFile, data.artifact);
  data.config.modelProof.validUntil = expiry; data.config.modelProof.tokenizerDigest = digestJson(data.artifact);
  data.config.sandboxVerification.validUntil = expiry; data.config.sandboxVerification.billing.conservativeBatchChargeCeilingUsd = 0.001;
  const traceDirectory = join(data.state, 'traces'), evaluatorWorkspace = join(data.state, 'invented-evaluator');
  for (const path of [traceDirectory, evaluatorWorkspace, join(evaluatorWorkspace, 'fixtures'), join(evaluatorWorkspace, 'gold')]) mkdirSync(path, { mode: 0o700 });
  const settings = { maxOutputTokensPerCall: 100, maxModelCallSeconds: 5, maxCheckBatchSeconds: 3, accountingTimeoutSeconds: 5, cleanupTimeoutSeconds: 1,
    hostOverheadSeconds: 1, adjudicationReserve: { wallSeconds: 20, cpuSeconds: 10, spendUsd: 0.05 },
    adjudicationBounds: { maxConcurrentCpuUnits: 0.5, maxCostUsdPerSecond: 0, fixedCostUsd: 0.001 } };
  const policyDigest = hashJson(buildLiveExperimentPolicy(settings)), modelLockDigest = digestJson(buildLiveExperimentModelLock({ proof: data.config.modelProof, ...data.config.model }));
  const acceptance = { schemaVersion: '1.0', scope: 'live-experiment-runtime', verifiedAt: data.config.model.accountVerifiedAt, validUntil: expiry,
    policyDigest, modelLockDigest, sourceDigest: data.sourceDigest, sandboxVerificationDigest: digestJson(data.config.sandboxVerification), cpuProofDigest: digestJson(data.config.cpuProof),
    calibrationUsedOnlyDevelopmentData: true, noFinalFeedbackUsed: true, samplingDefaultsReviewed: true, hostOverheadBoundVerified: true, evidenceRefs: ['synthetic://not-account-or-calibration-evidence'] };
  const runtime = LiveExperimentOperatorConfigSchema.parse({ schemaVersion: '1.0', kind: 'patchproof-live-experiment-operator', executionAuthorized: true,
    ledgerPath: join(data.state, 'fixed-project-budget.sqlite'), budgetDigest: operatorJsonDigest(data.budget), phaseJournalPath: join(data.state, 'phases.sqlite'),
    traceDirectory, evaluatorWorkspace, tokenizerArtifactFile: data.config.tokenizerArtifactFile, modelCredentialFile: data.config.modelCredentialFile,
    sandboxCredentialFile: data.config.sandboxCredentialFile, model: data.config.model, modelProof: data.config.modelProof,
    sandboxVerification: data.config.sandboxVerification, cpuProof: data.config.cpuProof, settings, acceptance, acceptedProofDigests: [digestJson(acceptance)] });
  const ledger = new BudgetLedger({ filename: runtime.ledgerPath, budget: data.budget }); ledger.close();
  const oracle = { taskId: data.fixture.id, sealedCases: [{ ...data.fixture.visibleCases[0]!, id: 'invented-independent-check' }] };
  const fixtureDigest = digestBytes(JSON.stringify(data.fixture)), oracleDigest = digestBytes(JSON.stringify(oracle));
  if (withFixture) {
    privateJson(join(evaluatorWorkspace, 'fixtures', data.fixture.id + '.json'), data.fixture);
    privateJson(join(evaluatorWorkspace, 'gold', data.fixture.id + '.json'), oracle);
    privateJson(join(evaluatorWorkspace, 'split-manifest.json'), { tasks: [{ id: data.fixture.id, fixtureDigest, oracleDigest }] });
  }
  const tasks = Array.from({ length: 4 }, (_, r) => Array.from({ length: 5 }, (_, i) => ({ id: r === 0 && i === 0 ? data.fixture.id : `unit-${r}-${i}`,
    repoId: r === 0 ? data.fixture.repoId : `unit-repo-${r}`, split: 'development' as const, fixtureDigest, oracleDigest }))).flat();
  const plan = planExperiment({ kind: 'pilot', tasks, limits: { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000,
    wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 100, maxApprovedSpendUsd: 0.2 }, sourceManifestDigest: data.sourceDigest,
    modelLockDigest, policyDigest, approvedExperimentBudgetUsd: 15, estimatedExperimentCostUsd: 10 });
  const transportDigest = hashJson({ modelLockDigest, policyDigest, adjudicationBounds: settings.adjudicationBounds });
  const ready = { schemaVersion: '1.0', kind: 'experiment-preflight-readiness', bindings: { sourceDigest: data.sourceDigest, planDigest: hashJson(plan), transportDigest },
    observedAt: data.config.model.accountVerifiedAt, gates: { accountAccessVerified: true, sandboxEntitlementVerified: true, modelVerified: true,
      realIntegrationPassed: true, oracleIndependentlyReviewed: true, experimentApproved: true, approvedRemainingSpendUsd: 20, pricesVerified: true, finalProtocolFrozen: true } };
  const session = ExperimentSessionConfigSchema.parse({ schemaVersion: '1.0', kind: 'patchproof-experiment-session', sessionId: randomUUID(),
    dispatcherDatabase: join(data.state, 'dispatcher.sqlite'), planPath: join(data.state, 'plan.json'), planDigest: hashJson(plan), sourceDigest: data.sourceDigest,
    executionMode: 'live', modelLockDigest, policyDigest, adjudicationBounds: settings.adjudicationBounds, transportDigest, factoryDigest: liveExperimentFactoryDigest(runtime),
    maxNewSpendUsd: 15, readiness: { path: join(data.state, 'ready.json'), acceptedDigest: liveReadinessReceiptDigest(ready) } });
  const runtimePath = join(data.state, 'runtime.json'), sessionPath = join(data.state, 'session.json');
  const save = () => { privateJson(runtimePath, runtime); privateJson(sessionPath, session); };
  privateJson(session.planPath, plan); privateJson(session.readiness!.path, ready); save();
  const counts = { model: 0, sandbox: 0 }, operations = new Map<string, boolean>();
  const testing = { scope: 'invented-unit-test' as const, currentSourceDigest: () => data.sourceDigest,
    fetch: (async (url, init) => {
      const path = String(url);
      if (path.endsWith('/chat/completions')) { counts.model++; return Response.json({ id: 'unit-model-response', model: runtime.model.modelId,
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ files: data.fixture.files, summary: 'Invented unit proposal only.' }) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }); }
      counts.sandbox++;
      if (path.endsWith('/files')) { const bytes = Buffer.from(init!.body as Uint8Array); return Response.json({ uuid: randomUUID(), size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') }, { status: 201 }); }
      if (path.endsWith('/instances')) { const id = randomUUID(); operations.set(id, false); return Response.json({ uuid: id }, { status: 201 }); }
      const id = path.split('/').at(-1)!; assert.ok(operations.has(id));
      if (init?.method === 'DELETE') { operations.set(id, true); return new Response(null, { status: 202 }); }
      return Response.json({ uuid: id, kind: 'instance', status: operations.get(id) ? 'CANCELLED' : 'SUCCESS', image_uuid: runtime.sandboxVerification.imageUuid, consumed_cpu: 0.01,
        metadata: { image: runtime.sandboxVerification.imageUuid, result: { state: { exit_code: 0, signal: 0, timed_out: false },
          stdout: { encoding: 'ascii', value: JSON.stringify({ kind: 'return', value: 1, argsAfter: [1], kwargsAfter: {} }), truncated: false },
          stderr: { encoding: 'ascii', value: '', truncated: false }, resources: { cost: 999 } } } });
    }) as typeof globalThis.fetch };
  const args = (command: string, episode?: string) => [command, sessionPath, experimentSessionConfigDigest(session), runtimePath, liveExperimentOperatorConfigDigest(runtime), ...(episode ? [episode] : [])];
  const run = (command: string, episode?: string) => runLiveExperimentOperator(args(command, episode), data.projectRoot, testing);
  const first = plan.episodes.find(row => row.taskId === data.fixture.id)!;
  return { ...data, runtime, session, runtimePath, sessionPath, plan, first, args, testing, counts, run, save };
}

test('private live preflight binds real factory without reading credentials, dispatching or reserving', async t => {
  const s = setup(t);
  privateJson(s.runtime.modelCredentialFile, { deliberately: 'invalid credential must not be parsed during preflight' });
  const result = await s.run('preflight'); assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  assert.deepEqual(s.counts, { model: 0, sandbox: 0 }); assert.equal(existsSync(s.runtime.phaseJournalPath), false);
  const ledger = new BudgetLedger({ filename: s.runtime.ledgerPath, budget: s.budget }); assert.equal(ledger.snapshot().reservationCount, 0); ledger.close();
});
test('missing or changed project ledger/budget/source fails before provider use; status survives missing access', async t => {
  const s = setup(t), original = s.runtime.ledgerPath;
  s.runtime.ledgerPath = join(s.state, 'typo.sqlite'); s.session.factoryDigest = liveExperimentFactoryDigest(s.runtime); s.save();
  assert.equal((await s.run('preflight')).exitCode, 2); assert.equal(existsSync(s.runtime.ledgerPath), false);
  s.runtime.ledgerPath = original; s.session.factoryDigest = liveExperimentFactoryDigest(s.runtime); s.save();
  s.testing.currentSourceDigest = () => 'sha256:' + 'a'.repeat(64); assert.equal((await s.run('preflight')).exitCode, 2);
  rmSync(s.runtime.modelCredentialFile); rmSync(s.runtime.sandboxCredentialFile); assert.equal((await s.run('status')).exitCode, 0);
  assert.deepEqual(s.counts, { model: 0, sandbox: 0 });
});
test('evaluate command cannot dispatch a pilot plan', async t => {
  const s = setup(t); const result = await s.run('evaluate'); assert.equal(result.exitCode, 2);
  assert.match(JSON.stringify(result.output), /live_operator_plan_kind/); assert.deepEqual(s.counts, { model: 0, sandbox: 0 });
});
test('runtime config cannot alias a ledger sidecar before opening SQLite', async t => {
  const s = setup(t), path = s.runtime.ledgerPath + '-wal'; privateJson(path, s.runtime); const before = readFileSync(path);
  const args = s.args('preflight'); args[3] = path;
  const result = await runLiveExperimentOperator(args, s.projectRoot, s.testing); assert.equal(result.exitCode, 2);
  assert.match(JSON.stringify(result.output), /live_operator_path_collision/); assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(s.counts, { model: 0, sandbox: 0 });
});
test('real factory setup failure preserves one attempted hold and permits cancellation after budget changes', async t => {
  const s = setup(t, false), result = await s.run('run-one', s.first.id); assert.equal(result.exitCode, 0, JSON.stringify(result.output));
  const ledger = new BudgetLedger({ filename: s.runtime.ledgerPath, budget: s.budget }); assert.equal(ledger.snapshot().pendingBillingCount, 1);
  assert.equal(ledger.snapshot().heldMicros, '200000'); ledger.close(); assert.deepEqual(s.counts, { model: 0, sandbox: 0 });
  s.budget.note += ' changed while running'; privateJson(join(s.projectRoot, 'budget.json'), s.budget);
  assert.equal((await s.run('preflight')).exitCode, 2);
  const pending = s.plan.episodes.find(row => row.id !== s.first.id)!;
  const cancelled = await s.run('cancel', pending.id); assert.equal(cancelled.exitCode, 0, JSON.stringify(cancelled.output));
  rmSync(join(s.projectRoot, 'budget.json')); rmSync(s.runtime.modelCredentialFile); rmSync(s.runtime.sandboxCredentialFile);
  const recovered = await s.run('recover'); assert.equal(recovered.exitCode, 0, JSON.stringify(recovered.output));
});
test('one composed fake-provider episode requires distinct reviewed runtime and adjudication receipts', async t => {
  const s = setup(t), errors: unknown[] = [], accepted = new Set<string>();
  const timer = setInterval(() => {
    if (!existsSync(s.runtime.phaseJournalPath)) return;
    const store = new PhaseAccountingStore({ filename: s.runtime.phaseJournalPath });
    try { for (const entry of store.requests()) {
      if (accepted.has(entry.requestDigest)) continue;
      const request = entry.request, now = new Date().toISOString();
      const receipt = { schemaVersion: '1.0', kind: 'phase-accounting-observation', id: 'unit-' + request.binding.phase, revision: 1, previousReceiptDigest: null,
        binding: request.binding, checkpointDigest: request.checkpointDigest, scope: 'cumulative_within_phase_including_setup_retries_cleanup_retention',
        inventory: { operationIds: request.operationIds, unresolvedOperationIds: [], complete: true, evidenceDigest: s.sourceDigest },
        cleanup: { complete: true, evidenceDigest: s.sourceDigest }, retention: { final: true, evidenceDigest: s.sourceDigest },
        billing: { currency: 'USD', cumulativeUsd: request.binding.phase === 'runtime' ? '0.01' : '0.02', complete: true, evidenceDigest: s.sourceDigest },
        cpu: { cumulativeSeconds: request.observedCpuLowerBound ?? 0, complete: true, evidenceDigest: s.sourceDigest }, observedThroughAt: now, issuedAt: now, validUntil: new Date(Date.now() + 60_000).toISOString() };
      store.acceptObservation(receipt, { expectedBinding: receipt.binding, expectedCheckpointDigest: receipt.checkpointDigest,
        expectedInventoryDigest: phaseInventoryDigest(request.operationIds), acceptedReceiptDigest: phaseAccountingReceiptDigest(receipt), expectedHeadDigest: null });
      accepted.add(entry.requestDigest);
    } } catch (error) { errors.push(error); } finally { store.close(); }
  }, 10); t.after(() => clearInterval(timer));
  const result = await s.run('run-one', s.first.id); clearInterval(timer);
  assert.deepEqual(errors, []); assert.equal(result.exitCode, 0, JSON.stringify(result.output)); assert.equal(result.output.syntheticTransportTest, true);
  let failureEvidence: string | undefined;
  if (accepted.size !== 2) {
    const snapshot = captureExperimentSnapshot({ dispatcherDatabase: s.session.dispatcherDatabase, sourceBinding: 'expected-historical-lock',
      expected: { sourceDigest: s.sourceDigest, planDigest: s.session.planDigest, transportDigest: s.session.transportDigest } });
    const phases = new PhaseAccountingStore({ filename: s.runtime.phaseJournalPath, readOnly: true });
    let requests;
    try { requests = phases.requests().map(entry => ({ phase: entry.request.binding.phase, requestDigest: entry.requestDigest })); }
    finally { phases.close(); }
    const held = new BudgetLedger({ filename: s.runtime.ledgerPath, budget: s.budget });
    let ledger;
    try { ledger = held.snapshot(); } finally { held.close(); }
    const traces = readdirSync(s.runtime.traceDirectory, { recursive: true }).filter(path => String(path).includes('/objects/') && String(path).endsWith('.json'))
      .map(path => {
        const trace = JSON.parse(readFileSync(join(s.runtime.traceDirectory, String(path)), 'utf8'));
        return { path, result: trace.result, observations: trace.records.map((record: { value: { kind?: string } }) => record.value)
          .filter((value: { kind?: string }) => ['failure', 'checks', 'raw-check-observation', 'runtime-accounting-request'].includes(value.kind ?? '')) };
      });
    failureEvidence = JSON.stringify({ episode: snapshot.episodes.find(row => row.episodeId === s.first.id),
      counts: s.counts, accepted: accepted.size, phaseRequestCount: requests.length, requests, ledger, traces });
  }
  assert.equal(accepted.size, 2, failureEvidence); assert.equal(s.counts.model, 1); assert.ok(s.counts.sandbox > 0);
  const ledger = new BudgetLedger({ filename: s.runtime.ledgerPath, budget: s.budget });
  assert.equal(ledger.snapshot().chargedMicros, '30000'); assert.equal(ledger.snapshot().heldMicros, '0'); assert.equal(ledger.snapshot().pendingBillingCount, 0); ledger.close();
  const capture = captureExperimentSnapshot({ dispatcherDatabase: s.session.dispatcherDatabase, sourceBinding: 'expected-historical-lock',
    expected: { sourceDigest: s.sourceDigest, planDigest: s.session.planDigest, transportDigest: s.session.transportDigest } });
  assert.equal(capture.episodes.find(row => row.episodeId === s.first.id)?.result?.outcome, 'correct');
  const before = { ...s.counts }; assert.equal((await s.run('run-one', s.first.id)).exitCode, 0); assert.deepEqual(s.counts, before);
});
