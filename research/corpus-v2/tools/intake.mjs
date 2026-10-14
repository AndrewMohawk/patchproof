import { readFileSync, writeFileSync, mkdirSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { FixtureSchema, FunctionCaseSchema } from '../../../packages/contracts/src/product.ts';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const base=resolve(process.env.PATCHPROOF_EVALUATION_ROOT??join(projectRoot,'..','patchproof-evaluation-v2'));
const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function read(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>1048576)throw new Error('Unsafe input file');return readFileSync(path);}
function paths(files){return Object.keys(files).sort();}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function issue(issues,taskId,code,details=''){issues.push({taskId,code,details});}
export function intake(slot, submissionFile="submission.json"){
 if(!/^submission(?:-revision-\d{3})?\.json$/.test(submissionFile))throw new Error("Explicit valid submission filename required");
 if(!/^repo(?:0[1-9]|1[0-2])$/.test(slot))throw new Error('Invalid slot');
 const job=JSON.parse(read(join(base,'shared/jobs',slot+'.json'))),workspace=join(base,'authors',slot);
 const subbytes=read(join(workspace,submissionFile)),submission=JSON.parse(subbytes),issues=[];
 if(submission.repoId!==job.repoId||!/^revision-\d{3}$/.test(submission.revision))throw new Error('Submission identity/revision mismatch');
 const revision=join(workspace,submission.revision),listed=new Map();
 for(const f of submission.files??[]){
  if(typeof f.path!=='string'||f.path.startsWith('/')||f.path.split('/').some(s=>s==='..'||s==='.'||s===''))throw new Error('Invalid listed relative path');
  let path=resolve(revision,f.path);if(!relative(revision,path)||relative(revision,path).startsWith('..'))throw new Error('File outside revision');
  const bytes=read(path);if(digest(bytes)!==f.digest)throw new Error('Submission byte digest mismatch');if(listed.has(f.path))throw new Error('Duplicate listed file');listed.set(f.path,f.digest);
 }
 const expectedFiles=['provenance.json',...job.taskIds.flatMap(id=>['fixtures','gold','negative-controls'].map(d=>`${d}/${id}.json`))].sort();
 if(!equal([...listed.keys()].sort(),expectedFiles))issue(issues,null,'file_set_mismatch');
 const provenance=JSON.parse(read(join(revision,'provenance.json')));
 for(const [key,expected]of Object.entries({repoId:job.repoId,split:job.split,authorship:'independent-ai-original',license:'CC0-1.0',sharedInstructionDigest:digest(read(join(base,'shared/author-instructions.md'))),sharedJobDigest:digest(read(join(base,'shared/jobs',slot+'.json')))}))if(provenance[key]!==expected)issue(issues,null,'provenance_'+key);
 const identityName=typeof provenance.authorIdentity==='string'?provenance.authorIdentity:provenance.authorIdentity?.canonicalAgentName;
 if(!isDeepStrictEqual(provenance.authorIdentity,submission.authorIdentity)||typeof identityName!=='string'||!identityName.length||identityName.length>512)issue(issues,null,'author_identity');
 for(const [key,value]of Object.entries({readExistingFixtures:false,readOtherAuthors:false,copiedThirdPartyCode:false,providerCalls:0,candidateExecutions:0}))if(provenance.independenceAttestation?.[key]!==value)issue(issues,null,'independence_attestation_'+key);
 if(!equal(provenance.taskIds,job.taskIds))issue(issues,null,'provenance_task_set');
 const tasks=[];
 for(const id of job.taskIds){
  const fixtureBytes=read(join(revision,'fixtures',id+'.json')),oracleBytes=read(join(revision,'gold',id+'.json'));
  let fixture,oracle,controls;
  try{fixture=FixtureSchema.parse(JSON.parse(fixtureBytes));oracle=JSON.parse(oracleBytes);controls=JSON.parse(read(join(revision,'negative-controls',id+'.json')));}catch(e){issue(issues,id,'schema',String(e));continue;}
  if(fixture.id!==id||fixture.repoId!==job.repoId||fixture.split!==job.split||oracle.taskId!==id||controls.taskId!==id)issue(issues,id,'task_binding');
  if(!equal(fixture.requirements.map(x=>x.id).sort(),['R01','R02','R03']))issue(issues,id,'requirements');
  if(Object.keys(oracle).sort().join()!=='goldFiles,sealedCases,taskId')issue(issues,id,'oracle_fields');
  try{oracle.sealedCases=oracle.sealedCases.map(c=>FunctionCaseSchema.parse(c));}catch(e){issue(issues,id,'sealed_case_schema',String(e));continue;}
  const all=[...fixture.visibleCases,...fixture.acceptanceCases,...oracle.sealedCases];
  if(new Set(all.map(c=>c.id)).size!==all.length)issue(issues,id,'case_ids_unique');
  for(const [layer,cases]of Object.entries({visible:fixture.visibleCases,acceptance:fixture.acceptanceCases,sealed:oracle.sealedCases})){
   for(const req of fixture.requirements)if(!cases.some(c=>c.requirementId===req.id))issue(issues,id,'layer_requirement_coverage',layer+':'+req.id);
   for(const c of cases)if(!fixture.requirements.some(r=>r.id===c.requirementId))issue(issues,id,'unknown_requirement');
  }
  const fileNames=paths(fixture.files);
  if(fileNames.length<1||fileNames.length>3||!fileNames.includes(fixture.entrypoint)||fixture.entrypoint.includes('/')||fileNames.some(p=>!(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.py$/).test(p)))issue(issues,id,'source_paths');
  if(Object.values(fixture.files).reduce((s,v)=>s+Buffer.byteLength(v),0)>32768)issue(issues,id,'source_size');
  if(!equal(fileNames,paths(oracle.goldFiles)))issue(issues,id,'gold_file_set');
  if(fixture.editAllowlist.some(p=>!fileNames.includes(p))||new Set(fixture.editAllowlist).size!==fixture.editAllowlist.length)issue(issues,id,'edit_allowlist');
  for(const p of fileNames)if(fixture.files[p]!==oracle.goldFiles[p]&&!fixture.editAllowlist.includes(p))issue(issues,id,'gold_protected_edit');
  if(equal(fixture.files,oracle.goldFiles))issue(issues,id,'start_equals_gold');
  if(!Array.isArray(controls.controls)||!controls.controls.length)issue(issues,id,'missing_negative_control');
  else for(const c of controls.controls){
   if(!c.id||!fixture.requirements.some(r=>r.id===c.requirementId)||!c.description)issue(issues,id,'control_identity');
   if(!equal(fileNames,paths(c.files)))issue(issues,id,'control_file_set');
   if(equal(c.files,fixture.files)||equal(c.files,oracle.goldFiles))issue(issues,id,'control_not_distinct');
   if(!Array.isArray(c.expectedFailingCaseIds)||!c.expectedFailingCaseIds.length||c.expectedFailingCaseIds.some(x=>!all.some(k=>k.id===x&&k.requirementId===c.requirementId)))issue(issues,id,'control_case_mapping');
  }
  const publicKeys=new Set([...fixture.visibleCases,...fixture.acceptanceCases].map(c=>JSON.stringify([c.function,c.args,c.kwargs])));
  tasks.push({id,repoId:job.repoId,split:job.split,fixtureDigest:digest(fixtureBytes),oracleDigest:digest(oracleBytes),caseCount:all.length,sealedInputRepeats:oracle.sealedCases.filter(c=>publicKeys.has(JSON.stringify([c.function,c.args,c.kwargs]))).length,controlCount:controls.controls?.length??0});
 }
 const stamp=new Date().toISOString().replaceAll(':','-'),report={schemaVersion:'1.0',purpose:'independent-v2-structural-intake',slot,repoId:job.repoId,revision:submission.revision,authorIdentity:submission.authorIdentity,submissionFile,submissionDigest:digest(subbytes),status:issues.length?'requires_correction':'structural_pass_static_review_pending',issues,tasks,executionStatus:'NOT RUN'};
 const dir=join(base,'review',slot);mkdirSync(dir,{recursive:true,mode:0o700});const out=join(dir,stamp+'-intake.json');writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});return {report,path:out};
}
if(process.argv[1]===new URL(import.meta.url).pathname){const {report,path}=intake(process.argv[2],process.argv[3]);process.stdout.write(JSON.stringify({repoId:report.repoId,status:report.status,taskCount:report.tasks.length,issueCount:report.issues.length,privateReport:path})+'\n');process.exitCode=report.issues.length?2:0;}
