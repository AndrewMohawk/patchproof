import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { chromium } from 'playwright';
import { guardRecordedResponse } from '../../../../scripts/record-public-demo.ts';
import { verifyEvidence } from '../../../../packages/orchestrator/src/evidence.ts';
import { digestJson } from '../../../../packages/contracts/src/digest.ts';

const origin = 'https://patchproof.andrewmohawk.xyz';
const output = '/home/andrewmohawk/.config/patchproof/demo-20260927/live-final-read-only-01';
const publicDirectory = dirname(fileURLToPath(import.meta.url));
const primaryId = '08087e0a-f5d9-4c55-b4b6-7666bc8e016c';
const ids = ['d11aa1fc-61ee-4b42-a89e-df6b385e4f1d', '9943a027-4d6c-4f4b-94bb-d1ed4664b2f1', primaryId];
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { mode: 0o700 });
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const report = { startedAt: new Date().toISOString(), origin, output, primaryId, runIds: ids,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  recorderDigest: sha(await readFile(fileURLToPath(import.meta.url))), scope: 'GET-only observation of existing real model / local Docker evidence. No responses or DOM are substituted.',
  status: 'running', scenes: [], requests: [], blocked: [], errors: [], navigationRetries: [], bundles: [], screenshots: [] };
let browser, context, video, videoPath, videoStart = 0, closing = false;
const guards = new Set();
const bundles = new Map();
async function get(path, name) {
  const response = await fetch(origin + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, path); const bytes = Buffer.from(await response.arrayBuffer());
  if (name) await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  return { value: JSON.parse(bytes), bytes };
}
async function installReadOnly(ctx, page) {
  await ctx.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const allowed = req.method() === 'GET' && url.origin === origin && !url.search &&
      (['/', '/app.js', '/style.css', '/favicon.ico', '/tasks', '/runs', '/healthz'].includes(url.pathname) || /^\/runs\/[0-9a-f-]{36}(?:\/(?:events|evidence))?$/.test(url.pathname));
    report.requests.push({ method: req.method(), url: req.url(), allowed });
    if (!allowed) { report.blocked.push({ method: req.method(), url: req.url() }); await route.abort('blockedbyclient'); return; }
    await route.continue();
  });
  await ctx.routeWebSocket('**/*', socket => { report.blocked.push({ kind: 'websocket' }); socket.close(); });
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Fetch.requestPaused', event => {
    const job = guardRecordedResponse(event, (method, params) => cdp.send(method, params), status => report.errors.push({ kind: 'redirect', status }))
      .catch(error => { if (!closing) report.errors.push({ kind: 'redirect_guard', message: String(error) }); });
    guards.add(job); void job.finally(() => guards.delete(job));
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
  page.on('pageerror', error => report.errors.push({ kind: 'pageerror', message: String(error) }));
  page.on('console', entry => { if (entry.type() === 'error') report.errors.push({ kind: 'console', message: entry.text() }); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push({ kind: 'http', status: response.status(), url: response.url() }); });
  page.setDefaultTimeout(10000);
}
async function retry(label, action) {
  for (let n = 0; n < 3; n++) {
    try { return await action(); } catch (error) {
      report.navigationRetries.push({ label, attempt: n + 1, error: String(error) });
      if (n === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
}
async function shot(page, name, fullPage = false) {
  await retry('screenshot ' + name, () => page.screenshot({ path: join(output, name), fullPage }));
  await chmod(join(output, name), 0o600); const bytes = await readFile(join(output, name));
  report.screenshots.push({ name, digest: sha(bytes), bytes: bytes.length, viewport: page.viewportSize() });
}
async function scene(page, title, caption, action) {
  await retry(title, action); await page.waitForTimeout(500);
  const startMs = Math.round(performance.now() - videoStart);
  await shot(page, String(report.scenes.length + 1).padStart(2, '0') + '-' + title + '.png');
  await page.waitForTimeout(8000);
  report.scenes.push({ title, caption, startMs, endMs: Math.round(performance.now() - videoStart) });
}
async function evidence(page, id) {
  await page.goto(origin + '/#evidence/' + id, { waitUntil: 'domcontentloaded' });
  await page.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.equal(await page.locator('#evidence-run').inputValue(), id);
  await page.waitForTimeout(700);
}
const timer = setTimeout(() => { report.errors.push({ kind: 'watchdog' }); void context?.close(); }, 150000);
try {
  const meta = (await get('/tasks', 'catalogue-before.json')).value;
  const history = (await get('/runs', 'history-before.json')).value;
  for (const id of ids) {
    const observed = history.runs.find(run => run.id === id); assert.ok(observed); assert.equal(observed.phase, 'terminal');
    const exported = await get('/runs/' + id + '/evidence', 'evidence-' + id + '.json');
    const bundle = verifyEvidence(exported.value); assert.equal(digestJson(bundle.run), digestJson(observed));
    assert.equal(bundle.mode, 'live'); assert.equal(bundle.run.runtimeLockDigest, meta.runtimeLockDigest); bundles.set(id, bundle);
    report.bundles.push({ id, variant: bundle.run.variant, terminalStatus: bundle.run.terminalStatus, bundleDigest: bundle.bundleDigest,
      fileDigest: sha(exported.bytes), sourceDigest: bundle.run.sourceDigest, policyDigest: bundle.run.policyDigest,
      runtimeLockDigest: bundle.run.runtimeLockDigest, usage: bundle.run.usage, candidateCount: bundle.run.candidates.length, selectedCandidateId: bundle.run.selectedCandidateId });
  }
  const signature = run => digestJson([run.taskId, run.schemaVersion, run.mode, run.sourceDigest, run.policyDigest, run.runtimeLockDigest, run.limits]);
  assert.equal(new Set([...bundles.values()].map(bundle => signature(bundle.run))).size, 1);
  const primary = bundles.get(primaryId).run; report.runtimeLockDigest = primary.runtimeLockDigest;
  report.initialAvailability = meta.availability; report.initialHistoryIds = history.runs.map(run => run.id);
  await mkdir(join(output, 'raw-video'), { mode: 0o700 });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); report.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true,
    recordVideo: { dir: join(output, 'raw-video'), size: { width: 1440, height: 1000 } } });
  const page = await context.newPage(); video = page.video(); videoStart = performance.now(); await installReadOnly(context, page);
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.locator('.task-card[data-task-id="stable-unique-01"]').waitFor();
  await scene(page, 'task', 'Recorded evidence from real Nebius Token Factory inference. Declared checks ran in isolated local Docker containers.', async () => {
    await page.locator('.task-card[data-task-id="stable-unique-01"]').click(); await page.locator('#task-detail').scrollIntoViewIfNeeded();
  });
  await scene(page, 'comparison', 'All three approaches passed the declared checks. They share this task, source, policy, runtime and resource limits; this is not a benchmark.', async () => {
    await page.locator('[data-nav="compare"]').click(); await page.locator('#compare-task').selectOption('stable-unique-01');
    await page.getByText('MATCHED CONTEXT', { exact: true }).waitFor();
    for (const id of ids) assert.equal(await page.locator(`.variant-card a[href="#evidence/${id}"]`).count(), 1);
    await page.locator('#comparison').scrollIntoViewIfNeeded();
  });
  await scene(page, 'patchproof-result', `PatchProof passed on its first candidate. This completed run used ${primary.usage.inferenceCalls} model call and took ${(primary.usage.elapsedMs / 1000).toFixed(3)} seconds.`, async () => {
    await evidence(page, primaryId); await page.locator('.run-summary').scrollIntoViewIfNeeded();
  });
  await scene(page, 'selected-diff', 'Inspect the selected change against the original snapshot. A passing check result supports review; it does not replace your judgment.', async () => {
    await page.getByRole('button', { name: new RegExp(`^Candidate ${primary.selectedCandidateId} ·`) }).click(); await page.locator('.diff').first().scrollIntoViewIfNeeded();
  });
  await scene(page, 'acceptance-evidence', 'All nine declared checks pass. Expanded logs preserve expected values, actual observations and repeated-check agreement.', async () => {
    const group = page.locator('.checks-group').filter({ has: page.getByRole('heading', { name: 'Independent runtime acceptance checks', exact: true }) });
    await group.getByText(/^Observed result and log ·/).first().click(); await group.scrollIntoViewIfNeeded();
  });
  await scene(page, 'baseline-rejection', 'Ordinary repair first returned an unchanged candidate that failed four checks. Its second candidate passed. The rejection remains inspectable.', async () => {
    await evidence(page, ids[0]); await page.getByRole('button', { name: /^Candidate 1 ·/ }).click(); await page.locator('.failure-card').last().scrollIntoViewIfNeeded();
  });
  await scene(page, 'resource-accounting', 'Token usage and estimated provider cost remain visible. Authoritative billing and measured sandbox CPU are unavailable; they are not shown as zero.', async () => {
    await evidence(page, primaryId); await page.getByRole('heading', { name: 'Resource accounting', exact: true }).scrollIntoViewIfNeeded();
  });
  await scene(page, 'export', 'Download the preserved run, patch, checks and provenance. Explore the real public app at patchproof.andrewmohawk.xyz; no new run is started in this walkthrough.', async () => {
    await page.locator('.run-summary').scrollIntoViewIfNeeded();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download evidence ↓', exact: true }).click()]);
    const path = await download.path(); assert.ok(path); const bytes = await readFile(path);
    const bundle = verifyEvidence(JSON.parse(bytes)); assert.equal(bundle.bundleDigest, bundles.get(primaryId).bundleDigest);
    await writeFile(join(output, 'downloaded-evidence.json'), bytes, { flag: 'wx', mode: 0o600 }); report.downloadDigest = sha(bytes);
  });
  closing = true; await context.close(); context = undefined; await Promise.allSettled([...guards]); videoPath = await video.path(); await chmod(videoPath, 0o600);
  report.videoPath = videoPath; report.videoDigest = sha(await readFile(videoPath));
  report.video = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', videoPath], { encoding: 'utf8' }));
  assert.ok(Number(report.video.format.duration) <= 170); report.timingBasis = 'Scene times are observed monotonic milliseconds since recording page creation. Encoded media duration is independently measured; no frame-exact alignment is asserted.';
  closing = false; context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const mobile = await context.newPage(); await installReadOnly(context, mobile);
  report.mobile = [];
  for (const width of [390, 320]) {
    await mobile.setViewportSize({ width, height: 844 }); await evidence(mobile, primaryId);
    assert.match(await mobile.locator('.run-summary').innerText(), /RECORDED LIVE · LOCAL DOCKER CHECKS/);
    assert.match(await mobile.locator('.run-summary .outcome').innerText(), /Passes declared checks/);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await shot(mobile, `mobile-${width}-terminal.png`, true); report.mobile.push({ width, noHorizontalOverflow: true, terminalStatus: primary.terminalStatus });
  }
  closing = true; await context.close(); context = undefined; await browser.close(); browser = undefined; await Promise.allSettled([...guards]);
  const after = (await get('/runs', 'history-after.json')).value;
  for (const id of ids) assert.equal(digestJson(after.runs.find(run => run.id === id)), digestJson(bundles.get(id).run));
  assert.equal(report.blocked.length, 0); assert.deepEqual(report.errors, []); assert.ok(report.requests.every(req => req.method === 'GET'));
  report.status = 'captured';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); process.exitCode = 1; }
finally {
  clearTimeout(timer); closing = true; await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await Promise.allSettled([...guards]);
  if (!videoPath && video) { videoPath = await video.path().catch(() => null); report.videoPath = videoPath; }
  const stamp = ms => new Date(ms).toISOString().slice(11, 23).replace('.', ',');
  const srt = report.scenes.map((scene, index) => `${index + 1}\n${stamp(scene.startMs)} --> ${stamp(scene.endMs)}\n${scene.caption}\n`).join('\n');
  await writeFile(join(output, 'captions.srt'), srt, { flag: 'wx', mode: 0o600 }); await save('scenes.json', report.scenes);
  report.finishedAt = new Date().toISOString(); report.executionPerformed = false; report.responseSubstitution = false; report.rawVideoUnedited = true;
  await save('report.json', report); await writeFile(join(publicDirectory, 'capture-receipt.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, output, videoPath, scenes: report.scenes.length, failure: report.failure ?? null }, null, 2));
}
