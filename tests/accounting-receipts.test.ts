import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { copyFile,mkdtemp,rm,stat,symlink,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { BudgetLedger,BudgetLedgerError } from '../packages/orchestrator/src/budget-ledger.ts';
import { AccountingReceiptImporter,AccountingReceiptSchema,accountingReceiptDigest,operationManifestDigest,cleanupObservationDigest,measuredUsdToMicros } from '../packages/orchestrator/src/accounting-receipts.ts';
import type { AccountingReceipt } from '../packages/orchestrator/src/accounting-receipts.ts';

const H='sha256:'+'a'.repeat(64),J='sha256:'+'b'.repeat(64),K='sha256:'+'c'.repeat(64),NOW='2026-09-27T16:00:00.000Z';
const budget=()=>({schemaVersion:'1.0',currency:'USD',maxApprovedSpendUsd:25,ownerApproval:{approvedBy:'unit',approvedAt:'2026-09-27T10:00:00.000Z',expiresAt:null,reference:'invented-unit'},verifiedCredits:[],
  stages:{smoke:5,pilot:20,evaluate:0,hosting:0},episodeLimits:{inferenceCallLimit:24,inputTokenLimit:null,outputTokenLimit:null,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:null,candidateBranchLimit:3},note:'unit-only'});
function receipt():AccountingReceipt{
  const operationManifest={inventoryComplete:true,operations:[{intentId:'intent/model/1',operationId:'response/model/1',status:'terminal' as const,evidenceDigest:H},
    {intentId:'intent/sandbox/1',operationId:'operation/sandbox/1',status:'terminal' as const,evidenceDigest:J}]};
  const cleanup={complete:true,unresolvedIntentIds:[],evidenceDigest:K};
  return{schemaVersion:'1.0',kind:'episode-accounting-reconciliation',id:'receipt-1',revision:1,previousReceiptDigest:null,expectedLedgerEvidenceDigest:null,
    binding:{reservationId:'reservation-unit',episodeId:'episode-unit',reservationFingerprint:H,stage:'pilot',reservedMicros:'2000000',sourceDigest:J,planDigest:K},
    operationManifest,cleanup,operationDigest:operationManifestDigest(operationManifest),cleanupDigest:cleanupObservationDigest(cleanup),
    observedThroughAt:'2026-09-27T15:00:00.000Z',issuedAt:'2026-09-27T15:01:00.000Z',validUntil:'2026-09-27T17:00:00.000Z',scope:'entire_episode_including_setup_retries_cleanup',
    billing:{currency:'USD',cumulativeUsd:'0.25',complete:true,evidenceDigest:H},cpu:{cumulativeSeconds:2.5,complete:true,evidenceDigest:J}};
}
function seal(value:AccountingReceipt){value.operationDigest=operationManifestDigest(value.operationManifest);value.cleanupDigest=cleanupObservationDigest(value.cleanup);return value;}
const context=(value:AccountingReceipt)=>({expectedBinding:structuredClone(value.binding),expectedOperationDigest:value.operationDigest,expectedCleanupDigest:value.cleanupDigest,acceptedReceiptDigests:[accountingReceiptDigest(value)]});
const recoveryContext=(value:AccountingReceipt)=>({expectedReceiptDigest:accountingReceiptDigest(value),acceptedReceiptDigests:[accountingReceiptDigest(value)]});
function seedPrepared(filename:string,value:AccountingReceipt){const database=new DatabaseSync(filename);try{
  database.prepare('INSERT INTO accounting_receipts(id,digest,reservation_id,revision,body_json,status,prepared_at) VALUES(?,?,?,?,?,?,?)').run(value.id,accountingReceiptDigest(value),value.binding.reservationId,value.revision,JSON.stringify(value),'prepared',NOW);
}finally{database.close();}}
function next(previous:AccountingReceipt){const value=structuredClone(previous);value.id='receipt-'+(previous.revision+1);value.revision++;value.previousReceiptDigest=accountingReceiptDigest(previous);value.expectedLedgerEvidenceDigest=accountingReceiptDigest(previous);return value;}
async function setup(t:TestContext){
  const dir=await mkdtemp(join(tmpdir(),'patchproof-accounting-unit-')),ledgerFile=join(dir,'budget.sqlite'),importFile=join(dir,'receipts.sqlite');
  const ledgers=new Set<BudgetLedger>(),importers=new Set<AccountingReceiptImporter>();
  const openLedger=()=>{const ledger=new BudgetLedger({filename:ledgerFile,budget:budget(),now:()=>new Date('2026-09-27T12:00:00.000Z')});ledgers.add(ledger);return ledger;};
  const ledger=openLedger();ledger.reserve({id:'reservation-unit',episodeId:'episode-unit',stage:'pilot',amountMicros:2_000_000,fingerprint:H});ledger.markAttempted('reservation-unit');
  const open=(instance:BudgetLedger=ledger,now=NOW)=>{const importer=new AccountingReceiptImporter({filename:importFile,ledger:instance,now:()=>new Date(now)});importers.add(importer);return importer;};
  const close=(importer:AccountingReceiptImporter)=>{importer.close();importers.delete(importer);};
  t.after(async()=>{for(const importer of importers)importer.close();for(const instance of ledgers)instance.close();await rm(dir,{recursive:true,force:true});});
  return{dir,ledgerFile,importFile,ledger,openLedger,open,close};
}

test('complete accepted receipt releases only unused hold and persists measured CPU and bindings',async t=>{
  const {ledger,open,importFile}=await setup(t),importer=open(),value=receipt();
  const result=importer.import(value,context(value));assert.equal(result.status,'applied');assert.equal(result.authenticityVerified,false);assert.equal(result.recordedCpuSeconds,2.5);
  assert.equal(result.reservation.actualCostMicros,'250000');assert.equal(result.reservation.heldMicros,'0');assert.equal(result.reservation.state,'reconciled');
  assert.equal(ledger.markAttempted('reservation-unit').dispatchGranted,false);assert.equal(importer.history('reservation-unit').length,1);
  assert.equal((await stat(importFile)).mode&0o777,0o600);
});

test('exact decimal USD rounds upward only at the ledger boundary and rejects unknown units',async t=>{
  assert.equal(measuredUsdToMicros('0.29'),290000n);assert.equal(measuredUsdToMicros('0.000000000000000001'),1n);
  for(const value of ['NaN','Infinity','-1','1e-6','01','0.0000000000000000001'])assert.throws(()=>measuredUsdToMicros(value));
  const {open,ledger}=await setup(t),importer=open(),value=receipt();
  assert.throws(()=>importer.import({...value,billing:{...value.billing,currency:'CREDITS'}},context(value)));
  assert.throws(()=>importer.import({...value,candidateFiles:{'unit':'data'}},context(value)));
  assert.equal(ledger.get('reservation-unit').heldMicros,'2000000');
});

test('receipt labels and hashes alone cannot satisfy independent accepted-digest ingestion',async t=>{
  const {open,ledger}=await setup(t),importer=open(),value=receipt(),trusted=context(value);
  trusted.acceptedReceiptDigests=[J];assert.throws(()=>importer.import(value,trusted),/not been accepted/);
  assert.throws(()=>importer.import(value,{...context(value),trusted:true}));assert.equal(ledger.snapshot().chargedMicros,'0');
});

test('reservation identity, stage, fingerprint and amount match the ledger exactly',async t=>{
  const {open,ledger}=await setup(t),importer=open();
  for(const change of[{episodeId:'other'},{reservationFingerprint:J},{reservedMicros:'3000000'},{stage:'smoke' as const}]){
    const value=receipt();Object.assign(value.binding,change);assert.throws(()=>importer.import(value,context(value)),/Reservation binding/);
  }
  const missing=receipt();missing.binding.reservationId='unrecognized';assert.throws(()=>importer.import(missing,context(missing)),error=>error instanceof BudgetLedgerError&&error.code==='reservation_not_found');
  assert.equal(ledger.get('reservation-unit').heldMicros,'2000000');
});

test('source, plan, operation and cleanup bindings come from independent expected context',async t=>{
  const {open}=await setup(t),importer=open(),original=receipt();
  for(const key of ['sourceDigest','planDigest'] as const){const value=receipt();value.binding[key]=H;const expected=context(original);expected.acceptedReceiptDigests=[accountingReceiptDigest(value)];assert.throws(()=>importer.import(value,expected),/binding mismatch/);}
  for(const key of['expectedOperationDigest','expectedCleanupDigest']as const)assert.throws(()=>importer.import(original,{...context(original),[key]:H}),/binding mismatch/);
  assert.throws(()=>importer.import({...original,operationDigest:H},context(original)),/digest mismatch/);
});

test('unknown units, incomplete CPU, and unresolved lost intents retain holds',async t=>{
  const {open,ledger}=await setup(t),importer=open(),value=receipt();
  value.billing={currency:null,cumulativeUsd:null,complete:false,evidenceDigest:null};value.cpu={cumulativeSeconds:null,complete:false,evidenceDigest:null};
  value.operationManifest.operations[1]={intentId:'intent/sandbox/1',operationId:null,status:'unknown',evidenceDigest:null};
  value.cleanup={complete:false,unresolvedIntentIds:['intent/sandbox/1'],evidenceDigest:null};seal(value);
  importer.import(value,context(value));assert.equal(ledger.get('reservation-unit').heldMicros,'2000000');assert.equal(ledger.snapshot().pendingBillingCount,1);
  assert.throws(()=>ledger.reserve({id:'next',episodeId:'next',stage:'pilot',amountMicros:1,fingerprint:H}),error=>error instanceof BudgetLedgerError&&error.code==='billing_pending');
  const resolved=next(value);resolved.billing=receipt().billing;resolved.cpu=receipt().cpu;resolved.operationManifest=receipt().operationManifest;resolved.cleanup=receipt().cleanup;seal(resolved);
  importer.import(resolved,context(resolved));assert.equal(ledger.get('reservation-unit').heldMicros,'0');
});

test('complete billing with incomplete cleanup records real charges without releasing the remainder',async t=>{
  const {open,ledger}=await setup(t),importer=open(),value=receipt();value.cleanup={complete:false,unresolvedIntentIds:['unconfirmed/new-intent'],evidenceDigest:null};seal(value);
  importer.import(value,context(value));assert.equal(ledger.snapshot().chargedMicros,'250000');assert.equal(ledger.snapshot().heldMicros,'1750000');
  const forgotten=next(value);forgotten.cleanup=receipt().cleanup;seal(forgotten);assert.throws(()=>importer.import(forgotten,context(forgotten)),/Unresolved intent disappeared/);
  const resolved=next(value);resolved.operationManifest.operations.push({intentId:'unconfirmed/new-intent',operationId:null,status:'confirmed_not_created',evidenceDigest:J});resolved.cleanup=receipt().cleanup;seal(resolved);
  importer.import(resolved,context(resolved));assert.equal(ledger.snapshot().heldMicros,'0');
});

test('malformed complete claims never close unknown or active operations',async t=>{
  const {open,ledger}=await setup(t),importer=open();
  for(const status of['unknown','active']as const){const value=receipt();value.operationManifest.operations[0]!.status=status;seal(value);assert.throws(()=>AccountingReceiptSchema.parse(value),/Cleanup cannot complete/);}
  const value=receipt();value.billing.cumulativeUsd=null;assert.throws(()=>importer.import(value,{}));assert.equal(ledger.snapshot().heldMicros,'2000000');
});

test('duplicate import remains idempotent after reopening and after expiry without new ledger writes',async t=>{
  const {open,close,ledger}=await setup(t),value=receipt();let importer=open();importer.import(value,context(value));const before=ledger.events().length;close(importer);
  importer=open(ledger,'2026-09-28T16:00:00.000Z');assert.equal(importer.import(value,context(value)).status,'already_applied');assert.equal(ledger.events().length,before);
  const changed=receipt();changed.billing.cumulativeUsd='0.30';assert.throws(()=>importer.import(changed,context(changed)),/ID is bound/);
});

test('future, expired, predating and stale revisions fail without releasing holds',async t=>{
  const {open,ledger}=await setup(t),importer=open();
  for(const change of[{issuedAt:'2026-09-27T16:30:00.000Z'},{validUntil:NOW},{observedThroughAt:'2026-09-27T11:00:00.000Z'},{revision:2}]){
    const value=Object.assign(receipt(),change);assert.throws(()=>importer.import(value,context(value)));
  }
  assert.equal(ledger.snapshot().heldMicros,'2000000');assert.equal(importer.history('reservation-unit').length,0);
});

test('cumulative USD and CPU never decrease, including sub-microdollar USD observations',async t=>{
  const {open,ledger}=await setup(t),importer=open(),value=receipt();value.billing.cumulativeUsd='0.0000009';importer.import(value,context(value));
  const money=next(value);money.billing.cumulativeUsd='0.0000001';assert.throws(()=>importer.import(money,context(money)),/Cumulative USD/);
  const cpu=next(value);cpu.cpu.cumulativeSeconds=2;assert.throws(()=>importer.import(cpu,context(cpu)),/Cumulative CPU/);
  assert.equal(ledger.snapshot().chargedMicros,'1');assert.equal(importer.history('reservation-unit').length,1);
});

test('resolved operation observations cannot regress or disappear',async t=>{
  const {open}=await setup(t),importer=open(),value=receipt();importer.import(value,context(value));
  for(const status of['unknown','active']as const){const changed=next(value);changed.operationManifest.operations[0]!.status=status;changed.cleanup.complete=false;seal(changed);assert.throws(()=>importer.import(changed,context(changed)),/Resolved operation proof/);}
  const evidence=next(value);evidence.operationManifest.operations[0]!.evidenceDigest=K;seal(evidence);assert.throws(()=>importer.import(evidence,context(evidence)),/Resolved operation proof/);
  const missing=next(value);missing.operationManifest.operations.pop();seal(missing);assert.throws(()=>importer.import(missing,context(missing)),/identity disappeared/);
});

test('later measurement uncertainty restores a hold without erasing totals or reopening dispatch',async t=>{
  const {open,ledger}=await setup(t),importer=open(),first=receipt();importer.import(first,context(first));
  const uncertain=next(first);uncertain.billing.complete=false;uncertain.cpu.complete=false;importer.import(uncertain,context(uncertain));
  assert.equal(ledger.get('reservation-unit').state,'reconciled');assert.equal(ledger.get('reservation-unit').actualCostMicros,'250000');
  assert.equal(ledger.get('reservation-unit').heldMicros,'1750000');assert.equal(ledger.snapshot().pendingBillingCount,1);
  assert.equal(ledger.markAttempted('reservation-unit').dispatchGranted,false);assert.equal(importer.history('reservation-unit').length,2);
  const complete=next(uncertain);complete.billing.complete=true;complete.cpu.complete=true;importer.import(complete,context(complete));assert.equal(ledger.get('reservation-unit').heldMicros,'0');
});

test('confirmed-not-created identity remains resolved and long slash handles remain accepted',async t=>{
  const {open}=await setup(t),importer=open(),value=receipt();value.operationManifest.operations[0]={intentId:'x/'+ 'a'.repeat(198),operationId:null,status:'confirmed_not_created',evidenceDigest:H};seal(value);
  importer.import(value,context(value));const changed=next(value);changed.operationManifest.operations[0]!.status='unknown';changed.cleanup.complete=false;seal(changed);
  assert.throws(()=>importer.import(changed,context(changed)),/Resolved operation proof/);
});

test('higher late cumulative costs are retained and cannot thaw a reservation overrun',async t=>{
  const {open,ledger}=await setup(t),importer=open(),value=receipt();value.billing.cumulativeUsd='3';importer.import(value,context(value));
  assert.equal(ledger.snapshot().chargedMicros,'3000000');assert.ok(ledger.snapshot().freezeReasons.includes('reservation_overrun'));
  const later=next(value);later.billing.cumulativeUsd='4';later.cpu.cumulativeSeconds=3;importer.import(later,context(later));
  assert.equal(ledger.snapshot().chargedMicros,'4000000');assert.ok(ledger.snapshot().freezeReasons.includes('reservation_overrun'));
  assert.equal(ledger.markAttempted('reservation-unit').dispatchGranted,false);
});

test('ledger CAS rejects a stale writer while legacy explicit reconciliation remains compatible',async t=>{
  const {ledger,openLedger}=await setup(t),other=openLedger();other.reconcile({id:'reservation-unit',actualCostMicros:100000,complete:false,evidenceDigest:J});
  assert.throws(()=>ledger.reconcile({id:'reservation-unit',actualCostMicros:250000,complete:true,evidenceDigest:H,expectedEvidenceDigest:null}),error=>error instanceof BudgetLedgerError&&error.code==='reconciliation_conflict');
  assert.equal(ledger.snapshot().heldMicros,'1900000');ledger.reconcile({id:'reservation-unit',actualCostMicros:250000,complete:false,evidenceDigest:K});
  assert.equal(other.snapshot().chargedMicros,'250000');assert.equal(other.snapshot().heldMicros,'1750000');
});

test('another connection changing evidence immediately before import commit cannot lose its hold',async t=>{
  const {ledgerFile,openLedger,open}=await setup(t),other=openLedger();
  class ConcurrentLedger extends BudgetLedger{override reconcile(value:unknown){other.reconcile({id:'reservation-unit',actualCostMicros:100000,complete:false,evidenceDigest:J});return super.reconcile(value);}}
  const racing=new ConcurrentLedger({filename:ledgerFile,budget:budget(),now:()=>new Date(NOW)});t.after(()=>racing.close());const importer=open(racing),value=receipt();
  assert.throws(()=>importer.import(value,context(value)),error=>error instanceof BudgetLedgerError&&error.code==='reconciliation_conflict');
  assert.equal(other.snapshot().heldMicros,'1900000');assert.equal(importer.history('reservation-unit')[0]!.status,'rejected');
});

test('accepted incomplete receipt persists across ledger/importer reopening and cancellation',async t=>{
  const {open,close,ledger,openLedger}=await setup(t),value=receipt();value.cleanup.complete=false;seal(value);let importer=open();importer.import(value,context(value));ledger.cancel('reservation-unit');close(importer);
  const reopened=openLedger();importer=open(reopened);assert.equal(importer.import(value,context(value)).status,'already_applied');
  assert.equal(reopened.snapshot().heldMicros,'1750000');assert.equal(reopened.snapshot().pendingBillingCount,1);
});

test('crash after ledger commit recovers the prepared receipt exactly once',{timeout:15000},async t=>{
  const {dir,ledgerFile,importFile,open,ledger}=await setup(t),value=receipt(),script=join(dir,'crash.mjs');
  await writeFile(script,`import { BudgetLedger } from ${JSON.stringify(new URL('../packages/orchestrator/src/budget-ledger.ts',import.meta.url).href)};
import { AccountingReceiptImporter } from ${JSON.stringify(new URL('../packages/orchestrator/src/accounting-receipts.ts',import.meta.url).href)};
class CrashLedger extends BudgetLedger{reconcile(value){const result=super.reconcile(value);process.exit(17);return result;}}
const ledger=new CrashLedger({filename:process.argv[2],budget:${JSON.stringify(budget())},now:()=>new Date(${JSON.stringify(NOW)})});
const importer=new AccountingReceiptImporter({filename:process.argv[3],ledger,now:()=>new Date(${JSON.stringify(NOW)})});
importer.import(${JSON.stringify(value)},${JSON.stringify(context(value))});`,{mode:0o600});
  await assert.rejects(promisify(execFile)(process.execPath,[script,ledgerFile,importFile],{env:{}}),{code:17});
  assert.equal(ledger.get('reservation-unit').actualCostMicros,'250000');const eventCount=ledger.events().length;
  const importer=open(ledger,'2026-09-28T16:00:00.000Z');assert.equal(importer.history('reservation-unit')[0]!.status,'prepared');
  assert.equal(importer.import(value,context(value)).status,'applied');assert.equal(importer.history('reservation-unit')[0]!.status,'applied');
  assert.equal(ledger.events().length,eventCount);
});

test('private registry refuses symlink parents and sidecars',async t=>{
  const {dir,ledger}=await setup(t),alias=join(dir,'alias');await symlink(dir,alias);
  assert.throws(()=>new AccountingReceiptImporter({filename:join(alias,'other.sqlite'),ledger}),/symlinks/);
  const target=join(dir,'untouched'),filename=join(dir,'other.sqlite');await writeFile(target,'unit-only');await symlink(target,filename+'-wal');
  assert.throws(()=>new AccountingReceiptImporter({filename,ledger}),/regular files/);
});

test('expired prepared receipt is fenced without release, then a reviewed next revision can apply',async t=>{
  const {open,importFile,ledger,openLedger}=await setup(t),importer=open(undefined,'2026-09-28T16:00:00.000Z'),value=receipt();seedPrepared(importFile,value);
  assert.throws(()=>importer.import(value,context(value)),/expired/);
  const recovery=importer.recoverExpiredPrepared(value.id,recoveryContext(value));assert.equal(recovery.status,'rejected');assert.equal(recovery.reservation.heldMicros,'2000000');
  const stale=openLedger();assert.throws(()=>stale.reconcile({id:value.binding.reservationId,actualCostMicros:250000,complete:true,evidenceDigest:accountingReceiptDigest(value),expectedEvidenceDigest:null}),error=>error instanceof BudgetLedgerError&&error.code==='reconciliation_conflict');
  assert.equal(ledger.snapshot().heldMicros,'2000000');assert.equal(importer.history('reservation-unit')[0]!.status,'rejected');
  const revised=next(value);revised.expectedLedgerEvidenceDigest=recovery.reservation.evidenceDigest;revised.observedThroughAt='2026-09-28T15:00:00.000Z';revised.issuedAt='2026-09-28T15:01:00.000Z';revised.validUntil='2026-09-28T17:00:00.000Z';
  assert.equal(importer.import(revised,context(revised)).status,'applied');assert.equal(ledger.snapshot().heldMicros,'0');assert.equal(importer.history('reservation-unit').length,2);
});

test('expired recovery recognizes an old writer that won the ledger CAS and finalizes its journal',async t=>{
  const {open,importFile,ledgerFile,openLedger}=await setup(t),other=openLedger(),value=receipt();let raced=false;
  class WinningLedger extends BudgetLedger{override reconcile(input:unknown){if(!raced){raced=true;other.reconcile({id:value.binding.reservationId,actualCostMicros:250000,complete:true,evidenceDigest:accountingReceiptDigest(value),expectedEvidenceDigest:null});}return super.reconcile(input);}}
  const ledger=new WinningLedger({filename:ledgerFile,budget:budget(),now:()=>new Date(NOW)});t.after(()=>ledger.close());
  const importer=open(ledger,'2026-09-28T16:00:00.000Z');seedPrepared(importFile,value);
  assert.equal(importer.recoverExpiredPrepared(value.id,recoveryContext(value)).status,'applied');assert.equal(importer.history('reservation-unit')[0]!.status,'applied');
  assert.equal(other.get('reservation-unit').heldMicros,'0');assert.equal(other.get('reservation-unit').actualCostMicros,'250000');
});

test('crash after recovery tombstone cannot permit the old prepared writer or strand the next revision',{timeout:15000},async t=>{
  const {dir,ledgerFile,importFile,open,ledger}=await setup(t),value=receipt(),importer=open(undefined,'2026-09-28T16:00:00.000Z');seedPrepared(importFile,value);
  const script=join(dir,'recovery-crash.mjs');await writeFile(script,`import { BudgetLedger } from ${JSON.stringify(new URL('../packages/orchestrator/src/budget-ledger.ts',import.meta.url).href)};
import { AccountingReceiptImporter } from ${JSON.stringify(new URL('../packages/orchestrator/src/accounting-receipts.ts',import.meta.url).href)};
class CrashLedger extends BudgetLedger{reconcile(value){const result=super.reconcile(value);process.exit(17);return result;}}
const ledger=new CrashLedger({filename:process.argv[2],budget:${JSON.stringify(budget())},now:()=>new Date('2026-09-28T16:00:00.000Z')});
const importer=new AccountingReceiptImporter({filename:process.argv[3],ledger,now:()=>new Date('2026-09-28T16:00:00.000Z')});
importer.recoverExpiredPrepared(${JSON.stringify(value.id)},${JSON.stringify(recoveryContext(value))});`,{mode:0o600});
  await assert.rejects(promisify(execFile)(process.execPath,[script,ledgerFile,importFile],{env:{}}),{code:17});
  assert.equal(importer.history('reservation-unit')[0]!.status,'prepared');assert.equal(ledger.snapshot().heldMicros,'2000000');const count=ledger.events().length;
  assert.equal(importer.recoverExpiredPrepared(value.id,recoveryContext(value)).status,'rejected');assert.equal(ledger.events().length,count);
  assert.throws(()=>ledger.reconcile({id:value.binding.reservationId,actualCostMicros:250000,complete:true,evidenceDigest:accountingReceiptDigest(value),expectedEvidenceDigest:null}),error=>error instanceof BudgetLedgerError&&error.code==='reconciliation_conflict');
});

test('unexpired prepared writes cannot be abandoned and recovery never accepts unknown trust',async t=>{
  const {open,importFile,ledger}=await setup(t),importer=open(),value=receipt();seedPrepared(importFile,value);
  assert.throws(()=>importer.recoverExpiredPrepared(value.id,recoveryContext(value)),/Only expired/);
  assert.throws(()=>importer.recoverExpiredPrepared(value.id,{expectedReceiptDigest:H,acceptedReceiptDigests:[H]}),/exact accepted/);
  assert.equal(ledger.snapshot().heldMicros,'2000000');
});

test('a different importer journal cannot reset receipt revisions or CPU history for the same ledger',async t=>{
  const {dir,open,ledger}=await setup(t),importer=open(),value=receipt();importer.import(value,context(value));
  assert.throws(()=>new AccountingReceiptImporter({filename:join(dir,'replacement.sqlite'),ledger}),error=>error instanceof BudgetLedgerError&&error.code==='accounting_journal_mismatch');
  assert.equal(importer.history('reservation-unit').length,1);assert.equal(ledger.get('reservation-unit').actualCostMicros,'250000');
});

test('the same importer journal cannot silently attach to another ledger, even with reused IDs',async t=>{
  const {dir,open,importFile}=await setup(t),importer=open(),value=receipt();importer.import(value,context(value));
  const other=new BudgetLedger({filename:join(dir,'different-ledger.sqlite'),budget:budget(),now:()=>new Date(NOW)});t.after(()=>other.close());
  other.reserve({id:'reservation-unit',episodeId:'different-episode',stage:'pilot',amountMicros:2_000_000,fingerprint:J});
  assert.throws(()=>new AccountingReceiptImporter({filename:importFile,ledger:other}),error=>error instanceof BudgetLedgerError&&error.code==='accounting_journal_mismatch');
  assert.equal(other.get('reservation-unit').actualCostMicros,null);
});

test('old applied duplicate returns its historical identity and current higher charges without writes',async t=>{
  const {open,ledger}=await setup(t),importer=open(),first=receipt();importer.import(first,context(first));
  const later=next(first);later.billing.cumulativeUsd='0.50';later.cpu.cumulativeSeconds=4;importer.import(later,context(later));
  const count=ledger.events().length,result=importer.import(first,context(first));assert.equal(result.status,'already_applied');
  assert.equal(result.revision,1);assert.equal(result.recordedCpuSeconds,2.5);assert.equal(result.reservation.actualCostMicros,'500000');assert.equal(ledger.events().length,count);
});

test('old copies of the same logical journal cannot omit anchored revision and CPU history',async t=>{
  for(const beforeFirst of[true,false]){
    const {dir,open,close,importFile,ledger}=await setup(t),first=receipt();let importer=open();
    if(!beforeFirst)importer.import(first,context(first));close(importer);const staleFile=join(dir,'stale-copy.sqlite');await copyFile(importFile,staleFile);
    importer=open();if(beforeFirst)importer.import(first,context(first));
    const later=next(first);later.cpu.cumulativeSeconds=20;importer.import(later,context(later));
    const stale=new AccountingReceiptImporter({filename:staleFile,ledger,now:()=>new Date(NOW)});t.after(()=>stale.close());
    const regressed=beforeFirst?receipt():next(first);regressed.cpu.cumulativeSeconds=3;regressed.expectedLedgerEvidenceDigest=accountingReceiptDigest(later);
    const current=ledger.get('reservation-unit'),count=ledger.events().length;
    assert.throws(()=>stale.import(regressed,context(regressed)),error=>error instanceof BudgetLedgerError&&error.code==='accounting_history_conflict');
    assert.deepEqual(ledger.get('reservation-unit'),current);assert.equal(ledger.events().length,count);
  }
});

test('crash after a receipt anchor retains prepared recovery and cannot skip its history',{timeout:15000},async t=>{
  const {dir,ledgerFile,importFile,open,ledger}=await setup(t),value=receipt(),script=join(dir,'anchor-crash.mjs');
  await writeFile(script,`import { BudgetLedger } from ${JSON.stringify(new URL('../packages/orchestrator/src/budget-ledger.ts',import.meta.url).href)};
import { AccountingReceiptImporter } from ${JSON.stringify(new URL('../packages/orchestrator/src/accounting-receipts.ts',import.meta.url).href)};
class CrashLedger extends BudgetLedger{anchorAccountingReceipt(value){super.anchorAccountingReceipt(value);process.exit(17);}}
const ledger=new CrashLedger({filename:process.argv[2],budget:${JSON.stringify(budget())},now:()=>new Date(${JSON.stringify(NOW)})});
const importer=new AccountingReceiptImporter({filename:process.argv[3],ledger,now:()=>new Date(${JSON.stringify(NOW)})});
importer.import(${JSON.stringify(value)},${JSON.stringify(context(value))});`,{mode:0o600});
  await assert.rejects(promisify(execFile)(process.execPath,[script,ledgerFile,importFile],{env:{}}),{code:17});
  assert.equal(ledger.get('reservation-unit').actualCostMicros,null);assert.equal(ledger.get('reservation-unit').heldMicros,'2000000');
  const importer=open(ledger,'2026-09-28T16:00:00.000Z');assert.equal(importer.history('reservation-unit')[0]!.status,'prepared');
  const recovered=importer.recoverExpiredPrepared(value.id,recoveryContext(value));assert.equal(recovered.status,'rejected');assert.equal(recovered.reservation.heldMicros,'2000000');
  const revised=next(value);revised.expectedLedgerEvidenceDigest=recovered.reservation.evidenceDigest;revised.observedThroughAt='2026-09-28T15:00:00.000Z';revised.issuedAt='2026-09-28T15:01:00.000Z';revised.validUntil='2026-09-28T17:00:00.000Z';
  assert.equal(importer.import(revised,context(revised)).status,'applied');
});
