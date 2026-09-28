import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin='https://patchproof.andrewmohawk.xyz';
const output='research/product-v3/public-review/mobile-fixes.json';
const screenshots='/tmp/patchproof-v3-mobile-fixes';
const failureId='9d3cd90e-94e2-4787-b294-5caa577b40e1';
await mkdir(screenshots,{recursive:true});
const json=async path=>{const response=await fetch(origin+path);assert.equal(response.status,200,path);return response.json();};
const tasks=await json('/tasks'),history=await json('/runs'),bundle=await json(`/runs/${failureId}/evidence`);
const record={checkedAt:new Date().toISOString(),origin,coordinatorRelease:'759986520789ac1a664c791c88d2a89d7a556de6',access:'GET only; write requests blocked',execution:tasks.execution,limits:tasks.limits,availability:tasks.availability,assets:[],taskLayouts:[],stories:[],navigation:[],errors:[],blockedWrites:[]};
const counts=c=>[...c.visibleChecks,...c.acceptanceChecks].reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});
assert.equal(tasks.execution.modelId,'nvidia/nemotron-3-super-120b-a12b');assert.equal(tasks.limits.wallTimeLimitSeconds,600);assert.equal(tasks.limits.maxApprovedSpendUsd,.25);
assert.equal(bundle.run.id,failureId);assert.equal(bundle.run.terminalStatus,'infrastructure_error');assert.equal(bundle.run.selectedCandidateId,1);assert.equal(bundle.run.candidates.length,2);assert.deepEqual(counts(bundle.run.candidates[0]),{fail:5,pass:17});assert.deepEqual(counts(bundle.run.candidates[1]),{error:22});assert.equal(bundle.run.candidates[1].rejectionReason,'timeout');
record.failedRun={id:failureId,bundleDigest:bundle.bundleDigest,model:bundle.runtimeLock.execution.modelId,terminalStatus:bundle.run.terminalStatus,retained:bundle.run.selectedCandidateId,attempts:bundle.run.candidates.map(c=>({id:c.id,accepted:c.accepted,rejectionReason:c.rejectionReason,counts:counts(c)}))};
for(const path of ['/','/app.js','/walkthrough.js','/diff-view.js','/style.css']){const response=await fetch(origin+path);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);if(path==='/walkthrough.js')assert(bytes.toString().includes(failureId));record.assets.push({path,status:response.status,sha256:createHash('sha256').update(bytes).digest('hex')});}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 for(const width of [1440,390,320]){
  const height=width===1440?1000:844;const page=await browser.newPage({viewport:{width,height}});
  page.on('pageerror',e=>record.errors.push({width,message:e.message}));page.on('console',m=>{if(m.type()==='error')record.errors.push({width,message:m.text()});});
  await page.route('**/*',r=>{if(r.request().method()!=='GET'){record.blockedWrites.push({method:r.request().method(),url:r.request().url()});return r.abort();}return r.continue();});
  const layout=async()=>page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,scrollY}));
  const shot=async(name,fullPage=false)=>{const path=`${screenshots}/${width}-${name}.png`;await page.screenshot({path,fullPage});return path;};
  await page.goto(origin+'/#tasks',{waitUntil:'domcontentloaded'});await page.locator('.source-code').waitFor();
  const button=page.locator('.task-actions .button.primary'),cost=page.locator('.run-cost'),reason=page.locator('.task-intro .availability-note');
  const task={width,layout:await layout(),button:{text:await button.innerText(),disabled:await button.isDisabled(),bounds:await button.boundingBox()},cost:{text:await cost.innerText(),bounds:await cost.boundingBox()},reason:{text:await reason.innerText(),bounds:await reason.boundingBox()},screenshot:await shot('task-first-screen')};
  assert.equal(task.layout.documentWidth,width);assert.equal(task.button.disabled,true);assert.match(task.cost.text,/A live repair is running/);assert.match(task.reason.text,/A live run is in progress/);
  const progress=cost.getByRole('link',{name:'View progress'});task.progress={href:await progress.getAttribute('href'),bounds:await progress.boundingBox()};assert(history.runs.some(r=>'#evidence/'+r.id===task.progress.href&&r.phase!=='terminal'));
  if(width<1000){assert(task.button.bounds.y>=0&&task.button.bounds.y+task.button.bounds.height<=height);assert(task.cost.bounds.y>=0&&task.cost.bounds.y+task.cost.bounds.height<=height);task.reason.fullyAboveFixedBar=task.reason.bounds.y+task.reason.bounds.height<height-96;}
  record.taskLayouts.push(task);await progress.click();await page.locator('#evidence').waitFor();assert.equal(new URL(page.url()).hash,task.progress.href);task.progress.navigationWorked=true;
  for(const prefix of ['', 'failed-']){
   for(const stage of ['bug','patch','checks','decision']){
    const route=prefix+stage;await page.goto(origin+'/#story/'+route,{waitUntil:'domcontentloaded'});await page.locator('#story[data-state=ready]').waitFor();await page.locator(`.story-step[aria-current=step][href="#story/${route}"]`).waitFor();
    const current=await page.locator('.story-step[aria-current=step]').evaluate(e=>{const b=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return{text:e.textContent,left:b.left,right:b.right,barLeft:p.left,barRight:p.right,scrollLeft:e.parentElement.scrollLeft,fullyVisible:b.left>=p.left-1&&b.right<=p.right+1};});
    const story={width,route,layout:await layout(),heading:await page.locator('.story-heading').innerText(),currentStep:current};assert.equal(story.layout.documentWidth,width);assert.equal(current.fullyVisible,true,`${width} ${route} selected step`);
    if(prefix){
     story.text=await page.locator('#story').innerText();story.values=await page.locator('.story-values pre').allTextContents();
     if(stage==='bug'){assert.match(story.heading,/configuration/);assert.match(story.text,/config_overlay.py/);const full=page.locator('.story-source').last();assert.equal(await full.textContent(),bundle.fixture.files[bundle.fixture.entrypoint]);}
     if(stage==='patch'){assert.match(story.text,/service.timeout/);assert(await page.locator('.github-diff-row.context').count()>0);story.diff={contextLines:await page.locator('.github-diff-row.context').count(),headers:await page.locator('.github-diff-header').allTextContents(),gutters:await page.locator('.diff-number').count()};assert.match(story.diff.headers.join(' '),/config_overlay.py/);assert(story.diff.gutters>0);assert.equal(await page.getByRole('link',{name:'Inspect the full run'}).getAttribute('href'),'#evidence/'+failureId);}
     if(stage==='checks'){assert.match(story.heading,/17 of 22/);assert.match(story.text,/v3-config-overlay-nested-list/);assert.equal(await page.getByRole('link',{name:'Inspect every check'}).getAttribute('href'),'#evidence/'+failureId);const definition=[...bundle.fixture.visibleCases,...bundle.fixture.acceptanceCases].find(c=>c.id==='v3-config-overlay-nested-list');assert.deepEqual(JSON.parse(story.values[1]),definition.expected);const check=[...bundle.run.candidates[0].visibleChecks,...bundle.run.candidates[0].acceptanceChecks].find(c=>c.id===definition.id);assert.deepEqual(JSON.parse(story.values[2]),check.actual.outcome);story.exactObservedValues=true;}
     if(stage==='decision'){story.attemptRows=await page.locator('.story-attempts tbody tr').allTextContents();assert.equal(story.attemptRows.length,2);assert.match(story.attemptRows[0],/17\/22 passed.*5 failed/s);assert.match(story.attemptRows[1],/0\/22 passed.*22 errors.*timeout/s);assert.match(story.text,/five-minute run allowance/);assert.match(story.text,/22 unavailable check results/);assert.match(story.text,/Execution error; no patch was accepted/);assert.equal(await page.getByRole('link',{name:'Download this run’s evidence'}).getAttribute('href'),`/runs/${failureId}/evidence`);}
     story.screenshot=await shot('story-'+route);story.fullScreenshot=await shot('story-'+route+'-full',true);
    }
    record.stories.push(story);
   }
  }
  await page.getByRole('link',{name:'1. The bug & goal'}).click();await page.locator('.story-step[aria-current=step][href="#story/failed-bug"]').waitFor();
  await page.locator('.story-source').first().scrollIntoViewIfNeeded();await page.getByRole('link',{name:'See the AI patch'}).click();await page.locator('.story-step[aria-current=step][href="#story/failed-patch"]').waitFor();
  const navigation=await page.evaluate(()=>({hash:location.hash,scrollY,focusedHeading:document.activeElement?.classList.contains('story-heading')}));assert.equal(navigation.scrollY,0);assert.equal(navigation.focusedHeading,true);record.navigation.push({width,...navigation});
  await page.close();
 }
 assert.equal(record.errors.length,0);assert.equal(record.blockedWrites.length,0);record.status='passed';
}catch(error){record.status='failed';record.failure={name:error.name,message:error.message};process.exitCode=1;}finally{await browser.close();record.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({status:record.status,failure:record.failure,taskLayouts:record.taskLayouts.length,stories:record.stories.length,navigation:record.navigation.length,errors:record.errors,blockedWrites:record.blockedWrites},null,2));}
