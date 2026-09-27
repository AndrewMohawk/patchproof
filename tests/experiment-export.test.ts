import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {chmod,copyFile,link,mkdtemp,mkdir,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {digestBytes} from '../packages/contracts/src/digest.ts';
import {planExperiment,hashJson} from '../workers/evaluator/protocol.ts';
import {analyzeExperiment} from '../workers/evaluator/analysis.ts';
import {captureExperimentSnapshot,exportExperiment,verifyExperimentExport,validateExperimentCapture,liveReadinessReceiptDigest} from '../workers/evaluator/experiment-export.ts';
import type {ExperimentCapture,LiveReadinessReceipt} from '../workers/evaluator/experiment-export.ts';

// Invented metadata only; no execution callback, candidate file, corpus or provider is used.
const H='sha256:'+'a'.repeat(64),J='sha256:'+'b'.repeat(64),K='sha256:'+'c'.repeat(64),NOW='2026-09-27T16:00:00.000Z';
const usage=()=>({inferenceCalls:0,inputTokens:0,outputTokens:0,runtimeFeedbackRounds:0,elapsedMs:0,sandboxCpuSeconds:0,measuredCostUsd:0});
function plan(kind:'pilot'|'final'='pilot'){
  const tasks=Array.from({length:kind==='pilot'?4:6},(_,r)=>Array.from({length:5},(_,i)=>({id:`invented-${r}-${i}`,repoId:`invented-repo-${r}`,split:kind==='pilot'?'development' as const:'final' as const,fixtureDigest:H,oracleDigest:J}))).flat();
  return planExperiment({kind,tasks,limits:{inferenceCallLimit:24,inputTokenLimit:1000,outputTokenLimit:1000,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:900,maxApprovedSpendUsd:0.01},sourceManifestDigest:J,modelLockDigest:H,policyDigest:K,approvedExperimentBudgetUsd:5,estimatedExperimentCostUsd:3,createdAt:NOW});
}
const dispatchId=(digest:string,id:string)=>{const h=hashJson([digest,id]).slice(7);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
function capture(kind:'pilot'|'final'='pilot',executionMode:'synthetic'|'live'='synthetic'):ExperimentCapture{
  const p=plan(kind),bindings={sourceDigest:H,planDigest:hashJson(p),transportDigest:K};
  return{schemaVersion:'1.0',kind:'trusted-experiment-metadata',capturedAt:NOW,bindings,sourceBinding:'expected-historical-lock',executionMode,benchmarkExecuted:false,plan:p,
    episodes:p.episodes.map(e=>({episodeId:e.id,dispatchId:dispatchId(bindings.planDigest,e.id),phase:'pending',reason:null,cancelRequested:false,operationIds:[],observedUsage:usage(),result:null}))};
}
function terminal(c:ExperimentCapture,index:number,outcome:'correct'|'incorrect'|'unverified'|'infrastructure_error'='unverified'){
  const row=c.episodes[index]!,e=c.plan.episodes[index]!;row.phase='terminal';row.reason='completed';
  const body={episodeId:e.id,planDigest:c.bindings.planDigest,modelLockDigest:H,policyDigest:c.plan.policyDigest,variant:e.variant,outcome,runtimeApproved:false,sealedChecksExecuted:outcome==='correct'||outcome==='incorrect',includesSetupAndRetries:true as const,finalOracleFeedbackRounds:0 as const,infrastructureExclusion:null,usage:usage(),artifactsDigest:J};
  row.result=c.executionMode==='synthetic'?{...body,executionMode:'synthetic',benchmarkExecuted:false}:{...body,executionMode:'live'};
}
function readiness(c:ExperimentCapture):LiveReadinessReceipt{return{schemaVersion:'1.0',kind:'experiment-preflight-readiness',bindings:c.bindings,observedAt:NOW,
  gates:{accountAccessVerified:true,sandboxEntitlementVerified:true,modelVerified:true,realIntegrationPassed:true,oracleIndependentlyReviewed:true,experimentApproved:true,approvedRemainingSpendUsd:5,pricesVerified:true,finalProtocolFrozen:true}};}
async function setup(t:TestContext){
  const dir=await mkdtemp(join(tmpdir(),'patchproof-aggregate-unit-')),projectRoot=join(dir,'project');await mkdir(projectRoot,{mode:0o700});
  t.after(async()=>{for(const name of await readdir(dir,{withFileTypes:true}))if(name.isDirectory())await chmod(join(dir,name.name),0o700);await rm(dir,{recursive:true,force:true});});
  const out=(name='export')=>join(dir,name);
  const write=(c:ExperimentCapture,name='export',r?:LiveReadinessReceipt)=>exportExperiment({directory:out(name),projectRoot,capture:c,expected:c.bindings,...(r?{liveReadinessReceipt:r,acceptedReadinessReceiptDigest:liveReadinessReceiptDigest(r)}:{})});
  return{dir,projectRoot,out,write};
}
async function dbFor(dir:string,c:ExperimentCapture){
  const filename=join(dir,'dispatcher.sqlite'),db=new DatabaseSync(filename);
  db.exec('CREATE TABLE experiment(id INTEGER PRIMARY KEY,plan_digest TEXT,plan_json TEXT,mode TEXT,transport_digest TEXT); CREATE TABLE episodes(episode_id TEXT,dispatch_id TEXT,position INTEGER,phase TEXT,reason TEXT,cancel_requested INTEGER,usage_json TEXT,operations_json TEXT,result_json TEXT,execution_json TEXT); CREATE TABLE dispatch_events(kind TEXT);');
  db.prepare('INSERT INTO experiment VALUES(1,?,?,?,?)').run(c.bindings.planDigest,JSON.stringify(c.plan),c.executionMode,c.bindings.transportDigest);
  for(const[index,row]of c.episodes.entries())db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?,?)').run(row.episodeId,row.dispatchId,index,row.phase,row.reason,row.cancelRequested?1:0,JSON.stringify(row.observedUsage),JSON.stringify(row.operationIds),row.result?JSON.stringify(row.result):null,'PRIVATE_CONTENT_MUST_NEVER_BE_SELECTED_OR_PARSED');
  if(c.benchmarkExecuted)db.prepare('INSERT INTO dispatch_events VALUES(?)').run('executor_started');db.close();await chmod(filename,0o600);return filename;
}
async function rewriteArtifact(directory:string,path:string,value:unknown){
  await chmod(directory,0o700);const file=join(directory,path);await chmod(file,0o600);const bytes=Buffer.from(JSON.stringify(value)+'\n');await writeFile(file,bytes);await chmod(file,0o400);
  const manifestFile=join(directory,'manifest.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));
  const item=manifest.artifacts.find((item:{path:string})=>item.path===path);item.bytes=bytes.length;item.digest=digestBytes(bytes);
  await chmod(manifestFile,0o600);await writeFile(manifestFile,JSON.stringify(manifest)+'\n');await chmod(manifestFile,0o400);
}

test('read-only capture preserves full grid and active checkpoints without selecting private artifact content',async t=>{
  const s=await setup(t),c=capture();c.episodes[0]!.phase='executing';c.episodes[0]!.observedUsage={...usage(),inferenceCalls:2,inputTokens:10,sandboxCpuSeconds:1,measuredCostUsd:0.003};c.episodes[0]!.operationIds=['intent/unit/1'];
  const filename=await dbFor(s.dir,c),before=await readFile(filename),captured=captureExperimentSnapshot({dispatcherDatabase:filename,expected:c.bindings,sourceBinding:'expected-historical-lock',now:()=>new Date(NOW)});
  assert.deepEqual(captured,c);assert.deepEqual(await readFile(filename),before);const exported=s.write(captured);
  assert.equal(exported.summary.plannedEpisodes,72);assert.equal(exported.summary.activeEpisodes,1);assert.equal(exported.summary.observedUsageLowerBounds.inferenceCalls,2);
  for(const name of await readdir(exported.directory))assert.ok(!(await readFile(join(exported.directory,name),'utf8')).includes('PRIVATE_CONTENT'));
});

test('72 and 270 synthetic grids retain every row while remaining excluded from scored analysis',async t=>{
  const s=await setup(t);for(const kind of['pilot','final']as const){const c=capture(kind);for(let i=0;i<c.episodes.length;i++)terminal(c,i,i%2?'incorrect':'correct');
    const result=s.write(c,kind),verified=verifyExperimentExport({directory:s.out(kind),expected:c.bindings,expectedManifestDigest:result.manifestDigest});
    assert.equal(verified.summary.terminalEpisodes,kind==='pilot'?72:270);assert.equal(verified.summary.complete,true);assert.equal(verified.summary.benchmarkExecuted,false);
    assert.deepEqual(verified.analysis,{status:'not-analyzed',reason:'synthetic-excluded',report:null});assert.equal(verified.authenticityVerified,false);assert.equal(verified.manifest.sourceExecutionVerified,false);
    assert.throws(()=>analyzeExperiment(c.plan,c.episodes.map(row=>row.result)));assert.equal((await stat(s.out(kind))).mode&0o777,0o500);
    for(const name of await readdir(s.out(kind)))assert.equal((await stat(join(s.out(kind),name))).mode&0o777,0o400);
  }
});

test('partial, cancelled and failed episodes retain planned denominators and known usage lower bounds',async t=>{
  const s=await setup(t),c=capture();terminal(c,0);c.episodes[0]!.reason='cancelled';c.episodes[0]!.cancelRequested=true;
  terminal(c,1,'infrastructure_error');const failed=c.episodes[1]!;failed.reason='provider_timeout';failed.result!.infrastructureExclusion='provider_timeout';failed.observedUsage={...usage(),inferenceCalls:2,sandboxCpuSeconds:3,measuredCostUsd:0.004};failed.result!.usage={...failed.observedUsage,sandboxCpuSeconds:null,measuredCostUsd:null};
  c.episodes[2]!.phase='adjudicating';c.episodes[2]!.observedUsage={...usage(),inferenceCalls:4,sandboxCpuSeconds:5,measuredCostUsd:0.006};
  const{summary}=s.write(c);assert.equal(summary.plannedEpisodes,72);assert.equal(summary.terminalEpisodes,2);assert.equal(summary.activeEpisodes,1);assert.equal(summary.pendingEpisodes,69);
  assert.equal(summary.observedUsageLowerBounds.inferenceCalls,6);assert.equal(summary.observedUsageLowerBounds.sandboxCpuSeconds,8);assert.equal(summary.observedUsageLowerBounds.measuredCostUsd,0.01);
  assert.equal(summary.unknownCostEpisodeIds.length,71);assert.equal(summary.unknownCpuEpisodeIds.length,71);assert.equal(summary.cancelledEpisodeIds.length,1);assert.equal(summary.ledgerReconciliationIncluded,false);
  const rows=JSON.parse(await readFile(join(s.out(),'results.json'),'utf8'));assert.equal(rows[1].usage.measuredCostUsd,null);assert.equal(rows[1].usage.sandboxCpuSeconds,null);
});

test('invented live-shaped rows reach the existing analyzer only with accepted bound valid readiness',async t=>{
  const s=await setup(t),c=capture('pilot','live');c.benchmarkExecuted=true;for(let i=0;i<c.episodes.length;i++)terminal(c,i,'incorrect');const r=readiness(c);
  const result=s.write(c,'live',r),verified=verifyExperimentExport({directory:s.out('live'),expected:c.bindings,acceptedReadinessReceiptDigest:liveReadinessReceiptDigest(r)});
  assert.equal((result.analysis as {status:string}).status,'live-analysis');assert.deepEqual(verified.analysis,{status:'live-analysis',reason:null,report:analyzeExperiment(c.plan,c.episodes.map(row=>row.result))});
  assert.throws(()=>verifyExperimentExport({directory:s.out('live'),expected:c.bindings}),/independently accepted/);
});

test('missing readiness, false gates and unstarted live metadata produce no scored report',async t=>{
  const s=await setup(t),c=capture('pilot','live');const unstarted=s.write(c,'unstarted');assert.equal((unstarted.analysis as {reason:string}).reason,'no-recorded-execution');
  c.benchmarkExecuted=true;terminal(c,0,'incorrect');assert.equal((s.write(c,'missing').analysis as {reason:string}).reason,'missing-readiness-receipt');
  const r=readiness(c);r.gates.realIntegrationPassed=false;assert.equal((s.write(c,'false',r).analysis as {reason:string}).reason,'readiness-gates-not-satisfied');
  const options={directory:s.out('invalid'),projectRoot:s.projectRoot,capture:c,expected:c.bindings};
  assert.throws(()=>exportExperiment({...options,liveReadinessReceipt:readiness(c),acceptedReadinessReceiptDigest:J}),/independently accepted/);
  assert.throws(()=>exportExperiment({...options,liveReadinessReceipt:{...readiness(c),gates:{...r.gates,pricesVerified:undefined}},acceptedReadinessReceiptDigest:H}));
  const bound=readiness(c);bound.bindings={...bound.bindings,sourceDigest:J};assert.throws(()=>exportExperiment({...options,liveReadinessReceipt:bound,acceptedReadinessReceiptDigest:liveReadinessReceiptDigest(bound)}),/binding\/time mismatch/);
});

test('live partial, unknown and over-budget data keep analyzer comparisons suppressed',async t=>{
  const s=await setup(t),c=capture('pilot','live');c.benchmarkExecuted=true;for(let i=0;i<c.episodes.length;i++)terminal(c,i,'incorrect');
  c.episodes[0]!.result!.usage.measuredCostUsd=null;c.episodes[1]!.result!.usage.inferenceCalls=25;const report=(s.write(c,'unknown',readiness(c)).analysis as {report:ReturnType<typeof analyzeExperiment>}).report;
  assert.equal(report.recordedEpisodes,72);assert.equal(report.metrics.reduce((n,m)=>n+m.primaryYield.denominator,0),72);assert.equal(report.comparisons.length,0);assert.equal(report.budgetEvidenceIncomplete.length,1);assert.equal(report.budgetViolations.length,1);
  c.episodes[2]!.phase='pending';c.episodes[2]!.reason=null;c.episodes[2]!.result=null;const partial=(s.write(c,'partial',readiness(c)).analysis as {report:ReturnType<typeof analyzeExperiment>}).report;
  assert.equal(partial.recordedEpisodes,71);assert.equal(partial.complete,false);assert.equal(partial.missingEpisodeIds.length,1);
});

test('capture validation refuses identity, terminal, mode and checkpoint contradictions',()=>{
  for(const change of[(c:ExperimentCapture)=>{c.episodes.pop();},(c:ExperimentCapture)=>{c.episodes[0]!.episodeId=c.episodes[1]!.episodeId;},(c:ExperimentCapture)=>{c.episodes[0]!.dispatchId='00000000-0000-4000-8000-000000000000';},(c:ExperimentCapture)=>{c.episodes[0]!.phase='terminal';},(c:ExperimentCapture)=>{c.benchmarkExecuted=true;},(c:ExperimentCapture)=>{terminal(c,0);c.episodes[0]!.result!.executionMode='live';},(c:ExperimentCapture)=>{terminal(c,0);c.episodes[0]!.observedUsage.inferenceCalls=2;},(c:ExperimentCapture)=>{terminal(c,0,'correct');c.episodes[0]!.result!.sealedChecksExecuted=false;}]){const c=capture();change(c);assert.throws(()=>validateExperimentCapture(c,c.bindings));}
});

test('capture rejects wrong external bindings, malformed DB positions and oversized fields',async t=>{
  const s=await setup(t),c=capture(),filename=await dbFor(s.dir,c),options={dispatcherDatabase:filename,expected:c.bindings,sourceBinding:'current-operational-lock' as const};
  assert.throws(()=>captureExperimentSnapshot({...options,expected:{...c.bindings,transportDigest:H}}),/binding mismatch/);
  const db=new DatabaseSync(filename);db.prepare('UPDATE episodes SET position=400 WHERE position=0').run();assert.throws(()=>captureExperimentSnapshot(options),/position|identity/);
  db.prepare('UPDATE episodes SET position=0,operations_json=? WHERE position=400').run(' '.repeat(256*1024+1));db.close();assert.throws(()=>captureExperimentSnapshot(options),/oversized/);
});

test('offline verification detects wrong pins, changed bytes, omitted and additional artifacts',async t=>{
  const s=await setup(t),c=capture();s.write(c);assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:{...c.bindings,sourceDigest:J}}),/binding/);
  assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings,expectedManifestDigest:H}),/Pinned manifest/);
  await chmod(s.out(),0o700);await writeFile(join(s.out(),'extra.json'),'{}',{mode:0o600});assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings}),/Unexpected/);await rm(join(s.out(),'extra.json'));
  await chmod(join(s.out(),'results.json'),0o600);await writeFile(join(s.out(),'results.json'),'[{}]');assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings}),/digest mismatch/);await rm(join(s.out(),'results.json'));assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings}),/missing/);
});

test('rehashing a fabricated summary or dropping a result cannot fool recomputation',async t=>{
  const s=await setup(t),c=capture();terminal(c,0);const result=s.write(c);
  await rewriteArtifact(s.out(),'summary.json',{...result.summary,complete:true});assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings}),/do not match/);
  const second=s.write(c,'second');await rewriteArtifact(second.directory,'results.json',[]);assert.throws(()=>verifyExperimentExport({directory:second.directory,expected:c.bindings}),/do not match/);
});

test('exports refuse overwrites, source-tree output, public parents and symlink aliases',async t=>{
  const s=await setup(t),c=capture();s.write(c);assert.throws(()=>s.write(c),/EEXIST/);await mkdir(s.out('empty'),{mode:0o700});assert.throws(()=>s.write(c,'empty'),/EEXIST/);
  assert.throws(()=>exportExperiment({directory:join(s.projectRoot,'export'),projectRoot:s.projectRoot,capture:c,expected:c.bindings}),/outside/);
  const publicParent=join(s.dir,'public');await mkdir(publicParent,{mode:0o755});await chmod(publicParent,0o755);assert.throws(()=>s.write(c,'public/export'),/private/);
  await symlink(s.dir,s.out('alias'));assert.throws(()=>s.write(c,'alias/export'),/symlinks/);
});

test('offline and database readers refuse symlink or hardlink artifacts without reading targets',async t=>{
  const s=await setup(t),c=capture();s.write(c);await chmod(s.out(),0o700);const artifact=join(s.out(),'results.json');await rm(artifact);await symlink(join(s.out(),'plan.json'),artifact);
  assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings}),/regular file/);await rm(artifact);await link(join(s.out(),'plan.json'),artifact);assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings}),/regular file/);
  const db=await dbFor(s.dir,c),alias=join(s.dir,'db-alias');await symlink(db,alias);assert.throws(()=>captureExperimentSnapshot({dispatcherDatabase:alias,expected:c.bindings,sourceBinding:'expected-historical-lock'}),/regular file/);
});

test('manifest path traversal and duplicate artifact paths are rejected before opening them',async t=>{
  const s=await setup(t),c=capture();s.write(c);await chmod(s.out(),0o700);const path=join(s.out(),'manifest.json'),value=JSON.parse(await readFile(path,'utf8'));await chmod(path,0o600);
  value.artifacts[0].path='../dispatcher.sqlite';await writeFile(path,JSON.stringify(value));assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings}));
  value.artifacts[0].path='results.json';await writeFile(path,JSON.stringify(value));assert.throws(()=>verifyExperimentExport({directory:s.out(),expected:c.bindings}),/artifact-list/);
});
