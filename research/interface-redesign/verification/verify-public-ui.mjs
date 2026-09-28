import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = 'https://patchproof.andrewmohawk.xyz';
const output = resolve('research/interface-redesign/verification');
const screenshotDirectory = `${output}/public-screenshots`;
await mkdir(screenshotDirectory, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { checkedAt: new Date().toISOString(), origin, expectedRelease: process.argv[2] ?? null, access: 'GET only; new run and cancellation requests are blocked', paidRequests: 0, assets: [], layouts: [], controls: [], downloads: [], errors: [], blockedRequests: [] };
let browser;
try {
  for (const [path, source] of [['/', 'apps/web/index.html'], ['/app.js', 'apps/web/app.js'], ['/style.css', 'apps/web/style.css']]) {
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
  const successful = history.runs.find(run => run.terminalStatus === 'verified_for_declared_checks');
  const failed = history.runs.find(run => run.terminalStatus === 'failed');
  assert(successful && failed, 'Real saved successful and failed runs must exist');
  receipt.liveData = { mode: meta.mode, taskCount: meta.tasks.length, runCount: history.runs.length, success: successful.id, failure: failed.id, runtimeLockDigest: meta.runtimeLockDigest };
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
  console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, taskCount: receipt.liveData?.taskCount, runCount: receipt.liveData?.runCount, layouts: receipt.layouts.length, downloads: receipt.downloads.length, errors: receipt.errors, blockedRequests: receipt.blockedRequests }, null, 2));
}
