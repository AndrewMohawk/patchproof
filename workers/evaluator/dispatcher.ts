import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, isAbsolute,join,parse } from 'node:path';
import { z } from 'zod';
import { DigestSchema } from '../../packages/contracts/src/index.ts';
import { BudgetLedger, usdToMicros } from '../../packages/orchestrator/src/budget-ledger.ts';
import { EpisodeResultSchema } from './analysis.ts';
import type { EpisodeResult } from './analysis.ts';
import { assertExecutionReady, ExecutionGatesSchema, hashJson, INFRASTRUCTURE_EXCLUSIONS, validatePlan } from './protocol.ts';
import type { ExperimentPlan } from './protocol.ts';

const UsageSchema = EpisodeResultSchema.shape.usage;
type Usage = z.infer<typeof UsageSchema>;
type Episode = ExperimentPlan['episodes'][number];
const OperationId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/);
const SelectionSchema = z.strictObject({ files:z.record(z.string().min(1),z.string()),digest:DigestSchema });
const ExecutionSchema = z.strictObject({ selectionFinalized:z.literal(true),selectedCandidate:SelectionSchema.nullable(),
  runtimeApproved:z.boolean(),usage:UsageSchema,billingComplete:z.boolean(),artifactsDigest:DigestSchema,
  infrastructureExclusion:z.enum(INFRASTRUCTURE_EXCLUSIONS).nullable() }).superRefine((value,ctx)=>{
    if(value.billingComplete && value.usage.measuredCostUsd===null) ctx.addIssue({code:'custom',message:'Complete billing needs measured cost.'});
    if(value.selectedCandidate && hashJson(value.selectedCandidate.files)!==value.selectedCandidate.digest) ctx.addIssue({code:'custom',message:'Selected candidate digest changed.'});
    if(value.selectedCandidate && value.infrastructureExclusion!==null) ctx.addIssue({code:'custom',message:'Setup failure cannot select an artifact.'});
  });
export type FinalizedExecution = z.infer<typeof ExecutionSchema>;
const AdjudicationSchema = z.strictObject({ episodeId:z.string(),taskId:z.string(),selectedCandidateDigest:DigestSchema,
  outcome:z.enum(['correct','incorrect','unverified','infrastructure_error']),sealedChecksExecuted:z.boolean(),
  checkCount:z.number().int().nonnegative(),passedCheckCount:z.number().int().nonnegative(),infrastructureError:z.string().nullable(),
  evaluationUsage:z.strictObject({measuredCostUsd:z.number().finite().nonnegative().nullable(),sandboxCpuSeconds:z.number().finite().nonnegative().nullable()}),
  sandboxOperationIds:z.array(OperationId).max(1000),artifactsDigest:DigestSchema,finalOracleFeedbackRounds:z.literal(0) }).superRefine((value,ctx)=>{
    const scored=value.outcome==='correct'||value.outcome==='incorrect';
    if(value.passedCheckCount>value.checkCount||scored&&(!value.sealedChecksExecuted||value.checkCount===0||value.infrastructureError!==null)||
      value.outcome==='correct'&&value.passedCheckCount!==value.checkCount||value.outcome==='incorrect'&&value.passedCheckCount===value.checkCount||
      !scored&&value.sealedChecksExecuted||(value.infrastructureError!==null)!==(value.outcome==='infrastructure_error'))ctx.addIssue({code:'custom',message:'Inconsistent aggregate adjudication.'});
  });
const AdjudicationBoundsSchema=z.strictObject({maxConcurrentCpuUnits:z.number().finite().positive(),maxCostUsdPerSecond:z.number().finite().nonnegative(),fixedCostUsd:z.number().finite().nonnegative()});
export type AggregateAdjudication = z.infer<typeof AdjudicationSchema>;
export const SyntheticEpisodeResultSchema = z.strictObject({ ...EpisodeResultSchema.shape,
  executionMode:z.literal('synthetic'),modelLockDigest:DigestSchema.nullable(),benchmarkExecuted:z.literal(false) });
export type SyntheticEpisodeResult = z.infer<typeof SyntheticEpisodeResultSchema>;
export type DispatchResult = EpisodeResult | SyntheticEpisodeResult;

/** Trusted executor projection: no oracle identity, oracle content, or adjudicator callback. */
export interface ExecutionInput {
  episodeId:string;dispatchId:string;taskId:string;repoId:string;variant:Episode['variant'];repetition:number;seed:number;
  limits:Episode['limits'];fixtureDigest:string;planDigest:string;modelLockDigest:string|null;policyDigest:string;
  checkpoint:(value:{usage:Usage;operationIds:string[]})=>void;
}
export interface AdjudicationInput {
  episodeId:string;taskId:string;expectedFixtureDigest:string;expectedOracleDigest:string;
  selectedCandidateDigest:string;selectionFinalized:true;files:Record<string,string>;onOperation:(id:string)=>void;
  ownerRunId:string;timeoutSeconds:number;sandboxCpuSecondsLimit:number;maxApprovedSpendUsd:number;
}
export interface DispatcherTransport {
  executionMode:'synthetic'|'live';modelLockDigest:string|null;policyDigest:string;
  adjudicationBounds?:z.infer<typeof AdjudicationBoundsSchema>;
  execute:(input:ExecutionInput,signal:AbortSignal)=>Promise<FinalizedExecution>;
  adjudicate:(input:AdjudicationInput,signal:AbortSignal)=>Promise<AggregateAdjudication>;
}
type Phase = 'pending'|'claimed'|'executing'|'selected'|'adjudicating'|'terminal';
type Stored = {episode_id:string;dispatch_id:string;position:number;phase:Phase;owner_id:string|null;owner_pid:number|null;
  started_at:string|null;cancel_requested:number;usage_json:string;operations_json:string;execution_json:string|null;result_json:string|null;reason:string|null};
export interface EpisodeDispatchView { episodeId:string;dispatchId:string;phase:Phase;reason:string|null;cancelRequested:boolean;
  operationIds:string[];result:DispatchResult|null; }
const zeroUsage = ():Usage=>({inferenceCalls:0,inputTokens:0,outputTokens:0,runtimeFeedbackRounds:0,elapsedMs:0,sandboxCpuSeconds:0,measuredCostUsd:0});
const dispatchIdentity=(planDigest:string,id:string)=>{const h=hashJson([planDigest,id]).slice(7);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
function prepareDatabase(filename:string){
  if(!isAbsolute(filename))throw new Error('Dispatcher requires an absolute private database path.');
  const parent=dirname(filename),root=parse(parent).root;let current=root;
  for(const part of parent.slice(root.length).split('/').filter(Boolean)){
    current=join(current,part);try{mkdirSync(current,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const entry=lstatSync(current);if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Dispatcher parent must not use symlinks.');
  }
  const directory=lstatSync(parent);if((directory.mode&0o077)!==0||(process.getuid&&directory.uid!==process.getuid()))throw new Error('Dispatcher requires a private owned parent directory.');
  try{closeSync(openSync(filename,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  for(const path of[filename,filename+'-wal',filename+'-shm',filename+'-journal']){try{const entry=lstatSync(path);
    if(!entry.isFile()||entry.isSymbolicLink()||(process.getuid&&entry.uid!==process.getuid()))throw new Error('Dispatcher files must be owned regular files.');chmodSync(path,0o600);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
}
class DispatchStop extends Error { readonly reason:string;constructor(reason:string){super(reason);this.reason=reason;} }
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
  const reason=()=>signal.reason instanceof Error&&signal.reason.name==='TimeoutError'?'episode_timeout':'cancelled';
  if(signal.aborted){void promise.catch(()=>{});throw new DispatchStop(reason());}
  let listener:()=>void=()=>{};
  const aborted=new Promise<never>((_,reject)=>{listener=()=>reject(new DispatchStop(reason()));signal.addEventListener('abort',listener,{once:true});});
  try{return await Promise.race([promise,aborted]);}finally{signal.removeEventListener('abort',listener);}
}

/** One database per frozen experiment. Run only in trusted evaluator control plane.
 * A dead owner's episode becomes terminal without retry; recovery never grants paid dispatch. */
export class ExperimentDispatcher {
  readonly #db:DatabaseSync;readonly #plan:ExperimentPlan;readonly #digest:string;readonly #transport:DispatcherTransport;
  readonly #ledger:BudgetLedger|undefined;readonly #gates:(()=>unknown)|undefined;readonly #now:()=>Date;
  readonly #owner=randomUUID();readonly #controllers=new Map<string,AbortController>();
  constructor(options:{filename:string;plan:unknown;transport:DispatcherTransport;ledger?:BudgetLedger;gates?:()=>unknown;now?:()=>Date}) {
    this.#plan=validatePlan(options.plan);this.#digest=hashJson(this.#plan);
    this.#transport={...options.transport,...(options.transport.adjudicationBounds?{adjudicationBounds:structuredClone(options.transport.adjudicationBounds)}:{})};
    if(!['synthetic','live'].includes(options.transport.executionMode)||options.transport.policyDigest!==this.#plan.policyDigest||options.transport.modelLockDigest!==this.#plan.modelLockDigest) throw new Error('Transport does not match frozen plan.');
    if(options.transport.executionMode==='live'){
      if(!options.ledger||!options.gates||!this.#plan.modelLockDigest)throw new Error('Live dispatch needs a budget ledger, readiness gates and model lock.');
      AdjudicationBoundsSchema.parse(options.transport.adjudicationBounds);
    }
    this.#ledger=options.ledger;this.#gates=options.gates;this.#now=options.now??(()=>new Date());
    prepareDatabase(options.filename);this.#db=new DatabaseSync(options.filename);
    try{
      this.#db.exec(`PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS experiment(id INTEGER PRIMARY KEY CHECK(id=1),plan_digest TEXT NOT NULL,plan_json TEXT NOT NULL,mode TEXT NOT NULL,transport_digest TEXT NOT NULL,preflight INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS episodes(episode_id TEXT PRIMARY KEY,dispatch_id TEXT UNIQUE NOT NULL,position INTEGER UNIQUE NOT NULL,
          phase TEXT NOT NULL,owner_id TEXT,owner_pid INTEGER,started_at TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,
          usage_json TEXT NOT NULL,operations_json TEXT NOT NULL,execution_json TEXT,result_json TEXT,reason TEXT);
        CREATE TABLE IF NOT EXISTS dispatch_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,episode_id TEXT NOT NULL,at TEXT NOT NULL,kind TEXT NOT NULL,detail_json TEXT NOT NULL);`);
      this.#transaction(()=>{
        const meta=this.#db.prepare('SELECT * FROM experiment WHERE id=1').get();
        const transportDigest=hashJson({modelLockDigest:this.#transport.modelLockDigest,policyDigest:this.#transport.policyDigest,adjudicationBounds:this.#transport.adjudicationBounds??null});
        if(meta){if(meta.plan_digest!==this.#digest||meta.mode!==this.#transport.executionMode||meta.transport_digest!==transportDigest||hashJson(JSON.parse(String(meta.plan_json)))!==this.#digest)throw new Error('Database belongs to another frozen experiment or execution mode.');}
        else{
          this.#db.prepare('INSERT INTO experiment VALUES(1,?,?,?,?,0)').run(this.#digest,JSON.stringify(this.#plan),this.#transport.executionMode,transportDigest);
          for(const [position,episode]of this.#plan.episodes.entries())this.#db.prepare('INSERT INTO episodes(episode_id,dispatch_id,position,phase,usage_json,operations_json) VALUES(?,?,?,?,?,?)')
            .run(episode.id,dispatchIdentity(this.#digest,episode.id),position,'pending',JSON.stringify(zeroUsage()),'[]');
        }
        const rows=this.#rows();
        if(rows.length!==this.#plan.plannedEpisodes||rows.some((row,index)=>row.episode_id!==this.#plan.episodes[index]!.id||row.dispatch_id!==dispatchIdentity(this.#digest,row.episode_id)))throw new Error('Incomplete durable episode identities.');
      });
    }catch(error){this.#db.close();throw error;}
  }
  #time(){const date=this.#now();if(!Number.isFinite(date.getTime()))throw new Error('Invalid dispatcher clock.');return date.toISOString();}
  #transaction<T>(fn:()=>T):T{this.#db.exec('BEGIN IMMEDIATE');try{const value=fn();this.#db.exec('COMMIT');return value;}catch(error){this.#db.exec('ROLLBACK');throw error;}}
  #rows(){return this.#db.prepare('SELECT * FROM episodes ORDER BY position').all() as unknown as Stored[];}
  #row(id:string){const row=this.#db.prepare('SELECT * FROM episodes WHERE episode_id=?').get(id);if(!row)throw new Error('Unplanned episode.');return row as unknown as Stored;}
  #event(id:string,kind:string,detail:unknown={}){this.#db.prepare('INSERT INTO dispatch_events(episode_id,at,kind,detail_json) VALUES(?,?,?,?)').run(id,this.#time(),kind,JSON.stringify(detail));}
  #episode(id:string){return this.#plan.episodes.find(episode=>episode.id===id)!;}
  #view(row:Stored):EpisodeDispatchView{return{episodeId:row.episode_id,dispatchId:row.dispatch_id,phase:row.phase,reason:row.reason,cancelRequested:!!row.cancel_requested,operationIds:JSON.parse(row.operations_json),result:row.result_json?JSON.parse(row.result_json):null};}
  get(id:string){return this.#view(this.#row(id));}
  snapshot(){const episodes=this.#rows().map(row=>this.#view(row));return{planDigest:this.#digest,executionMode:this.#transport.executionMode,benchmarkExecuted:this.#transport.executionMode==='live'&&!!this.#db.prepare("SELECT 1 FROM dispatch_events WHERE kind='executor_started' LIMIT 1").get(),
    plannedEpisodes:this.#plan.plannedEpisodes,terminalEpisodes:episodes.filter(row=>row.phase==='terminal').length,complete:episodes.every(row=>row.phase==='terminal'),episodes,results:episodes.flatMap(row=>row.result?[row.result]:[])};}
  events(){return this.#db.prepare('SELECT * FROM dispatch_events ORDER BY sequence').all().map(row=>({sequence:Number(row.sequence),episodeId:String(row.episode_id),at:String(row.at),kind:String(row.kind),details:JSON.parse(String(row.detail_json))}));}
  #phase(id:string,phase:Phase){this.#transaction(()=>{const row=this.#row(id);if(row.owner_id!==this.#owner||row.phase==='terminal'||row.cancel_requested)throw new DispatchStop('cancelled');this.#db.prepare('UPDATE episodes SET phase=? WHERE episode_id=?').run(phase,id);this.#event(id,phase);});}
  #operations(id:string,ids:string[]){const parsed=z.array(OperationId).max(1000).parse(ids);this.#transaction(()=>{const row=this.#row(id);if(row.owner_id!==this.#owner||row.phase==='terminal')throw new DispatchStop('stale_callback');
    const all=[...new Set([...(JSON.parse(row.operations_json) as string[]),...parsed])];if(all.length>1000)throw new DispatchStop('operation_limit');this.#db.prepare('UPDATE episodes SET operations_json=? WHERE episode_id=?').run(JSON.stringify(all),id);});}
  #checkpoint(id:string,value:{usage:Usage;operationIds:string[]}){
    const parsed=z.strictObject({usage:UsageSchema,operationIds:z.array(OperationId).max(1000)}).parse(value);
    this.#transaction(()=>{const row=this.#row(id),previous=UsageSchema.parse(JSON.parse(row.usage_json));
      if(row.owner_id!==this.#owner||row.phase!=='executing'||row.cancel_requested||this.#controllers.get(id)?.signal.aborted)throw new DispatchStop('stale_callback');
      for(const key of Object.keys(previous) as (keyof Usage)[])if(previous[key]!==null&&((parsed.usage[key]===null&&previous[key]!>0)||(parsed.usage[key]!==null&&parsed.usage[key]!<previous[key]!)))throw new DispatchStop('usage_regression');
      const operations=[...new Set([...(JSON.parse(row.operations_json) as string[]),...parsed.operationIds])];if(operations.length>1000)throw new DispatchStop('operation_limit');
      this.#db.prepare('UPDATE episodes SET usage_json=?,operations_json=? WHERE episode_id=?').run(JSON.stringify(parsed.usage),JSON.stringify(operations),id);this.#event(id,'usage_checkpoint',{usage:parsed.usage});});
    if(this.#transport.executionMode==='live'){
      const reservation=this.#ledger!.get(this.#row(id).dispatch_id);
      this.#ledger!.reconcile({id:reservation.id,actualCostMicros:parsed.usage.measuredCostUsd===null?(reservation.actualCostMicros===null?null:BigInt(reservation.actualCostMicros)):usdToMicros(parsed.usage.measuredCostUsd,'ceil'),complete:false,evidenceDigest:hashJson(parsed)});
    }
    if(this.#exceeded(this.#episode(id),parsed.usage))throw new DispatchStop('resource_limit');
  }
  #exceeded(episode:Episode,usage:Usage){return usage.inferenceCalls>episode.limits.inferenceCallLimit||usage.inputTokens>episode.limits.inputTokenLimit||usage.outputTokens>episode.limits.outputTokenLimit||usage.runtimeFeedbackRounds>this.#plan.fixedRuntimeFeedbackRounds||usage.elapsedMs>episode.limits.wallTimeLimitSeconds*1000||(usage.sandboxCpuSeconds!==null&&usage.sandboxCpuSeconds>episode.limits.sandboxCpuSecondsLimit)||(usage.measuredCostUsd!==null&&usage.measuredCostUsd>episode.limits.maxApprovedSpendUsd);}
  #adjudicationAllowance(episode:Episode,execution:FinalizedExecution){
    const row=this.#row(episode.id),elapsed=Math.max(execution.usage.elapsedMs,Math.max(0,Date.parse(this.#time())-Date.parse(row.started_at!)));
    const wall=(episode.limits.wallTimeLimitSeconds*1000-elapsed)/1000;
    if(this.#transport.executionMode==='synthetic'){
      if(Math.floor(wall)<1)throw new DispatchStop('adjudication_allowance_exhausted');
      return{timeoutSeconds:Math.min(120,Math.floor(wall)),sandboxCpuSecondsLimit:Math.max(0,episode.limits.sandboxCpuSecondsLimit-(execution.usage.sandboxCpuSeconds??0)),maxApprovedSpendUsd:0};
    }
    if(!execution.billingComplete||execution.usage.measuredCostUsd===null||execution.usage.sandboxCpuSeconds===null)throw new DispatchStop('adjudication_allowance_unknown');
    const bounds=AdjudicationBoundsSchema.parse(this.#transport.adjudicationBounds),cpu=episode.limits.sandboxCpuSecondsLimit-execution.usage.sandboxCpuSeconds;
    const cost=Number(usdToMicros(episode.limits.maxApprovedSpendUsd)-usdToMicros(execution.usage.measuredCostUsd,'ceil'))/1e6;
    const costSeconds=cost<bounds.fixedCostUsd?0:bounds.maxCostUsdPerSecond===0?Infinity:(cost-bounds.fixedCostUsd)/bounds.maxCostUsdPerSecond;
    const timeoutSeconds=Math.floor(Math.min(120,wall,cpu/bounds.maxConcurrentCpuUnits,costSeconds));
    if(timeoutSeconds<1)throw new DispatchStop('adjudication_allowance_exhausted');
    return{timeoutSeconds,sandboxCpuSecondsLimit:cpu,maxApprovedSpendUsd:cost};
  }
  #liveReady(episode:Episode){
    const gates=ExecutionGatesSchema.parse(this.#gates!());
    const initial=this.#db.prepare('SELECT preflight FROM experiment WHERE id=1').get()!.preflight===0;
    if(initial){assertExecutionReady(this.#plan,gates);this.#db.prepare('UPDATE experiment SET preflight=1 WHERE id=1').run();}
    else if(Object.entries(gates).some(([key,value])=>key!=='approvedRemainingSpendUsd'&&!value)||gates.approvedRemainingSpendUsd<episode.limits.maxApprovedSpendUsd)throw new DispatchStop('execution_gate_failed');
    const row=this.#row(episode.id),stage=this.#plan.kind==='pilot'?'pilot':'evaluate';
    this.#ledger!.reserve({id:row.dispatch_id,episodeId:row.dispatch_id,stage,amountMicros:usdToMicros(episode.limits.maxApprovedSpendUsd),fingerprint:hashJson({planDigest:this.#digest,episode})});
    this.#phase(episode.id,'executing');
    if(!this.#ledger!.markAttempted(row.dispatch_id).dispatchGranted)throw new DispatchStop('dispatch_already_attempted');
  }
  #result(row:Stored,options:{outcome:EpisodeResult['outcome'];sealed:boolean;usage:Usage;runtimeApproved:boolean;exclusion:EpisodeResult['infrastructureExclusion'];artifactsDigest:string}):DispatchResult{
    const episode=this.#episode(row.episode_id),body={episodeId:episode.id,planDigest:this.#digest,modelLockDigest:this.#plan.modelLockDigest,policyDigest:this.#plan.policyDigest,
      variant:episode.variant,outcome:options.outcome,runtimeApproved:options.runtimeApproved,sealedChecksExecuted:options.sealed,includesSetupAndRetries:true,finalOracleFeedbackRounds:0,
      infrastructureExclusion:options.exclusion,usage:options.usage,artifactsDigest:options.artifactsDigest};
    return this.#transport.executionMode==='live'?EpisodeResultSchema.parse({...body,executionMode:'live'}):SyntheticEpisodeResultSchema.parse({...body,executionMode:'synthetic',benchmarkExecuted:false});
  }
  #terminal(id:string,reason:string,result:DispatchResult){this.#transaction(()=>{const row=this.#row(id);if(row.phase==='terminal')return;this.#db.prepare("UPDATE episodes SET phase='terminal',result_json=?,reason=? WHERE episode_id=?").run(JSON.stringify(result),reason,id);this.#event(id,'terminal',{reason,resultDigest:hashJson(result)});});}
  #failure(id:string,reason:string){const row=this.#row(id);if(row.phase==='terminal')return;
    const attempted=['executing','selected','adjudicating'].includes(row.phase),usage=UsageSchema.parse(JSON.parse(row.usage_json));
    usage.elapsedMs=Math.max(usage.elapsedMs,row.started_at?Math.max(0,Date.parse(this.#time())-Date.parse(row.started_at)):0);
    if(attempted){usage.sandboxCpuSeconds=null;usage.measuredCostUsd=null;}
    let runtimeApproved=false;if(row.execution_json)runtimeApproved=ExecutionSchema.parse(JSON.parse(row.execution_json)).runtimeApproved;
    if(this.#transport.executionMode==='live'){
      try{this.#ledger!.cancel(row.dispatch_id);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='reservation_not_found'))throw error;}
    }
    const result=this.#result(row,{outcome:reason==='cancelled'?'unverified':'infrastructure_error',sealed:false,usage,runtimeApproved,exclusion:null,
      artifactsDigest:hashJson({planDigest:this.#digest,dispatchId:row.dispatch_id,reason,usage,operationIds:JSON.parse(row.operations_json),usageMayBeIncomplete:attempted})});
    this.#terminal(id,reason,result);
  }
  cancel(id:string){this.#transaction(()=>{const row=this.#row(id);if(row.phase==='terminal')return;this.#db.prepare('UPDATE episodes SET cancel_requested=1 WHERE episode_id=?').run(id);this.#event(id,'cancel_requested');});this.#controllers.get(id)?.abort();if(this.#row(id).phase==='pending')this.#failure(id,'cancelled');return this.get(id);}
  recoverInterrupted(){let recovered=0;for(const row of this.#rows()){
    if(row.phase==='pending'||row.phase==='terminal'||row.owner_pid===null)continue;
    try{process.kill(row.owner_pid,0);continue;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
    this.#failure(row.episode_id,'interrupted_owner');recovered++;
  }return{recovered,snapshot:this.snapshot()};}
  async dispatch(id:string,signal?:AbortSignal):Promise<EpisodeDispatchView>{
    const claimed=this.#transaction(()=>{const row=this.#row(id);if(row.phase!=='pending')return false;this.#db.prepare("UPDATE episodes SET phase='claimed',owner_id=?,owner_pid=?,started_at=? WHERE episode_id=?").run(this.#owner,process.pid,this.#time(),id);this.#event(id,'claimed');return true;});
    if(!claimed)return this.get(id);
    const controller=new AbortController();this.#controllers.set(id,controller);
    const onAbort=()=>{this.cancel(id);};signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
    const poll=setInterval(()=>{if(this.#row(id).cancel_requested)controller.abort();},50);poll.unref();
    const timeout=setTimeout(()=>controller.abort(new DOMException('Episode deadline exceeded.','TimeoutError')),this.#episode(id).limits.wallTimeLimitSeconds*1000);timeout.unref();
    try{
      if(controller.signal.aborted)throw new DispatchStop('cancelled');
      const episode=this.#episode(id),row=this.#row(id);
      if(this.#transport.executionMode==='live')this.#liveReady(episode);else this.#phase(id,'executing');
      this.#event(id,'executor_started');
      const execution=ExecutionSchema.parse(await abortable(this.#transport.execute({episodeId:id,dispatchId:row.dispatch_id,taskId:episode.taskId,repoId:episode.repoId,
        variant:episode.variant,repetition:episode.repetition,seed:episode.seed,limits:structuredClone(episode.limits),fixtureDigest:episode.fixtureDigest,
        planDigest:this.#digest,modelLockDigest:this.#plan.modelLockDigest,policyDigest:this.#plan.policyDigest,checkpoint:value=>this.#checkpoint(id,value)},controller.signal),controller.signal));
      this.#checkpoint(id,{usage:execution.usage,operationIds:[]});
      this.#transaction(()=>{this.#db.prepare('UPDATE episodes SET execution_json=? WHERE episode_id=?').run(JSON.stringify(execution),id);this.#event(id,'selection_finalized',{selectedCandidateDigest:execution.selectedCandidate?.digest??null});});
      this.#phase(id,'selected');
      let verdict:AggregateAdjudication|null=null;
      const started=Date.parse(this.#time());
      if(execution.selectedCandidate){
        if(controller.signal.aborted)throw new DispatchStop('cancelled');
        const allowance=this.#adjudicationAllowance(episode,execution);
        this.#phase(id,'adjudicating');
        const selected=ExecutionSchema.parse(JSON.parse(this.#row(id).execution_json!)).selectedCandidate!;
        const adjudicationSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(allowance.timeoutSeconds*1000)]);
        verdict=AdjudicationSchema.parse(await abortable(this.#transport.adjudicate({episodeId:row.dispatch_id,taskId:episode.taskId,
          expectedFixtureDigest:episode.fixtureDigest,expectedOracleDigest:episode.oracleDigest,selectedCandidateDigest:selected.digest,
          selectionFinalized:true,files:selected.files,onOperation:operation=>this.#operations(id,[operation]),ownerRunId:row.dispatch_id,...allowance},adjudicationSignal),adjudicationSignal));
        if(verdict.episodeId!==row.dispatch_id||verdict.taskId!==episode.taskId||verdict.selectedCandidateDigest!==selected.digest||verdict.passedCheckCount>verdict.checkCount||
          (['correct','incorrect'].includes(verdict.outcome)&&!verdict.sealedChecksExecuted)||(verdict.outcome==='infrastructure_error'&&verdict.sealedChecksExecuted))throw new DispatchStop('adjudication_binding_failed');
        this.#operations(id,verdict.sandboxOperationIds);
      }
      const usage={...execution.usage};usage.elapsedMs+=Math.max(0,Date.parse(this.#time())-started);
      usage.elapsedMs=Math.max(usage.elapsedMs,Math.max(0,Date.parse(this.#time())-Date.parse(row.started_at!)));
      if(verdict){usage.sandboxCpuSeconds=usage.sandboxCpuSeconds===null||verdict.evaluationUsage.sandboxCpuSeconds===null?null:usage.sandboxCpuSeconds+verdict.evaluationUsage.sandboxCpuSeconds;
        usage.measuredCostUsd=usage.measuredCostUsd===null||verdict.evaluationUsage.measuredCostUsd===null?null:Number(usdToMicros(usage.measuredCostUsd,'ceil')+usdToMicros(verdict.evaluationUsage.measuredCostUsd,'ceil'))/1e6;}
      const billingComplete=execution.billingComplete&&usage.measuredCostUsd!==null;
      const result=this.#result(row,{outcome:verdict?.outcome??(execution.infrastructureExclusion?'infrastructure_error':'unverified'),sealed:verdict?.sealedChecksExecuted??false,
        runtimeApproved:execution.runtimeApproved,exclusion:execution.infrastructureExclusion,usage:{...usage,measuredCostUsd:billingComplete?usage.measuredCostUsd:null},artifactsDigest:hashJson({execution:execution.artifactsDigest,adjudication:verdict?.artifactsDigest??null,planDigest:this.#digest})});
      if(this.#transport.executionMode==='live'){
        const known=usage.measuredCostUsd??execution.usage.measuredCostUsd,prior=this.#ledger!.get(row.dispatch_id).actualCostMicros;
        this.#ledger!.reconcile({id:row.dispatch_id,actualCostMicros:known===null?(prior===null?null:BigInt(prior)):usdToMicros(known,'ceil'),complete:billingComplete,evidenceDigest:result.artifactsDigest});
      }
      this.#terminal(id,billingComplete?'completed':'billing_incomplete',result);
    }catch(error){this.#failure(id,error instanceof DispatchStop?error.reason:'execution_or_setup_failed');}
    finally{clearInterval(poll);clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);this.#controllers.delete(id);}
    return this.get(id);
  }
  async runAll(signal?:AbortSignal){for(const episode of this.#plan.episodes){if(signal?.aborted)this.cancel(episode.id);else await this.dispatch(episode.id,signal);}return this.snapshot();}
  close(){if(this.#controllers.size)throw new Error('Cancel and await active dispatches before closing.');this.#db.close();}
}
