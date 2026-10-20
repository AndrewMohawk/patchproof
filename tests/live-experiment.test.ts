import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { BudgetLedger, usdToMicros } from '../packages/orchestrator/src/budget-ledger.ts';
import { ExperimentTraceStore } from '../packages/orchestrator/src/experiment-trace-store.ts';
import { createLiveExperimentExecutor } from '../packages/orchestrator/src/live-experiment.ts';
import type { LiveExperimentOptions } from '../packages/orchestrator/src/live-experiment.ts';
import { buildLiveExperimentModelLock, buildLiveExperimentPolicy } from '../packages/orchestrator/src/live-experiment-policy.ts';
import { hashJson } from '../workers/evaluator/protocol.ts';
import type { ExecutionInput } from '../workers/evaluator/dispatcher.ts';
import type { PhaseAccountingObservation, PhaseAccountingRequest } from '../packages/orchestrator/src/phase-accounting.ts';

// EVERY proof, provider response and accounting observation here is invented test data.
// Real adapter HTTP mappings run against injected in-memory fake transports only. No model/Python/provider execution.
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-live-experiment-unit-'));
  const now = new Date(Date.now() - 1000).toISOString(), expiry = new Date(Date.now() + 7_200_000).toISOString();
  const budget = { schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 5, ownerApproval: { approvedBy: 'SYNTHETIC UNIT', approvedAt: now,
    expiresAt: expiry, reference: 'Temporary invented unit ledger only' }, verifiedCredits: [], stages: { smoke: 0, pilot: 5, evaluate: 0, hosting: 0 },
    episodeLimits: { inferenceCallLimit: 24, inputTokenLimit: 10000, outputTokenLimit: 10000, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 900, candidateBranchLimit: 3 }, note: 'UNIT ONLY' };
  const ledger = new BudgetLedger({ filename: join(directory, 'budget.sqlite'), budget });
  t.after(async () => { ledger.close(); await rm(directory, { recursive: true, force: true }); });
  const fixture = FixtureSchema.parse({ id: 'live-adapter-unit', repoId: 'invented-repository', split: 'development', title: 'Invented fixture', description: 'Return the input.',
    requirements: [{ id: 'R01', text: 'Return the input.' }], files: { 'solution.py': 'def f(n): return n\n' }, entrypoint: 'solution.py', editAllowlist: ['solution.py'],
    visibleCases: [{ id: 'visible', requirementId: 'R01', function: 'f', args: [1], expected: 1 }],
    acceptanceCases: [{ id: 'declared', requirementId: 'R01', function: 'f', args: [2], expected: 2 }], license: 'CC0-1.0', provenance: 'Invented synthetic unit controls; not a real task/account result.' });
  const bytes = JSON.stringify(fixture, null, 2), sourceDigest = digestBytes('synthetic-test-source-map'), proof = { verifiedAt: now, evidenceRefs: ['synthetic://not-live-verification'] };
  const image = '11111111-1111-4111-8111-111111111111', modelId = 'nvidia/synthetic-unit-model';
  const uploads = new Map<string, string>(), operations = new Map<string, {args: unknown[];kwargs: Record<string,unknown>;cancelled:boolean;timeout:number}>();
  const observed = { credentials: 0, modelCalls: 0, sandboxCalls: 0, deletes: 0, accounting: [] as PhaseAccountingRequest[], source: sourceDigest, alwaysFail: false,
    checkpoints: [] as Parameters<ExecutionInput['checkpoint']>[0][], modelBodies: [] as Record<string,unknown>[] };
  const hooks: { model?: (request: RequestInit) => Promise<Response>; status?: (id: string, request: RequestInit) => Promise<Response>;
    accounting?: (request: PhaseAccountingRequest, signal: AbortSignal) => Promise<PhaseAccountingObservation>;
    modelCredential?: () => Promise<string>; sandboxCredential?: () => Promise<{token:string;projectId:string}> } = {};
  const options: LiveExperimentOptions = {
    settings: { maxOutputTokensPerCall: 100, maxModelCallSeconds: 10, maxCheckBatchSeconds: 10, accountingTimeoutSeconds: 2, cleanupTimeoutSeconds: 1,
      hostOverheadSeconds: 5, adjudicationReserve: { wallSeconds: 30, cpuSeconds: 30, spendUsd: 0.05 },
      adjudicationBounds: { maxConcurrentCpuUnits: 0.5, maxCostUsdPerSecond: 0.001, fixedCostUsd: 0.001 } },
    acceptance: null as never, acceptedProofDigests: [], planDigest: digestBytes('synthetic-plan'), traceStore: new ExperimentTraceStore(join(directory, 'traces')), ledger,
    model: { modelId, accountVerifiedAt: now, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, authorized: true,
      credential: async () => { observed.credentials++; return hooks.modelCredential ? hooks.modelCredential() : 'SYNTHETIC-SECRET'; },
      fetch: async (url, request) => {
        assert.equal(String(url), 'https://api.tokenfactory.nebius.com/v1/chat/completions'); observed.modelCalls++;
        observed.modelBodies.push(JSON.parse(request!.body as string));
        assert.ok(observed.checkpoints.at(-1)!.operationIds.some(id => id.startsWith('nebius:model-intent:')));
        if (hooks.model) return hooks.model(request!);
        return Response.json({ id: `synthetic-response-${observed.modelCalls}`, model: modelId, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ files: { 'solution.py': 'def f(n): return n\n' }, summary: 'Injected synthetic response, never a model observation.' }) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
      } },
    modelProof: { ...proof, validUntil: expiry, modelId, licenseUrl: 'https://example.invalid/unit-license', modelCardUrl: 'https://example.invalid/unit-card', contextTokens: 4096,
      tokenizerDigest: digestBytes('unit-tokenizer'), tokenizerModelId: modelId, conservativeInputCountIncludesTemplate: true, outputCapCoversAllBilledTokens: true,
      tokenRatesCoverAllRequestCharges: true, tokenizerEvidenceRefs: proof.evidenceRefs, pricingEvidenceRefs: proof.evidenceRefs, requestBehaviorEvidenceRefs: proof.evidenceRefs },
    tokenizer: { digest: digestBytes('unit-tokenizer'), countInputTokens: () => 10, verifyCurrent: () => {} },
    sandbox: { authorized: true, expectedProjectId: 'synthetic-project', requestTimeoutMs: 500,
      credential: async () => { observed.credentials++; return hooks.sandboxCredential ? hooks.sandboxCredential() : { token: 'SYNTHETIC-SANDBOX-SECRET', projectId: 'synthetic-project' }; },
      fetch: async (url, request) => {
        observed.sandboxCalls++; assert.ok(String(url).startsWith('https://api.tokenfactory.nebius.com/sandboxes/v1/'));
        if (String(url).endsWith('/files')) {
          const source = Buffer.from(request!.body as Uint8Array).toString(), id = randomUUID(); uploads.set(id, source);
          return Response.json({ uuid: id, sha256: createHash('sha256').update(source).digest('hex'), size: Buffer.byteLength(source) }, { status: 201 });
        }
        if (String(url).endsWith('/instances')) {
          const body = JSON.parse(request!.body as string), id = randomUUID(), invocation = JSON.parse(Buffer.from(body.stdin.value, 'base64').toString());
          assert.deepEqual(Object.keys(invocation).sort(), ['args','function','kwargs']); assert.equal(JSON.stringify(body).includes('expected'), false);
          operations.set(id, { args: invocation.args, kwargs: invocation.kwargs, cancelled: false, timeout: body.timeout }); return Response.json({ uuid: id }, { status: 201 });
        }
        const id = String(url).split('/').at(-1)!, operation = operations.get(id)!; assert.ok(operation);
        if (request!.method === 'DELETE') { observed.deletes++; operation.cancelled = true; return new Response(null, { status: 202 }); }
        if (hooks.status) return hooks.status(id, request!);
        return Response.json({ uuid: id, kind: 'instance', status: operation.cancelled ? 'CANCELLED' : 'SUCCESS', image_uuid: image, consumed_cpu: 0.1,
          metadata: { image, result: { state: { exit_code: 0, signal: 0, timed_out: false }, stdout: { encoding: 'ascii', truncated: false,
            value: JSON.stringify({ kind: 'return', value: observed.alwaysFail ? 0 : operation.args[0], argsAfter: operation.args, kwargsAfter: operation.kwargs }) },
            stderr: { encoding: 'ascii', value: '', truncated: false }, resources: { cost: 987654 } } } });
      } },
    sandboxVerification: { schemaVersion: '1.0', validUntil: expiry, projectId: 'synthetic-project', imageUuid: image, immutableImageDigest: digestBytes('synthetic-image'),
      account: proof, image: proof, equivalentControls: { isolation: proof, filesystemProtection: proof, resourceCaps: { ...proof, memoryBytes: 134217728, pids: 32, cpuQuota: 0.5 }, networkDisabled: proof, cancellation: proof, uploadRetention: proof },
      billing: { ...proof, conservativeBatchChargeCeilingUsd: 0.01 }, limits: { maxCases: 2, maxSourceBytes: 262144, maxTimeoutSeconds: 30 } },
    cpuProof: { ...proof, overheadCpuSecondsPerOperation: 0, quotaBoundsAllGuestCpu: true, timeoutBoundsGuestExecution: true }, verifySourceDigest: () => observed.source,
    reservationForExecution: value => ({ reservationFingerprint: digestJson({ syntheticPublicExecution: value }), stage: 'pilot', amountMicros: String(usdToMicros(value.limits.maxApprovedSpendUsd)),
      dispatchId: value.dispatchId, publicInputDigest: digestJson(value) }),
    accountingObserver: async (request, signal) => {
      observed.accounting.push(structuredClone(request)); if (hooks.accounting) return hooks.accounting(request, signal);
      return { receiptDigest: digestJson({ syntheticReceiptFor: request }), checkpointDigest: request.checkpointDigest, measuredCostUsd: 0.1,
        sandboxCpuSeconds: request.observedCpuLowerBound, billingComplete: true, cpuComplete: true, inventoryComplete: true, cleanupComplete: true, retentionFinal: true, coveredOperationIds: request.operationIds };
    }, loadFixtureBytes: async () => bytes,
  };
  const accept = () => {
    options.acceptance = { schemaVersion: '1.0', scope: 'live-experiment-runtime', verifiedAt: now, validUntil: expiry,
      policyDigest: hashJson(buildLiveExperimentPolicy(options.settings)), modelLockDigest: digestJson(buildLiveExperimentModelLock({ proof: options.modelProof,
        accountVerifiedAt: now, inputUsdPerMillionTokens: options.model.inputUsdPerMillionTokens, outputUsdPerMillionTokens: options.model.outputUsdPerMillionTokens })),
      sourceDigest, sandboxVerificationDigest: digestJson(options.sandboxVerification), cpuProofDigest: digestJson(options.cpuProof),
      calibrationUsedOnlyDevelopmentData: true, noFinalFeedbackUsed: true, samplingDefaultsReviewed: true, hostOverheadBoundVerified: true, evidenceRefs: proof.evidenceRefs };
    options.acceptedProofDigests = [digestJson(options.acceptance)];
  };
  accept();
  const input = (): ExecutionInput => ({ episodeId: 'pilot:live-adapter-unit:patchproof:0', dispatchId: randomUUID(), taskId: fixture.id, repoId: fixture.repoId, variant: 'patchproof', repetition: 0, seed: 123,
    limits: { inferenceCallLimit: 24, inputTokenLimit: 10000, outputTokenLimit: 10000, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 900, maxApprovedSpendUsd: 1 },
    fixtureDigest: digestBytes(bytes), planDigest: options.planDigest, modelLockDigest: options.acceptance.modelLockDigest, policyDigest: options.acceptance.policyDigest,
    checkpoint: value => { observed.checkpoints.push(structuredClone(value)); } });
  const grant = (request: ExecutionInput) => {
    const { checkpoint: _, ...publicInput } = request, projection = options.reservationForExecution(publicInput);
    ledger.reserve({ id: request.dispatchId, episodeId: request.dispatchId, stage: projection.stage, amountMicros: BigInt(projection.amountMicros), fingerprint: projection.reservationFingerprint });
    assert.equal(ledger.markAttempted(request.dispatchId).dispatchGranted, true);
  };
  return { directory, options, observed, hooks, fixture, ledger, operations, input, grant, accept };
}

test('guarded live factory uses real mappings against fake transports and preserves the dispatcher-only grant', async t => {
  const s = await setup(t), executor = createLiveExperimentExecutor(s.options), input = s.input();
  assert.equal(s.observed.credentials, 0); assert.equal(s.ledger.snapshot().reservationCount, 0); s.grant(input);
  const result = await executor.execute(input, new AbortController().signal);
  assert.equal(executor.executionMode, 'live'); assert.equal(result.usage.inferenceCalls, 1); assert.equal(result.usage.runtimeFeedbackRounds, 1);
  assert.equal(result.usage.sandboxCpuSeconds, 0.4); assert.equal(result.usage.measuredCostUsd, 0.1); assert.equal(result.billingComplete, true);
  assert.equal(s.observed.accounting.length, 1); assert.equal(s.observed.accounting[0]!.observedCostLowerBoundUsd, null);
  assert.equal(s.operations.size, 4); assert.equal(s.ledger.snapshot().reservationCount, 1); assert.equal(s.ledger.get(input.dispatchId).state, 'attempted');
  assert.equal(s.ledger.get(input.dispatchId).actualCostMicros, null); assert.equal(s.ledger.events().filter(event => event.kind === 'dispatch_attempted').length, 1);
  const trace = s.options.traceStore.get(result.artifactsDigest), json = JSON.stringify(trace);
  assert.equal((trace.result as any).synthetic, false); assert.equal((trace.result as any).benchmarkExecuted, false);
  assert.ok(json.includes('runtime-accounting-request')); assert.equal(json.includes('SYNTHETIC-SECRET'), false);
  const envelope = trace.records.map(row => row.value).find((value: any) => value.kind === 'live-prospective-envelope') as any;
  assert.equal(envelope.maximumGuestOperations, 96); assert.equal(envelope.maximumRawBatches, 48); assert.ok(envelope.maximumCpuSeconds <= 870);
  assert.ok(envelope.maximumRuntimeWallSeconds <= 870); assert.equal(envelope.measuredCostUsd, null);
  assert.ok([...s.operations.values()].every(op => op.timeout <= envelope.guestTimeoutSeconds));
  assert.ok(s.observed.modelBodies.every(body => !('seed' in body) && !('temperature' in body)));
});

test('24-call live path uses 48 actual fake-transport batches and no original checks or extra grant', async t => {
  const s = await setup(t); s.observed.alwaysFail = true;
  const executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input);
  const result = await executor.execute(input, new AbortController().signal);
  assert.equal(result.usage.inferenceCalls, 24); assert.equal(result.usage.runtimeFeedbackRounds, 24); assert.equal(s.operations.size, 96);
  assert.equal(s.observed.modelCalls, 24); assert.equal(s.observed.accounting.length, 1); assert.equal(s.ledger.snapshot().reservationCount, 1);
  assert.equal(result.runtimeApproved, false); assert.equal(s.observed.checkpoints.at(-1)!.operationIds.length, 336);
});

test('missing/unaccepted or changed account, tokenizer and source proof rejects before credentials', async t => {
  const mutations: Array<(s: Awaited<ReturnType<typeof setup>>) => void> = [
    s => { s.options.acceptedProofDigests = []; }, s => { s.options.model.authorized = false; },
    s => { s.options.tokenizer.digest = digestBytes('different'); }, s => { s.observed.source = digestBytes('changed'); },
    s => { s.options.sandboxVerification.equivalentControls.resourceCaps.cpuQuota = 99; },
    s => { s.options.acceptance.validUntil = new Date(Date.now() + 30_000).toISOString(); s.options.acceptedProofDigests = [digestJson(s.options.acceptance)]; },
  ];
  for (const mutate of mutations) { const s = await setup(t); mutate(s); assert.throws(() => createLiveExperimentExecutor(s.options));
    assert.equal(s.observed.credentials + s.observed.modelCalls + s.observed.sandboxCalls, 0); assert.equal(s.ledger.snapshot().reservationCount, 0); }
});

test('unattempted, mismatched and prior-process-style old grants cannot start any provider work', async t => {
  const no = await setup(t), factory = createLiveExperimentExecutor(no.options), missing = no.input();
  await assert.rejects(factory.execute(missing, new AbortController().signal), /runtime_binding_changed/); assert.equal(no.observed.credentials, 0);
  const old = await setup(t), oldInput = old.input(); old.grant(oldInput); await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(createLiveExperimentExecutor(old.options).execute(oldInput, new AbortController().signal), /runtime_binding_changed/); assert.equal(old.observed.credentials, 0);
  const bad = await setup(t), badFactory = createLiveExperimentExecutor(bad.options), badInput = bad.input();
  bad.ledger.reserve({ id: badInput.dispatchId, episodeId: badInput.dispatchId, stage: 'pilot', amountMicros: 1_000_000n, fingerprint: digestBytes('wrong') }); bad.ledger.markAttempted(badInput.dispatchId);
  await assert.rejects(badFactory.execute(badInput, new AbortController().signal), /runtime_binding_changed/); assert.equal(bad.observed.credentials, 0);
});

test('prospective model, all-case CPU, wall and adjudication envelopes deny before credentials', async t => {
  const changes: Array<(s: Awaited<ReturnType<typeof setup>>, input: ExecutionInput) => void> = [
    (_s, input) => { input.limits.maxApprovedSpendUsd = 0.2; }, (_s, input) => { input.limits.sandboxCpuSecondsLimit = 40; },
    s => { s.options.settings.maxModelCallSeconds = 40; }, s => { s.options.settings.adjudicationReserve.cpuSeconds = 1; },
  ];
  for (const change of changes) { const s = await setup(t), input = s.input(); change(s, input); s.accept(); input.policyDigest = s.options.acceptance.policyDigest;
    const executor = createLiveExperimentExecutor(s.options); s.grant(input); await assert.rejects(executor.execute(input, new AbortController().signal), /resource_limit/);
    assert.equal(s.observed.credentials, 0); assert.equal(s.ledger.snapshot().reservationCount, 1); }
});

test('unknown USD and incomplete retention/inventory/CPU never become complete billing or finalized selection', async t => {
  for (const defect of ['unknown', 'retention', 'inventory', 'cpu', 'checkpoint', 'handles'] as const) {
    const s = await setup(t); s.hooks.accounting = async request => ({ receiptDigest: digestBytes('synthetic-receipt'), checkpointDigest: defect === 'checkpoint' ? digestBytes('wrong') : request.checkpointDigest,
      measuredCostUsd: defect === 'unknown' ? null : 0.1, sandboxCpuSeconds: request.observedCpuLowerBound, billingComplete: defect !== 'unknown', cpuComplete: defect !== 'cpu',
      inventoryComplete: defect !== 'inventory', cleanupComplete: true, retentionFinal: defect !== 'retention', coveredOperationIds: defect === 'handles' ? [] : request.operationIds });
    const executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input);
    await assert.rejects(executor.execute(input, new AbortController().signal), /billing_incomplete/);
    assert.equal(s.ledger.get(input.dispatchId).state, 'attempted'); assert.equal(s.ledger.get(input.dispatchId).actualCostMicros, null);
    assert.equal(s.observed.accounting.length, 1); assert.ok(s.observed.checkpoints.some(row => row.usage.measuredCostUsd === null));
    await assert.rejects(executor.execute(input, new AbortController().signal), /runtime_binding_changed/); assert.equal(s.observed.modelCalls, 1);
  }
});

test('approval/source change and abort during credential wait prevent later fetch and preserve intent/accounting limits', async t => {
  const s = await setup(t); let release!: (value: string) => void;
  s.hooks.modelCredential = () => new Promise(resolve => { release = resolve; });
  const executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input); const controller = new AbortController();
  const pending = executor.execute(input, controller.signal);
  while (!release) await new Promise(resolve => setTimeout(resolve, 2));
  controller.abort(); await assert.rejects(pending); release('SYNTHETIC-LATE-SECRET'); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(s.observed.modelCalls, 0); assert.equal(s.observed.sandboxCalls, 0); assert.equal(s.observed.accounting.length, 0);
  const changed = await setup(t); changed.hooks.modelCredential = async () => { changed.observed.source = digestBytes('changed'); return 'SYNTHETIC'; };
  const factory = createLiveExperimentExecutor(changed.options), changedInput = changed.input(); changed.grant(changedInput);
  await assert.rejects(factory.execute(changedInput, new AbortController().signal), /source_changed/); assert.equal(changed.observed.modelCalls, 0);
});

test('malformed model response keeps request/response identity and known tokens without exposing provider body', async t => {
  const s = await setup(t); s.hooks.model = async () => Response.json({ id: 'synthetic-failed-response', usage: { prompt_tokens: 12, completion_tokens: 20 }, choices: 'SECRET-INVALID' });
  const executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input);
  await assert.rejects(executor.execute(input, new AbortController().signal));
  const last = s.observed.checkpoints.at(-1)!;
  assert.ok(last.operationIds.includes('synthetic-failed-response')); assert.equal(last.usage.inputTokens, 12); assert.equal(last.usage.outputTokens, 20);
  assert.equal(last.usage.measuredCostUsd, null); assert.equal(s.observed.sandboxCalls, 0); assert.equal(JSON.stringify(last).includes('SECRET-INVALID'), false);
});

test('cancellation after instance creation still permits scoped DELETE cleanup after source and ledger new-work gates close', async t => {
  const s = await setup(t), executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input);
  const controller = new AbortController();
  s.hooks.status = async id => {
    const operation = s.operations.get(id)!;
    if (!operation.cancelled) {
      s.observed.source = digestBytes('source-changed-after-dispatch'); s.ledger.cancel(input.dispatchId); controller.abort();
      return Response.json({ uuid: id, kind: 'instance', status: 'EXECUTING', metadata: {} });
    }
    return Response.json({ uuid: id, kind: 'instance', status: 'CANCELLED', image_uuid: s.options.sandboxVerification.imageUuid, consumed_cpu: 0.1,
      metadata: { image: s.options.sandboxVerification.imageUuid } });
  };
  await assert.rejects(executor.execute(input, controller.signal));
  assert.equal(s.observed.deletes, 1); assert.equal(s.operations.size, 1); assert.equal(s.observed.accounting.length, 0);
  assert.ok(s.observed.checkpoints.some(value => value.operationIds.some(id => id.startsWith('nebius:operation:'))));
  assert.ok(s.observed.checkpoints.some(value => value.usage.sandboxCpuSeconds === 0.1));
  assert.equal(s.ledger.get(input.dispatchId).state, 'cancelled'); assert.equal(s.ledger.get(input.dispatchId).heldMicros, '1000000');
});

test('caller property mutation cannot swap captured ledger, source, tokenizer, transport or accounting authority', async t => {
  const s = await setup(t), replacement = await setup(t), executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input);
  const originalLedger = s.ledger;
  s.options.ledger = replacement.ledger; s.options.verifySourceDigest = () => digestBytes('swapped');
  s.options.model.fetch = async () => { throw new Error('must not use swapped transport'); };
  s.options.model.credential = async () => { throw new Error('must not use swapped credential'); };
  s.options.tokenizer.countInputTokens = () => { throw new Error('must not use swapped counter'); };
  s.options.accountingObserver = async () => { throw new Error('must not use swapped observer'); };
  s.options.settings.maxOutputTokensPerCall = 1; s.options.sandboxVerification.equivalentControls.resourceCaps.cpuQuota = 100;
  const result = await executor.execute(input, new AbortController().signal);
  assert.equal(result.billingComplete, true); assert.equal(originalLedger.snapshot().reservationCount, 1); assert.equal(replacement.ledger.snapshot().reservationCount, 0);
  assert.equal(s.observed.modelCalls, 1); assert.equal(s.observed.accounting.length, 1);
});

test('accounting observer wait is deadline bounded; missing receipt never yields a selected artifact', async t => {
  const s = await setup(t); s.options.settings.accountingTimeoutSeconds = 1; s.accept();
  let observerStarted = Number.NaN;
  s.hooks.accounting = async () => {
    observerStarted = performance.now();
    return new Promise(() => {}); // Deliberately ignores abort; the factory still bounds its wait.
  };
  const executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input);
  await assert.rejects(executor.execute(input, new AbortController().signal), /billing_incomplete/);
  assert.ok(Number.isFinite(observerStarted), 'The accounting observer must have been entered.');
  assert.ok(performance.now() - observerStarted < 2500); assert.equal(s.observed.accounting.length, 1);
  assert.equal(s.ledger.get(input.dispatchId).actualCostMicros, null); assert.equal(s.ledger.get(input.dispatchId).reconciliationComplete, false);
});

test('source or reservation changes while accounting resolves cannot escape as finalized selection', async t => {
  for (const change of ['source', 'reservation'] as const) {
    const s = await setup(t), executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input);
    s.hooks.accounting = async request => {
      if (change === 'source') s.observed.source = digestBytes('changed-during-accounting'); else s.ledger.cancel(input.dispatchId);
      return { receiptDigest: digestBytes('synthetic-receipt'), checkpointDigest: request.checkpointDigest, measuredCostUsd: 0.1,
        sandboxCpuSeconds: request.observedCpuLowerBound, billingComplete: true, cpuComplete: true, inventoryComplete: true, cleanupComplete: true,
        retentionFinal: true, coveredOperationIds: request.operationIds };
    };
    await assert.rejects(executor.execute(input, new AbortController().signal), change === 'source' ? /source_changed/ : /runtime_binding_changed/);
    assert.equal(s.observed.accounting.length, 1); assert.equal(s.ledger.get(input.dispatchId).actualCostMicros, null);
    assert.equal(s.ledger.get(input.dispatchId).reconciliationComplete, false); assert.equal(s.observed.modelCalls, 1);
  }
});

test('settled drains bounded checker cleanup after the caller abort race has already returned', async t => {
  const s = await setup(t), executor = createLiveExperimentExecutor(s.options), input = s.input(); s.grant(input);
  const controller = new AbortController();
  let cleanupEntered!: () => void, releaseCleanup!: () => void;
  const entered = new Promise<void>(resolve => { cleanupEntered = resolve; });
  const gate = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const interrupted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('unit-outer-abort')), { once: true }));
  s.hooks.status = async id => {
    if (!s.operations.get(id)!.cancelled) {
      controller.abort(); return Response.json({ uuid: id, kind: 'instance', status: 'EXECUTING', metadata: {} });
    }
    cleanupEntered(); await gate;
    // The owner must keep this ledger usable until the underlying checker has returned.
    assert.equal(s.ledger.get(input.dispatchId).state, 'cancelled');
    return Response.json({ uuid: id, kind: 'instance', status: 'CANCELLED', image_uuid: s.options.sandboxVerification.imageUuid,
      consumed_cpu: 0.1, metadata: { image: s.options.sandboxVerification.imageUuid } });
  };
  const execution = executor.execute(input, controller.signal);
  await assert.rejects(Promise.race([execution, interrupted]), /unit-outer-abort/);
  s.ledger.cancel(input.dispatchId); await entered;
  let settled = false; const drain = executor.settled().then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(settled, false);
  releaseCleanup(); await Promise.allSettled([execution]); await drain;
  assert.equal(settled, true); assert.equal(s.observed.deletes, 1); assert.equal(s.operations.size, 1);
  assert.ok(s.observed.checkpoints.some(value => value.usage.sandboxCpuSeconds === 0.1));
  await executor.settled(); // Repeated draining cannot create work or another grant.
  assert.equal(s.observed.modelCalls, 1); assert.equal(s.ledger.snapshot().reservationCount, 1);
});

test('adjudication reserve must fit accounting, cleanup and one usable check second before any grant', async t => {
  const s = await setup(t);
  s.options.settings.adjudicationReserve.wallSeconds = s.options.settings.accountingTimeoutSeconds + s.options.settings.cleanupTimeoutSeconds;
  s.accept();
  assert.throws(() => createLiveExperimentExecutor(s.options), /resource_limit/);
  assert.equal(s.observed.credentials + s.observed.modelCalls + s.observed.sandboxCalls, 0);
  assert.equal(s.ledger.snapshot().reservationCount, 0);
});
