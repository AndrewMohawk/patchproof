import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { CheckRunner, ProductRun } from '../packages/contracts/src/product.ts';
import { ContractError } from '../packages/contracts/src/index.ts';
import { BudgetLedger, usdToMicros } from '../packages/orchestrator/src/budget-ledger.ts';
import type { PendingInferenceCoverage } from '../packages/orchestrator/src/budget-ledger.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore, verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { createLiveLocalCoordinator, LIVE_EXECUTION, LIVE_LIMITS, LIVE_MODEL, LIVE_PRICING, LIVE_RESERVATION_MICROS } from '../packages/orchestrator/src/live-local.ts';
import { LIVE_LOCAL_CHECK_TIMING_POLICY } from '../packages/orchestrator/src/local-check-timing.ts';
import { REPEATED_CHECK_PROTOCOL } from '../packages/orchestrator/src/repeated-checks.ts';
import { makePricingReceipt, verifyRenewablePricing } from '../packages/orchestrator/src/renewable-pricing.ts';
import type { VerifiedPricing } from '../packages/orchestrator/src/renewable-pricing.ts';
import { NebiusRepairProvider } from '../workers/repair/index.ts';

// Original invented metadata only. The real HTTP adapter is driven by an in-memory
// fetch function; checks return invented observations without interpreting source.
const fixture = FixtureSchema.parse({ id: 'live-local-unit', repoId: 'invented-unit', split: 'development', title: 'Invented maintenance control',
  description: 'Return two in this unit control.', requirements: [{ id: 'R01', text: 'Return two.' }],
  files: { 'solution.py': 'def f(): return 1\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [{ id: 'visible', requirementId: 'R01', function: 'f', args: [], expected: 2 }],
  acceptanceCases: [{ id: 'acceptance', requirementId: 'R01', function: 'f', args: [], expected: 2 }],
  license: 'CC0-1.0', provenance: 'Original synthetic control; never real execution evidence.' });
const HASH = 'sha256:' + 'a'.repeat(64), SECRET = 'INVENTED-UNIT-CREDENTIAL';
const lock = { mode: 'live', execution: LIVE_EXECUTION, liveLocalCheckTimingPolicy: LIVE_LOCAL_CHECK_TIMING_POLICY, checkProtocol: REPEATED_CHECK_PROTOCOL };
const request = (key: string, variant = 'patchproof') => ({ taskId: fixture.id, variant, mode: 'live', idempotencyKey: key });
const response = (source = 'def f(): return 2\n', usage = { prompt_tokens: 24, completion_tokens: 32 }, extra: Record<string, unknown> = {}) =>
  Response.json({ id: 'invented-response', model: LIVE_MODEL, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ files: { 'solution.py': source }, summary: 'Invented proposal.' }) } }], usage, ...extra },
    { headers: { 'x-request-id': 'invented-transport' } });

async function setup(t: TestContext, verifyPricing?: (deadline: number) => VerifiedPricing) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(LIVE_PRICING.verifiedAt) });
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-live-local-unit-'));
  const budget = { schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 25,
    ownerApproval: { approvedBy: 'synthetic', approvedAt: '2026-09-27T00:00:00Z', expiresAt: null, reference: 'invented control' },
    verifiedCredits: [], stages: { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 },
    episodeLimits: { inferenceCallLimit: 24, inputTokenLimit: null, outputTokenLimit: null, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: null, candidateBranchLimit: 3 }, note: 'synthetic only' };
  const ledger = new BudgetLedger({ filename: join(directory, 'budget.sqlite'), budget, pendingBillingPolicy: 'allow-covered-inference' });
  const journal = new RunJournal(join(directory, 'runs.sqlite')), store = new EvidenceStore(join(directory, 'evidence'));
  const accountingDirectory = join(directory, 'inference-accounting');
  const observed = { credentials: 0, requests: [] as Array<{ url: string; init: RequestInit; body: Record<string, any> }>,
    checks: [] as Array<Parameters<CheckRunner['run']>[0]>, sourceChanged: false };
  const hooks: { fetch?: (init: RequestInit) => Promise<Response> | Response; check?: (call: number) => void; alwaysFail?: boolean } = {};
  const checks: CheckRunner = { async run(input, signal) {
    signal.throwIfAborted(); const { onOperation: _onOperation, ...observation } = input;
    observed.checks.push(structuredClone(observation)); hooks.check?.(observed.checks.length);
    const pass = !hooks.alwaysFail && input.files['solution.py']!.includes('return 2');
    const id = 'invented-check-' + observed.checks.length; input.onOperation?.(id);
    return { checks: input.cases.map(c => ({ id: c.id, requirementId: c.requirementId, status: pass ? 'pass' : 'fail',
      actual: pass ? 2 : 1, expected: 2, durationMs: 0, log: JSON.stringify({ synthetic: true, operationId: id, lifecycle: ['created', 'started', 'cleanup-confirmed'] }), message: 'Invented check.' })),
      isolation: 'local_container', operationIds: [id], cpuSeconds: null, measuredCostUsd: 0, infrastructureError: null };
  } };
  const options = { fixtures: [fixture], runtimeLock: lock, sourceDigest: HASH, pricingEvidenceDigest: HASH, ledger, journal, store, checks,
    accountingDirectory, ...(verifyPricing ? { verifyPricing } : {}), verifyRuntime: () => { if (observed.sourceChanged) throw new ContractError('digest_mismatch', 'Invented source changed.'); },
    credential: async () => { observed.credentials++; return SECRET; }, fetch: (async (url, init) => {
      observed.requests.push({ url: String(url), init: init!, body: JSON.parse(String(init!.body)) });
      assert.equal(String(url), 'https://api.tokenfactory.nebius.com/v1/chat/completions');
      assert.equal(init!.method, 'POST'); assert.equal(init!.redirect, 'error');
      assert.equal(ledger.snapshot().blockingPendingBillingCount, 1);
      assert.ok((await readdir(accountingDirectory)).length >= 2, 'intent persisted before fake transport');
      return hooks.fetch ? hooks.fetch(init!) : response();
    }) as typeof fetch };
  const coordinator = createLiveLocalCoordinator(options);
  t.after(async () => { await coordinator.close(); ledger.close(); await rm(directory, { recursive: true, force: true }); });
  const run = async (key: string, variant = 'patchproof') => { const created = coordinator.create(request(key, variant)); await coordinator.settled(); return coordinator.get(created.run.id); };
  const reservation = (run: ProductRun) => ledger.get('live-local:' + run.id);
  return { budget, directory, accountingDirectory, ledger, journal, store, options, coordinator, observed, hooks, run, reservation };
}

test('Super shares a quarter-dollar reservation that covers its entire matched token allowance', () => {
  assert.equal(LIVE_MODEL, 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(LIVE_PRICING.verifiedAt, '2026-10-16T21:01:00Z');
  assert.equal(LIVE_PRICING.validUntil, '2026-10-17T21:00:00Z');
  assert.equal(LIVE_RESERVATION_MICROS, 250_000n);
  assert.equal(LIVE_RESERVATION_MICROS, usdToMicros(LIVE_LIMITS.maxApprovedSpendUsd));
  assert.equal(LIVE_LIMITS.inferenceCallLimit, 3);
  assert.equal(LIVE_LIMITS.inputTokenLimit, 786432);
  assert.equal(LIVE_LIMITS.outputTokenLimit, 12000);
  assert.equal(LIVE_LIMITS.wallTimeLimitSeconds, 600);
  assert.equal(LIVE_PRICING.maximumOutputTokensPerRequest, 4000);
  const tokenRateProduct = BigInt(LIVE_LIMITS.inferenceCallLimit * LIVE_PRICING.contextTokens) *
    usdToMicros(LIVE_PRICING.inputUsdPerMillionTokens) +
    BigInt(LIVE_LIMITS.outputTokenLimit) * usdToMicros(LIVE_PRICING.outputUsdPerMillionTokens);
  assert.equal(tokenRateProduct, 246_729_600_000n);
  assert.equal(Number(tokenRateProduct) / 1_000_000_000_000, 0.2467296);
  assert.ok(tokenRateProduct < LIVE_RESERVATION_MICROS * 1_000_000n);
  assert.equal(LIVE_PRICING.requestFeeUsd, 0);
});

test('full Super token receipts retain their hold, preserve prior allocations and exhaust the shared smoke stage', async t => {
  const h = await setup(t);
  h.ledger.reserve({ id: 'prior-allocation', episodeId: 'prior-allocation', stage: 'smoke', amountMicros: 100_000n, fingerprint: HASH });
  h.hooks.alwaysFail = true;
  h.hooks.fetch = () => response('def f(): return 2\n', { prompt_tokens: 262144, completion_tokens: 4000 });
  const done = await h.run('full-super-envelope');
  assert.equal(done.terminalStatus, 'failed'); assert.equal(done.usage.inferenceCalls, 3);
  assert.equal(done.usage.inputTokens, 786432); assert.equal(done.usage.outputTokens, 12000);
  assert.ok(Math.abs(done.usage.measuredCostUsd! - 0.2467296) < 1e-12);
  assert.equal(done.usage.costIsEstimate, true);
  assert.equal(h.reservation(done).reservedMicros, '250000');
  assert.equal(h.reservation(done).heldMicros, '250000'); assert.equal(h.reservation(done).actualCostMicros, null);
  const coverage = h.ledger.events().find(event => event.kind === 'closed_inference_exposure_covered')!;
  const proof = coverage.details.proof as PendingInferenceCoverage;
  assert.equal(proof.modelId, LIVE_MODEL);
  assert.equal(proof.inputMicrosPerMillionTokens, '300000');
  assert.equal(proof.outputMicrosPerMillionTokens, '900000'); assert.equal(proof.requestFeeMicros, '0');
  // The ledger rounds each request upward independently, keeping the bound conservative.
  assert.equal(coverage.details.maximumCostMicros, '246732');
  assert.equal(proof.requests.length, 3);
  assert.equal(h.ledger.get('prior-allocation').heldMicros, '100000');
  assert.equal(h.ledger.snapshot().heldMicros, '350000');
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 1); assert.equal(h.ledger.snapshot().frozen, false);
  h.ledger.reserve({ id: 'remaining-smoke', episodeId: 'remaining-smoke', stage: 'smoke', amountMicros: 4_650_000n, fingerprint: HASH });
  assert.equal(h.ledger.snapshot().stages.smoke.availableMicros, '0');
  assert.throws(() => h.coordinator.create(request('smoke-exhausted')), /allowance is exhausted/);
  assert.equal(h.observed.requests.length, 3); assert.equal(h.observed.credentials, 3);
});

test('real adapter success keeps unknown billed cost and full hold, then permits covered continuation', async t => {
  const h = await setup(t), first = await h.run('success-1');
  assert.equal(first.mode, 'live'); assert.equal(first.terminalStatus, 'verified_for_declared_checks');
  assert.equal(first.reason, 'declared_local_checks_passed'); assert.equal(first.usage.inferenceCalls, 1);
  assert.equal(first.usage.sandboxCpuSeconds, null); assert.equal(first.usage.costIsEstimate, true);
  assert.equal(first.usage.measuredCostUsd, (24 * .3 + 32 * .9) / 1_000_000);
  assert.equal(h.reservation(first).actualCostMicros, null); assert.equal(h.reservation(first).heldMicros, '250000');
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 1); assert.equal(h.ledger.snapshot().frozen, false);
  const bundle = verifyEvidence(await h.coordinator.evidence(first.id)); assert.equal(bundle.run.id, first.id); assert.deepEqual(bundle.runtimeLock, lock);
  const second = await h.run('success-2'); assert.equal(second.terminalStatus, 'verified_for_declared_checks');
  assert.equal(h.ledger.snapshot().heldMicros, '500000'); assert.equal(h.ledger.snapshot().pendingBillingCount, 2);
  assert.equal(h.coordinator.create(request('success-1')).reused, true); assert.equal(h.observed.requests.length, 2);
});

test('ambiguous transport leaves full hold blocking and never retries automatically', async t => {
  const h = await setup(t); h.hooks.fetch = () => { throw new Error('invented transport uncertainty'); };
  const done = await h.run('ambiguous'); assert.equal(done.reason, 'transport_error'); assert.equal(done.usage.inferenceCalls, 1);
  assert.equal(h.observed.requests.length, 1); assert.equal(h.reservation(done).actualCostMicros, null); assert.equal(h.reservation(done).heldMicros, '250000');
  assert.equal(h.ledger.snapshot().blockingPendingBillingCount, 1); assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 0);
  assert.throws(() => h.coordinator.create(request('must-block')), /paused|accounting/); assert.equal(h.observed.requests.length, 1);
});

test('all variants request non-thinking mode with exact limits, repeated-check cap and at most three bounded requests', async t => {
  const h = await setup(t); h.hooks.alwaysFail = true;
  for (const variant of ['baseline', 'checks_only', 'patchproof']) {
    const done = await h.run('variant-' + variant, variant); assert.equal(done.terminalStatus, 'failed');
    assert.deepEqual(done.limits, LIVE_LIMITS); assert.equal(done.usage.inferenceCalls, 3); assert.equal(done.candidates.length, 3);
  }
  assert.equal(h.observed.requests.length, 9); assert.equal(h.observed.checks.length, 24);
  for (const call of h.observed.requests) {
    assert.equal(call.body.model, LIVE_MODEL); assert.equal(call.body.max_tokens, 4000); assert.equal(call.body.max_completion_tokens, 4000);
    assert.equal(call.body.n, 1); assert.equal(call.body.stream, false); assert.equal(call.body.store, false);
    assert.deepEqual(call.body.chat_template_kwargs, { enable_thinking: false });
  }
  for (let i = 0; i < h.observed.checks.length; i += 2) {
    const a = h.observed.checks[i]!, b = h.observed.checks[i + 1]!;
    assert.ok(a.timeoutSeconds <= LIVE_LOCAL_CHECK_TIMING_POLICY.maximumBatchWallSeconds &&
      a.timeoutSeconds > LIVE_LOCAL_CHECK_TIMING_POLICY.maximumBatchWallSeconds - 1);
    assert.ok(b.timeoutSeconds <= a.timeoutSeconds);
    assert.deepEqual(a.files, b.files); assert.deepEqual(a.cases, b.cases);
  }
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 3); assert.equal(h.ledger.snapshot().heldMicros, '750000');
});

test('worker omission of the thinking override preserves the existing explicit disable option', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(LIVE_PRICING.verifiedAt) });
  let calls = 0;
  for (const disableThinking of [false, true]) {
    const provider = new NebiusRepairProvider({ modelId: LIVE_MODEL, authorized: true, accountVerifiedAt: LIVE_PRICING.verifiedAt,
      inputUsdPerMillionTokens: LIVE_PRICING.inputUsdPerMillionTokens, outputUsdPerMillionTokens: LIVE_PRICING.outputUsdPerMillionTokens,
      maximumOutputTokens: LIVE_PRICING.maximumOutputTokensPerRequest, disableThinking,
      countInputTokens: () => LIVE_PRICING.contextTokens, credential: async () => SECRET,
      fetch: async (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.equal(Object.hasOwn(body, 'chat_template_kwargs'), disableThinking);
        if (disableThinking) assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
        assert.equal(body.max_tokens, 4000); assert.equal(body.max_completion_tokens, 4000);
        return response();
      } });
    await provider.propose({ taskId: fixture.id, description: fixture.description, requirements: fixture.requirements,
      files: fixture.files, editAllowlist: fixture.editAllowlist, visibleCases: fixture.visibleCases, feedback: [],
      attempt: 0, remaining: LIVE_LIMITS }, new AbortController().signal);
  }
  assert.equal(calls, 2);
});

test('completion exhaustion at the unchanged 4000-token cap retains the failed call and full hold', async t => {
  const h = await setup(t);
  h.hooks.fetch = () => response(undefined, { prompt_tokens: 24, completion_tokens: 4000 }, {
    choices: [{ finish_reason: 'length', message: { content: '{"files":' } }],
  });
  const done = await h.run('completion-exhaustion');
  assert.equal(done.reason, 'incomplete_response'); assert.equal(done.candidates.length, 0);
  assert.equal(done.usage.inferenceCalls, 1); assert.equal(done.usage.outputTokens, 4000);
  assert.equal(h.observed.requests.length, 1); assert.equal(h.observed.checks.length, 2);
  assert.equal(h.reservation(done).actualCostMicros, null); assert.equal(h.reservation(done).heldMicros, '250000');
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 1);
});

test('reported per-request input and output overruns cannot become covered exposure', async t => {
  for (const [name, usage] of [['input', { prompt_tokens: 262145, completion_tokens: 32 }], ['output', { prompt_tokens: 24, completion_tokens: 4001 }]] as const) {
    await t.test(name, async sub => {
      const h = await setup(sub); h.hooks.fetch = () => response('def f(): return 2\n', usage);
      const done = await h.run('overrun-' + name); assert.equal(done.reason, 'budget_exceeded');
      assert.equal(h.observed.requests.length, 1); assert.equal(done.candidates.length, 0);
      assert.equal(h.reservation(done).heldMicros, '250000'); assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 0);
      assert.equal(h.ledger.snapshot().frozen, true);
    });
  }
});

test('forged capability, unknown tasks, nondevelopment fixtures and changed source refuse dispatch', async t => {
  const h = await setup(t);
  assert.throws(() => new Coordinator({ fixtures: [fixture], runtimeLock: lock, provider: { mode: 'live', async propose() { throw Error('unreachable'); } },
    journal: h.journal, store: h.store, checks: h.options.checks, liveLocalCapability: { authorized: true } }), /capability/);
  assert.throws(() => createLiveLocalCoordinator({ ...h.options, fixtures: [{ ...fixture, split: 'final' }] }), /development/);
  assert.throws(() => h.coordinator.create({ ...request('unknown-unit'), taskId: 'not-curated' }), /curated/);
  assert.throws(() => createLiveLocalCoordinator({ ...h.options, runtimeLock: { ...lock, liveLocalCheckTimingPolicy: { ...LIVE_LOCAL_CHECK_TIMING_POLICY, maximumBatchWallSeconds: 61 } } }), /timing policy/);
  h.observed.sourceChanged = true; assert.throws(() => h.coordinator.create(request('changed-unit')), /source changed/);
  assert.equal(h.observed.credentials, 0); assert.equal(h.observed.requests.length, 0); assert.equal(h.ledger.snapshot().reservationCount, 0);
});

test('live hard allowances are frozen against mutation after factory construction', async t => {
  const h = await setup(t), before = LIVE_LIMITS.inferenceCallLimit;
  try {
    assert.throws(() => { (LIVE_LIMITS as { inferenceCallLimit: number }).inferenceCallLimit = 9; }, TypeError);
    const done = await h.run('immutable-limits'); assert.equal(done.limits.inferenceCallLimit, 3);
  } finally { if (!Object.isFrozen(LIVE_LIMITS)) (LIVE_LIMITS as { inferenceCallLimit: number }).inferenceCallLimit = before; }
});

test('source drift after baseline prevents credential resolution and dispatch', async t => {
  const h = await setup(t); h.hooks.check = n => { if (n === 2) h.observed.sourceChanged = true; };
  const done = await h.run('source-drift'); assert.equal(done.reason, 'digest_mismatch');
  assert.equal(h.observed.requests.length, 0); assert.equal(h.observed.credentials, 0);
  assert.equal(h.reservation(done).actualCostMicros, '0'); assert.equal(h.reservation(done).heldMicros, '0');
});

test('cancellation after dispatch retains ambiguous hold and single-flight admission', async t => {
  const h = await setup(t); let dispatched!: () => void; const entered = new Promise<void>(resolve => { dispatched = resolve; });
  h.hooks.fetch = init => { dispatched(); return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(Error('invented cancellation')), { once: true })); };
  const { run } = h.coordinator.create(request('cancelled')); assert.throws(() => h.coordinator.create(request('concurrent')), /already active/);
  await entered; h.coordinator.cancel(run.id); await h.coordinator.settled();
  const done = h.coordinator.get(run.id); assert.equal(done.reason, 'cancelled'); assert.equal(done.terminalStatus, 'needs_review');
  assert.equal(h.observed.requests.length, 1); assert.equal(h.reservation(done).heldMicros, '250000'); assert.equal(h.ledger.snapshot().blockingPendingBillingCount, 1);
});

test('actual credential echoes are withheld from candidate, events and accounting receipts', async t => {
  for (const place of ['id', 'header', 'candidate', 'escaped_candidate']) await t.test(place, async sub => {
    const h = await setup(sub);
    const escapedCandidate = JSON.stringify({ files: { 'solution.py': 'def f(): return "' + SECRET + '"\n' }, summary: 'Invented.' }).replace(SECRET, '\\u0049' + SECRET.slice(1));
    h.hooks.fetch = () => place === 'id' ? response(undefined, undefined, { id: SECRET }) : place === 'candidate' ? response('def f(): return "' + SECRET + '"\n') : place === 'escaped_candidate' ?
      response(undefined, undefined, { choices: [{ finish_reason: 'stop', message: { content: escapedCandidate } }] }) :
      new Response(JSON.stringify({ id: 'invented-response', model: LIVE_MODEL, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ files: { 'solution.py': 'def f(): return 2\n' }, summary: 'Invented.' }) } }], usage: { prompt_tokens: 24, completion_tokens: 32 } }), { headers: { 'x-request-id': SECRET } });
    const done = await h.run('secret-' + place);
    assert.ok(!JSON.stringify(done).includes(SECRET));
    for (const file of await readdir(h.accountingDirectory)) assert.ok(!(await readFile(join(h.accountingDirectory, file), 'utf8')).includes(SECRET));
    if (place !== 'header') { assert.equal(done.candidates.length, 0); }
    if (place === 'id' || place === 'candidate') assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 0);
  });
});

test('pricing admission includes the entire 600-second allowance at its exact boundary', async t => {
  for (const [offset, allowed] of [[-1, true], [0, true], [1, false]] as const) {
    await t.test(String(offset), async t => {
      const h = await setup(t);
      t.mock.timers.setTime(Date.parse(LIVE_PRICING.validUntil) - LIVE_LIMITS.wallTimeLimitSeconds * 1000 + offset);
      if (allowed) {
        h.coordinator.create(request('expiry-boundary')); await h.coordinator.settled();
        assert(h.observed.requests.length > 0);
      } else {
        assert.throws(() => h.coordinator.create(request('expiry-after-boundary')), /pricing verification needs refresh/);
        assert.equal(h.observed.credentials, 0); assert.equal(h.observed.requests.length, 0);
      }
    });
  }
});
test('persisted operator pause rejects creation before credentials or spending', async t => {
  const h = await setup(t);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(h.directory, 'budget.sqlite'));
  db.prepare('UPDATE budget_meta SET frozen_reason=? WHERE id=1').run('operator_paused_supervised_only');
  db.close();
  assert.throws(() => h.coordinator.create(request('operator-paused')), /paused/);
  assert.equal(h.observed.credentials, 0); assert.equal(h.observed.requests.length, 0);
});

test('approval expiry must cover the entire run even when pricing remains current', async t => {
  const h = await setup(t);
  const expiresAt = new Date(Date.now() + 599999).toISOString();
  h.ledger.syncApproval({ ...h.budget, ownerApproval: { ...h.budget.ownerApproval, expiresAt } },
    { expectedRevision: h.ledger.snapshot().approvalRevision });
  assert.throws(() => h.coordinator.create(request('approval-window')), /full run must fit/);
  assert.equal(h.observed.credentials, 0); assert.equal(h.observed.requests.length, 0);
});

test('admitted runs retain their original pricing and approval deadline as time advances', async t => {
  for (const kind of ['pricing', 'approval']) await t.test(kind, async t => {
    const h = await setup(t);
    const start = kind === 'pricing' ? Date.parse(LIVE_PRICING.validUntil) - 600000 : Date.now();
    t.mock.timers.setTime(start);
    if (kind === 'approval') h.ledger.syncApproval({ ...h.budget,
      ownerApproval: { ...h.budget.ownerApproval, expiresAt: new Date(start + 600000).toISOString() } },
      { expectedRevision: h.ledger.snapshot().approvalRevision });
    h.hooks.check = n => { if (n === 2) t.mock.timers.setTime(start + 90000); };
    const done = await h.run('elapsed-' + kind);
    assert.equal(done.terminalStatus, 'verified_for_declared_checks');
    assert.equal(h.observed.requests.length, 1);
    for (const file of await readdir(h.accountingDirectory)) {
      const record = JSON.parse(await readFile(join(h.accountingDirectory, file), 'utf8'));
      assert.equal(record.deadlineMs, Date.parse(done.createdAt) + 600000);
    }
  });
});
test('no credentials or dispatch at or beyond the admitted deadline', async t => {
  for (const kind of ['pricing', 'approval']) for (const offset of [0, 1]) await t.test(kind + offset, async t => {
    const h = await setup(t);
    const start = kind === 'pricing' ? Date.parse(LIVE_PRICING.validUntil) - 600000 : Date.now();
    t.mock.timers.setTime(start);
    if (kind === 'approval') h.ledger.syncApproval({ ...h.budget,
      ownerApproval: { ...h.budget.ownerApproval, expiresAt: new Date(start + 600000).toISOString() } },
      { expectedRevision: h.ledger.snapshot().approvalRevision });
    h.hooks.check = n => { if (n === 2) t.mock.timers.setTime(start + 600000 + offset); };
    const done = await h.run('deadline-' + kind + offset);
    assert.notEqual(done.terminalStatus, 'verified_for_declared_checks');
    assert.equal(h.observed.credentials, 0); assert.equal(h.observed.requests.length, 0);
    assert.equal(h.reservation(done).heldMicros, '0');
  });
});

test('approval admission accepts before and exactly at its full-window boundary only', async t => {
  for (const offset of [-1, 0, 1]) await t.test(String(offset), async t => {
    const h = await setup(t), expires = Date.now() + 660000;
    h.ledger.syncApproval({ ...h.budget, ownerApproval: { ...h.budget.ownerApproval,
      expiresAt: new Date(expires).toISOString() } }, { expectedRevision: h.ledger.snapshot().approvalRevision });
    t.mock.timers.setTime(expires - 600000 + offset);
    if (offset > 0) {
      assert.throws(() => h.coordinator.create(request('approval-boundary')), /full run must fit/);
      assert.equal(h.observed.credentials, 0);
    } else assert.equal((await h.run('approval-boundary')).terminalStatus, 'verified_for_declared_checks');
  });
});
test('a late final check cannot publish a verified result after the admitted deadline', async t => {
  const h = await setup(t), start = Date.now();
  h.hooks.check = n => { if (n === 4) t.mock.timers.setTime(start + 600000); };
  const done = await h.run('late-final-check');
  assert.equal(done.reason, 'timeout');
  assert.notEqual(done.terminalStatus, 'verified_for_declared_checks');
  assert.equal(h.observed.requests.length, 1);
  assert.equal(h.reservation(done).heldMicros, '250000');
  const exported = verifyEvidence(await h.coordinator.evidence(done.id)).run;
  const candidate = exported.candidates[0]!;
  assert.equal(candidate.accepted, false); assert.equal(candidate.rejectionReason, 'timeout');
  assert.equal(exported.selectedCandidateId, null);
  assert.deepEqual(candidate.sandboxOperationIds, ['invented-check-3', 'invented-check-4']);
  assert.equal(candidate.visibleChecks.length, 1); assert.equal(candidate.acceptanceChecks.length, 1);
  for (const row of [...candidate.visibleChecks, ...candidate.acceptanceChecks]) {
    assert.equal(row.status, 'pass');
    const observations = JSON.parse(row.log).observations;
    assert.equal(observations.length, 2);
    assert.deepEqual(observations.map((o: { log: string }) => JSON.parse(o.log).lifecycle),
      [['created', 'started', 'cleanup-confirmed'], ['created', 'started', 'cleanup-confirmed']]);
  }
});
test('late baseline preserves observations and cleanup logs without inference', async t => {
  const h = await setup(t), start = Date.now();
  h.hooks.check = n => { if (n === 2) t.mock.timers.setTime(start + 600000); };
  const done = await h.run('late-baseline-evidence');
  assert.equal(done.reason, 'timeout'); assert.equal(h.observed.requests.length, 0);
  assert.equal(h.observed.credentials, 0); assert.equal(h.reservation(done).heldMicros, '0');
  const exported = verifyEvidence(await h.coordinator.evidence(done.id)).run;
  assert.equal(exported.candidates.length, 0);
  assert.deepEqual(exported.sandboxOperationIds, ['invented-check-1', 'invented-check-2']);
  assert.ok(exported.baselineChecks);
  assert.equal(exported.baselineChecks.visible.length, 1); assert.equal(exported.baselineChecks.acceptance.length, 1);
  for (const row of [...exported.baselineChecks.visible, ...exported.baselineChecks.acceptance]) {
    assert.equal(row.status, 'fail');
    assert.equal(JSON.parse(row.log).observations.length, 2);
    assert.match(row.log, /cleanup-confirmed/);
  }
});
test('queue delay consumes the admitted allowance before any check or credential access', async t => {
  const h = await setup(t), start = Date.now();
  const created = h.coordinator.create(request('expired-in-queue'));
  t.mock.timers.setTime(start + 600000);
  await h.coordinator.settled();
  assert.equal(h.coordinator.get(created.run.id).reason, 'timeout');
  assert.equal(h.observed.checks.length, 0); assert.equal(h.observed.credentials, 0);
});


test('renewable evidence admits after legacy expiry and is retained in exported events and accounting', async t => {
  const now = Date.parse('2026-10-18T00:00:00Z');
  const bindings = { sourceDigest: HASH, budgetDigest: HASH, approvalExpiresAt: '2026-12-15T20:00:00Z' };
  const catalog = { data: [{ id: LIVE_MODEL, context_length: 262144, quantization: 'fp4', pricing: { prompt: '0.0000003', completion: '0.0000009', request: '0', image: '0', price_per_video_second: '0', price_per_minute: '0', input_cache_read: null } }] };
  const fee = { schemaVersion: '1.0', verifiedAt: new Date(now).toISOString(), validUntil: new Date(now + 3600_000).toISOString(), evidenceDigest: HASH,
    accountBillingActive: true, additionalFeeUsdPerRun: 0, basis: 'operator-reviewed-account-pricing-and-fees' };
  let state: unknown = { status: 'verified', receipt: makePricingReceipt(catalog, fee, bindings, now) };
  const h = await setup(t, deadline => verifyRenewablePricing(state, bindings, deadline));
  t.mock.timers.setTime(now);
  const done = await h.run('renewable-after-historical-expiry');
  assert.equal(done.terminalStatus, 'verified_for_declared_checks');
  const evidence = verifyEvidence(await h.coordinator.evidence(done.id));
  assert.ok(evidence.run.events.some(event => event.message.startsWith('Pricing verification: ')));
  const files = await readdir(h.accountingDirectory);
  const records = await Promise.all(files.map(file => readFile(join(h.accountingDirectory, file), 'utf8').then(JSON.parse)));
  assert.ok(records.some(record => record.pricingVerifications?.length === 1));
  assert.equal(h.reservation(done).heldMicros, '250000');
  state = { status: 'blocked', checkedAt: new Date(now).toISOString(), reason: 'catalog_unavailable' };
  const before = h.ledger.snapshot();
  assert.throws(() => h.coordinator.create(request('renewable-blocked-next-admission')), /verification/);
  assert.deepEqual(h.ledger.snapshot(), before);
  assert.equal(h.observed.requests.length, 1);
});

test('loss of renewable evidence after baseline prevents credentials and dispatch', async t => {
  let ready = true;
  const h = await setup(t, () => {
    if (!ready) throw new ContractError('authorization_required', 'Synthetic renewal failed.', 403);
    return { digest: HASH, evidence: {} as VerifiedPricing['evidence'] };
  });
  h.hooks.check = () => { ready = false; };
  const done = await h.run('renewal-lost-during-baseline');
  assert.equal(done.terminalStatus, 'infrastructure_error');
  assert.equal(done.reason, 'authorization_required');
  assert.equal(h.observed.credentials, 0); assert.equal(h.observed.requests.length, 0);
  assert.equal(h.reservation(done).actualCostMicros, '0');
});
