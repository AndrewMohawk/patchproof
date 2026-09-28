import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
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

test('live UI uses enabled curated IDs and live requests, real event phases, runtime pins and explicit cost labels', async t => {
  const f = await fixtureServer(); t.after(f.close); const { page } = f;
  const unrelated = structuredClone(f.estimated.run); unrelated.id = randomUUID(); unrelated.phase = 'check'; unrelated.terminalStatus = null; unrelated.finishedAt = null;
  f.runs.set(unrelated.id, unrelated);
  await page.goto(f.base + '/#evidence/' + unrelated.id);
  await page.locator('.run-summary .outcome').filter({ hasText: 'Checking' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cancel run', exact: true }).count(), 0);
  await page.locator('[data-nav="tasks"]').click();
  await page.getByText('Live model · Local Docker checks', { exact: true }).first().waitFor();
  assert.equal(await page.locator('.task-card').count(), 2);
  assert.equal(await page.getByRole('link', { name: 'Watch demo ↗', exact: true }).getAttribute('href'), '/demo/');
  assert.match(await page.locator('#task-detail').innerText(), /2 runs remaining/);
  assert.doesNotMatch(await page.locator('#task-detail').innerText(), /Scripted|Paid execution is unavailable|Nebius Sandbox/);
  assert.match(await page.locator('#task-detail').innerText(), /786,432.*6,000.*300 s/);
  await page.locator('.task-card[data-task-id="curated-example-02"]').click();
  await page.getByRole('button', { name: 'Run PatchProof →', exact: true }).click();
  await page.locator('.run-summary .outcome').filter({ hasText: 'Repairing' }).waitFor();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0]!.taskId, 'curated-example-02'); assert.equal(f.requests[0]!.mode, 'live');
  await page.locator('#evidence').getByText('LIVE MODEL · LOCAL DOCKER CHECKS', { exact: true }).waitFor();
  assert.match(await page.locator('.accounting').innerText(), /Provider cost\s+Not measured/);
  assert.equal(await page.getByRole('button', { name: 'Cancel run', exact: true }).isEnabled(), true);
  const id = [...f.runs.values()].find(run => run.phase !== 'terminal' && run.id !== unrelated.id)!.id;
  await page.waitForFunction(() => document.querySelector('.event-list')?.textContent?.includes('Invented progress event'));
  const streamDeadline = Date.now() + 8000;
  while (!f.streams.has(id) && Date.now() < streamDeadline) await new Promise(done => setTimeout(done, 10));
  assert.ok(f.streams.has(id), 'UI must establish the synthetic event stream');
  const active = f.runs.get(id)!; active.phase = 'check'; active.events.push({ sequence: 2, timestamp: new Date().toISOString(), phase: 'check', message: 'Invented independent check progress.' });
  f.streams.get(id)!.write('event: state\ndata: {}\n\n');
  await page.locator('.run-summary .outcome').filter({ hasText: 'Checking' }).waitFor();
  f.runs.set(id, f.bundles.get(id)!.run); f.streams.get(id)!.end('event: terminal\ndata: {}\n\n');
  await page.locator('.run-summary[data-context-state="ready"] .outcome').filter({ hasText: 'Checks failed' }).waitFor();
  assert.match(await page.locator('.digest-list').innerText(), /Check runtime\s+Local Docker checks/);
  assert.match(await page.locator('.digest-list').innerText(), /Model service\s+Nebius Token Factory/);
  assert.doesNotMatch(await page.locator('#evidence').innerText(), /Nebius Sandbox checks/);
  await page.locator('[data-nav="compare"]').click(); await page.locator('#compare-task').selectOption('curated-example-01');
  await page.getByText('$0.00000012 (estimate)', { exact: true }).waitFor();
  assert.match(await page.locator('#comparison').innerText(), /MOCK MODEL · LOCAL CHECKS/);
  assert.match(await page.locator('#comparison').innerText(), /RECORDED LIVE · LOCAL DOCKER CHECKS/);
  await page.goto(f.base + '/#evidence/' + f.historical.run.id); await page.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.match(await page.locator('.run-summary').innerText(), /MOCK MODEL · LOCAL CHECKS/);
  assert.match(await page.locator('.accounting').innerText(), /Provider cost\s+\$0\.00/);
  await page.goto(f.base + '/#evidence/' + f.estimated.run.id); await page.locator('.run-summary[data-context-state="ready"]').waitFor();
  assert.match(await page.locator('.accounting').innerText(), /\$0\.00000012 \(estimate\)/);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(f.base);
    await page.getByRole('button', { name: 'Run PatchProof →', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement !== document.body));
  assert.deepEqual(f.errors, []);
});

test('live capabilities and task availability fail closed while old mock mode remains usable', async t => {
  const f = await fixtureServer(); t.after(f.close); const { page } = f;
  f.meta.tasks[1]!.executionSupported = false;
  await page.goto(f.base); await page.locator('.task-card[data-task-id="curated-example-02"]').click();
  assert.equal(await page.getByRole('button', { name: 'Run PatchProof →', exact: true }).isDisabled(), true);
  f.meta.availability = { enabled: false, reason: 'Allowance used. Review saved evidence.', remainingRuns: 0 };
  f.meta.realExecutionEnabled = false; await page.reload(); await page.locator('.task-card[data-task-id="curated-example-01"]').click();
  assert.equal(await page.getByRole('button', { name: 'Run PatchProof →', exact: true }).isDisabled(), true);
  assert.match(await page.locator('#task-detail').innerText(), /Allowance used.*Review saved evidence/s);
  assert.match(await page.locator('#task-detail').innerText(), /0 runs remaining/);
  f.meta.realExecutionEnabled = true; f.meta.capabilities.createRuns = false; await page.reload(); await page.locator('.task-card[data-task-id="curated-example-01"]').click();
  assert.equal(await page.getByRole('button', { name: 'Run PatchProof →', exact: true }).isDisabled(), true);
  assert.equal(f.requests.length, 0);
  f.meta.mode = 'mock'; f.meta.realExecutionEnabled = false; f.meta.capabilities.createRuns = true; f.meta.tasks[0]!.mockSupported = true;
  await page.reload(); await page.getByText('Mock model · Local checks', { exact: true }).first().waitFor();
  assert.equal(await page.locator('#demo-link').isHidden(), true);
  await page.getByRole('button', { name: 'Run PatchProof →', exact: true }).click();
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
  await f.page.goto(f.base); await f.page.getByRole('button', { name: 'Compare all three', exact: true }).click();
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
      await f.page.goto(f.base); await f.page.getByRole('button', { name: 'Compare all three', exact: true }).click();
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
  await f.page.goto(f.base); await f.page.getByRole('button', { name: 'Compare all three', exact: true }).click();
  await eventually(() => f.requests.length === 3, 'mock comparison launches all approaches without waiting for a terminal');
  assert.deepEqual(f.requests.map(request => request.variant), ['baseline', 'checks_only', 'patchproof']);
  assert.ok(f.requests.every(request => request.mode === 'mock')); assert.equal(f.activity.maxActive, 3); assert.equal(f.activity.overlapAttempts, 0);
});
