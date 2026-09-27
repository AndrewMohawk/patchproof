import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {BudgetLedger} from '../packages/orchestrator/src/budget-ledger.ts';
import {digestJson} from '../packages/contracts/src/digest.ts';
import {planExperiment,hashJson} from '../workers/evaluator/protocol.ts';
import {liveReadinessReceiptDigest} from '../workers/evaluator/experiment-export.ts';
import {createReservationProjection,ExperimentSessionConfigSchema,experimentSessionConfigDigest,runExperimentSession} from '../workers/evaluator/experiment-session.ts';
import type {ExperimentSessionCommand,ExperimentSessionDependencies,SessionFactoryContext} from '../workers/evaluator/experiment-session.ts';
import {runExperimentSessionOperator} from '../scripts/experiment-session-cli.ts';

const H='sha256:'+'a'.repeat(64),J='sha256:'+'b'.repeat(64),K='sha256:'+'c'.repeat(64),WHEN='2026-09-26T00:00:00.000Z';
const usage=()=>({inferenceCalls:0,inputTokens:0,outputTokens:0,runtimeFeedbackRounds:0,elapsedMs:0,sandboxCpuSeconds:0,measuredCostUsd:0});
const gates=()=>({accountAccessVerified:true,sandboxEntitlementVerified:true,modelVerified:true,realIntegrationPassed:true,oracleIndependentlyReviewed:true,experimentApproved:true,approvedRemainingSpendUsd:5,pricesVerified:true,finalProtocolFrozen:true});
const budget=()=>({schemaVersion:'1.0',currency:'USD',maxApprovedSpendUsd:25,ownerApproval:{approvedBy:'invented',approvedAt:WHEN,expiresAt:null,reference:'invented'},verifiedCredits:[],stages:{smoke:5,pilot:20,evaluate:0,hosting:0},episodeLimits:{inferenceCallLimit:24,inputTokenLimit:1000,outputTokenLimit:1000,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:900,candidateBranchLimit:3},note:'invented metadata test'});
function setup(t:TestContext,mode:'synthetic'|'live'='synthetic',kind:'pilot'|'final'='pilot'){
  const directory=mkdtempSync(join(tmpdir(),'patchproof-session-unit-')),projectRoot=join(directory,'project');mkdirSync(projectRoot,{mode:0o700});t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const tasks=Array.from({length:kind==='pilot'?4:6},(_,r)=>Array.from({length:5},(_,i)=>({id:`invented-${r}-${i}`,repoId:`invented-repo-${r}`,split:kind==='pilot'?'development' as const:'final' as const,fixtureDigest:J,oracleDigest:K}))).flat();
  const plan=planExperiment({kind,tasks,limits:{inferenceCallLimit:24,inputTokenLimit:1000,outputTokenLimit:1000,wallTimeLimitSeconds:900,sandboxCpuSecondsLimit:900,maxApprovedSpendUsd:mode==='live'?0.01:0},sourceManifestDigest:H,modelLockDigest:mode==='live'?H:null,policyDigest:J,approvedExperimentBudgetUsd:mode==='live'?5:0,estimatedExperimentCostUsd:mode==='live'?1:null,createdAt:WHEN});
  const bounds=mode==='live'?{maxConcurrentCpuUnits:1,maxCostUsdPerSecond:0,fixedCostUsd:0}:null;
  const config=ExperimentSessionConfigSchema.parse({schemaVersion:'1.0',kind:'patchproof-experiment-session',sessionId:'11111111-1111-4111-8111-111111111111',dispatcherDatabase:join(directory,'dispatch.sqlite'),planPath:join(directory,'plan.json'),planDigest:hashJson(plan),sourceDigest:H,
    executionMode:mode,modelLockDigest:plan.modelLockDigest,policyDigest:J,adjudicationBounds:bounds,transportDigest:hashJson({modelLockDigest:plan.modelLockDigest,policyDigest:J,adjudicationBounds:bounds}),factoryDigest:K,maxNewSpendUsd:mode==='live'?5:0,readiness:null});
  writeFileSync(config.planPath,JSON.stringify(plan),{mode:0o600});const configPath=join(directory,'config.json');
  const save=()=>writeFileSync(configPath,JSON.stringify(config),{mode:0o600});save();
  let created=0,executed=0,closed=0;const contexts:SessionFactoryContext[]=[];
  const deps:ExperimentSessionDependencies={currentSourceDigest:()=>H,factory:{factoryDigest:K,sourceDigest:H,transportDigest:config.transportDigest,create:context=>{created++;contexts.push(context);return{transport:{executionMode:mode,modelLockDigest:plan.modelLockDigest,policyDigest:J,...(bounds?{adjudicationBounds:bounds}:{}),execute:async input=>{executed++;const{checkpoint,...publicInput}=input;const reservation=context.reservationForExecution(publicInput);assert.equal(reservation.dispatchId,input.dispatchId);return{selectionFinalized:true,selectedCandidate:null,runtimeApproved:false,usage:usage(),billingComplete:true,artifactsDigest:H,infrastructureExclusion:null};},adjudicate:async()=>{throw new Error('No candidate exists in metadata-only test.');}},close:()=>{closed++;}};}}};
  const request=(command:ExperimentSessionCommand,episodeId?:string)=>({command,configPath,expectedConfigDigest:experimentSessionConfigDigest(config),projectRoot,...(episodeId!==undefined?{episodeId}:{})});
  const ready=()=>{const receipt={schemaVersion:'1.0',kind:'experiment-preflight-readiness',bindings:{sourceDigest:H,planDigest:config.planDigest,transportDigest:config.transportDigest},observedAt:WHEN,gates:gates()};const path=join(directory,'readiness.json');writeFileSync(path,JSON.stringify(receipt),{mode:0o600});config.readiness={path,acceptedDigest:liveReadinessReceiptDigest(receipt)};save();deps.currentGates=gates;const ledger=new BudgetLedger({filename:join(directory,'budget.sqlite'),budget:budget()});deps.ledger=ledger;t.after(()=>ledger.close());return ledger;};
  return{directory,projectRoot,plan,config,configPath,save,deps,request,ready,counts:()=>({created,executed,closed}),contexts};
}

test('status and preflight retain all identities without creating runtime or durable files',async t=>{
  const s=setup(t);const status=await runExperimentSession(s.request('status'),s.deps);assert.ok('status'in status);assert.equal(status.status.initialized,false);assert.equal(status.status.plannedEpisodeIds.length,72);
  const preflight=await runExperimentSession(s.request('preflight'),s.deps);assert.ok('preflight'in preflight);assert.equal(preflight.preflight.ready,true);assert.deepEqual(s.counts(),{created:0,executed:0,closed:0});assert.equal(existsSync(s.config.dispatcherDatabase),false);assert.equal(existsSync(s.config.dispatcherDatabase+'.session.sqlite'),false);
});

test('reservation projection validates exact public input and returns no oracle or plan object',async t=>{
  const s=setup(t);await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps);const context=s.contexts[0]!,input=context.publicEpisodes[0]!,project=createReservationProjection(s.plan),result=project(input);
  assert.equal(result.reservationFingerprint,hashJson({planDigest:s.config.planDigest,episode:s.plan.episodes[0]}));assert.equal(result.publicInputDigest,digestJson(input));assert.equal(result.stage,'pilot');assert.equal(result.amountMicros,'0');
  assert.equal('plan'in context,false);assert.equal(JSON.stringify(context).includes('oracle'),false);assert.equal(JSON.stringify(result).includes(K),false);
  assert.throws(()=>project({...input,oracleDigest:K}));assert.throws(()=>project({...input,limits:{...input.limits,inputTokenLimit:999}}),/binding/);assert.throws(()=>project({...input,seed:input.seed+1}),/binding/);
});

test('run-one is terminal-idempotent and reopened status requires no factory or current source',async t=>{
  const s=setup(t);const first=await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps);assert.ok('status'in first);assert.equal(first.status.terminalEpisodes,1);assert.deepEqual(s.counts(),{created:1,executed:1,closed:1});
  const duplicate=await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id));assert.ok('alreadyTerminal'in duplicate&&duplicate.alreadyTerminal);assert.equal(duplicate.executionPerformed,false);
  rmSync(s.projectRoot,{recursive:true});const read=await runExperimentSession(s.request('status'));assert.ok('status'in read);assert.equal(read.status.terminalEpisodes,1);assert.equal(read.status.plannedEpisodeIds.length,72);assert.deepEqual(s.counts(),{created:1,executed:1,closed:1});
});

test('explicit run-all walks 72 and 270 invented grids once and preserves every identity',async t=>{
  for(const kind of['pilot','final']as const){const s=setup(t,'synthetic',kind);const result=await runExperimentSession(s.request('run-all'),s.deps);assert.ok('status'in result);assert.equal(result.status.complete,true);assert.equal(result.status.terminalEpisodes,kind==='pilot'?72:270);assert.equal(s.counts().executed,result.status.plannedEpisodes);
    const again=await runExperimentSession(s.request('run-all'));assert.equal(again.executionPerformed,false);assert.equal(s.counts().created,1);}
});

test('live default-zero authority and missing gates stop before factory construction',async t=>{
  const s=setup(t,'live');const {maxNewSpendUsd:_,...zero}=s.config;assert.equal(ExperimentSessionConfigSchema.parse(zero).maxNewSpendUsd,0);s.config.maxNewSpendUsd=0;s.save();const result=await runExperimentSession(s.request('preflight'),s.deps);assert.ok('preflight'in result);assert.equal(result.preflight.ready,false);assert.ok(result.preflight.reasons.includes('new_spending_not_approved'));
  await assert.rejects(runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps));assert.equal(s.counts().created,0);assert.equal(existsSync(s.config.dispatcherDatabase),false);
});

test('injected live metadata transport still obtains the existing ledger grant and cannot replay it',async t=>{
  const s=setup(t,'live'),ledger=s.ready();const result=await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps);assert.ok('status'in result);const id=result.status.capture!.episodes[0]!.dispatchId;
  assert.equal(ledger.get(id).reservedMicros,'10000');assert.equal(ledger.get(id).fingerprint,hashJson({planDigest:s.config.planDigest,episode:s.plan.episodes[0]}));assert.equal(ledger.markAttempted(id).dispatchGranted,false);assert.equal(ledger.snapshot().chargedMicros,'0');
  await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id));assert.equal(s.counts().executed,1);
});

test('unknown live accounting blocks another factory and keeps the existing hold',async t=>{
  const s=setup(t,'live'),ledger=s.ready(),create=s.deps.factory!.create;s.deps.factory!.create=async context=>{const runtime=await create(context),execute=runtime.transport.execute;runtime.transport.execute=async(input,signal)=>({...await execute(input,signal),usage:{...usage(),measuredCostUsd:null,sandboxCpuSeconds:null},billingComplete:false});return runtime;};
  await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps);assert.equal(ledger.snapshot().pendingBillingCount,1);assert.equal(ledger.snapshot().heldMicros,'10000');
  await assert.rejects(runExperimentSession(s.request('run-one',s.plan.episodes[1]!.id),s.deps),/ledger_not_ready/);assert.equal(s.counts().created,1);
});

test('pending cancellation and dead-owner recovery never construct runtime or retry episodes',async t=>{
  const s=setup(t);await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps);const cancelled=await runExperimentSession(s.request('cancel',s.plan.episodes[1]!.id));assert.ok('status'in cancelled);assert.equal(cancelled.status.capture!.episodes[1]!.reason,'cancelled');
  const db=new DatabaseSync(s.config.dispatcherDatabase);db.prepare("UPDATE episodes SET phase='executing',owner_id='invented-owner',owner_pid=2147483647,started_at=? WHERE position=2").run(WHEN);db.close();
  const recovered=await runExperimentSession(s.request('recover'));assert.ok('recovered'in recovered);assert.equal(recovered.recovered,1);assert.ok('status'in recovered);assert.equal(recovered.status.capture!.episodes[2]!.reason,'interrupted_owner');
  const again=await runExperimentSession(s.request('recover'));assert.ok('recovered'in again);assert.equal(again.recovered,0);assert.equal(s.counts().executed,1);
});

test('live-owner recovery is conservative and cannot steal an active row',async t=>{
  const s=setup(t);await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps);const db=new DatabaseSync(s.config.dispatcherDatabase);db.prepare("UPDATE episodes SET phase='executing',owner_id='invented',owner_pid=?,started_at=? WHERE position=1").run(process.pid,WHEN);db.close();
  const result=await runExperimentSession(s.request('recover'));assert.ok('recovered'in result);assert.equal(result.recovered,0);assert.ok('status'in result);assert.equal(result.status.capture!.episodes[1]!.phase,'executing');
});

test('an aborted explicit run-all cancels all remaining planned entries without new execution',async t=>{
  const s=setup(t),controller=new AbortController(),create=s.deps.factory!.create;s.deps.signal=controller.signal;s.deps.factory!.create=async context=>{const runtime=await create(context),execute=runtime.transport.execute;runtime.transport.execute=async(input,signal)=>{const result=await execute(input,signal);controller.abort();return result;};return runtime;};
  const result=await runExperimentSession(s.request('run-all'),s.deps);assert.ok('status'in result);assert.equal(result.status.complete,true);assert.equal(result.status.terminalEpisodes,72);assert.equal(s.counts().executed,1);assert.equal(result.status.capture!.episodes.filter(row=>row.reason==='cancelled').length,72);
});

test('config, source, factory and plan mismatches stop before any runtime creation',async t=>{
  const s=setup(t),request=s.request('run-one',s.plan.episodes[0]!.id);await assert.rejects(runExperimentSession({...request,expectedConfigDigest:J},s.deps),/config_digest/);
  await assert.rejects(runExperimentSession(request,{...s.deps,currentSourceDigest:()=>J}),/current_source/);
  await assert.rejects(runExperimentSession(request,{...s.deps,factory:{...s.deps.factory!,factoryDigest:H}}),/factory_binding/);
  writeFileSync(s.config.planPath,JSON.stringify({...s.plan,policyDigest:K}));await assert.rejects(runExperimentSession(request,s.deps),/plan_or_transport/);assert.equal(s.counts().created,0);assert.equal(existsSync(s.config.dispatcherDatabase),false);
});

test('durable identity rejects changed config and missing initialized DB rather than recreating it',async t=>{
  const s=setup(t);await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps);s.config.factoryDigest=H;s.save();await assert.rejects(runExperimentSession(s.request('status')),/identity_mismatch/);
  s.config.factoryDigest=K;s.save();rmSync(s.config.dispatcherDatabase);await assert.rejects(runExperimentSession(s.request('status')),/state_lost/);await assert.rejects(runExperimentSession(s.request('run-all'),s.deps),/state_lost/);assert.equal(existsSync(s.config.dispatcherDatabase),false);
});

test('factory setup failure is journaled without inventing terminal rows or automatically retrying',async t=>{
  const s=setup(t);s.deps.factory!.create=()=>{throw new Error('private external setup detail');};await assert.rejects(runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id),s.deps));
  const status=await runExperimentSession(s.request('status'));assert.ok('status'in status);assert.equal(status.status.initialized,true);assert.equal(status.status.terminalEpisodes,0);
  const db=new DatabaseSync(s.config.dispatcherDatabase+'.session.sqlite',{readOnly:true});assert.equal(db.prepare('SELECT status FROM operator_commands').get()!.status,'failed');db.close();
});

test('standalone operator status needs no runtime and sanitizes private errors and unsupported commands',async t=>{
  const s=setup(t),cli=new URL('../scripts/experiment-session-cli.ts',import.meta.url);const child=spawnSync(process.execPath,[cli.pathname,'status',s.configPath,experimentSessionConfigDigest(s.config)],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);const output=JSON.parse(child.stdout);assert.equal(output.plannedEpisodes,72);assert.equal(output.executionPerformed,false);assert.equal(child.stdout.includes(s.directory),false);
  const bad=await runExperimentSessionOperator(['run-one',s.configPath,experimentSessionConfigDigest(s.config),'private-unknown-id'],s.projectRoot,s.deps);assert.equal(bad.exitCode,2);assert.equal(JSON.stringify(bad).includes('private-unknown-id'),false);
  const invalid=await runExperimentSessionOperator(['submit',s.configPath,experimentSessionConfigDigest(s.config)],s.projectRoot);assert.equal(invalid.exitCode,2);
  s.deps.factory!.create=()=>{throw new Error('private-sentinel-stack');};const failed=await runExperimentSessionOperator(['run-one',s.configPath,experimentSessionConfigDigest(s.config),s.plan.episodes[0]!.id],s.projectRoot,s.deps);assert.equal(failed.exitCode,2);assert.equal(JSON.stringify(failed).includes('private-sentinel'),false);
});

test('private config and database symlinks are rejected before factories run',async t=>{
  const s=setup(t),alias=join(s.directory,'alias.json');symlinkSync(s.configPath,alias);await assert.rejects(runExperimentSession({...s.request('run-all'),configPath:alias},s.deps));
  chmodSync(s.configPath,0o644);await assert.rejects(runExperimentSession(s.request('run-all'),s.deps));chmodSync(s.configPath,0o600);symlinkSync(s.config.planPath,s.config.dispatcherDatabase);await assert.rejects(runExperimentSession(s.request('run-all'),s.deps));assert.equal(s.counts().created,0);
});

test('a close failure cannot claim no execution or rerun an already terminal episode',async t=>{
  const s=setup(t),create=s.deps.factory!.create;let closed=0;s.deps.factory!.create=async context=>{const runtime=await create(context);runtime.close=()=>{closed++;throw new Error('private close failure');};return runtime;};
  const failed=await runExperimentSessionOperator(['run-one',s.configPath,experimentSessionConfigDigest(s.config),s.plan.episodes[0]!.id],s.projectRoot,s.deps);
  assert.equal(failed.exitCode,2);assert.equal(failed.output.executionPerformed,null);assert.equal(s.counts().executed,1);assert.equal(closed,1);assert.equal(JSON.stringify(failed).includes('private close'),false);
  const db=new DatabaseSync(s.config.dispatcherDatabase+'.session.sqlite',{readOnly:true});assert.equal(db.prepare('SELECT status FROM operator_commands').get()!.status,'failed');db.close();
  const again=await runExperimentSession(s.request('run-one',s.plan.episodes[0]!.id));assert.equal(again.executionPerformed,false);assert.equal(s.counts().executed,1);
});

test('concurrent explicit commands still invoke one executor and report which invocation ran',async t=>{
  const s=setup(t),request=s.request('run-one',s.plan.episodes[0]!.id),results=await Promise.all([runExperimentSession(request,s.deps),runExperimentSession(request,s.deps)]);
  assert.equal(s.counts().executed,1);assert.equal(results.filter(result=>result.executionPerformed).length,1);const status=await runExperimentSession(s.request('status'));assert.ok('status'in status);assert.equal(status.status.terminalEpisodes,1);
});
