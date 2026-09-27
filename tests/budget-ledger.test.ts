import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BudgetLedger, BudgetLedgerError, usdToMicros } from '../packages/orchestrator/src/budget-ledger.ts';

const NOW = '2026-09-27T15:00:00.000Z';
const HASH = 'sha256:' + 'a'.repeat(64), EVIDENCE = 'sha256:' + 'b'.repeat(64);
const budget = () => ({ schemaVersion:'1.0',currency:'USD',maxApprovedSpendUsd:25,
  ownerApproval:{ approvedBy:'unit-test-owner',approvedAt:'2026-09-27T10:00:00.000Z',expiresAt:null as string|null,reference:'private-owner-reference' },
  verifiedCredits:[] as { service:string;amountUsd:number;verifiedAt:string;expiresAt:string;evidenceRef:string }[],
  stages:{ smoke:5,pilot:20,evaluate:0,hosting:0 }, episodeLimits:{ inferenceCallLimit:24,inputTokenLimit:null,
    outputTokenLimit:null,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:null,candidateBranchLimit:3 },note:'private accounting note' });
const request = (id:string,amountMicros:number|bigint = 1_000_000,stage = 'smoke') => ({ id,episodeId:'episode-'+id,stage,amountMicros,fingerprint:HASH });
const billed = (id:string,actualCostMicros:number|bigint|null,complete=true) => ({ id,actualCostMicros,complete,evidenceDigest:EVIDENCE });
const code = (expected:string) => (error:unknown) => error instanceof BudgetLedgerError && error.code===expected;

async function setup(t:TestContext) {
  const dir = await mkdtemp(join(tmpdir(),'patchproof-budget-test-'));
  const filename = join(dir,'private','budget.sqlite');
  const connections = new Set<BudgetLedger>();
  const open = (config:unknown=budget(),now:()=>Date=()=>new Date(NOW)) => {
    const ledger = new BudgetLedger({ filename,budget:config,now });connections.add(ledger);return ledger;
  };
  const close = (ledger:BudgetLedger) => { ledger.close();connections.delete(ledger); };
  t.after(async()=>{ for (const ledger of connections) ledger.close();await rm(dir,{ recursive:true,force:true }); });
  return { dir,filename,open,close };
}

test('USD conversion is decimal-exact and rejects implicit fractional-micro rounding',()=>{
  assert.equal(usdToMicros(0.29),290_000n);
  assert.equal(usdToMicros(0.1),100_000n);
  assert.equal(usdToMicros(0.000001),1n);
  assert.equal(usdToMicros(0.0000001,'ceil'),1n);
  for (const amount of [NaN,Infinity,-1,0.0000001,1e20]) assert.throws(()=>usdToMicros(amount),code('invalid_amount'));
  assert.throws(()=>usdToMicros(0.0000001,'unsafe' as 'ceil'),code('invalid_amount'));
});

test('ledger reads the project schema, keeps approved stage ceilings, and creates private files',async t=>{
  const { filename,open } = await setup(t), ledger=open(), snapshot=ledger.snapshot();
  assert.equal(snapshot.approvedMicros,'25000000');
  assert.equal(snapshot.stages.smoke.approvedMicros,'5000000');
  assert.equal(snapshot.stages.pilot.approvedMicros,'20000000');
  assert.equal(snapshot.stages.evaluate.approvedMicros,'0');
  assert.equal(snapshot.stages.hosting.approvedMicros,'0');
  assert.equal(snapshot.chargedMicros,'0');assert.equal(snapshot.frozen,false);
  assert.equal((await stat(filename)).mode & 0o777,0o600);
  assert.equal((await stat(dirname(filename))).mode & 0o777,0o700);
  for (const suffix of ['-wal','-shm']) assert.equal((await stat(filename+suffix)).mode & 0o777,0o600);
  assert.doesNotMatch(JSON.stringify(snapshot),/private-owner-reference|private accounting note/);
  assert.throws(()=>ledger.reserve(request('final',1,'evaluate')),code('budget_exceeded'));
  assert.throws(()=>ledger.reserve(request('hosting',1,'hosting')),code('budget_exceeded'));
});

test('separate connections enforce durable stage and aggregate reservations without float loss',async t=>{
  const { open }=await setup(t), a=open(),b=open();
  a.reserve(request('smoke',5_000_000));b.reserve(request('pilot',20_000_000,'pilot'));
  assert.equal(a.snapshot().committedMicros,'25000000');assert.equal(b.snapshot().availableMicros,'0');
  assert.throws(()=>a.reserve(request('extra',1)),code('budget_exceeded'));
  assert.equal(b.snapshot().reservationCount,2);
  assert.equal(b.events().filter(event=>event.kind==='reserved').length,2);
});

test('IDs bind immutable request fingerprints and each episode has one aggregate allowance',async t=>{
  const { open }=await setup(t),ledger=open(), original=request('repeat');
  assert.equal(ledger.reserve(original).created,true);
  assert.equal(ledger.reserve({ ...original,amountMicros:1_000_000n }).created,false);
  for (const change of [{ amountMicros:2_000_000 },{ stage:'pilot' },{ fingerprint:EVIDENCE },{ episodeId:'different' }]) {
    assert.throws(()=>ledger.reserve({ ...original,...change }),code('idempotency_conflict'));
  }
  assert.throws(()=>ledger.reserve({ ...original,id:'second-id' }),code('episode_already_reserved'));
  assert.equal(ledger.snapshot().committedMicros,'1000000');assert.equal(ledger.events().length,2);
});

test('runtime input validation rejects unbounded, nonfinite and partial reservations',async t=>{
  const { open }=await setup(t),ledger=open();
  for (const amountMicros of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,9_223_372_036_854_775_808n]) {
    assert.throws(()=>ledger.reserve({ ...request('bad'),amountMicros }));
  }
  assert.throws(()=>ledger.reserve({ id:'bad' }));
  assert.throws(()=>ledger.reserve({ ...request('bad'),unexpected:true }));
  assert.equal(ledger.snapshot().reservationCount,0);assert.equal(ledger.events().length,1);
});

test('attempt, unknown billing and cancellation survive restart and never silently release money',async t=>{
  const { open,close }=await setup(t);let ledger=open();
  ledger.reserve(request('attempt',3_000_000));ledger.reserve(request('waiting',1_000_000));
  assert.equal(ledger.markAttempted('attempt').dispatchGranted,true);
  assert.equal(ledger.markAttempted('attempt').dispatchGranted,false);
  assert.throws(()=>ledger.markAttempted('waiting'),code('billing_pending'));
  assert.throws(()=>ledger.reserve(request('new',1)),code('billing_pending'));
  ledger.reconcile(billed('attempt',null,false));ledger.cancel('attempt');close(ledger);ledger=open();
  assert.equal(ledger.get('attempt').state,'cancelled');assert.equal(ledger.get('attempt').heldMicros,'3000000');
  assert.equal(ledger.snapshot().pendingBillingCount,1);assert.equal(ledger.snapshot().committedMicros,'4000000');
  assert.equal(ledger.markAttempted('attempt').dispatchGranted,false);
  ledger.reconcile(billed('attempt',1_000_000,false));
  assert.equal(ledger.get('attempt').heldMicros,'2000000');assert.equal(ledger.snapshot().committedMicros,'4000000');
  assert.throws(()=>ledger.reserve(request('new',1)),code('billing_pending'));
  ledger.reconcile(billed('attempt',1_000_000));
  assert.equal(ledger.snapshot().committedMicros,'2000000');assert.equal(ledger.snapshot().pendingBillingCount,0);
  assert.equal(ledger.markAttempted('waiting').dispatchGranted,true);
  assert.equal(ledger.events().filter(event=>event.kind==='dispatch_attempted').length,2);
  assert.deepEqual(ledger.events().map(event=>event.sequence),[1,2,3,4,5,6,7,8,9]);
});

test('even unattempted cancellation retains the hold until explicit zero-cost reconciliation',async t=>{
  const { open }=await setup(t),ledger=open();ledger.reserve(request('cancel',5_000_000));
  assert.equal(ledger.cancel('cancel').heldMicros,'5000000');assert.equal(ledger.cancel('cancel').heldMicros,'5000000');
  assert.throws(()=>ledger.markAttempted('cancel'),code('invalid_reservation_state'));
  assert.throws(()=>ledger.reserve(request('other',1)),code('budget_exceeded'));
  assert.throws(()=>ledger.reconcile(billed('cancel',null,true)));
  ledger.reconcile(billed('cancel',0));assert.equal(ledger.snapshot().committedMicros,'0');
  const count=ledger.events().length;ledger.reconcile(billed('cancel',0));assert.equal(ledger.events().length,count);
  ledger.reserve(request('other',5_000_000));assert.equal(ledger.snapshot().committedMicros,'5000000');
});

test('explicit uncertain billing blocks dispatch even when an attempted marker was missing',async t=>{
  const { open }=await setup(t),ledger=open();ledger.reserve(request('uncertain'));ledger.reserve(request('waiting'));
  ledger.reconcile(billed('uncertain',null,false));
  assert.equal(ledger.snapshot().pendingBillingCount,1);
  assert.throws(()=>ledger.markAttempted('waiting'),code('billing_pending'));
  assert.throws(()=>ledger.reserve(request('new')),code('billing_pending'));
});

test('late incomplete billing cannot resurrect a reconciled episode for dispatch',async t=>{
  const { open }=await setup(t),ledger=open();ledger.reserve(request('terminal'));
  ledger.reconcile(billed('terminal',0));
  const pending=ledger.reconcile({ ...billed('terminal',0,false),evidenceDigest:HASH });
  assert.equal(pending.state,'reconciled');assert.equal(pending.heldMicros,'1000000');
  assert.equal(ledger.snapshot().pendingBillingCount,1);
  assert.throws(()=>ledger.markAttempted('terminal'),code('invalid_reservation_state'));
  assert.throws(()=>ledger.reserve(request('new')),code('billing_pending'));
  ledger.reconcile(billed('terminal',0));
  assert.throws(()=>ledger.markAttempted('terminal'),code('invalid_reservation_state'));
});

test('overrun is retained beyond the reservation and freezes future spending across restarts',async t=>{
  const { open,close }=await setup(t);let ledger=open();
  ledger.reserve(request('overrun',2_000_000));ledger.markAttempted('overrun');
  ledger.reconcile(billed('overrun',7_000_000));close(ledger);ledger=open();
  const snapshot=ledger.snapshot();assert.equal(snapshot.chargedMicros,'7000000');assert.equal(snapshot.heldMicros,'0');
  assert.equal(snapshot.committedMicros,'7000000');assert.equal(snapshot.stages.smoke.availableMicros,'0');
  assert.ok(snapshot.freezeReasons.includes('reservation_overrun'));assert.ok(snapshot.freezeReasons.includes('approved_cap_below_commitment'));
  assert.throws(()=>ledger.reserve(request('blocked',1,'pilot')),code('reservation_overrun'));
  assert.throws(()=>ledger.reconcile(billed('overrun',2_000_000)),code('charge_regression'));
  assert.throws(()=>ledger.reconcile(billed('overrun',null,false)),code('charge_regression'));
  const next=budget();next.stages={ smoke:10,pilot:15,evaluate:0,hosting:0 };
  ledger.syncApproval(next,{ expectedRevision:1 });
  assert.ok(ledger.snapshot().freezeReasons.includes('reservation_overrun'));
  assert.throws(()=>ledger.reserve(request('still-blocked',1)),code('reservation_overrun'));
});

test('late increased billing remains recorded and positive charges without dispatch freeze accounting',async t=>{
  const { open }=await setup(t),ledger=open();ledger.reserve(request('late'));ledger.markAttempted('late');
  ledger.reconcile(billed('late',500_000));ledger.reconcile(billed('late',2_000_000));
  assert.equal(ledger.snapshot().chargedMicros,'2000000');assert.ok(ledger.snapshot().freezeReasons.includes('reservation_overrun'));
});

test('charge without a recorded dispatch is never discarded',async t=>{
  const { open }=await setup(t),ledger=open();ledger.reserve(request('unrecorded'));
  ledger.reconcile(billed('unrecorded',250_000));
  assert.equal(ledger.snapshot().chargedMicros,'250000');assert.ok(ledger.snapshot().freezeReasons.includes('charge_without_recorded_dispatch'));
});

test('approval expiry prevents reservation and dispatch but still permits honest reconciliation',async t=>{
  const { open }=await setup(t),config=budget();config.ownerApproval.expiresAt='2026-09-27T16:00:00.000Z';
  let now=NOW;const ledger=open(config,()=>new Date(now));ledger.reserve(request('expired'));
  now=config.ownerApproval.expiresAt;
  assert.throws(()=>ledger.reserve(request('new')),code('approval_expired'));
  assert.throws(()=>ledger.markAttempted('expired'),code('approval_expired'));
  ledger.cancel('expired');ledger.reconcile(billed('expired',0));assert.equal(ledger.snapshot().committedMicros,'0');
});

test('missing and future authorization fail closed',async t=>{
  const { open }=await setup(t),config=budget();config.ownerApproval.approvedAt='2027-01-01T00:00:00.000Z';
  const future=open(config);assert.throws(()=>future.reserve(request('future')),code('approval_not_yet_valid'));
  const empty={ ...budget(),maxApprovedSpendUsd:0,ownerApproval:null,stages:{ smoke:0,pilot:0,evaluate:0,hosting:0 } };
  future.syncApproval(empty,{ expectedRevision:1 });assert.throws(()=>future.reserve(request('empty')),code('approval_missing'));
});

test('reduced approval caps freeze existing exposure and stale connections cannot restore prior permission',async t=>{
  const { open,filename }=await setup(t),trusted=open(),stale=open();trusted.reserve(request('held',4_000_000));
  const next=budget();next.maxApprovedSpendUsd=3;next.stages={ smoke:3,pilot:0,evaluate:0,hosting:0 };
  const reduced=trusted.syncApproval(next,{ expectedRevision:1 });assert.equal(reduced.approvalRevision,2);
  assert.ok(reduced.freezeReasons.includes('approved_cap_below_commitment'));
  assert.throws(()=>trusted.markAttempted('held'),code('approved_cap_below_commitment'));
  assert.throws(()=>stale.reserve(request('stale',1)),code('approval_changed'));
  assert.throws(()=>stale.markAttempted('held'),code('approval_changed'));
  assert.throws(()=>new BudgetLedger({ filename,budget:budget(),now:()=>new Date(NOW) }),code('approval_mismatch'));
  assert.throws(()=>stale.syncApproval(budget(),{ expectedRevision:1 }),code('approval_revision_conflict'));
  assert.equal(stale.snapshot().approvalRevision,2);assert.equal(stale.snapshot().approvedMicros,'3000000');
  trusted.cancel('held');trusted.reconcile(billed('held',0));
  assert.throws(()=>stale.reserve(request('stale',1)),code('approval_changed'));
  stale.syncApproval(next,{ expectedRevision:2 });assert.equal(stale.reserve(request('reloaded',3_000_000)).created,true);
  assert.equal(trusted.snapshot().committedMicros,'3000000');
});

test('changed configuration with equal approval timestamp needs explicit CAS and older approval is refused',async t=>{
  const { open,filename }=await setup(t),ledger=open(),next=budget();next.stages={ smoke:4,pilot:20,evaluate:0,hosting:0 };
  assert.throws(()=>new BudgetLedger({ filename,budget:next }),code('approval_mismatch'));
  assert.equal(ledger.snapshot().approvalRevision,1);
  ledger.syncApproval(next,{ expectedRevision:1 });assert.equal(ledger.snapshot().approvalRevision,2);
  const older=budget();older.ownerApproval.approvedAt='2026-09-26T10:00:00.000Z';
  assert.throws(()=>ledger.syncApproval(older,{ expectedRevision:2 }),code('older_approval'));
  assert.equal(ledger.snapshot().stages.smoke.approvedMicros,'4000000');
});

test('credits do not expand approved ceilings and snapshots/events omit private approval text',async t=>{
  const { open }=await setup(t),config=budget();config.verifiedCredits=[{ service:'synthetic-provider',amountUsd:1000,
    verifiedAt:'2026-09-27T11:00:00.000Z',expiresAt:'2027-01-01T00:00:00.000Z',evidenceRef:'private-credit-reference' }];
  const ledger=open(config);ledger.reserve(request('full',5_000_000));
  assert.equal(ledger.snapshot().verifiedCreditsAppliedMicros,'0');
  assert.throws(()=>ledger.reserve(request('extra',1)),code('budget_exceeded'));
  assert.doesNotMatch(JSON.stringify({ snapshot:ledger.snapshot(),events:ledger.events() }),/private-owner-reference|private accounting note|private-credit-reference/);
});

test('SQLite integer costs retain precision past JavaScript safe integers and aggregate without overflow',async t=>{
  const { open }=await setup(t),ledger=open();ledger.reserve(request('precise',1));ledger.markAttempted('precise');
  const cost=9_223_372_036_854_775_807n;ledger.reconcile(billed('precise',cost));
  assert.equal(ledger.snapshot().chargedMicros,String(cost));assert.equal(ledger.get('precise').actualCostMicros,String(cost));
  assert.doesNotThrow(()=>JSON.stringify(ledger.snapshot()));
});

test('symlink ledger files and directories are refused without changing the target',async t=>{
  const { dir }=await setup(t),target=join(dir,'target.txt'),linked=join(dir,'linked.sqlite');
  await writeFile(target,'unchanged',{ mode:0o640 });await symlink(target,linked);
  assert.throws(()=>new BudgetLedger({ filename:linked,budget:budget() }),code('invalid_path'));
  const linkDir=join(dir,'linked-dir');await symlink(dir,linkDir);
  assert.throws(()=>new BudgetLedger({ filename:join(linkDir,'db.sqlite'),budget:budget() }),code('invalid_path'));
  assert.equal(await readFile(target,'utf8'),'unchanged');assert.equal((await stat(target)).mode & 0o777,0o640);
});

interface ChildResult { created?:boolean;dispatchGranted?:boolean;error?:string; }
async function concurrentReservations(t:TestContext,dir:string,filename:string,sameId:boolean,operation:'reserve'|'attempt'='reserve'):Promise<ChildResult[]> {
  const script=join(dir,'reserve-worker.mjs'),policyPath=join(dir,'policy.json');
  await writeFile(policyPath,JSON.stringify(budget()),{ mode:0o600 });
  await writeFile(script,`import { readFileSync } from 'node:fs';
import { BudgetLedger } from ${JSON.stringify(new URL('../packages/orchestrator/src/budget-ledger.ts',import.meta.url).href)};
const [filename,policyPath,id,operation]=process.argv.slice(2);
const ledger=new BudgetLedger({filename,budget:JSON.parse(readFileSync(policyPath,'utf8')),now:()=>new Date(${JSON.stringify(NOW)})});
process.once('message',()=>{let result;try{result=operation==='attempt'?{dispatchGranted:ledger.markAttempted(id).dispatchGranted}:{created:ledger.reserve({id,episodeId:'episode-'+id,stage:'smoke',amountMicros:4000000,fingerprint:${JSON.stringify(HASH)}}).created};}catch(error){result={error:error.code??error.name};}ledger.close();process.send({kind:'result',result},()=>process.disconnect());});
process.send({kind:'ready'});
`,{ mode:0o600 });
  const workers=Array.from({length:4},(_,index)=>{
    const child=fork(script,[filename,policyPath,sameId?'shared':'worker-'+index,operation],{ execArgv:[],env:{},silent:true });
    t.after(()=>{ if(child.exitCode===null) child.kill(); });
    let stderr='';child.stderr?.on('data',data=>{stderr+=String(data);});
    let readyResolve!:()=>void,readyReject!:(error:Error)=>void,resultResolve!:(result:ChildResult)=>void,resultReject!:(error:Error)=>void;
    const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const result=new Promise<ChildResult>((resolve,reject)=>{resultResolve=resolve;resultReject=reject;});
    let observed:ChildResult|undefined;
    child.on('message',(message:{kind:string;result?:ChildResult})=>{if(message.kind==='ready')readyResolve();if(message.kind==='result')observed=message.result;});
    child.on('error',error=>{readyReject(error);resultReject(error);});
    child.on('exit',exitCode=>{if(exitCode===0&&observed)resultResolve(observed);else{const error=new Error('Worker failed: '+exitCode+' '+stderr);readyReject(error);resultReject(error);}});
    return { child,ready,result };
  });
  // Observe both readiness and exit promises immediately so early failures cannot become unhandled.
  const allResults=Promise.all(workers.map(worker=>worker.result));void allResults.catch(()=>{});
  await Promise.all(workers.map(worker=>worker.ready));for(const worker of workers)worker.child.send('start');
  return allResults;
}

test('simultaneous processes cannot oversubscribe a stage reservation ceiling',{ timeout:15_000 },async t=>{
  const { dir,filename,open }=await setup(t),ledger=open();
  const results=await concurrentReservations(t,dir,filename,false);
  assert.equal(results.filter(result=>result.created===true).length,1);
  assert.equal(results.filter(result=>result.error==='budget_exceeded').length,3);
  assert.equal(ledger.snapshot().committedMicros,'4000000');assert.equal(ledger.snapshot().reservationCount,1);
  assert.equal(ledger.events().filter(event=>event.kind==='reserved').length,1);
});

test('simultaneous identical IDs create exactly one durable reservation and event',{ timeout:15_000 },async t=>{
  const { dir,filename,open }=await setup(t),ledger=open();
  const results=await concurrentReservations(t,dir,filename,true);
  assert.equal(results.filter(result=>result.created===true).length,1);
  assert.equal(results.filter(result=>result.created===false).length,3);
  assert.equal(ledger.snapshot().committedMicros,'4000000');
  assert.equal(ledger.events().filter(event=>event.kind==='reserved').length,1);
});

test('simultaneous workers obtain at most one dispatch grant for the episode',{ timeout:15_000 },async t=>{
  const { dir,filename,open }=await setup(t),ledger=open();ledger.reserve(request('shared',4_000_000));
  const results=await concurrentReservations(t,dir,filename,true,'attempt');
  assert.equal(results.filter(result=>result.dispatchGranted===true).length,1);
  assert.equal(results.filter(result=>result.dispatchGranted===false).length,3);
  assert.equal(ledger.snapshot().pendingBillingCount,1);
  assert.equal(ledger.events().filter(event=>event.kind==='dispatch_attempted').length,1);
});

test('process termination after granting dispatch leaves its unknown charge durably held',{ timeout:15_000 },async t=>{
  const { dir,filename,open,close }=await setup(t);let ledger=open();ledger.reserve(request('crash',2_000_000));close(ledger);
  const script=join(dir,'crash-worker.mjs');
  await writeFile(script,`import { BudgetLedger } from ${JSON.stringify(new URL('../packages/orchestrator/src/budget-ledger.ts',import.meta.url).href)};
const ledger=new BudgetLedger({filename:process.argv[2],budget:${JSON.stringify(budget())},now:()=>new Date(${JSON.stringify(NOW)})});
if(!ledger.markAttempted('crash').dispatchGranted)process.exit(19);
process.exit(17);`,{ mode:0o600 });
  await assert.rejects(promisify(execFile)(process.execPath,[script,filename],{ env:{} }),{ code:17 });
  ledger=open();assert.equal(ledger.snapshot().heldMicros,'2000000');assert.equal(ledger.snapshot().pendingBillingCount,1);
  assert.equal(ledger.markAttempted('crash').dispatchGranted,false);
  assert.throws(()=>ledger.reserve(request('next')),code('billing_pending'));
});
