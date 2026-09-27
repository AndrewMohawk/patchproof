import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {runExperimentSession,ExperimentSessionError} from '../workers/evaluator/experiment-session.ts';
import type {ExperimentSessionCommand,ExperimentSessionDependencies} from '../workers/evaluator/experiment-session.ts';
import {OperatorFileError} from './operator-files.ts';

const commands=['preflight','run-one','run-all','status','cancel','recover'] as const;
const safeCodes=new Set(['operator_usage','operator_path_invalid','operator_path_inside_project','operator_directory_invalid','operator_directory_not_private','operator_file_not_private','operator_database_sidecar_invalid','operator_file_changed_or_oversized',
  'session_path_collision','session_config_digest_mismatch','session_plan_or_transport_mismatch','orphan_dispatcher_requires_review','session_identity_mismatch','session_dispatcher_state_lost','session_mode_mismatch','live_ledger_required','uncommitted_session_requires_review','readiness_binding_mismatch',
  'session_episode_argument_invalid','unplanned_episode','session_not_initialized','current_source_mismatch','runtime_factory_not_installed','runtime_factory_binding_mismatch','new_spending_not_approved','readiness_unavailable','readiness_gates_failed','current_gates_unavailable','current_gates_failed','ledger_not_ready','operator_cancelled_before_start','created_transport_binding_mismatch']);
const label={kind:'private-experiment-session-operator',authenticityVerified:false,sourceExecutionVerified:false,competitionReady:false} as const;
/** The standalone CLI deliberately has no live or synthetic runtime factory installed. */
export async function runExperimentSessionOperator(args:string[],projectRoot:string,deps:ExperimentSessionDependencies={}){
  try{
    const[command,path,digest,episodeId]=args;
    if(!commands.includes(command as ExperimentSessionCommand)||args.length!==(['run-one','cancel'].includes(command!)?4:3))throw new OperatorFileError('operator_usage');
    const result=await runExperimentSession({command:command as ExperimentSessionCommand,configPath:path!,expectedConfigDigest:digest!,projectRoot,...(episodeId!==undefined?{episodeId}:{})},deps);
    if('preflight'in result)return{exitCode:result.preflight.ready?0:2,output:{...label,command,sessionId:result.preflight.sessionId,executionMode:result.preflight.executionMode,ready:result.preflight.ready,reasons:result.preflight.reasons,executionPerformed:false}};
    return{exitCode:0,output:{...label,command,sessionId:result.status.sessionId,executionMode:result.status.executionMode,initialized:result.status.initialized,plannedEpisodes:result.status.plannedEpisodes,terminalEpisodes:result.status.terminalEpisodes,complete:result.status.complete,executionPerformed:result.executionPerformed,...('recovered'in result?{recovered:result.recovered}:{})}};
  }catch(error){const code=(error instanceof ExperimentSessionError||error instanceof OperatorFileError)&&safeCodes.has(error.code)?error.code:'operator_session_rejected';return{exitCode:2,output:{...label,status:'error',executionPerformed:['run-one','run-all'].includes(args[0]??'')?null:false,error:{code}}};}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const result=await runExperimentSessionOperator(process.argv.slice(2),fileURLToPath(new URL('../',import.meta.url)),{signal:controller.signal});console.log(JSON.stringify(result.output,null,2));process.exitCode=result.exitCode;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
