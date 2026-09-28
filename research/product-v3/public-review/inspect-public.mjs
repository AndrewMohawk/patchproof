import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin='https://patchproof.andrewmohawk.xyz';
const out='research/product-v3/public-review';
const screenshots='/tmp/patchproof-v3-public-review';
await mkdir(out,{recursive:true});await mkdir(screenshots,{recursive:true});
const json=async path=>{const response=await fetch(origin+path);assert.equal(response.status,200,path);return response.json();};
const tasks=await json('/tasks');
const history=await json('/runs');
const receipt={checkedAt:new Date().toISOString(),origin,requestedRelease:'b663723',access:'GET only; no paid calls or run cancellation',taskCount:tasks.tasks.length,initialAvailability:tasks.availability,initialRuns:history.runs.map(r=>({id:r.id,taskId:r.taskId,phase:r.phase,status:r.terminalStatus})),assets:[],tasks:[],layouts:[],story:[],diff:{},errors:[],blocked:[]};
assert.equal(tasks.tasks.length,10);assert(tasks.tasks.every(t=>t.id.startsWith('v3-')));
for(const path of ['/','/app.js','/walkthrough.js','/diff-view.js','/style.css']){const response=await fetch(origin+path);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);receipt.assets.push({path,status:response.status,sha256:createHash('sha256').update(bytes).digest('hex')});}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 for(const width of[1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===1440?1000:844}});
  page.on('pageerror',e=>receipt.errors.push({width,message:e.message}));page.on('console',m=>{if(m.type()==='error')receipt.errors.push({width,message:m.text()});});
  await page.route('**/*',r=>{if(r.request().method()!=='GET'){receipt.blocked.push(r.request().method());return r.abort();}return r.continue();});
  const shot=async name=>{const bounds=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.equal(bounds.width,bounds.documentWidth,name);await page.screenshot({path:`${screenshots}/${width}-${name}.png`,fullPage:true});receipt.layouts.push({width,name,...bounds,screenshot:`${screenshots}/${width}-${name}.png`});};
  await page.goto(origin+'/#tasks',{waitUntil:'domcontentloaded'});await page.locator('.source-code').waitFor();
  for(const task of tasks.tasks){
   if(width===1440)await page.locator(`.task-card[data-task-id="${task.id}"]`).click();else await page.locator('#mobile-task').selectOption(task.id);
   await page.waitForFunction(title=>document.querySelector('.task-intro h2')?.textContent===title,task.title);
   const rendered=await page.locator('.source-line-text').allTextContents();const file=Object.keys(task.files)[0];const expected=task.files[file].split('\n');if(expected.at(-1)==='')expected.pop();
   assert.deepEqual(rendered.map(s=>s.trim()?s:''),expected.map(s=>s.trim()?s:''),`${task.id} exact source`);
   const count=await page.locator('#task-example option').count();assert.equal(count,task.examples.length);assert(count>0);
   const examples=[];
   for(let i=0;i<count;i++){await page.locator('#task-example').selectOption(String(i));const call=await page.locator('.task-example-values .example-value').first().innerText();const goal=await page.locator('.task-example-values .example-value').last().innerText();assert(call.includes(task.examples[i].function+'('));assert(goal.startsWith(task.examples[i].expectedException||task.examples[i].expectError?'Required exception':'Required return value'));examples.push({id:task.examples[i].id,function:task.examples[i].function,callLength:call.length,goalLength:goal.length});}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   receipt.tasks.push({width,id:task.id,file,lineCount:expected.length,exactSource:true,exampleCount:count,examples});
  }
  if(width===1440)await page.locator(`.task-card[data-task-id="${tasks.tasks[0].id}"]`).click();else await page.locator('#mobile-task').selectOption(tasks.tasks[0].id);
  await shot('tasks-inspected');
  await page.goto(origin+'/#how-it-works',{waitUntil:'domcontentloaded'});await page.locator('#how-runtime-description').filter({hasText:'Nebius'}).waitFor();
  assert.equal(await page.locator('.workflow-map li').count(),5);assert.equal(await page.locator('.how-section').count(),6);assert.match(await page.locator('#how-it-works-view').innerText(),/does not mean a second model votes/);await shot('how-inspected');
  for(const prefix of['','failed-'])for(const stage of['bug','patch','checks','decision']){
   const route=prefix+stage;await page.goto(origin+'/#story/'+route,{waitUntil:'domcontentloaded'});await page.locator('#story[data-state=ready]').waitFor();await page.locator(`.story-step[aria-current=step][href="#story/${route}"]`).waitFor();assert.equal(await page.locator('.story-step').count(),4);
   const heading=await page.locator('.story-heading').innerText();const primary=await page.locator('.story-actions .primary').boundingBox();
   const current=await page.locator('.story-step[aria-current=step]').evaluate(e=>{const box=e.getBoundingClientRect(),bar=e.parentElement.getBoundingClientRect();return{text:e.textContent,left:box.left,right:box.right,barLeft:bar.left,barRight:bar.right,fullyVisible:box.left>=bar.left&&box.right<=bar.right};});
   const values=await page.locator('.story-values pre').allTextContents();
   if(stage==='bug'){assert(await page.locator('.story-source').count());assert.match(await page.locator('.story-explanation').first().innerText(),/The goal/);}
   if(stage==='patch'){
    assert(await page.locator('.github-diff-file').count());assert(await page.locator('.diff-number').count());
    if(!prefix){const row=page.locator('.github-diff-row').filter({hasText:'def unique(values):'});assert.equal(await row.count(),1);assert.match(await row.getAttribute('class'),/context/);receipt.diff.functionDefinitionIsContext=true;receipt.diff.definitionGutters=await row.locator('.diff-number').allTextContents();}
    else{const folds=page.getByRole('button',{name:/Show \d+ unchanged lines/});const foldCount=await folds.count();if(foldCount){const before=await page.locator('.github-diff-row').count();await folds.first().click();const after=await page.locator('.github-diff-row').count();assert(after>before);receipt.diff.foldExpansion={before,after};}}
   }
   if(prefix&&stage==='decision'){const attempts=await page.locator('.story-attempts tbody tr').allTextContents();assert.equal(attempts.length,3);assert(attempts[0].includes('11/13 passed'));assert(attempts[1].includes('13 errors'));assert(attempts[2].includes('13 errors'));assert.match(await page.locator('.story-verdict').innerText(),/do not use this as a completed fix/);receipt.failedAttempts=attempts;}
   await shot('story-'+route);receipt.story.push({width,route,heading,values,primary,currentStep:current});
  }
  await page.close();
 }
 assert.equal(receipt.errors.length,0);assert.equal(receipt.blocked.length,0);receipt.status='functional-checks-passed';
}catch(error){receipt.status='failed';receipt.failure={name:error.name,message:error.message};process.exitCode=1;}finally{await browser.close();receipt.finishedAt=new Date().toISOString();await writeFile(out+'/receipt.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,failure:receipt.failure,tasks:receipt.tasks.length,layouts:receipt.layouts.length,storyStages:receipt.story.length,errors:receipt.errors,blocked:receipt.blocked},null,2));}
