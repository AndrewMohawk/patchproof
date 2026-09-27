import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore, verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { createTrustedSmokeEpisode } from '../packages/orchestrator/src/trusted-smoke.ts';
import type { TrustedSmokeInput } from '../packages/orchestrator/src/trusted-smoke.ts';

// All provider transports and account proofs in this file are synthetic. No network/provider calls.
const fixture = FixtureSchema.parse({ id: 'smoke-unit', repoId: 'synthetic-unit', split: 'development', title: 'Synthetic smoke plumbing',
  description: 'UNIT ONLY: return n plus one.', requirements: [{ id: 'R01', text: 'Return n plus one.' }],
  files: { 'solution.py': 'def f(n): return n\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [{ id: 'visible', requirementId: 'R01', function: 'f', args: [1], expected: 2 }],
  acceptanceCases: [{ id: 'acceptance', requirementId: 'R01', function: 'f', args: [2], expected: 3 }], license: 'CC0-1.0', provenance: 'Original synthetic unit data; no actual execution evidence.' });
const imageId = '11111111-1111-4111-8111-111111111111';
const modelId = 'nvidia/synthetic-unit-model';
type Operation = { source: string; invocation: { args: unknown[]; kwargs: Record<string, unknown> }; timeout: number; cancelled: boolean };

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-trusted-smoke-'));
  const now = new Date(Date.now() - 1000).toISOString(), expiry = new Date(Date.now() + 300_000).toISOString();
  const budget = { schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 1,
    ownerApproval: { approvedBy: 'SYNTHETIC UNIT', approvedAt: now, expiresAt: expiry, reference: 'synthetic unit test only' }, verifiedCredits: [],
    stages: { smoke: 1, pilot: 0, evaluate: 0, hosting: 0 },
    episodeLimits: { inferenceCallLimit: 3, inputTokenLimit: 1000, outputTokenLimit: 500, wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 60, candidateBranchLimit: 3 }, note: 'Temporary unit ledger only.' };
  const ledger = new BudgetLedger({ filename: join(directory, 'budget.sqlite'), budget });
  const journal = new RunJournal(join(directory, 'runs.sqlite'));
  t.after(async () => { try { journal.close(); } catch {} try { ledger.close(); } catch {} await rm(directory, { recursive: true, force: true }); });
  const store = new EvidenceStore(join(directory, 'evidence'));
  const proof = { verifiedAt: now, evidenceRefs: ['synthetic://unit-proof-not-account-evidence'] };
  const sourceDigest = digestBytes('synthetic-bound-source');
  const uploaded = new Map<string, string>(), operations = new Map<string, Operation>();
  const observations = { modelCredentials: 0, sandboxCredentials: 0, modelCalls: 0, sandboxCalls: 0, deletes: 0, inputs: [] as unknown[], sourceChanged: false };
  const hooks: { model?: (options: RequestInit) => Promise<Response> | Response; status?: (id: string, options: RequestInit) => Promise<Response> | Response; alwaysBad?: boolean } = {};
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  const options: TrustedSmokeInput = { episodeId: randomUUID(), fixture, variant: 'patchproof',
    limits: { inferenceCallLimit: 3, inputTokenLimit: 1000, outputTokenLimit: 500, wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 1 },
    model: { modelId, accountVerifiedAt: now, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, authorized: true,
      credential: async () => { observations.modelCredentials++; return 'SYNTHETIC-MODEL-SECRET'; }, countInputTokens: () => 10,
      fetch: async (url, request) => {
        assert.equal(String(url), 'https://api.tokenfactory.nebius.com/v1/chat/completions');
        observations.modelCalls++; observations.inputs.push(JSON.parse(request!.body as string));
        assert.equal(ledger.get(`smoke:${options.episodeId}`).state, 'attempted');
        assert.ok(journal.get(options.episodeId).events.some(event => event.message.includes('model request_intent')));
        if (hooks.model) return hooks.model(request!);
        return json({ id: `synthetic-model-response-${observations.modelCalls}`, model: modelId,
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ files: { 'solution.py': observations.modelCalls > 1 && !hooks.alwaysBad ? 'def f(n): return n+1\n' : 'def f(n): return 0\n' }, summary: 'SYNTHETIC unit proposal' }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 } });
      } },
    modelProof: { ...proof, validUntil: expiry, modelId, licenseUrl: 'https://example.invalid/synthetic-license', modelCardUrl: 'https://example.invalid/synthetic-card', contextTokens: 4096,
      tokenizerDigest: digestBytes('synthetic tokenizer'), tokenizerModelId: modelId, conservativeInputCountIncludesTemplate: true, outputCapCoversAllBilledTokens: true,
      tokenRatesCoverAllRequestCharges: true, tokenizerEvidenceRefs: proof.evidenceRefs, pricingEvidenceRefs: proof.evidenceRefs, requestBehaviorEvidenceRefs: proof.evidenceRefs },
    sandbox: { authorized: true, expectedProjectId: 'synthetic-project', requestTimeoutMs: 100,
      credential: async () => { observations.sandboxCredentials++; return { token: 'SYNTHETIC-SANDBOX-SECRET', projectId: 'synthetic-project' }; },
      fetch: async (url, request) => {
        observations.sandboxCalls++;
        assert.ok(String(url).startsWith('https://api.tokenfactory.nebius.com/sandboxes/v1/'));
        assert.equal(ledger.get(`smoke:${options.episodeId}`).state, 'attempted');
        if (String(url).endsWith('/files')) {
          const source = Buffer.from(request!.body as Uint8Array).toString(), id = randomUUID(); uploaded.set(id, source);
          assert.ok(journal.get(options.episodeId).sandboxOperationIds.some(handle => handle.startsWith('nebius:upload-intent:')));
          return json({ uuid: id, sha256: createHash('sha256').update(source).digest('hex'), size: Buffer.byteLength(source) }, 201);
        }
        if (String(url).endsWith('/instances')) {
          const body = JSON.parse(request!.body as string), id = randomUUID();
          const invocation = JSON.parse(Buffer.from(body.stdin.value, 'base64').toString());
          assert.deepEqual(Object.keys(invocation).sort(), ['args', 'function', 'kwargs']);
          assert.ok(!JSON.stringify(body).includes('expected'));
          operations.set(id, { source: uploaded.get(body.files['/candidate/solution.py'].uuid)!, invocation, timeout: body.timeout, cancelled: false });
          return json({ uuid: id }, 201);
        }
        const id = String(url).split('/').at(-1)!, operation = operations.get(id)!;
        assert.ok(operation);
        if (request!.method === 'DELETE') { observations.deletes++; operation.cancelled = true; return new Response(null, { status: 202 }); }
        if (hooks.status) return hooks.status(id, request!);
        // Deliberately simulated observation, not execution of candidate Python on the host.
        const n = operation.invocation.args[0] as number;
        const value = operation.source.includes('n+1') ? n + 1 : operation.source.includes('return 0') ? 0 : n;
        return json({ uuid: id, kind: 'instance', status: operation.cancelled ? 'CANCELLED' : 'SUCCESS', image_uuid: imageId, consumed_cpu: 0.01,
          metadata: { image: imageId, result: { state: { exit_code: 0, signal: 0, timed_out: false },
            stdout: { encoding: 'ascii', value: JSON.stringify({ kind: 'return', value, argsAfter: operation.invocation.args, kwargsAfter: operation.invocation.kwargs }), truncated: false },
            stderr: { encoding: 'ascii', value: '', truncated: false }, resources: { cost: 0.1 } } } });
      } },
    sandboxVerification: { schemaVersion: '1.0', validUntil: expiry, projectId: 'synthetic-project', imageUuid: imageId, immutableImageDigest: digestBytes('synthetic image'), account: proof, image: proof,
      equivalentControls: { isolation: proof, filesystemProtection: proof, resourceCaps: { ...proof, memoryBytes: 134217728, pids: 32, cpuQuota: 0.5 }, networkDisabled: proof, cancellation: proof, uploadRetention: proof },
      billing: { ...proof, conservativeBatchChargeCeilingUsd: 0.05 }, limits: { maxCases: 2, maxSourceBytes: 262144, maxTimeoutSeconds: 30 } },
    cpuProof: { ...proof, overheadCpuSecondsPerOperation: 0, quotaBoundsAllGuestCpu: true, timeoutBoundsGuestExecution: true },
    sourceProof: { ...proof, digest: sourceDigest, fixtureDigest: digestJson(fixture) }, verifySourceDigest: () => observations.sourceChanged ? digestBytes('changed') : sourceDigest,
    ledger, journal, store };
  return { options, observations, hooks, operations, directory, budget, ledger, journal };
}

test('trusted synthetic transport lifecycle shares one durable envelope and retains actual-vs-estimate distinction', async t => {
  const s = await setup(t), smoke = createTrustedSmokeEpisode(s.options);
  assert.equal(s.observations.modelCredentials + s.observations.sandboxCredentials, 0);
  assert.equal(s.ledger.snapshot().reservationCount, 0);
  const { run } = smoke.start(); const done = await smoke.settled();
  assert.equal(run.id, s.options.episodeId); assert.equal(done.mode, 'live'); assert.equal(done.terminalStatus, 'verified_for_declared_checks');
  assert.equal(done.candidates.length, 2); assert.equal(s.observations.modelCalls, 2); assert.equal(done.usage.inferenceCalls, 2);
  assert.equal(done.usage.measuredCostUsd, null); assert.equal(done.usage.costIsEstimate, false);
  assert.equal(s.ledger.events().filter(event => event.kind === 'dispatch_attempted').length, 1);
  assert.equal(s.ledger.snapshot().heldMicros, smoke.envelope.reservedMicros); assert.equal(s.ledger.snapshot().chargedMicros, '0');
  assert.equal(s.ledger.snapshot().pendingBillingCount, 1); assert.equal(smoke.accounting().reconciliationComplete, false);
  assert.equal(s.operations.size, 12); assert.ok([...s.operations.values()].every(operation => operation.timeout <= smoke.envelope.guestTimeoutSeconds));
  assert.ok(smoke.envelope.maximumCpuSeconds <= s.options.limits.sandboxCpuSecondsLimit);
  const requests = s.observations.inputs as Array<{ max_tokens: number; messages: unknown[] }>;
  assert.deepEqual(requests.map(request => request.max_tokens), [500, 480]);
  assert.ok(done.events.some(event => event.message.includes('synthetic-model-response-2')));
  assert.ok(!JSON.stringify(done).includes('SYNTHETIC-MODEL-SECRET')); assert.ok(!JSON.stringify(done).includes('SYNTHETIC-SANDBOX-SECRET'));
  assert.equal(verifyEvidence(await smoke.coordinator.evidence(run.id)).mode, 'live');
  assert.equal(smoke.start().reused, true); assert.equal(s.observations.modelCalls, 2);
  await smoke.close();
});

test('full three-proposal failure accounts for original and every candidate repetition without extra retry', async t => {
  const s = await setup(t); s.hooks.alwaysBad = true;
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(); const done = await smoke.settled();
  assert.equal(done.terminalStatus, 'failed'); assert.equal(done.candidates.length, 3); assert.equal(s.observations.modelCalls, 3);
  assert.equal(s.operations.size, 16); assert.equal(smoke.envelope.maximumGuestOperations, 16);
  assert.equal(s.ledger.snapshot().reservationCount, 1); assert.equal(done.usage.measuredCostUsd, null);
  await smoke.close();
});

test('synthetic baseline and checks-only callers retain identical aggregate smoke envelopes', async t => {
  const envelopes: unknown[] = [], allowances: unknown[] = [];
  for (const variant of ['baseline', 'checks_only', 'patchproof'] as const) {
    const s = await setup(t); s.options.variant = variant; s.hooks.alwaysBad = true;
    const smoke = createTrustedSmokeEpisode(s.options); smoke.start(); const done = await smoke.settled();
    envelopes.push(smoke.envelope); allowances.push(done.limits);
    assert.equal(done.candidates.length, 3); assert.equal(s.operations.size, 16);
    assert.equal(s.observations.modelCalls, 3); assert.equal(s.ledger.snapshot().reservationCount, 1);
    await smoke.close();
  }
  assert.deepEqual(envelopes[0], envelopes[1]); assert.deepEqual(envelopes[1], envelopes[2]);
  assert.deepEqual(allowances[0], allowances[1]); assert.deepEqual(allowances[1], allowances[2]);
});

test('account/tokenizer/context/source/CPU/cost denials happen before credentials, provider calls or reservations', async t => {
  const s = await setup(t);
  const mutate: Array<(options: TrustedSmokeInput) => void> = [
    value => { value.model.authorized = false; }, value => { value.modelProof.tokenizerModelId = 'wrong'; },
    value => { value.modelProof.contextTokens = 100; }, value => { value.modelProof.validUntil = new Date(Date.now() - 1).toISOString(); },
    value => { value.sourceProof.digest = digestBytes('wrong source'); }, value => { value.limits.inferenceCallLimit = 4; },
    value => { value.limits.maxApprovedSpendUsd = 0.01; }, value => { value.sandboxVerification.equivalentControls.resourceCaps.cpuQuota = 100; },
    value => { value.cpuProof.overheadCpuSecondsPerOperation = 100; }, value => { value.modelProof.licenseUrl = ''; },
    value => { value.modelProof.tokenizerDigest = 'unverified'; }, value => { value.sandbox.expectedProjectId = 'wrong'; },
  ];
  for (const change of mutate) {
    const options = { ...s.options, limits: { ...s.options.limits }, model: { ...s.options.model }, modelProof: { ...s.options.modelProof },
      sandbox: { ...s.options.sandbox }, sourceProof: { ...s.options.sourceProof }, cpuProof: { ...s.options.cpuProof }, sandboxVerification: structuredClone(s.options.sandboxVerification) };
    change(options); assert.throws(() => createTrustedSmokeEpisode(options));
  }
  assert.equal(s.observations.modelCredentials + s.observations.sandboxCredentials + s.observations.modelCalls + s.observations.sandboxCalls, 0);
  assert.equal(s.ledger.snapshot().reservationCount, 0);
});

test('default coordinator rejects live requests and forged capabilities without calling providers', async t => {
  const s = await setup(t);
  const inert = { mode: 'live' as const, async propose(): Promise<never> { throw new Error('must not call'); } };
  const checker = { async run(): Promise<never> { throw new Error('must not call'); } };
  const options = { fixtures: [fixture], runtimeLock: {}, provider: inert, checks: checker, journal: s.journal, store: s.options.store };
  assert.throws(() => new Coordinator({ ...options, trustedSmokeCapability: { authorized: true } }), /capability/);
  const coordinator = new Coordinator(options);
  assert.throws(() => coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'live', idempotencyKey: 'forged-live-request' }), /authorization|verified Nebius/i);
  assert.equal(s.ledger.snapshot().reservationCount, 0); await coordinator.close();
});

test('source change after preparation denies start before the dispatch grant', async t => {
  const s = await setup(t), smoke = createTrustedSmokeEpisode(s.options); s.observations.sourceChanged = true;
  assert.throws(() => smoke.start(), /source_changed/); assert.equal(s.ledger.snapshot().reservationCount, 0);
  assert.equal(s.observations.sandboxCredentials + s.observations.modelCredentials, 0); await smoke.close();
});

test('failed model JSON keeps usage and response ID and stops without a repair retry', async t => {
  const s = await setup(t);
  s.hooks.model = () => Response.json({ id: 'synthetic-invalid-response-id', model: modelId, choices: [{ finish_reason: 'stop', message: { content: 'invalid candidate JSON' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(); const done = await smoke.settled();
  assert.equal(done.reason, 'invalid_candidate'); assert.equal(done.usage.inferenceCalls, 1); assert.equal(done.usage.inputTokens, 10);
  assert.ok(done.events.some(event => event.message.includes('synthetic-invalid-response-id'))); assert.equal(s.observations.modelCalls, 1);
  assert.equal(smoke.accounting().state, 'cancelled'); assert.equal(smoke.accounting().heldMicros, smoke.envelope.reservedMicros); await smoke.close();
});

test('cancelled model dispatch retains attempted usage and unknown billing across ledger restart', async t => {
  const s = await setup(t), controller = new AbortController();
  s.hooks.model = () => { controller.abort(); throw new Error('secret transport detail'); };
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(controller.signal); const done = await smoke.settled();
  assert.equal(done.reason, 'cancelled'); assert.equal(done.usage.inferenceCalls, 1); assert.equal(done.usage.measuredCostUsd, null);
  assert.ok(!JSON.stringify(done).includes('secret transport detail')); const held = smoke.accounting().heldMicros;
  await smoke.close(); s.ledger.close();
  const reopened = new BudgetLedger({ filename: join(s.directory, 'budget.sqlite'), budget: s.budget });
  try {
    assert.equal(reopened.snapshot().heldMicros, held); assert.equal(reopened.snapshot().pendingBillingCount, 1);
    assert.throws(() => createTrustedSmokeEpisode({ ...s.options, episodeId: randomUUID(), ledger: reopened }), /budget_unavailable/);
  } finally { reopened.close(); }
});

test('credential cancellation cannot later dispatch when the supplier eventually resolves', async t => {
  const s = await setup(t), controller = new AbortController();
  let resolveToken!: (value: string) => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  s.options.model.credential = () => { s.observations.modelCredentials++; started(); return new Promise(resolve => { resolveToken = resolve; }); };
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(controller.signal); await waiting; controller.abort();
  const done = await smoke.settled(); assert.equal(done.reason, 'cancelled'); assert.equal(done.usage.inferenceCalls, 0);
  resolveToken('SYNTHETIC-LATE-SECRET'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.observations.modelCalls, 0); assert.equal(smoke.accounting().heldMicros, smoke.envelope.reservedMicros); await smoke.close();
});

test('known sandbox cleanup survives a stale new-work source guard after cancellation', async t => {
  const s = await setup(t), controller = new AbortController();
  s.hooks.status = id => {
    const operation = s.operations.get(id)!;
    if (!operation.cancelled) { s.observations.sourceChanged = true; controller.abort(); }
    return Response.json({ uuid: id, kind: 'instance', status: operation.cancelled ? 'CANCELLED' : 'EXECUTING', image_uuid: imageId, consumed_cpu: 0.01, metadata: { image: imageId } });
  };
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(controller.signal); const done = await smoke.settled();
  assert.equal(done.reason, 'cancelled'); assert.equal(s.observations.deletes, 1); assert.equal(s.operations.size, 1);
  assert.equal(s.observations.modelCalls, 0); assert.ok(done.sandboxOperationIds.some(id => id.startsWith('nebius:operation:')));
  assert.equal(smoke.accounting().heldMicros, smoke.envelope.reservedMicros); await smoke.close();
});

test('source changes while model credentials resolve retain the exact safe blocker and prevent inference', async t => {
  const s = await setup(t);
  s.options.model.credential = async () => { s.observations.sourceChanged = true; return 'SYNTHETIC-LATE-SECRET'; };
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(); const done = await smoke.settled();
  assert.equal(done.reason, 'trusted_smoke_source_changed'); assert.equal(done.terminalStatus, 'infrastructure_error');
  assert.equal(s.observations.modelCalls, 0); assert.equal(done.usage.inferenceCalls, 0);
  assert.equal(s.operations.size, 4); assert.equal(smoke.accounting().heldMicros, smoke.envelope.reservedMicros);
  assert.ok(!JSON.stringify(done).includes('SYNTHETIC-LATE-SECRET')); await smoke.close();
});

test('source change between repeated batches preserves first-round observations and operation handles', async t => {
  const s = await setup(t), transport = s.options.sandbox.fetch;
  s.options.sandbox.fetch = async (url, request) => {
    const response = await transport(url, request);
    if (request?.method === 'GET' && s.operations.size === 2) s.observations.sourceChanged = true;
    return response;
  };
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(); const done = await smoke.settled();
  assert.equal(done.reason, 'trusted_smoke_source_changed'); assert.equal(s.operations.size, 2);
  assert.equal(done.usage.sandboxCpuSeconds, 0.02); assert.equal(s.observations.modelCalls, 0);
  assert.equal(done.sandboxOperationIds.filter(id => id.startsWith('nebius:operation:')).length, 2);
  assert.ok(done.baselineChecks?.visible[0]?.log.includes('trusted_smoke_source_changed')); await smoke.close();
});

test('source change during sandbox credential wait keeps the gate code and prevents new upload', async t => {
  const s = await setup(t);
  s.options.sandbox.credential = async () => {
    s.observations.sourceChanged = true;
    return { token: 'SYNTHETIC-SANDBOX-SECRET', projectId: 'synthetic-project' };
  };
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(); const done = await smoke.settled();
  assert.equal(done.reason, 'trusted_smoke_source_changed'); assert.equal(s.observations.sandboxCalls, 0);
  assert.equal(s.observations.modelCalls, 0); assert.equal(smoke.accounting().heldMicros, smoke.envelope.reservedMicros);
  assert.ok(done.sandboxOperationIds.some(id => id.startsWith('nebius:upload-intent:'))); await smoke.close();
});

test('durable approval changes mid-episode preserve the exact blocker without another dispatch', async t => {
  const s = await setup(t), authority = new BudgetLedger({ filename: join(s.directory, 'budget.sqlite'), budget: s.budget });
  t.after(() => authority.close());
  s.options.model.credential = async () => {
    authority.syncApproval({ ...s.budget, note: 'Synthetic replacement approval revision.' }, { expectedRevision: authority.snapshot().approvalRevision });
    return 'SYNTHETIC-SECRET';
  };
  const smoke = createTrustedSmokeEpisode(s.options); smoke.start(); const done = await smoke.settled();
  assert.equal(done.reason, 'trusted_smoke_approval_changed'); assert.equal(s.observations.modelCalls, 0);
  assert.equal(smoke.accounting().heldMicros, smoke.envelope.reservedMicros); assert.equal(s.ledger.snapshot().pendingBillingCount, 1);
  await smoke.close();
});

test('caller property mutation cannot replace frozen ledger, source verifier or injected runtime dependencies', async t => {
  const s = await setup(t), replacement = new BudgetLedger({ filename: join(s.directory, 'replacement.sqlite'), budget: s.budget });
  t.after(() => replacement.close());
  const smoke = createTrustedSmokeEpisode(s.options), forbidden = () => { throw new Error('MUTATED dependency used'); };
  s.options.ledger = replacement; s.options.verifySourceDigest = forbidden;
  s.options.model.fetch = forbidden; s.options.model.credential = forbidden;
  s.options.sandbox.fetch = forbidden; s.options.sandbox.credential = forbidden;
  smoke.start(); const done = await smoke.settled();
  assert.equal(done.terminalStatus, 'verified_for_declared_checks'); assert.equal(replacement.snapshot().reservationCount, 0);
  assert.equal(s.ledger.snapshot().pendingBillingCount, 1); assert.equal(smoke.accounting().heldMicros, smoke.envelope.reservedMicros);
  await smoke.close();
});
