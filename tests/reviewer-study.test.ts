import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createReviewerStudy, validateReviewerStudy, reviewerPacket, recordStudyAction, reportReviewerStudy,
  appendStudyAction, readStudyEvents } from '../workers/evaluator/reviewer-study.ts';
import type { ReviewerStudyPlan, StudyEvent, StudyItem, StudyAction } from '../workers/evaluator/reviewer-study.ts';

const digest = 'sha256:' + 'a'.repeat(64), base = Date.parse('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(base + ms).toISOString();
function options(size = 4) {
  return { studyId: 'synthetic-study', recordingMode: 'synthetic' as const, sourceMode: 'local_mock' as const,
    createdAt: at(0), randomizationSeed: 713, participantIds: Array.from({ length: size }, (_,i) => `p${i}`),
    items: Array.from({ length: size }, (_,i): StudyItem => ({ id: `item${i}`, sourceArtifactDigest: digest, sourceVisibility: 'public_curated',
      content: { taskStatement: `Synthetic review task ${i}.`, requirements: [{ id: 'R01', text: 'Return the requested value.' }], patch: `-return 0\n+return ${i}\n` },
      observations: [{ requirementId: 'R01', checkDescription: 'Known input.', expected: String(i), observed: String(i) }],
      answer: i % 2 ? 'reject' : 'accept', answerRationale: 'PRIVATE ANSWER RATIONALE', answerSource: 'PRIVATE CURATOR KEY', packetWordingReviewedForLabels: true })),
  };
}
const plan = (size = 4) => createReviewerStudy(options(size));
const order = (p: ReviewerStudyPlan, participantId: string) => p.assignments.filter(a => a.participantId === participantId).sort((a,b) => a.presentationIndex-b.presentationIndex);
function add(p: ReviewerStudyPlan, events: StudyEvent[], assignmentId: string, participantId: string, kind: 'opened' | 'submitted' | 'skipped', ms: number, extra: Record<string,unknown> = {}) {
  const event = recordStudyAction(p, events, { id: `event${events.length}`, assignmentId, participantId, kind, ...extra }, at(ms));
  events.push(event); return event;
}
function rehash(value: ReviewerStudyPlan) {
  const { planDigest: _ignored, ...body } = value;
  value.planDigest = 'sha256:' + createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return value;
}

test('reviewer design is reproducible, participant/item balanced and each patch is seen once per participant', () => {
  const p = plan(); assert.deepEqual(p,plan());
  assert.notDeepEqual(p.assignments,createReviewerStudy({...options(),randomizationSeed:714}).assignments);
  assert.equal(p.assignments.length,16);
  for (const participant of p.participantIds) {
    const rows=order(p,participant);
    assert.equal(new Set(rows.map(r=>r.itemId)).size,4);
    assert.deepEqual(rows.map(r=>r.presentationIndex),[0,1,2,3]);
    assert.equal(rows.filter(r=>r.condition==='patch_only').length,2);
  }
  for(const item of p.items) assert.equal(p.assignments.filter(a=>a.itemId===item.id&&a.condition==='patch_with_evidence').length,2);
});

test('invalid/changed study grids and labels in structured item metadata reject', () => {
  assert.throws(()=>createReviewerStudy({...options(),participantIds:['p0','p1','p2']}),/even/);
  assert.throws(()=>createReviewerStudy({...options(2),participantIds:['p0','p0']}),/Duplicate/);
  const p=plan();p.items[0]!.answer='needs_review';assert.throws(()=>validateReviewerStudy(p),/digest/);
  const unbalanced=plan();unbalanced.assignments[0]!.condition=unbalanced.assignments[0]!.condition==='patch_only'?'patch_with_evidence':'patch_only';
  assert.throws(()=>validateReviewerStudy(rehash(unbalanced)),/balanced/);
  const invalid=options();Object.assign(invalid.items[0]!,{variant:'patchproof'});assert.throws(()=>createReviewerStudy(invalid));
});

test('packets release only the opened item and omit the answer, condition, variant, outcome and source identity', () => {
  const p=plan(), events:StudyEvent[]=[];
  assert.throws(()=>reviewerPacket(p,events,'p0'),/open event/);
  const assignment=order(p,'p0')[0]!;add(p,events,assignment.id,'p0','opened',1);
  const packet=reviewerPacket(p,events,'p0');assert.equal(packet.tasks.length,1);assert.equal(packet.tasks[0]!.assignmentId,assignment.id);
  assert.equal('observations' in packet.tasks[0]!,assignment.condition==='patch_with_evidence');
  const forbidden=new Set(['answer','answerRationale','answerSource','condition','variant','outcome','sourceArtifactDigest','itemId','planDigest']);
  const inspect=(value:unknown)=>{if(value&&typeof value==='object')for(const[key,child]of Object.entries(value)){assert(!forbidden.has(key),key);inspect(child);}};
  inspect(packet);assert(!JSON.stringify(packet).includes('PRIVATE'));assert(!JSON.stringify(packet).includes(digest));
  assert.match(packet.sourceNotice,/Scripted/);assert.match(packet.notice,/synthetic/);
  assert.throws(()=>reviewerPacket(p,events,'unknown'),/Unknown/);
});

test('recorder enforces ordered single opening, submission after opening and immutable event identity', () => {
  const p=plan(), events:StudyEvent[]=[], [first,second]=order(p,'p0');
  assert.throws(()=>add(p,events,first!.id,'p0','submitted',1,{answer:'accept'}),/requires one open/);
  assert.throws(()=>add(p,events,second!.id,'p0','opened',1),/presentation order/);
  const opened=add(p,events,first!.id,'p0','opened',1);
  assert.throws(()=>recordStudyAction(p,events,opened.action,at(2)),/identity/);
  assert.throws(()=>add(p,events,first!.id,'p0','opened',2),/open once/);
  assert.throws(()=>add(p,events,second!.id,'p0','opened',2),/presentation order/);
  assert.throws(()=>recordStudyAction(p,events,{id:'bad',participantId:'p0',assignmentId:first!.id,kind:'submitted',answer:'accept',elapsedMs:1},at(2)));
  add(p,events,first!.id,'p0','submitted',501,{answer:'accept'});
  assert.throws(()=>add(p,events,first!.id,'p0','submitted',502,{answer:'reject'}),/unfinished/);
});

test('event digest, clock and plan binding changes reject instead of silently discarding rows', () => {
  const p=plan(), events:StudyEvent[]=[], first=order(p,'p0')[0]!;
  assert.throws(()=>add(p,events,first.id,'p0','opened',-1),/clock/);
  add(p,events,first.id,'p0','opened',100);
  assert.throws(()=>add(p,events,first.id,'p0','submitted',99,{answer:'accept'}),/clock/);
  const modified=structuredClone(events);modified[0]!.recordedAt=at(101);assert.throws(()=>reportReviewerStudy(p,modified),/digest/);
  assert.throws(()=>reportReviewerStudy(createReviewerStudy({...options(),randomizationSeed:9}),events),/identity/);
});

test('expired assignments cannot become timed answers and early timeout labels reject', () => {
  const p=createReviewerStudy({...options(2),maxAssignmentMs:1000}),events:StudyEvent[]=[],first=order(p,'p0')[0]!;
  add(p,events,first.id,'p0','opened',1);
  assert.throws(()=>add(p,events,first.id,'p0','skipped',500,{reason:'timeout'}),/cannot precede/);
  assert.throws(()=>add(p,events,first.id,'p0','submitted',1002,{answer:'accept'}),/time allowance/);
  add(p,events,first.id,'p0','skipped',1002,{reason:'timeout'});
  const report=reportReviewerStudy(p,events);assert.equal(report.assignments.find(a=>a.assignmentId===first.id)!.skipReason,'timeout');
  assert.equal(report.conditions.reduce((n,c)=>n+c.missing,0),4);
});

test('primary accuracy retains never-started, unfinished and skipped assignments; timing uses recorded boundaries', () => {
  const p=plan(2),events:StudyEvent[]=[],[first,second]=order(p,'p0'),other=order(p,'p1')[0]!;
  add(p,events,first!.id,'p0','opened',10);
  add(p,events,first!.id,'p0','submitted',510,{answer:p.items.find(i=>i.id===first!.itemId)!.answer});
  add(p,events,second!.id,'p0','opened',600);add(p,events,second!.id,'p0','skipped',700,{reason:'declined'});
  add(p,events,other.id,'p1','opened',800);
  const report=reportReviewerStudy(p,events);
  assert.equal(report.plannedAssignments,4);assert.equal(report.conditions.reduce((n,c)=>n+c.accuracy.denominator,0),4);
  assert.equal(report.conditions.reduce((n,c)=>n+c.accuracy.numerator,0),1);assert.equal(report.conditions.reduce((n,c)=>n+c.missing,0),3);
  assert.equal(report.assignments.find(a=>a.assignmentId===first!.id)!.durationMs,500);
  assert.equal(report.assignments.find(a=>a.assignmentId===other.id)!.durationMs,null);
  assert.equal(report.descriptiveComparison.completedMeanTimeDifferenceMs,null);assert.equal(report.evidenceStatus,'synthetic_only');
});

test('a planned study emits no invented responses or duration', () => {
  const report=reportReviewerStudy(plan(),[]);
  assert.equal(report.evidenceStatus,'planned_no_responses');assert.equal(report.participantsWithSubmissions,0);
  assert(report.conditions.every(c=>c.submitted===0&&c.missing===8&&c.accuracy.denominator===8&&c.completedDurationMs.mean===null));
  assert.equal(report.authenticityVerified,false);
});

test('complete synthetic responses yield descriptive paired summaries with explicit synthetic status', () => {
  const p=plan(),events:StudyEvent[]=[];let now=1;
  for(const participant of p.participantIds)for(const assignment of order(p,participant)){
    add(p,events,assignment.id,participant,'opened',now);
    now+=assignment.condition==='patch_only'?2000:1000;
    add(p,events,assignment.id,participant,'submitted',now,{answer:p.items.find(i=>i.id===assignment.itemId)!.answer});now++;
  }
  const report=reportReviewerStudy(p,events);
  assert.equal(report.complete,true);assert(report.conditions.every(c=>c.accuracy.fraction===1&&c.missing===0));
  assert.equal(report.descriptiveComparison.completedMeanTimeDifferenceMs,-1000);assert.equal(report.participants.length,4);
  assert.equal(report.evidenceStatus,'synthetic_only');assert(report.limitations.some(x=>x.includes('no power calculation')));
});

test('private append-only journal persists valid events, rejects duplicate writes and retains damaged tails', async () => {
  const directory=await mkdtemp(join(tmpdir(),'patchproof-study-'));
  try{
    const p=plan(),journal=join(directory,'events.jsonl'),assignment=order(p,'p0')[0]!;
    const action:StudyAction={id:'opened1',participantId:'p0',assignmentId:assignment.id,kind:'opened'};
    await appendStudyAction(p,journal,action);assert.equal((await stat(journal)).mode&0o777,0o600);
    const before=await readFile(journal,'utf8');assert.equal((await readStudyEvents(journal)).length,1);
    await assert.rejects(appendStudyAction(p,journal,action),/identity/);assert.equal(await readFile(journal,'utf8'),before);
    await writeFile(journal+'.lock','held',{mode:0o600});await assert.rejects(appendStudyAction(p,journal,{...action,id:'opened2'}),/EEXIST/);
    assert.equal(await readFile(journal+'.lock','utf8'),'held');
    await writeFile(journal,before+'{"partial":');await assert.rejects(readStudyEvents(journal),/Incomplete/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('CLI prepares a private plan, opens a single neutral packet, records a response and reports missing assignments', async () => {
  const directory=await mkdtemp(join(tmpdir(),'patchproof-study-cli-'));
  const run=(...args:string[])=>spawnSync(process.execPath,['workers/evaluator/reviewer-study.ts',...args],{cwd:process.cwd(),encoding:'utf8'});
  try{
    const input=join(directory,'input.json'),privatePlan=join(directory,'plan.json'),journal=join(directory,'events.jsonl'),packet=join(directory,'packet.json'),action=join(directory,'action.json'),report=join(directory,'report.json');
    await writeFile(input,JSON.stringify(options(2)),{mode:0o600});
    let result=run('plan',input,privatePlan);assert.equal(result.status,0,result.stderr);
    assert.equal((await stat(privatePlan)).mode&0o777,0o600);
    result=run('packet',privatePlan,journal,'p0',packet);assert.equal(result.status,2);assert.match(result.stderr,/open event/);
    result=run('open',privatePlan,journal,'p0',packet);assert.equal(result.status,0,result.stderr);
    const parsed=JSON.parse(await readFile(packet,'utf8'));assert.equal(parsed.tasks.length,1);
    await writeFile(action,JSON.stringify({id:'response1',kind:'submitted',participantId:'p0',assignmentId:parsed.tasks[0].assignmentId,answer:'needs_review'}),{mode:0o600});
    result=run('event',privatePlan,journal,action);assert.equal(result.status,0,result.stderr);
    result=run('report',privatePlan,journal,report);assert.equal(result.status,0,result.stderr);
    const scored=JSON.parse(await readFile(report,'utf8'));assert.equal(scored.plannedAssignments,4);assert.equal(scored.conditions.reduce((n:number,c:{missing:number})=>n+c.missing,0),3);
    assert.equal(scored.evidenceStatus,'synthetic_only');
  }finally{await rm(directory,{recursive:true,force:true});}
});
