import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

// Read-only browser verification. No model calls, no response substitution.
const origin = new URL(process.argv[2] ?? 'https://patchproof.andrewmohawk.xyz').origin;
assert.ok(/^https:\/\/patchproof(?:\.lab)?\.andrewmohawk\.xyz$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const output = resolve(process.argv[3] ?? '/tmp/patchproof-briefing-v3');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
const errors = [], blocked = [], observations = [];
await context.route('**/*', async route => {
  const request = route.request();
  if (new URL(request.url()).origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
    blocked.push({ method: request.method(), url: request.url() }); await route.abort();
  } else await route.continue();
});
try {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  const catalogue = await (await page.request.get(`${origin}/tasks`)).json();
  assert.ok(catalogue.tasks.length > 0);
  await page.goto(`${origin}/#tasks`, { waitUntil: 'domcontentloaded' });
  await page.locator('.task-card').first().waitFor();
  for (const task of catalogue.tasks) {
    assert.match(task.id, /^[a-zA-Z0-9_-]+$/);
    const picker = page.locator(`.task-card[data-task-id="${task.id}"]`);
    await picker.click();
    for (const [path, content] of Object.entries(task.files ?? {})) {
      await page.getByRole('tab', { name: path, exact: true }).click();
      const actual = await page.locator('.source-line-text').allTextContents();
      const expected = content.split('\n'); if (content.endsWith('\n')) expected.pop();
      assert.deepEqual(actual, expected.map(line => line || ' '), `${task.id}/${path} must match catalogue source exactly.`);
    }
    const examples = await page.locator('#task-example option').count();
    assert.equal(examples, task.examples?.length ?? 0);
    if (examples) {
      await page.selectOption('#task-example', String(examples - 1));
      assert.match(await page.locator('.task-example-section').innerText(), /Required (?:return value|exception)/);
      await page.selectOption('#task-example', '0');
    }
    observations.push({ task: task.id, files: Object.keys(task.files ?? {}).length, examples });
  }
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(`${origin}/#tasks`, { waitUntil: 'domcontentloaded' });
    await page.locator('.source-code').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(output, `briefing-${width}.png`), fullPage: true });
    await page.locator('[data-nav="how-it-works"]').click();
    assert.equal(await page.locator('.workflow-map li').count(), 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(output, `how-it-works-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ status: 'passed', origin, mode: catalogue.mode, taskCount: observations.length, observations, widths: [1440,390,320], browserErrors: errors, blockedRequests: blocked, generatedRuns: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', output, taskCount: observations.length }));
} finally { await context.close(); await browser.close(); }
