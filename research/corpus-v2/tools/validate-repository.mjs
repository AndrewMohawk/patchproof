import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, appendFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { DockerCheckRunner, LOCAL_IMAGE_ID } from '../../../workers/sandbox/index.ts';
import { validateFixtureOracles } from '../../../workers/evaluator/fixture-validation.ts';
import { FunctionCaseSchema, PRODUCT_CONTRACT_VERSION } from '../../../packages/contracts/src/product.ts';
import { intake } from '../review/intake.mjs';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const base=resolve(process.env.PATCHPROOF_EVALUATION_ROOT??join(project,'..','patchproof-evaluation-v2'));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:project,encoding:'utf8'}).trim();
if(sourceCommit!=='843b3687eb7b07d5a9ae0c7b00d3079804e596a8')throw new Error('Fresh validation requires the cleared source commit');
const digest=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
if(PRODUCT_CONTRACT_VERSION !== '2.2')throw new Error('Fresh corpus validation requires reviewed contract 2.2; no containers started');
const toolsBefore={validationToolDigest:digest(readFileSync(new URL(import.meta.url))),intakeToolDigest:digest(readFileSync(join(base,'review/intake.mjs')))};
const slot=process.argv[2];if(!/^repo(?:0[1-9]|1[0-2])$/.test(slot))throw new Error('Explicit repository slot required');
const approval=JSON.parse(readFileSync(join(base,'review',slot,'static-review.json')));
const {report:intaken,path:intakePath}=intake(slot,approval.submissionFile);if(intaken.issues.length)throw new Error('Structural review failed; no source execution');
if(approval.status!=='approved_for_bounded_validation'||approval.submissionDigest!==intaken.submissionDigest||approval.reviewerIsAuthor!==false||approval.taskReviews?.length!==5||approval.taskReviews.some(t=>t.status!=='reviewed')||approval.unresolvedFindings!==0)throw new Error('Bound static independent review required');
const reviewerProbeBytes=readFileSync(join(base,'review',slot,'reviewer-probes.json'));
const reviewerProbes=JSON.parse(reviewerProbeBytes);
if(reviewerProbes.submissionDigest!==intaken.submissionDigest||!Array.isArray(reviewerProbes.probes)||!reviewerProbes.probes.length)throw new Error('Bound reviewer probe required');
for(const probe of reviewerProbes.probes)for(const c of probe.cases){if(!isDeepStrictEqual(FunctionCaseSchema.parse(c),c))throw new Error('Reviewer probe changes under frozen JSON schema');}
const directory=join(base,'candidate-corpus',slot+'-'+intaken.revision+'-'+randomUUID());mkdirSync(directory,{mode:0o700});
for(const d of ['fixtures','gold','negative-controls','artifacts','artifacts/batches'])mkdirSync(join(directory,d),{mode:0o700});
const source=join(base,'authors',slot,intaken.revision);
for(const t of intaken.tasks)for(const d of ['fixtures','gold','negative-controls']){copyFileSync(join(source,d,t.id+'.json'),join(directory,d,t.id+'.json'));chmodSync(join(directory,d,t.id+'.json'),0o600);}
writeFileSync(join(directory,'split-manifest.json'),JSON.stringify({schemaVersion:'1.0',purpose:'private-independent-repository-validation',tasks:intaken.tasks.map(({id,repoId,split,fixtureDigest,oracleDigest})=>({id,repoId,split,fixtureDigest,oracleDigest}))},null,2)+'\n',{flag:'wx',mode:0o600});
const sourcePaths=[...readdirSync(join(project,'packages/contracts/src')).filter(p=>p.endsWith('.ts')).sort().map(p=>'packages/contracts/src/'+p),'package.json','package-lock.json','workers/evaluator/fixture-validation.ts','workers/repair/index.ts','workers/sandbox/index.ts','workers/sandbox/driver.ts','workers/sandbox/process.ts','workers/sandbox/local-cleanup.ts','workers/sandbox/reconcile.ts'];
const sourceBindings=()=>sourcePaths.map(path=>({path,digest:digest(readFileSync(join(project,path)))}));const before=sourceBindings();
writeFileSync(join(directory,'artifacts','reviewer-probes.json'),reviewerProbeBytes,{flag:'wx',mode:0o600});
writeFileSync(join(directory,'artifacts','intake.json'),JSON.stringify({intakePath,intaken,approval,sourceBindings:before},null,2)+'\n',{flag:'wx',mode:0o600});
const rawChecks=new DockerCheckRunner();const status=await rawChecks.status();if(!status.available)throw new Error('Pinned local runner unavailable');
const checks={async run(input,signal){
 const id=randomUUID(),batch=join(directory,'artifacts/batches',id),startedAt=new Date().toISOString();
 const event=value=>appendFileSync(batch+'.events.jsonl',JSON.stringify({at:new Date().toISOString(),...value})+'\n',{mode:0o600,flush:true});
 writeFileSync(batch+'.intent.json',JSON.stringify({id,startedAt,inputDigest:digest(Buffer.from(JSON.stringify(input))),caseIds:input.cases.map(c=>c.id)},null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
 try {const result=await rawChecks.run({...input,ownerRunId:id,onOperation:operationId=>event({kind:'operation-intent',operationId})},signal);
 writeFileSync(batch+'.result.json',JSON.stringify({id,startedAt,finishedAt:new Date().toISOString(),result},null,2)+'\n',{flag:'wx',mode:0o600,flush:true});return result;
 }catch(error){event({kind:'run-error',error:String(error)});throw error;}
}};
const summary=await validateFixtureOracles({workspace:directory,projectRoot:project,checks,concurrency:2,onProgress:(n,total)=>process.stdout.write(JSON.stringify({slot,stage:'gold-start-repeat',completed:n,total})+'\n')});
const outcomes=JSON.parse(readFileSync(join(directory,'artifacts','oracle-validation-private.json')));
const controls=[];
for(const t of intaken.tasks){
 const fixture=JSON.parse(readFileSync(join(directory,'fixtures',t.id+'.json'))),oracle=JSON.parse(readFileSync(join(directory,'gold',t.id+'.json')));
 const cases=[...fixture.visibleCases,...fixture.acceptanceCases,...oracle.sealedCases].map(c=>FunctionCaseSchema.parse(c));
 const intendedIds=new Set([...fixture.acceptanceCases,...oracle.sealedCases].map(c=>c.id)),prior=outcomes.reports.find(r=>r.id===t.id);
 if(!prior?.start.checks.some(c=>intendedIds.has(c.id)&&c.status==='fail'))controls.push({taskId:t.id,kind:'start-intended-failure',passed:false});
 for(const c of JSON.parse(readFileSync(join(directory,'negative-controls',t.id+'.json'))).controls){
  const selected=cases.filter(k=>c.expectedFailingCaseIds.includes(k.id));const result=await checks.run({files:c.files,entrypoint:fixture.entrypoint,cases:selected,timeoutSeconds:120,ownerRunId:randomUUID()},new AbortController().signal);
  const passed=result.isolation==='local_container'&&!result.infrastructureError&&result.checks.length===selected.length&&result.checks.every(k=>k.status==='fail');
  controls.push({taskId:t.id,kind:'author-negative-control',controlId:c.id,passed,result});
 }
}
for(const probe of reviewerProbes.probes){
 const fixture=JSON.parse(readFileSync(join(directory,'fixtures',probe.taskId+'.json'))),oracle=JSON.parse(readFileSync(join(directory,'gold',probe.taskId+'.json')));
 const cases=probe.cases.map(c=>FunctionCaseSchema.parse(c));if(!cases.length||!['semantic','negative-control'].includes(probe.kind))throw new Error('Invalid reviewer probe');
 const result=await checks.run({files:probe.kind==='semantic'?oracle.goldFiles:probe.files,entrypoint:fixture.entrypoint,cases,timeoutSeconds:120,ownerRunId:randomUUID()},new AbortController().signal);
 const wanted=probe.kind==='semantic'?'pass':'fail',passed=result.isolation==='local_container'&&!result.infrastructureError&&result.checks.length===cases.length&&result.checks.every(k=>k.status===wanted);
 controls.push({taskId:probe.taskId,kind:'independent-reviewer-'+probe.kind,probeId:probe.id,passed,result});
}
const after=sourceBindings(),toolsAfter={validationToolDigest:digest(readFileSync(new URL(import.meta.url))),intakeToolDigest:digest(readFileSync(join(base,'review/intake.mjs')))},sourceStable=JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(toolsBefore)===JSON.stringify(toolsAfter);
const pass=sourceStable&&summary.goldPassedTasks===5&&summary.buggyRejectedTasks===5&&summary.repeatStableTasks===5&&summary.infrastructureFailedTasks===0&&controls.every(c=>c.passed);
const result={schemaVersion:'1.0',sourceCommit,productContractVersion:PRODUCT_CONTRACT_VERSION,...toolsBefore,purpose:'independently-authored-v2-fixture-preparation',slot,repoId:intaken.repoId,authorIdentity:intaken.authorIdentity,submissionDigest:intaken.submissionDigest,runnerImage:LOCAL_IMAGE_ID,reviewerProbeDigest:digest(reviewerProbeBytes),sourceStable,sourceBindings:after,summary,controls,status:pass?'validated':'requires_review',benchmarkExecuted:false,providerCalls:0,spendUsd:0};
const out=join(directory,'artifacts','validation-private.json');writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify({slot,status:result.status,goldPassedTasks:summary.goldPassedTasks,buggyRejectedTasks:summary.buggyRejectedTasks,repeatStableTasks:summary.repeatStableTasks,controlsPassed:controls.filter(c=>c.passed).length,controlsTotal:controls.length,privateResult:out})+'\n');process.exitCode=pass?0:2;
