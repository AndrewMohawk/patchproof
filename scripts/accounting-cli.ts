import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BudgetSchema } from './config.ts';
import { BudgetLedger, BudgetLedgerError } from '../packages/orchestrator/src/budget-ledger.ts';
import { AccountingBindingSchema, AccountingReceiptImporter, AccountingReceiptSchema,
  accountingReceiptDigest } from '../packages/orchestrator/src/accounting-receipts.ts';
import { assertPrivateOperatorPath, operatorJsonDigest, OperatorFileError, readPrivateOperatorJson } from './operator-files.ts';

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const AccountingOperatorConfigSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), kind: z.literal('patchproof-accounting-operator'),
  budgetPath: z.string().min(1), expectedBudgetDigest: Digest,
  ledgerPath: z.string().min(1), journalPath: z.string().min(1),
});
export const AccountingOperatorContextSchema = z.strictObject({
  expectedBinding: AccountingBindingSchema, expectedOperationDigest: Digest,
  expectedCleanupDigest: Digest, acceptedReceiptDigests: z.array(Digest).min(1).max(1000),
});
const label = { kind: 'trusted-accounting-operator', executionPerformed: false, dispatchGranted: false,
  providerCalls: 0, authenticityVerified: false, competitionReady: false } as const;
const stop = (code: string): never => { throw new OperatorFileError(code); };

/** No runtime, credential, reserve, approval-change or dispatch functions are reachable here. */
export function runAccountingOperator(args: string[], projectRoot: string) {
  let ledger: BudgetLedger | undefined, importer: AccountingReceiptImporter | undefined;
  try {
    const [command, configPath, receiptPath, contextPath, expectedContextDigest] = args;
    if (args.length !== 5 || !['import', 'recover-expired'].includes(command!)) stop('operator_usage');
    const read = (path: string) => readPrivateOperatorJson(path, { projectRoot });
    const config = AccountingOperatorConfigSchema.parse(read(configPath!));
    const receipt = AccountingReceiptSchema.parse(read(receiptPath!));
    const context = AccountingOperatorContextSchema.parse(read(contextPath!));
    if (operatorJsonDigest(context) !== Digest.parse(expectedContextDigest)) stop('operator_context_digest_mismatch');
    const receiptDigest = accountingReceiptDigest(receipt);
    if (!context.acceptedReceiptDigests.includes(receiptDigest) ||
        operatorJsonDigest(receipt.binding) !== operatorJsonDigest(context.expectedBinding) ||
        receipt.operationDigest !== context.expectedOperationDigest || receipt.cleanupDigest !== context.expectedCleanupDigest) {
      stop('operator_receipt_not_accepted');
    }
    const budget = BudgetSchema.parse(read(config.budgetPath));
    if (operatorJsonDigest(budget) !== config.expectedBudgetDigest) stop('operator_budget_digest_mismatch');
    // A typo must never initialize a fresh ledger or impersonate an existing journal.
    assertPrivateOperatorPath(config.ledgerPath, projectRoot, { database: true });
    assertPrivateOperatorPath(config.journalPath, projectRoot, { database: true, allowMissing: command === 'import' });
    const paths = [configPath!, receiptPath!, contextPath!, config.budgetPath, config.ledgerPath, config.journalPath];
    if (new Set(paths).size !== paths.length || paths.some((path, i) => paths.some((other, j) =>
      i !== j && ['-wal', '-shm', '-journal'].some(suffix => path === other + suffix)))) stop('operator_path_collision');
    const existingLedger = new DatabaseSync(config.ledgerPath, { readOnly: true });
    try {
      if (!existingLedger.prepare('SELECT id FROM budget_meta WHERE id=1 AND schema_version=1').get()) stop('operator_existing_ledger_required');
      if (!existingLedger.prepare('SELECT id FROM budget_reservations WHERE id=?').get(context.expectedBinding.reservationId)) stop('operator_existing_reservation_required');
    } finally { existingLedger.close(); }
    ledger = new BudgetLedger({ filename: config.ledgerPath, budget });
    const current = ledger.get(context.expectedBinding.reservationId), binding = context.expectedBinding;
    if (current.episodeId !== binding.episodeId || current.fingerprint !== binding.reservationFingerprint ||
        current.stage !== binding.stage || current.reservedMicros !== binding.reservedMicros) stop('operator_reservation_mismatch');
    importer = new AccountingReceiptImporter({ filename: config.journalPath, ledger });
    const result = command === 'import' ? importer.import(receipt, context) :
      importer.recoverExpiredPrepared(receipt.id, { expectedReceiptDigest: receiptDigest, acceptedReceiptDigests: context.acceptedReceiptDigests });
    const reservation = result.reservation, snapshot = ledger.snapshot();
    return { exitCode: 0, output: { ...label, status: result.status, receiptDigest,
      receiptRevision: receipt.revision, receiptCpuSeconds: receipt.cpu.cumulativeSeconds,
      receiptValuesAreHistorical: true, sourceDigest: binding.sourceDigest, planDigest: binding.planDigest,
      currentReservation: { id: reservation.id, state: reservation.state, actualCostMicros: reservation.actualCostMicros,
        heldMicros: reservation.heldMicros, reconciliationComplete: reservation.reconciliationComplete, evidenceDigest: reservation.evidenceDigest },
      pendingBillingCount: snapshot.pendingBillingCount, freezeReasons: snapshot.freezeReasons } };
  } catch (error) {
    const code = error instanceof OperatorFileError ? error.code : error instanceof BudgetLedgerError ? 'operator_ledger_rejected' : 'operator_input_or_accounting_rejected';
    return { exitCode: 2, output: { ...label, status: 'error', error: { code } } };
  } finally { importer?.close(); ledger?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runAccountingOperator(process.argv.slice(2), fileURLToPath(new URL('../', import.meta.url)));
  console.log(JSON.stringify(result.output, null, 2));
  process.exitCode = result.exitCode;
}
