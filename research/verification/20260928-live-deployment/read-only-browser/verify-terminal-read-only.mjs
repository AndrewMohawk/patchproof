import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Actual public deployment, GET only. No run, cancel, replay or provider calls.
const base = 'https://patchproof.andrewmohawk.xyz';
const selectedRunId = process.argv[3];
assert.match(selectedRunId ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const directory = join(dirname(fileURLToPath(import.meta.url)), process.argv[2] || 'attempt-01');
await mkdir(directory, { recursive: true });
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const report = { startedAt: new Date().toISOString(), origin: base, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Actual public browser; GET-only observer; no candidate, provider, run, cancel, or replay dispatch.',
  status: 'running', checks: [], screenshots: [], snapshots: [], sourceAssets: [], requests: [], blockedRequests: [], consoleErrors: [], pageErrors: [], networkFailures: [], httpErrors: [], observedRuns: [] };
let browser, context;
const pending = new Set();
const recordCheck = (name, details) => report.checks.push({ name, passed: true, details });
async function publicGet(path, name) {
  const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, path + ' response');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (name) { await writeFile(join(directory, name), bytes); report.snapshots.push({ path, file: name, digest: sha(bytes), bytes: bytes.length, observedAt: new Date().toISOString() }); }
  return { body: JSON.parse(bytes), bytes };
}
async function screenshot(page, name) {
  await page.screenshot({ path: join(directory, name), fullPage: true });
  const bytes = await readFile(join(directory, name)); report.screenshots.push({ file: name, digest: sha(bytes), bytes: bytes.length, viewport: page.viewportSize() });
}
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1, label + ': ' + JSON.stringify(dimensions)); recordCheck(label + ' has no horizontal overflow', dimensions);
}
try {
  const health = (await publicGet('/healthz', 'health-before.json')).body;
  assert.equal(health.mode, 'live'); assert.equal(health.modelProvider, 'nebius-token-factory'); assert.equal(health.checkBackend, 'local_container');
  recordCheck('Public health identifies live Token Factory and local Docker checks', health);
  const meta = (await publicGet('/tasks', 'tasks-before.json')).body;
  const history = (await publicGet('/runs', 'runs-before.json')).body;
  assert.equal(meta.mode, 'live'); assert.equal(meta.tasks.length, 20); assert.ok(meta.tasks.every(task => task.executionSupported));
  assert.equal(meta.limits.maxApprovedSpendUsd, .1); assert.equal(meta.maxApprovedSpendUsd, 25);
  assert.equal(meta.execution.modelProvider, 'nebius-token-factory'); assert.equal(meta.execution.checkBackend, 'local_container');
  report.runtimeLockDigest = meta.runtimeLockDigest; report.execution = meta.execution; report.limits = meta.limits; report.initialAvailability = meta.availability;
  recordCheck('Twenty supported curated tasks and declared spending bounds', { taskIds: meta.tasks.map(task => task.id), runLimitUsd: .1, projectCeilingUsd: 25 });
  for (const [path, local] of [['/', 'apps/web/index.html'], ['/app.js', 'apps/web/app.js'], ['/style.css', 'apps/web/style.css']]) {
    const response = await fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()), localBytes = await readFile(local);
    assert.equal(sha(bytes), sha(localBytes), 'deployed asset matches recorded source: ' + path);
    report.sourceAssets.push({ path, local, digest: sha(bytes), bytes: bytes.length });
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); report.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const allowedPath = ['/', '/app.js', '/style.css', '/favicon.ico', '/tasks', '/runs', '/healthz'].includes(url.pathname) || /^\/runs\/[0-9a-f-]{36}(?:\/(?:evidence|events))?$/.test(url.pathname);
    if (request.method() !== 'GET' || url.origin !== base || !allowedPath || url.search) {
      report.blockedRequests.push({ method: request.method(), url: request.url() }); await route.abort('blockedbyclient'); return;
    }
    // Finite responses reject redirects before browser delivery. The explicitly
    // approved same-origin SSE GET remains streaming and is not substituted.
    if (url.pathname.endsWith('/events')) { await route.continue(); return; }
    const job = (async () => {
      const response = await fetch(request.url(), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      const headers = Object.fromEntries(response.headers); delete headers['content-encoding']; delete headers['content-length'];
      await route.fulfill({ status: response.status, headers, body: bytes });
    })();
    pending.add(job);
    try { await job; } catch (error) { report.networkFailures.push({ url: request.url(), error: String(error) }); await route.abort().catch(() => {}); }
    finally { pending.delete(job); }
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('request', request => report.requests.push({ method: request.method(), url: request.url(), at: new Date().toISOString() }));
  page.on('requestfailed', request => report.networkFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ url: response.url(), status: response.status() }); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByText('Live model · Local Docker checks', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.task-card').count(), 20);
  assert.equal(await page.getByRole('link', { name: 'Watch demo ↗', exact: true }).getAttribute('href'), '/demo/');
  assert.match(await page.locator('#task-detail').innerText(), /\$0\.10/);
  assert.doesNotMatch(await page.locator('#task-detail').innerText(), /Nebius Sandbox checks|Mock workspace|Scripted proposal/);
  recordCheck('Rendered live runtime, twenty-task catalogue, per-run bound and demo link', { mode: await page.locator('#mode-indicator').innerText(), launchDisabled: await page.getByRole('button', { name: 'Run PatchProof →', exact: true }).isDisabled() });
  await screenshot(page, 'desktop-1440-tasks.png'); await noOverflow(page, 'desktop tasks');
  for (const [width, id, name] of [[390, 'v2-r02-t03', 'mobile-390-chapter-task.png'], [320, 'v2-r03-t04', 'mobile-320-worksheet-task.png']]) {
    assert.ok(meta.tasks.some(task => task.id === id));
    await page.setViewportSize({ width, height: 844 });
    await page.locator(`.task-card[data-task-id="${id}"]`).click();
    const expected = meta.tasks.find(task => task.id === id);
    assert.equal(await page.locator('#task-detail h2').innerText(), expected.title);
    for (const requirement of expected.requirements) assert.ok((await page.locator('#task-detail').innerText()).includes(requirement.text));
    await screenshot(page, name); await noOverflow(page, 'mobile ' + width + ' task selection');
    recordCheck('Mobile ' + width + ' selects a different public task without execution', { taskId: id, title: expected.title });
  }
  await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement !== document.body)); recordCheck('Keyboard focus reaches an interactive element', await page.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent?.slice(0, 100) })));
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.locator('[data-nav="compare"]').click();
  await page.locator('#compare-task').selectOption('stable-unique-01');
  await screenshot(page, 'desktop-1440-comparison.png'); await noOverflow(page, 'desktop comparison');
  const observed = history.runs.find(run => run.id === selectedRunId);
  assert.ok(observed, 'explicit run must exist in public history');
  assert.equal(observed.mode, 'live'); assert.equal(observed.phase, 'terminal');
  assert.equal(observed.runtimeLockDigest, meta.runtimeLockDigest);
  for (const id of ['1ddd6b8b-98ce-45aa-bc11-d9947f41cd4c', 'bb948175-27cb-412a-9fb7-ba64b46dd3d6', '97808518-b836-41a9-961e-8e5f466dc032']) assert.ok(history.runs.some(run => run.id === id), 'prior observation remains in history: ' + id);
  recordCheck('Explicit completed current-runtime run and earlier failure/pass history retained', { runId: selectedRunId, historyCount: history.runs.length });
  if (observed) {
    await page.goto(base + '/#evidence/' + observed.id, { waitUntil: 'domcontentloaded' });
    await page.locator('.run-summary').waitFor();
    assert.doesNotMatch(await page.locator('#evidence').innerText(), /Nebius Sandbox checks|MOCK MODEL/);
    assert.equal(await page.getByRole('button', { name: 'Cancel run', exact: true }).count(), 0, 'unowned public observation cannot cancel');
    const observedRun = (await publicGet('/runs/' + observed.id, 'observed-run.json')).body;
    report.observedRuns.push({ id: observedRun.id, taskId: observedRun.taskId, mode: observedRun.mode, phase: observedRun.phase, status: observedRun.terminalStatus, runtimeLockDigest: observedRun.runtimeLockDigest, sourceDigest: observedRun.sourceDigest, policyDigest: observedRun.policyDigest, usage: observedRun.usage });
    if (observedRun.phase === 'terminal') {
      await page.locator('.run-summary[data-context-state="ready"]').waitFor();
      const evidence = (await publicGet('/runs/' + observed.id + '/evidence', 'observed-evidence.json')).body;
      assert.equal(evidence.run.id, observed.id); assert.equal(evidence.run.mode, 'live'); assert.equal(evidence.run.runtimeLockDigest, meta.runtimeLockDigest);
      report.observedRuns.at(-1).bundleDigest = evidence.bundleDigest;
      report.observedRuns.at(-1).selectedCandidateId = evidence.run.selectedCandidateId;
      report.observedRuns.at(-1).candidates = evidence.run.candidates.map(({id, accepted, rejectionReason}) => ({id, accepted, rejectionReason}));
      assert.ok(await page.locator('.run-summary').innerText().then(text => text.includes('RECORDED LIVE · LOCAL DOCKER CHECKS')));
      const accounting = await page.locator('.accounting').innerText();
      if (observedRun.usage.costIsEstimate) assert.match(accounting, /\(estimate\)/);
      if (observedRun.usage.sandboxCpuSeconds === null) assert.match(accounting, /Not measured|Unmeasured/);
      recordCheck('Terminal rendering identifies recorded live local-Docker evidence and honest accounting', { accounting });
      recordCheck('Actual terminal evidence is publicly readable with live run and runtime identity', { runId: observed.id, bundleDigest: evidence.bundleDigest });
    } else recordCheck('Actual live progress is publicly readable with cancellation unavailable to this observer', { runId: observed.id, phase: observedRun.phase });
    await screenshot(page, 'desktop-1440-evidence.png'); await noOverflow(page, 'desktop evidence');
    for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); await screenshot(page, `mobile-${width}-evidence.png`); await noOverflow(page, 'mobile ' + width + ' evidence'); }
  } else report.observedRunsNote = 'No live runs were present at initial public history read; no run was started by this observer.';
  const finalMeta = (await publicGet('/tasks', 'tasks-after.json')).body;
  await publicGet('/runs', 'runs-after.json'); report.finalAvailability = finalMeta.availability;
  await context.close(); context = null; await browser.close(); browser = null; await Promise.allSettled([...pending]);
  assert.equal(report.blockedRequests.length, 0); assert.equal(report.pageErrors.length, 0); assert.equal(report.consoleErrors.length, 0); assert.equal(report.httpErrors.length, 0);
  const unexpectedFailures = report.networkFailures.filter(item => !item.url.endsWith('/events') || !/ERR_ABORTED|NS_BINDING_ABORTED/.test(item.error || ''));
  assert.deepEqual(unexpectedFailures, []);
  assert.ok(report.requests.every(request => request.method === 'GET' && new URL(request.url).origin === base));
  recordCheck('Observer traffic stayed same-origin GET; no browser console/page/HTTP errors', { requests: report.requests.length, streamingRequestsAbortedOnNavigationOrClose: report.networkFailures.length });
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); process.exitCode = 1; }
finally {
  if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {}); await Promise.allSettled([...pending]);
  report.finishedAt = new Date().toISOString(); report.observerSourceDigest = sha(await readFile(fileURLToPath(import.meta.url)));
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, directory, checks: report.checks.length, screenshots: report.screenshots.length, failure: report.failure || null }, null, 2));
}
