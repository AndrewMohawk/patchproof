import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = 'https://patchproof.andrewmohawk.xyz';
const output = resolve('research/judge-experience/verification');
const screenshotDirectory = `${output}/public-screenshots`;
await mkdir(screenshotDirectory, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { checkedAt: new Date().toISOString(), origin, expectedRelease: process.argv[2] ?? null, access: 'GET only; new run and cancellation requests are blocked', paidRequests: 0, assets: [], layouts: [], controls: [], stories: [], downloads: [], errors: [], blockedRequests: [] };
let browser;
try {
  for (const [path, source] of [['/', 'apps/web/index.html'], ['/app.js', 'apps/web/app.js'], ['/walkthrough.js', 'apps/web/walkthrough.js'], ['/style.css', 'apps/web/style.css']]) {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `HTTP ${path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const expected = await readFile(source);
    assert.equal(hash(bytes), hash(expected), `${path} must match the current redesigned source`);
    receipt.assets.push({ path, status: response.status, bytes: bytes.length, sha256: hash(bytes) });
  }
  const meta = await (await fetch(`${origin}/tasks`, { signal: AbortSignal.timeout(30000) })).json();
  const history = await (await fetch(`${origin}/runs`, { signal: AbortSignal.timeout(30000) })).json();
  assert.equal(meta.mode, 'live');
  assert.equal(meta.tasks.length, 20);
  const successful = history.runs.find(run => run.id === '08087e0a-f5d9-4c55-b4b6-7666bc8e016c' && run.terminalStatus === 'verified_for_declared_checks');
  const failed = history.runs.find(run => run.id === '5b356c42-8848-4e78-bce7-94800f63eebf' && run.terminalStatus === 'failed');
  assert(successful && failed, 'Real saved successful and failed runs must exist');
  receipt.liveData = { mode: meta.mode, taskCount: meta.tasks.length, runCount: history.runs.length, success: successful.id, failure: failed.id, runtimeLockDigest: meta.runtimeLockDigest };
  const storyEvidence = {};
  for (const [key, run] of [['success', successful], ['failure', failed]]) {
    const response = await fetch(`${origin}/runs/${run.id}/evidence`, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200); storyEvidence[key] = await response.json();
    assert.equal(storyEvidence[key].run.id, run.id); assert.equal(storyEvidence[key].mode, 'live');
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile390', 390, 844], ['mobile320', 320, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET' || url.origin !== origin) {
        receipt.blockedRequests.push({ method: request.method(), origin: url.origin, pathname: url.pathname });
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => receipt.errors.push({ name, type: 'page', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') receipt.errors.push({ name, type: 'console', message: message.text() }); });
    const inspect = async view => {
      const layout = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
      assert.equal(layout.documentWidth, width, `${name} ${view} document overflow`);
      const screenshot = `${screenshotDirectory}/${name}-${view}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      receipt.layouts.push({ name, view, ...layout, screenshot: screenshot.replace(`${process.cwd()}/`, '') });
    };
    // Begin with the actual bare public URL. A judge sees the story without choosing a task.
    await page.goto(`${origin}/`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.locator('#story[data-state=ready]').waitFor();
    assert.equal(await page.locator('#story-view').isVisible(), true);
    assert.equal(await page.locator('#tasks-view').isVisible(), false);
    assert.match(await page.locator('#story-purpose').innerText(), /Check an AI code fix before you use it/);
    assert.match(await page.locator('.story-introduction').innerText(), /developers reviewing AI-generated changes/);
    assert.match(await page.locator('.story-introduction').innerText(), /checks the model cannot edit/);
    assert.match(await page.locator('.story-introduction').innerText(), /You decide/);
    assert.equal(await page.locator('.story-step[aria-current=step]').getAttribute('href'), '#story/bug');
    await page.screenshot({ path: `${screenshotDirectory}/${name}-first-viewport.png`, fullPage: false });
    const evidenceCase = (key, checkId) => {
      const bundle = storyEvidence[key];
      const definition = bundle.fixture.visibleCases.find(item => item.id === checkId);
      const candidate = bundle.run.candidates.find(item => item.id === bundle.run.selectedCandidateId);
      const before = bundle.run.baselineChecks.visible.find(item => item.id === checkId);
      const after = candidate.visibleChecks.find(item => item.id === checkId);
      return { bundle, definition, candidate, before, after };
    };
    const list = evidenceCase('success', 'u-v-order');
    const worksheet = evidenceCase('failure', 'v-r01-null-is-data');
    const sceneValues = {
      bug: [list.definition.args[0], list.before.actual.outcome, list.definition.expected],
      patch: [list.before.actual.outcome, list.after.actual.outcome],
      failure: [worksheet.definition.args[0], worksheet.definition.expected, worksheet.after.actual.outcome],
    };
    for (const scene of ['bug', 'patch', 'decision', 'failure']) {
      if (scene !== 'bug') {
        const priorAction = scene === 'patch' ? 'See the AI patch' : scene === 'decision' ? 'See the check results' : 'See a repair that failed';
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await page.getByRole('link', { name: priorAction, exact: true }).click();
        await page.locator(`.story-step[aria-current=step][href="#story/${scene}"]`).waitFor();
        assert.equal(await page.evaluate(() => scrollY), 0, `${name} ${scene} navigation resets scroll`);
        assert.equal(await page.evaluate(() => document.activeElement.className), 'story-heading');
      }
      await page.locator('#story[data-state=ready]').waitFor();
      assert.match(await page.locator('.story-meta').innerText(), /Saved real repair.*No new model calls/);
      await inspect(`story-${scene}`);
      const action = await page.locator('.story-actions .button.primary').boundingBox();
      assert(action && action.height >= 44);
      if (width < 800) assert(action.y >= 0 && action.y + action.height <= height, `${name} ${scene} visible next action`);
      const story = { name, scene, action };
      if (sceneValues[scene]) {
        const displayed = await page.locator('.story-values .value-card pre').evaluateAll(nodes => nodes.map(element => JSON.parse(element.textContent)));
        assert.deepEqual(displayed, sceneValues[scene], `${name} ${scene} observed values match actual saved evidence`);
        story.values = displayed;
      }
      if (scene === 'bug') {
        const bounds = await page.locator('.value-card').evaluateAll(nodes => nodes.map(element => ({ label: element.querySelector('h3').textContent, bottom: element.getBoundingClientRect().bottom })));
        const actionBarTop = width < 800 ? height - await page.locator('.story-actions').evaluate(element => Number.parseFloat(getComputedStyle(element, '::before').height)) : height;
        assert(bounds.every(box => box.bottom <= actionBarTop), `${name} first screen shows complete input and outputs above navigation`);
        story.valueBounds = bounds;
      }
      if (scene === 'patch') {
        const code = await page.locator('pre.story-code').allTextContents();
        assert.deepEqual(code, ['for value in values:\n    if not result or value != result[-1]:\n        result.append(value)', 'for value in values:\n    if value not in result:\n        result.append(value)']);
        story.pythonIndentationPreserved = true;
        const declaration = await page.locator('.story-explanation').innerText();
        assert.match(declaration, /outside the files the model may edit/);
        assert.match(declaration, /explanation does not decide/);
      }
      if (scene === 'decision') {
        const original = [...list.bundle.run.baselineChecks.visible, ...list.bundle.run.baselineChecks.acceptance];
        const selected = [...list.candidate.visibleChecks, ...list.candidate.acceptanceChecks];
        const totals = { before: original.filter(check => check.status === 'pass').length, after: selected.filter(check => check.status === 'pass').length, total: selected.length };
        assert.deepEqual(totals, { before: 5, after: 9, total: 9 });
        assert.match(await page.locator('.story-lead').innerText(), /original code passed 5 of 9.*patch passed 9 of 9/);
        assert.deepEqual(await page.locator('.story-requirements > div > p').allTextContents(), ['5 of 5 checks passed', '2 of 2 checks passed', '2 of 2 checks passed']);
        assert.match(await page.locator('.story-explanation').last().innerText(), /Nothing is merged automatically/);
        story.checkTotals = totals;
      }
      if (scene === 'failure') {
        assert.match(await page.locator('.story-kicker').innerText(), /A separate example/);
        assert.match(await page.locator('.story-verdict.bad').innerText(), /11 of 13 checks passed.*not approved/s);
        assert.match(await page.locator('.story-verdict').innerText(), /Later attempts produced execution errors/);
        story.failureIsSeparateAndUnapproved = true;
      }
      receipt.stories.push(story);
    }
    await page.getByRole('link', { name: 'Try a repair', exact: true }).click();
    await page.locator('#story-view').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#tasks-view').isVisible(), true);
    assert.match(await page.locator('#workspace-intro').innerText(), /Generate patch asks the live model/);
    receipt.controls.push({ name, storyToWorkbench: true });

    await page.goto(`${origin}/#tasks`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.getByRole('button', { name: 'Generate patch', exact: true }).waitFor();
    await inspect('examples');
    const action = await page.getByRole('button', { name: 'Generate patch', exact: true }).boundingBox();
    assert(action && action.y + action.height <= height && action.height >= 44);
    receipt.controls.push({ name, action });
    if (width === 1440) {
      assert.equal(await page.locator('.task-card').count(), 20);
      await page.getByRole('searchbox', { name: 'Search examples' }).fill('worksheet');
      assert.equal(await page.locator('.task-card').count(), 5);
      await page.locator('.task-card').first().click();
      assert.match(await page.locator('.task-card[aria-pressed=true]').innerText(), /worksheet/i);
      await page.getByRole('searchbox', { name: 'Search examples' }).fill('');
      assert.equal(await page.locator('.task-card').count(), 20);
      receipt.controls.push({ name, search: 'worksheet', matches: 5, clearRestores: 20 });
    } else {
      const ids = await page.locator('#mobile-task option').evaluateAll(options => options.map(option => option.value));
      assert.equal(ids.length, 20);
      const positions = [];
      for (const taskId of ids) {
        await page.locator('#mobile-task').selectOption(taskId);
        const box = await page.getByRole('button', { name: 'Generate patch', exact: true }).boundingBox();
        assert(box && box.y + box.height <= height, `${name} ${taskId} action below fold`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        positions.push({ taskId, bottom: box.y + box.height });
      }
      receipt.controls.push({ name, allExamples: positions, pickerHeight: (await page.locator('#mobile-task').boundingBox()).height });
    }
    await page.getByRole('link', { name: 'Runs', exact: true }).click();
    assert.equal(await page.locator('.history-row').count(), history.runs.length);
    await inspect('runs');
    for (const [status, run, defaultTab] of [['success', successful, 'Patch'], ['failure', failed, 'Checks']]) {
      await page.goto(`${origin}/#evidence/${run.id}`, { waitUntil: 'networkidle' });
      await page.locator('.run-summary[data-context-state=ready]').waitFor();
      assert.equal(await page.locator('[role=tab][aria-selected=true]').innerText(), defaultTab);
      await inspect(`${status}-${defaultTab.toLowerCase()}`);
      for (const tab of ['Patch', 'Checks', 'Activity', 'Run details']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        assert.equal(await page.locator('[role=tabpanel]:visible').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${name} ${status} ${tab} overflow`);
      }
      await page.getByRole('tab', { name: 'Patch', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('[role=tab][aria-selected=true]').innerText(), 'Checks');
      const outline = await page.evaluate(() => ({ width: getComputedStyle(document.activeElement).outlineWidth, style: getComputedStyle(document.activeElement).outlineStyle }));
      assert.deepEqual(outline, { width: '3px', style: 'solid' });
      if (width === 1440) {
        const downloaded = page.waitForEvent('download');
        await page.getByRole('link', { name: 'Download evidence', exact: true }).click();
        const download = await downloaded;
        const data = await readFile(await download.path());
        const bundle = JSON.parse(data.toString('utf8'));
        assert.equal(bundle.run.id, run.id);
        assert.equal(bundle.mode, 'live');
        const sameBytes = Buffer.from(await (await fetch(`${origin}/runs/${run.id}/evidence`, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
        assert.equal(hash(data), hash(sameBytes));
        receipt.downloads.push({ runId: run.id, status, bytes: data.length, sha256: hash(data), bundleDigest: bundle.bundleDigest, matchesDirectPublicDownload: true });
      }
      await page.getByRole('link', { name: 'Compare approaches', exact: true }).first().click();
      assert.equal(await page.locator('#compare-task').inputValue(), run.taskId, 'Comparison should preserve the reviewed run task');
      await inspect(`${status}-comparison`);
    }
    await context.close();
  }
  assert.equal(receipt.blockedRequests.length, 0, 'No attempted writes or external requests');
  assert.equal(receipt.errors.length, 0, 'No browser errors');
  receipt.status = 'pass';
} catch (error) {
  receipt.status = 'fail';
  receipt.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  await browser?.close();
  receipt.finishedAt = new Date().toISOString();
  await writeFile(`${output}/public-browser-receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, taskCount: receipt.liveData?.taskCount, runCount: receipt.liveData?.runCount, layouts: receipt.layouts.length, stories: receipt.stories.length, downloads: receipt.downloads.length, errors: receipt.errors, blockedRequests: receipt.blockedRequests }, null, 2));
}
