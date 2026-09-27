import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { createReviewerStudy, readStudyEvents, reportReviewerStudy } from '../workers/evaluator/reviewer-study.ts';
import { startReviewerServer } from '../workers/evaluator/reviewer-server.ts';

function definition(maxAssignmentMs=60_000) {
  return createReviewerStudy({studyId:'synthetic-web',recordingMode:'synthetic',sourceMode:'local_mock',randomizationSeed:2,
    participantIds:['p01','p02'],createdAt:new Date(Date.now()-1000).toISOString(),maxAssignmentMs,
    items:[0,1].map(i=>({id:`item${i}`,sourceArtifactDigest:'sha256:'+'a'.repeat(64),sourceVisibility:'public_curated' as const,
      content:{taskStatement:`Synthetic request ${i}.`,requirements:[{id:'R01',text:'Return the requested integer.'}],patch:`-return 0\n+return ${i}\n# <img src=x onerror="window.__reviewInjection=true">`,sourceContext:'def solution():\n    return 0'},
      observations:[{requirementId:'R01',checkDescription:'Fixed public example.',expected:String(i),observed:String(i)}],
      answer:i?'reject' as const:'accept' as const,answerRationale:'PRIVATE ANSWER KEY',answerSource:'PRIVATE OBJECTIVE SOURCE',packetWordingReviewedForLabels:true as const}))});
}
async function setup(t:{after:(fn:()=>Promise<void>)=>unknown},maxAssignmentMs=60_000) {
  const directory=await mkdtemp(join(tmpdir(),'patchproof-review-web-'));
  const plan=definition(maxAssignmentMs),planPath=join(directory,'plan.json'),journalPath=join(directory,'events.jsonl');
  await writeFile(planPath,JSON.stringify(plan),{mode:0o600});
  const running=await startReviewerServer({planPath,journalPath,port:0});
  t.after(async()=>{await running.close();await rm(directory,{recursive:true,force:true});});
  const tokens=Object.fromEntries(running.participantLinks.map(link=>[link.participantId,new URLSearchParams(new URL(link.url).hash.slice(1)).get('token')!]));
  async function call(path:string,options:{participant?:string;body?:unknown;headers?:Record<string,string>;method?:string}={}) {
    const response=await fetch(running.origin+path,{method:options.method??(options.body===undefined?'GET':'POST'),headers:{Authorization:`Bearer ${tokens[options.participant??'p01']}`,...(options.body===undefined?{}:{'Content-Type':'application/json'}),...options.headers},...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
    return {response,value:await response.json()};
  }
  return {directory,plan,planPath,journalPath,running,tokens,call};
}

test('review server binds only loopback, validates private external paths and serves hardened static assets',async t=>{
  const x=await setup(t);assert.match(x.running.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
  const page=await fetch(x.running.origin);assert.equal(page.status,200);assert.match(await page.text(),/Patch review exercise/);
  assert.match(page.headers.get('content-security-policy')!,/script-src 'self'/);assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('referrer-policy'),'no-referrer');
  await assert.rejects(startReviewerServer({planPath:resolve('package.json'),journalPath:x.journalPath,port:0}),/outside/);
  await assert.rejects(startReviewerServer({planPath:x.planPath,journalPath:x.journalPath,port:0}),/EEXIST/);
  await chmod(x.planPath,0o644);await assert.rejects(startReviewerServer({planPath:x.planPath,journalPath:join(x.directory,'other.jsonl'),port:0}),/private owned/);await chmod(x.planPath,0o600);
});

test('HTTP surface requires the scoped token, same origin and exact host, with no filesystem query or report API',async t=>{
  const x=await setup(t);
  assert.equal((await fetch(x.running.origin+'/api/session')).status,401);
  assert.equal((await x.call('/api/session',{headers:{Authorization:'Bearer invalid'}})).response.status,401);
  assert.equal((await x.call('/api/session',{headers:{Origin:'https://other.invalid'}})).response.status,403);
  const wrongHost = await new Promise<number | undefined>((resolve,reject)=>{const request=httpRequest(x.running.origin+'/api/session',{headers:{Host:'other.invalid',Authorization:`Bearer ${x.tokens.p01}`}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.end();});
  assert.equal(wrongHost,403);
  assert.equal((await x.call('/api/session?plan=/etc/hosts')).response.status,400);
  assert.equal((await x.call('/api/report')).response.status,404);
  assert.equal((await x.call('/api/plan')).response.status,404);
});

test('opening releases one neutral packet for that participant and reload never resets the timer',async t=>{
  const x=await setup(t),before=await x.call('/api/session');assert.equal(before.value.status,'ready');assert.equal(before.value.packet,null);
  const assignmentId=before.value.nextAssignmentId;
  const first=await x.call('/api/open',{body:{requestId:'open1',assignmentId}});assert.equal(first.response.status,200);assert.equal(first.value.status,'active');
  assert.equal(first.value.packet.tasks.length,1);assert.equal(first.value.packet.participantId,'p01');
  const forbidden=new Set(['answer','answerRationale','answerSource','condition','variant','outcome','sourceArtifactDigest','planDigest','itemId']);
  const inspect=(value:unknown)=>{if(value&&typeof value==='object')for(const[key,child]of Object.entries(value)){assert(!forbidden.has(key),key);inspect(child);}};inspect(first.value);assert(!JSON.stringify(first.value).includes('PRIVATE'));
  const reloaded=await x.call('/api/session');assert.equal(reloaded.value.openedAt,first.value.openedAt);assert.equal(reloaded.value.deadlineAt,first.value.deadlineAt);
  const duplicate=await x.call('/api/open',{body:{requestId:'open-again',assignmentId}});assert.equal(duplicate.response.status,200);assert.equal(duplicate.value.openedAt,first.value.openedAt);
  assert.equal((await readStudyEvents(x.journalPath)).length,1);
  const other=await x.call('/api/session',{participant:'p02'});assert.equal(other.value.status,'ready');assert.equal(other.value.packet,null);
  const forbiddenAction=await x.call('/api/submit',{participant:'p02',body:{requestId:'other-submit',assignmentId,answer:'accept'}});assert.equal(forbiddenAction.response.status,409);
});

test('trusted timestamps, immutable answers, request retries and duplicate racing submissions are preserved',async t=>{
  const x=await setup(t),assignmentId=(await x.call('/api/session')).value.nextAssignmentId;
  assert.equal((await x.call('/api/open',{body:{requestId:'open',assignmentId,recordedAt:new Date().toISOString()}})).response.status,400);
  await x.call('/api/open',{body:{requestId:'open',assignmentId}});
  const request={requestId:'submit1',assignmentId,answer:'needs_review'};
  const [one,two]=await Promise.all([x.call('/api/submit',{body:request}),x.call('/api/submit',{body:request})]);
  assert.equal(one.response.status,200);assert.equal(two.response.status,200);assert.equal(one.value.completedAssignments,1);assert.equal(two.value.completedAssignments,1);
  assert.equal((await readStudyEvents(x.journalPath)).length,2);
  assert.equal((await x.call('/api/submit',{body:{...request,answer:'accept'}})).response.status,409);
  assert.equal((await x.call('/api/submit',{body:{...request,requestId:'fresh-but-stale'}})).response.status,409);
  const report=reportReviewerStudy(x.plan,await readStudyEvents(x.journalPath));assert.equal(report.conditions.reduce((n,c)=>n+c.submitted,0),1);assert.equal(report.conditions.reduce((n,c)=>n+c.missing,0),3);
  assert(report.assignments.find(a=>a.assignmentId===assignmentId)!.durationMs!>=0);
});

test('server time rejects late answers, allows an explicit timeout skip and retains missing denominators',async t=>{
  const x=await setup(t,1000),assignmentId=(await x.call('/api/session')).value.nextAssignmentId;
  await x.call('/api/open',{body:{requestId:'open',assignmentId}});
  assert.equal((await x.call('/api/skip',{body:{requestId:'early',assignmentId,reason:'timeout'}})).response.status,409);
  await setTimeout(1050);
  const late=await x.call('/api/submit',{body:{requestId:'late',assignmentId,answer:'accept'}});assert.equal(late.response.status,409);assert.equal(late.value.error.code,'assignment_timeout');
  const skipped=await x.call('/api/skip',{body:{requestId:'skip',assignmentId,reason:'timeout'}});assert.equal(skipped.response.status,200);assert.equal(skipped.value.completedAssignments,1);
  const report=reportReviewerStudy(x.plan,await readStudyEvents(x.journalPath));assert.equal(report.conditions.reduce((n,c)=>n+c.missing,0),4);assert.equal(report.conditions.reduce((n,c)=>n+c.skipped,0),1);
});

test('restart rotates access tokens while preserving the opened assignment and timing',async t=>{
  const x=await setup(t),assignmentId=(await x.call('/api/session')).value.nextAssignmentId;
  const opened=await x.call('/api/open',{body:{requestId:'open',assignmentId}});await x.running.close();
  const restarted=await startReviewerServer({planPath:x.planPath,journalPath:x.journalPath,port:0});
  try{
    assert.equal((await fetch(restarted.origin+'/api/session',{headers:{Authorization:`Bearer ${x.tokens.p01}`}})).status,401);
    const token=new URLSearchParams(new URL(restarted.participantLinks.find(l=>l.participantId==='p01')!.url).hash.slice(1)).get('token');
    const response=await fetch(restarted.origin+'/api/session',{headers:{Authorization:`Bearer ${token}`}}),state=await response.json();
    assert.equal(state.openedAt,opened.value.openedAt);assert.equal(state.nextAssignmentId,assignmentId);assert.equal(state.status,'active');
  }finally{await restarted.close();}
});

test('edited plans and damaged journal tails stop review instead of resetting or fabricating results',async t=>{
  const x=await setup(t);
  const original=await readFile(x.planPath,'utf8');await writeFile(x.planPath,original+'\n');
  const changed=await x.call('/api/session');assert.equal(changed.response.status,503);assert.equal(changed.value.error.code,'plan_changed');
  await writeFile(x.planPath,original);await writeFile(x.journalPath,'{"partial":',{mode:0o600});
  const damaged=await x.call('/api/session');assert.equal(damaged.response.status,503);assert(!JSON.stringify(damaged.value).includes(x.directory));
  assert.equal(await readFile(x.journalPath,'utf8'),'{"partial":');
});
