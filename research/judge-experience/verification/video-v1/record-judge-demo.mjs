import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, chmod, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyEvidence } from '../../../packages/orchestrator/src/evidence.ts';
import { guardRecordedResponse } from '../../../scripts/record-public-demo.ts';

const origin = 'https://patchproof.andrewmohawk.xyz';
const output = process.argv[2] ?? '/home/andrewmohawk/.config/patchproof/demo-20260927/judge-experience-01';
assert.match(output, /^\/home\/andrewmohawk\/\.config\/patchproof\/demo-20260927\/judge-experience-\d{2}$/);
assert.equal(resolve(output), output); assert.equal(await realpath(dirname(output)), dirname(output));
await mkdir(output, { mode: 0o700 }); await mkdir(join(output, 'raw'), { mode: 0o700 });
const success = '08087e0a-f5d9-4c55-b4b6-7666bc8e016c', failure = '5b356c42-8848-4e78-bce7-94800f63eebf';
const pins = { [success]: 'sha256:c2ba45e30a1526e446d5a47c7d194c65523cec18e902335f5dfa672b868bff08', [failure]: 'sha256:5a9c00d2629636f2963c63efa49ef0236876b98ac3ba7a670b684abd32e12ff8' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, data) => writeFile(join(output, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const report = { origin, startedAt: new Date().toISOString(), deployedSourceCommit: 'e15b625cce5a105c590113b6ba50eb62b5a74eb0', responseSubstitution: false, paidRequests: 0, scenes: [], captions: [], requests: [], assets: [], errors: [], status: 'started' };
const readPaths = new Set(['/', '/app.js', '/walkthrough.js', '/style.css', '/favicon.ico', '/healthz', '/tasks', '/runs']);
const runPath = /^\/runs\/[0-9a-f-]{36}(?:\/(?:events|evidence))?$/;
const get = async path => { assert.ok(readPaths.has(path) || runPath.test(path)); const res = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(30000) }); assert.equal(res.status, 200); return Buffer.from(await res.arrayBuffer()); };
let browser, context, page, video, closing = false;
try {
  const before = JSON.parse(await get('/runs')); await save('runs-before.json', before);
  for (const path of ['/', '/app.js', '/walkthrough.js', '/style.css']) report.assets.push({ path, sha256: sha(await get(path)) });
  for (const id of [success, failure]) {
    const bytes = await get(`/runs/${id}/evidence`), bundle = verifyEvidence(JSON.parse(bytes), pins[id]);
    assert.equal(bundle.run.id, id); assert.equal(bundle.mode, 'live');
    await writeFile(join(output, `evidence-${id}.json`), bytes, { mode: 0o600, flag: 'wx' });
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  report.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true,
    recordVideo: { dir: join(output, 'raw'), size: { width: 1440, height: 1000 } } });
  context.setDefaultTimeout(15000);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    const allowed = request.method() === 'GET' && url.origin === origin && !url.search && !url.username && !url.password && (readPaths.has(url.pathname) || runPath.test(url.pathname));
    report.requests.push({ method: request.method(), path: url.pathname, allowed });
    if (!allowed) report.errors.push(`Blocked ${request.method()} ${url.origin}${url.pathname}`);
    return allowed ? route.continue() : route.abort();
  });
  await context.routeWebSocket('**/*', socket => { report.errors.push('WebSocket blocked'); socket.close(); });
  page = await context.newPage(); video = page.video(); const start = performance.now();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') report.errors.push(entry.text()); });
  const cdp = await context.newCDPSession(page);
  cdp.on('Fetch.requestPaused', event => { void guardRecordedResponse(event, (method, params) => cdp.send(method, params), status => report.errors.push(`Redirect ${status} blocked`)).catch(error => { if (!closing) report.errors.push(String(error)); }); });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
  const scene = async (name, action, captions) => {
    await action(); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
    const at = Math.round(performance.now() - start); await page.screenshot({ path: join(output, `${name}.png`) });
    for (const [seconds, text] of captions) {
      const startMs = Math.round(performance.now() - start); await page.waitForTimeout(seconds * 1000);
      report.captions.push({ scene: name, text, startMs, endMs: Math.round(performance.now() - start) });
    }
    report.scenes.push({ name, startMs: at, endMs: Math.round(performance.now() - start), url: page.url() });
  };
  await page.goto(origin + '/#story/bug', { waitUntil: 'domcontentloaded' });
  await page.locator('#story[data-state="ready"]').waitFor();
  await scene('01-bug', async () => {
    assert.match(await page.locator('#story').innerText(), /second.*elm/i);
    const values = await page.locator('.story-values pre').allTextContents();
    assert.deepEqual(values.map(JSON.parse), [['elm', 'ash', 'elm', 'birch'], ['elm', 'ash', 'elm', 'birch'], ['elm', 'ash', 'birch']]);
  }, [
    [10, "You maintain a Python library. This helper should remove duplicates without changing the caller's original list."],
    [9, 'The input contains elm twice. The current output keeps both copies. The required output keeps the first elm, then ash and birch.'],
    [9, "You ask for a fix. PatchProof checks the model's proposed code, then keeps the patch and results together for your review."],
  ]);
  await scene('02-patch', async () => {
    await page.getByRole('link', { name: 'See the AI patch', exact: true }).click();
    await page.locator('#story .story-code').first().waitFor();
    for (const code of await page.locator('#story .story-code').allTextContents()) assert.match(code, /^for value in values:\n {4}if .+:\n {8}result\.append\(value\)$/);
  }, [
    [11, 'The original condition only compares with the previous item. The proposed condition checks every item already kept.'],
    [11, 'The model can edit solution.py. The check definitions stay outside that file; a separate runner tests the proposal.'],
  ]);
  await scene('03-decision', async () => {
    await page.getByRole('link', { name: 'See the check results', exact: true }).click();
    await page.locator('.story-requirements').waitFor();
    assert.match(await page.locator('#story').innerText(), /5 of 9[\s\S]*9 of 9/);
  }, [
    [11, 'Before repair, 5 of 9 checks passed. This proposal passes all 9, including unchanged input and TypeError for None.'],
    [11, 'A passing result covers the listed cases. You still inspect the full patch and decide whether to use it. Nothing is merged automatically.'],
  ]);
  await scene('04-failure', async () => {
    await page.getByRole('link', { name: 'See a repair that failed', exact: true }).click();
    await page.locator('.story-verdict').waitFor();
    assert.deepEqual((await page.locator('.story-values pre').allTextContents()).map(JSON.parse), [[[1, null], [2, 3]], [[1, 2], [null, 3]], [[1, 2], [9, 3]]]);
  }, [
    [11, 'Here is a separate repair that failed. Rows become columns, but a real null cell must stay null. The fill value is only for missing cells.'],
    [11, 'This patch still replaces null with 9. Only 11 of 13 checks pass, so it is not accepted. Later attempts had check errors.'],
  ]);
  await scene('05-evidence', async () => {
    await page.goto(origin + '/#evidence/' + success, { waitUntil: 'domcontentloaded' });
    await page.locator('.run-summary[data-context-state="ready"]').waitFor();
    await page.getByRole('tab', { name: 'Patch', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download evidence', exact: true }).click()]);
    const bytes = await readFile(await download.path()), bundle = verifyEvidence(JSON.parse(bytes), pins[success]);
    assert.equal(bundle.run.id, success); assert.equal(download.suggestedFilename(), success + '.json');
    await writeFile(join(output, 'download.json'), bytes, { mode: 0o600, flag: 'wx' }); report.download = { runId: success, bundleDigest: bundle.bundleDigest, bytes: bytes.length, sha256: sha(bytes) };
  }, [
    [8, 'The full patch stays available for human review. Download evidence saves the code change, requirements, observations and run details.'],
    [8, 'The standard repair also passed this example. These saved runs explain the workflow; they do not establish a benchmark advantage.'],
  ]);
  await scene('06-try-repair', async () => {
    await page.locator('[data-nav="tasks"]').click();
    await page.locator('.task-card[data-task-id="stable-unique-01"]').click();
    await page.getByRole('button', { name: 'Generate patch', exact: true }).waitFor();
  }, [
    [7, 'To try it yourself, choose a curated Python task and select Generate patch. It starts a new model run and checks the proposal.'],
    [7, 'Then review the patch and its results. This public demo uses curated examples; it does not accept your own repository.'],
  ]);
  const after = JSON.parse(await get('/runs')); await save('runs-after.json', after);
  const ordered = runs => [...runs].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(ordered(after.runs), ordered(before.runs));
  report.unchangedRunList = true; report.runListDigest = sha(Buffer.from(JSON.stringify(ordered(after.runs))));
  assert.deepEqual(report.errors, []); assert.ok(report.requests.every(request => request.allowed && request.method === 'GET'));
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  closing = true; await context?.close(); await browser?.close();
  if (video) { report.videoPath = await video.path(); await chmod(report.videoPath, 0o600); report.videoSha256 = sha(await readFile(report.videoPath)); }
  report.finishedAt = new Date().toISOString(); await save('report.json', report);
  console.log(JSON.stringify({ status: report.status, output, video: report.videoPath, error: report.error }));
}
