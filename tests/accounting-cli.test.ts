import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { AccountingOperatorConfigSchema, AccountingOperatorContextSchema, runAccountingOperator } from '../scripts/accounting-cli.ts';
import { assertPrivateOperatorPath, operatorJsonDigest, readPrivateOperatorJson } from '../scripts/operator-files.ts';
import { BudgetSchema } from '../scripts/config.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { AccountingReceiptImporter, AccountingReceiptSchema, accountingReceiptDigest, cleanupObservationDigest,
  operationManifestDigest } from '../packages/orchestrator/src/accounting-receipts.ts';

const H = 'sha256:' + 'a'.repeat(64), J = 'sha256:' + 'b'.repeat(64), K = 'sha256:' + 'c'.repeat(64);
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-accounting-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const projectRoot = join(directory, 'project'); mkdirSync(projectRoot, { mode: 0o700 });
  const earlier = new Date(Date.now() - 3_600_000).toISOString(), later = new Date(Date.now() + 3_600_000).toISOString();
  const budget = BudgetSchema.parse({ schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 25,
    ownerApproval: { approvedBy: 'unit', approvedAt: earlier, expiresAt: null, reference: 'invented-unit-only' }, verifiedCredits: [],
    stages: { smoke: 5, pilot: 20, evaluate: 0, hosting: 0 }, episodeLimits: { inferenceCallLimit: 24, inputTokenLimit: null,
      outputTokenLimit: null, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: null, candidateBranchLimit: 3 }, note: 'synthetic operator test' });
  const config = AccountingOperatorConfigSchema.parse({ schemaVersion: '1.0', kind: 'patchproof-accounting-operator',
    budgetPath: join(directory, 'approval.json'), expectedBudgetDigest: operatorJsonDigest(budget),
    ledgerPath: join(directory, 'budget.sqlite'), journalPath: join(directory, 'accounting.sqlite') });
  const ledger = new BudgetLedger({ filename: config.ledgerPath, budget, now: () => new Date(earlier) });
  ledger.reserve({ id: 'unit-reservation', episodeId: 'unit-episode', stage: 'pilot', amountMicros: 2_000_000, fingerprint: H });
  ledger.markAttempted('unit-reservation'); ledger.close();
  const operationManifest = { inventoryComplete: true, operations: [{ intentId: 'unit-intent', operationId: 'unit-operation', status: 'terminal', evidenceDigest: H }] };
  const cleanup = { complete: true, unresolvedIntentIds: [], evidenceDigest: J };
  const receipt = AccountingReceiptSchema.parse({ schemaVersion: '1.0', kind: 'episode-accounting-reconciliation', id: 'receipt-1', revision: 1,
    previousReceiptDigest: null, expectedLedgerEvidenceDigest: null,
    binding: { reservationId: 'unit-reservation', episodeId: 'unit-episode', reservationFingerprint: H, stage: 'pilot', reservedMicros: '2000000', sourceDigest: J, planDigest: K },
    operationManifest, operationDigest: operationManifestDigest(operationManifest), cleanup, cleanupDigest: cleanupObservationDigest(cleanup),
    observedThroughAt: earlier, issuedAt: earlier, validUntil: later, scope: 'entire_episode_including_setup_retries_cleanup',
    billing: { currency: 'USD', cumulativeUsd: '0.25000001', complete: true, evidenceDigest: H },
    cpu: { cumulativeSeconds: 3, complete: true, evidenceDigest: J } });
  const paths = { config: join(directory, 'config.json'), receipt: join(directory, 'receipt.json'), context: join(directory, 'context.json') };
  json(config.budgetPath, budget); json(paths.config, config); json(paths.receipt, receipt);
  const context = AccountingOperatorContextSchema.parse({ expectedBinding: receipt.binding, expectedOperationDigest: receipt.operationDigest,
    expectedCleanupDigest: receipt.cleanupDigest, acceptedReceiptDigests: [accountingReceiptDigest(receipt)] });
  json(paths.context, context);
  const args = (command = 'import') => [command, paths.config, paths.receipt, paths.context, operatorJsonDigest(context)];
  const snapshot = () => { const db = new BudgetLedger({ filename: config.ledgerPath, budget });
    try { return { reservation: db.get('unit-reservation'), snapshot: db.snapshot(), attempted: db.markAttempted('unit-reservation') }; } finally { db.close(); } };
  return { directory, projectRoot, config, budget, receipt, context, paths, args, snapshot };
}

test('operator imports explicit reviewed context, rounds measured charges, and never grants a second attempt', t => {
  const s = setup(t), result = runAccountingOperator(s.args(), s.projectRoot);
  assert.equal(result.exitCode, 0); assert.equal(result.output.status, 'applied');
  assert.equal(result.output.executionPerformed, false); assert.equal(result.output.providerCalls, 0);
  assert.equal(result.output.dispatchGranted, false); assert.equal(result.output.authenticityVerified, false);
  assert.equal(s.snapshot().reservation.actualCostMicros, '250001'); assert.equal(s.snapshot().reservation.heldMicros, '0');
  assert.equal(s.snapshot().attempted.dispatchGranted, false);
  assert.equal(statSync(s.config.journalPath).mode & 0o777, 0o600);
});

test('CLI subprocess emits only bounded metadata with historical receipt values', t => {
  const s = setup(t), cli = new URL('../scripts/accounting-cli.ts', import.meta.url);
  const child = spawnSync(process.execPath, [cli.pathname, ...s.args()], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout); assert.equal(result.receiptCpuSeconds, 3); assert.equal(result.receiptValuesAreHistorical, true);
  for (const value of [s.directory, 'unit-operation', 'unit-intent', 'invented-unit-only']) assert.equal(child.stdout.includes(value), false);
  const second = runAccountingOperator(s.args(), s.projectRoot); assert.equal(second.output.status, 'already_applied');
});

test('independent context digest and binding mismatches fail before journal initialization', t => {
  const s = setup(t), original = s.snapshot().reservation;
  const wrongDigest = s.args(); wrongDigest[4] = H;
  assert.equal(runAccountingOperator(wrongDigest, s.projectRoot).exitCode, 2);
  s.context.expectedBinding.sourceDigest = H; json(s.paths.context, s.context);
  assert.equal(runAccountingOperator(s.args(), s.projectRoot).exitCode, 2);
  assert.equal(existsSync(s.config.journalPath), false); assert.deepEqual(s.snapshot().reservation, original);
});

test('missing, empty or non-ledger paths never create approval or reservation state', t => {
  const s = setup(t);
  for (const name of ['missing.sqlite', 'empty.sqlite']) {
    const filename = join(s.directory, name); s.config.ledgerPath = filename;
    if (name.startsWith('empty')) writeFileSync(filename, '', { mode: 0o600 });
    json(s.paths.config, s.config);
    assert.equal(runAccountingOperator(s.args(), s.projectRoot).exitCode, 2);
    assert.equal(existsSync(s.config.journalPath), false);
    if (name.startsWith('missing')) assert.equal(existsSync(filename), false);
    else assert.equal(statSync(filename).size, 0);
  }
});

test('unknown billing retains the hold and is a successful recorded import', t => {
  const s = setup(t); s.receipt.billing = { currency: null, cumulativeUsd: null, complete: false, evidenceDigest: null };
  s.receipt.cpu = { cumulativeSeconds: null, complete: false, evidenceDigest: null };
  s.context.acceptedReceiptDigests = [accountingReceiptDigest(s.receipt)]; json(s.paths.receipt, s.receipt); json(s.paths.context, s.context);
  const result = runAccountingOperator(s.args(), s.projectRoot);
  assert.equal(result.exitCode, 0); assert.equal(s.snapshot().reservation.heldMicros, '2000000');
  assert.equal(s.snapshot().snapshot.pendingBillingCount, 1); assert.equal(s.snapshot().reservation.actualCostMicros, null);
});

test('operator recovers only the exact expired prepared receipt and retains its hold', t => {
  const s = setup(t), ledger = new BudgetLedger({ filename: s.config.ledgerPath, budget: s.budget });
  new AccountingReceiptImporter({ filename: s.config.journalPath, ledger }).close(); ledger.close();
  s.receipt.validUntil = new Date(Date.now() - 60_000).toISOString();
  s.context.acceptedReceiptDigests = [accountingReceiptDigest(s.receipt)]; json(s.paths.receipt, s.receipt); json(s.paths.context, s.context);
  const db = new DatabaseSync(s.config.journalPath);
  db.prepare('INSERT INTO accounting_receipts(id,digest,reservation_id,revision,body_json,status,prepared_at) VALUES(?,?,?,?,?,?,?)')
    .run(s.receipt.id, accountingReceiptDigest(s.receipt), s.receipt.binding.reservationId, 1, JSON.stringify(s.receipt), 'prepared', s.receipt.issuedAt);
  db.close();
  const result = runAccountingOperator(s.args('recover-expired'), s.projectRoot);
  assert.equal(result.exitCode, 0); assert.equal(result.output.status, 'rejected');
  assert.equal(s.snapshot().reservation.heldMicros, '2000000'); assert.equal(s.snapshot().attempted.dispatchGranted, false);
  assert.equal(runAccountingOperator(s.args('recover-expired'), s.projectRoot).output.status, 'already_rejected');
});

test('private operator file reader rejects workspace, symlink, hardlink, broad permissions and oversized inputs', t => {
  const s = setup(t), inside = join(s.projectRoot, 'private.json'); json(inside, {});
  assert.throws(() => readPrivateOperatorJson(inside, { projectRoot: s.projectRoot }));
  const linked = join(s.directory, 'linked.json'); symlinkSync(s.paths.context, linked);
  assert.throws(() => readPrivateOperatorJson(linked, { projectRoot: s.projectRoot }));
  const hard = join(s.directory, 'hard.json'); linkSync(s.paths.context, hard);
  assert.throws(() => readPrivateOperatorJson(hard, { projectRoot: s.projectRoot })); rmSync(hard);
  chmodSync(s.paths.context, 0o644); assert.throws(() => readPrivateOperatorJson(s.paths.context, { projectRoot: s.projectRoot }));
  chmodSync(s.paths.context, 0o600); assert.throws(() => readPrivateOperatorJson(s.paths.context, { projectRoot: s.projectRoot, maximumBytes: 1 }));
  const alias = join(s.directory, 'alias'); symlinkSync(s.directory, alias);
  assert.throws(() => readPrivateOperatorJson(join(alias, 'context.json'), { projectRoot: s.projectRoot }));
  writeFileSync(s.config.ledgerPath + '-wal', '', { mode: 0o644 });
  assert.throws(() => assertPrivateOperatorPath(s.config.ledgerPath, s.projectRoot, { database: true }));
});

test('invalid JSON and unrecognized data are not reflected in subprocess output', t => {
  const s = setup(t), sentinel = 'private-sentinel-do-not-print';
  writeFileSync(s.paths.receipt, '{"unexpected":"' + sentinel + '"}', { mode: 0o600 });
  const child = spawnSync(process.execPath, [new URL('../scripts/accounting-cli.ts', import.meta.url).pathname, ...s.args()], { encoding: 'utf8' });
  assert.equal(child.status, 2); assert.equal((child.stdout + child.stderr).includes(sentinel), false);
  assert.equal(existsSync(s.config.journalPath), false);
  assert.equal(JSON.parse(child.stdout).error.code, 'operator_input_or_accounting_rejected');
  assert.equal(readFileSync(s.paths.receipt, 'utf8').includes(sentinel), true);
});
