import assert from 'node:assert/strict';
import test from 'node:test';
import { TwoLaneLocalCheckRunner, LOCAL_CHECK_SCHEDULING_POLICY } from '../packages/orchestrator/src/parallel-local-checks.ts';
import { runnerForFrozenProtocol, REPEATED_CHECK_PROTOCOL } from '../packages/orchestrator/src/repeated-checks.ts';
import type { CheckRunner, SandboxCheckResult, FunctionCase } from '../packages/contracts/src/product.ts';
const input = { files: { 'test.py': '# inert' }, entrypoint: 'test.py', timeoutSeconds: 1,
  cases: Array.from({length: 6}, (_,i)=>({id:'c'+i,requirementId:'R1',function:'f',args:[],kwargs:{},expected:i,assertArgsUnchanged:false})) };
function result(cases: FunctionCase[]): SandboxCheckResult {
 return {checks:cases.map(c=>({...c,status:'pass',message:'synthetic',expected:c.expected ?? null,actual:c.expected ?? null,durationMs:0,log:''})),
 operationIds:[],isolation:'local_container',cpuSeconds:1,measuredCostUsd:0,infrastructureError:null};
}
test('two lanes overlap with bounded concurrency, preserve order and repeat all observations', async()=>{
 let active=0,peak=0,calls=0;
 const runner:CheckRunner={async run(i){active++;peak=Math.max(peak,active);calls++;
 await new Promise(r=>setTimeout(r,15));active--;return result(i.cases);}};
 const lock={execution:{checkBackend:'local_container'},localCheckSchedulingPolicy:LOCAL_CHECK_SCHEDULING_POLICY,checkProtocol:REPEATED_CHECK_PROTOCOL};
 const r=await runnerForFrozenProtocol(runner,lock).run(input,new AbortController().signal);
 assert.equal(peak,2);assert.equal(calls,4);assert.deepEqual(r.checks.map(c=>c.id),input.cases.map(c=>c.id));
 assert(r.checks.every(c=>c.status==='pass'));assert.equal(r.cpuSeconds,4);
});
test('infrastructure uncertainty aborts the peer and awaits its cleanup',async()=>{
 let drained=false;
 const runner:CheckRunner={async run(i,signal){
 if(i.cases[0]!.id==='c0'){await new Promise(r=>setTimeout(r,10));return {...result(i.cases),infrastructureError:'timeout'};}
 await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));
 await new Promise(r=>setTimeout(r,10));drained=true;
 return {...result(i.cases),infrastructureError:'cancelled',cpuSeconds:null};
 }};
 const r=await new TwoLaneLocalCheckRunner(runner).run(input,new AbortController().signal);
 assert.equal(drained,true);assert.equal(r.infrastructureError,'timeout');assert.equal(r.cpuSeconds,null);
});
test('thrown lane preserves pre-spawn handles and drains sibling',async()=>{
 let drained=false;
 const runner:CheckRunner={async run(i,signal){
 i.onOperation?.('docker:'+i.cases[0]!.id);
 if(i.cases[0]!.id==='c0'){await new Promise(r=>setTimeout(r,10));throw Error('synthetic');}
 await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));drained=true;
 return {...result(i.cases),operationIds:['docker:c1'],infrastructureError:'cancelled'};
 }};
 const r=await new TwoLaneLocalCheckRunner(runner).run(input,new AbortController().signal);
 assert(drained);assert.deepEqual(r.operationIds,['docker:c0','docker:c1']);assert.equal(r.infrastructureError,'local_lane_error');
});
test('historical scheduling remains serial and unknown frozen scheduling fails closed',async()=>{
 let calls=0;
 const runner:CheckRunner={async run(i){calls++;assert.equal(i.cases.length,6);return result(i.cases);}};
 await runnerForFrozenProtocol(runner,{checkProtocol:REPEATED_CHECK_PROTOCOL}).run(input,new AbortController().signal);
 assert.equal(calls,2);
 assert.throws(()=>runnerForFrozenProtocol(runner,{localCheckSchedulingPolicy:{...LOCAL_CHECK_SCHEDULING_POLICY,maximumConcurrentContainers:3}}));
});
