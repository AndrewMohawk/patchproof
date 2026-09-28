import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { digestJson } from '../packages/contracts/src/digest.ts';
import type { ProductRun, ProductEvidence } from '../packages/contracts/src/product.ts';
import { buildEvidence } from '../packages/orchestrator/src/evidence.ts';
import { fixtureDigests } from '../packages/orchestrator/src/fixtures.ts';
import { syntheticArchiveBundle } from './helpers/archive-fixture.ts';

// Browser transport and all observations are invented metadata, never provider or candidate execution.
const execution = { modelProvider: 'nebius-token-factory', checkBackend: 'local_container', modelId: 'synthetic/live-model' };
function example(taskId: string, mode: 'live' | 'mock', variant: ProductRun['variant'] = 'patchproof') {
  const original = syntheticArchiveBundle(mode, '2.2', variant);
  const fixture = { ...original.fixture, id: taskId, title: `Synthetic maintenance ${taskId}` };
  const runtimeLock = { mode, execution: mode === 'live' ? execution : undefined };
  const lock = JSON.parse(JSON.stringify(runtimeLock));
  const run = { ...original.run, taskId, ...fixtureDigests(fixture, '2.2'), runtimeLockDigest: digestJson(lock),
    limits: { ...original.run.limits, inferenceCallLimit: 3, inputTokenLimit: 786432, outputTokenLimit: 6000, wallTimeLimitSeconds: 300, maxApprovedSpendUsd: .1 } };
  return buildEvidence(run, fixture, lock);
}
async function fixtureServer(options: { singleflight?: boolean } = {}) {
  const one = example('curated-example-01', 'live'), two = example('curated-example-02', 'live');
  const historical = example(one.run.taskId, 'mock', 'baseline');
  const estimated = example(one.run.taskId, 'live', 'checks_only');
  estimated.run.usage.measuredCostUsd = .00000012; estimated.run.usage.costIsEstimate = true;
  const estimatedBundle = buildEvidence(estimated.run, estimated.fixture, estimated.runtimeLock);
  const bundles = new Map<string, ProductEvidence>([historical, estimatedBundle].map(b => [b.run.id, b]));
  const runs = new Map<string, ProductRun>([historical, estimatedBundle].map(b => [b.run.id, b.run]));
  const requests: Array<{ taskId: string; mode: string; variant: string }> = [];
  const streams = new Map<string, ServerResponse>();
  const ownedIds = new Set<string>();
  const activity = { maxActive: 0, overlapAttempts: 0 };
  const meta = { mode: 'live', realExecutionEnabled: true, capabilities: { createRuns: true, cancelRuns: true, streamEvents: true, replay: false },
    execution, runtimeLockDigest: one.run.runtimeLockDigest, maxApprovedSpendUsd: 25, limits: one.run.limits,
    availability: { enabled: true, reason: null as string | null, remainingRuns: 2 },
    tasks: [one, two].map(b => ({ id: b.fixture.id, title: b.fixture.title, description: b.fixture.description, requirements: b.fixture.requirements,
      repoId: b.fixture.repoId, split: b.fixture.split, sourceDigest: b.run.sourceDigest, policyDigest: b.run.policyDigest, mockSupported: false, executionSupported: true })) };
  const syncAvailability = () => {
    if (!options.singleflight || meta.mode !== 'live') return;
    const active = [...runs.values()].some(run => run.phase !== 'terminal');
    meta.availability = { enabled: !active, reason: active ? 'A run is active. Review its progress.' : null, remainingRuns: 10 - requests.length };
    meta.realExecutionEnabled = !active; meta.capabilities.createRuns = !active;
  };
  const assets = new Map<string, Buffer>();
  for (const [path, file] of [['/', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css']] as const) assets.set(path, await readFile(new URL('../apps/web/' + file, import.meta.url)));
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'");
    const path = req.url!;
    const json = (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (assets.has(path)) { res.setHeader('Content-Type', path === '/' ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(assets.get(path)); return; }
    if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (path === '/tasks') { syncAvailability(); json(meta); return; }
    if (path === '/runs' && req.method === 'GET') { syncAvailability(); json({ runs: [...runs.values()], ownedRunIds: [...ownedIds], availability: meta.availability }); return; }
    if (path === '/runs' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8')); requests.push(input);
      if (options.singleflight && meta.mode === 'live' && [...runs.values()].some(run => run.phase !== 'terminal')) {
        activity.overlapAttempts++; res.statusCode = 403; json({ error: { message: 'A run is active.' } }); return;
      }
      const b = example(input.taskId, input.mode, input.variant); b.run.id = randomUUID(); b.run.createdAt = new Date().toISOString();
      const run: ProductRun = { ...b.run, phase: 'repair', terminalStatus: null, reason: null, finishedAt: null, candidates: [], selectedCandidateId: null,
        usage: { ...b.run.usage, inferenceCalls: 0, elapsedMs: 0 }, events: [{ sequence: 1, timestamp: new Date().toISOString(), phase: 'repair', message: 'Invented progress event for UI verification.' }] };
      ownedIds.add(run.id); runs.set(run.id, run); bundles.set(run.id, buildEvidence({ ...b.run, id: run.id }, b.fixture, b.runtimeLock));
      activity.maxActive = Math.max(activity.maxActive, [...runs.values()].filter(item => item.phase !== 'terminal').length); syncAvailability(); json(run); return;
    }
    const match = /^\/runs\/([^/]+)(?:\/(events|evidence))?$/.exec(path);
    if (match && runs.has(match[1]!)) {
      const id = match[1]!;
      if (match[2] === 'events') { streams.set(id, res); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.flushHeaders(); return; }
      json(match[2] === 'evidence' ? bundles.get(id) : runs.get(id)); return;
    }
    res.writeHead(404); json({ error: { message: 'Synthetic endpoint not provided.' } });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
  const base = `http://127.0.0.1:${address.port}`, errors: string[] = [];
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== base) { errors.push('unexpected_origin'); await route.abort(); } else await route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', () => errors.push('page_error'));
  return { base, page, meta, runs, bundles, requests, streams, historical, estimated: estimatedBundle, errors, activity,
    finish: (id: string, terminalStatus?: ProductRun['terminalStatus'], reason?: string) => {
      const bundle = bundles.get(id)!;
      if (terminalStatus) bundle.run.terminalStatus = terminalStatus;
      if (reason) bundle.run.reason = reason;
      bundles.set(id, buildEvidence(bundle.run, bundle.fixture, bundle.runtimeLock)); runs.set(id, bundle.run); syncAvailability();
      streams.get(id)?.end('event: terminal\ndata: {}\n\n');
    },
    close: async () => { await context.close(); await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}

async function openRunTab(page: Page, name: 'Patch' | 'Checks' | 'Activity' | 'Run details') {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  assert.equal(await tab.getAttribute('aria-selected'), 'true');
}
async function startComparison(page: Page) {
  await page.getByRole('link', { name: 'Compare approaches', exact: true }).click();
  await page.locator('#compare-run').click();
}

test('live UI uses enabled curated IDs and live requests, real event phases, runtime pins and explicit cost labels', async t => {
  const f = await fixtureServer(); t.after(f.close); const { page } = f;
  const unrelated = structuredClone(f.estimated.run); unrelated.id = randomUUID(); unrelated.phase = 'check'; unrelated.terminalStatus = null; unrelated.finishedAt = null;
  f.runs.set(unrelated.id, unrelated);
  await page.goto(f.base + '/#evidence/' + unrelated.id);
  await page.locator('.run-summary .outcome').filter({ hasText: 'Checking' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cancel run', exact: true }).count(), 0);
  await page.locator('[data-nav="tasks"]').click();
  await page.locator('#mode-indicator').filter({ hasText: /Live model/ }).waitFor();
  assert.equal(await page.locator('.task-card').count(), 2);
  assert.doesNotMatch(await page.locator('#task-detail').innerText(), /(?:^|\n)(?:false|undefined|null)(?:\n|$)/);
  assert.equal(await page.getByRole('link', { name: 'Watch demo', exact: true }).getAttribute('href'), '/demo/');
  await page.locator('#task-detail').getByText('Run limits', { exact: true }).click();
  assert.match(await page.locator('#task-detail').innerText(), /2 runs remain/);
  assert.doesNotMatch(await page.locator('#task-detail').innerText(), /Scripted|Paid execution is unavailable|Nebius Sandbox/);
  assert.match(await page.locator('#task-detail').innerText(), /786,432.*6,000.*300 s/);
  await page.locator('.task-card[data-task-id="curated-example-02"]').click();
  await page.getByRole('button', { name: 'Generate patch', exact: true }).click();
  await page.locator('.run-summary .outcome').filter({ hasText: 'Repairing' }).waitFor();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0]!.taskId, 'curated-example-02'); assert.equal(f.requests[0]!.mode, 'live');
  await page.locator('.run-summary').filter({ hasText: /Live model/ }).waitFor();
  await openRunTab(page, 'Run details');
  assert.match(await page.locator('.accounting').innerText(), /Model cost\s+Not measured/i);
  assert.equal(await page.getByRole('button', { name: 'Cancel run', exact: true }).isEnabled(), true);
  const id = [...f.runs.values()].find(run => run.phase !== 'terminal' && run.id !== unrelated.id)!.id;
  await openRunTab(page, 'Activity');
  await page.waitForFunction(() => document.querySelector('.event-list')?.textContent?.includes('Invented progress event'));
  const streamDeadline = Date.now() + 8000;
  while (!f.streams.has(id) && Date.now() < streamDeadline) await new Promise(done => setTimeout(done, 10));
  assert.ok(f.streams.has(id), 'UI must establish the synthetic event stream');
  const active = f.runs.get(id)!; active.phase = 'check'; active.events.push({ sequence: 2, timestamp: new Date().toISOString(), phase: 'check', message: 'Invented independent check progress.' });
  f.streams.get(id)!.write('event: state\ndata: {}\n\n');
  await page.locator('.run-summary .outcome').filter({ hasText: 'Checking' }).waitFor();
  f.runs.set(id, f.bundles.get(id)!.run); f.streams.get(id)!.end('event: terminal\ndata: {}\n\n');
  await page.locator('.run-summary[data-context-state="ready"] .outcome').filter({ hasText: 'Checks failed' }).waitFor();
  await openRunTab(page, 'Run details');
  assert.match(await page.locator('.digest-list').innerText(), /Check runtime\s+Local Docker checks/);
  assert.match(await page.locator('.digest-list').innerText(), /Model service\s+Nebius Token Factory/);
  assert.doesNotMatch(await page.locator('#evidence').innerText(), /Nebius Sandbox checks/);
  await page.evaluate(() => { location.hash = 'compare'; }); await page.locator('#compare-task').selectOption('curated-example-01');
  await page.getByText('$0.00000012 (estimate)', { exact: true }).waitFor();
  assert.match(await page.locator('#comparison').innerText(), /Recorded mock|Mock model/i);
  assert.match(await page.locator('#comparison').innerText(), /Recorded live/i);
  await page.goto(f.base + '/#evidence/' + f.historical.run.id); await page.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.match(await page.locator('.run-summary').innerText(), /Recorded mock|Mock model/i);
  await openRunTab(page, 'Run details');
  assert.match(await page.locator('.accounting').innerText(), /Model cost\s+\$0\.00/i);
  await page.goto(f.base + '/#evidence/' + f.estimated.run.id); await page.locator('.run-summary[data-context-state="ready"]').waitFor();
  await openRunTab(page, 'Run details');
  assert.match(await page.locator('.accounting').innerText(), /\$0\.00000012 \(estimate\)/);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(f.base);
    await page.getByRole('button', { name: 'Generate patch', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement !== document.body));
  assert.deepEqual(f.errors, []);
});

test('live capabilities and task availability fail closed while old mock mode remains usable', async t => {
  const f = await fixtureServer(); t.after(f.close); const { page } = f;
  f.meta.tasks[1]!.executionSupported = false;
  await page.goto(f.base); await page.locator('.task-card[data-task-id="curated-example-02"]').click();
  assert.equal(await page.getByRole('button', { name: 'Generate patch', exact: true }).isDisabled(), true);
  f.meta.availability = { enabled: false, reason: 'Allowance used. Review saved evidence.', remainingRuns: 0 };
  f.meta.realExecutionEnabled = false; await page.reload(); await page.locator('.task-card[data-task-id="curated-example-01"]').click();
  assert.equal(await page.getByRole('button', { name: 'Generate patch', exact: true }).isDisabled(), true);
  assert.match(await page.locator('#task-detail').innerText(), /Allowance used.*Review saved evidence/s);
  await page.locator('#task-detail').getByText('Run limits', { exact: true }).click();
  assert.match(await page.locator('#task-detail').innerText(), /0 runs remain/);
  f.meta.realExecutionEnabled = true; f.meta.capabilities.createRuns = false; await page.reload(); await page.locator('.task-card[data-task-id="curated-example-01"]').click();
  assert.equal(await page.getByRole('button', { name: 'Generate patch', exact: true }).isDisabled(), true);
  assert.equal(f.requests.length, 0);
  f.meta.mode = 'mock'; f.meta.realExecutionEnabled = false; f.meta.capabilities.createRuns = true; f.meta.tasks[0]!.mockSupported = true;
  await page.reload(); await page.locator('#mode-indicator').filter({ hasText: /Mock model/ }).waitFor();
  assert.equal(await page.locator('#demo-link').isHidden(), true);
  await page.getByRole('button', { name: 'Generate patch', exact: true }).click();
  await page.locator('.run-summary .outcome').filter({ hasText: 'Repairing' }).waitFor();
  assert.equal(f.requests[0]!.mode, 'mock'); assert.deepEqual(f.errors, []);
});


async function eventually(condition: () => boolean, message: string) {
  const deadline = Date.now() + 8000;
  while (!condition() && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
  assert.ok(condition(), message);
}

test('live comparison waits for each recorded terminal and refreshed allowance before posting the next approach', async t => {
  const f = await fixtureServer({ singleflight: true }); t.after(f.close);
  await f.page.goto(f.base); await startComparison(f.page);
  for (let index = 0; index < 3; index++) {
    await eventually(() => f.requests.length >= index + 1, 'next selected approach must start after prior terminal');
    await new Promise(done => setTimeout(done, 100));
    assert.equal(f.requests.length, index + 1, 'no second POST while one run remains active');
    const active = [...f.runs.values()].filter(run => run.phase !== 'terminal'); assert.equal(active.length, 1);
    assert.match(await f.page.locator('#comparison').innerText(), /Live comparison/);
    f.finish(active[0]!.id);
  }
  await eventually(() => [...f.runs.values()].every(run => run.phase === 'terminal'), 'all synthetic runs reach terminal');
  await f.page.locator('#compare-run:not([disabled])').waitFor();
  assert.deepEqual(f.requests.map(request => request.variant), ['baseline', 'checks_only', 'patchproof']);
  assert.equal(f.activity.maxActive, 1); assert.equal(f.activity.overlapAttempts, 0); assert.equal(await f.page.locator('#error').isHidden(), true);
});

test('live comparison does not queue another provider attempt after cancellation, timeout or infrastructure failure', async () => {
  for (const [status, reason] of [['needs_review', 'cancelled'], ['needs_review', 'timeout'], ['infrastructure_error', 'sandbox_cleanup_unconfirmed']] as const) {
    const f = await fixtureServer({ singleflight: true });
    try {
      await f.page.goto(f.base); await startComparison(f.page);
      await eventually(() => f.requests.length === 1, 'first selected approach starts once');
      const active = [...f.runs.values()].find(run => run.phase !== 'terminal')!; f.finish(active.id, status, reason);
      await f.page.locator('#error').getByText(/Comparison stopped after/).waitFor();
      await new Promise(done => setTimeout(done, 600));
      assert.equal(f.requests.length, 1); assert.equal(f.activity.overlapAttempts, 0);
      assert.equal(f.runs.get(active.id)!.reason, reason);
    } finally { await f.close(); }
  }
});

test('mock comparison keeps its existing immediate three-approach launch behavior', async t => {
  const f = await fixtureServer({ singleflight: true }); t.after(f.close);
  f.meta.mode = 'mock'; f.meta.realExecutionEnabled = false; f.meta.tasks[0]!.mockSupported = true;
  await f.page.goto(f.base); await startComparison(f.page);
  await eventually(() => f.requests.length === 3, 'mock comparison launches all approaches without waiting for a terminal');
  assert.deepEqual(f.requests.map(request => request.variant), ['baseline', 'checks_only', 'patchproof']);
  assert.ok(f.requests.every(request => request.mode === 'mock')); assert.equal(f.activity.maxActive, 3); assert.equal(f.activity.overlapAttempts, 0);
});

test('live comparison can rerun one recorded approach without changing its previous evidence', async t => {
  const f = await fixtureServer({ singleflight: true }); t.after(f.close);
  const original = example('curated-example-01', 'live', 'baseline');
  original.run.createdAt = '2026-01-01T00:00:00.000Z';
  const prior = buildEvidence(original.run, original.fixture, original.runtimeLock);
  f.runs.delete(f.historical.run.id); f.bundles.delete(f.historical.run.id);
  f.runs.set(prior.run.id, prior.run); f.bundles.set(prior.run.id, prior);
  const preserved = JSON.stringify(prior);
  await f.page.goto(f.base + '/#compare');
  const card = f.page.locator('.variant-card').filter({ has: f.page.getByRole('heading', { name: 'Standard repair', exact: true }) });
  await card.getByRole('link', { name: 'View result', exact: true }).waitFor();
  assert.equal(await card.getByRole('link', { name: 'View result', exact: true }).getAttribute('href'), '#evidence/' + prior.run.id);
  await card.getByRole('button', { name: 'Run this approach', exact: true }).click();
  await eventually(() => f.requests.length === 1, 'rerun starts the chosen approach once');
  const replacement = [...f.runs.values()].find(run => run.phase !== 'terminal')!;
  assert.notEqual(replacement.id, prior.run.id);
  assert.deepEqual(f.requests.map(({ taskId, mode, variant }) => ({ taskId, mode, variant })), [{ taskId: prior.run.taskId, mode: 'live', variant: 'baseline' }]);
  assert.equal(JSON.stringify(f.bundles.get(prior.run.id)), preserved);
  await f.page.locator('.run-summary .outcome').filter({ hasText: 'Repairing' }).waitFor();
  await f.page.getByRole('link', { name: 'Compare approaches', exact: true }).click();
  await card.getByRole('button', { name: 'Run this approach', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await card.getByRole('button', { name: 'Run this approach', exact: true }).count(), 0, 'paused live allowance hides new-run controls');
  f.finish(replacement.id);
  await f.page.locator('#compare-run:not([disabled])').waitFor();
  assert.equal(await card.getByRole('button', { name: 'Run this approach', exact: true }).isEnabled(), true);
  assert.equal(await card.getByRole('link', { name: 'View result', exact: true }).getAttribute('href'), '#evidence/' + replacement.id);
  await f.page.goto(f.base + '/#evidence/' + prior.run.id);
  await f.page.locator('.run-summary[data-context-state="ready"]').waitFor();
  await f.page.locator('[data-nav="runs"]').click();
  await f.page.locator(`#run-history a[href="#evidence/${prior.run.id}"]`).waitFor();
  assert.equal(await f.page.locator(`#run-history a[href="#evidence/${replacement.id}"]`).count(), 1);
  assert.equal(JSON.stringify(f.bundles.get(prior.run.id)), preserved);
  assert.equal(f.requests.length, 1); assert.equal(f.activity.overlapAttempts, 0); assert.deepEqual(f.errors, []);
});

test('example search and compact mobile selection keep the selected task and first action usable', async t => {
  const f = await fixtureServer(); t.after(f.close); const { page } = f;
  await page.goto(f.base);
  const search = page.locator('#task-search');
  await search.fill('example-02');
  assert.equal(await page.locator('.task-card').count(), 1);
  await page.locator('.task-card').click();
  assert.match(await page.locator('#task-detail').innerText(), /Synthetic maintenance curated-example-02/);
  await search.fill('no-such-example');
  assert.equal(await page.locator('.task-card').count(), 0);
  assert.match(await page.locator('#task-list').innerText(), /No .*examples|No .*tasks/i);
  await search.fill('');
  assert.equal(await page.locator('.task-card').count(), 2);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const chooser = page.locator('#mobile-task');
    assert.equal(await chooser.isVisible(), true);
    await chooser.selectOption('curated-example-01');
    assert.match(await page.locator('#task-detail').innerText(), /Synthetic maintenance curated-example-01/);
    const control = page.getByRole('button', { name: 'Generate patch', exact: true });
    const box = await control.boundingBox(); assert.ok(box);
    assert.ok(box.y >= 0 && box.y + box.height <= 844, `Generate patch must be visible without scrolling at ${width}px.`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.locator('#mobile-task').selectOption('curated-example-02');
  await page.getByRole('button', { name: 'Generate patch', exact: true }).click();
  await eventually(() => f.requests.length === 1, 'mobile action starts selected example once');
  assert.equal(f.requests[0]!.taskId, 'curated-example-02');
  assert.deepEqual(f.errors, []);
});

test('latest saved failure stays visible and run history retains both failed and passing records', async t => {
  const f = await fixtureServer(); t.after(f.close); const { page } = f;
  const success = example('curated-example-01', 'live');
  success.run.createdAt = '2026-09-26T00:00:00.000Z';
  success.run.finishedAt = '2026-09-26T00:00:01.000Z';
  success.run.terminalStatus = 'verified_for_declared_checks'; success.run.reason = 'declared_local_checks_passed';
  for (const candidate of success.run.candidates) {
    candidate.accepted = true; candidate.rejectionReason = null;
    for (const check of [...candidate.visibleChecks, ...candidate.acceptanceChecks]) { check.status = 'pass'; check.actual = check.expected; }
  }
  for (const row of success.run.coverage) row.status = 'pass';
  const successBundle = buildEvidence(success.run, success.fixture, success.runtimeLock);
  f.bundles.set(successBundle.run.id, successBundle); f.runs.set(successBundle.run.id, successBundle.run);
  f.estimated.run.createdAt = '2026-09-28T00:00:00.000Z'; f.estimated.run.finishedAt = '2026-09-28T00:00:01.000Z';
  const failureBundle = buildEvidence(f.estimated.run, f.estimated.fixture, f.estimated.runtimeLock);
  f.bundles.set(failureBundle.run.id, failureBundle); f.runs.set(failureBundle.run.id, failureBundle.run);
  await page.goto(f.base);
  const latest = page.getByRole('link', { name: 'Latest result', exact: true });
  await latest.waitFor();
  assert.equal(await latest.getAttribute('href'), '#evidence/' + failureBundle.run.id, 'a newer failure must never be replaced by an older passing example');
  await latest.click();
  await page.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.match(await page.locator('.run-summary').innerText(), /Checks failed/);
  assert.equal(await page.getByRole('tab', { name: 'Checks', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('[data-panel="checks"]').isVisible(), true);
  assert.match(await page.locator('[data-panel="checks"]').innerText(), /expected|Expected/);
  assert.match(await page.locator('[data-panel="checks"]').innerText(), /observed|Observed/);
  await openRunTab(page, 'Patch');
  assert.match(await page.locator('#evidence').innerText(), /Model summary/);
  await page.locator('[data-nav="runs"]').click();
  const history = page.locator('#run-history');
  await history.locator(`a[href="#evidence/${failureBundle.run.id}"]`).waitFor();
  assert.equal(await history.locator(`a[href="#evidence/${successBundle.run.id}"]`).count(), 1);
  assert.match(await history.innerText(), /Checks failed/);
  assert.match(await history.innerText(), /All listed checks passed/);
  await history.locator(`a[href="#evidence/${successBundle.run.id}"]`).click();
  await page.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Patch', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(f.requests.length, 0, 'all saved-result and tab exploration is read-only');
  assert.deepEqual(f.errors, []);
});

test('run tabs work from the keyboard and saved requirements retain their recorded identity', async t => {
  const f = await fixtureServer(); t.after(f.close); const { page } = f;
  f.meta.tasks[0]!.title = 'Later catalogue title';
  f.meta.tasks[0]!.requirements = [{ id: 'R01', text: 'A different current requirement.' }];
  f.meta.tasks[0]!.sourceDigest = digestJson('later synthetic source');
  f.meta.tasks[0]!.policyDigest = digestJson('later synthetic policy');
  await page.goto(f.base + '/#evidence/' + f.estimated.run.id);
  await page.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.match(await page.locator('.run-summary').innerText(), /Synthetic maintenance curated-example-01/);
  assert.doesNotMatch(await page.locator('#evidence').innerText(), /Later catalogue title|A different current requirement/);
  const checks = page.getByRole('tab', { name: 'Checks', exact: true });
  await checks.focus(); await page.keyboard.press('ArrowRight');
  const activity = page.getByRole('tab', { name: 'Activity', exact: true });
  assert.equal(await activity.getAttribute('aria-selected'), 'true');
  assert.equal(await activity.evaluate(element => element === document.activeElement), true);
  assert.match(await page.locator('[data-panel="activity"]').innerText(), /Synthetic record assembled/);
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab', { name: 'Run details', exact: true }).getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('[data-panel="details"]').innerText(), /Model cost/i);
  await page.keyboard.press('Home');
  assert.equal(await page.getByRole('tab', { name: 'Patch', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByRole('tab', { name: 'Run details', exact: true }).getAttribute('aria-selected'), 'true');
  await openRunTab(page, 'Checks');
  await page.getByText('Requirements checked', { exact: true }).click();
  assert.match(await page.locator('[data-panel="checks"]').innerText(), /Preserve the declared value/);
  assert.doesNotMatch(await page.locator('[data-panel="checks"]').innerText(), /A different current requirement/);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});

test('stream updates preserve keyboard focus and open check details on the same active run', async t => {
  const f = await fixtureServer(); t.after(f.close); const { page } = f;
  const completed = example('curated-example-02', 'live');
  const active = structuredClone(completed.run);
  active.phase = 'check'; active.terminalStatus = null; active.finishedAt = null;
  f.runs.set(active.id, active); f.bundles.set(active.id, completed);
  await page.goto(f.base + '/#evidence/' + active.id);
  await page.locator('.run-summary .outcome').filter({ hasText: 'Checking' }).waitFor();
  await openRunTab(page, 'Checks');
  const disclosure = page.locator('[data-panel="checks"] details').filter({ has: page.locator('summary').filter({ hasText: /^Requirements checked$/ }) });
  await disclosure.locator('summary').click();
  await disclosure.locator('summary').focus();
  await eventually(() => f.streams.has(active.id), 'the existing run stream is connected');
  active.events.push({ sequence: 2, timestamp: new Date().toISOString(), phase: 'check', message: 'Synthetic refresh preserves the reviewer position.' });
  f.streams.get(active.id)!.write('event: state\ndata: {}\n\n');
  await page.waitForFunction(() => document.querySelector('.event-list')?.textContent?.includes('Synthetic refresh preserves'));
  assert.equal(await disclosure.evaluate(element => (element as HTMLDetailsElement).open), true);
  assert.equal(await disclosure.locator('summary').evaluate(element => element === document.activeElement), true);
  assert.equal(await page.getByRole('tab', { name: 'Checks', exact: true }).getAttribute('aria-selected'), 'true');
  f.finish(active.id);
  await page.locator('.run-summary[data-context-state="ready"] .outcome').filter({ hasText: 'Checks failed' }).waitFor();
  await page.getByRole('link', { name: 'Compare approaches', exact: true }).click();
  assert.equal(await page.locator('#compare-task').inputValue(), active.taskId, 'comparison opened from an addressed failed run stays on that task');
  assert.equal(f.requests.length, 0); assert.deepEqual(f.errors, []);
});
