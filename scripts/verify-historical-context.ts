import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import type { ProductRun } from '../packages/contracts/src/product.ts';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { fixtureDigests, publicTask } from '../packages/orchestrator/src/fixtures.ts';
import { buildEvidence, verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { syntheticArchiveBundle } from '../tests/helpers/archive-fixture.ts';

// Actual application assets and a GET-only loopback metadata fixture. No coordinator,
// provider, sandbox, candidate interpreter, public catalogue, or evaluator corpus runs.
const original = syntheticArchiveBundle('mock', '2.1', 'baseline');
const oldFixture = { ...original.fixture, title: 'Archived task statement',
  requirements: [{ id: 'R01', text: 'Archived requirement text from the saved run.' }] };
const oldRun = { ...original.run, ...fixtureDigests(oldFixture, '2.1') };
const oldBundle = verifyEvidence(buildEvidence(oldRun, oldFixture, original.runtimeLock));
const oldBytes = Buffer.from(JSON.stringify(oldBundle, null, 2) + '\n');
const currentFixture = { ...oldFixture, title: 'Replacement catalogue statement', requirements: [
  { id: 'R01', text: 'Replacement requirement text must never label the old run.' },
  { id: 'R02', text: 'Second replacement requirement absent from the old run.' },
] };
const currentRun: ProductRun = { ...structuredClone(oldRun), schemaVersion: '2.2', id: randomUUID(), variant: 'patchproof',
  createdAt: '2026-09-27T00:00:02.000Z', finishedAt: '2026-09-27T00:00:03.000Z',
  events: [{ ...oldRun.events[0]!, timestamp: '2026-09-27T00:00:03.000Z' }], ...fixtureDigests(currentFixture, '2.2'), coverage: [
    ...oldRun.coverage, { requirementId: 'R02', status: 'unverified', checkIds: [] },
  ] };
const currentBundle = verifyEvidence(buildEvidence(currentRun, currentFixture, original.runtimeLock));
const currentBytes = Buffer.from(JSON.stringify(currentBundle, null, 2) + '\n');
const changedVersion = verifyEvidence(buildEvidence({ ...oldRun, schemaVersion: '2.2' }, oldFixture, original.runtimeLock));
const capabilities = { createRuns: false, cancelRuns: false, replay: false, streamEvents: false };
type Scenario = 'delayed' | 'ready' | 'missing' | 'wrong-run' | 'wrong-version' | 'active-matched' | 'active-mismatched';
let scenario: Scenario = 'delayed';
let releaseOld: () => void = () => {};
const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
const methods: string[] = [], evidenceRequests: string[] = [], unexpectedRequests: string[] = [];
const assetEntries = await Promise.all([
  ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/walkthrough.js', 'walkthrough.js', 'text/javascript'], ['/diff-view.js', 'diff-view.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'],
].map(async ([path, file, type]) => [path!, { bytes: await readFile(new URL(`../apps/web/${file}`, import.meta.url)), type: type! }] as const));
const assets = new Map(assetEntries);
const activeRun = (matches: boolean): ProductRun => ({ ...structuredClone(currentRun), phase: 'check', terminalStatus: null,
  finishedAt: null, reason: null, policyDigest: matches ? currentRun.policyDigest : oldRun.policyDigest,
  events: [{ sequence: 1, timestamp: '2026-09-27T00:00:02.000Z', phase: 'check', message: 'Inert active metadata; no work exists.' }] });
const isActive = () => scenario === 'active-matched' || scenario === 'active-mismatched';
const server = createServer(async (req, res) => {
  methods.push(req.method ?? 'UNKNOWN');
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.method !== 'GET') { req.resume(); json({ error: { message: 'Read-only synthetic fixture.' } }, 405); return; }
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const asset = assets.get(path);
  if (asset) { res.writeHead(200, { 'Content-Type': asset.type }); res.end(asset.bytes); return; }
  if (path === '/tasks') {
    json({ mode: isActive() ? 'mock' : 'archive', capabilities, competitionReady: false,
      tasks: [{ ...publicTask(currentFixture), mockSupported: false }], bundles: [
        { runId: oldRun.id, bundleDigest: oldBundle.bundleDigest }, { runId: currentRun.id, bundleDigest: currentBundle.bundleDigest },
      ] }); return;
  }
  if (path === '/runs') { json({ runs: isActive() ? [activeRun(scenario === 'active-matched')] : [oldRun, currentRun] }); return; }
  if (path === `/runs/${currentRun.id}`) { json(isActive() ? activeRun(scenario === 'active-matched') : currentRun); return; }
  if (path === `/runs/${oldRun.id}`) { json(oldRun); return; }
  if (path.endsWith('/evidence')) {
    evidenceRequests.push(path);
    if (path === `/runs/${oldRun.id}/evidence`) {
      const selected = scenario;
      if (selected === 'delayed') await oldGate;
      if (selected === 'missing') { json({ error: { message: 'Recorded evidence unavailable.' } }, 404); return; }
      const bytes = selected === 'wrong-run' ? currentBytes : selected === 'wrong-version' ? Buffer.from(JSON.stringify(changedVersion)) : oldBytes;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${oldRun.id}.json"` }); res.end(bytes); return;
    }
    if (path === `/runs/${currentRun.id}/evidence`) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${currentRun.id}.json"` }); res.end(currentBytes); return;
    }
  }
  unexpectedRequests.push(path); json({ error: { message: 'Not found in synthetic fixture.' } }, 404);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
let browser: Browser | undefined;
const pageErrors: string[] = [], consoleErrors: string[] = [], checks: string[] = [];
let page: Page | undefined;
const open = async (mode: Scenario, runId = oldRun.id) => {
  if (page) await page.close();
  scenario = mode;
  assert.ok(browser);
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`${base}/#evidence/${runId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.run-summary').waitFor();
  return page;
};
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const pending = await open('delayed');
  assert.equal(await pending.locator('.run-summary').getAttribute('data-context-state'), 'loading');
  assert.equal(await pending.locator('.run-summary h2').innerText(), oldRun.taskId);
  assert.match(await pending.locator('.coverage-list').innerText(), /Loading saved requirement text/);
  assert.equal(await pending.locator('.coverage-count').innerText(), '0 / 1');
  assert.doesNotMatch(await pending.locator('#evidence').innerText(), /Replacement catalogue statement|Replacement requirement text|Second replacement requirement/);
  assert.equal(await pending.getByRole('link', { name: 'Download evidence ↓', exact: true }).count(), 0);
  checks.push('pending saved context withholds current catalogue title/text and keeps recorded denominator');
  releaseOld();
  await pending.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.equal(await pending.locator('.run-summary h2').innerText(), oldFixture.title);
  assert.match(await pending.locator('.coverage-list').innerText(), /Archived requirement text from the saved run/);
  assert.equal(await pending.locator('.coverage-row').count(), 1);
  assert.match(await pending.locator(`#evidence-run option[value="${oldRun.id}"]`).innerText(), /Archived task statement/);
  assert.doesNotMatch(await pending.locator(`#evidence-run option[value="${oldRun.id}"]`).innerText(), /Replacement/);
  checks.push('same-ID historical picker/title/requirements come only from saved evidence');
  const downloadPromise = pending.waitForEvent('download');
  await pending.getByRole('link', { name: 'Download evidence ↓', exact: true }).click();
  const download = await downloadPromise, downloadPath = await download.path(); assert.ok(downloadPath);
  assert.deepEqual(await readFile(downloadPath), oldBytes); checks.push('immutable historical download bytes are unchanged');
  await pending.locator('[data-nav="compare"]').click();
  const baselineCard = pending.locator('.variant-card').filter({ hasText: 'B0 · Baseline' });
  assert.match(await baselineCard.innerText(), /Recorded task: Archived task statement/);
  assert.match(await baselineCard.innerText(), /0 \/ 1/);
  assert.doesNotMatch(await baselineCard.innerText(), /Replacement catalogue statement|0 \/ 2/);
  checks.push('comparison keeps recorded task label and coverage count');
  await pending.locator('[data-nav="evidence"]').click();
  await pending.locator('#evidence-run').selectOption(currentRun.id);
  await pending.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.equal(await pending.locator('.run-summary h2').innerText(), currentFixture.title);
  assert.equal(await pending.locator('.coverage-row').count(), 2); assert.equal(await pending.locator('.coverage-count').innerText(), '0 / 2');
  checks.push('new run with the same ID namespace shows its own distinct saved statement');
  await pending.locator('#evidence-run').selectOption(oldRun.id);
  await pending.locator('.run-summary[data-context-state="ready"]').waitFor();
  await pending.screenshot({ path: '/tmp/patchproof-historical-context-desktop.png', fullPage: true });
  await pending.setViewportSize({ width: 390, height: 844 });
  assert.equal(await pending.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await pending.screenshot({ path: '/tmp/patchproof-historical-context-mobile.png', fullPage: true });
  await pending.reload({ waitUntil: 'domcontentloaded' }); await pending.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.equal(await pending.locator('.run-summary h2').innerText(), oldFixture.title);
  assert.equal(await pending.getByRole('button', { name: /^(Run|Compare all three|Cancel run)/ }).count(), 0);
  assert.equal(await pending.locator('#compare-run').isHidden(), true);
  assert.deepEqual(consoleErrors, []); checks.push('archived route, mobile layout and no-execution controls remain intact');

  for (const mismatch of ['wrong-run', 'wrong-version'] as const) {
    const rejected = await open(mismatch);
    await rejected.locator('.run-summary[data-context-state="error"]').waitFor();
    assert.equal(await rejected.locator('.run-summary h2').innerText(), oldRun.taskId);
    assert.match(await rejected.locator('.coverage-list').innerText(), /Requirement text unavailable/);
    assert.doesNotMatch(await rejected.locator('#evidence').innerText(), /Replacement catalogue statement|Replacement requirement text|Archived requirement text/);
    assert.equal(await rejected.getByRole('link', { name: 'Download evidence ↓', exact: true }).count(), 0);
  }
  checks.push('mismatched recorded run or contract version cannot supply task text');
  const missing = await open('missing'); await missing.locator('.run-summary[data-context-state="error"]').waitFor();
  assert.match(await missing.locator('.run-summary').innerText(), /unavailable or mismatched/);
  assert.equal(await missing.locator('.coverage-count').innerText(), '0 / 1');
  scenario = 'ready'; await missing.getByRole('button', { name: 'Retry saved task context', exact: true }).click();
  await missing.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.equal(await missing.locator('.run-summary h2').innerText(), oldFixture.title);
  checks.push('unavailable evidence has an explicit error and a GET-only successful retry');
  const requestsBeforeActive = evidenceRequests.length;
  const matched = await open('active-matched', currentRun.id);
  assert.equal(await matched.locator('.run-summary').getAttribute('data-context-state'), 'ready');
  assert.equal(await matched.locator('.run-summary h2').innerText(), currentFixture.title);
  assert.match(await matched.locator('.coverage-list').innerText(), /Replacement requirement text/);
  const mismatched = await open('active-mismatched', currentRun.id);
  assert.equal(await mismatched.locator('.run-summary').getAttribute('data-context-state'), 'unavailable');
  assert.equal(await mismatched.locator('.run-summary h2').innerText(), currentRun.taskId);
  assert.doesNotMatch(await mismatched.locator('.coverage-list').innerText(), /Replacement requirement text|Archived requirement text/);
  assert.equal(await mismatched.locator('.coverage-count').innerText(), '0 / 2');
  assert.equal(evidenceRequests.length, requestsBeforeActive); checks.push('active runs use catalogue context only when both recorded source/policy pins match');
  assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedRequests, []); assert.ok(methods.every(method => method === 'GET'));
  assert.equal(digestBytes(oldBytes), digestBytes(Buffer.from(JSON.stringify(oldBundle, null, 2) + '\n')));
  checks.push('all fixture HTTP requests stay GET-only, with no SSE or browser script failures');
  const report = { kind: 'historical-context-browser-verification', status: 'passed', testedAt: new Date().toISOString(),
    scope: 'actual app assets with invented read-only HTTP metadata only', appSourceDigest: digestBytes(assets.get('/app.js')!.bytes),
    scriptSourceDigest: digestBytes(await readFile(new URL(import.meta.url))), browserVersion: browser.version(), checks,
    sameTaskId: oldRun.taskId, oldBundleDigest: oldBundle.bundleDigest, oldBytesDigest: digestBytes(oldBytes),
    currentBundleDigest: currentBundle.bundleDigest, browserErrors: pageErrors,
    expectedMissingEvidenceResponse: 404, consoleMessagesDuringNegativeCases: consoleErrors,
    requests: { total: methods.length, mutationCount: methods.filter(method => method !== 'GET').length, evidenceCount: evidenceRequests.length },
    candidateExecutions: 0, providerCalls: 0, containersStarted: 0, realHumanResults: false,
    screenshots: ['/tmp/patchproof-historical-context-desktop.png', '/tmp/patchproof-historical-context-mobile.png'] };
  await mkdir(new URL('../.local/verification/', import.meta.url), { recursive: true, mode: 0o700 });
  await writeFile(new URL('../.local/verification/historical-context-browser.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  releaseOld();
  if (browser) await browser.close();
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
}
