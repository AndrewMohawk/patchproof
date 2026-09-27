// Read-only reconciliation audit. Never starts/removes containers or reads authored source maps.
import { readdirSync, readFileSync, existsSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const EXPECTED_COMMIT='843b3687eb7b07d5a9ae0c7b00d3079804e596a8';
export const EXPECTED_INVENTORY_DIGEST='sha256:cc765ad32fe57bd3747b7faf3a6e6865436cdd18d8187ede100a7ff5cdfbc9f9';
export const EXPECTED_IMAGE='sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID=/^[a-f0-9]{64}$/,HASH=/^sha256:[a-f0-9]{64}$/;
const OP=new RegExp('^docker:patchproof-check-'+UUID.source.slice(1,-1)+'$');
const NAME=new RegExp('^patchproof-check-'+UUID.source.slice(1,-1)+'$');
const digest=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const demand=(ok,code)=>{if(!ok)throw new Error(code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function unique(a){return new Set(a).size===a.length;}
function same(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}

export function batchStems(names){
 const stems=new Set();
 for(const name of names){const m=name.match(/^(.+)\.(intent\.json|result\.json|events\.jsonl)$/);demand(m&&UUID.test(m[1]),'unexpected_batch_artifact');stems.add(m[1]);}
 return [...stems].sort();
}
export function validateBatch({stem,intent,result,events=[]}){
 demand(UUID.test(stem)&&object(intent)&&object(result),'missing_batch_pair');
 demand(intent.id===stem&&result.id===stem&&date(intent.startedAt)&&result.startedAt===intent.startedAt&&date(result.finishedAt),'batch_identity');
 demand(HASH.test(intent.inputDigest)&&Array.isArray(intent.caseIds)&&intent.caseIds.length>0&&intent.caseIds.every(v=>typeof v==='string')&&unique(intent.caseIds),'intent_shape');
 const r=result.result;demand(object(r)&&Array.isArray(r.operationIds)&&Array.isArray(r.checks)&&Array.isArray(events),'result_arrays');
 demand(r.operationIds.every(v=>typeof v==='string'&&OP.test(v))&&unique(r.operationIds),'operation_ids');
 demand(['local_container','unavailable'].includes(r.isolation)&&(r.infrastructureError===null||typeof r.infrastructureError==='string'),'result_scope');
 demand(same(r.checks.map(c=>c?.id),intent.caseIds),'case_identity');
 const persisted=[];
 for(const e of events){demand(object(e)&&e.kind==='operation-intent'&&OP.test(e.operationId)&&date(e.at),'event_shape');persisted.push(e.operationId);}
 demand(unique(persisted)&&same(persisted,r.operationIds),'event_operation_binding');
 const observed=[];
 for(const check of r.checks){
  demand(object(check)&&['pass','fail','error'].includes(check.status)&&typeof check.log==='string','check_shape');
  if(check.status==='error'&&typeof r.infrastructureError==='string'&&check.log==='NOT VERIFIED: '+r.infrastructureError)continue;
  let envelope;try{envelope=JSON.parse(check.log);}catch{throw new Error('lifecycle_log_shape');}
  const l=envelope?.dockerLifecycle;
  demand(object(l)&&OP.test(l.operationId)&&typeof l.createAcknowledged==='boolean'&&typeof l.cleanupConfirmed==='boolean'&&(l.containerId===null||ID.test(l.containerId))&&(l.cleanupReason===null||typeof l.cleanupReason==='string'),'lifecycle_shape');
  demand(l.cleanupConfirmed!==true||l.cleanupReason===null,'cleanup_reason');
  observed.push(l);
 }
 demand(unique(observed.map(l=>l.operationId))&&same(observed.map(l=>l.operationId),r.operationIds),'lifecycle_operation_binding');
 if(r.operationIds.length===0)demand(typeof r.infrastructureError==='string'&&r.checks.every(c=>c.status==='error'),'unexplained_zero_operations');
 return observed.map(lifecycle=>({operationId:lifecycle.operationId,ownerRunId:stem,lifecycle}));
}
export function validateReconciliation(r,operation){
 const e=r?.expected,c=r?.cleanup,l=operation.lifecycle;
 demand(object(e)&&object(c)&&NAME.test(e.name)&&'docker:'+e.name===operation.operationId&&e.ownerRunId===operation.ownerRunId&&UUID.test(e.ownerRunId)&&e.image===EXPECTED_IMAGE,'reconciliation_scope');
 demand(ID.test(e.id)&&c.confirmed===true&&c.reason===null&&c.id===e.id&&(l.containerId===null||l.containerId===c.id),'reconciliation_identity');
 demand(r.newCandidateExecution===false&&r.paidCalls===0,'reconciliation_execution');
 if(r.inspection!==undefined)demand(r.inspection.state==='present'&&r.inspection.id===c.id,'reconciliation_inspection');
 if(r.originalLifecycle!==undefined)demand(JSON.stringify(r.originalLifecycle)===JSON.stringify(l),'reconciliation_original');
 return c.id;
}
export function validateInventory(bytes,currentCommit){
 demand(digest(bytes)===EXPECTED_INVENTORY_DIGEST,'inventory_digest');const i=JSON.parse(bytes);
 demand(currentCommit===EXPECTED_COMMIT&&i.sourceCommit===EXPECTED_COMMIT&&i.sourceFiles===108&&object(i.sources)&&Object.keys(i.sources).length===108&&i.allBytesMatchedCommit===true,'inventory_scope');
 for(const[p,h]of Object.entries(i.sources))demand(typeof p==='string'&&p!==''&&!p.startsWith('/')&&!p.split('/').includes('..')&&HASH.test(h),'inventory_entry');
 return i;
}
export function parseListing(stdout,ownedRuns){
 demand(typeof stdout==='string','listing_type');const rows=[],seen=new Set();
 for(const line of stdout.split('\n')){
  if(line==='')continue;
  const parts=line.split('\t');demand(parts.length===3,'listing_columns');const[id,name,ownerRunId]=parts;
  demand(ID.test(id)&&NAME.test(name)&&UUID.test(ownerRunId)&&!seen.has(id),'listing_row');seen.add(id);
  rows.push({id,name,ownerRunId,inScope:ownedRuns.has(ownerRunId)});
 }
 return rows;
}

async function main(){
 const base='/home/andrewmohawk/patchproof-evaluation-v2',root='/home/andrewmohawk/patchproof';
 const readBytes=p=>{const s=lstatSync(p);demand(s.isFile()&&!s.isSymbolicLink()&&s.size<=64*1024*1024,'unsafe_metadata_file');return readFileSync(p);};
 const read=p=>JSON.parse(readBytes(p));
 const startedAt=new Date().toISOString(),ownedRuns=new Set(),operations=new Map(),unconfirmed=new Map(),errors=[];
 let batches=0,missingResults=0,duplicateHandles=0,operationBindingErrors=0;
 for(const dir of readdirSync(join(base,'candidate-corpus'))){
  if(!/^repo\d{2}-revision-\d{3}-[a-f0-9-]+$/.test(dir))continue;
  const batchdir=join(base,'candidate-corpus',dir,'artifacts/batches');if(!existsSync(batchdir))continue;
  let stems;try{stems=batchStems(readdirSync(batchdir));}catch(e){operationBindingErrors++;errors.push({dir,code:e.message});continue;}
  for(const stem of stems){
   ownedRuns.add(stem);const ip=join(batchdir,stem+'.intent.json'),rp=join(batchdir,stem+'.result.json'),ep=join(batchdir,stem+'.events.jsonl');
   if(!existsSync(rp))missingResults++;
   try{
    const intent=existsSync(ip)?read(ip):undefined,result=existsSync(rp)?read(rp):undefined;
    const events=existsSync(ep)?readBytes(ep).toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
    const rows=validateBatch({stem,intent,result,events});batches++;
    for(const row of rows){if(operations.has(row.operationId)){duplicateHandles++;continue;}operations.set(row.operationId,row);if(row.lifecycle.cleanupConfirmed===false)unconfirmed.set(row.operationId,row);}
   }catch(e){operationBindingErrors++;errors.push({dir,stem,code:e.message});}
  }
 }
 const reconciliations=[],unresolved=[];
 for(const[operationId,value]of unconfirmed){
  const matches=[];
  for(const file of readdirSync(join(base,'validation')).filter(n=>/^repo\d{2}-attempt\d{3}-cleanup-reconciliation\.json$/.test(n))){
   const p=join(base,'validation',file),r=read(p);if('docker:'+r.expected?.name!==operationId)continue;
   try{const id=validateReconciliation(r,value);matches.push({file,digest:digest(readBytes(p)),id});}catch(e){errors.push({file,code:e.message});}
  }
  if(matches.length!==1)unresolved.push(operationId);else reconciliations.push({operationId,...matches[0]});
 }
 const {runDocker}=await import('/home/andrewmohawk/patchproof/workers/sandbox/process.ts');
 const listing=await runDocker(['ps','--all','--no-trunc','--filter','label=org.patchproof.owned=true','--format','{{.ID}}\t{{.Names}}\t{{.Label "org.patchproof.run-id"}}'],{timeoutMs:10000});
 let listingConfirmed=!listing.error&&listing.code===0,listingRows=[];
 if(listingConfirmed)try{listingRows=parseListing(listing.stdout,ownedRuns);}catch(e){listingConfirmed=false;errors.push({code:e.message});}
 const remaining=listingRows.filter(r=>r.inScope);
 const inventoryPath=join(root,'research/corpus-v2/operational-source-843b368.json'),currentCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 let inventory=null;const sourceMismatches=[];
 try{inventory=validateInventory(readBytes(inventoryPath),currentCommit);for(const[path,expected]of Object.entries(inventory.sources)){const abs=resolve(root,path),rel=relative(root,abs);if(!rel||rel.startsWith('..')||digest(readBytes(abs))!==expected)sourceMismatches.push(path);}}catch(e){sourceMismatches.push('inventory_or_source_read_invalid');errors.push({code:e.message});}
 const status=batches>0&&operations.size>0&&missingResults===0&&duplicateHandles===0&&operationBindingErrors===0&&unresolved.length===0&&errors.length===0&&listingConfirmed&&remaining.length===0&&sourceMismatches.length===0&&currentCommit===EXPECTED_COMMIT?'complete_no_unresolved_owned_handles':'requires_review';
 const privateRecord={schemaVersion:'1.1',purpose:'Read-only local ownership/operation audit after all preparation processes finish',startedAt,finishedAt:new Date().toISOString(),status,batches,ownedBatchRunIds:[...ownedRuns].sort(),operations:[...operations].sort((a,b)=>a[0].localeCompare(b[0])),missingResults,duplicateHandles,operationBindingErrors,reconciliations,unresolved,errors,listingConfirmed,remaining,unrelatedOwnedContainers:listingRows.filter(r=>!r.inScope).length,sourceMismatches,currentCommit,operationalInventoryDigest:digest(readBytes(inventoryPath)),toolDigest:digest(readBytes(fileURLToPath(import.meta.url))),newCandidateExecution:false,providerCalls:0};
 const privatePath=join(base,'validation/local-handle-audit-private.json');writeFileSync(privatePath,JSON.stringify(privateRecord,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
 const summary={schemaVersion:'1.1',purpose:privateRecord.purpose,startedAt,finishedAt:privateRecord.finishedAt,status,batches,recordedOperations:operations.size,missingResults,duplicateHandles,operationBindingErrors,metadataErrors:errors.length,originalIncompleteCleanupRecords:unconfirmed.size,explicitReconciliations:reconciliations.length,unresolved:unresolved.length,listingConfirmed,remainingTaskOwnedContainers:remaining.length,unrelatedOwnedContainers:privateRecord.unrelatedOwnedContainers,sourceFilesChecked:inventory?Object.keys(inventory.sources).length:0,sourceMismatches:sourceMismatches.length,sourceCommit:currentCommit,operationalInventoryDigest:privateRecord.operationalInventoryDigest,privateAuditDigest:digest(readBytes(privatePath)),toolDigest:privateRecord.toolDigest,newCandidateExecution:false,providerCalls:0,limits:'Retained lifecycle records and exact explicit reconciliations plus a current well-formed project-owned listing. Unrelated owned run IDs are counted outside scope. This is integrity/accounting evidence, not authenticity.'};
 writeFileSync(join(root,'research/corpus-v2/local-handle-audit.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o644,flush:true});process.stdout.write(JSON.stringify(summary)+'\n');if(status!=='complete_no_unresolved_owned_handles')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
