import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { ProductEvidence, ProductRun } from '../../packages/contracts/src/product.ts';

// Exercises the actual running API and container checks, with no intercepted responses.
// Usage: node apps/web/verify-browser.ts http://127.0.0.1:43171
const base = (process.argv[2] ?? 'http://127.0.0.1:43171').replace(/\/$/, '');
assert.ok(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base), 'Browser verification requires a loopback server.');
const resumeRunIds = process.argv[3] ? process.argv[3].split(',') : [];
const recordingDirectory = process.argv[4];
assert.ok(resumeRunIds.length === 0 || (resumeRunIds.length === 3 && resumeRunIds.every(id => /^[0-9a-f-]{36}$/.test(id))), 'Resume requires exactly three recorded run IDs.');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors: string[] = [];
const requests: string[] = [];
const createdIds: string[] = [];
const captions: Array<{ startMs: number; text: string }> = [];
let recordingStarted = 0;
const caption = (text: string) => { if (recordingDirectory) captions.push({ startMs: Math.round(performance.now() - recordingStarted), text }); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 },
    ...(recordingDirectory ? { recordVideo: { dir: recordingDirectory, size: { width: 1440, height: 1100 } } } : {}) });
  recordingStarted = performance.now();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  page.on('response', async response => {
    if (response.request().method() === 'POST' && response.url() === `${base}/runs` && response.ok()) {
      const run = await response.json() as ProductRun;
      createdIds.push(run.id);
    }
  });
  // Active runs keep their SSE connections open. Wait for rendered task data,
  // not an idle network, so an observer can attach while work is streaming.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('.task-card').first().waitFor({ state: 'visible' });
  assert.equal(await page.title(), 'PatchProof — review the evidence');
  assert.match(await page.locator('.mode-banner').innerText(), /No paid inference or competition-ready evidence/);
  assert.match(await page.locator('.mode-indicator').innerText(), /Mock model · Local checks/);
  caption('LOCAL REHEARSAL: scripted model, real local container checks. No paid inference or benchmark result.');
  if (recordingDirectory) await page.waitForTimeout(3500);
  const taskButtons = page.locator('.task-card');
  assert.ok(await taskButtons.count() > 1, 'The UI must display more than one curated task.');
  await page.locator('.task-card[data-task-id="stable-unique-01"]').click();
  const firstTask = await page.locator('#task-detail h2').innerText();
  await taskButtons.nth(1).click();
  assert.notEqual(await page.locator('#task-detail h2').innerText(), firstTask, 'Task selection must update the detail panel.');
  assert.ok(await page.getByRole('button', { name: 'Run PatchProof →', exact: true }).isDisabled(), 'Unsupported fixtures must require a connected model.');
  assert.match(await page.locator('#task-detail').innerText(), /Requires connected model/);
  await taskButtons.first().click();
  assert.equal(await page.locator('#task-detail h2').innerText(), firstTask);
  assert.ok(await page.locator('#task-detail .requirements li').count() > 0);
  assert.equal(await page.locator('input[type="text"], textarea, input[type="file"]').count(), 0, 'Demo accepts curated task IDs only.');
  await page.screenshot({ path: '/tmp/patchproof-tasks-desktop.png', fullPage: true });
  caption('Choose a curated maintenance task and inspect its requirements. Unsupported tasks require a connected model.');
  if (recordingDirectory) await page.waitForTimeout(3500);

  if (resumeRunIds.length) await page.locator('[data-nav="compare"]').click();
  else await page.getByRole('button', { name: 'Compare all three', exact: true }).click();
  await page.locator('#compare-view').waitFor({ state: 'visible' });
  caption('All three policies share the same allowance. Progress comes from recorded coordinator events and container checks.');
  await page.waitForFunction(() => document.querySelectorAll('.variant-card a').length === 3 &&
    !(document.querySelector('#compare-run') as HTMLButtonElement).disabled &&
    document.querySelectorAll('.variant-card .outcome').length === 3 &&
    !document.querySelector('.variant-card .busy-indicator'), undefined, { timeout: 120000 });
  const runIds = await page.locator('.variant-card a').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).hash.split('/')[1]!));
  if (resumeRunIds.length) assert.deepEqual([...runIds].sort(), [...resumeRunIds].sort(), 'Resume observes the exact previously launched runs.');
  const comparisonRuns = await Promise.all(runIds.map(async id => {
    const response = await page.request.get(`${base}/runs/${id}`);
    assert.equal(response.status(), 200);
    return await response.json() as ProductRun;
  }));
  assert.equal(new Set(comparisonRuns.map(run => run.variant)).size, 3);
  const expectedLimits = comparisonRuns[0]!.limits;
  for (const run of comparisonRuns) {
    assert.equal(run.mode, 'mock'); assert.equal(run.competitionReady, false);
    assert.deepEqual(run.limits, expectedLimits);
    assert.equal(run.sourceDigest, comparisonRuns[0]!.sourceDigest);
    assert.equal(run.policyDigest, comparisonRuns[0]!.policyDigest);
    assert.notEqual(run.terminalStatus, 'infrastructure_error', run.reason ?? 'Container execution failed.');
  }
  await page.getByText('MATCHED CONTEXT', { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/patchproof-comparison-desktop.png', fullPage: true });
  const product = comparisonRuns.find(run => run.variant === 'patchproof')!;
  assert.equal(comparisonRuns.find(run => run.variant === 'baseline')?.terminalStatus, 'failed');
  assert.equal(comparisonRuns.find(run => run.variant === 'checks_only')?.terminalStatus, 'verified_for_declared_checks');
  assert.equal(product.terminalStatus, 'verified_for_declared_checks');
  assert.ok(product.candidates.length > 0, 'The product must record a real candidate.');
  assert.ok(product.candidates.some(candidate => !candidate.accepted), 'The demonstration must retain an actual rejected candidate.');
  assert.ok(product.candidates.some(candidate => candidate.accepted), 'The demonstration task must reach an accepted candidate.');
  assert.ok(product.candidates.flatMap(candidate => candidate.sandboxOperationIds).length > 0, 'Container operations must be recorded.');
  caption('This scripted example fails the visible-only baseline and passes the other two policies. It does not measure model performance.');
  if (recordingDirectory) await page.waitForTimeout(5000);

  await page.locator('.variant-card.featured a').click();
  await page.getByRole('link', { name: 'Download evidence ↓', exact: true }).waitFor();
  assert.match(await page.locator('#evidence').innerText(), /Requirement coverage/);
  assert.match(await page.locator('#evidence').innerText(), /Resource accounting/);
  assert.match(await page.locator('#evidence').innerText(), /Execution journal/);
  await page.locator('.candidate-tab').first().click();
  assert.match(await page.locator('.candidate-tabs').innerText(), /rejected/);
  assert.ok(await page.locator('.failure-card').count() > 0);
  assert.ok(await page.locator('.diff-line').count() > 0);
  await page.getByText(/Observed result and log/).first().click();
  assert.ok(await page.locator('.check-log').first().isVisible());
  if (!resumeRunIds.length) {
    assert.match(await page.locator('.check-log').first().innerText(), /Observation 1/);
    assert.match(await page.locator('.check-log').first().innerText(), /Observation 2/);
    assert.match(await page.locator('.check-log').first().innerText(), /Repeat agreement: consistent/);
  }
  caption('The rejected patch sorts the input. The evidence preserves its diff and both independent observations of each declared check.');
  if (recordingDirectory) await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/patchproof-evidence-desktop.png', fullPage: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('link', { name: 'Download evidence ↓', exact: true }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const evidence = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProductEvidence;
  assert.equal(evidence.format, 'patchproof-evidence-v2');
  assert.equal(evidence.mode, 'mock'); assert.equal(evidence.competitionReady, false);
  assert.equal(evidence.run.id, product.id);
  assert.equal(download.suggestedFilename(), `${product.id}.json`);
  assert.match(evidence.bundleDigest, /^sha256:[a-f0-9]{64}$/);
  caption('Download the immutable source, selected patch, runtime lock, logs and accounting for a fresh local replay.');
  if (recordingDirectory) await page.waitForTimeout(3500);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Download evidence ↓', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, `#evidence/${product.id}`, 'Reload preserves the addressed run.');
  await page.setViewportSize({ width: 390, height: 844 });
  caption('The same evidence, comparison and task views work on a narrow screen. Provider integration and human review remain pending.');
  for (const view of ['evidence', 'compare', 'tasks']) {
    await page.locator(`[data-nav="${view}"]`).click();
    await page.locator(`#${view}-view`).waitFor({ state: 'visible' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `${view} view must not overflow on mobile.`);
    await page.screenshot({ path: `/tmp/patchproof-${view}-mobile.png`, fullPage: true });
    if (recordingDirectory) await page.waitForTimeout(1500);
  }
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement !== document.body), 'Keyboard focus must reach an interactive control.');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(`${base}/`)), 'Browser requests stay on the loopback application.');
  const report = {
    testedAt: new Date().toISOString(), status: 'passed', mode: 'mock', competitionReady: false,
    browserVersion: browser.version(), base, observation: resumeRunIds.length ? 'resumed_existing_ui_runs' : 'new_ui_comparison', resumeRunIds, runs: comparisonRuns.map(run => ({ id: run.id, variant: run.variant, status: run.terminalStatus })),
    checks: ['task selection updates requirements', 'unsupported tasks cannot launch mock repair', 'honest mock labels', 'real three-variant execution', 'matched resource limits', 'candidate rejection and repair', 'local operation IDs', 'readable diff and check logs', 'downloaded evidence identity', 'addressed-run reload', 'mobile all views', 'keyboard focus', 'no console errors', 'same-origin browser traffic'],
    artifactDigest: evidence.bundleDigest, createdIds,
    screenshots: ['/tmp/patchproof-tasks-desktop.png', '/tmp/patchproof-comparison-desktop.png', '/tmp/patchproof-evidence-desktop.png', '/tmp/patchproof-evidence-mobile.png', '/tmp/patchproof-compare-mobile.png', '/tmp/patchproof-tasks-mobile.png'],
  };
  await mkdir('.local/verification', { recursive: true });
  await writeFile('.local/verification/product-browser.json', JSON.stringify(report, null, 2) + '\n');
  if (recordingDirectory) {
    const durationMs = Math.round(performance.now() - recordingStarted);
    const video = page.video();
    await page.close();
    assert.ok(video, 'Rehearsal video was not recorded.');
    await video.saveAs(join(recordingDirectory, 'local-rehearsal.webm'));
    const stamp = (ms: number) => new Date(ms).toISOString().slice(11, 23).replace('.', ',');
    const srt = captions.map((row, i) => `${i + 1}\n${stamp(row.startMs)} --> ${stamp(captions[i + 1]?.startMs ?? durationMs)}\n${row.text}\n`).join('\n');
    await writeFile(join(recordingDirectory, 'captions.srt'), srt, { flag: 'wx' });
    await writeFile(join(recordingDirectory, 'claims.json'), JSON.stringify({
      mode: 'mock', classification: 'local-rehearsal', competitionReady: false, durationMs,
      authenticityVerified: false, inferenceCalls: 0, providerSpendUsd: 0,
      runIds, bundleDigest: evidence.bundleDigest, operationalLock: (evidence.runtimeLock as { operationalLock?: unknown }).operationalLock,
      captions, evidenceReport: report, claims: ['Scripted demonstration only.', 'Real local containers.', 'No live provider or human outcome claim.'],
    }, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
