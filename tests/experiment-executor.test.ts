import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { RepairInput } from '../packages/contracts/src/product.ts';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { createSyntheticExperimentExecutor, buildProspectiveExperimentPolicy } from '../packages/orchestrator/src/experiment-executor.ts';
import type { SyntheticExperimentRuntime } from '../packages/orchestrator/src/experiment-executor.ts';
import { ExperimentTraceStore } from '../packages/orchestrator/src/experiment-trace-store.ts';
import { ExperimentDispatcher, ExperimentExecutionError } from '../workers/evaluator/dispatcher.ts';
import type { ExecutionInput } from '../workers/evaluator/dispatcher.ts';
import { hashJson, planExperiment } from '../workers/evaluator/protocol.ts';

// Invented task/observations only. No fixture files, oracle definitions, Python execution or network.
const limits = { inferenceCallLimit: 24, inputTokenLimit: 10000, outputTokenLimit: 10000,
  wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 900, maxApprovedSpendUsd: 0 };
const settings = { maxOutputTokensPerCall: 100, checkCpuUnits: 0.5, overheadCpuSecondsPerBatch: 0, maxCheckBatchSeconds: 30,
  adjudicationReserve: { wallSeconds: 30, cpuSeconds: 10, spendUsd: 0 } };
const toy = (id = 'invented-task', repoId = 'invented-repository') => FixtureSchema.parse({ id, repoId, split: 'development', title: 'Synthetic plumbing',
  description: 'SYNTHETIC: observe one visible and one declared runtime condition.', requirements: [{ id: 'R01', text: 'Declared synthetic condition.' }],
  files: { 'solution.py': '# original synthetic source\ndef f(value): return value\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [{ id: 'visible', requirementId: 'R01', function: 'f', args: [1], expected: 1 }],
  acceptanceCases: [{ id: 'declared', requirementId: 'R01', function: 'f', args: [2], expected: 2 }],
  license: 'CC0-1.0', provenance: 'Invented unit metadata; no actual repair execution.' });

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-executor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ExperimentTraceStore(join(directory, 'traces'));
  const fixture = toy(), requests: RepairInput[] = [], checkFiles: string[] = [], checkpoints: Parameters<ExecutionInput['checkpoint']>[0][] = [];
  const state = { passVisible: false, passDeclared: false, calls: 0, rawChecks: 0, stale: false };
  const hooks: { propose?: SyntheticExperimentRuntime['provider']['propose']; run?: SyntheticExperimentRuntime['checks']['run'] } = {};
  const runtime: SyntheticExperimentRuntime = { executionMode: 'synthetic', provider: { mode: 'mock', executionMode: 'synthetic',
    async propose(input, signal) {
      state.calls++; requests.push(structuredClone(input));
      if (hooks.propose) return hooks.propose(input, signal);
      return { files: { 'solution.py': `# synthetic revision ${input.attempt + 1}\ndef f(value): return value\n` }, summary: 'Synthetic revision; not a model result.',
        usage: { inferenceCalls: 1, inputTokens: 3, outputTokens: 2, measuredCostUsd: 0 }, modelId: 'synthetic/unit-provider', providerRequestId: `synthetic-response-${state.calls}` };
    } }, checks: { executionMode: 'synthetic', async run(input, signal) {
      state.rawChecks++; checkFiles.push(input.files['solution.py']!);
      const id = `synthetic:check:${randomUUID()}`; input.onOperation?.(id);
      if (hooks.run) return hooks.run(input, signal);
      return { checks: input.cases.map(check => ({ id: check.id, requirementId: check.requirementId,
        status: (check.id === 'visible' ? state.passVisible : state.passDeclared) ? 'pass' as const : 'fail' as const,
        message: `Synthetic ${check.id} observation.`, actual: 0, expected: check.expected ?? null, durationMs: 1, log: 'Synthetic observation only.' })),
        isolation: 'unavailable' as const, operationIds: [id], cpuSeconds: 0.1, measuredCostUsd: 0, infrastructureError: null };
    } } };
  const options = { runtime, settings: structuredClone(settings), modelLockDigest: digestBytes('synthetic-model-lock'), planDigest: digestBytes('synthetic-plan'), traceStore: store,
    loadFixtureBytes: async (_id: string) => JSON.stringify(fixture, null, 2), verifyBindings: () => { if (state.stale) throw new ExperimentExecutionError('source_changed'); } };
  const input = (): ExecutionInput => ({ episodeId: 'synthetic:episode:0', dispatchId: randomUUID(), taskId: fixture.id, repoId: fixture.repoId,
    variant: 'patchproof', repetition: 0, seed: 123, limits: { ...limits }, fixtureDigest: digestBytes(JSON.stringify(fixture, null, 2)),
    planDigest: options.planDigest, modelLockDigest: options.modelLockDigest, policyDigest: hashJson(buildProspectiveExperimentPolicy(options.settings)),
    checkpoint: value => { checkpoints.push(structuredClone(value)); } });
  return { directory, store, fixture, requests, checkFiles, checkpoints, state, hooks, runtime, options, input };
}

test('24 synthetic revisions use three progressive round-robin branches, 48 raw batches and no original feedback', async t => {
  const s = await setup(t), adapter = createSyntheticExperimentExecutor(s.options), request = s.input();
  const result = await adapter.execute(request, new AbortController().signal);
  assert.equal(result.usage.inferenceCalls, 24); assert.equal(result.usage.runtimeFeedbackRounds, 24); assert.equal(s.state.rawChecks, 48);
  assert.equal(result.usage.inputTokens, 72); assert.equal(result.usage.outputTokens, 48);
  assert.equal(result.runtimeApproved, false); assert.equal(result.selectedCandidate?.files['solution.py'], '# synthetic revision 1\ndef f(value): return value\n');
  assert.equal(result.selectedCandidate?.digest, hashJson(result.selectedCandidate!.files));
  assert.ok(s.requests.slice(0, 3).every(request => request.feedback.length === 0 && request.files['solution.py']!.includes('original')));
  assert.ok(s.requests[3]!.files['solution.py']!.includes('revision 1')); assert.ok(s.requests[4]!.files['solution.py']!.includes('revision 2'));
  assert.ok(s.requests[23]!.files['solution.py']!.includes('revision 21'));
  assert.ok(s.requests.every(request => request.remaining.outputTokenLimit === 100));
  assert.ok(s.checkFiles.every(source => !source.includes('original')));
  const trace = s.store.get(result.artifactsDigest);
  const revisions = trace.records.map(record => record.value).filter((value: any) => value.kind === 'revision') as any[];
  assert.deepEqual(revisions.slice(0, 6).map(value => value.branchId), [0, 1, 2, 0, 1, 2]);
  assert.deepEqual(revisions.slice(0, 6).map(value => value.candidate.parentId), [null, null, null, 1, 2, 3]);
  assert.equal((trace.result as any).synthetic, true); assert.equal((trace.result as any).benchmarkExecuted, false);
  assert.ok(s.checkpoints.some(value => value.usage.inferenceCalls === 1 && value.operationIds.some(id => id.includes('model-intent'))));
});

test('baseline sees visible checks only and progressively selects the latest revision; checks-only remains one branch', async t => {
  for (const variant of ['baseline', 'checks_only'] as const) {
    const s = await setup(t), request = { ...s.input(), variant }, adapter = createSyntheticExperimentExecutor(s.options);
    const result = await adapter.execute(request, new AbortController().signal);
    assert.equal(s.state.calls, 24); assert.equal(s.state.rawChecks, 48); assert.ok(result.selectedCandidate!.files['solution.py']!.includes('revision 24'));
    assert.ok(s.requests[1]!.files['solution.py']!.includes('revision 1'));
    assert.equal(s.requests[1]!.feedback.length, variant === 'baseline' ? 1 : 2);
    const revisions = s.store.get(result.artifactsDigest).records.map(row => row.value).filter((row: any) => row.kind === 'revision') as any[];
    assert.ok(revisions.every(row => row.branchId === 0)); assert.equal(revisions[23]!.candidate.parentId, 23);
  }
});

test('baseline approval is explicitly visible-only; B1/P cannot approve an uncovered declared requirement', async t => {
  const b = await setup(t); b.state.passVisible = true;
  const baseline = await createSyntheticExperimentExecutor(b.options).execute({ ...b.input(), variant: 'baseline' }, new AbortController().signal);
  assert.equal(baseline.runtimeApproved, true); assert.equal(b.state.calls, 1); assert.equal(b.state.rawChecks, 2);
  for (const variant of ['checks_only', 'patchproof'] as const) {
    const s = await setup(t); s.fixture.requirements.push({ id: 'R02', text: 'Intentionally uncovered synthetic requirement.' });
    s.state.passVisible = s.state.passDeclared = true;
    const result = await createSyntheticExperimentExecutor(s.options).execute({ ...s.input(), variant }, new AbortController().signal);
    assert.equal(result.runtimeApproved, false); assert.equal(s.state.calls, 24);
  }
});

test('all declared passing observations stop after one revision with exactly two raw observations', async t => {
  const s = await setup(t); s.state.passVisible = s.state.passDeclared = true;
  const result = await createSyntheticExperimentExecutor(s.options).execute(s.input(), new AbortController().signal);
  assert.equal(result.runtimeApproved, true); assert.equal(result.usage.runtimeFeedbackRounds, 1); assert.equal(s.state.calls, 1); assert.equal(s.state.rawChecks, 2);
});

test('factory rejects live or unmarked runtime components before loaders/providers/checks run', async t => {
  const s = await setup(t);
  for (const mutation of [() => { (s.runtime as any).executionMode = 'live'; }, () => { (s.runtime.provider as any).mode = 'live'; },
    () => { (s.runtime.checks as any).executionMode = 'live'; }]) {
    mutation(); assert.throws(() => createSyntheticExperimentExecutor(s.options), (error: unknown) => error instanceof ExperimentExecutionError && error.reason === 'runtime_binding_changed');
    s.runtime.executionMode = 'synthetic'; s.runtime.provider.mode = 'mock'; s.runtime.checks.executionMode = 'synthetic';
  }
  assert.equal(s.state.calls + s.state.rawChecks, 0);
});

test('fixture binding uses exact bytes and refuses canonical-equivalent replacement before repair', async t => {
  const s = await setup(t), request = s.input();
  s.options.loadFixtureBytes = async () => JSON.stringify(s.fixture);
  assert.notEqual(request.fixtureDigest, digestJson(s.fixture));
  await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(request, new AbortController().signal),
    (error: unknown) => error instanceof ExperimentExecutionError && error.reason === 'source_changed');
  assert.equal(s.state.calls + s.state.rawChecks, 0);
});

test('stale policy/model/plan and invalid CPU envelope deny before model/check side effects', async t => {
  const s = await setup(t), adapter = createSyntheticExperimentExecutor(s.options);
  for (const field of ['policyDigest', 'modelLockDigest', 'planDigest'] as const) {
    await assert.rejects(adapter.execute({ ...s.input(), [field]: digestBytes('wrong') }, new AbortController().signal), /runtime_binding_changed/);
  }
  await assert.rejects(adapter.execute({ ...s.input(), limits: { ...limits, sandboxCpuSecondsLimit: 11 } }, new AbortController().signal), /resource_limit/);
  assert.equal(s.state.calls + s.state.rawChecks, 0);
});

test('protected or malformed proposals retain accounted model usage and never reach checker', async t => {
  for (const files of [{ 'evaluator.py': 'synthetic' }, {}]) {
    const s = await setup(t);
    s.hooks.propose = async () => ({ files, summary: 'Synthetic invalid edit.', modelId: null, providerRequestId: 'synthetic-invalid',
      usage: { inferenceCalls: 1, inputTokens: 5, outputTokens: 6, measuredCostUsd: 0 } });
    await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(s.input(), new AbortController().signal), /protected_path|invalid_candidate/);
    assert.equal(s.checkpoints.at(-1)!.usage.inferenceCalls, 1); assert.equal(s.checkpoints.at(-1)!.usage.inputTokens, 5); assert.equal(s.state.rawChecks, 0);
  }
});

test('per-call output cap and aggregate allowance violations retain measured synthetic usage and stop', async t => {
  const s = await setup(t);
  s.hooks.propose = async () => ({ files: { 'solution.py': '# synthetic' }, summary: '', modelId: null, providerRequestId: null,
    usage: { inferenceCalls: 1, inputTokens: 2, outputTokens: 101, measuredCostUsd: 0 } });
  await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(s.input(), new AbortController().signal), /resource_limit/);
  assert.equal(s.state.rawChecks, 0); assert.equal(s.checkpoints.at(-1)!.usage.outputTokens, 101);
});

test('provider receives CPU and monetary residuals after the reserved adjudication slice and prior simulated usage', async t => {
  const s = await setup(t); s.options.settings.adjudicationReserve.spendUsd = 1;
  s.hooks.propose = async input => ({ files: { 'solution.py': '# synthetic' }, summary: '', modelId: null, providerRequestId: null,
    usage: { inferenceCalls: 1, inputTokens: 3, outputTokens: 2, measuredCostUsd: input.attempt === 0 ? 0.4 : 0 } });
  s.hooks.run = async input => ({ checks: input.cases.map(check => ({ id: check.id, requirementId: check.requirementId,
    status: s.state.calls >= 2 ? 'pass' : 'fail', message: 'Synthetic', actual: 0, expected: 0, durationMs: 1, log: 'Synthetic' })),
    isolation: 'unavailable', operationIds: [], cpuSeconds: 0.3, measuredCostUsd: s.state.calls === 1 ? 0.2 : 0, infrastructureError: null });
  const request = { ...s.input(), limits: { ...limits, maxApprovedSpendUsd: 10 } };
  const result = await createSyntheticExperimentExecutor(s.options).execute(request, new AbortController().signal);
  assert.equal(result.runtimeApproved, true); assert.equal(s.requests.length, 2);
  assert.equal(s.requests[0]!.remaining.maxApprovedSpendUsd, 9); assert.equal(s.requests[0]!.remaining.sandboxCpuSecondsLimit, 890);
  assert.ok(Math.abs(s.requests[1]!.remaining.maxApprovedSpendUsd - 8.2) < 1e-9);
  assert.ok(Math.abs(s.requests[1]!.remaining.sandboxCpuSecondsLimit - 889.4) < 1e-9);
});

test('exhausted CPU blocks another proposal while zero-cost synthetic allowance remains permitted', async t => {
  const s = await setup(t);
  s.hooks.run = async input => ({ checks: input.cases.map(check => ({ id: check.id, requirementId: check.requirementId,
    status: 'fail', message: 'Synthetic', actual: 0, expected: 0, durationMs: 1, log: 'Synthetic' })),
    isolation: 'unavailable', operationIds: [], cpuSeconds: 445, measuredCostUsd: 0, infrastructureError: null });
  await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(s.input(), new AbortController().signal), /resource_limit/);
  assert.equal(s.state.calls, 1); assert.equal(s.requests[0]!.remaining.maxApprovedSpendUsd, 0);
  assert.equal(s.checkpoints.at(-1)!.usage.sandboxCpuSeconds, 890);
});

test('partial second-repetition failure preserves first raw observation usage and operations without feedback or retry', async t => {
  const s = await setup(t);
  // Force only the second raw call to fail while retaining the first through the normal fake runner.
  s.hooks.run = async (input) => {
    if (s.state.rawChecks === 2) throw new ExperimentExecutionError('sandbox_setup_failure');
    return { checks: input.cases.map(check => ({ id: check.id, requirementId: check.requirementId, status: 'fail', message: 'Synthetic', actual: 0, expected: 1, durationMs: 1, log: 'Synthetic' })),
      operationIds: [], isolation: 'unavailable', cpuSeconds: 0.25, measuredCostUsd: 0, infrastructureError: null };
  };
  await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(s.input(), new AbortController().signal), /sandbox_setup_failure/);
  assert.equal(s.state.calls, 1); assert.equal(s.state.rawChecks, 2); assert.equal(s.checkpoints.at(-1)!.usage.sandboxCpuSeconds, 0.25);
  assert.equal(s.checkpoints.at(-1)!.usage.runtimeFeedbackRounds, 0); assert.equal(s.checkpoints.at(-1)!.operationIds.filter(id => id.includes('synthetic:check:')).length, 2);
});

test('unknown billing/CPU preserves lower bounds and blocks finalized success', async t => {
  const s = await setup(t);
  s.hooks.run = async input => ({ checks: input.cases.map(check => ({ id: check.id, requirementId: check.requirementId, status: 'pass', message: 'Synthetic', actual: 1, expected: 1, durationMs: 1, log: 'Synthetic' })),
    operationIds: [], isolation: 'unavailable', cpuSeconds: s.state.rawChecks === 1 ? 0.25 : null, measuredCostUsd: null, infrastructureError: null });
  await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(s.input(), new AbortController().signal), /billing_incomplete/);
  assert.equal(s.checkpoints.at(-1)!.usage.sandboxCpuSeconds, 0.25); assert.equal(s.state.calls, 1);
});

test('malformed and failed model responses preserve excess reported calls and full 200-character response IDs', async t => {
  for (const throws of [false, true]) {
    const s = await setup(t), id = 'r'.repeat(200);
    s.hooks.propose = async () => {
      const observation = { usage: { inferenceCalls: 3, inputTokens: 5, outputTokens: 6, measuredCostUsd: 0 }, providerRequestId: id };
      if (throws) throw Object.assign(new Error('PRIVATE provider detail'), observation);
      return { ...observation, files: { 'solution.py': '# synthetic' }, modelId: 'synthetic/unit', summary: 'Synthetic malformed reported count.' };
    };
    await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(s.input(), new AbortController().signal), error =>
      error instanceof ExperimentExecutionError && error.reason === (throws ? 'execution_or_setup_failed' : 'invalid_candidate') && !error.message.includes('PRIVATE'));
    assert.equal(s.checkpoints.at(-1)!.usage.inferenceCalls, 3); assert.equal(s.checkpoints.at(-1)!.usage.inputTokens, 5);
    assert.ok(s.checkpoints.at(-1)!.operationIds.includes(id)); assert.equal(s.state.rawChecks, 0);
  }
});

test('thrown raw-check observations retain safe handles and partial usage before non-excluded failure', async t => {
  const s = await setup(t), id = `synthetic:partial:${randomUUID()}`;
  s.hooks.run = async () => { throw Object.assign(new Error('PRIVATE raw error'), { operationIds: [id],
    usage: { sandboxCpuSeconds: 0.3, measuredCostUsd: 0 } }); };
  await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(s.input(), new AbortController().signal), error =>
    error instanceof ExperimentExecutionError && error.reason === 'execution_or_setup_failed');
  assert.equal(s.checkpoints.at(-1)!.usage.sandboxCpuSeconds, 0.3); assert.ok(s.checkpoints.at(-1)!.operationIds.includes(id));
  assert.equal(s.state.rawChecks, 1); assert.equal(s.state.calls, 1); assert.equal(s.checkpoints.at(-1)!.usage.runtimeFeedbackRounds, 0);
});

test('cancellation fences late callbacks and duplicate dispatch cannot rerun an already claimed episode', async t => {
  const s = await setup(t), controller = new AbortController(), request = s.input();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  s.hooks.propose = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); throw new Error('PRIVATE late failure'); };
  const adapter = createSyntheticExperimentExecutor(s.options), running = adapter.execute(request, controller.signal);
  await ready; controller.abort(); await assert.rejects(running); const count = s.checkpoints.length;
  release(); await new Promise(resolve => setImmediate(resolve)); assert.equal(s.checkpoints.length, count); assert.equal(s.state.rawChecks, 0);
  await assert.rejects(adapter.execute(request, new AbortController().signal)); assert.equal(s.state.calls, 1);
});

test('source change and checkpoint failure block the next side effect; no raw exception text escapes', async t => {
  const s = await setup(t), request = s.input();
  request.checkpoint = value => { s.checkpoints.push(value); if (value.operationIds.some(id => id.includes('model-intent'))) throw new Error('PRIVATE checkpoint detail'); };
  await assert.rejects(createSyntheticExperimentExecutor(s.options).execute(request, new AbortController().signal), error =>
    error instanceof ExperimentExecutionError && !error.message.includes('PRIVATE'));
  assert.equal(s.state.calls + s.state.rawChecks, 0);
  const second = await setup(t); second.state.stale = true;
  await assert.rejects(createSyntheticExperimentExecutor(second.options).execute(second.input(), new AbortController().signal), /source_changed/);
  assert.equal(second.state.calls + second.state.rawChecks, 0);
});

test('adapter connects to public DispatcherTransport without a second grant or any oracle callback in executor input', async t => {
  const s = await setup(t); s.state.passVisible = s.state.passDeclared = true;
  const fixtures = new Map<string, ReturnType<typeof toy>>();
  for (let repo = 0; repo < 4; repo++) for (let task = 0; task < 5; task++) { const fixture = toy(`invented-r${repo}-t${task}`, `invented-repo-${repo}`); fixtures.set(fixture.id, fixture); }
  const plan = planExperiment({ kind: 'pilot', tasks: [...fixtures.values()].map(fixture => ({ id: fixture.id, repoId: fixture.repoId, split: 'development',
    fixtureDigest: digestBytes(JSON.stringify(fixture)), oracleDigest: digestBytes('SYNTHETIC unused oracle identity; no oracle content') })), limits,
    sourceManifestDigest: digestBytes('synthetic manifest'), modelLockDigest: s.options.modelLockDigest,
    policyDigest: hashJson(buildProspectiveExperimentPolicy(s.options.settings)), approvedExperimentBudgetUsd: 0 });
  s.options.planDigest = hashJson(plan); s.options.loadFixtureBytes = async id => JSON.stringify(fixtures.get(id)!);
  const adapter = createSyntheticExperimentExecutor(s.options); let adjudicated = 0;
  const dispatcher = new ExperimentDispatcher({ filename: join(s.directory, 'dispatcher', 'state.sqlite'), plan, transport: { ...adapter,
    adjudicate: async input => { adjudicated++; return { episodeId: input.episodeId, taskId: input.taskId, selectedCandidateDigest: input.selectedCandidateDigest,
      outcome: 'correct', sealedChecksExecuted: true, checkCount: 1, passedCheckCount: 1, infrastructureError: null,
      evaluationUsage: { measuredCostUsd: 0, sandboxCpuSeconds: 0 }, sandboxOperationIds: [], artifactsDigest: digestBytes('synthetic aggregate, no sealed execution'), finalOracleFeedbackRounds: 0 }; } } });
  t.after(() => dispatcher.close());
  const result = await dispatcher.dispatch(plan.episodes[0]!.id);
  assert.equal(result.phase, 'terminal'); assert.equal(result.result?.executionMode, 'synthetic'); assert.equal((result.result as any).benchmarkExecuted, false);
  assert.equal(adjudicated, 1); assert.equal(s.state.calls, 1); assert.equal(s.state.rawChecks, 2);
});
