import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { createTrustedReplay } from '../packages/orchestrator/src/trusted-replay.ts';
import type { ReplayProgress, TrustedReplayInput } from '../packages/orchestrator/src/trusted-replay.ts';
import type { SandboxCheckResult } from '../packages/contracts/src/product.ts';
import { replayData, replayFetch } from './helpers/replay-data.ts';

function setup() {
  const data = replayData(), wire = replayFetch(), progress: ReplayProgress[] = [], raw: SandboxCheckResult[] = [];
  const ledger = new BudgetLedger({ filename:data.config.ledgerFile,budget:data.budget });
  const input:TrustedReplayInput = { replayId:data.replayId,bundle:data.bundle,sourceDigest:data.sourceDigest,
    limits:{ wallTimeLimitSeconds:20,sandboxCpuSecondsLimit:60,maxApprovedSpendUsd:1 },
    sandbox:{ authorized:true,fetch:wire.fetch,expectedProjectId:data.config.sandboxVerification.projectId,
      credential:async()=>({ token:'SYNTHETIC-UNIT-ONLY',projectId:data.config.sandboxVerification.projectId }) },
    verification:data.config.sandboxVerification,cpuProof:data.config.cpuProof,
    acceptedProofDigests:[digestJson(data.config.sandboxVerification),digestJson(data.config.cpuProof)],ledger,
    verifyCurrent:()=>data.sourceDigest,saveProgress:v=>progress.push(v),saveRawBatch:v=>raw.push(v) };
  return { data,wire,ledger,input,raw,progress,close:()=>{ledger.close();rmSync(data.directory,{recursive:true,force:true});} };
}

test('independent replay: exposed envelope cannot mutate fingerprint-bound caps',()=>{
 const s=setup();try {
   const replay=createTrustedReplay(s.input), before=structuredClone(replay.envelope);
   try { (replay.envelope as { maximumUploads:number }).maximumUploads=100000; } catch {}
   assert.deepEqual(replay.envelope,before);
 }finally{s.close();}
});

test('independent replay: trusted cap reduction during credential read stops POST and keeps hold',async()=>{
 const s=setup();const trusted=new BudgetLedger({filename:s.data.config.ledgerFile,budget:s.data.budget});
 try {
   const replay=createTrustedReplay({...s.input,sandbox:{...s.input.sandbox,credential:async()=>{
     const reduced=structuredClone(s.data.budget);reduced.maxApprovedSpendUsd=0;reduced.stages.smoke=0;
     trusted.syncApproval(reduced,{expectedRevision:1});return {token:'SYNTHETIC-UNIT-ONLY',projectId:s.input.verification.projectId};
   }}});
   const result=await replay.start(new AbortController().signal) as {status:string};
   assert.equal(result.status,'mismatch_or_infrastructure_error');
   assert.equal(s.wire.calls.length,0);assert.equal(trusted.get(replay.reservationId)!.heldMicros,'100000');
   assert.equal(trusted.get(replay.reservationId)!.reconciliationComplete,false);
 }finally{trusted.close();s.close();}
});

test('independent replay: cancellation after durable intent retains handles and an unknown hold',async()=>{
 const s=setup(),controller=new AbortController();let posts=0;
 const wire=replayFetch({beforeRequest:async(_url,init)=>{if(init?.method==='POST'&&++posts===1)controller.abort();}});
 try {
   const replay=createTrustedReplay({...s.input,sandbox:{...s.input.sandbox,fetch:wire.fetch}});
   await assert.rejects(replay.start(controller.signal));await replay.settled();
   assert.equal(wire.calls.filter(c=>c.method==='POST').length,1);
   assert.ok(replay.snapshot().operationIds.length>0);assert.equal(replay.snapshot().phase,'terminal');
   assert.equal(s.ledger.get(replay.reservationId)!.heldMicros,'100000');assert.equal(s.ledger.get(replay.reservationId)!.reconciliationComplete,false);
 }finally{s.close();}
});

test('independent replay: measured CPU overrun is retained and prevents the second batch',async()=>{
 const s=setup();const injected:typeof fetch=async(url,init)=>{
   const response=await s.wire.fetch(url,init);if((init?.method??'GET')!=='GET')return response;
   const body=await response.json();body.consumed_cpu=61;return Response.json(body);
 };
 try {
   const replay=createTrustedReplay({...s.input,sandbox:{...s.input.sandbox,fetch:injected}});
   const result=await replay.start(new AbortController().signal) as {status:string};
   assert.equal(result.status,'mismatch_or_infrastructure_error');assert.equal(replay.snapshot().observedCpuSeconds,61);
   assert.equal(s.raw.length,1);assert.equal(s.raw[0]!.infrastructureError,'replay_cpu_envelope_exceeded');
   assert.equal(s.wire.calls.filter(c=>c.url.endsWith('/instances')&&c.method==='POST').length,1);
   assert.equal(s.ledger.get(replay.reservationId)!.heldMicros,'100000');
 }finally{s.close();}
});

test('independent replay: source revocation after first raw batch blocks additional paid work',async()=>{
 const s=setup();let current=s.data.sourceDigest;
 try {
   const replay=createTrustedReplay({...s.input,verifyCurrent:()=>current,saveRawBatch:v=>{s.raw.push(v);current=digestBytes('revoked');}});
   await assert.rejects(replay.start(new AbortController().signal));
   assert.equal(s.raw.length,1);assert.equal(s.wire.calls.filter(c=>c.url.endsWith('/instances')&&c.method==='POST').length,1);
   assert.equal(s.ledger.get(replay.reservationId)!.heldMicros,'100000');
 }finally{s.close();}
});

test('independent replay: attempted identity remains blocked across ledger reopen',async()=>{
 const s=setup();try {
   const replay=createTrustedReplay(s.input);await replay.start(new AbortController().signal);
   s.ledger.close();const reopened=new BudgetLedger({filename:s.data.config.ledgerFile,budget:s.data.budget});
   try {assert.throws(()=>createTrustedReplay({...s.input,ledger:reopened}),/budget_unavailable/);assert.equal(reopened.snapshot().reservationCount,1);}
   finally{reopened.close();}
 }finally{rmSync(s.data.directory,{recursive:true,force:true});}
});

test('independent replay: wall deadline aborts transport and retains the unresolved upload intent',{timeout:5000},async()=>{
 const s=setup();let observedAbort=false;
 const wire=replayFetch({beforeRequest:async(_url,init)=>{
   assert.ok(init?.signal);await new Promise<void>((_resolve,reject)=>{
     const aborted=()=>{observedAbort=true;reject(init!.signal!.reason);};
     if(init!.signal!.aborted)aborted();else init!.signal!.addEventListener('abort',aborted,{once:true});
   });
 }});
 try {
   const replay=createTrustedReplay({...s.input,limits:{...s.input.limits,wallTimeLimitSeconds:1},sandbox:{...s.input.sandbox,fetch:wire.fetch}});
   await assert.rejects(replay.start(new AbortController().signal));await replay.settled();
   assert.equal(observedAbort,true);assert.equal(wire.calls.length,1);assert.ok(replay.snapshot().operationIds.length>0);
   assert.equal(s.ledger.get(replay.reservationId)!.heldMicros,'100000');assert.equal(replay.snapshot().phase,'terminal');
 }finally{s.close();}
});
