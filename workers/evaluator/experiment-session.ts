import {constants,closeSync,fsyncSync,openSync} from 'node:fs';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DigestSchema,LimitsSchema,TaskIdSchema,VariantSchema} from '../../packages/contracts/src/index.ts';
import {digestJson} from '../../packages/contracts/src/digest.ts';
import {BudgetLedger,usdToMicros} from '../../packages/orchestrator/src/budget-ledger.ts';
import {buildOperationalLock} from '../../packages/orchestrator/src/operational-lock.ts';
import {assertPrivateOperatorPath,operatorJsonDigest,readPrivateOperatorJson} from '../../scripts/operator-files.ts';
import {ExperimentDispatcher} from './dispatcher.ts';
import type {DispatcherTransport} from './dispatcher.ts';
import {assertExecutionReady,ExecutionGatesSchema,hashJson,validatePlan} from './protocol.ts';
import type {ExperimentPlan} from './protocol.ts';
import {captureExperimentSnapshot,LiveReadinessReceiptSchema,liveReadinessReceiptDigest} from './experiment-export.ts';

const Bounds=z.strictObject({maxConcurrentCpuUnits:z.number().finite().positive(),maxCostUsdPerSecond:z.number().finite().nonnegative(),fixedCostUsd:z.number().finite().nonnegative()});
export const ExperimentSessionConfigSchema=z.strictObject({schemaVersion:z.literal('1.0'),kind:z.literal('patchproof-experiment-session'),sessionId:z.uuid(),
  dispatcherDatabase:z.string().min(1),planPath:z.string().min(1),planDigest:DigestSchema,sourceDigest:DigestSchema,
  executionMode:z.enum(['synthetic','live']),modelLockDigest:DigestSchema.nullable(),policyDigest:DigestSchema,adjudicationBounds:Bounds.nullable(),transportDigest:DigestSchema,
  factoryDigest:DigestSchema,maxNewSpendUsd:z.number().finite().nonnegative().max(25).default(0),
  readiness:z.strictObject({path:z.string().min(1),acceptedDigest:DigestSchema}).nullable()}).superRefine((value,ctx)=>{
    if(value.executionMode==='synthetic'&&(value.maxNewSpendUsd!==0||value.readiness!==null))ctx.addIssue({code:'custom',message:'Synthetic sessions cannot authorize paid execution.'});
    if(value.executionMode==='live'&&(value.adjudicationBounds===null||value.modelLockDigest===null))ctx.addIssue({code:'custom',message:'Live transport requires its model and prospective bounds.'});
  });
export type ExperimentSessionConfig=z.infer<typeof ExperimentSessionConfigSchema>;
export const experimentSessionConfigDigest=(value:unknown)=>operatorJsonDigest(ExperimentSessionConfigSchema.parse(value));
export const PublicExecutionInputSchema=z.strictObject({episodeId:z.string().min(1).max(256),dispatchId:z.uuid(),taskId:TaskIdSchema,repoId:z.string().min(1).max(256),variant:VariantSchema,
  repetition:z.number().int().min(0).max(2),seed:z.number().int().nonnegative().max(2**32-1),limits:LimitsSchema,fixtureDigest:DigestSchema,planDigest:DigestSchema,modelLockDigest:DigestSchema.nullable(),policyDigest:DigestSchema});
export type PublicExecutionInput=z.infer<typeof PublicExecutionInputSchema>;
export interface ReservationProjection {reservationFingerprint:string;stage:'pilot'|'evaluate';amountMicros:string;dispatchId:string;publicInputDigest:string;}
const identity=(digest:string,id:string)=>{const h=hashJson([digest,id]).slice(7);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
function publicInputs(plan:ExperimentPlan){const planDigest=hashJson(plan);return plan.episodes.map(e=>PublicExecutionInputSchema.parse({episodeId:e.id,dispatchId:identity(planDigest,e.id),taskId:e.taskId,repoId:e.repoId,variant:e.variant,repetition:e.repetition,seed:e.seed,
  limits:e.limits,fixtureDigest:e.fixtureDigest,planDigest,modelLockDigest:plan.modelLockDigest,policyDigest:plan.policyDigest}));}
/** Pure trusted projection. The runtime supplies ExecutionInput with checkpoint omitted. */
export function createReservationProjection(planValue:unknown):(value:unknown)=>ReservationProjection{
  const plan=validatePlan(planValue),planDigest=hashJson(plan),inputs=publicInputs(plan),expected=new Map(inputs.map((input,index)=>[input.dispatchId,{digest:digestJson(input),episode:plan.episodes[index]!}]));
  return(value:unknown)=>{const input=PublicExecutionInputSchema.parse(value),entry=expected.get(input.dispatchId);
    if(!entry||digestJson(input)!==entry.digest)throw new ExperimentSessionError('public_execution_binding_mismatch');
    return Object.freeze({reservationFingerprint:hashJson({planDigest,episode:entry.episode}),stage:plan.kind==='pilot'?'pilot':'evaluate',amountMicros:String(usdToMicros(entry.episode.limits.maxApprovedSpendUsd)),dispatchId:input.dispatchId,publicInputDigest:entry.digest});};
}
export interface SessionFactoryContext {sessionId:string;executionMode:'synthetic'|'live';sourceDigest:string;planDigest:string;transportDigest:string;
  publicEpisodes:readonly PublicExecutionInput[];reservationForExecution:(value:unknown)=>ReservationProjection;ledger:BudgetLedger|undefined;}
export interface SessionRuntime {transport:DispatcherTransport;close?:()=>void|Promise<void>;}
export interface ExperimentSessionFactory {factoryDigest:string;sourceDigest:string;transportDigest:string;create:(context:SessionFactoryContext)=>SessionRuntime|Promise<SessionRuntime>;}
export interface ExperimentSessionDependencies {factory?:ExperimentSessionFactory;ledger?:BudgetLedger;currentGates?:()=>unknown;currentSourceDigest?:()=>string;signal?:AbortSignal;}
export type ExperimentSessionCommand='preflight'|'run-one'|'run-all'|'status'|'cancel'|'recover';
export interface ExperimentSessionRequest {command:ExperimentSessionCommand;configPath:string;expectedConfigDigest:string;projectRoot:string;episodeId?:string;}
export class ExperimentSessionError extends Error {readonly code:string;constructor(code:string){super(code);this.name='ExperimentSessionError';this.code=code;}}
const fail=(code:string):never=>{throw new ExperimentSessionError(code);};
type Loaded={config:ExperimentSessionConfig;digest:string;plan:ExperimentPlan;projectRoot:string;journal:string;};
function load(request:ExperimentSessionRequest):Loaded{
  const config=ExperimentSessionConfigSchema.parse(readPrivateOperatorJson(request.configPath,{projectRoot:request.projectRoot})),digest=experimentSessionConfigDigest(config);
  if(DigestSchema.parse(request.expectedConfigDigest)!==digest)fail('session_config_digest_mismatch');
  const plan=validatePlan(readPrivateOperatorJson(config.planPath,{projectRoot:request.projectRoot,maximumBytes:1024*1024}));
  if(hashJson(plan)!==config.planDigest||plan.modelLockDigest!==config.modelLockDigest||plan.policyDigest!==config.policyDigest||hashJson({modelLockDigest:config.modelLockDigest,policyDigest:config.policyDigest,adjudicationBounds:config.adjudicationBounds})!==config.transportDigest)fail('session_plan_or_transport_mismatch');
  const journal=config.dispatcherDatabase+'.session.sqlite';
  const databasePaths=new Set([config.dispatcherDatabase,journal].flatMap(path=>[path,path+'-wal',path+'-shm',path+'-journal']));
  if([request.configPath,config.planPath,...(config.readiness?[config.readiness.path]:[])].some(path=>databasePaths.has(path)))fail('session_path_collision');
  assertPrivateOperatorPath(config.dispatcherDatabase,request.projectRoot,{allowMissing:true,database:true});assertPrivateOperatorPath(journal,request.projectRoot,{allowMissing:true,database:true});
  return{config,digest,plan,projectRoot:request.projectRoot,journal};
}
function sessionState(loaded:Loaded){
  const exists=assertPrivateOperatorPath(loaded.journal,loaded.projectRoot,{allowMissing:true,database:true}),dispatcherExists=assertPrivateOperatorPath(loaded.config.dispatcherDatabase,loaded.projectRoot,{allowMissing:true,database:true});
  if(!exists){if(dispatcherExists)fail('orphan_dispatcher_requires_review');return{exists:false,initialized:false,dispatcherExists:false};}
  const db=new DatabaseSync(loaded.journal,{readOnly:true});try{const record=db.prepare('SELECT session_id,config_digest,initialized FROM operator_session WHERE id=1').get();
    if(!record)return fail('session_identity_mismatch');
    if(record.session_id!==loaded.config.sessionId||record.config_digest!==loaded.digest||![0,1].includes(Number(record.initialized)))fail('session_identity_mismatch');
    if(record.initialized===1&&!dispatcherExists)fail('session_dispatcher_state_lost');return{exists:true,initialized:record.initialized===1,dispatcherExists};
  }finally{db.close();}
}
function status(loaded:Loaded){const state=sessionState(loaded),c=loaded.config;
  const capture=state.dispatcherExists?captureExperimentSnapshot({dispatcherDatabase:c.dispatcherDatabase,expected:{sourceDigest:c.sourceDigest,planDigest:c.planDigest,transportDigest:c.transportDigest},sourceBinding:'expected-historical-lock'}):null;
  if(capture&&capture.executionMode!==c.executionMode)fail('session_mode_mismatch');
  return{sessionId:c.sessionId,configDigest:loaded.digest,planDigest:c.planDigest,executionMode:c.executionMode,initialized:state.initialized,plannedEpisodes:loaded.plan.plannedEpisodes,
    terminalEpisodes:capture?.episodes.filter(row=>row.phase==='terminal').length??0,complete:capture?.episodes.every(row=>row.phase==='terminal')??false,
    plannedEpisodeIds:loaded.plan.episodes.map(e=>e.id),capture,sourceExecutionVerified:false as const,authenticityVerified:false as const};
}
function controlTransport(config:ExperimentSessionConfig):DispatcherTransport{return{executionMode:config.executionMode,modelLockDigest:config.modelLockDigest,policyDigest:config.policyDigest,
  ...(config.adjudicationBounds?{adjudicationBounds:config.adjudicationBounds}:{}),execute:async()=>fail('control_transport_cannot_execute'),adjudicate:async()=>fail('control_transport_cannot_adjudicate')};}
function dispatcher(loaded:Loaded,deps:ExperimentSessionDependencies,transport:DispatcherTransport){
  if(loaded.config.executionMode==='live'&&!deps.ledger)fail('live_ledger_required');
  return new ExperimentDispatcher({filename:loaded.config.dispatcherDatabase,plan:loaded.plan,transport,...(deps.ledger?{ledger:deps.ledger}:{}),
    ...(loaded.config.executionMode==='live'?{gates:deps.currentGates??(()=>fail('current_gates_unavailable'))}:{})});
}
function initialize(loaded:Loaded,deps:ExperimentSessionDependencies){
  const state=sessionState(loaded);if(state.initialized)return;
  if(!state.exists){try{closeSync(openSync(loaded.journal,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600));}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
  const db=new DatabaseSync(loaded.journal);
  try{db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS operator_session(id INTEGER PRIMARY KEY CHECK(id=1),session_id TEXT NOT NULL,config_digest TEXT NOT NULL,initialized INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS operator_commands(id TEXT PRIMARY KEY,command TEXT NOT NULL,episode_id TEXT,started_at TEXT NOT NULL,completed_at TEXT,status TEXT NOT NULL); BEGIN IMMEDIATE;');
    const record=db.prepare('SELECT * FROM operator_session WHERE id=1').get();
    if(record&&(record.session_id!==loaded.config.sessionId||record.config_digest!==loaded.digest))fail('session_identity_mismatch');
    if(!record)db.prepare('INSERT INTO operator_session VALUES(1,?,?,0)').run(loaded.config.sessionId,loaded.digest);db.exec('COMMIT;');
    const inert=dispatcher(loaded,deps,controlTransport(loaded.config));try{
      if(!record?.initialized&&inert.snapshot().episodes.some(row=>row.phase!=='pending'))fail('uncommitted_session_requires_review');
    }finally{inert.close();}
    db.prepare('UPDATE operator_session SET initialized=1 WHERE id=1 AND session_id=? AND config_digest=?').run(loaded.config.sessionId,loaded.digest);
    const fd=openSync(dirname(loaded.journal),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}
  }finally{db.close();}
}
function preflight(loaded:Loaded,deps:ExperimentSessionDependencies){
  const reasons:string[]=[],config=loaded.config;sessionState(loaded);
  const source=(deps.currentSourceDigest??(()=>digestJson(buildOperationalLock(loaded.projectRoot).sources)))();if(source!==config.sourceDigest)reasons.push('current_source_mismatch');
  const factory=deps.factory;if(!factory)reasons.push('runtime_factory_not_installed');else if(factory.factoryDigest!==config.factoryDigest||factory.sourceDigest!==config.sourceDigest||factory.transportDigest!==config.transportDigest)reasons.push('runtime_factory_binding_mismatch');
  if(config.executionMode==='live'){
    if(config.maxNewSpendUsd<=0||loaded.plan.approvedExperimentBudgetUsd>config.maxNewSpendUsd)reasons.push('new_spending_not_approved');
    if(!deps.ledger)reasons.push('live_ledger_required');
    if(!config.readiness)reasons.push('readiness_unavailable');else{
      const receipt=LiveReadinessReceiptSchema.parse(readPrivateOperatorJson(config.readiness.path,{projectRoot:loaded.projectRoot}));
      if(liveReadinessReceiptDigest(receipt)!==config.readiness.acceptedDigest||!Object.entries({sourceDigest:config.sourceDigest,planDigest:config.planDigest,transportDigest:config.transportDigest}).every(([key,value])=>receipt.bindings[key as keyof typeof receipt.bindings]===value)||Date.parse(receipt.observedAt)>Date.now())fail('readiness_binding_mismatch');
      try{assertExecutionReady(loaded.plan,receipt.gates);}catch{reasons.push('readiness_gates_failed');}
    }
    if(!deps.currentGates)reasons.push('current_gates_unavailable');else{
      const gates=ExecutionGatesSchema.parse(deps.currentGates());
      let alreadyPreflight=false;if(sessionState(loaded).dispatcherExists){const db=new DatabaseSync(config.dispatcherDatabase,{readOnly:true});try{alreadyPreflight=db.prepare('SELECT preflight FROM experiment WHERE id=1').get()?.preflight===1;}finally{db.close();}}
      if(!alreadyPreflight){try{assertExecutionReady(loaded.plan,gates);}catch{reasons.push('current_gates_failed');}}
      else if(Object.entries(gates).some(([key,value])=>key!=='approvedRemainingSpendUsd'&&!value)||gates.approvedRemainingSpendUsd<loaded.plan.episodes[0]!.limits.maxApprovedSpendUsd)reasons.push('current_gates_failed');
    }
    if(deps.ledger){const snapshot=deps.ledger.snapshot();if(snapshot.frozen||!snapshot.connectionApprovalCurrent||snapshot.pendingBillingCount>0)reasons.push('ledger_not_ready');}
  }
  return{ready:reasons.length===0,reasons,sessionId:config.sessionId,executionMode:config.executionMode,plannedEpisodes:loaded.plan.plannedEpisodes,maxNewSpendUsd:config.maxNewSpendUsd,executionPerformed:false as const};
}
function audit(loaded:Loaded,command:string,episodeId:string|undefined){const db=new DatabaseSync(loaded.journal),id=randomUUID();let closed=false;db.prepare('INSERT INTO operator_commands(id,command,episode_id,started_at,status) VALUES(?,?,?,?,?)').run(id,command,episodeId??null,new Date().toISOString(),'started');
  return{finish:(state:'completed'|'failed')=>{if(closed)return;closed=true;try{db.prepare('UPDATE operator_commands SET completed_at=?,status=? WHERE id=?').run(new Date().toISOString(),state,id);}finally{db.close();}}};}

/** Operator command boundary. No automatic factory installation, retry, resume, or ledger approval sync. */
export async function runExperimentSession(requestValue:ExperimentSessionRequest,dependencies:ExperimentSessionDependencies={}){
  const request={...requestValue};
  const command=z.enum(['preflight','run-one','run-all','status','cancel','recover']).parse(request.command),deps={...dependencies,...(dependencies.factory?{factory:{...dependencies.factory}}:{})},loaded=load(request);
  if((command==='run-one'||command==='cancel')!== (request.episodeId!==undefined))fail('session_episode_argument_invalid');
  if(request.episodeId!==undefined&&!loaded.plan.episodes.some(e=>e.id===request.episodeId))fail('unplanned_episode');
  if(command==='status')return{command,status:status(loaded),executionPerformed:false as const};
  if(command==='preflight')return{command,preflight:preflight(loaded,deps),executionPerformed:false as const};
  if(command==='cancel'||command==='recover'){
    if(!sessionState(loaded).initialized)fail('session_not_initialized');const d=dispatcher(loaded,deps,controlTransport(loaded.config)),record=audit(loaded,command,request.episodeId);
    try{const recovered=command==='recover'?d.recoverInterrupted().recovered:null;if(command==='cancel')d.cancel(request.episodeId!);record.finish('completed');return{command,recovered,status:status(loaded),executionPerformed:false as const};}
    catch(error){record.finish('failed');throw error;}finally{d.close();}
  }
  const before=status(loaded);
  if(command==='run-one'&&before.capture?.episodes.find(row=>row.episodeId===request.episodeId)?.phase==='terminal'||command==='run-all'&&before.complete)return{command,status:before,executionPerformed:false as const,alreadyTerminal:true};
  const checked=preflight(loaded,deps);if(!checked.ready)throw new ExperimentSessionError(checked.reasons[0]!);
  if(deps.signal?.aborted)fail('operator_cancelled_before_start');initialize(loaded,deps);
  const record=audit(loaded,command,request.episodeId);let runtime:SessionRuntime|undefined,d:ExperimentDispatcher|undefined,runtimeClosed=false,executionPerformed=false;
  try{
    const context:SessionFactoryContext={sessionId:loaded.config.sessionId,executionMode:loaded.config.executionMode,sourceDigest:loaded.config.sourceDigest,planDigest:loaded.config.planDigest,transportDigest:loaded.config.transportDigest,
      publicEpisodes:publicInputs(loaded.plan),reservationForExecution:createReservationProjection(loaded.plan),ledger:deps.ledger};
    const factory={...deps.factory!};runtime=await factory.create(context);
    const transport={...runtime.transport};if(transport.executionMode!==loaded.config.executionMode||transport.modelLockDigest!==loaded.config.modelLockDigest||transport.policyDigest!==loaded.config.policyDigest||hashJson({modelLockDigest:transport.modelLockDigest,policyDigest:transport.policyDigest,adjudicationBounds:transport.adjudicationBounds??null})!==loaded.config.transportDigest)fail('created_transport_binding_mismatch');
    d=dispatcher(loaded,deps,{...transport,execute:(input,signal)=>{executionPerformed=true;return transport.execute(input,signal);}});
    if(command==='run-one')await d.dispatch(request.episodeId!,deps.signal);else await d.runAll(deps.signal);
    runtimeClosed=true;await runtime.close?.();
    record.finish('completed');return{command,status:status(loaded),executionPerformed};
  }catch(error){record.finish('failed');throw error;}finally{d?.close();if(!runtimeClosed)await runtime?.close?.();}
}
