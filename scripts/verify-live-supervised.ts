import type { ProductRun, ProductEvidence } from '../packages/contracts/src/product.ts';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createLiveApplication } from '../apps/api/src/live-application.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';

// Operator-invoked once for these two synthetic tasks. Never listens publicly,
// retries a repair, releases a hold, increases approval, or clears other freezes.
process.umask(0o077);
const configFile = process.argv[2];
if (!configFile || process.argv.length !== 3) throw Error('explicit_private_config_required');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const budget = JSON.parse(readFileSync(new URL('../budget.json', import.meta.url), 'utf8'));
const billing = JSON.parse(readFileSync(new URL('../research/verification/20261016-demo-repair/pre-supervision-billing.json', import.meta.url), 'utf8'));
assert.equal(billing.accountBillingActive, true);
assert.equal(billing.capUsd, '25'); assert.equal(billing.requestFeeUsd, 0);
assert(Date.now() - Date.parse(billing.checkedAt) < 3600000);
const tasks = ['v3-config-overlay', 'v3-cursor-pagination'];
assert.deepEqual(config.taskIds, tasks);
const ledger = new BudgetLedger({ filename: config.ledgerFile, budget, existingOnly: true, pendingBillingPolicy: 'allow-covered-inference' });
const before = ledger.snapshot();
assert.equal(before.approvedMicros, '25000000');
assert.equal(before.heldMicros, '1600000'); assert.equal(before.reservationCount, 15);
assert.equal(before.blockingPendingBillingCount, 0);
assert.deepEqual(before.freezeReasons, ['operator_paused_supervised_only']);
const priorIds = [...new Set(ledger.events().flatMap(e => e.reservationId ? [e.reservationId] : []))];
const historical = priorIds.map(id => ledger.get(id));
const checkpoint = ledger.operatorResumeCheckpoint();
const authority = digestJson({ scope: 'two-fixed-supervised-repairs', billing, checkpoint, sourceDigest: config.sourceDigest, before });
const results: unknown[] = [];
let app: Awaited<ReturnType<typeof createLiveApplication>> | undefined;
let success = false, interrupted = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  interrupted = true;
  for (const run of app?.coordinator.list() ?? []) if (run.phase !== 'terminal') app!.coordinator.cancel(run.id);
});
try {
  app = await createLiveApplication(new URL('../', import.meta.url), configFile);
  assert(app.coordinator.list().every(run => run.phase === 'terminal'));
  assert.equal(interrupted, false);
  ledger.resumeOperatorPause({ ...checkpoint, evidenceDigest: authority });
  for (const taskId of tasks) {
    assert.equal(interrupted, false);
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.frozen, false); assert.equal(snapshot.blockingPendingBillingCount, 0);
    const created: { run: ProductRun; reused: boolean } = app.coordinator.create({ taskId, mode: 'live', variant: 'patchproof', idempotencyKey: 'supervised-20261016-' + taskId });
    assert.equal(created.reused, false);
    console.log(JSON.stringify({ event: 'supervised-run-started', taskId, runId: created.run.id }));
    await app.coordinator.settled();
    const run: ProductRun = app.coordinator.get(created.run.id);
    const evidence: ProductEvidence = await app.coordinator.evidence(run.id);
    const result = { taskId, runId: run.id, terminalStatus: run.terminalStatus, reason: run.reason, usage: run.usage,
      baselineChecks: (run.baselineChecks?.visible.length ?? 0) + (run.baselineChecks?.acceptance.length ?? 0),
      candidateCount: run.candidates.length, operations: run.sandboxOperationIds.length, evidenceDigest: evidence.bundleDigest };
    results.push(result); console.log(JSON.stringify(result));
    assert.equal(run.terminalStatus, 'verified_for_declared_checks');
    assert.equal(ledger.snapshot().blockingPendingBillingCount, 0);
  }
  success = true;
} finally {
  // Re-pause before process exit or any later rollout; no automatic public reopen.
  ledger.pauseOperator(digestJson({ authority, results, success }));
  for (const row of historical) assert.deepEqual(ledger.get(row.id), row);
  const receipt = { completedAt: new Date().toISOString(), sourceDigest: config.sourceDigest, authority,
    success, before, after: ledger.snapshot(), historicalReservationsUnchanged: true, results };
  writeFileSync(new URL('../research/verification/20261016-demo-repair/supervised-repairs.json', import.meta.url),
    JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (app) await app.close();
  ledger.close();
}
