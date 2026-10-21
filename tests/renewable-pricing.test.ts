import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, chmodSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { makePricingReceipt, verifyRenewablePricing, verifyCatalogRecord, RENEWABLE_PRICING_POLICY } from '../packages/orchestrator/src/renewable-pricing.ts';
import { publishPricingState, readBoundedCatalog, verifyLivePricingOnce } from '../scripts/verify-live-pricing.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { LIVE_LIMITS, LIVE_MODEL, LIVE_PRICING } from '../packages/orchestrator/src/live-local.ts';
const hash = 'sha256:' + 'a'.repeat(64), now = Date.parse('2026-10-18T12:00:00Z');
const bindings = { sourceDigest: hash, budgetDigest: hash, approvalExpiresAt: '2026-12-15T20:00:00Z' };
const catalog = () => ({ data: [{ id: LIVE_MODEL, context_length: 262144, quantization: 'fp4', pricing: {
  prompt: '0.0000003', completion: '0.0000009', request: '0', image: '0', price_per_video_second: '0', price_per_minute: '0', input_cache_read: null } }] });
const fees = () => ({ schemaVersion: '1.0', verifiedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 3_600_000).toISOString(),
  evidenceDigest: hash, accountBillingActive: true, additionalFeeUsdPerRun: 0, basis: 'operator-reviewed-account-pricing-and-fees' });
const state = () => ({ status: 'verified', receipt: makePricingReceipt(catalog(), fees(), bindings, now) });

test('renewable rates preserve the unchanged worst-case reservation and resource limits', () => {
  assert.equal(RENEWABLE_PRICING_POLICY.modelId, LIVE_MODEL);
  assert.equal(RENEWABLE_PRICING_POLICY.inputUsdPerMillionTokens, LIVE_PRICING.inputUsdPerMillionTokens);
  assert.equal(RENEWABLE_PRICING_POLICY.outputUsdPerMillionTokens, LIVE_PRICING.outputUsdPerMillionTokens);
  assert.equal(RENEWABLE_PRICING_POLICY.perRunReservationUsd, LIVE_LIMITS.maxApprovedSpendUsd);
  assert.equal(3 * 262144 * 0.3 / 1e6 + 12000 * 0.9 / 1e6, 0.2467296);
});
test('fresh evidence works after the historical receipt expired, with exact full-run boundaries', () => {
  const s = state(), end = Date.parse(s.receipt.validUntil);
  assert.equal(verifyRenewablePricing(s, bindings, end, now).digest, digestJson(s.receipt));
  assert.throws(() => verifyRenewablePricing(s, bindings, end + 1, now));
  assert.throws(() => verifyRenewablePricing(s, bindings, end + 600_000, end));
  assert.throws(() => verifyRenewablePricing(s, bindings, now, now));
});
test('missing, blocked, stale, future, oversized-age and mismatched evidence fail closed', () => {
  for (const value of [null, {}, { status: 'blocked', checkedAt: new Date(now).toISOString(), reason: 'catalog_unavailable' }])
    assert.throws(() => verifyRenewablePricing(value, bindings, now + 600_000, now));
  for (const mutate of [
    (s: any) => { s.receipt.sourceDigest = 'sha256:' + 'b'.repeat(64); },
    (s: any) => { s.receipt.budgetDigest = 'sha256:' + 'b'.repeat(64); },
    (s: any) => { s.receipt.policyDigest = 'sha256:' + 'b'.repeat(64); },
    (s: any) => { s.receipt.verifiedAt = new Date(now + 1).toISOString(); },
    (s: any) => { s.receipt.validUntil = new Date(now + 70 * 60_000 + 1).toISOString(); },
    (s: any) => { s.receipt.feeEvidence.verifiedAt = new Date(now - 25 * 3_600_000).toISOString(); },
    (s: any) => { s.receipt.feeEvidence.validUntil = new Date(now + 599_999).toISOString(); },
    (s: any) => { s.receipt.feeEvidence.additionalFeeUsdPerRun = 0.01; },
    (s: any) => { s.receipt.feeEvidence.accountBillingActive = false; },
    (s: any) => { s.receipt.outputUsdPerMillionTokens = 0.91; },
  ]) { const s = state(); mutate(s); assert.throws(() => verifyRenewablePricing(s, bindings, now + 600_000, now)); }
});
test('approval expiry bounds renewal and admission, and fees can never be renewed by catalog success', () => {
  const bound = { ...bindings, approvalExpiresAt: new Date(now + 600_000).toISOString() };
  const receipt = makePricingReceipt(catalog(), fees(), bound, now);
  assert.equal(receipt.validUntil, bound.approvalExpiresAt);
  assert.throws(() => makePricingReceipt(catalog(), fees(), { ...bound, approvalExpiresAt: new Date(now + 599_999).toISOString() }, now));
  const fee = fees(), a = makePricingReceipt(catalog(), fee, bindings, now), b = makePricingReceipt(catalog(), fee, bindings, now + 1000);
  assert.deepEqual(a.feeEvidence, b.feeEvidence);
  assert.throws(() => makePricingReceipt(catalog(), fee, bindings, Date.parse(fee.validUntil) - 599_999));
});
test('catalog price, context, quantization, duplicates, additional fees and malformed prices are rejected', () => {
  verifyCatalogRecord(catalog());
  for (const mutate of [
    (c: any) => { c.data[0].pricing.prompt = '0.00000031'; },
    (c: any) => { c.data[0].pricing.request = '0.01'; },
    (c: any) => { c.data[0].pricing.new_fee = '0'; },
    (c: any) => { c.data[0].pricing.request = ''; },
    (c: any) => { delete c.data[0].pricing.request; },
    (c: any) => { c.data[0].context_length = 131072; },
    (c: any) => { c.data[0].quantization = 'fp8'; },
    (c: any) => { c.data.push(c.data[0]); },
  ]) { const c = catalog(); mutate(c); assert.throws(() => verifyCatalogRecord(c)); }
});
test('only null or the reviewed cache price is accepted without discounting the reservation', () => {
  for (const cachePrice of [null, '0.00000006', 0.00000006]) {
    const c: any = catalog(); c.data[0].pricing.input_cache_read = cachePrice;
    const receipt = makePricingReceipt(c, fees(), bindings, now);
    assert.equal(receipt.catalogDigest, digestJson(c.data[0]));
    assert.equal(receipt.inputUsdPerMillionTokens, 0.3);
    assert.equal(receipt.outputUsdPerMillionTokens, 0.9);
    assert.equal(receipt.requestFeeUsd, 0);
    assert.equal(3 * 262144 * receipt.inputUsdPerMillionTokens / 1e6 + 12000 * receipt.outputUsdPerMillionTokens / 1e6, 0.2467296);
    assert.equal(RENEWABLE_PRICING_POLICY.perRunReservationUsd, 0.25);
  }
});
test('cache compatibility rejects malformed, absent and unreviewed cache values', () => {
  for (const value of [undefined, '', ' ', '6e-8', 'NaN', NaN, Infinity, -1, false, {}, [], 0, '0', '0.00000005', '0.00000007', '0.0000003']) {
    const c: any = catalog(); c.data[0].pricing.input_cache_read = value;
    assert.throws(() => verifyCatalogRecord(c), String(value));
  }
  const c: any = catalog(); delete c.data[0].pricing.input_cache_read;
  assert.throws(() => verifyCatalogRecord(c));
});
test('accepted cache pricing does not relax other model, price or fee checks', () => {
  for (const mutate of [
    (c: any) => { c.data[0].pricing.prompt = '0.00000031'; },
    (c: any) => { c.data[0].pricing.completion = '0.00000091'; },
    (c: any) => { c.data[0].pricing.request = '0.000001'; },
    (c: any) => { c.data[0].pricing.image = '0.01'; },
    (c: any) => { c.data[0].pricing.new_fee = '0'; },
    (c: any) => { delete c.data[0].pricing.prompt; },
    (c: any) => { c.data[0].context_length = 131072; },
    (c: any) => { c.data[0].quantization = 'fp8'; },
    (c: any) => { c.data[0].id = 'unreviewed-model'; },
    (c: any) => { c.data.push(c.data[0]); },
  ]) {
    const c: any = catalog(); c.data[0].pricing.input_cache_read = '0.00000006'; mutate(c);
    assert.throws(() => verifyCatalogRecord(c));
  }
});
test('atomic state replacement preserves immutable receipts, blocks after failure and rejects symlinks', t => {
  const dir = mkdtempSync(join(tmpdir(), 'patchproof-renewal-')); chmodSync(dir, 0o700);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'current.json'), s = state() as any;
  publishPricingState(path, s, process.cwd());
  assert.equal(verifyRenewablePricing(JSON.parse(readFileSync(path, 'utf8')), bindings, now + 600_000, now).digest, digestJson(s.receipt));
  publishPricingState(path, { status: 'blocked', checkedAt: new Date(now).toISOString(), reason: 'catalog_unavailable' }, process.cwd());
  assert.throws(() => verifyRenewablePricing(JSON.parse(readFileSync(path, 'utf8')), bindings, now + 600_000, now));
  assert.equal(readdirSync(dir).filter(x => x.startsWith('pricing-state-')).length, 2);
  const link = join(dir, 'link.json'); symlinkSync(path, link);
  assert.throws(() => publishPricingState(link, s, process.cwd()));
});
test('catalog fetch is read-only, bounded, refuses redirects and never retries failures', async () => {
  let calls = 0;
  const fetcher = (async (url: any, init: any) => { calls++; assert.equal(url, RENEWABLE_PRICING_POLICY.catalogEndpoint);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); return Response.json(catalog()); }) as typeof fetch;
  assert.deepEqual(await readBoundedCatalog(fetcher, 'synthetic-test-key', new AbortController().signal), catalog()); assert.equal(calls, 1);
  await assert.rejects(readBoundedCatalog((async () => new Response('error', { status: 503 })) as typeof fetch, 'synthetic', new AbortController().signal));
  await assert.rejects(readBoundedCatalog((async () => new Response('x'.repeat(1_048_577))) as typeof fetch, 'synthetic', new AbortController().signal));
});


test('full verifier serializes writers, publishes failure immediately, and expired fees prevent network access', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'patchproof-monitor-')); chmodSync(dir, 0o700);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = new URL('../', import.meta.url), projectRoot = root.pathname;
  const stateFile = join(dir, 'current.json'), feeFile = join(dir, 'fees.json'), configFile = join(dir, 'config.json');
  const current = Date.now(), fee = { ...fees(), verifiedAt: new Date(current - 1000).toISOString(), validUntil: new Date(current + 3600_000).toISOString() };
  const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  write(feeFile, fee); write(join(dir, 'key.json'), { token: 'synthetic-local-monitor-key' });
  const config = { schemaVersion: '1.0', executionAuthorized: true, publicHostingAuthorized: true,
    stateDirectory: dir, ledgerFile: join(dir, 'ledger.sqlite'), modelCredentialFile: join(dir, 'key.json'), socketFile: join(dir, 'api.sock'),
    sourceDigest: digestJson(buildOperationalLock(projectRoot)), pricingEvidenceDigest: hash, taskIds: ['synthetic-unit'],
    allowedHosts: ['patchproof.andrewmohawk.xyz'], pricingVerification: { stateFile, feeEvidenceFile: feeFile } };
  write(configFile, config);
  let releaseFetch!: () => void, started!: () => void, calls = 0;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { releaseFetch = resolve; });
  const first = verifyLivePricingOnce(root, configFile, (async () => { calls++; started(); await wait; return Response.json(catalog()); }) as typeof fetch);
  await entered;
  await assert.rejects(verifyLivePricingOnce(root, configFile, (async () => { calls++; return Response.json(catalog()); }) as typeof fetch), /already running/);
  releaseFetch(); assert.equal((await first).status, 'verified'); assert.equal(calls, 1);
  const failed = await verifyLivePricingOnce(root, configFile, (async () => { throw Error('synthetic transport failure'); }) as typeof fetch);
  assert.equal(failed.status, 'blocked'); assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).reason, 'catalog_unavailable');
  write(feeFile, { ...fee, validUntil: new Date(current - 1).toISOString() });
  const expired = await verifyLivePricingOnce(root, configFile, (async () => { calls++; throw Error('must not fetch'); }) as typeof fetch);
  assert.equal(expired.status, 'blocked'); assert.equal(calls, 1);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).reason, 'fee_evidence_invalid');
});


test('the approved shared purpose reallocates the same total without releasing holds or clearing pause', t => {
  const dir = mkdtempSync(join(tmpdir(), 'patchproof-shared-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const approved = JSON.parse(readFileSync(new URL('../budget.json', import.meta.url), 'utf8'));
  const previous = { ...approved, stages: { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 } };
  const ledger = new BudgetLedger({ filename: join(dir, 'budget.sqlite'), budget: previous });
  try {
    ledger.reserve({ id: 'historical-synthetic', episodeId: 'historical-synthetic', stage: 'smoke', amountMicros: 1_600_000n, fingerprint: hash });
    ledger.pauseOperator(hash); const reservation = ledger.get('historical-synthetic'), before = ledger.snapshot();
    const after = ledger.syncApproval(approved, { expectedRevision: before.approvalRevision });
    assert.equal(after.approvedMicros, '25000000'); assert.equal(after.heldMicros, '1600000');
    assert.equal(after.stages.smoke.availableMicros, '23400000'); assert.equal(after.stages.pilot.approvedMicros, '0');
    assert.deepEqual(ledger.get('historical-synthetic'), reservation);
    assert.ok(after.freezeReasons.includes('operator_paused_supervised_only'));
    assert.equal(after.approvalExpiresAt, before.approvalExpiresAt);
  } finally { ledger.close(); }
});
