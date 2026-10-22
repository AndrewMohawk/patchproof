import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { BudgetLedger, BudgetLedgerError } from '../packages/orchestrator/src/budget-ledger.ts';
import { ClosedDispatchCoverageSchema, CLOSED_DISPATCH_POLICY_ID, CLOSED_DISPATCH_CASE_DIGEST,
  CLOSED_DISPATCH_COVERAGE_EVENT, closedDispatchCase, closedDispatchMaximumCostMicros,
  prepareClosedDispatchCoverage } from '../packages/orchestrator/src/closed-dispatch-recovery.ts';

// Synthetic ledgers only. Historical identities bind the narrowly reviewed case; no fixture is a bill.
const c = closedDispatchCase(), NOW = '2026-10-20T17:30:00.000Z', ATTEMPT = '2026-10-20T04:03:04.700Z';
const H = 'sha256:' + 'a'.repeat(64), J = 'sha256:' + 'b'.repeat(64);
const budget = () => ({ schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 25,
  ownerApproval: { approvedBy: 'synthetic', approvedAt: '2026-10-16T20:57:00.000Z', expiresAt: '2026-12-15T20:00:00.000Z', reference: 'synthetic offline ledger' },
  verifiedCredits: [], stages: { smoke: 25, pilot: 0, evaluate: 0, hosting: 0 },
  episodeLimits: { inferenceCallLimit: 3, inputTokenLimit: 786432, outputTokenLimit: 12000, wallTimeLimitSeconds: 600, sandboxCpuSecondsLimit: 900, candidateBranchLimit: 3 }, note: 'offline only' });
const code = (value: string) => (error: unknown) => error instanceof BudgetLedgerError && error.code === value;
const reservation = { id: c.reservationId, episodeId: c.episodeId, stage: c.stage, amountMicros: 250000, fingerprint: c.reservationFingerprint };
const another = (id: string, amountMicros = 250000) => ({ id, episodeId: id, stage: 'smoke', amountMicros, fingerprint: H });
function proof(ledger: BudgetLedger, now = NOW) {
  const s = ledger.snapshot();
  return ClosedDispatchCoverageSchema.parse({ schemaVersion: '1.0', kind: 'historical-closed-dispatch-exposure-v1',
    policyId: CLOSED_DISPATCH_POLICY_ID, reviewedCaseDigest: CLOSED_DISPATCH_CASE_DIGEST, reviewedCase: closedDispatchCase(),
    checkpoint: { ...ledger.operatorResumeCheckpoint(), approvalDigest: s.approvalDigest, approvedTotalMicros: s.approvedMicros },
    preparedAt: now, expiresAt: new Date(Date.parse(now) + 300000).toISOString() });
}
async function setup(t: TestContext, priorCost = 0, activeReservation = false, amountMicros = 250000) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-closed-dispatch-')), filename = join(directory, 'ledger.sqlite');
  const connections = new Set<BudgetLedger>(); let time = ATTEMPT;
  const open = (recovery = true, covered = true, configured = budget()) => {
    const ledger = new BudgetLedger({ filename, budget: configured, now: () => new Date(time),
      pendingBillingPolicy: covered ? 'allow-covered-inference' : 'block-all',
      ...(recovery ? { closedDispatchRecoveryPolicy: CLOSED_DISPATCH_POLICY_ID } : {}) });
    connections.add(ledger); return ledger;
  };
  const close = (l: BudgetLedger) => { l.close(); connections.delete(l); };
  const ledger = open();
  if (priorCost) { ledger.reserve(another('prior', priorCost)); ledger.markAttempted('prior'); ledger.reconcile({ id: 'prior', actualCostMicros: priorCost, complete: true, evidenceDigest: H }); }
  if (activeReservation) ledger.reserve(another('active-reserved'));
  ledger.reserve({ ...reservation, amountMicros }); ledger.markAttempted(c.reservationId);
  time = c.closedAt; ledger.reconcile({ id: c.reservationId, actualCostMicros: null, complete: false, evidenceDigest: c.evidenceDigest }); time = NOW;
  t.after(async () => { for (const l of connections) l.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, filename, ledger, open, close, time: (value: string) => { time = value; } };
}

test('reviewed historical policy pins authentic bundle, source, requested thinking, missing receipt and conservative bound', async () => {
  const bundle = JSON.parse(await readFile(new URL('../research/verification/20261020-humanize/repair-evidence-5.json', import.meta.url), 'utf8'));
  const { bundleDigest, ...body } = bundle;
  assert.equal(digestJson(body), c.bundleDigest); assert.equal(bundleDigest, c.bundleDigest);
  assert.equal(digestJson(bundle.runtimeLock.operationalLock), c.sourceDigest);
  assert.equal(bundle.runtimeLock.operationalLock.sources['workers/repair/index.ts'], 'sha256:067a09ad36d63eac4f3ca0cc7a75425e69e66ba416ee5fa9b7800d73572b91c0');
  assert.equal(bundle.run.id, c.episodeId); assert.equal(bundle.run.terminalStatus, c.terminalStatus);
  assert.equal(bundle.run.usage.inputTokens, c.observedInputTokens); assert.equal(bundle.run.usage.outputTokens, c.observedOutputTokens);
  assert.equal(c.returnedModelVerified, false); assert.equal(c.rawResponseDigest, null); assert.equal(c.thinkingRequested, true);
  assert.equal(closedDispatchMaximumCostMicros(), 246732n);
  const altered = closedDispatchCase() as any; altered.assumptions.length = 0;
  assert.equal(closedDispatchCase().assumptions.length, 4, 'export does not expose mutable policy');
});

test('separate opt-in append keeps all money and unknown settlement, persists, is idempotent, and cannot retry the historical run', async t => {
  const h = await setup(t), p = proof(h.ledger), before = h.ledger.get(c.reservationId), events = h.ledger.events().length;
  assert.throws(() => h.open(false).coverClosedDispatch(p), code('closed_dispatch_recovery_disabled'));
  assert.throws(() => h.open(true, false).coverClosedDispatch(p), code('closed_dispatch_recovery_disabled'));
  assert.equal(h.ledger.coverClosedDispatch(p).maximumCostMicros, '246732');
  assert.deepEqual(h.ledger.get(c.reservationId), before);
  assert.equal(h.ledger.events().length, events + 1); assert.equal(h.ledger.coverClosedDispatch(p).created, false);
  h.close(h.ledger); const reopened = h.open();
  assert.equal(reopened.snapshot().heldMicros, '250000'); assert.equal(reopened.snapshot().chargedMicros, '0');
  assert.equal(reopened.snapshot().blockingPendingBillingCount, 0); assert.equal(reopened.get(c.reservationId).actualCostMicros, null);
  assert.equal(reopened.get(c.reservationId).reconciliationComplete, false);
  assert.equal(reopened.markAttempted(c.reservationId).dispatchGranted, false);
  assert.equal(reopened.reserve(reservation).created, false);
  assert.throws(() => reopened.reserve({ ...reservation, id: 'replacement' }), code('episode_already_reserved'));
  assert.equal(h.open(false).snapshot().blockingPendingBillingCount, 1, 'receipt-only connections fail closed');
  assert.equal(h.open(true, false).snapshot().blockingPendingBillingCount, 1, 'strict policy still blocks');
  h.time('2026-10-20T18:30:00.000Z'); assert.equal(reopened.coverClosedDispatch(p).created, false, 'acknowledgment retry does not append or expire accepted coverage');
});

test('all changed facts, unknown fees, hidden retries, model claims and invented receipt digests are rejected without mutation', async t => {
  const h = await setup(t), p = proof(h.ledger), count = h.ledger.events().length;
  const changes: Record<string, unknown>[] = [
    { reservationId: 'other' }, { sourceDigest: J }, { configDigest: J }, { closureDigest: J }, { openDispatchDigest: J },
    { evidenceDigest: J }, { pricingEvidenceDigest: J }, { feeEvidenceDigest: J }, { inputMicrosPerMillionTokens: '0' },
    { additionalFeeMicros: '4000' }, { inventoryComplete: false }, { dispatchClosed: false }, { automaticRetries: 1 },
    { dispatchedCalls: 2 }, { outputTokenCeiling: 8000 }, { returnedModelVerified: true }, { rawResponseDigest: H },
    { actualCostMicros: '250000' }, { settlementComplete: true }, { assumptions: [] },
  ];
  for (const change of changes) assert.throws(() => h.ledger.coverClosedDispatch({ ...p, reviewedCase: { ...c, ...change } }));
  assert.throws(() => h.ledger.coverClosedDispatch({ ...p, extra: true }));
  assert.throws(() => h.ledger.coverClosedDispatch({ ...p, checkpoint: { ...p.checkpoint, approvedTotalMicros: '26000000' } }));
  assert.throws(() => h.ledger.coverPendingInference(p), 'receipt schema remains separate');
  assert.equal(h.ledger.events().length, count); assert.equal(h.ledger.snapshot().heldMicros, '250000');
  assert.throws(() => prepareClosedDispatchCoverage({ sourceLock: {}, config: {}, bundle: {}, openDispatch: {}, closure: {} }, p.checkpoint, new Date(NOW)));
});

test('five-minute checkpoint boundaries, future clocks, approval changes and unrelated writes fail closed', async t => {
  const h = await setup(t), p = proof(h.ledger);
  h.time(p.expiresAt); assert.throws(() => h.ledger.coverClosedDispatch(p), code('closed_dispatch_checkpoint_changed'));
  h.time('2026-10-20T17:29:59.999Z'); assert.throws(() => h.ledger.coverClosedDispatch(p), code('closed_dispatch_checkpoint_changed'));
  h.time(NOW); h.ledger.bindAccountingJournal(H);
  assert.throws(() => h.ledger.coverClosedDispatch(p), code('closed_dispatch_checkpoint_changed'));
  const fresh = proof(h.ledger); h.time('2026-10-20T17:34:59.999Z'); assert.equal(h.ledger.coverClosedDispatch(fresh).created, true);
  const revised = { ...budget(), note: 'new synthetic approval revision' };
  h.ledger.syncApproval(revised, { expectedRevision: 1 });
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 0);
  assert.throws(() => h.ledger.coverClosedDispatch(proof(h.ledger)), code('closed_dispatch_conflict'));
});

test('prepared receipts and later evidence invalidate coverage permanently without changing holds', async t => {
  for (const event of ['prepared', 'reconcile', 'cancel'] as const) {
    await t.test(event, async t => {
      const h = await setup(t); h.ledger.coverClosedDispatch(proof(h.ledger));
      if (event === 'prepared') { h.ledger.bindAccountingJournal(H); h.ledger.anchorAccountingReceipt({ journalDigest: H, reservationId: c.reservationId, revision: 1, receiptDigest: J, previousReceiptDigest: null }); }
      if (event === 'reconcile') h.ledger.reconcile({ id: c.reservationId, actualCostMicros: null, complete: false, evidenceDigest: J });
      if (event === 'cancel') h.ledger.cancel(c.reservationId);
      assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 0); assert.equal(h.ledger.snapshot().heldMicros, '250000');
      assert.throws(() => h.ledger.coverClosedDispatch(proof(h.ledger)));
      assert.equal(h.ledger.markAttempted(c.reservationId).dispatchGranted, false);
    });
  }
});

test('exhausted cap, reduced approval, and sticky operator/overrun freezes remain enforced', async t => {
  await t.test('all dollars committed', async t => {
    const h = await setup(t, 24750000); h.ledger.coverClosedDispatch(proof(h.ledger));
    assert.equal(h.ledger.snapshot().availableMicros, '0'); assert.equal(h.ledger.snapshot().heldMicros, '250000');
    assert.throws(() => h.ledger.reserve(another('over', 1)), code('budget_exceeded'));
  });
  await t.test('cap below commitment', async t => {
    const h = await setup(t); h.ledger.syncApproval({ ...budget(), maxApprovedSpendUsd: .20, stages: { smoke: .20, pilot: 0, evaluate: 0, hosting: 0 } }, { expectedRevision: 1 });
    assert.throws(() => h.ledger.coverClosedDispatch(proof(h.ledger)), code('approved_cap_below_commitment'));
  });
  await t.test('operator pause', async t => {
    const h = await setup(t); h.ledger.pauseOperator(H);
    assert.throws(() => h.ledger.coverClosedDispatch(proof(h.ledger)), code('operator_paused_supervised_only'));
  });
  await t.test('sticky overrun', async t => {
    const h = await setup(t); h.ledger.reconcile({ id: c.reservationId, actualCostMicros: 250001, complete: true, evidenceDigest: J });
    assert.throws(() => h.ledger.coverClosedDispatch(proof(h.ledger)), code('reservation_overrun'));
  });
});

const ledgerModule = new URL('../packages/orchestrator/src/budget-ledger.ts', import.meta.url).href;
const childSource = `import {readFileSync} from 'node:fs'; import {BudgetLedger} from ${JSON.stringify(ledgerModule)};
const i=JSON.parse(readFileSync(0,'utf8')); const l=new BudgetLedger({filename:i.filename,budget:i.budget,existingOnly:true,now:()=>new Date(i.now),pendingBillingPolicy:'allow-covered-inference',closedDispatchRecoveryPolicy:i.policy});
try {const r=l.coverClosedDispatch(i.proof); if(i.crash)process.kill(process.pid,'SIGKILL'); console.log(JSON.stringify(r)); l.close();} catch(e){console.error(e.code ?? e.message);process.exitCode=2; l.close();}`;
const childInput = (filename: string, p: unknown, crash = false) => JSON.stringify({ filename, proof: p, crash, budget: budget(), now: NOW, policy: CLOSED_DISPATCH_POLICY_ID });

test('committed recovery survives abrupt process death and an acknowledgment retry never duplicates it', async t => {
  const h = await setup(t), p = proof(h.ledger); h.close(h.ledger);
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], { input: childInput(h.filename, p, true), encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  const l = h.open(); assert.equal(l.snapshot().coveredPendingBillingCount, 1);
  assert.equal(l.coverClosedDispatch(p).created, false);
  assert.equal(l.events().filter(e => e.kind === CLOSED_DISPATCH_COVERAGE_EVENT).length, 1);
  assert.equal(l.get(c.reservationId).actualCostMicros, null); assert.equal(l.snapshot().heldMicros, '250000');
});

test('storage failure rolls back the coverage event and leaves the original checkpoint usable', async t => {
  const h = await setup(t), p = proof(h.ledger), before = h.ledger.events(), row = h.ledger.get(c.reservationId);
  const db = new DatabaseSync(h.filename);
  db.exec(`CREATE TRIGGER fail_recovery BEFORE INSERT ON budget_events WHEN NEW.kind='${CLOSED_DISPATCH_COVERAGE_EVENT}' BEGIN SELECT RAISE(ABORT,'simulated disk write rejection'); END;`);
  assert.throws(() => h.ledger.coverClosedDispatch(p), /simulated disk write rejection/);
  assert.deepEqual(h.ledger.events(), before); assert.deepEqual(h.ledger.get(c.reservationId), row);
  assert.equal(h.ledger.snapshot().blockingPendingBillingCount, 1);
  db.exec('DROP TRIGGER fail_recovery'); db.close(); assert.equal(h.ledger.coverClosedDispatch(p).created, true);
});

test('two processes racing the same checkpoint append exactly once and retain the full hold', async t => {
  const h = await setup(t), p = proof(h.ledger);
  const run = () => new Promise<{ status: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource]); let output = '', errors = '';
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { errors += d; }); child.on('error', reject);
    child.on('close', status => resolve({ status, output: status === 0 ? output : errors })); child.stdin.end(childInput(h.filename, p));
  });
  const results = await Promise.all([run(), run()]); for (const result of results) assert.equal(result.status, 0, result.output);
  assert.deepEqual(results.map(r => JSON.parse(r.output).created).sort(), [false, true]);
  assert.equal(h.ledger.events().filter(e => e.kind === CLOSED_DISPATCH_COVERAGE_EVENT).length, 1);
  assert.equal(h.ledger.snapshot().heldMicros, '250000');
});

test('an outstanding reservation blocks first recovery even with a fresh review checkpoint', async t => {
  const h = await setup(t, 0, true);
  assert.throws(() => h.ledger.coverClosedDispatch(proof(h.ledger)), code('closed_dispatch_not_quiescent'));
  assert.equal(h.ledger.snapshot().heldMicros, '500000');
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount, 0);
});

test('underfunded or differently sized historical reservations cannot be covered', async t => {
  for (const amount of [246000, 249999, 250001]) await t.test(String(amount), async t => {
    const h = await setup(t, 0, false, amount);
    assert.throws(() => h.ledger.coverClosedDispatch(proof(h.ledger)), code('closed_dispatch_mismatch'));
    assert.equal(h.ledger.snapshot().heldMicros, String(amount));
  });
});

test('first recovery cannot bypass an already prepared accounting receipt', async t => {
  const h = await setup(t); h.ledger.bindAccountingJournal(H);
  h.ledger.anchorAccountingReceipt({ journalDigest: H, reservationId: c.reservationId, revision: 1, receiptDigest: J, previousReceiptDigest: null });
  assert.throws(() => h.ledger.coverClosedDispatch(proof(h.ledger)), code('closed_dispatch_mismatch'));
  assert.equal(h.ledger.snapshot().blockingPendingBillingCount, 1);
});

const increasedBudget = () => ({...budget(), maxApprovedSpendUsd:50, stages:{...budget().stages,smoke:50},
  ownerApproval:{...budget().ownerApproval,approvedAt:'2026-10-20T17:29:00.000Z',reference:'synthetic explicit increase'}});
function carryOptions(l: BudgetLedger) {
  const previous = l.events().filter(e => e.kind === CLOSED_DISPATCH_COVERAGE_EVENT).at(-1)!;
  return {expectedRevision:l.snapshot().approvalRevision,carryClosedDispatchCoverage:{
    expectedEventSequence:l.operatorResumeCheckpoint().eventSequence,proofDigest:String(previous.details.proofDigest)}};
}
test('explicit paused approval carry preserves historical coverage, full hold, unknown cost and redispatch denial after reopen', async t => {
  const h = await setup(t); h.ledger.coverClosedDispatch(proof(h.ledger)); h.ledger.pauseOperator(H);
  const before = h.ledger.get(c.reservationId), options=carryOptions(h.ledger), stale=h.open();
  const result=h.ledger.syncApproval(increasedBudget(),options);
  assert.equal(result.approvedMicros,'50000000'); assert.equal(result.heldMicros,'250000');
  assert.equal(result.coveredPendingBillingCount,1); assert.deepEqual(result.freezeReasons,['operator_paused_supervised_only']);
  assert.throws(()=>stale.syncApproval(increasedBudget(),options),code('approval_revision_conflict'));
  assert.equal(stale.snapshot().connectionApprovalCurrent,false);
  assert.deepEqual(h.ledger.get(c.reservationId),before);
  assert.throws(()=>h.ledger.syncApproval(increasedBudget(),options),code('approval_revision_conflict'));
  h.close(h.ledger); const l=h.open(true,true,increasedBudget());
  assert.equal(l.snapshot().coveredPendingBillingCount,1);
  l.resumeOperatorPause({...l.operatorResumeCheckpoint(),evidenceDigest:H});
  assert.equal(l.snapshot().frozen,false); assert.equal(l.markAttempted(c.reservationId).dispatchGranted,false);
  assert.equal(l.get(c.reservationId).actualCostMicros,null); assert.equal(l.get(c.reservationId).reconciliationComplete,false);
  l.reconcile({id:c.reservationId,actualCostMicros:null,complete:false,evidenceDigest:J});
  assert.equal(l.snapshot().coveredPendingBillingCount,0); assert.equal(l.snapshot().heldMicros,'250000');
  l.pauseOperator(H); assert.throws(()=>l.syncApproval({...increasedBudget(),maxApprovedSpendUsd:60,stages:{...budget().stages,smoke:60}},carryOptions(l)),code('closed_dispatch_carry_rejected'));
});
test('approval carry rejects stale checkpoints, altered scope, invalid evidence, active work and sticky freezes atomically',async t=>{
  for(const kind of ['not-paused','stale','digest','expiry','tokens','hosting','credits','decrease','evidence','active','overrun'] as const) await t.test(kind,async t=>{
    const h=await setup(t); h.ledger.coverClosedDispatch(proof(h.ledger));
    if(kind!=='not-paused')h.ledger.pauseOperator(H);
    const options=carryOptions(h.ledger), next:any=increasedBudget();
    if(kind==='stale')h.ledger.bindAccountingJournal(H);
    if(kind==='digest')options.carryClosedDispatchCoverage.proofDigest=J;
    if(kind==='expiry')next.ownerApproval.expiresAt='2026-12-16T20:00:00.000Z';
    if(kind==='tokens')next.episodeLimits={...next.episodeLimits,inferenceCallLimit:4};
    if(kind==='hosting')next.stages={...next.stages,smoke:49,hosting:1};
    if(kind==='credits')next.verifiedCredits=[{arbitrary:'invalid'}];
    if(kind==='decrease'){next.maxApprovedSpendUsd=24;next.stages.smoke=24;}
    if(kind==='evidence')h.ledger.reconcile({id:c.reservationId,actualCostMicros:null,complete:false,evidenceDigest:J});
    if(kind==='overrun')h.ledger.reconcile({id:c.reservationId,actualCostMicros:250001,complete:true,evidenceDigest:J});
    if(kind==='active'){
      h.ledger.resumeOperatorPause({...h.ledger.operatorResumeCheckpoint(),evidenceDigest:H});
      h.ledger.reserve(another('active'));h.ledger.pauseOperator(H);
      options.carryClosedDispatchCoverage.expectedEventSequence=h.ledger.operatorResumeCheckpoint().eventSequence;
    }
    const before=h.ledger.events(),row=h.ledger.get(c.reservationId);
    assert.throws(()=>h.ledger.syncApproval(next,options));
    assert.deepEqual(h.ledger.events(),before);assert.deepEqual(h.ledger.get(c.reservationId),row);
    assert.equal(h.ledger.snapshot().approvalRevision,1);
  });
});
test('approval carry event persistence failure rolls back approval and coverage together',async t=>{
  const h=await setup(t);h.ledger.coverClosedDispatch(proof(h.ledger));h.ledger.pauseOperator(H);
  const options=carryOptions(h.ledger),before=h.ledger.events(),db=new DatabaseSync(h.filename);
  db.exec(`CREATE TRIGGER fail_carry BEFORE INSERT ON budget_events WHEN NEW.kind='${CLOSED_DISPATCH_COVERAGE_EVENT}' BEGIN SELECT RAISE(ABORT,'carry disk failure'); END;`);
  assert.throws(()=>h.ledger.syncApproval(increasedBudget(),options),/carry disk failure/);
  assert.deepEqual(h.ledger.events(),before);assert.equal(h.ledger.snapshot().approvalRevision,1);
  assert.equal(h.ledger.snapshot().coveredPendingBillingCount,1);
  db.exec('DROP TRIGGER fail_carry');db.close();
  assert.equal(h.ledger.syncApproval(increasedBudget(),options).approvalRevision,2);
});

test('approval carry cannot hide another reservation overrun behind an operator pause',async t=>{
  const h=await setup(t);h.ledger.coverClosedDispatch(proof(h.ledger));
  h.ledger.reserve(another('other'));h.ledger.markAttempted('other');h.ledger.pauseOperator(H);
  h.ledger.reconcile({id:'other',actualCostMicros:250001,complete:true,evidenceDigest:J});
  const before=h.ledger.events();
  assert.throws(()=>h.ledger.syncApproval(increasedBudget(),carryOptions(h.ledger)),code('closed_dispatch_carry_rejected'));
  assert.deepEqual(h.ledger.events(),before);assert.equal(h.ledger.snapshot().approvalRevision,1);
});
