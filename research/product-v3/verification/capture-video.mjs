// Capture actual public UI scenes from a reviewed manifest. No response fixtures,
// network writes, injected product content, cuts, or accelerated playback.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyEvidence } from '../../../packages/orchestrator/src/evidence.ts';
import { guardRecordedResponse } from '../../../scripts/record-public-demo.ts';

const origin = 'https://patchproof.andrewmohawk.xyz';
const manifestBytes = await readFile(process.argv[2]);
const manifest = JSON.parse(manifestBytes);
const output = process.argv[3];
assert.match(output, /^\/home\/andrewmohawk\/\.config\/patchproof\/demo-20260927\/product-v3-[a-z0-9-]+$/);
assert.equal(resolve(output), output);
assert.equal(await realpath(dirname(output)), dirname(output));
assert.equal(await realpath(output), output);
const sha = value => createHash('sha256').update(value).digest('hex');
const narration = JSON.parse(await readFile(join(output, 'narration-index.json')));
assert.equal(narration.manifestSha256, sha(manifestBytes));
const audio = new Map(narration.segments.map(segment => [segment.id, segment]));
assert.equal(audio.size, manifest.scenes.length);
assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
await mkdir(join(output, 'raw'), { mode: 0o700 });
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const readPaths = new Set(['/', '/app.js', '/walkthrough.js', '/how-it-works.js', '/diff-view.js', '/style.css', '/favicon.ico', '/healthz', '/tasks', '/runs']);
for (const path of manifest.assetPaths) assert.ok(readPaths.has(path), `Unreviewed asset path ${path}`);
const runPath = /^\/runs\/[0-9a-f-]{36}(?:\/(?:events|evidence))?$/;
const report = { origin, sourceCommit: manifest.sourceCommit, startedAt: new Date().toISOString(),
  manifestSha256: sha(manifestBytes), responseSubstitution: false, paidRequests: 0,
  scenes: [], requests: [], assets: [], errors: [], evidenceCustody: [], status: 'started' };
const get = async path => {
  assert.ok(readPaths.has(path) || runPath.test(path));
  const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
};
let browser, context, page, video, closing = false;
try {
  const before = JSON.parse(await get('/runs'));
  await save('runs-before.json', before);
  for (const path of manifest.assetPaths) report.assets.push({ path, sha256: sha(await get(path)) });
  const pinnedBytes = new Map();
  for (const pin of manifest.evidence) {
    const bytes = await get(`/runs/${pin.id}/evidence`);
    const bundle = verifyEvidence(JSON.parse(bytes), pin.digest);
    assert.equal(bundle.run.id, pin.id); assert.equal(bundle.mode, 'live');
    pinnedBytes.set(pin.id, bytes);
    await writeFile(join(output, `evidence-${pin.id}.json`), bytes, { mode: 0o600, flag: 'wx' });
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
  const start = performance.now();
  page = await context.newPage(); video = page.video();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') report.errors.push(entry.text()); });
  const cdp = await context.newCDPSession(page);
  cdp.on('Fetch.requestPaused', event => {
    void guardRecordedResponse(event, (method, params) => cdp.send(method, params), status => report.errors.push(`Redirect ${status} blocked`))
      .catch(error => { if (!closing) report.errors.push(String(error)); });
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
  const target = action => {
    assert.ok(action.selector || (action.role && action.name));
    return action.selector ? page.locator(action.selector) : page.getByRole(action.role, { name: action.name, exact: true });
  };
  for (const scene of manifest.scenes) {
    assert.match(scene.id, /^[a-z0-9-]+$/);
    const segment = audio.get(scene.id);
    assert.equal(sha(await readFile(segment.audioPath)), segment.audioSha256);
    for (const action of scene.actions) {
      switch (action.type) {
        case 'goto':
          assert.match(action.hash, /^#[a-z0-9/-]+$/);
          await page.goto(origin + '/' + action.hash, { waitUntil: 'domcontentloaded' });
          break;
        case 'click': await target(action).click(); break;
        case 'wait': await target(action).waitFor({ state: 'visible' }); break;
        case 'scroll': await target(action).scrollIntoViewIfNeeded(); break;
        case 'top': await page.evaluate(() => window.scrollTo(0, 0)); break;
        case 'contains': assert.ok((await target(action).innerText()).includes(action.text), `Missing expected scene text: ${action.text}`); break;
        case 'download': {
          const pin = manifest.evidence.find(pin => pin.id === action.runId);
          assert.ok(pin);
          const [download] = await Promise.all([page.waitForEvent('download'), target(action).click()]);
          const bytes = await readFile(await download.path());
          const bundle = verifyEvidence(JSON.parse(bytes), pin.digest);
          assert.equal(bundle.run.id, pin.id);
          assert.equal(sha(bytes), sha(pinnedBytes.get(pin.id)));
          report.download = { id: pin.id, filename: download.suggestedFilename(), bytes: bytes.length, sha256: sha(bytes) };
          await writeFile(join(output, 'download.json'), bytes, { mode: 0o600, flag: 'wx' });
          break;
        }
        default: throw Error(`Unreviewed action ${action.type}`);
      }
    }
    await page.waitForTimeout(250);
    const startMs = Math.round(performance.now() - start);
    await page.screenshot({ path: join(output, `${scene.id}.png`) });
    await chmod(join(output, `${scene.id}.png`), 0o600);
    const narrationStartMs = Math.round(performance.now() - start) + 200;
    await page.waitForTimeout(segment.durationSeconds * 1000 + 1000);
    report.scenes.push({ id: scene.id, title: scene.title, annotation: scene.annotation,
      startMs, narrationStartMs, endMs: Math.round(performance.now() - start), url: page.url() });
  }
  // Public visitors may create other runs during capture. The shown immutable
  // evidence must remain byte-identical; unrelated additions are recorded.
  const after = JSON.parse(await get('/runs'));
  await save('runs-after.json', after);
  for (const pin of manifest.evidence) {
    const bytes = await get(`/runs/${pin.id}/evidence`);
    const unchanged = sha(bytes) === sha(pinnedBytes.get(pin.id));
    report.evidenceCustody.push({ id: pin.id, digest: pin.digest, unchanged, sha256: sha(bytes) });
    assert.ok(unchanged);
  }
  const beforeIds = new Set(before.runs.map(run => run.id));
  report.concurrentAddedRunIds = after.runs.filter(run => !beforeIds.has(run.id)).map(run => run.id);
  assert.deepEqual(report.errors, []);
  assert.ok(report.requests.every(row => row.allowed && row.method === 'GET'));
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  closing = true;
  await context?.close(); await browser?.close();
  if (video) {
    report.videoPath = await video.path(); await chmod(report.videoPath, 0o600);
    report.videoSha256 = sha(await readFile(report.videoPath));
  }
  report.finishedAt = new Date().toISOString();
  await save('capture-report.json', report);
  console.log(JSON.stringify({ status: report.status, output, video: report.videoPath, error: report.error }));
}
