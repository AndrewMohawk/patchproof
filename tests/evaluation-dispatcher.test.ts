import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { ExperimentDispatcher,ExperimentExecutionError,ExecutionFailureReasonSchema,SyntheticEpisodeResultSchema } from '../workers/evaluator/dispatcher.ts';
import type { DispatcherTransport,ExecutionInput,FinalizedExecution } from '../workers/evaluator/dispatcher.ts';
import { analyzeExperiment,EpisodeResultSchema } from '../workers/evaluator/analysis.ts';
import { hashJson,planExperiment } from '../workers/evaluator/protocol.ts';
import type { ExperimentPlan } from '../workers/evaluator/protocol.ts';

const DIGEST='sha256:'+'d'.repeat(64),NOW='2026-09-27T16:00:00.000Z';
const files={'unit.txt':'invented transport artifact; never executed'};
const usage=(cost:number|null=0)=>({inferenceCalls:2,inputTokens:30,outputTokens:20,runtimeFeedbackRounds:2,elapsedMs:10,sandboxCpuSeconds:1 as number|null,measuredCostUsd:cost});
function makePlan(kind:'pilot'|'final'='pilot',live=false){
  const tasks=Array.from({length:kind==='pilot'?4:6},(_,repo)=>Array.from({length:5},(_,index)=>({id:`unit-${repo}-${index}`,repoId:`unit-repo-${repo}`,
    split:kind==='pilot'?'development' as const:'final' as const,fixtureDigest:DIGEST,oracleDigest:DIGEST}))).flat();
  return planExperiment({kind,tasks,limits:{inferenceCallLimit:24,inputTokenLimit:10_000,outputTokenLimit:5000,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:30,maxApprovedSpendUsd:live?0.1:0},
    sourceManifestDigest:DIGEST,modelLockDigest:live?DIGEST:null,policyDigest:DIGEST,approvedExperimentBudgetUsd:live?7.2:0,estimatedExperimentCostUsd:live?2:null,createdAt:NOW});
}
function transport(plan:ExperimentPlan,mode:'synthetic'|'live'='synthetic'):DispatcherTransport{
  return {executionMode:mode,modelLockDigest:plan.modelLockDigest,policyDigest:plan.policyDigest,
    ...(mode==='live'?{adjudicationBounds:{maxConcurrentCpuUnits:1,maxCostUsdPerSecond:0.01,fixedCostUsd:0}}:{}),
    async execute(){return{selectionFinalized:true,selectedCandidate:{files:structuredClone(files),digest:hashJson(files)},runtimeApproved:true,usage:usage(mode==='live'?0.01:0),billingComplete:true,artifactsDigest:DIGEST,infrastructureExclusion:null};},
    async adjudicate(input){return{episodeId:input.episodeId,taskId:input.taskId,selectedCandidateDigest:input.selectedCandidateDigest,outcome:'correct',sealedChecksExecuted:true,
      checkCount:1,passedCheckCount:1,infrastructureError:null,evaluationUsage:{measuredCostUsd:mode==='live'?0.02:0,sandboxCpuSeconds:0.5},sandboxOperationIds:['unit:adjudication'],artifactsDigest:DIGEST,finalOracleFeedbackRounds:0};}};
}
const budget=()=>({schemaVersion:'1.0',currency:'USD',maxApprovedSpendUsd:25,
  ownerApproval:{approvedBy:'unit-only',approvedAt:'2026-09-27T10:00:00.000Z',expiresAt:null,reference:'invented unit approval'},verifiedCredits:[],
  stages:{smoke:5,pilot:20,evaluate:0,hosting:0},episodeLimits:{inferenceCallLimit:24,inputTokenLimit:10000,outputTokenLimit:5000,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:30,candidateBranchLimit:3},note:'unit ledger only'});
const gates=()=>({accountAccessVerified:true,sandboxEntitlementVerified:true,modelVerified:true,realIntegrationPassed:true,oracleIndependentlyReviewed:true,
  experimentApproved:true,approvedRemainingSpendUsd:25,pricesVerified:true,finalProtocolFrozen:true});
async function setup(t:TestContext){
  const directory=await mkdtemp(join(tmpdir(),'patchproof-dispatch-test-')),filename=join(directory,'dispatch.sqlite'),ledgerFile=join(directory,'budget.sqlite');
  const dispatchers=new Set<ExperimentDispatcher>(),ledgers=new Set<BudgetLedger>();
  t.after(async()=>{for(const d of dispatchers)d.close();for(const l of ledgers)l.close();await rm(directory,{recursive:true,force:true});});
  const open=(plan:ExperimentPlan,adapter=transport(plan),extra:Partial<ConstructorParameters<typeof ExperimentDispatcher>[0]>={})=>{
    const d=new ExperimentDispatcher({filename,plan,transport:adapter,now:()=>new Date(NOW),...extra});dispatchers.add(d);return d;};
  const ledger=()=>{const l=new BudgetLedger({filename:ledgerFile,budget:budget(),now:()=>new Date(NOW)});ledgers.add(l);return l;};
  const close=(d:ExperimentDispatcher)=>{d.close();dispatchers.delete(d);};
  return{directory,filename,ledgerFile,open,ledger,close};
}

for(const kind of ['pilot','final'] as const)test(`complete ${kind} synthetic grid retains all ${kind==='pilot'?72:270} rows and cannot enter scored analysis`,async t=>{
  const {open}=await setup(t),plan=makePlan(kind),adapter=transport(plan);let executed=0,adjudicated=0;
  const execute=adapter.execute,adjudicate=adapter.adjudicate;
  adapter.execute=async(input,signal)=>{executed++;assert.equal('oracleDigest'in input,false);assert.equal('adjudicate'in input,false);return execute(input,signal);};
  adapter.adjudicate=async(input,signal)=>{adjudicated++;return adjudicate(input,signal);};
  const dispatcher=open(plan,adapter),result=await dispatcher.runAll();
  assert.equal(result.complete,true);assert.equal(result.results.length,plan.plannedEpisodes);assert.equal(executed,plan.plannedEpisodes);assert.equal(adjudicated,plan.plannedEpisodes);
  assert.equal(result.benchmarkExecuted,false);assert.equal(new Set(result.episodes.map(row=>row.dispatchId)).size,plan.plannedEpisodes);
  for(const row of result.results){assert.equal(SyntheticEpisodeResultSchema.safeParse(row).success,true);assert.equal(EpisodeResultSchema.safeParse(row).success,false);}
  assert.throws(()=>analyzeExperiment(plan,result.results));
  await dispatcher.runAll();assert.equal(executed,plan.plannedEpisodes);assert.equal(adjudicated,plan.plannedEpisodes);
});

test('durable selection precedes adjudication, is copied, and duplicate connections never re-execute',async t=>{
  const {open,close}=await setup(t),plan=makePlan(),adapter=transport(plan);let selected:FinalizedExecution|undefined,calls=0;
  const execution=adapter.execute;
  adapter.execute=async(input,signal)=>{calls++;selected=await execution(input,signal);return selected;};
  let first:ExperimentDispatcher;const adjudication=adapter.adjudicate;
  adapter.adjudicate=async(input,signal)=>{
    assert.equal(first.get(plan.episodes[0]!.id).phase,'adjudicating');
    assert.ok(first.events().some(event=>event.kind==='selection_finalized'));
    selected!.selectedCandidate!.files['unit.txt']='mutated after selection';
    assert.deepEqual(input.files,files);assert.equal(input.selectionFinalized,true);
    return adjudication(input,signal);
  };
  first=open(plan,adapter);const second=open(plan,adapter);
  const id=plan.episodes[0]!.id;await Promise.all([first.dispatch(id),second.dispatch(id)]);
  assert.equal(calls,1);close(first);close(second);
  const restarted=open(plan,adapter);assert.equal((await restarted.dispatch(id)).phase,'terminal');assert.equal(calls,1);
});

test('plan drift, mode changes and mismatched transport bindings reject existing state',async t=>{
  const {open}=await setup(t),plan=makePlan();open(plan);
  const changed=structuredClone(plan);changed.createdAt='2026-09-27T17:00:00.000Z';assert.throws(()=>open(changed),/another frozen/);
  assert.throws(()=>open(plan,{...transport(plan),policyDigest:'sha256:'+'a'.repeat(64)}),/match frozen/);
  assert.throws(()=>open(plan,{...transport(plan),executionMode:'live'}),/Live dispatch needs/);
});

test('setup failures and exceptions remain terminal rows without artificial correctness',async t=>{
  const {open}=await setup(t),plan=makePlan(),adapter=transport(plan),original=adapter.execute;
  adapter.execute=async(input,signal)=>{
    if(input.episodeId===plan.episodes[0]!.id)throw new Error('private provider text must not be published');
    const result=await original(input,signal);
    if(input.episodeId===plan.episodes[1]!.id)return{...result,selectedCandidate:null,runtimeApproved:false,infrastructureExclusion:'sandbox_setup_failure'};
    return result;
  };
  const dispatcher=open(plan,adapter),snapshot=await dispatcher.runAll();assert.equal(snapshot.results.length,72);
  assert.equal(snapshot.results[0]!.outcome,'infrastructure_error');assert.equal(snapshot.results[0]!.usage.measuredCostUsd,null);
  assert.equal(snapshot.results[1]!.infrastructureExclusion,'sandbox_setup_failure');assert.equal(snapshot.results[1]!.sealedChecksExecuted,false);
  assert.doesNotMatch(JSON.stringify(snapshot),/private provider text/);
});

test('typed runtime failures keep safe distinct reasons and partial work without adjudication or retry',async t=>{
  const {open}=await setup(t),plan=makePlan(),adapter=transport(plan);
  const reasons=ExecutionFailureReasonSchema.options;
  let attempts=0,adjudications=0;
  adapter.execute=async input=>{
    const index=plan.episodes.findIndex(episode=>episode.id===input.episodeId);
    attempts++;
    input.checkpoint({usage:usage(),operationIds:[`unit:partial:${index}`]});
    throw new ExperimentExecutionError(reasons[index]!);
  };
  adapter.adjudicate=async()=>{adjudications++;throw new Error('must not adjudicate a failed runtime');};
  const dispatcher=open(plan,adapter);
  for(const [index,reason]of reasons.entries()){
    const id=plan.episodes[index]!.id,view=await dispatcher.dispatch(id),row=view.result!;
    assert.equal(view.reason,reason);
    assert.equal(row.outcome,['invalid_candidate','protected_path','flaky_check'].includes(reason)?'unverified':'infrastructure_error');
    assert.equal(row.infrastructureExclusion,['provider_rate_limit','provider_timeout','provider_unavailable','sandbox_setup_failure'].includes(reason)?reason:null);
    assert.equal(row.sealedChecksExecuted,false);assert.equal(row.usage.inferenceCalls,2);
    assert.equal(row.usage.inputTokens,30);assert.equal(row.usage.measuredCostUsd,null);
    assert.deepEqual(view.operationIds,[`unit:partial:${index}`]);
    await dispatcher.dispatch(id);
  }
  assert.equal(attempts,reasons.length);assert.equal(adjudications,0);
});

test('plain and forged exception classifications never copy unrecognized provider text',async t=>{
  const {open}=await setup(t),plan=makePlan(),adapter=transport(plan);
  adapter.execute=async input=>{
    if(input.episodeId===plan.episodes[0]!.id)throw Object.assign(new Error('private provider body'),{reason:'provider_rate_limit'});
    throw Object.assign(Object.create(ExperimentExecutionError.prototype),{reason:'private forged observation'});
  };
  const dispatcher=open(plan,adapter);
  for(const episode of plan.episodes.slice(0,2)){
    const view=await dispatcher.dispatch(episode.id);
    assert.equal(view.reason,'execution_or_setup_failed');assert.equal(view.result!.infrastructureExclusion,null);
  }
  assert.doesNotMatch(JSON.stringify(dispatcher.snapshot()),/private provider|private forged/);
  assert.doesNotMatch(JSON.stringify(dispatcher.events()),/private provider|private forged/);
});

test('cancellation records the active episode and all undispatched rows with no oracle call',async t=>{
  const {open}=await setup(t),plan=makePlan(),controller=new AbortController(),adapter=transport(plan);let executions=0,checks=0;
  adapter.execute=async input=>{executions++;input.checkpoint({usage:usage(),operationIds:['unit:in-flight']});controller.abort();return new Promise(()=>{});};
  adapter.adjudicate=async()=>{checks++;throw new Error('must not adjudicate');};
  const dispatcher=open(plan,adapter),snapshot=await dispatcher.runAll(controller.signal);
  assert.equal(snapshot.complete,true);assert.equal(snapshot.results.length,72);assert.equal(executions,1);assert.equal(checks,0);
  assert.equal(snapshot.results[0]!.usage.measuredCostUsd,null);assert.equal(snapshot.results[1]!.usage.measuredCostUsd,0);
  assert.ok(snapshot.results.every(row=>row.outcome==='unverified'));assert.deepEqual(snapshot.episodes[0]!.operationIds,['unit:in-flight']);
  await dispatcher.runAll();assert.equal(executions,1);
});

test('invalid or changed selected artifact cannot reach the independent adjudicator',async t=>{
  const {open}=await setup(t),plan=makePlan(),adapter=transport(plan),execute=adapter.execute;let adjudications=0;
  adapter.execute=async(input,signal)=>({...await execute(input,signal),selectedCandidate:{files,digest:DIGEST}});
  adapter.adjudicate=async()=>{adjudications++;throw new Error('must not run');};
  const dispatcher=open(plan,adapter),view=await dispatcher.dispatch(plan.episodes[0]!.id);
  assert.equal(view.result!.outcome,'infrastructure_error');assert.equal(adjudications,0);
});

test('adjudication failure retains operation handles and unknown aggregate usage without feedback or retry',async t=>{
  const {open}=await setup(t),plan=makePlan(),adapter=transport(plan);let executions=0,adjudications=0;
  const execute=adapter.execute;adapter.execute=async(input,signal)=>{executions++;return execute(input,signal);};
  adapter.adjudicate=async input=>{adjudications++;input.onOperation('unit:unfinished-check');throw new Error('private oracle observation');};
  const dispatcher=open(plan,adapter),id=plan.episodes[0]!.id,result=await dispatcher.dispatch(id);
  assert.equal(result.result!.outcome,'infrastructure_error');assert.equal(result.result!.runtimeApproved,true);
  assert.equal(result.result!.usage.sandboxCpuSeconds,null);assert.deepEqual(result.operationIds,['unit:unfinished-check']);
  assert.doesNotMatch(JSON.stringify(result),/private oracle observation/);await dispatcher.dispatch(id);
  assert.equal(executions,1);assert.equal(adjudications,1);
});

test('live branch refuses missing gates before injected execution and retains each denominator',async t=>{
  const {open,ledger}=await setup(t),plan=makePlan('pilot',true),adapter=transport(plan,'live');let calls=0;
  adapter.execute=async()=>{calls++;throw new Error('must not run');};
  const accounting=ledger(),dispatcher=open(plan,adapter,{ledger:accounting,gates:()=>({...gates(),accountAccessVerified:false})});
  const snapshot=await dispatcher.runAll();assert.equal(snapshot.results.length,72);assert.equal(calls,0);assert.equal(snapshot.benchmarkExecuted,false);
  assert.equal(accounting.snapshot().reservationCount,0);assert.ok(snapshot.results.every(row=>row.outcome==='infrastructure_error'));
});

test('injected live branch receives a durable grant first and charges runtime plus adjudication',async t=>{
  const {open,ledger}=await setup(t),plan=makePlan('pilot',true),adapter=transport(plan,'live'),accounting=ledger(),execute=adapter.execute;
  let tick=Date.parse(NOW);
  adapter.execute=async(input,signal)=>{assert.equal(accounting.get(input.dispatchId).state,'attempted');assert.equal(accounting.snapshot().pendingBillingCount,1);return execute(input,signal);};
  const adjudicate=adapter.adjudicate;adapter.adjudicate=async(input,signal)=>{tick+=50;return adjudicate(input,signal);};
  const dispatcher=open(plan,adapter,{ledger:accounting,gates,now:()=>new Date(tick)}),result=(await dispatcher.dispatch(plan.episodes[0]!.id)).result!;
  assert.equal(result.usage.measuredCostUsd,0.03);assert.equal(result.usage.sandboxCpuSeconds,1.5);assert.equal(result.usage.elapsedMs,60);
  assert.equal(accounting.snapshot().chargedMicros,'30000');assert.equal(accounting.snapshot().heldMicros,'0');assert.equal(accounting.snapshot().pendingBillingCount,0);
  assert.equal(EpisodeResultSchema.safeParse(result).success,true);
});

test('incomplete injected billing stays held and blocks later dispatch while retaining rows',async t=>{
  const {open,ledger}=await setup(t),plan=makePlan('pilot',true),adapter=transport(plan,'live'),accounting=ledger(),execute=adapter.execute;let calls=0;
  adapter.execute=async(input,signal)=>{calls++;return{...await execute(input,signal),billingComplete:false};};
  const dispatcher=open(plan,adapter,{ledger:accounting,gates}),snapshot=await dispatcher.runAll();
  assert.equal(snapshot.results.length,72);assert.equal(calls,1);assert.equal(snapshot.results[0]!.usage.measuredCostUsd,null);
  assert.equal(accounting.snapshot().chargedMicros,'10000');assert.equal(accounting.snapshot().heldMicros,'90000');assert.equal(accounting.snapshot().pendingBillingCount,1);
  assert.equal(snapshot.episodes[0]!.reason,'adjudication_allowance_unknown');
});

test('measured adjudication overrun is retained and cannot support matched-budget inference',async t=>{
  const {open,ledger}=await setup(t),plan=makePlan('pilot',true),adapter=transport(plan,'live'),accounting=ledger(),adjudicate=adapter.adjudicate;
  adapter.adjudicate=async(input,signal)=>({...await adjudicate(input,signal),evaluationUsage:{measuredCostUsd:0.2,sandboxCpuSeconds:2}});
  const dispatcher=open(plan,adapter,{ledger:accounting,gates}),snapshot=await dispatcher.runAll();
  assert.equal(accounting.snapshot().chargedMicros,'210000');assert.ok(accounting.snapshot().freezeReasons.includes('reservation_overrun'));
  const report=analyzeExperiment(plan,snapshot.results);assert.ok(report.budgetViolations.some(row=>row.dimension==='measuredCostUsd'));
  assert.equal(report.comparisons.length,0);
});

test('checkpoint preserves known partial charges and operation handles when execution throws',async t=>{
  const {open,ledger}=await setup(t),plan=makePlan('pilot',true),adapter=transport(plan,'live'),accounting=ledger();
  adapter.execute=async input=>{input.checkpoint({usage:usage(0.02),operationIds:['unit:provider-1','unit:sandbox-1']});throw new Error('failure after billing');};
  const dispatcher=open(plan,adapter,{ledger:accounting,gates}),row=await dispatcher.dispatch(plan.episodes[0]!.id);
  assert.deepEqual(row.operationIds,['unit:provider-1','unit:sandbox-1']);assert.equal(row.result!.usage.inferenceCalls,2);assert.equal(row.result!.usage.measuredCostUsd,null);
  assert.equal(accounting.snapshot().chargedMicros,'20000');assert.equal(accounting.snapshot().heldMicros,'80000');
});

test('dead-owner recovery retains usage and identity and never resumes execution or adjudication',{timeout:15000},async t=>{
  const {directory,filename,open}=await setup(t),plan=makePlan(),script=join(directory,'crash.mjs');
  await writeFile(script,`import { ExperimentDispatcher } from ${JSON.stringify(new URL('../workers/evaluator/dispatcher.ts',import.meta.url).href)};
const dispatcher=new ExperimentDispatcher({filename:process.argv[2],plan:${JSON.stringify(plan)},transport:{executionMode:'synthetic',modelLockDigest:null,policyDigest:${JSON.stringify(DIGEST)},
execute:async input=>{input.checkpoint({usage:${JSON.stringify(usage())},operationIds:['unit:interrupted']});process.exit(17);},adjudicate:async()=>{throw new Error('must not run');}}});
await dispatcher.dispatch(${JSON.stringify(plan.episodes[0]!.id)});`,{mode:0o600});
  await assert.rejects(promisify(execFile)(process.execPath,[script,filename],{env:{}}),{code:17});
  const adapter=transport(plan);let calls=0;adapter.execute=async()=>{calls++;throw new Error('must not retry');};
  const dispatcher=open(plan,adapter),recovery=dispatcher.recoverInterrupted();assert.equal(recovery.recovered,1);
  const row=await dispatcher.dispatch(plan.episodes[0]!.id);assert.equal(row.reason,'interrupted_owner');assert.equal(calls,0);
  assert.equal(row.result!.usage.inferenceCalls,2);assert.equal(row.result!.usage.measuredCostUsd,null);assert.deepEqual(row.operationIds,['unit:interrupted']);
  assert.equal(dispatcher.recoverInterrupted().recovered,0);
});

test('live owners are never stolen by a second dispatcher recovery',async t=>{
  const {open}=await setup(t),plan=makePlan(),adapter=transport(plan),controller=new AbortController();let started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});adapter.execute=async()=>{started();return new Promise(()=>{});};
  const first=open(plan,adapter),second=open(plan,adapter),running=first.dispatch(plan.episodes[0]!.id,controller.signal);
  await ready;assert.equal(second.recoverInterrupted().recovered,0);assert.equal((await second.dispatch(plan.episodes[0]!.id)).phase,'executing');
  controller.abort();await running;
});

test('constructor snapshots transport mode and prospective bounds instead of following caller mutation',async t=>{
  const {open,ledger}=await setup(t),plan=makePlan('pilot',true),adapter=transport(plan,'live'),accounting=ledger(),adjudicate=adapter.adjudicate;
  adapter.adjudicate=async(input,signal)=>{assert.ok(input.timeoutSeconds<=9);return adjudicate(input,signal);};
  const dispatcher=open(plan,adapter,{ledger:accounting,gates});
  adapter.executionMode='synthetic';adapter.adjudicationBounds!.maxCostUsdPerSecond=0;
  const result=await dispatcher.dispatch(plan.episodes[0]!.id);
  assert.equal(result.result!.executionMode,'live');assert.equal(accounting.snapshot().chargedMicros,'30000');
});

test('process death after a durable live-control grant retains partial billing and forbids replay',{timeout:15000},async t=>{
  const {directory,filename,ledgerFile,open,ledger}=await setup(t),plan=makePlan('pilot',true),script=join(directory,'live-control-crash.mjs'),accounting=ledger();
  await writeFile(script,`import { ExperimentDispatcher } from ${JSON.stringify(new URL('../workers/evaluator/dispatcher.ts',import.meta.url).href)};
import { BudgetLedger } from ${JSON.stringify(new URL('../packages/orchestrator/src/budget-ledger.ts',import.meta.url).href)};
const ledger=new BudgetLedger({filename:process.argv[3],budget:${JSON.stringify(budget())},now:()=>new Date(${JSON.stringify(NOW)})});
const dispatcher=new ExperimentDispatcher({filename:process.argv[2],plan:${JSON.stringify(plan)},ledger,gates:()=>(${JSON.stringify(gates())}),transport:{executionMode:'live',modelLockDigest:${JSON.stringify(DIGEST)},policyDigest:${JSON.stringify(DIGEST)},adjudicationBounds:{maxConcurrentCpuUnits:1,maxCostUsdPerSecond:0.01,fixedCostUsd:0},
execute:async input=>{input.checkpoint({usage:${JSON.stringify(usage(0.01))},operationIds:['unit:paid-control-intent']});process.exit(17);},adjudicate:async()=>{throw new Error('must not run');}}});
await dispatcher.dispatch(${JSON.stringify(plan.episodes[0]!.id)});`,{mode:0o600});
  await assert.rejects(promisify(execFile)(process.execPath,[script,filename,ledgerFile],{env:{}}),{code:17});
  const adapter=transport(plan,'live');let calls=0;adapter.execute=async()=>{calls++;throw new Error('must not replay');};
  const dispatcher=open(plan,adapter,{ledger:accounting,gates});assert.equal(dispatcher.recoverInterrupted().recovered,1);
  const snapshot=await dispatcher.runAll();assert.equal(snapshot.results.length,72);assert.equal(calls,0);
  assert.equal(snapshot.episodes[0]!.reason,'interrupted_owner');assert.deepEqual(snapshot.episodes[0]!.operationIds,['unit:paid-control-intent']);
  assert.equal(accounting.snapshot().chargedMicros,'10000');assert.equal(accounting.snapshot().heldMicros,'90000');assert.equal(accounting.snapshot().pendingBillingCount,1);
});
