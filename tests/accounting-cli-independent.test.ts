import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountingOperatorConfigSchema, AccountingOperatorContextSchema, runAccountingOperator } from '../scripts/accounting-cli.ts';
import { operatorJsonDigest } from '../scripts/operator-files.ts';
import { BudgetSchema } from '../scripts/config.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { AccountingReceiptSchema, accountingReceiptDigest, cleanupObservationDigest, operationManifestDigest } from '../packages/orchestrator/src/accounting-receipts.ts';

// Invented metadata and private temporary databases only; no runtime or external calls.
const H = 'sha256:' + '1'.repeat(64), J = 'sha256:' + '2'.repeat(64), K = 'sha256:' + '3'.repeat(64);
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value) + '\n', { mode: 0o600 });
function setup(t: TestContext, expiredApproval = false) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-operator-independent-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const projectRoot = join(directory, 'project'); mkdirSync(projectRoot, { mode: 0o700 });
  const now = Date.now(), approvedAt = new Date(now - 7_200_000).toISOString();
  const budget = BudgetSchema.parse({ schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 25,
    ownerApproval: { approvedBy: 'invented-operator', approvedAt, expiresAt: expiredApproval ? new Date(now - 3_600_000).toISOString() : null, reference: 'invented-approval' },
    verifiedCredits: [], stages: { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 },
    episodeLimits: { inferenceCallLimit: 24, inputTokenLimit: null, outputTokenLimit: null, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: null, candidateBranchLimit: 3 }, note: 'independent metadata-only control' });
  const config = AccountingOperatorConfigSchema.parse({ schemaVersion: '1.0', kind: 'patchproof-accounting-operator',
    budgetPath: join(directory, 'budget.json'), expectedBudgetDigest: operatorJsonDigest(budget),
    ledgerPath: join(directory, 'ledger.db'), journalPath: join(directory, 'receipts.db') });
  const ledger = new BudgetLedger({ filename: config.ledgerPath, budget, now: () => new Date(now - 5_400_000) });
  ledger.reserve({ id: 'invented-reservation', episodeId: 'invented-episode', stage: 'pilot', amountMicros: 1_000_000, fingerprint: H });
  assert.equal(ledger.markAttempted('invented-reservation').dispatchGranted, true); ledger.close();
  const operationManifest = { inventoryComplete: true, operations: [{ intentId: 'invented-intent', operationId: 'invented-operation', status: 'terminal', evidenceDigest: H }] };
  const cleanup = { complete: true, unresolvedIntentIds: [], evidenceDigest: J };
  const receipt = AccountingReceiptSchema.parse({ schemaVersion: '1.0', kind: 'episode-accounting-reconciliation', id: 'invented-receipt-1', revision: 1,
    previousReceiptDigest: null, expectedLedgerEvidenceDigest: null,
    binding: { reservationId: 'invented-reservation', episodeId: 'invented-episode', reservationFingerprint: H, stage: 'pilot', reservedMicros: '1000000', sourceDigest: J, planDigest: K },
    operationManifest, operationDigest: operationManifestDigest(operationManifest), cleanup, cleanupDigest: cleanupObservationDigest(cleanup),
    observedThroughAt: new Date(now - 1_800_000).toISOString(), issuedAt: new Date(now - 900_000).toISOString(), validUntil: new Date(now + 3_600_000).toISOString(),
    scope: 'entire_episode_including_setup_retries_cleanup', billing: { currency: 'USD', cumulativeUsd: '0.1', complete: true, evidenceDigest: H },
    cpu: { cumulativeSeconds: 3, complete: true, evidenceDigest: J } });
  const context = AccountingOperatorContextSchema.parse({ expectedBinding: receipt.binding, expectedOperationDigest: receipt.operationDigest,
    expectedCleanupDigest: receipt.cleanupDigest, acceptedReceiptDigests: [accountingReceiptDigest(receipt)] });
  const paths = { config: join(directory, 'config.json'), receipt: join(directory, 'receipt.json'), context: join(directory, 'context.json') };
  const persist = () => { save(config.budgetPath, budget); save(paths.config, config); save(paths.receipt, receipt); save(paths.context, context); };
  persist();
  const args = () => ['import', paths.config, paths.receipt, paths.context, operatorJsonDigest(context)];
  const inspect = () => {
    const reader = new BudgetLedger({ filename: config.ledgerPath, budget });
    try { return { reservation: reader.get('invented-reservation'), snapshot: reader.snapshot(), retry: reader.markAttempted('invented-reservation') }; }
    finally { reader.close(); }
  };
  return { directory, projectRoot, config, budget, receipt, context, paths, args, persist, inspect };
}

test('expired unchanged approval permits recording incurred costs without renewing approval or dispatch', t => {
  const s = setup(t, true), before = s.inspect();
  assert.ok(before.snapshot.freezeReasons.includes('approval_expired'));
  const result = runAccountingOperator(s.args(), s.projectRoot);
  assert.equal(result.exitCode, 0); assert.equal(result.output.status, 'applied');
  assert.equal(result.output.executionPerformed, false); assert.equal(result.output.dispatchGranted, false);
  const after = s.inspect();
  assert.equal(after.reservation.actualCostMicros, '100000'); assert.equal(after.reservation.heldMicros, '0');
  assert.equal(after.snapshot.approvalDigest, before.snapshot.approvalDigest);
  assert.equal(after.snapshot.approvalRevision, before.snapshot.approvalRevision);
  assert.equal(after.snapshot.approvalExpiresAt, before.snapshot.approvalExpiresAt);
  assert.ok(after.snapshot.freezeReasons.includes('approval_expired')); assert.equal(after.retry.dispatchGranted, false);
});

test('historical receipt duplicate reports its old CPU separately from newer durable charges', t => {
  const s = setup(t), oldReceipt = structuredClone(s.receipt), oldContext = structuredClone(s.context);
  const originalDigest = accountingReceiptDigest(oldReceipt);
  assert.equal(runAccountingOperator(s.args(), s.projectRoot).exitCode, 0);
  s.receipt.id = 'invented-receipt-2'; s.receipt.revision = 2;
  s.receipt.previousReceiptDigest = originalDigest; s.receipt.expectedLedgerEvidenceDigest = s.inspect().reservation.evidenceDigest;
  s.receipt.billing.cumulativeUsd = '0.2'; s.receipt.cpu.cumulativeSeconds = 7;
  s.context.acceptedReceiptDigests = [accountingReceiptDigest(s.receipt)]; s.persist();
  assert.equal(runAccountingOperator(s.args(), s.projectRoot).exitCode, 0);
  const latest = s.inspect().reservation;
  save(s.paths.receipt, oldReceipt); save(s.paths.context, oldContext);
  const result = runAccountingOperator(['import', s.paths.config, s.paths.receipt, s.paths.context, operatorJsonDigest(oldContext)], s.projectRoot);
  assert.equal(result.exitCode, 0); assert.equal(result.output.status, 'already_applied');
  const output = result.output as unknown as { receiptRevision: number; receiptCpuSeconds: number; receiptValuesAreHistorical: boolean; currentReservation: { actualCostMicros: string; evidenceDigest: string } };
  assert.equal(output.receiptRevision, 1); assert.equal(output.receiptCpuSeconds, 3); assert.equal(output.receiptValuesAreHistorical, true);
  assert.equal(output.currentReservation.actualCostMicros, '200000'); assert.equal(output.currentReservation.evidenceDigest, latest.evidenceDigest);
  assert.deepEqual(s.inspect().reservation, latest);
});

test('cross-reservation receipt/context pair cannot initialize a journal or alter the existing hold', t => {
  const s = setup(t), before = s.inspect().reservation;
  s.receipt.binding.reservationId = 'invented-absent-reservation'; s.context.expectedBinding = s.receipt.binding;
  s.context.acceptedReceiptDigests = [accountingReceiptDigest(s.receipt)]; s.persist();
  const result = runAccountingOperator(s.args(), s.projectRoot);
  assert.equal(result.exitCode, 2); assert.equal(existsSync(s.config.journalPath), false);
  assert.deepEqual(s.inspect().reservation, before);
});

test('a fresh journal path cannot reset the applied history for an existing ledger', t => {
  const s = setup(t); assert.equal(runAccountingOperator(s.args(), s.projectRoot).exitCode, 0);
  const before = s.inspect().reservation;
  s.config.journalPath = join(s.directory, 'replacement-journal.db'); s.persist();
  const result = runAccountingOperator(s.args(), s.projectRoot);
  assert.equal(result.exitCode, 2); assert.deepEqual(s.inspect().reservation, before);
  assert.equal(result.output.executionPerformed, false); assert.equal(result.output.dispatchGranted, false);
  assert.equal(JSON.stringify(result.output).includes(s.directory), false);
});

test('database/input path collisions reject before any constructor can reinterpret the file', t => {
  const s = setup(t), before = s.inspect().reservation, approvalBytes = readFileSync(s.config.budgetPath);
  s.config.journalPath = s.config.budgetPath; save(s.paths.config, s.config);
  const result = runAccountingOperator(s.args(), s.projectRoot);
  assert.equal(result.exitCode, 2);
  assert.deepEqual(readFileSync(s.config.budgetPath), approvalBytes); assert.deepEqual(s.inspect().reservation, before);
});
