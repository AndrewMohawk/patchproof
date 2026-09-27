import { readFileSync, writeFileSync } from 'node:fs';
import { inspectOwnedContainer, cleanupOwnedContainer } from '/home/andrewmohawk/patchproof/workers/sandbox/local-cleanup.ts';
import { runDocker } from '/home/andrewmohawk/patchproof/workers/sandbox/process.ts';
const batch=JSON.parse(readFileSync('/home/andrewmohawk/patchproof-evaluation-v2/candidate-corpus/repo11-revision-002-5d51ff7b-bc3a-4650-bd4e-c1994068abbb/artifacts/batches/82fca7b9-0675-498e-bc0b-2ecfbdce419a.result.json','utf8'));
const failed=batch.result.checks.map(c=>{try{return JSON.parse(c.log??'{}').dockerLifecycle;}catch{return null;}}).filter(l=>l&&!l.cleanupConfirmed);
if(failed.length!==1)throw new Error('One explicit unresolved lifecycle required');
const life=failed[0],expected={name:life.operationId.slice('docker:'.length),image:'sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51',ownerRunId:batch.id,...(life.containerId?{id:life.containerId}:{})},startedAt=new Date().toISOString();
const inspection=await inspectOwnedContainer(runDocker,expected,1000);
let beforeState=null;
if(inspection.state==='present'){
 const state=await runDocker(['container','inspect',inspection.id,'--format','{{json .State}}'],{timeoutMs:1000});
 if(!state.error&&state.code===0){const s=JSON.parse(state.stdout);beforeState={Status:s.Status,Running:s.Running,Pid:s.Pid,StartedAt:s.StartedAt,FinishedAt:s.FinishedAt};}
}
// A recorded cleanup containerId was obtained only by the pinned helper's successful ownership inspection.
const priorOwnedCreateObserved=Boolean(life.containerId);
const cleanup=inspection.state==='error'?{confirmed:false,id:expected.id??null,reason:inspection.reason}:await cleanupOwnedContainer(runDocker,expected,life.createAcknowledged||priorOwnedCreateObserved);
const result={purpose:'Explicit exact-handle reconciliation after an infrastructure error; preserve original incomplete cleanup record',startedAt,finishedAt:new Date().toISOString(),expected,originalLifecycle:life,priorOwnedCreateObserved,inspection,beforeState,cleanup,newCandidateExecution:false,paidCalls:0};
writeFileSync('/home/andrewmohawk/patchproof-evaluation-v2/validation/repo11-attempt001-cleanup-reconciliation.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
process.stdout.write(JSON.stringify({inspection,beforeState,priorOwnedCreateObserved,cleanup})+'\n');if(!cleanup.confirmed)process.exitCode=2;
