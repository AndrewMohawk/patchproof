import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import type { ProductEvidence, ProductRun } from '../../packages/contracts/src/product.ts';

// Exercises the actual running API and container checks, with no intercepted responses.
// Usage: node apps/web/verify-browser.ts http://127.0.0.1:43171
const base = (process.argv[2] ?? 'http://127.0.0.1:43171').replace(/\/$/, '');
assert.ok(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base), 'Browser verification requires a loopback server.');
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function showFullRequirements(page: Page) {
  const disclosure = page.locator('#task-detail details').filter({ has: page.locator('summary').filter({ hasText: /^Full requirements$/ }) });
  if (!await disclosure.evaluate(element => (element as HTMLDetailsElement).open)) await disclosure.locator('summary').click();
}
async function openRunTab(page: Page, name: 'Patch' | 'Checks' | 'Activity' | 'Run details') {
  const tab = page.getByRole('tab', { name, exact: true }); await tab.click();
  assert.equal(await tab.getAttribute('aria-selected'), 'true');
}
const demoTaskId = 'stable-unique-01';
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
  await page.goto(`${base}/#tasks`, { waitUntil: 'domcontentloaded' });
  const demoTaskCard = page.locator(`.task-card[data-task-id="${demoTaskId}"]`);
  await demoTaskCard.waitFor({ state: 'visible' });
  assert.equal(await page.title(), 'PatchProof');
  await page.locator('.workspace-status summary').click();
  assert.match(await page.locator('#mode-description').innerText(), /scripted|mock/i);
  assert.match(await page.locator('#mode-indicator').innerText(), /Mock model/);
  await page.locator('.workspace-status summary').click();
  caption('LOCAL REHEARSAL: scripted model, real local container checks. No paid inference or benchmark result.');
  if (recordingDirectory) await page.waitForTimeout(3500);
  assert.ok(await page.locator('.task-card').count() > 1, 'The UI must display more than one curated task.');
  const catalogueResponse = await page.request.get(`${base}/tasks`);
  assert.equal(catalogueResponse.status(), 200);
  const catalogue = await catalogueResponse.json() as { tasks: Array<{ id: string; title: string; mockSupported: boolean }> };
  const demoTask = catalogue.tasks.find(task => task.id === demoTaskId);
  const unsupportedTask = catalogue.tasks.find(task => task.id !== demoTaskId && task.mockSupported === false);
  assert.ok(demoTask?.mockSupported, 'The named demonstration task must support the local scripted model.');
  assert.ok(unsupportedTask, 'A distinct curated task must require a connected model.');
  assert.match(unsupportedTask.id, /^[a-zA-Z0-9_-]+$/);
  const unsupportedTaskCard = page.locator(`.task-card[data-task-id="${unsupportedTask.id}"]`);
  await demoTaskCard.click();
  await showFullRequirements(page);
  assert.match(await page.locator('#task-detail').innerText(), new RegExp(escapeRegex(demoTask.title)));
  await unsupportedTaskCard.click();
  await showFullRequirements(page);
  assert.match(await page.locator('#task-detail').innerText(), new RegExp(escapeRegex(unsupportedTask.title)), 'Task selection must retain the exact task statement.');
  assert.equal(await unsupportedTaskCard.getAttribute('aria-pressed'), 'true');
  assert.ok(await page.getByRole('button', { name: 'Generate patch', exact: true }).isDisabled(), 'Unsupported fixtures must require a connected model.');
  assert.match(await page.locator('#task-detail').innerText(), /needs a connected model/);
  await demoTaskCard.click();
  assert.equal(await demoTaskCard.getAttribute('aria-pressed'), 'true');
  await showFullRequirements(page);
  assert.match(await page.locator('#task-detail').innerText(), new RegExp(escapeRegex(demoTask.title)));
  assert.ok(await page.locator('#task-detail .requirements li').count() > 0);
  assert.equal(await page.locator('textarea, input[type="file"]').count(), 0, 'Demo has no source or repository upload control.');
  assert.equal(await page.locator('#task-search').count(), 1, 'Search filters curated examples only.');
  await page.screenshot({ path: '/tmp/patchproof-tasks-desktop.png', fullPage: true });
  caption('Choose a curated maintenance task and inspect its requirements. Unsupported tasks require a connected model.');
  if (recordingDirectory) await page.waitForTimeout(3500);

  await page.getByRole('link', { name: 'Compare approaches', exact: true }).click();
  if (!resumeRunIds.length) await page.locator('#compare-run').click();
  await page.locator('#compare-view').waitFor({ state: 'visible' });
  caption('All three policies share the same allowance. Progress comes from recorded coordinator events and container checks.');
  // Observe cleanup/publication after the fixed 120-second execution deadline;
  // this wait does not grant any additional execution time.
  await page.waitForFunction(() => document.querySelectorAll('.variant-card a').length === 3 &&
    !(document.querySelector('#compare-run') as HTMLButtonElement).disabled &&
    document.querySelectorAll('.variant-card .outcome').length === 3 &&
    !document.querySelector('.variant-card .busy-indicator'), undefined, { timeout: 150000 });
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
    assert.equal(run.taskId, demoTaskId); assert.equal(run.phase, 'terminal');
    assert.ok(run.terminalStatus, 'Every comparison must retain its actual terminal verdict.');
    assert.deepEqual(run.limits, expectedLimits);
    assert.equal(run.sourceDigest, comparisonRuns[0]!.sourceDigest);
    assert.equal(run.policyDigest, comparisonRuns[0]!.policyDigest);
    assert.notEqual(run.terminalStatus, 'infrastructure_error', run.reason ?? 'Container execution failed.');
  }
  await page.locator('.comparison-context').filter({ hasText: /Same inputs and limits/ }).waitFor();
  await page.screenshot({ path: '/tmp/patchproof-comparison-desktop.png', fullPage: true });
  const product = comparisonRuns.find(run => run.variant === 'patchproof')!;
  const baseline = comparisonRuns.find(run => run.variant === 'baseline')!;
  const checksOnly = comparisonRuns.find(run => run.variant === 'checks_only')!;
  assert.ok(baseline, 'The comparison must include the recorded B0 run.');
  assert.equal(checksOnly.terminalStatus, 'verified_for_declared_checks');
  assert.equal(product.terminalStatus, 'verified_for_declared_checks');
  assert.ok(product.candidates.length > 0, 'The product must record a real candidate.');
  const rejectedCandidate = product.candidates.find(candidate => !candidate.accepted && candidate.rejectionReason);
  assert.ok(rejectedCandidate, 'The demonstration must retain an actual rejected candidate and its reason.');
  assert.ok(rejectedCandidate.rejectionReason);
  const nonpassingChecks = [...rejectedCandidate.visibleChecks, ...rejectedCandidate.acceptanceChecks].filter(check => check.status !== 'pass');
  assert.ok(nonpassingChecks.length > 0, 'The rejected candidate must retain its nonpassing declared check evidence.');
  assert.ok(product.candidates.some(candidate => candidate.accepted), 'The demonstration task must reach an accepted candidate.');
  assert.ok(product.candidates.flatMap(candidate => candidate.sandboxOperationIds).length > 0, 'Container operations must be recorded.');
  caption(`Recorded local verdicts: B0 ${baseline.terminalStatus}; B1 ${checksOnly.terminalStatus}; P ${product.terminalStatus}. This scripted example does not measure model performance.`);
  if (recordingDirectory) await page.waitForTimeout(5000);

  await page.locator('.variant-card.featured a').click();
  await page.getByRole('link', { name: 'Download evidence', exact: true }).waitFor();
  await openRunTab(page, 'Checks');
  await page.getByText('Requirements checked', { exact: true }).click();
  assert.ok(await page.locator('.coverage-list').isVisible());
  await openRunTab(page, 'Run details');
  assert.ok(await page.locator('.accounting').isVisible());
  await openRunTab(page, 'Activity');
  assert.ok(await page.locator('.event-list').isVisible());
  await openRunTab(page, 'Patch');
  await page.getByRole('button', { name: new RegExp(`^Attempt ${rejectedCandidate.id} · Failed`) }).click();
  assert.match(await page.locator('.candidate-tabs').innerText(), /Failed/);
  assert.match(await page.locator('.candidate-tabs').innerText(), /Failed/);
  assert.ok(await page.locator('.diff-line').count() > 0);
  await openRunTab(page, 'Checks');
  assert.ok(await page.locator('.check-values').count() > 0, 'Rejected attempt retains expected and observed failure values.');
  await page.getByText('Attempt decision', { exact: true }).click();
  assert.ok((await page.locator('[data-panel="checks"]').innerText()).includes(rejectedCandidate.rejectionReason), 'The exact recorded rejection reason remains inspectable.');
  await page.getByText(/Observed result and log/).first().click();
  assert.ok(await page.locator('.check-log').first().isVisible());
  if (!resumeRunIds.length) {
    assert.match(await page.locator('.check-log').first().innerText(), /Observation 1/);
    assert.match(await page.locator('.check-log').first().innerText(), /Observation 2/);
    assert.match(await page.locator('.check-log').first().innerText(), /Repeat agreement: consistent/);
  }
  const rejectionObservations = nonpassingChecks.map(check => `${check.requirementId}: ${check.status}`).join('; ');
  caption(`Candidate ${rejectedCandidate.id} was rejected. Recorded nonpassing checks: ${rejectionObservations}. The evidence preserves the reason, diff and recorded observations.`);
  if (recordingDirectory) await page.waitForTimeout(5000);
  await page.screenshot({ path: '/tmp/patchproof-evidence-desktop.png', fullPage: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('link', { name: 'Download evidence', exact: true }).click(),
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
  await page.getByRole('link', { name: 'Download evidence', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, `#evidence/${product.id}`, 'Reload preserves the addressed run.');
  await page.setViewportSize({ width: 390, height: 844 });
  caption('The same evidence, comparison and task views work on a narrow screen. Provider integration and human review remain pending.');
  for (const view of ['evidence', 'compare', 'runs', 'tasks']) {
    await page.evaluate(next => { location.hash = next; }, view);
    await page.locator(`#${view}-view`).waitFor({ state: 'visible' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `${view} view must not overflow on mobile.`);
    await page.screenshot({ path: `/tmp/patchproof-${view}-mobile.png`, fullPage: true });
    if (recordingDirectory) await page.waitForTimeout(1500);
  }
  await page.locator('#mobile-task').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Generate patch', exact: true }).evaluate(element => element === document.activeElement), true, 'Tab from the mobile example picker must reach Generate patch.');
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(`${base}/`)), 'Browser requests stay on the loopback application.');
  const report = {
    testedAt: new Date().toISOString(), status: 'passed', mode: 'mock', competitionReady: false,
    browserVersion: browser.version(), base, observation: resumeRunIds.length ? 'resumed_existing_ui_runs' : 'new_ui_comparison', resumeRunIds, runs: comparisonRuns.map(run => ({ id: run.id, variant: run.variant, status: run.terminalStatus, reason: run.reason })),
    selectedTaskId: demoTaskId, unsupportedTaskId: unsupportedTask.id,
    rejectedCandidate: { id: rejectedCandidate.id, reason: rejectedCandidate.rejectionReason, nonpassingChecks: nonpassingChecks.map(check => ({ id: check.id, requirementId: check.requirementId, status: check.status })) },
    checks: ['task selection updates requirements', 'unsupported tasks cannot launch mock repair', 'honest mock labels', 'real three-variant execution', 'matched resource limits', 'candidate rejection and repair', 'local operation IDs', 'readable diff and check logs', 'downloaded evidence identity', 'addressed-run reload', 'mobile all views including run history', 'result tab navigation', 'keyboard focus', 'no console errors', 'same-origin browser traffic'],
    artifactDigest: evidence.bundleDigest, createdIds,
    screenshots: ['/tmp/patchproof-tasks-desktop.png', '/tmp/patchproof-comparison-desktop.png', '/tmp/patchproof-evidence-desktop.png', '/tmp/patchproof-evidence-mobile.png', '/tmp/patchproof-compare-mobile.png', '/tmp/patchproof-runs-mobile.png', '/tmp/patchproof-tasks-mobile.png'],
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
