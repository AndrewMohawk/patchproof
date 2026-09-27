import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestJson, digestBytes } from '../packages/contracts/src/digest.ts';
import { planModelProbe, verifyProbePlan, analyzeModelProbe, ProbeResultSchema } from '../workers/evaluator/model-probe.ts';
import type { ProbeResult } from '../workers/evaluator/model-probe.ts';
import { runModelProbeOperator } from '../scripts/model-probe.ts';

// All model/catalog/outcome records here are invented. Actual-scope strings exercise
// the accepted branch only; no provider, candidate or scored experiment executes.
const now = new Date('2026-09-01T01:00:00.000Z');
function input() {
  return { createdAt: '2026-09-01T00:00:00.000Z', sourceManifestDigest: digestBytes('invented manifest'),
    sourceDigest: digestBytes('invented source'), policyDigest: digestBytes('invented fixed smoke policy'),
    tasks: Array.from({length:20},(_,i)=>({id:`unit-task-${String(i).padStart(2,'0')}`,repoId:`repo-${Math.floor(i/5)}`,
      split:'development' as const,fixtureDigest:digestBytes(`fixture:${i}`),oracleDigest:digestBytes(`oracle:${i}`)})),
    models: ['a','b'].map(id=>({modelId:`nvidia/unit-only-${id}`,modelLockDigest:digestBytes(`model:${id}`),accountProofDigest:digestBytes(`proof:${id}`),
      tokenizerDigest:digestBytes(`tokenizer:${id}`),licenseUrl:'https://example.invalid/unit-license',modelCardUrl:'https://example.invalid/unit-card',
      accountVerifiedAt:'2026-08-31T00:00:00.000Z',validUntil:'2026-09-02T00:00:00.000Z'})),
    limits:{inferenceCallLimit:1,inputTokenLimit:1000,outputTokenLimit:500,wallTimeLimitSeconds:120,sandboxCpuSecondsLimit:60,maxApprovedSpendUsd:0.1},
    plannedBudgetUsd:2,minimumCorrectTasks:8 };
}
function setup(change: Partial<ReturnType<typeof input>>={}) {
  const plan=planModelProbe({...input(),...change});
  const rows:ProbeResult[]=plan.episodes.map((episode,index)=>ProbeResultSchema.parse({schemaVersion:'1.0',scope:'actual-provider-observation',
    planDigest:plan.planDigest,episodeId:episode.id,runId:randomUUID(),modelId:episode.modelId,modelLockDigest:episode.modelLockDigest,
    fixtureDigest:episode.fixtureDigest,oracleDigest:episode.oracleDigest,sourceDigest:plan.input.sourceDigest,policyDigest:plan.input.policyDigest,variant:episode.variant,
    startedAt:new Date(Date.parse(plan.input.createdAt)+index*2000).toISOString(),finishedAt:new Date(Date.parse(plan.input.createdAt)+index*2000+1000).toISOString(),
    outcome:'correct',runtimeApproved:true,bundleDigest:digestBytes(`bundle:${index}`),adjudicationDigest:digestBytes(`adjudication:${index}`),independentlyAdjudicated:true,
    measuredCostMicros:episode.modelId.endsWith('a')?'10000':'20000',billingComplete:true,inferenceCalls:1,inputTokens:20,outputTokens:10,elapsedMs:1000,sandboxCpuSeconds:0.2,
    modelRequestIds:[`UNIT-ONLY-request-${index}`],sandboxOperationIds:[`UNIT-ONLY-operation-${index}`],failureReason:null}));
  const trust=()=>({planDigest:plan.planDigest,acceptedResultDigests:rows.map(digestJson),acceptedModelProofDigests:plan.input.models.map(model=>model.accountProofDigest),now});
  return {plan,rows,trust};
}
test('probe fixes eight development tasks across four repositories before outcomes and gives every model equal limits',()=>{
  const {plan}=setup();
  assert.equal(plan.selectedTaskIds.length,8);assert.equal(plan.episodes.length,16);assert.equal(plan.executionAuthorized,false);
  assert.deepEqual(plan.selectedTaskIds,['unit-task-00','unit-task-01','unit-task-05','unit-task-06','unit-task-10','unit-task-11','unit-task-15','unit-task-16']);
  assert.equal(new Set(plan.episodes.map(episode=>digestJson(episode.limits))).size,1);
  assert.equal(plan.variant,'baseline');assert.ok(plan.episodes.every(episode=>episode.variant==='baseline'));
  assert.deepEqual(verifyProbePlan(plan),plan);
  const changed=structuredClone(plan);changed.episodes[0]!.limits.outputTokenLimit++;
  assert.throws(()=>verifyProbePlan(changed),/plan_changed/);
  const reversed=input();reversed.tasks.reverse();reversed.models.reverse();assert.deepEqual(planModelProbe(reversed),plan);
});
test('crossed splits, duplicate tasks/models, unverified proof windows and unbounded reservations reject',()=>{
  for(const change of ['split','task','repo','model','proof','budget','calls'] as const){
    const value=input();
    if(change==='split')value.tasks[0]!.split='final' as 'development';
    if(change==='task')value.tasks[1]!.id=value.tasks[0]!.id;
    if(change==='repo')value.tasks[0]!.repoId='unexpected';
    if(change==='model')value.models[1]=structuredClone(value.models[0]!);
    if(change==='proof')value.models[0]!.accountVerifiedAt='2026-09-02T00:00:00.000Z';
    if(change==='budget')value.plannedBudgetUsd=0.1;
    if(change==='calls')value.limits.inferenceCallLimit=2;
    assert.throws(()=>planModelProbe(value));
  }
});
test('no invented catalog is required for a draft, and an empty draft cannot recommend a model',()=>{
  const {plan,rows,trust}=setup({models:[],plannedBudgetUsd:0});
  assert.equal(plan.episodes.length,0);assert.equal(plan.selectedTaskIds.length,8);
  const report=analyzeModelProbe(plan,rows,trust());assert.equal(report.selectedModelId,null);assert.ok(report.reasons.includes('account_catalog_not_configured'));
});
test('only complete accepted evidence can recommend the cheapest suitable candidate, retaining all cost and failure rows',()=>{
  const s=setup({minimumCorrectTasks:7});
  let report=analyzeModelProbe(s.plan,s.rows,s.trust());
  assert.equal(report.selectedModelId,'nvidia/unit-only-a');assert.equal(report.models[0]!.totalMeasuredCostMicros,'80000');
  assert.equal(report.recordedCostLowerBoundMicros,'240000');assert.equal(report.authenticityVerified,false);assert.equal(report.executedByThisCommand,false);
  s.rows[0]!.outcome='incorrect';
  report=analyzeModelProbe(s.plan,s.rows,s.trust());
  assert.equal(report.selectedModelId,'nvidia/unit-only-b');assert.equal(report.models[0]!.falseApprovals,1);
  assert.equal(report.recordedEpisodes,16);assert.equal(report.models[0]!.failures,1);assert.equal(report.models[0]!.totalMeasuredCostMicros,'80000');
});
test('missing, unaccepted, synthetic, incompletely billed and unknown-CPU observations suppress every selection',()=>{
  for(const change of ['missing','unaccepted','synthetic','billing','cpu','modelProof','expired'] as const){
    const s=setup();let trust=s.trust();
    if(change==='missing')s.rows.pop();
    if(change==='unaccepted')trust.acceptedResultDigests=[];
    if(change==='synthetic')s.rows[0]!.scope='synthetic-unit-only';
    if(change==='billing'){s.rows[0]!.billingComplete=false;s.rows[0]!.measuredCostMicros=null;}
    if(change==='cpu')s.rows[0]!.sandboxCpuSeconds=null;
    if(change==='modelProof')trust.acceptedModelProofDigests=[];
    if(change==='expired')trust.now=new Date('2026-09-03T00:00:00.000Z');
    if(!['unaccepted','modelProof','expired'].includes(change))trust=s.trust();
    const report=analyzeModelProbe(s.plan,s.rows,trust);
    assert.equal(report.selectedModelId,null,change);assert.equal(report.status,'blocked');
    assert.equal(report.recordedEpisodes,s.rows.length);
  }
});
test('contradictory approvals, zero-call successes and falsified timestamp intervals are structurally invalid',()=>{
  const s=setup(),first=s.rows[0]!;
  for(const fields of [
    {outcome:'no_patch',runtimeApproved:true}, {outcome:'infrastructure_error',runtimeApproved:true},
    {inferenceCalls:0,modelRequestIds:[]}, {elapsedMs:0},
    {modelRequestIds:['duplicate','duplicate']}, {sandboxOperationIds:['duplicate','duplicate']},
    {independentlyAdjudicated:false}, {adjudicationDigest:null}, {variant:'patchproof'},
  ])assert.equal(ProbeResultSchema.safeParse({...first,...fields}).success,false);
  const long={...first,finishedAt:new Date(Date.parse(first.startedAt)+121_000).toISOString(),elapsedMs:121_000};
  s.rows[0]=ProbeResultSchema.parse(long);
  const report=analyzeModelProbe(s.plan,s.rows,s.trust());assert.equal(report.selectedModelId,null);assert.ok(report.reasons.includes('unmatched_budget'));
});
test('setup failure before inference stays in the denominator and cost; changed bindings and duplicate rows reject',()=>{
  const s=setup({minimumCorrectTasks:7});
  s.rows[0]=ProbeResultSchema.parse({...s.rows[0],outcome:'infrastructure_error',runtimeApproved:false,independentlyAdjudicated:false,
    bundleDigest:null,adjudicationDigest:null,inferenceCalls:0,modelRequestIds:[],sandboxOperationIds:[],failureReason:'unit-only setup failure'});
  const report=analyzeModelProbe(s.plan,s.rows,s.trust());assert.equal(report.models[0]!.correctTasks,7);assert.equal(report.models[0]!.failures,1);assert.equal(report.models[0]!.totalMeasuredCostMicros,'80000');
  assert.throws(()=>analyzeModelProbe(s.plan,[...s.rows,s.rows[0]],s.trust()),/duplicate_observation/);
  const changed=structuredClone(s.rows);changed[0]!.fixtureDigest=digestBytes('changed');assert.throws(()=>analyzeModelProbe(s.plan,changed,s.trust()),/observation_binding/);
});
test('private offline command preserves accepted plan, exclusive outputs, modes and redacted rejection',()=>{
  const s=setup(),directory=mkdtempSync(join(tmpdir(),'patchproof-probe-unit-')),project=join(directory,'project'),privateDir=join(directory,'private');
  mkdirSync(project,{mode:0o700});mkdirSync(privateDir,{mode:0o700});
  const files=['input','plan','rows','trust','report'].map(name=>join(privateDir,name+'.json'));
  const save=(file:string,value:unknown)=>writeFileSync(file,JSON.stringify(value),{mode:0o600});
  try{
    save(files[0]!,input());
    const planned=runModelProbeOperator(['plan',files[0]!,files[1]!],project,now);assert.equal(planned.exitCode,0);assert.equal(planned.output.providerCalls,0);
    assert.deepEqual(JSON.parse(readFileSync(files[1]!,'utf8')),s.plan);
    save(files[2]!,s.rows);const {now:_now,...trust}=s.trust();save(files[3]!,trust);
    const analyzed=runModelProbeOperator(['analyze',files[1]!,files[2]!,files[3]!,files[4]!],project,now);assert.equal(analyzed.exitCode,0);
    const bytes=readFileSync(files[4]!);assert.equal(runModelProbeOperator(['analyze',files[1]!,files[2]!,files[3]!,files[4]!],project,now).exitCode,2);assert.deepEqual(readFileSync(files[4]!),bytes);
    rmSync(files[4]!);save(files[3]!,{...trust,planDigest:digestBytes('unaccepted')});
    assert.equal(runModelProbeOperator(['analyze',files[1]!,files[2]!,files[3]!,files[4]!],project,now).exitCode,2);assert.equal(existsSync(files[4]!),false);
    chmodSync(files[0]!,0o644);const rejected=runModelProbeOperator(['plan',files[0]!,files[4]!],project,now);assert.equal(rejected.exitCode,2);assert.ok(!JSON.stringify(rejected).includes(directory));
  }finally{rmSync(directory,{recursive:true,force:true});}
});
