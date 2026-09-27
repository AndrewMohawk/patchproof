import { closeSync,constants,fchmodSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { dirname,isAbsolute,join,parse,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { digestBytes,digestJson } from '../../packages/contracts/src/digest.ts';
import { DigestSchema } from '../../packages/contracts/src/index.ts';
import { analyzeExperiment,EpisodeResultSchema } from './analysis.ts';
import { SyntheticEpisodeResultSchema } from './dispatcher.ts';
import { assertExecutionReady,ExecutionGatesSchema,ExperimentPlanSchema,hashJson,validatePlan } from './protocol.ts';

const MAX_JSON_BYTES=16*1024*1024,MAX_BUNDLE_BYTES=32*1024*1024,MAX_DATABASE_BYTES=128*1024*1024;
const Id=z.string().min(1).max(256),OperationId=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/);
const Phase=z.enum(['pending','claimed','executing','selected','adjudicating','terminal']);
const SourceBinding=z.enum(['current-operational-lock','expected-historical-lock']);
export const ExportBindingsSchema=z.strictObject({sourceDigest:DigestSchema,planDigest:DigestSchema,transportDigest:DigestSchema});
export type ExportBindings=z.infer<typeof ExportBindingsSchema>;
const Result=z.union([EpisodeResultSchema,SyntheticEpisodeResultSchema]);
const ProgressSchema=z.strictObject({episodeId:Id,dispatchId:z.uuid(),phase:Phase,reason:z.string().regex(/^[a-z][a-z0-9_]{0,99}$/).nullable(),
  cancelRequested:z.boolean(),operationIds:z.array(OperationId).max(1000),observedUsage:EpisodeResultSchema.shape.usage,result:Result.nullable()});
export const ExperimentCaptureSchema=z.strictObject({schemaVersion:z.literal('1.0'),kind:z.literal('trusted-experiment-metadata'),capturedAt:z.iso.datetime(),
  bindings:ExportBindingsSchema,sourceBinding:SourceBinding,executionMode:z.enum(['synthetic','live']),benchmarkExecuted:z.boolean(),
  plan:ExperimentPlanSchema,episodes:z.array(ProgressSchema).min(72).max(270)});
export type ExperimentCapture=z.infer<typeof ExperimentCaptureSchema>;
export const LiveReadinessReceiptSchema=z.strictObject({schemaVersion:z.literal('1.0'),kind:z.literal('experiment-preflight-readiness'),
  bindings:ExportBindingsSchema,observedAt:z.iso.datetime(),gates:ExecutionGatesSchema});
export type LiveReadinessReceipt=z.infer<typeof LiveReadinessReceiptSchema>;
export const liveReadinessReceiptDigest=(value:unknown)=>digestJson(LiveReadinessReceiptSchema.parse(value));
const FILES=['plan.json','progress.json','results.json','summary.json','analysis.json','readiness.json'] as const;
const ManifestSchema=z.strictObject({schemaVersion:z.literal('1.0'),kind:z.literal('immutable-experiment-aggregate'),capturedAt:z.iso.datetime(),
  bindings:ExportBindingsSchema,sourceBinding:SourceBinding,executionMode:z.enum(['synthetic','live']),benchmarkExecuted:z.boolean(),
  integrityScope:z.literal('exact-artifact-bytes-and-recomputed-metadata'),authenticityVerified:z.literal(false),sourceExecutionVerified:z.literal(false),
  artifacts:z.array(z.strictObject({path:z.enum(FILES),bytes:z.number().int().nonnegative().max(MAX_JSON_BYTES),digest:DigestSchema})).length(FILES.length)});
type Usage=z.infer<typeof EpisodeResultSchema.shape.usage>;
const USAGE_KEYS=['inferenceCalls','inputTokens','outputTokens','runtimeFeedbackRounds','elapsedMs','sandboxCpuSeconds','measuredCostUsd'] as const;
const COUNT_KEYS=['inferenceCalls','inputTokens','outputTokens','runtimeFeedbackRounds'] as const;
function boundedJson(value:unknown,limit=MAX_JSON_BYTES){const text=JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>limit)throw new Error('Metadata exceeds the export size limit.');return text;}
function parseJson(value:unknown,limit=MAX_JSON_BYTES){if(typeof value!=='string'||Buffer.byteLength(value)>limit)throw new Error('Invalid or oversized metadata JSON.');return JSON.parse(value) as unknown;}
function same(left:unknown,right:unknown){return digestJson(left)===digestJson(right);}
function dispatchId(planDigest:string,id:string){const h=hashJson([planDigest,id]).slice(7);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
function checkUsage(usage:Usage){for(const key of USAGE_KEYS)if(usage[key]!==null&&usage[key]!>Number.MAX_SAFE_INTEGER)throw new Error('Unsafe aggregate usage value.');for(const key of COUNT_KEYS)if(!Number.isSafeInteger(usage[key]))throw new Error('Unsafe usage counter.');}

/** Validates provenance bindings and the entire grid; a typed object alone is not a trusted capture. */
export function validateExperimentCapture(value:unknown,expectedValue:unknown):ExperimentCapture{
  boundedJson(value);const capture=ExperimentCaptureSchema.parse(value),expected=ExportBindingsSchema.parse(expectedValue),plan=validatePlan(capture.plan);
  if(!same(capture.bindings,expected)||hashJson(plan)!==expected.planDigest)throw new Error('Source, plan or transport binding mismatch.');
  if(capture.episodes.length!==plan.plannedEpisodes)throw new Error('Every planned episode identity must be retained.');
  if(capture.executionMode==='synthetic'&&capture.benchmarkExecuted)throw new Error('Synthetic metadata cannot claim a benchmark.');
  if(capture.executionMode==='live'&&plan.modelLockDigest===null)throw new Error('Live capture requires its frozen model lock.');
  for(const[index,row]of capture.episodes.entries()){
    const episode=plan.episodes[index]!;
    if(row.episodeId!==episode.id||row.dispatchId!==dispatchId(expected.planDigest,episode.id))throw new Error('Missing, duplicate, reordered or changed dispatch identity.');
    if((row.phase==='terminal')!==(row.result!==null)||(row.phase==='terminal')!==(row.reason!==null))throw new Error('Terminal state and result disagree.');
    if(new Set(row.operationIds).size!==row.operationIds.length)throw new Error('Duplicate operation identity.');
    checkUsage(row.observedUsage);
    const result=row.result;if(!result)continue;
    if(result.episodeId!==episode.id||result.planDigest!==expected.planDigest||result.executionMode!==capture.executionMode||result.variant!==episode.variant||
      result.modelLockDigest!==plan.modelLockDigest||result.policyDigest!==plan.policyDigest)throw new Error('Result does not match frozen episode/runtime.');
    if(['correct','incorrect'].includes(result.outcome)!==result.sealedChecksExecuted||result.outcome!=='infrastructure_error'&&result.infrastructureExclusion!==null)throw new Error('Inconsistent result verdict.');
    if(capture.executionMode==='live'&&!capture.benchmarkExecuted&&(result.sealedChecksExecuted||result.usage.inferenceCalls>0||row.operationIds.length>0))throw new Error('Executed result lacks dispatcher execution evidence.');
    checkUsage(result.usage);
    for(const key of USAGE_KEYS)if(result.usage[key]!==null&&row.observedUsage[key]!==null&&result.usage[key]!<row.observedUsage[key]!)throw new Error('Result discards known checkpoint usage.');
  }
  return capture;
}

function checkPath(path:string,directory:boolean,privateParent:boolean){
  if(!isAbsolute(path)||resolve(path)!==path)throw new Error('Use a normalized absolute evaluator path.');
  const parent=directory?path:dirname(path),root=parse(parent).root;let current=root;
  for(const component of parent.slice(root.length).split('/').filter(Boolean)){
    current=join(current,component);const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Evaluator paths must not contain symlinks.');
  }
  const stat=lstatSync(parent);if(privateParent&&((stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid())))throw new Error('Evaluator directory must be private and owned.');
}
function fileStat(path:string,maxBytes:number){const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(process.getuid&&stat.uid!==process.getuid())||(stat.mode&0o077)!==0||stat.size>maxBytes)throw new Error('Expected a bounded private owned regular file without links.');return stat;}
function readPrivate(path:string,maxBytes=MAX_JSON_BYTES){
  fileStat(path,maxBytes);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>maxBytes||stat.nlink!==1)throw new Error('Invalid export artifact.');return readFileSync(fd);}finally{closeSync(fd);}
}

/** Read-only metadata projection. Deliberately never SELECTs execution_json or event details. */
export function captureExperimentSnapshot(options:{dispatcherDatabase:string;expected:ExportBindings;sourceBinding:z.infer<typeof SourceBinding>;now?:()=>Date}):ExperimentCapture{
  const expected=ExportBindingsSchema.parse(options.expected);SourceBinding.parse(options.sourceBinding);checkPath(options.dispatcherDatabase,false,true);fileStat(options.dispatcherDatabase,MAX_DATABASE_BYTES);
  for(const suffix of['-wal','-shm','-journal']){try{fileStat(options.dispatcherDatabase+suffix,MAX_DATABASE_BYTES);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  const db=new DatabaseSync(options.dispatcherDatabase,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN;');
    const meta=db.prepare('SELECT plan_digest,plan_json,mode,transport_digest FROM experiment WHERE id=1').get();
    if(!meta||meta.plan_digest!==expected.planDigest||meta.transport_digest!==expected.transportDigest)throw new Error('Dispatcher metadata binding mismatch.');
    const plan=parseJson(meta.plan_json,1024*1024);
    const rows=db.prepare('SELECT episode_id,dispatch_id,position,phase,reason,cancel_requested,usage_json,operations_json,result_json FROM episodes ORDER BY position LIMIT 271').all();
    const episodes=rows.map((row,index)=>{
      if(row.position!==index||![0,1].includes(Number(row.cancel_requested)))throw new Error('Invalid dispatcher position or cancellation marker.');
      return{episodeId:row.episode_id,dispatchId:row.dispatch_id,phase:row.phase,reason:row.reason,cancelRequested:row.cancel_requested===1,
        operationIds:parseJson(row.operations_json,256*1024),observedUsage:parseJson(row.usage_json,4096),result:row.result_json===null?null:parseJson(row.result_json,16*1024)};
    });
    const benchmarkExecuted=meta.mode==='live'&&!!db.prepare("SELECT 1 FROM dispatch_events WHERE kind='executor_started' LIMIT 1").get();
    const capturedAt=(options.now??(()=>new Date()))().toISOString();
    const capture=validateExperimentCapture({schemaVersion:'1.0',kind:'trusted-experiment-metadata',capturedAt,bindings:expected,sourceBinding:options.sourceBinding,executionMode:meta.mode,benchmarkExecuted,plan,episodes},expected);
    db.exec('COMMIT;');return capture;
  }finally{db.close();}
}

function summarize(capture:ExperimentCapture){
  const rows=capture.episodes,terminal=rows.filter(row=>row.result!==null),totals:Record<keyof Usage,number>={inferenceCalls:0,inputTokens:0,outputTokens:0,runtimeFeedbackRounds:0,elapsedMs:0,sandboxCpuSeconds:0,measuredCostUsd:0};
  for(const row of rows)for(const key of USAGE_KEYS)totals[key]+=Math.max(row.observedUsage[key]??0,row.result?.usage[key]??0);
  for(const value of Object.values(totals))if(!Number.isFinite(value)||value>Number.MAX_SAFE_INTEGER)throw new Error('Aggregate usage exceeds safe numeric range.');
  const reasons=new Map<string,number>(),outcomes=new Map<string,number>();for(const row of terminal){reasons.set(row.reason!,(reasons.get(row.reason!)??0)+1);outcomes.set(row.result!.outcome,(outcomes.get(row.result!.outcome)??0)+1);}
  return{schemaVersion:'1.0',executionMode:capture.executionMode,label:capture.executionMode==='synthetic'?'SYNTHETIC — NOT A SCORED EXPERIMENT':'LIVE DISPATCHER METADATA — AUTHENTICITY NOT VERIFIED',
    benchmarkExecuted:capture.benchmarkExecuted,plannedEpisodes:capture.plan.plannedEpisodes,terminalEpisodes:terminal.length,complete:terminal.length===capture.plan.plannedEpisodes,
    pendingEpisodes:rows.filter(row=>row.phase==='pending').length,activeEpisodes:rows.filter(row=>row.phase!=='terminal'&&row.phase!=='pending').length,
    cancelledEpisodeIds:rows.filter(row=>row.cancelRequested||row.reason==='cancelled').map(row=>row.episodeId),missingResultEpisodeIds:rows.filter(row=>!row.result).map(row=>row.episodeId),
    byReason:Object.fromEntries(reasons),byOutcome:Object.fromEntries(outcomes),observedUsageLowerBounds:totals,unknownCostEpisodeIds:rows.filter(row=>!row.result||row.result.usage.measuredCostUsd===null).map(row=>row.episodeId),
    unknownCpuEpisodeIds:rows.filter(row=>!row.result||row.result.usage.sandboxCpuSeconds===null).map(row=>row.episodeId),
    primaryDenominator:'all_planned_episodes',infrastructureFailuresRetained:true,ledgerReconciliationIncluded:false,authenticityVerified:false,sourceExecutionVerified:false};
}
function derive(capture:ExperimentCapture,readinessValue:unknown,acceptedReadinessReceiptDigest?:string){
  const readiness=readinessValue===null?null:LiveReadinessReceiptSchema.parse(readinessValue);
  if(readiness){
    if(capture.executionMode!=='live')throw new Error('Synthetic exports cannot carry live readiness.');
    if(!acceptedReadinessReceiptDigest||liveReadinessReceiptDigest(readiness)!==DigestSchema.parse(acceptedReadinessReceiptDigest))throw new Error('Readiness requires its independently accepted receipt digest.');
    if(!same(readiness.bindings,capture.bindings)||Date.parse(readiness.observedAt)>Date.parse(capture.capturedAt))throw new Error('Readiness receipt binding/time mismatch.');
  }else if(acceptedReadinessReceiptDigest!==undefined)throw new Error('Accepted readiness digest has no receipt.');
  const results=capture.episodes.flatMap(row=>row.result?[row.result]:[]);
  let analysis:unknown={status:'not-analyzed',reason:capture.executionMode==='synthetic'?'synthetic-excluded':!capture.benchmarkExecuted?'no-recorded-execution':'missing-readiness-receipt',report:null};
  if(capture.executionMode==='live'&&capture.benchmarkExecuted&&readiness){
    let ready=false;try{assertExecutionReady(capture.plan,readiness.gates);ready=true;}catch{/* Preserve metadata with an explicit blocked analysis. */}
    analysis=ready?{status:'live-analysis',reason:null,report:analyzeExperiment(capture.plan,results)}:{status:'not-analyzed',reason:'readiness-gates-not-satisfied',report:null};
  }
  return{results,summary:summarize(capture),analysis,readiness};
}

export function exportExperiment(options:{directory:string;projectRoot:string;capture:unknown;expected:ExportBindings;liveReadinessReceipt?:unknown;acceptedReadinessReceiptDigest?:string}){
  const capture=validateExperimentCapture(options.capture,options.expected),derived=derive(capture,options.liveReadinessReceipt??null,options.acceptedReadinessReceiptDigest);
  checkPath(options.projectRoot,true,false);checkPath(dirname(options.directory),true,true);
  if(!isAbsolute(options.directory)||resolve(options.directory)!==options.directory||options.directory===options.projectRoot||options.directory.startsWith(options.projectRoot+'/'))throw new Error('Export must use a new absolute directory outside the project/candidate tree.');
  const{plan,episodes,...metadata}=capture;
  const values={'plan.json':plan,'progress.json':{...metadata,episodes},'results.json':derived.results,'summary.json':derived.summary,'analysis.json':derived.analysis,'readiness.json':derived.readiness};
  const payloads=FILES.map(path=>({path,bytes:Buffer.from(boundedJson(values[path])+'\n')}));
  if(payloads.reduce((sum,value)=>sum+value.bytes.length,0)>MAX_BUNDLE_BYTES)throw new Error('Aggregate export exceeds bundle size limit.');
  const manifest=ManifestSchema.parse({schemaVersion:'1.0',kind:'immutable-experiment-aggregate',capturedAt:capture.capturedAt,bindings:capture.bindings,sourceBinding:capture.sourceBinding,
    executionMode:capture.executionMode,benchmarkExecuted:capture.benchmarkExecuted,integrityScope:'exact-artifact-bytes-and-recomputed-metadata',authenticityVerified:false,sourceExecutionVerified:false,
    artifacts:payloads.map(({path,bytes})=>({path,bytes:bytes.length,digest:digestBytes(bytes)}))});
  mkdirSync(options.directory,{mode:0o700}); // Never reuse or overwrite a directory, even an empty one.
  const write=(path:string,bytes:Buffer)=>{const fd=openSync(join(options.directory,path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);fchmodSync(fd,0o400);}finally{closeSync(fd);}};
  for(const file of payloads)write(file.path,file.bytes);
  const manifestBytes=Buffer.from(boundedJson(manifest)+'\n');write('manifest.json',manifestBytes);
  const fd=openSync(options.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fchmodSync(fd,0o500);fsyncSync(fd);}finally{closeSync(fd);}
  const parentFd=openSync(dirname(options.directory),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(parentFd);}finally{closeSync(parentFd);}
  return{manifest,manifestDigest:digestBytes(manifestBytes),directory:options.directory,summary:derived.summary,analysis:derived.analysis,authenticityVerified:false as const};
}

/** Offline verification only. No database, source checkout, provider, candidate or sealed corpus is opened. */
export function verifyExperimentExport(options:{directory:string;expected:ExportBindings;expectedManifestDigest?:string;acceptedReadinessReceiptDigest?:string}){
  const expected=ExportBindingsSchema.parse(options.expected);checkPath(options.directory,true,true);
  const actual=readdirSync(options.directory).sort(),required=[...FILES,'manifest.json'].sort();if(!same(actual,required))throw new Error('Unexpected or missing export artifacts.');
  const manifestBytes=readPrivate(join(options.directory,'manifest.json'),64*1024),manifestDigest=digestBytes(manifestBytes);
  if(options.expectedManifestDigest!==undefined&&DigestSchema.parse(options.expectedManifestDigest)!==manifestDigest)throw new Error('Pinned manifest digest mismatch.');
  const manifest=ManifestSchema.parse(parseJson(manifestBytes.toString('utf8'),64*1024));
  if(!same(manifest.bindings,expected)||manifest.artifacts.some((item,index)=>item.path!==FILES[index]))throw new Error('Export binding or exact artifact-list mismatch.');
  const values:Record<string,unknown>={};let total=0;
  for(const item of manifest.artifacts){const bytes=readPrivate(join(options.directory,item.path));total+=bytes.length;
    if(bytes.length!==item.bytes||digestBytes(bytes)!==item.digest||total>MAX_BUNDLE_BYTES)throw new Error('Artifact byte length/digest mismatch.');values[item.path]=parseJson(bytes.toString('utf8'));}
  const progress=z.strictObject({...ExperimentCaptureSchema.shape,plan:z.undefined()}).omit({plan:true}).parse(values['progress.json']);
  const capture=validateExperimentCapture({...progress,plan:values['plan.json']},expected);
  if(manifest.capturedAt!==capture.capturedAt||manifest.sourceBinding!==capture.sourceBinding||manifest.executionMode!==capture.executionMode||manifest.benchmarkExecuted!==capture.benchmarkExecuted)throw new Error('Manifest/capture metadata mismatch.');
  const derived=derive(capture,values['readiness.json'],options.acceptedReadinessReceiptDigest);
  if(!same(values['results.json'],derived.results)||!same(values['summary.json'],derived.summary)||!same(values['analysis.json'],derived.analysis))throw new Error('Exported rows, summary or analysis do not match retained progress.');
  return{manifest,manifestDigest,summary:derived.summary,analysis:derived.analysis,integrityVerified:true as const,authenticityVerified:false as const};
}
