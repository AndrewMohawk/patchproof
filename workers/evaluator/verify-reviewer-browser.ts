/** Synthetic browser verification. Temporary plans/events remain outside the repository and are removed. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createReviewerStudy, readStudyEvents, reportReviewerStudy } from './reviewer-study.ts';
import { startReviewerServer } from './reviewer-server.ts';

const directory = await mkdtemp(join(tmpdir(), 'patchproof-reviewer-browser-'));
const checks: Record<string, boolean> = {}, errors: string[] = [], remoteRequests: string[] = [];
const servers: Awaited<ReturnType<typeof startReviewerServer>>[] = [];
const screenshotPaths = { desktop: '/tmp/patchproof-reviewer-desktop.png', mobile: '/tmp/patchproof-reviewer-mobile.png', timeout: '/tmp/patchproof-reviewer-timeout-mobile.png' };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const fixture = (studyId: string, maxAssignmentMs: number) => createReviewerStudy({
  studyId, recordingMode: 'synthetic', sourceMode: 'local_mock', randomizationSeed: 29,
  participantIds: ['p01', 'p02'], createdAt: new Date(Date.now()-1000).toISOString(), maxAssignmentMs,
  items: [0,1].map(index => ({ id: `example${index}`, sourceArtifactDigest: 'sha256:'+'b'.repeat(64), sourceVisibility: 'public_curated' as const,
    content: { taskStatement: 'Preserve the first occurrence of each value and its original order.',
      requirements: [{ id:'R01', text:'Keep values in the order of their first appearance.' }, { id:'R02', text:'Leave the supplied input unchanged.' }],
      sourceContext: 'def unique(values):\n    return sorted(set(values))',
      patch: '--- a/solution.py\n+++ b/solution.py\n@@ -1,2 +1,2 @@\n def unique(values):\n-    return sorted(set(values))\n+    return list(dict.fromkeys(values))\n# Literal markup: <img src=x onerror="window.__reviewInjection=true">' },
    observations: [{requirementId:'R01',checkDescription:'First-occurrence ordering',expected:'[3, 1, 2]',observed:'[3, 1, 2]'}, {requirementId:'R02',checkDescription:'Input after invocation',expected:'[3, 1, 3, 2]',observed:'[3, 1, 3, 2]'}],
    answer:index?'reject' as const:'accept' as const, answerRationale:'Synthetic test key only.',answerSource:'Synthetic browser fixture; not a measured study.',packetWordingReviewedForLabels:true as const })),
});
async function launchStudy(name: string, duration: number) {
  const workspace = join(directory,name); await mkdir(workspace,{mode:0o700});
  const plan=fixture(name,duration), planPath=join(workspace,'plan.json'), journalPath=join(workspace,'events.jsonl');
  await writeFile(planPath,JSON.stringify(plan),{mode:0o600});
  const running=await startReviewerServer({planPath,journalPath,port:0}); servers.push(running);
  const link=running.participantLinks.find(l=>l.participantId==='p01')!.url;
  const token=new URLSearchParams(new URL(link).hash.slice(1)).get('token');
  const session=async()=>{const response=await fetch(running.origin+'/api/session',{headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);return response.json();};
  return {running,link,session,plan,journalPath};
}
try {
  const study=await launchStudy('browser-flow',60_000);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('request',request=>{if(new URL(request.url()).origin!==study.running.origin)remoteRequests.push(new URL(request.url()).origin);});
  await page.goto(study.link,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Open next task'}).waitFor();
  assert.equal(new URL(page.url()).hash,'');checks.fragmentRemoved=true;
  assert.match(await page.locator('#notice').innerText(),/synthetic/);checks.syntheticLabelVisible=true;
  await page.getByRole('button',{name:'Open next task'}).focus();await page.keyboard.press('Enter');
  await page.locator('#active').waitFor({state:'visible'});checks.keyboardOpen=true;
  const opened=await study.session(), firstHasObservations=await page.locator('#observations-card').isVisible();
  assert.equal(await page.locator('#patch img').count(),0);
  assert.match(await page.locator('#patch').innerText(),/<img src=x/);
  assert.equal(await page.evaluate(()=>Boolean((window as unknown as Record<string,unknown>).__reviewInjection)),false);checks.patchMarkupInert=true;
  await page.reload({waitUntil:'networkidle'});await page.locator('#active').waitFor({state:'visible'});
  const reloaded=await study.session();assert.equal(reloaded.openedAt,opened.openedAt);assert.equal(reloaded.deadlineAt,opened.deadlineAt);checks.reloadPreservesTimer=true;
  await page.screenshot({path:screenshotPaths.desktop,fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.mobileHasNoPageOverflow=true;
  await page.screenshot({path:screenshotPaths.mobile,fullPage:true});
  await page.getByRole('radio',{name:/^Accept/}).focus();await page.keyboard.press('Space');
  await page.getByRole('button',{name:'Record response',exact:true}).focus();await page.keyboard.press('Enter');
  await page.locator('#ready').waitFor({state:'visible'});assert.equal((await study.session()).completedAssignments,1);checks.keyboardSubmissionRecorded=true;
  await page.getByRole('button',{name:'Open next task'}).click();await page.locator('#active').waitFor({state:'visible'});
  assert.notEqual(await page.locator('#observations-card').isVisible(),firstHasObservations);checks.bothPacketPresentationsRendered=true;
  await page.locator('summary').click();await page.locator('#skip-reason').selectOption('technical_issue');await page.getByRole('button',{name:'Record skip',exact:true}).click();
  await page.locator('#complete').waitFor({state:'visible'});checks.submitAndSkipFlowComplete=true;
  const report=reportReviewerStudy(study.plan,await readStudyEvents(study.journalPath));assert.equal(report.evidenceStatus,'synthetic_only');assert.equal(report.conditions.reduce((n,c)=>n+c.missing,0),3);checks.missingAssignmentsRetained=true;
  assert.equal((await readStudyEvents(study.journalPath)).length,4);checks.reloadCreatedNoDuplicateEvents=true;
  await context.close();
  const timeout=await launchStudy('browser-timeout',1000),mobile=await browser.newContext({viewport:{width:390,height:844}}),timed=await mobile.newPage();
  timed.on('pageerror',error=>errors.push(error.message));timed.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await timed.goto(timeout.link,{waitUntil:'networkidle'});await timed.getByRole('button',{name:'Open next task'}).click();
  await timed.locator('#timeout-message').waitFor({state:'visible',timeout:5000});assert(await timed.getByRole('button',{name:'Record response',exact:true}).isDisabled());
  await timed.locator('summary').click();assert.equal(await timed.locator('#skip-reason').inputValue(),'timeout');
  await timed.screenshot({path:screenshotPaths.timeout,fullPage:true});
  await timed.getByRole('button',{name:'Record skip',exact:true}).click();await timed.locator('#ready').waitFor({state:'visible'});checks.timeoutRequiresExplicitSkip=true;
  assert.equal((await readStudyEvents(timeout.journalPath)).length,2);checks.timeoutInventsNoAnswer=true;
  await mobile.close();assert.deepEqual(errors,[]);assert.deepEqual(remoteRequests,[]);checks.noConsoleOrRemoteRequests=true;
  const artifact={schemaVersion:'1.0',verifiedAt:new Date().toISOString(),scope:'Synthetic browser verification only; no human study or provider/candidate execution.',browser:browser.version(),status:'passed',checks,screenshots:screenshotPaths,participantTokensRetained:false,privateStudyArtifactsRetained:false};
  const output=new URL('../../.local/verification/',import.meta.url);await mkdir(output,{recursive:true});await writeFile(new URL('reviewer-browser.json',output),JSON.stringify(artifact,null,2)+'\n');
  console.log(JSON.stringify(artifact,null,2));
} finally {
  await browser?.close();for(const server of servers.reverse())await server.close();await rm(directory,{recursive:true,force:true});
}
