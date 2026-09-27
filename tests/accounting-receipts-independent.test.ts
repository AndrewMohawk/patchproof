import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BudgetLedger, BudgetLedgerError } from '../packages/orchestrator/src/budget-ledger.ts';
import { AccountingReceiptImporter, AccountingReceiptSchema, accountingReceiptDigest, operationManifestDigest, cleanupObservationDigest } from '../packages/orchestrator/src/accounting-receipts.ts';
import type { AccountingReceipt } from '../packages/orchestrator/src/accounting-receipts.ts';

// Independent metadata controls only: no actual operation, fixture, provider or bill.
const H = 'sha256:' + 'd'.repeat(64), OTHER = 'sha256:' + 'e'.repeat(64);
const CURRENT = '2026-09-27T12:00:00.000Z', EXPIRED = '2026-09-28T12:00:00.000Z';
const budget = () => ({ schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 25,
  ownerApproval: { approvedBy: 'independent synthetic test', approvedAt: '2026-09-27T00:00:00.000Z', expiresAt: null, reference: 'invented accounting only' },
  verifiedCredits: [], stages: { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 },
  episodeLimits: { inferenceCallLimit: 3, inputTokenLimit: 1000, outputTokenLimit: 1000, wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 30, candidateBranchLimit: 3 }, note: 'Invented test ledger.' });
function receipt(): AccountingReceipt {
  const operationManifest = { inventoryComplete: true, operations: [{ intentId: 'invented/intent', operationId: 'invented/operation', status: 'terminal' as const, evidenceDigest: H }] };
  const cleanup = { complete: true, unresolvedIntentIds: [], evidenceDigest: H };
  return AccountingReceiptSchema.parse({ schemaVersion: '1.0', kind: 'episode-accounting-reconciliation', id: 'independent-1', revision: 1,
    previousReceiptDigest: null, expectedLedgerEvidenceDigest: null,
    binding: { reservationId: 'independent-reservation', episodeId: 'independent-episode', reservationFingerprint: H, stage: 'smoke', reservedMicros: '1000000', sourceDigest: H, planDigest: null },
    operationManifest, cleanup, operationDigest: operationManifestDigest(operationManifest), cleanupDigest: cleanupObservationDigest(cleanup),
    observedThroughAt: CURRENT, issuedAt: CURRENT, validUntil: '2026-09-27T13:00:00.000Z', scope: 'entire_episode_including_setup_retries_cleanup',
    billing: { currency: 'USD', cumulativeUsd: '0.1', complete: true, evidenceDigest: H }, cpu: { cumulativeSeconds: 2, complete: true, evidenceDigest: H } });
}
const context = (value: AccountingReceipt) => ({ expectedBinding: value.binding, expectedOperationDigest: value.operationDigest,
  expectedCleanupDigest: value.cleanupDigest, acceptedReceiptDigests: [accountingReceiptDigest(value)] });
const recovery = (value: AccountingReceipt) => ({ expectedReceiptDigest: accountingReceiptDigest(value), acceptedReceiptDigests: [accountingReceiptDigest(value)] });
function next(value: AccountingReceipt): AccountingReceipt {
  return { ...structuredClone(value), id: 'independent-' + (value.revision + 1), revision: value.revision + 1,
    previousReceiptDigest: accountingReceiptDigest(value), expectedLedgerEvidenceDigest: accountingReceiptDigest(value) };
}
function seal(value: AccountingReceipt) { value.operationDigest = operationManifestDigest(value.operationManifest); value.cleanupDigest = cleanupObservationDigest(value.cleanup); return value; }
async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-independent-accounting-')), ledgerFile = join(dir, 'ledger.sqlite'), importerFile = join(dir, 'importer.sqlite');
  const ledgers: BudgetLedger[] = [], importers: AccountingReceiptImporter[] = [];
  const ledger = new BudgetLedger({ filename: ledgerFile, budget: budget(), now: () => new Date(CURRENT) }); ledgers.push(ledger);
  ledger.reserve({ id: 'independent-reservation', episodeId: 'independent-episode', stage: 'smoke', amountMicros: 1000000, fingerprint: H }); ledger.markAttempted('independent-reservation');
  const open = (accounting = ledger, now = CURRENT, filename = importerFile) => { const importer = new AccountingReceiptImporter({ filename, ledger: accounting, now: () => new Date(now) }); importers.push(importer); return importer; };
  const seed = (value: AccountingReceipt) => { const db = new DatabaseSync(importerFile); try {
    db.prepare('INSERT INTO accounting_receipts(id,digest,reservation_id,revision,body_json,status,prepared_at) VALUES(?,?,?,?,?,?,?)')
      .run(value.id, accountingReceiptDigest(value), value.binding.reservationId, value.revision, JSON.stringify(value), 'prepared', CURRENT);
  } finally { db.close(); } };
  t.after(async () => { for (const importer of importers) importer.close(); for (const accounting of ledgers) accounting.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, ledgerFile, importerFile, ledger, ledgers, open, seed, importers };
}

test('independent: expired prepared recovery fences the old writer and permits only a reviewed next revision', async t => {
  const s = await setup(t), importer = s.open(s.ledger, EXPIRED), value = receipt(); s.seed(value);
  assert.throws(() => importer.import(value, context(value)), /expired/);
  const result = importer.recoverExpiredPrepared(value.id, recovery(value));
  assert.equal(result.status, 'rejected'); assert.equal(result.reservation.heldMicros, '1000000');
  assert.throws(() => s.ledger.reconcile({ id: value.binding.reservationId, actualCostMicros: 100000, complete: true, evidenceDigest: accountingReceiptDigest(value), expectedEvidenceDigest: null }), /evidence changed/);
  const revised = next(value); revised.expectedLedgerEvidenceDigest = result.reservation.evidenceDigest;
  revised.observedThroughAt = EXPIRED; revised.issuedAt = EXPIRED; revised.validUntil = '2026-09-28T13:00:00.000Z';
  assert.equal(importer.import(revised, context(revised)).status, 'applied'); assert.equal(s.ledger.snapshot().heldMicros, '0');
});

test('independent: expired recovery cannot tombstone a newer receipt that wins during its CAS retry', async t => {
  const s = await setup(t), old = receipt(), newer = next(old); newer.billing.cumulativeUsd = '0.2'; newer.cpu.cumulativeSeconds = 3;
  const writer = s.open();
  let raced = false;
  class RaceLedger extends BudgetLedger {
    override reconcile(value: unknown) {
      if (!raced) { raced = true; writer.import(old, context(old)); writer.import(newer, context(newer)); }
      return super.reconcile(value);
    }
  }
  const ledger = new RaceLedger({ filename: s.ledgerFile, budget: budget(), now: () => new Date(CURRENT) }); s.ledgers.push(ledger);
  const recoveryImporter = s.open(ledger, EXPIRED); s.seed(old);
  try {
    const result = recoveryImporter.recoverExpiredPrepared(old.id, recovery(old));
    assert.ok(['applied', 'already_applied'].includes(result.status));
  } catch (error) {
    assert.ok(error instanceof BudgetLedgerError && error.code === 'accounting_history_conflict', 'a newer revision may conservatively fence the old recovery');
  }
  assert.equal(s.ledger.get(old.binding.reservationId).evidenceDigest, accountingReceiptDigest(newer));
  assert.equal(s.ledger.get(old.binding.reservationId).actualCostMicros, '200000');
  assert.equal(s.ledger.get(old.binding.reservationId).heldMicros, '0');
  assert.deepEqual(writer.history(old.binding.reservationId).map(row => row.status), ['applied', 'applied']);
});

test('independent: missing durable receipt history stops reconciliation before changing money', async t => {
  const s = await setup(t), importer = s.open(), value = receipt();
  importer.import(value, context(value));
  const newer = next(value); newer.cpu.cumulativeSeconds = 20; importer.import(newer, context(newer));
  // A copied journal with its newer rows omitted models a stale operator restore.
  const copied = join(s.dir, 'stale.sqlite');
  const db = new DatabaseSync(s.importerFile); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();
  await copyFile(s.importerFile, copied);
  const staleDb = new DatabaseSync(copied); staleDb.prepare('DELETE FROM accounting_receipts WHERE revision>1').run(); staleDb.close();
  const stale = s.open(s.ledger, CURRENT, copied), regressed = next(value); regressed.cpu.cumulativeSeconds = 3;
  regressed.expectedLedgerEvidenceDigest = accountingReceiptDigest(newer);
  const before = s.ledger.get(value.binding.reservationId);
  assert.throws(() => stale.import(regressed, context(regressed)), error => error instanceof BudgetLedgerError && error.code === 'accounting_history_conflict');
  assert.deepEqual(s.ledger.get(value.binding.reservationId), before);
});

test('independent: a different ledger or fresh importer cannot reuse the matched journal identity', async t => {
  const s = await setup(t), importer = s.open(), value = receipt(); importer.import(value, context(value));
  assert.throws(() => s.open(s.ledger, CURRENT, join(s.dir, 'fresh.sqlite')), /identity mismatch/);
  const other = new BudgetLedger({ filename: join(s.dir, 'other-ledger.sqlite'), budget: budget(), now: () => new Date(CURRENT) }); s.ledgers.push(other);
  other.reserve({ id: value.binding.reservationId, episodeId: 'different', stage: 'smoke', amountMicros: 1000000, fingerprint: OTHER });
  assert.throws(() => s.open(other), /different ledger/); assert.equal(other.snapshot().chargedMicros, '0');
});

test('independent: a lost intent cannot disappear when complete billing arrives', async t => {
  const s = await setup(t), importer = s.open(), value = receipt();
  value.cleanup = { complete: false, unresolvedIntentIds: ['invented/lost'], evidenceDigest: null }; seal(value);
  importer.import(value, context(value)); assert.equal(s.ledger.snapshot().heldMicros, '900000');
  const forgotten = next(value); forgotten.cleanup = receipt().cleanup; seal(forgotten);
  assert.throws(() => importer.import(forgotten, context(forgotten)), /Unresolved intent disappeared/);
  const resolved = next(value); resolved.cleanup = receipt().cleanup;
  resolved.operationManifest.operations.push({ intentId: 'invented/lost', operationId: null, status: 'confirmed_not_created', evidenceDigest: OTHER }); seal(resolved);
  importer.import(resolved, context(resolved)); assert.equal(s.ledger.snapshot().heldMicros, '0');
});

test('independent: incomplete CPU retains the hold and cumulative precision cannot regress', async t => {
  const s = await setup(t), importer = s.open(), value = receipt(); value.billing.cumulativeUsd = '0.0000009'; value.cpu.complete = false;
  importer.import(value, context(value)); assert.equal(s.ledger.snapshot().chargedMicros, '1'); assert.equal(s.ledger.snapshot().heldMicros, '999999');
  const money = next(value); money.billing.cumulativeUsd = '0.0000008'; assert.throws(() => importer.import(money, context(money)), /Cumulative USD/);
  const cpu = next(value); cpu.cpu.cumulativeSeconds = 1; assert.throws(() => importer.import(cpu, context(cpu)), /Cumulative CPU/);
  const complete = next(value); complete.cpu.complete = true; importer.import(complete, context(complete));
  assert.equal(s.ledger.snapshot().heldMicros, '0'); assert.equal(s.ledger.markAttempted(value.binding.reservationId).dispatchGranted, false);
});
