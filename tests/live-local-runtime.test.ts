import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { CheckRunner, ProductRun } from '../packages/contracts/src/product.ts';
import { ContractError } from '../packages/contracts/src/index.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore, verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { createLiveLocalCoordinator, LIVE_EXECUTION, LIVE_LIMITS, LIVE_MODEL } from '../packages/orchestrator/src/live-local.ts';
import { LIVE_LOCAL_CHECK_TIMING_POLICY } from '../packages/orchestrator/src/local-check-timing.ts';
import { REPEATED_CHECK_PROTOCOL } from '../packages/orchestrator/src/repeated-checks.ts';

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

async function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-28T03:00:00Z') });
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
      actual: pass ? 2 : 1, expected: 2, durationMs: 0, log: 'Invented observation; no interpreter.', message: 'Invented check.' })),
      isolation: 'local_container', operationIds: [id], cpuSeconds: null, measuredCostUsd: 0, infrastructureError: null };
  } };
  const options = { fixtures: [fixture], runtimeLock: lock, sourceDigest: HASH, pricingEvidenceDigest: HASH, ledger, journal, store, checks,
    accountingDirectory, verifyRuntime: () => { if (observed.sourceChanged) throw new ContractError('digest_mismatch', 'Invented source changed.'); },
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
  return { directory, accountingDirectory, ledger, journal, store, options, coordinator, observed, hooks, run, reservation };
}

test('real adapter success keeps unknown billed cost and full hold, then permits covered continuation', async t => {
  const h = await setup(t), first = await h.run('success-1');
  assert.equal(first.mode, 'live'); assert.equal(first.terminalStatus, 'verified_for_declared_checks');
  assert.equal(first.reason, 'declared_local_checks_passed'); assert.equal(first.usage.inferenceCalls, 1);
  assert.equal(first.usage.sandboxCpuSeconds, null); assert.equal(first.usage.costIsEstimate, true);
  assert.equal(first.usage.measuredCostUsd, (24 * .06 + 32 * .24) / 1_000_000);
  assert.equal(h.reservation(first).actualCostMicros, null); assert.equal(h.reservation(first).heldMicros, '100000');
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 1); assert.equal(h.ledger.snapshot().frozen, false);
  const bundle = verifyEvidence(await h.coordinator.evidence(first.id)); assert.equal(bundle.run.id, first.id); assert.deepEqual(bundle.runtimeLock, lock);
  const second = await h.run('success-2'); assert.equal(second.terminalStatus, 'verified_for_declared_checks');
  assert.equal(h.ledger.snapshot().heldMicros, '200000'); assert.equal(h.ledger.snapshot().pendingBillingCount, 2);
  assert.equal(h.coordinator.create(request('success-1')).reused, true); assert.equal(h.observed.requests.length, 2);
});

test('ambiguous transport leaves full hold blocking and never retries automatically', async t => {
  const h = await setup(t); h.hooks.fetch = () => { throw new Error('invented transport uncertainty'); };
  const done = await h.run('ambiguous'); assert.equal(done.reason, 'transport_error'); assert.equal(done.usage.inferenceCalls, 1);
  assert.equal(h.observed.requests.length, 1); assert.equal(h.reservation(done).actualCostMicros, null); assert.equal(h.reservation(done).heldMicros, '100000');
  assert.equal(h.ledger.snapshot().blockingPendingBillingCount, 1); assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 0);
  assert.throws(() => h.coordinator.create(request('must-block')), /paused|accounting/); assert.equal(h.observed.requests.length, 1);
});

test('all variants share exact limits, repeated-check cap and no more than three bounded requests', async t => {
  const h = await setup(t); h.hooks.alwaysFail = true;
  for (const variant of ['baseline', 'checks_only', 'patchproof']) {
    const done = await h.run('variant-' + variant, variant); assert.equal(done.terminalStatus, 'failed');
    assert.deepEqual(done.limits, LIVE_LIMITS); assert.equal(done.usage.inferenceCalls, 3); assert.equal(done.candidates.length, 3);
  }
  assert.equal(h.observed.requests.length, 9); assert.equal(h.observed.checks.length, 24);
  for (const call of h.observed.requests) {
    assert.equal(call.body.model, LIVE_MODEL); assert.equal(call.body.max_tokens, 2000); assert.equal(call.body.max_completion_tokens, 2000);
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
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 3); assert.equal(h.ledger.snapshot().heldMicros, '300000');
});

test('reported per-request input and output overruns cannot become covered exposure', async t => {
  for (const [name, usage] of [['input', { prompt_tokens: 262145, completion_tokens: 32 }], ['output', { prompt_tokens: 24, completion_tokens: 2001 }]] as const) {
    await t.test(name, async sub => {
      const h = await setup(sub); h.hooks.fetch = () => response('def f(): return 2\n', usage);
      const done = await h.run('overrun-' + name); assert.equal(done.reason, 'budget_exceeded');
      assert.equal(h.observed.requests.length, 1); assert.equal(done.candidates.length, 0);
      assert.equal(h.reservation(done).heldMicros, '100000'); assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 0);
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
  assert.equal(h.observed.requests.length, 1); assert.equal(h.reservation(done).heldMicros, '100000'); assert.equal(h.ledger.snapshot().blockingPendingBillingCount, 1);
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
