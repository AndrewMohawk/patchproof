import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {digestJson} from '../packages/contracts/src/digest.ts';
import {BudgetLedger} from '../packages/orchestrator/src/budget-ledger.ts';
import type {PhaseAccountingRequest} from '../packages/orchestrator/src/phase-accounting.ts';
import {createAccountedAdjudicator} from '../workers/evaluator/adjudication-accounting.ts';
import type {AdjudicationAccountingCheckpoint,AccountedAdjudicatorOptions} from '../workers/evaluator/adjudication-accounting.ts';
import {ExperimentDispatcher} from '../workers/evaluator/dispatcher.ts';
import type {AdjudicationInput,AggregateAdjudication,DispatcherTransport} from '../workers/evaluator/dispatcher.ts';
import {planExperiment,hashJson} from '../workers/evaluator/protocol.ts';

const H='sha256:'+'a'.repeat(64),J='sha256:'+'b'.repeat(64),D='11111111-1111-4111-8111-111111111111';
const limits={inferenceCallLimit:24,inputTokenLimit:1000,outputTokenLimit:1000,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:30,maxApprovedSpendUsd:0.2};
const publicInput={episodeId:'invented:episode',dispatchId:D,taskId:'invented-task',repoId:'invented-repo',variant:'baseline' as const,repetition:0,seed:1,limits,fixtureDigest:H,planDigest:J,modelLockDigest:H,policyDigest:J};
const verdict=(input:AdjudicationInput):AggregateAdjudication=>({episodeId:input.episodeId,taskId:input.taskId,selectedCandidateDigest:input.selectedCandidateDigest,outcome:'unverified',sealedChecksExecuted:false,checkCount:0,passedCheckCount:0,infrastructureError:null,evaluationUsage:{measuredCostUsd:0.02,sandboxCpuSeconds:2},sandboxOperationIds:['invented/check/1'],artifactsDigest:H,finalOracleFeedbackRounds:0});
function fixture(){
  const checkpoints:AdjudicationAccountingCheckpoint[]=[],requests:PhaseAccountingRequest[]=[],events:string[]=[],usage:Array<{measuredCostUsd:number|null;sandboxCpuSeconds:number|null}>=[];
  const options:AccountedAdjudicatorOptions={sourceDigest:H,executionMode:'live',publicEpisodes:[publicInput],reservationForExecution:()=>({dispatchId:D,publicInputDigest:digestJson(publicInput),reservationFingerprint:J,stage:'pilot',amountMicros:'200000'}),
    saveCheckpoint:value=>{checkpoints.push(value);events.push('save');},adjudicate:async input=>{input.onOperation('intent:invented-1');input.onUsage?.({measuredCostUsd:0.01,sandboxCpuSeconds:1});return verdict(input);},
    observer:async request=>{requests.push(request);return{receiptDigest:J,checkpointDigest:request.checkpointDigest,measuredCostUsd:0.03,sandboxCpuSeconds:3,billingComplete:true,cpuComplete:true,inventoryComplete:true,cleanupComplete:true,retentionFinal:true,coveredOperationIds:request.operationIds};}};
  const input:AdjudicationInput={episodeId:D,taskId:publicInput.taskId,ownerRunId:D,expectedFixtureDigest:H,expectedOracleDigest:J,selectedCandidateDigest:H,selectionFinalized:true,files:{},timeoutSeconds:10,sandboxCpuSecondsLimit:10,maxApprovedSpendUsd:0.1,
    onOperation:()=>{assert.equal(events.at(-1),'save');events.push('operation');},onUsage:value=>{usage.push(value);}};
  return{options,input,checkpoints,requests,usage};
}
test('wrapper binds only exact phase metadata and persists intents before forwarding',async()=>{
  const f=fixture(),run=createAccountedAdjudicator(f.options),result=await run(f.input,new AbortController().signal);
  assert.equal(result.evaluationUsage.measuredCostUsd,0.03);assert.equal(result.evaluationUsage.sandboxCpuSeconds,3);assert.deepEqual(result.sandboxOperationIds,['intent:invented-1','invented/check/1']);
  const request=f.requests[0]!;assert.equal(request.binding.phase,'adjudication');assert.equal(request.binding.episodeId,publicInput.episodeId);assert.equal(request.observedCostLowerBoundUsd,0.02);assert.equal(request.observedCpuLowerBound,2);assert.equal(f.usage.at(-1)!.measuredCostUsd,0.03);
  assert.equal(JSON.stringify(f.checkpoints).includes('files'),false);assert.equal(JSON.stringify(f.requests).includes('Oracle'),false);
  await assert.rejects(run(f.input,new AbortController().signal),/runtime_binding_changed/);
});
for(const flag of ['billingComplete','cpuComplete','inventoryComplete','cleanupComplete','retentionFinal']as const)test(`incomplete ${flag} cannot expose measured totals`,async()=>{
  const f=fixture(),observe=f.options.observer;f.options.observer=async(request,signal)=>({...await observe(request,signal),[flag]:false});
  const result=await createAccountedAdjudicator(f.options)(f.input,new AbortController().signal);assert.deepEqual(result.evaluationUsage,{measuredCostUsd:null,sandboxCpuSeconds:null});assert.equal(f.usage.at(-1)!.measuredCostUsd,0.03);
});
for(const change of ['checkpoint','inventory','lower-cost','lower-cpu']as const)test(`mismatched observation ${change} fails closed`,async()=>{
  const f=fixture(),observe=f.options.observer;f.options.observer=async(request,signal)=>{const result=await observe(request,signal);if(change==='checkpoint')result.checkpointDigest=H;if(change==='inventory')result.coveredOperationIds=[];if(change==='lower-cost')result.measuredCostUsd=0.001;if(change==='lower-cpu')result.sandboxCpuSeconds=0;return result;};
  await assert.rejects(createAccountedAdjudicator(f.options)(f.input,new AbortController().signal),/billing_incomplete/);assert.equal(f.checkpoints.at(-1)!.state,'failed');assert.equal(f.checkpoints.at(-1)!.observedCostLowerBoundUsd,0.02);
});
test('terminal callback failure retains partial handles and cumulative lower bounds without observer',async()=>{
  const f=fixture();f.options.adjudicate=async input=>{input.onOperation('intent:partial');input.onUsage?.({measuredCostUsd:0.02,sandboxCpuSeconds:2});input.onUsage?.({measuredCostUsd:null,sandboxCpuSeconds:null});throw new Error('private body');};
  await assert.rejects(createAccountedAdjudicator(f.options)(f.input,new AbortController().signal),error=>error instanceof Error&&error.message==='execution_or_setup_failed');
  assert.equal(f.requests.length,0);assert.deepEqual(f.checkpoints.at(-1)!.operationIds,['intent:partial']);assert.equal(f.checkpoints.at(-1)!.observedCostLowerBoundUsd,0.02);assert.equal(f.usage.at(-1)!.sandboxCpuSeconds,2);
});
test('caller cancellation during observation preserves known usage and prevents complete return',async()=>{
  const f=fixture(),controller=new AbortController();f.options.observer=async()=>{controller.abort();return new Promise(()=>{});};
  await assert.rejects(createAccountedAdjudicator(f.options)(f.input,controller.signal),/billing_incomplete/);assert.equal(f.checkpoints.at(-1)!.state,'failed');assert.equal(f.checkpoints.at(-1)!.observedCostLowerBoundUsd,0.02);
});
test('deadline bounds an observer that ignores cancellation and stale callbacks are refused',async()=>{
  const f=fixture();f.input.timeoutSeconds=1;let retained:AdjudicationInput|undefined;const original=f.options.adjudicate;f.options.adjudicate=async(input,signal)=>{retained=input;return original(input,signal);};f.options.observer=async()=>new Promise(()=>{});
  const keepalive=setInterval(()=>{},100);try{await assert.rejects(createAccountedAdjudicator(f.options)(f.input,new AbortController().signal),/resource_limit/);}finally{clearInterval(keepalive);}
  assert.throws(()=>retained!.onOperation('too-late'),/runtime_binding_changed/);assert.equal(f.checkpoints.at(-1)!.state,'failed');
});
test('binding drift refuses callbacks before side effects',async()=>{
  const f=fixture();await assert.rejects(createAccountedAdjudicator(f.options)({...f.input,taskId:'other'},new AbortController().signal),/runtime_binding_changed/);assert.equal(f.checkpoints.length,0);
});

const budget=()=>({schemaVersion:'1.0',currency:'USD',maxApprovedSpendUsd:25,ownerApproval:{approvedBy:'invented',approvedAt:'2026-09-26T00:00:00.000Z',expiresAt:null,reference:'invented'},verifiedCredits:[],stages:{smoke:5,pilot:20,evaluate:0,hosting:0},episodeLimits:{inferenceCallLimit:24,inputTokenLimit:1000,outputTokenLimit:1000,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:30,candidateBranchLimit:3},note:'invented control'});
function dispatcherFixture(t:TestContext){
  const dir=mkdtempSync(join(tmpdir(),'adjudication-accounting-')),filename=join(dir,'dispatch.sqlite');
  const tasks=Array.from({length:4},(_,r)=>Array.from({length:5},(_,i)=>({id:`invented-${r}-${i}`,repoId:`repo-${r}`,split:'development' as const,fixtureDigest:H,oracleDigest:J}))).flat();
  const plan=planExperiment({kind:'pilot',tasks,limits,sourceManifestDigest:H,modelLockDigest:H,policyDigest:J,approvedExperimentBudgetUsd:14.4,estimatedExperimentCostUsd:10,createdAt:'2026-09-26T00:00:00.000Z'});
  const ledger=new BudgetLedger({filename:join(dir,'budget.sqlite'),budget:budget()});
  const transport:DispatcherTransport={executionMode:'live',modelLockDigest:H,policyDigest:J,adjudicationBounds:{maxConcurrentCpuUnits:1,maxCostUsdPerSecond:0,fixedCostUsd:0},
    execute:async()=>({selectionFinalized:true,selectedCandidate:{files:{},digest:hashJson({})},runtimeApproved:false,usage:{inferenceCalls:0,inputTokens:0,outputTokens:0,runtimeFeedbackRounds:0,elapsedMs:0,sandboxCpuSeconds:1,measuredCostUsd:0.1},billingComplete:true,artifactsDigest:H,infrastructureExclusion:null}),
    adjudicate:async input=>verdict(input)};
  const open=()=>new ExperimentDispatcher({filename,plan,transport,ledger,gates:()=>({accountAccessVerified:true,sandboxEntitlementVerified:true,modelVerified:true,realIntegrationPassed:true,oracleIndependentlyReviewed:true,experimentApproved:true,approvedRemainingSpendUsd:20,pricesVerified:true,finalProtocolFrozen:true})});
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
  return{plan,filename,ledger,transport,open};
}
test('dispatcher adds cumulative adjudication once: runtime .10 plus .02 then .03 is .13',async t=>{
  const f=dispatcherFixture(t);f.transport.adjudicate=async input=>{input.onUsage!({measuredCostUsd:0.02,sandboxCpuSeconds:2});input.onUsage!({measuredCostUsd:0.03,sandboxCpuSeconds:3});return{...verdict(input),evaluationUsage:{measuredCostUsd:0.03,sandboxCpuSeconds:3}};};
  const d=f.open();try{const result=await d.dispatch(f.plan.episodes[0]!.id);assert.equal(result.reason,'completed');assert.equal(result.result!.usage.measuredCostUsd,0.13);assert.equal(result.result!.usage.sandboxCpuSeconds,4);assert.equal(f.ledger.snapshot().chargedMicros,'130000');}finally{d.close();}
});
for(const end of ['incomplete','throw','cancel']as const)test(`dispatcher ${end} retains known phase totals and keeps unknown hold`,async t=>{
  const f=dispatcherFixture(t),controller=new AbortController();f.transport.adjudicate=async input=>{input.onOperation('intent:partial');input.onUsage!({measuredCostUsd:0.02,sandboxCpuSeconds:2});input.onUsage!({measuredCostUsd:0.03,sandboxCpuSeconds:3});input.onUsage!({measuredCostUsd:null,sandboxCpuSeconds:null});if(end==='throw')throw new Error('private failure');if(end==='cancel'){controller.abort();return new Promise(()=>{});}return{...verdict(input),evaluationUsage:{measuredCostUsd:null,sandboxCpuSeconds:null}};};
  const d=f.open();try{const row=await d.dispatch(f.plan.episodes[0]!.id,controller.signal);assert.equal(row.result!.usage.measuredCostUsd,null);assert.equal(row.result!.usage.sandboxCpuSeconds,null);assert.ok(row.operationIds.includes('intent:partial'));
    const db=new DatabaseSync(f.filename,{readOnly:true}),stored=JSON.parse(String(db.prepare('SELECT usage_json FROM episodes WHERE episode_id=?').get(row.episodeId)!.usage_json));db.close();assert.equal(stored.measuredCostUsd,0.13);assert.equal(stored.sandboxCpuSeconds,4);assert.equal(f.ledger.snapshot().chargedMicros,'130000');assert.equal(f.ledger.snapshot().pendingBillingCount,1);assert.equal(f.ledger.snapshot().heldMicros,'70000');
  }finally{d.close();}
});
test('regressing adjudication cumulative totals reject before erasing durable lower bound',async t=>{
  const f=dispatcherFixture(t);f.transport.adjudicate=async input=>{input.onUsage!({measuredCostUsd:0.03,sandboxCpuSeconds:3});input.onUsage!({measuredCostUsd:0.02,sandboxCpuSeconds:2});return verdict(input);};
  const d=f.open();try{const row=await d.dispatch(f.plan.episodes[0]!.id);assert.equal(row.reason,'usage_regression');assert.equal(f.ledger.snapshot().chargedMicros,'130000');assert.equal(f.ledger.snapshot().pendingBillingCount,1);}finally{d.close();}
});
