import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const catalogue = JSON.parse(await readFile(new URL('./catalogue.json', import.meta.url), 'utf8'));
const server = JSON.parse(await readFile(new URL('./server.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [], requests = [], checked = [];
let report;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  page.on('request', r => requests.push({ method: r.method(), url: r.url() }));
  await page.goto(server.base, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-task-id="stable-unique-01"]').waitFor();
  assert.equal(await page.locator('#task-count').innerText(), '30 available');
  assert.equal(await page.locator('.task-card').count(), 30);
  for (const task of catalogue) {
    await page.locator(`[data-task-id="${task.id}"]`).click();
    assert.equal(await page.locator('#task-detail h2').innerText(), task.title);
    assert.equal(await page.locator('#task-detail .task-description').innerText(), task.description);
    assert.deepEqual(await page.locator('#task-detail .requirements li').evaluateAll(rows => rows.map(row => ({
      id: row.children[0].textContent, text: row.children[1].textContent,
    }))), task.requirements);
    assert.equal(await page.locator('[data-task-id][aria-pressed="true"]').getAttribute('data-task-id'), task.id);
    assert.equal(await page.locator('#task-detail').getByRole('button', { name: 'Run PatchProof →', exact: true }).isEnabled(), task.mockSupported);
    assert.equal(await page.locator('#task-detail').getByRole('button', { name: 'Compare all three', exact: true }).isEnabled(), task.mockSupported);
    assert.equal(await page.locator('#compare-run').isEnabled(), task.mockSupported);
    assert.match(await page.locator('#task-detail .allowance').innerText(), task.mockSupported ? /Mock model · Local checks/ : /Requires connected model/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    checked.push(task.id);
  }
  await page.locator('[data-task-id="stable-unique-01"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#task-detail h2').innerText(), catalogue.find(t => t.id === 'stable-unique-01').title);
  await page.locator('#task-detail').scrollIntoViewIfNeeded();
  await page.screenshot({ path: new URL('./desktop.png', import.meta.url).pathname, fullPage: true });
  const longest = [...catalogue].sort((a, b) => b.requirements.reduce((n, r) => n + r.text.length, 0) - a.requirements.reduce((n, r) => n + r.text.length, 0))[0];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`[data-task-id="${longest.id}"]`).click();
  await page.locator('#task-detail').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.equal(await page.locator('#task-detail h2').innerText(), longest.title);
  await page.screenshot({ path: new URL('./mobile.png', import.meta.url).pathname, fullPage: true });
  assert.deepEqual(errors, []);
  assert.ok(requests.every(r => r.method === 'GET'));
  assert.ok(requests.every(r => ['/','/tasks','/runs','/app.js','/style.css','/favicon.ico'].includes(new URL(r.url).pathname)));
  report = { status: 'passed', scope: 'Provisional authorized public catalogue with actual queued UI assets and inert GET-only HTTP metadata',
    manifestDigest: 'sha256:6d46f5a9bcc7f418e5284f1c622a405cc81887f55d6c03241149bd2d81bc3138',
    clientCommit: server.clientCommit, appDigest: server.appDigest, browserVersion: browser.version(), checkedTasks: checked,
    controls: ['All 30 task titles, descriptions and every requirement retain exact metadata text', 'Only stable-unique mock launch/comparison controls enabled',
      'All 29 unsupported tasks visibly require connected model', 'Task keyboard selection works', 'Desktop and 390px mobile have no horizontal overflow',
      'All requests GET-only; no run, event or evidence dispatch', 'No browser page or console errors'],
    longestRequirementTask: longest.id, requests, errors,
    notRun: ['Candidates', 'Docker', 'Providers', 'Replay', 'Actual application coordinator', 'Final corpus validation'] };
} finally { await browser.close(); }
await writeFile(new URL('./browser-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
