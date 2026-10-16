import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DockerCheckRunner } from '../workers/sandbox/index.ts';
import { RepeatedCheckRunner } from '../packages/orchestrator/src/repeated-checks.ts';
import { TwoLaneLocalCheckRunner } from '../packages/orchestrator/src/parallel-local-checks.ts';
import { runDocker } from '../workers/sandbox/process.ts';
const results=[];
for(const id of ['v3-config-overlay','v3-cursor-pagination']){
 const fixture=JSON.parse(readFileSync('fixtures/development/'+id+'.json','utf8'));
 const timings:unknown[]=[];
 const runner=new DockerCheckRunner({process:async(args,options)=>{const start=performance.now();const result=await runDocker(args,options);timings.push({operation:args[0],ms:Math.round(performance.now()-start),code:result.code,error:result.error});return result;}});
 const start=performance.now(),runId=randomUUID();
 const result=await new RepeatedCheckRunner(new TwoLaneLocalCheckRunner(runner)).run({
 files:fixture.files,entrypoint:fixture.entrypoint,cases:[...fixture.visibleCases,...fixture.acceptanceCases],timeoutSeconds:120,ownerRunId:runId},new AbortController().signal);
 const cleanup=await runner.reconcile([runId]);
 results.push({taskId:id,runId,elapsedMs:Math.round(performance.now()-start),pass:result.checks.filter(c=>c.status==='pass').length,
 fail:result.checks.filter(c=>c.status==='fail').length,error:result.infrastructureError,operations:result.operationIds.length,cleanup,timings});
 console.log(JSON.stringify(results.at(-1)));
}
writeFileSync('research/verification/20261016-demo-repair/baseline-timing.json',JSON.stringify({observedAt:new Date().toISOString(),providerCalls:0,timeoutSeconds:120,repetitions:2,maximumConcurrentContainers:2,results},null,2)+'\n');
if(results.some(r=>r.error||r.operations!==44||r.cleanup.remainingOperationIds.length))process.exitCode=1;
