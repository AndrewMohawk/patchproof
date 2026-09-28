import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetLedger, BudgetLedgerError } from '../packages/orchestrator/src/budget-ledger.ts';

const NOW = '2026-09-28T02:00:00.000Z';
const H = 'sha256:' + 'a'.repeat(64), E = 'sha256:' + 'b'.repeat(64), J = 'sha256:' + 'c'.repeat(64);
const budget = () => ({ schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 25,
  ownerApproval: { approvedBy: 'synthetic-owner', approvedAt: '2026-09-27T00:00:00.000Z', expiresAt: null, reference: 'invented control' },
  verifiedCredits: [], stages: { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 },
  episodeLimits: { inferenceCallLimit: 24, inputTokenLimit: null, outputTokenLimit: null, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: null, candidateBranchLimit: 3 }, note: 'synthetic' });
const request = (id: string, amountMicros = 100_000, stage = 'smoke') => ({ id, episodeId: 'episode-' + id, stage, amountMicros, fingerprint: H });
const proof = (id: string) => ({ schemaVersion: '1.0', kind: 'closed-token-factory-inference-v1',
  reservationId: id, episodeId: 'episode-' + id, reservationFingerprint: H, stage: 'smoke', reservedMicros: '100000',
  evidenceDigest: E, sourceDigest: H, pricingEvidenceDigest: J, closureEvidenceDigest: H, closedAt: NOW,
  endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions', modelId: 'invented/model',
  inputMicrosPerMillionTokens: '60000', outputMicrosPerMillionTokens: '240000', requestFeeMicros: '0',
  dispatchClosed: true, inventoryComplete: true, otherBillableOperations: 0,
  requests: [{ intentId: id + '-call-1', requestDigest: H, responseDigest: E, usageDigest: J,
    inputTokenCeiling: 262144, outputTokenCeiling: 262144, observedInputTokens: 10, observedOutputTokens: 5 }] });
const code = (expected: string) => (error: unknown) => error instanceof BudgetLedgerError && error.code === expected;
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-covered-inference-')), filename = join(directory, 'ledger.sqlite');
  const connections = new Set<BudgetLedger>();
  const open = (covered = false, existingOnly = false) => {
    const ledger = new BudgetLedger({ filename, budget: budget(), now: () => new Date(NOW), existingOnly,
      pendingBillingPolicy: covered ? 'allow-covered-inference' : 'block-all' });
    connections.add(ledger); return ledger;
  };
  t.after(async () => { for (const ledger of connections) ledger.close(); await rm(directory, { recursive: true, force: true }); });
  const close = (ledger: BudgetLedger) => { ledger.close(); connections.delete(ledger); };
  return { open, close };
}
function pending(ledger: BudgetLedger, id: string, amount = 100_000) {
  ledger.reserve(request(id, amount)); assert.equal(ledger.markAttempted(id).dispatchGranted, true);
  ledger.reconcile({ id, actualCostMicros: null, complete: false, evidenceDigest: E });
}

test('covered unknown inference retains the full existing hold and permits only explicit opted-in continuation', async t => {
  const { open, close } = await setup(t); let ledger = open(); pending(ledger, 'marker');
  assert.throws(() => ledger.coverPendingInference(proof('marker')), code('covered_inference_disabled'));
  close(ledger); ledger = open(true, true);
  const before = ledger.get('marker'), covered = ledger.coverPendingInference(proof('marker'));
  assert.equal(covered.created, true); assert.equal(covered.maximumCostMicros, '78644');
  assert.deepEqual(ledger.get('marker'), before);
  assert.equal(ledger.snapshot().heldMicros, '100000'); assert.equal(ledger.snapshot().chargedMicros, '0');
  assert.equal(ledger.snapshot().pendingBillingCount, 1); assert.equal(ledger.snapshot().coveredPendingBillingCount, 1);
  assert.equal(ledger.snapshot().blockingPendingBillingCount, 0); assert.equal(ledger.snapshot().frozen, false);
  assert.equal(ledger.markAttempted('marker').dispatchGranted, false);
  const events = ledger.events().length; assert.equal(ledger.coverPendingInference(proof('marker')).created, false); assert.equal(ledger.events().length, events);
  assert.throws(() => ledger.coverPendingInference({ ...proof('marker'), sourceDigest: J }), code('inference_coverage_conflict'));
  close(ledger); const strict = open(false, true);
  assert.equal(strict.snapshot().pendingBillingCount, 1); assert.equal(strict.snapshot().blockingPendingBillingCount, 1);
  assert.throws(() => strict.reserve(request('strict')), code('billing_pending'));
  const allowed = open(true, true); pending(allowed, 'repair');
  assert.equal(allowed.snapshot().pendingBillingCount, 2); assert.equal(allowed.snapshot().blockingPendingBillingCount, 1);
  const repair = proof('repair'); repair.requests = Array.from({ length: 3 }, (_, i) => ({ ...repair.requests[0]!, intentId: 'repair-' + i, outputTokenCeiling: 2000 }));
  assert.equal(allowed.coverPendingInference(repair).maximumCostMicros, '48627');
  assert.equal(allowed.snapshot().heldMicros, '200000'); assert.equal(allowed.snapshot().pendingBillingCount, 2);
  assert.equal(allowed.snapshot().coveredPendingBillingCount, 2); assert.equal(allowed.snapshot().frozen, false);
});

test('covered reservations still consume every global and stage microdollar', async t => {
  const { open } = await setup(t), ledger = open(true); pending(ledger, 'marker'); ledger.coverPendingInference(proof('marker'));
  ledger.reserve(request('smoke-rest', 4_900_000)); ledger.reserve(request('pilot-full', 20_000_000, 'pilot'));
  assert.equal(ledger.snapshot().committedMicros, '25000000'); assert.equal(ledger.snapshot().availableMicros, '0');
  assert.throws(() => ledger.reserve(request('over-smoke', 1)), code('budget_exceeded'));
  assert.throws(() => ledger.reserve(request('over-pilot', 1, 'pilot')), code('budget_exceeded'));
  assert.throws(() => ledger.reserve({ ...request('marker'), fingerprint: J }), code('idempotency_conflict'));
  assert.throws(() => ledger.reserve({ ...request('marker'), id: 'same-episode' }), code('episode_already_reserved'));
});

test('coverage rejects unknown, incomplete, mismatched and underfunded inference exposure', async t => {
  const { open } = await setup(t), ledger = open(true); pending(ledger, 'marker');
  const bad: unknown[] = [
    { ...proof('marker'), extra: true }, { ...proof('marker'), dispatchClosed: false },
    { ...proof('marker'), inventoryComplete: false }, { ...proof('marker'), otherBillableOperations: 1 },
    { ...proof('marker'), reservationFingerprint: J }, { ...proof('marker'), episodeId: 'other' },
    { ...proof('marker'), stage: 'pilot' }, { ...proof('marker'), reservedMicros: '99999' },
    { ...proof('marker'), evidenceDigest: J }, { ...proof('marker'), endpoint: 'https://other.invalid/' },
    { ...proof('marker'), closedAt: '2026-09-29T00:00:00.000Z' }, { ...proof('marker'), closedAt: '2026-09-27T00:00:00.000Z' },
    { ...proof('marker'), requests: [] }, { ...proof('marker'), requests: [proof('marker').requests[0], proof('marker').requests[0]] },
    { ...proof('marker'), inputMicrosPerMillionTokens: '-1' },
    { ...proof('marker'), requests: [{ ...proof('marker').requests[0], observedOutputTokens: 262145 }] },
    { ...proof('marker'), outputMicrosPerMillionTokens: '1000000' },
  ];
  const before = ledger.events().length;
  for (const value of bad) assert.throws(() => ledger.coverPendingInference(value));
  assert.equal(ledger.events().length, before); assert.equal(ledger.snapshot().coveredPendingBillingCount, 0);
  assert.throws(() => ledger.reserve(request('still-blocked')), code('billing_pending'));
});

test('billing and receipt updates invalidate coverage without erasing holds or overrun freezes', async t => {
  const { open } = await setup(t), ledger = open(true); pending(ledger, 'marker'); ledger.coverPendingInference(proof('marker'));
  ledger.reconcile({ id: 'marker', actualCostMicros: null, complete: false, evidenceDigest: J });
  assert.equal(ledger.snapshot().coveredPendingBillingCount, 0); assert.equal(ledger.snapshot().heldMicros, '100000');
  assert.throws(() => ledger.coverPendingInference(proof('marker')));
  assert.throws(() => ledger.reserve(request('blocked')), code('billing_pending'));
  ledger.reconcile({ id: 'marker', actualCostMicros: 1000, complete: false, evidenceDigest: J });
  assert.equal(ledger.snapshot().committedMicros, '100000'); assert.equal(ledger.snapshot().heldMicros, '99000');
  assert.throws(() => ledger.coverPendingInference({ ...proof('marker'), evidenceDigest: J }));
  ledger.reconcile({ id: 'marker', actualCostMicros: 100001, complete: true, evidenceDigest: J });
  assert.ok(ledger.snapshot().freezeReasons.includes('reservation_overrun'));
  assert.throws(() => ledger.reserve(request('overrun')), code('reservation_overrun'));
});

test('coverage cannot resurrect undispatched, reconciled, cancelled or stale-approval work', async t => {
  const { open } = await setup(t), ledger = open(true); ledger.reserve(request('marker'));
  ledger.reconcile({ id: 'marker', actualCostMicros: null, complete: false, evidenceDigest: E });
  assert.throws(() => ledger.coverPendingInference(proof('marker')));
  ledger.reconcile({ id: 'marker', actualCostMicros: 0, complete: true, evidenceDigest: E });
  assert.throws(() => ledger.coverPendingInference(proof('marker')));
  pending(ledger, 'closed'); ledger.coverPendingInference(proof('closed')); ledger.cancel('closed');
  assert.equal(ledger.snapshot().coveredPendingBillingCount, 0); assert.equal(ledger.markAttempted('closed').dispatchGranted, false);
  const other = open(true); other.syncApproval({ ...budget(), note: 'next approved configuration' }, { expectedRevision: 1 });
  assert.throws(() => ledger.coverPendingInference(proof('closed')), code('approval_changed'));
});

test('preparing an accounting receipt invalidates coverage even before reconciliation', async t => {
  const { open } = await setup(t), ledger = open(true); pending(ledger, 'marker'); ledger.coverPendingInference(proof('marker'));
  ledger.bindAccountingJournal(H);
  ledger.anchorAccountingReceipt({ journalDigest: H, reservationId: 'marker', revision: 1, receiptDigest: J, previousReceiptDigest: null });
  assert.equal(ledger.snapshot().coveredPendingBillingCount, 0); assert.equal(ledger.snapshot().heldMicros, '100000');
  assert.throws(() => ledger.reserve(request('blocked')), code('billing_pending'));
});

test('first coverage cannot mask a prepared accounting receipt or override reduced approval', async t => {
  const { open } = await setup(t), ledger = open(true); pending(ledger, 'marker');
  ledger.bindAccountingJournal(H);
  ledger.anchorAccountingReceipt({ journalDigest: H, reservationId: 'marker', revision: 1, receiptDigest: J, previousReceiptDigest: null });
  assert.throws(() => ledger.coverPendingInference(proof('marker')), code('inference_coverage_mismatch'));
  assert.equal(ledger.snapshot().heldMicros, '100000');
  ledger.syncApproval({ ...budget(), maxApprovedSpendUsd: 0.05, stages: { smoke: 0.05, pilot: 0, evaluate: 0, hosting: 0 } }, { expectedRevision: 1 });
  assert.ok(ledger.snapshot().freezeReasons.includes('approved_cap_below_commitment'));
  assert.throws(() => ledger.coverPendingInference(proof('marker')), code('approved_cap_below_commitment'));
});
