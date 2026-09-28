import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyEvidence } from '../../../packages/orchestrator/src/evidence.ts';
const origin = 'https://patchproof.andrewmohawk.xyz';
const output = process.argv[2]; assert.ok(output?.startsWith('/home/andrewmohawk/.config/patchproof/'));
await mkdir(output, {mode:0o700}); await mkdir(join(output,'raw'),{mode:0o700});
const success='08087e0a-f5d9-4c55-b4b6-7666bc8e016c', failure='5b356c42-8848-4e78-bce7-94800f63eebf';
const report={origin,startedAt:new Date().toISOString(),responseSubstitution:false,paidRequests:0,scenes:[],requests:[],errors:[],status:'started'};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',recordVideo:{dir:join(output,'raw'),size:{width:1440,height:1000}}});
await context.route('**/*',route=>{
 const request=route.request(),url=new URL(request.url());
 const allowed=request.method()==='GET' && url.origin===origin;
 report.requests.push({method:request.method(),path:url.pathname,allowed});
 return allowed?route.continue():route.abort();
});
const page=await context.newPage();const video=page.video();const start=performance.now();
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(m.type()==='error') report.errors.push(m.text());});
const get=async path=>{const r=await fetch(origin+path,{redirect:'error'});assert.equal(r.status,200);return r.json();};
const before=await get('/runs');
const scene=async(name,caption,action)=>{await action();await page.waitForTimeout(300);const at=performance.now()-start;await page.screenshot({path:join(output,name+'.png')});await page.waitForTimeout(7500);report.scenes.push({name,caption,startMs:Math.round(at),endMs:Math.round(performance.now()-start)});};
const evidence=async id=>{await page.goto(origin+'/#evidence/'+id);await page.locator('.run-summary[data-context-state="ready"]').waitFor();};
try {
 await page.goto(origin);await page.getByRole('button',{name:'Generate patch',exact:true}).waitFor();
 await scene('choose-example','Choose a Python maintenance example. This recording reviews saved real runs; it does not start new inference.',async()=>{});
 await scene('patch','This saved run used Nebius Token Factory. Its patch passed all nine listed checks in isolated local Docker containers.',async()=>{await page.getByRole('link',{name:'Latest result',exact:true}).click();await page.locator('.run-summary[data-context-state="ready"]').waitFor();assert.ok(page.url().endsWith(success));await page.getByRole('tab',{name:'Patch',exact:true}).click();});
 await scene('checks','Checks show expected and observed results. The full requirements and checks before repair remain available.',async()=>{await page.getByRole('tab',{name:'Checks',exact:true}).click();await page.locator('[data-panel="checks"] .check-row').first().locator('summary').click();});
 await scene('failure','This different repair failed two checks. The unsuccessful patch remains visible and was not approved.',async()=>{await evidence(failure);assert.equal(await page.getByRole('tab',{name:'Checks',exact:true}).getAttribute('aria-selected'),'true');});
 await scene('history','Run history includes failed repairs. Every result retains its original task, check results and model usage.',async()=>{await page.getByRole('link',{name:'Runs',exact:true}).click();await page.locator('.history-row').first().waitFor();});
 await scene('comparison','Compare three repair approaches on matching inputs and limits. These development runs are not a benchmark.',async()=>{await page.goto(origin+'/#compare');await page.locator('#compare-task').selectOption('stable-unique-01');await page.getByText('Same inputs and limits',{exact:true}).waitFor();});
 await scene('cost','Run details show model usage and estimated cost. Billing and unmeasured CPU are not presented as verified charges.',async()=>{await evidence(success);await page.getByRole('tab',{name:'Run details',exact:true}).click();});
 await scene('export','Download the patch, checks and saved inputs for review or replay. Try the live app at patchproof.andrewmohawk.xyz.',async()=>{
  await page.getByRole('tab',{name:'Patch',exact:true}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download evidence',exact:true}).click()]);
  const bytes=await readFile(await download.path());const bundle=verifyEvidence(JSON.parse(bytes));assert.equal(bundle.run.id,success);assert.equal(bundle.mode,'live');report.bundleDigest=bundle.bundleDigest;
  await writeFile(join(output,'download.json'),bytes,{mode:0o600,flag:'wx'});
 });
 const after=await get('/runs');assert.deepEqual(after.runs,before.runs);assert.deepEqual(report.errors,[]);assert.ok(report.requests.every(r=>r.allowed));report.status='passed';
} catch(e){report.status='failed';report.error=String(e.stack||e);process.exitCode=1;}
finally {await context.close();await browser.close();report.videoPath=await video.path();await chmod(report.videoPath,0o600);report.videoSha256=createHash('sha256').update(await readFile(report.videoPath)).digest('hex');report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({status:report.status,path:output,video:report.videoPath,error:report.error}));}
