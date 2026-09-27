import {z} from 'zod';
import {digestJson} from '../../packages/contracts/src/digest.ts';
import {DigestSchema} from '../../packages/contracts/src/index.ts';
import {PhaseAccountingBindingSchema,PhaseAccountingRequestSchema,phaseInventoryDigest} from '../../packages/orchestrator/src/phase-accounting.ts';
import type {PhaseAccountingObserver,PhaseAccountingRequest} from '../../packages/orchestrator/src/phase-accounting.ts';
import {AdjudicationSchema,ExperimentExecutionError} from './dispatcher.ts';
import type {AdjudicationInput,AggregateAdjudication,DispatcherTransport} from './dispatcher.ts';
import {PublicExecutionInputSchema} from './experiment-session.ts';
import type {PublicExecutionInput,ReservationProjection} from './experiment-session.ts';

const Amount=z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const Usage=z.strictObject({measuredCostUsd:Amount,sandboxCpuSeconds:Amount});
const Handle=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const Observation=z.strictObject({receiptDigest:DigestSchema.nullable(),checkpointDigest:DigestSchema.nullable(),measuredCostUsd:Amount,sandboxCpuSeconds:Amount,
  billingComplete:z.boolean(),cpuComplete:z.boolean(),inventoryComplete:z.boolean(),cleanupComplete:z.boolean(),retentionFinal:z.boolean(),coveredOperationIds:z.array(Handle).max(1000)});
export const AdjudicationAccountingCheckpointSchema=z.strictObject({
  schemaVersion:z.literal('1.0'),binding:PhaseAccountingBindingSchema,publicInputDigest:DigestSchema,selectedCandidateDigest:DigestSchema,
  operationIds:z.array(Handle).max(1000),observedCpuLowerBound:Amount,observedCostLowerBoundUsd:Amount,
  state:z.enum(['running','finalized','failed']),checkpointDigest:DigestSchema,
});
export type AdjudicationAccountingCheckpoint=z.infer<typeof AdjudicationAccountingCheckpointSchema>;
export interface AccountedAdjudicatorOptions {
  sourceDigest:string;executionMode:'synthetic'|'live';publicEpisodes:readonly PublicExecutionInput[];
  reservationForExecution:(value:unknown)=>ReservationProjection;
  observer:PhaseAccountingObserver;
  adjudicate:(input:AdjudicationInput,signal:AbortSignal)=>Promise<AggregateAdjudication>;
  /** Must durably persist this metadata before returning. Never accepts files, cases or verdicts. */
  saveCheckpoint:(checkpoint:AdjudicationAccountingCheckpoint)=>void;
}
function withinDeadline<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
/** Protected final-phase adapter. No runtime callback, ledger reconciliation, retry or remote fetch. */
export function createAccountedAdjudicator(options:AccountedAdjudicatorOptions):DispatcherTransport['adjudicate']{
  const sourceDigest=DigestSchema.parse(options.sourceDigest),executionMode=z.enum(['live','synthetic']).parse(options.executionMode),
    inputs=options.publicEpisodes.map(value=>PublicExecutionInputSchema.parse(value)),byId=new Map(inputs.map(input=>[input.dispatchId,input])),
    project=options.reservationForExecution,observe=options.observer,adjudicate=options.adjudicate,save=options.saveCheckpoint,started=new Set<string>();
  if(byId.size!==inputs.length)throw new Error('Duplicate public dispatch identity.');
  return async(raw,signal)=>{
    const input={...raw,files:{...raw.files}},publicInput=byId.get(input.episodeId);
    if(!publicInput||input.ownerRunId!==publicInput.dispatchId||input.taskId!==publicInput.taskId||input.expectedFixtureDigest!==publicInput.fixtureDigest||input.selectionFinalized!==true)
      throw new ExperimentExecutionError('runtime_binding_changed');
    const timeout=z.number().finite().min(1).max(120).parse(input.timeoutSeconds),projection=project(structuredClone(publicInput));
    if(projection.dispatchId!==publicInput.dispatchId||projection.publicInputDigest!==digestJson(publicInput))throw new ExperimentExecutionError('runtime_binding_changed');
    const binding=PhaseAccountingBindingSchema.parse({executionMode,phase:'adjudication',dispatchId:publicInput.dispatchId,episodeId:publicInput.episodeId,
      reservationId:publicInput.dispatchId,reservationFingerprint:projection.reservationFingerprint,stage:projection.stage,reservedMicros:projection.amountMicros,
      sourceDigest,planDigest:publicInput.planDigest,modelLockDigest:publicInput.modelLockDigest,policyDigest:publicInput.policyDigest});
    const selectedCandidateDigest=DigestSchema.parse(input.selectedCandidateDigest),publicInputDigest=digestJson(publicInput);
    signal.throwIfAborted();if(started.has(publicInput.dispatchId))throw new ExperimentExecutionError('runtime_binding_changed');started.add(publicInput.dispatchId);
    const timeoutSignal=AbortSignal.timeout(Math.ceil(timeout*1000)),bounded=AbortSignal.any([signal,timeoutSignal]);
    const operations=new Set<string>();let cost:number|null=null,cpu:number|null=null,closed=false;
    const checkpoint=(state:AdjudicationAccountingCheckpoint['state'])=>{const body={schemaVersion:'1.0' as const,binding,publicInputDigest,selectedCandidateDigest,operationIds:[...operations].sort(),observedCpuLowerBound:cpu,observedCostLowerBoundUsd:cost,state};
      const value=AdjudicationAccountingCheckpointSchema.parse({...body,checkpointDigest:digestJson(body)});save(structuredClone(value));return value;};
    const usage=(value:{measuredCostUsd:number|null;sandboxCpuSeconds:number|null},final=false)=>{
      if(closed)throw new ExperimentExecutionError('runtime_binding_changed');bounded.throwIfAborted();const parsed=Usage.parse(value);
      if(parsed.measuredCostUsd!==null&&cost!==null&&parsed.measuredCostUsd<cost||parsed.sandboxCpuSeconds!==null&&cpu!==null&&parsed.sandboxCpuSeconds<cpu)throw new ExperimentExecutionError('billing_incomplete');
      if(parsed.measuredCostUsd!==null)cost=parsed.measuredCostUsd;if(parsed.sandboxCpuSeconds!==null)cpu=parsed.sandboxCpuSeconds;
      checkpoint('running');(final?(input.onFinalUsage??input.onUsage):input.onUsage)?.({measuredCostUsd:cost,sandboxCpuSeconds:cpu});
    };
    const operation=(value:string)=>{if(closed)throw new ExperimentExecutionError('runtime_binding_changed');bounded.throwIfAborted();const id=Handle.parse(value);
      if(!operations.has(id)&&operations.size>=1000)throw new ExperimentExecutionError('resource_limit');operations.add(id);checkpoint('running');input.onOperation(id);};
    try{
      checkpoint('running');
      const verdict=AdjudicationSchema.parse(await withinDeadline(Promise.resolve().then(()=>{bounded.throwIfAborted();return adjudicate({...input,onOperation:operation,onUsage:value=>usage(value),onFinalUsage:value=>usage(value,true)},bounded);}),bounded));
      bounded.throwIfAborted();
      if(verdict.episodeId!==input.episodeId||verdict.taskId!==input.taskId||verdict.selectedCandidateDigest!==selectedCandidateDigest)throw new ExperimentExecutionError('runtime_binding_changed');
      for(const id of verdict.sandboxOperationIds)if(!operations.has(id))operation(id);
      usage(verdict.evaluationUsage,true);
      const final=checkpoint('finalized'),request:PhaseAccountingRequest=PhaseAccountingRequestSchema.parse({binding,checkpointDigest:final.checkpointDigest,
        operationIds:final.operationIds,observedCpuLowerBound:cpu,observedCostLowerBoundUsd:cost});
      // Phase inventory is final before waiting; no further adjudication callback may alter it.
      closed=true;
      const observed=Observation.parse(await withinDeadline(Promise.resolve().then(()=>{bounded.throwIfAborted();return observe(structuredClone(request),bounded);}),bounded));
      bounded.throwIfAborted();
      const current=observed.receiptDigest!==null&&observed.checkpointDigest===request.checkpointDigest&&
        new Set(observed.coveredOperationIds).size===observed.coveredOperationIds.length&&phaseInventoryDigest(observed.coveredOperationIds)===phaseInventoryDigest(request.operationIds);
      const nonregressing=(cost===null||observed.measuredCostUsd!==null&&observed.measuredCostUsd>=cost)&&(cpu===null||observed.sandboxCpuSeconds!==null&&observed.sandboxCpuSeconds>=cpu);
      if(!current||!nonregressing)throw new ExperimentExecutionError('billing_incomplete');
      if(observed.measuredCostUsd!==null)cost=observed.measuredCostUsd;if(observed.sandboxCpuSeconds!==null)cpu=observed.sandboxCpuSeconds;
      // Preserve accepted lower bounds even when the observation is incomplete. This grants no completeness.
      (input.onFinalUsage??input.onUsage)?.({measuredCostUsd:cost,sandboxCpuSeconds:cpu});
      const complete=observed.billingComplete&&observed.cpuComplete&&observed.inventoryComplete&&observed.cleanupComplete&&observed.retentionFinal&&cost!==null&&cpu!==null;
      return{...verdict,sandboxOperationIds:[...operations],evaluationUsage:{measuredCostUsd:complete?cost:null,sandboxCpuSeconds:complete?cpu:null},
        artifactsDigest:digestJson({adjudication:verdict.artifactsDigest,phaseCheckpointDigest:request.checkpointDigest,observationReceiptDigest:observed.receiptDigest,complete})};
    }catch(error){closed=true;try{checkpoint('failed');}catch{/* A failed sink cannot replace the classified error with private persistence details. */}
      if(error instanceof ExperimentExecutionError)throw error;
      throw new ExperimentExecutionError(bounded.aborted?(timeoutSignal.aborted?'resource_limit':'billing_incomplete'):'execution_or_setup_failed');
    }
  };
}
