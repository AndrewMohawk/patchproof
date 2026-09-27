import {closeSync,constants,fstatSync,fsyncSync,lstatSync,openSync,readdirSync,readSync,writeSync} from 'node:fs';
import type {Stats} from 'node:fs';
import {dirname,isAbsolute,join,parse,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {DigestSchema,TaskIdSchema} from '../packages/contracts/src/index.ts';
import {ProductRunSchema} from '../packages/contracts/src/product-validation.ts';
import type {ProductEvidence} from '../packages/contracts/src/product.ts';
import {digestBytes,digestJson} from '../packages/contracts/src/digest.ts';
import {fixtureDigests,loadFixtures} from '../packages/orchestrator/src/fixtures.ts';
import {verifyEvidence} from '../packages/orchestrator/src/evidence.ts';
import {assertPrivateOperatorPath,OperatorFileError,operatorJsonDigest,readPrivateOperatorJson} from './operator-files.ts';

export const MAX_PRIVATE_EVIDENCE_BYTES=20_971_520;
const MAX_JOURNAL_BYTES=134_217_728;
function stop(code:string):never{throw new OperatorFileError(code);}
const owned=(s:Stats)=>!process.getuid||s.uid===process.getuid();
const privateFile=(s:Stats)=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&owned(s)&&(s.mode&0o077)===0;
const unchanged=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
export const ProductEvidenceFixturePinSchema=z.strictObject({taskId:TaskIdSchema,fixtureDigest:DigestSchema,sourceDigest:DigestSchema,policyDigest:DigestSchema});
export type ProductEvidenceFixturePin=z.infer<typeof ProductEvidenceFixturePinSchema>;
export const PrivateEvidenceConfigSchema=z.strictObject({schemaVersion:z.literal('1.0'),kind:z.literal('product-evidence-operator'),
  stateDirectory:z.string().min(1),runId:z.uuid(),bundleDigest:DigestSchema,fixture:ProductEvidenceFixturePinSchema,outputFile:z.string().min(1).nullable()});
export type PrivateEvidenceConfig=z.infer<typeof PrivateEvidenceConfigSchema>;
export const privateEvidenceConfigDigest=(value:unknown)=>operatorJsonDigest(PrivateEvidenceConfigSchema.parse(value));

/** Bounded bytes only. Does not parse candidate files, discover directories, or create state. */
export function readPrivateEvidenceBytes(filename:string,options:{projectRoot:string;maximumBytes?:number}):Buffer{
  const maximum=options.maximumBytes??MAX_PRIVATE_EVIDENCE_BYTES;
  if(!Number.isSafeInteger(maximum)||maximum<1||maximum>MAX_PRIVATE_EVIDENCE_BYTES)stop('evidence_read_bound_invalid');
  assertPrivateOperatorPath(filename,options.projectRoot);const before=lstatSync(filename);
  const fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const opened=fstatSync(fd);if(!privateFile(opened)||!unchanged(before,opened)||opened.size>maximum)stop('evidence_file_changed_or_oversized');
    const buffer=Buffer.alloc(maximum+1);let length=0;
    while(length<=maximum){const count=readSync(fd,buffer,length,buffer.length-length,null);if(count===0)break;length+=count;}
    if(length>maximum||!unchanged(opened,fstatSync(fd))||!unchanged(before,lstatSync(filename)))stop('evidence_file_changed_or_oversized');
    return Buffer.from(buffer.subarray(0,length));
  }finally{closeSync(fd);}
}
function canonicalDirectory(path:string){
  if(!isAbsolute(path)||resolve(path)!==path||/[\x00-\x1f\x7f]/.test(path)||path.length>4096)stop('evidence_directory_invalid');
  const root=parse(path).root;let current=root;for(const part of path.slice(root.length).split('/').filter(Boolean)){current=join(current,part);const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())stop('evidence_directory_invalid');}
}
/** Validate only the two public fixture trees before their existing loader reads them. */
function publicFixtureInventory(projectRoot:string){
  canonicalDirectory(projectRoot);const top=join(projectRoot,'fixtures');canonicalDirectory(top);
  const files:Array<{path:string;size:number;ino:number;dev:number;mtime:number;ctime:number}>=[];let count=0,bytes=0;
  function visit(directory:string,depth:number){if(depth>8)stop('evidence_curated_tree_bound');
    for(const name of readdirSync(directory).sort()){if(++count>256)stop('evidence_curated_tree_bound');const path=join(directory,name),stat=lstatSync(path);
      if(stat.isSymbolicLink())stop('evidence_curated_symlink');if(stat.isDirectory()){visit(path,depth+1);continue;}
      if(!stat.isFile()||stat.nlink!==1||stat.size>1_048_576||(bytes+=stat.size)>MAX_PRIVATE_EVIDENCE_BYTES)stop('evidence_curated_tree_bound');
      files.push({path,size:stat.size,ino:stat.ino,dev:stat.dev,mtime:stat.mtimeMs,ctime:stat.ctimeMs});
    }
  }
  for(const split of ['development','calibration']){const path=join(top,split);try{canonicalDirectory(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}visit(path,0);}
  return files;
}
/** Current public curated inputs only; no journal, model, checker, or external evaluator workspace. */
export async function verifyCuratedProductEvidence(options:{projectRoot:string;bytes:Uint8Array;runId:string;bundleDigest:string;fixture:ProductEvidenceFixturePin}):Promise<ProductEvidence>{
  const projectRoot=options.projectRoot,runId=z.uuid().parse(options.runId),bundleDigest=DigestSchema.parse(options.bundleDigest),pin=ProductEvidenceFixturePinSchema.parse(options.fixture);
  if(!(options.bytes instanceof Uint8Array)||options.bytes.byteLength>MAX_PRIVATE_EVIDENCE_BYTES)stop('evidence_file_changed_or_oversized');
  const bytes=Buffer.from(options.bytes),text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))stop('evidence_invalid_utf8');
  const bundle=verifyEvidence(JSON.parse(text),bundleDigest);
  if(bundle.run.id!==runId||bundle.run.taskId!==pin.taskId||bundle.fixture.id!==pin.taskId||bundle.fixture.split==='final')stop('evidence_run_or_fixture_mismatch');
  const inventory=publicFixtureInventory(projectRoot),fixtures=await loadFixtures(pathToFileURL(projectRoot+'/'));
  if(digestJson(inventory)!==digestJson(publicFixtureInventory(projectRoot)))stop('evidence_curated_source_changed');
  const fixture=fixtures.find(value=>value.id===pin.taskId);if(!fixture)stop('evidence_curated_fixture_unavailable');
  const digests=fixtureDigests(fixture,bundle.schemaVersion);
  if(digestJson(fixture)!==pin.fixtureDigest||digestJson(bundle.fixture)!==pin.fixtureDigest||digests.sourceDigest!==pin.sourceDigest||digests.policyDigest!==pin.policyDigest||
    bundle.run.sourceDigest!==pin.sourceDigest||bundle.run.policyDigest!==pin.policyDigest)stop('evidence_curated_fixture_mismatch');
  return bundle;
}
export interface PrivateEvidenceRequest {projectRoot:string;configPath:string;expectedConfigDigest:string;}
function load(raw:PrivateEvidenceRequest){const request={...raw},config=PrivateEvidenceConfigSchema.parse(readPrivateOperatorJson(request.configPath,{projectRoot:request.projectRoot,maximumBytes:65_536})),configDigest=privateEvidenceConfigDigest(config);
  if(DigestSchema.parse(request.expectedConfigDigest)!==configDigest)stop('operator_config_digest_mismatch');
  canonicalDirectory(config.stateDirectory);const database=join(config.stateDirectory,'runs.sqlite'),evidenceFile=join(config.stateDirectory,'evidence',config.bundleDigest.slice(7)+'.json');
  const protectedPaths=new Set([database,database+'-wal',database+'-shm',database+'-journal',evidenceFile]);
  if(protectedPaths.has(request.configPath)||config.outputFile!==null&&(protectedPaths.has(config.outputFile)||config.outputFile===request.configPath))stop('evidence_path_collision');
  assertPrivateOperatorPath(database,request.projectRoot,{database:true});assertPrivateOperatorPath(evidenceFile,request.projectRoot);
  if(config.outputFile!==null)assertPrivateOperatorPath(config.outputFile,request.projectRoot,{allowMissing:true});
  return{request,config,configDigest,database,evidenceFile};
}
function quiescentJournal(database:string,projectRoot:string){
  assertPrivateOperatorPath(database,projectRoot,{database:true});const main=lstatSync(database);if(main.size>MAX_JOURNAL_BYTES)stop('evidence_journal_oversized');
  for(const suffix of ['-wal','-shm','-journal']){try{const info=lstatSync(database+suffix);if(info.size>MAX_JOURNAL_BYTES)stop('evidence_journal_oversized');
    if(suffix!=='-shm'&&info.size>0)stop('evidence_journal_not_quiescent');
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  return main;
}
function publishedRun(database:string,projectRoot:string,runId:string,bundleDigest:string){
  const before=quiescentJournal(database,projectRoot),uri=pathToFileURL(database);uri.search='mode=ro&immutable=1';
  const db=new DatabaseSync(uri,{readOnly:true});
  try{db.exec('PRAGMA query_only=ON;PRAGMA trusted_schema=OFF;BEGIN;');
    const table=db.prepare("SELECT type,sql FROM sqlite_schema WHERE name='runs'").get();if(table?.type!=='table'||!/^CREATE TABLE\s+runs\s*\(/i.test(String(table.sql)))stop('evidence_journal_schema_invalid');
    const columns=db.prepare('PRAGMA table_xinfo(runs)').all();if(columns.length!==5||columns.some((c,index)=>c.name!==['id','request_key','fingerprint','document','evidence_digest'][index]||c.type!=='TEXT'||c.hidden!==0))stop('evidence_journal_schema_invalid');
    const metadata=db.prepare('SELECT id,evidence_digest,length(CAST(document AS BLOB)) AS bytes FROM runs WHERE id=?').get(runId);
    if(!metadata)stop('evidence_run_unavailable');if(metadata.evidence_digest!==bundleDigest)stop('evidence_unpublished_or_digest_mismatch');
    if(typeof metadata.bytes!=='number'||metadata.bytes<1||metadata.bytes>MAX_PRIVATE_EVIDENCE_BYTES)stop('evidence_document_oversized');
    const row=db.prepare('SELECT document FROM runs WHERE id=?').get(runId);if(typeof row?.document!=='string')stop('evidence_journal_schema_invalid');
    const run=ProductRunSchema.parse(JSON.parse(row.document));if(run.id!==runId||run.phase!=='terminal')stop('evidence_run_not_terminal');
    db.exec('COMMIT;');return run;
  }finally{db.close();if(!unchanged(before,quiescentJournal(database,projectRoot)))stop('evidence_journal_changed');}
}
const label={kind:'private-product-evidence-operator',executionPerformed:false,providerCalls:0,authenticityVerified:false,sourceExecutionVerified:false,competitionReady:false}as const;
function summary(bundle:ProductEvidence,bytes:Buffer){return{...label,runId:bundle.run.id,bundleDigest:bundle.bundleDigest,byteDigest:digestBytes(bytes),byteCount:bytes.length,
  mode:bundle.mode,taskId:bundle.fixture.id,schemaVersion:bundle.schemaVersion,terminalStatus:bundle.run.terminalStatus,sourceDigest:bundle.run.sourceDigest,policyDigest:bundle.run.policyDigest,artifactCount:Object.keys(bundle.files).length,integrityVerified:true as const};}
/** Returns trusted in-memory evidence for other private operators; CLI never prints these bytes. */
export async function inspectPrivateEvidence(request:PrivateEvidenceRequest){
  const loaded=load(request),run=publishedRun(loaded.database,loaded.request.projectRoot,loaded.config.runId,loaded.config.bundleDigest),bytes=readPrivateEvidenceBytes(loaded.evidenceFile,{projectRoot:loaded.request.projectRoot});
  const bundle=await verifyCuratedProductEvidence({projectRoot:loaded.request.projectRoot,bytes,runId:loaded.config.runId,bundleDigest:loaded.config.bundleDigest,fixture:loaded.config.fixture});
  if(digestJson(run)!==digestJson(bundle.run))stop('evidence_journal_binding_mismatch');
  return{config:loaded.config,configDigest:loaded.configDigest,bundle,bytes,summary:summary(bundle,bytes)};
}
/** Creates exactly one new private file; preserves original verified JSON bytes without reserialization. */
export async function exportPrivateEvidence(raw:PrivateEvidenceRequest){
  const request={...raw},result=await inspectPrivateEvidence(request),output=result.config.outputFile;if(output===null)stop('evidence_output_required');
  assertPrivateOperatorPath(output,request.projectRoot,{allowMissing:true});const fd=openSync(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{if(!privateFile(fstatSync(fd)))stop('evidence_output_invalid');let offset=0;while(offset<result.bytes.length){const written=writeSync(fd,result.bytes,offset,result.bytes.length-offset);if(written===0)stop('evidence_output_incomplete');offset+=written;}fsyncSync(fd);}finally{closeSync(fd);}
  const parent=openSync(dirname(output),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(parent);}finally{closeSync(parent);}
  return{...result.summary,outputWritten:true as const};
}
const safeCodes=new Set(['operator_usage','operator_config_digest_mismatch','operator_path_invalid','operator_path_inside_project','operator_directory_invalid','operator_directory_not_private','operator_file_not_private','operator_database_sidecar_invalid','operator_file_changed_or_oversized',
  'evidence_read_bound_invalid','evidence_file_changed_or_oversized','evidence_directory_invalid','evidence_curated_tree_bound','evidence_curated_symlink','evidence_invalid_utf8','evidence_run_or_fixture_mismatch','evidence_curated_source_changed','evidence_curated_fixture_unavailable','evidence_curated_fixture_mismatch','evidence_path_collision','evidence_journal_oversized','evidence_journal_not_quiescent','evidence_journal_schema_invalid','evidence_run_unavailable','evidence_unpublished_or_digest_mismatch','evidence_document_oversized','evidence_run_not_terminal','evidence_journal_changed','evidence_journal_binding_mismatch','evidence_output_required','evidence_output_invalid','evidence_output_incomplete']);
export async function runEvidenceOperator(args:string[],projectRoot:string){try{
  const[command,configPath,expectedConfigDigest]=args;if(args.length!==3||(command!=='inspect'&&command!=='export'))stop('operator_usage');
  const request={projectRoot,configPath:configPath!,expectedConfigDigest:expectedConfigDigest!};
  const result=command==='inspect'?(await inspectPrivateEvidence(request)).summary:await exportPrivateEvidence(request);
  return{exitCode:0,output:{...result,command,status:command==='inspect'?'verified':'exported'}};
}catch(error){const code=error instanceof OperatorFileError&&safeCodes.has(error.code)?error.code:(error as NodeJS.ErrnoException).code==='EEXIST'?'evidence_output_exists':'evidence_operation_rejected';return{exitCode:2,output:{...label,status:'error',error:{code}}};}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runEvidenceOperator(process.argv.slice(2),fileURLToPath(new URL('../',import.meta.url)));console.log(JSON.stringify(result.output,null,2));process.exitCode=result.exitCode;
}
