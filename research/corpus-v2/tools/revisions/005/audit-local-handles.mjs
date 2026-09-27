// Read-only reconciliation audit. Never starts or removes a container or reads authored source maps.
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runDocker } from '/home/andrewmohawk/patchproof/workers/sandbox/process.ts';
const base='/home/andrewmohawk/patchproof-evaluation-v2',root='/home/andrewmohawk/patchproof';
const digest=b=>'sha256:'+createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(readFileSync(p,'utf8'));
const startedAt=new Date().toISOString(),ownedRuns=new Set(),operations=new Map(),unconfirmed=new Map();let batches=0,missingResults=0,duplicateHandles=0,operationBindingErrors=0;
for(const dir of readdirSync(join(base,'candidate-corpus'))){
 if(!/^repo\d{2}-revision-\d{3}-[a-f0-9-]+$/.test(dir))continue;
 const artifacts=join(base,'candidate-corpus',dir,'artifacts'),batchdir=join(artifacts,'batches');
 if(!existsSync(batchdir))continue;
 for(const name of readdirSync(batchdir).filter(s=>s.endsWith('.intent.json'))){
  const intent=read(join(batchdir,name)),resultPath=join(batchdir,name.replace('.intent.json','.result.json'));ownedRuns.add(intent.id);
  if(!existsSync(resultPath)){missingResults++;continue;}
  batches++;const result=read(resultPath);if(result.id!==intent.id)operationBindingErrors++;
  const eventsPath=join(batchdir,name.replace('.intent.json','.events.jsonl'));
  const events=existsSync(eventsPath)?readFileSync(eventsPath,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
  const persisted=new Set(events.filter(e=>e.kind==='operation-intent').map(e=>e.operationId));
  const observed=new Map();
  for(const check of result.result.checks??[]){
   if(!check.log)continue;let envelope;try{envelope=JSON.parse(check.log);}catch{continue;}
   if(envelope.dockerLifecycle)observed.set(envelope.dockerLifecycle.operationId,envelope.dockerLifecycle);
  }
  for(const operationId of result.result.operationIds??[]){
   if(operations.has(operationId))duplicateHandles++;
   if(!/^docker:patchproof-check-[a-f0-9-]+$/.test(operationId)||!persisted.has(operationId)||!observed.has(operationId)){operationBindingErrors++;continue;}
   const lifecycle=observed.get(operationId);operations.set(operationId,{ownerRunId:intent.id,lifecycle});
   if(!lifecycle.cleanupConfirmed)unconfirmed.set(operationId,{ownerRunId:intent.id,lifecycle});
  }
  if(persisted.size!==(result.result.operationIds??[]).length)operationBindingErrors++;
 }
}
const reconciliations=[],unresolved=[];
for(const[operationId,value]of unconfirmed){
 const matches=[];
 for(const file of readdirSync(join(base,'validation')).filter(n=>/^repo\d{2}-attempt\d{3}-cleanup-reconciliation\.json$/.test(n))){
  const p=join(base,'validation',file),r=read(p);
  if('docker:'+r.expected.name===operationId&&r.expected.ownerRunId===value.ownerRunId&&r.cleanup.confirmed&&r.cleanup.id&&(!value.lifecycle.containerId||value.lifecycle.containerId===r.cleanup.id))matches.push({file,digest:digest(readFileSync(p)),id:r.cleanup.id});
 }
 if(matches.length!==1)unresolved.push(operationId);else reconciliations.push({operationId,...matches[0]});
}
const listing=await runDocker(['ps','--all','--no-trunc','--filter','label=org.patchproof.owned=true','--format','{{.ID}}\t{{.Names}}\t{{.Label "org.patchproof.run-id"}}'],{timeoutMs:10000});
const listingConfirmed=!listing.error&&listing.code===0,remaining=[];
if(listingConfirmed)for(const line of listing.stdout.trim().split('\n').filter(Boolean)){const[id,name,ownerRunId]=line.split('\t');if(ownedRuns.has(ownerRunId))remaining.push({id,name,ownerRunId});}
const inventoryPath=join(root,'research/corpus-v2/operational-source-843b368.json'),inventory=read(inventoryPath),sourceMismatches=[];
for(const[path,expected]of Object.entries(inventory.sources)){
 const abs=resolve(root,path),rel=relative(root,abs);if(!rel||rel.startsWith('..')||digest(readFileSync(abs))!==expected)sourceMismatches.push(path);
}
const currentCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const status=missingResults===0&&duplicateHandles===0&&operationBindingErrors===0&&unresolved.length===0&&listingConfirmed&&remaining.length===0&&sourceMismatches.length===0&&currentCommit===inventory.sourceCommit?'complete_no_unresolved_owned_handles':'requires_review';
const privateRecord={schemaVersion:'1.0',purpose:'Read-only local ownership/operation audit after all preparation processes finish',startedAt,finishedAt:new Date().toISOString(),status,batches,ownedBatchRunIds:[...ownedRuns].sort(),operations:[...operations].sort((a,b)=>a[0].localeCompare(b[0])),missingResults,duplicateHandles,operationBindingErrors,reconciliations,unresolved,listingConfirmed,remaining,sourceMismatches,currentCommit,operationalInventoryDigest:digest(readFileSync(inventoryPath)),toolDigest:digest(readFileSync(new URL(import.meta.url))),newCandidateExecution:false,providerCalls:0};
const privatePath=join(base,'validation','local-handle-audit-private.json');writeFileSync(privatePath,JSON.stringify(privateRecord,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
const summary={schemaVersion:'1.0',purpose:privateRecord.purpose,startedAt,finishedAt:privateRecord.finishedAt,status,batches,recordedOperations:operations.size,missingResults,duplicateHandles,operationBindingErrors,originalIncompleteCleanupRecords:unconfirmed.size,explicitReconciliations:reconciliations.length,unresolved:unresolved.length,listingConfirmed,remainingTaskOwnedContainers:remaining.length,sourceFilesChecked:Object.keys(inventory.sources).length,sourceMismatches:sourceMismatches.length,sourceCommit:currentCommit,operationalInventoryDigest:privateRecord.operationalInventoryDigest,privateAuditDigest:digest(readFileSync(privatePath)),toolDigest:privateRecord.toolDigest,newCandidateExecution:false,providerCalls:0,limits:'This combines retained lifecycle records and explicit reconciliations with a current listing of containers bearing this project label and one of the recorded batch run IDs. It makes no claim about unrelated host workloads.'};
writeFileSync(join(root,'research/corpus-v2/local-handle-audit.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o644,flush:true});process.stdout.write(JSON.stringify(summary)+'\n');if(status!=='complete_no_unresolved_owned_handles')process.exitCode=2;
