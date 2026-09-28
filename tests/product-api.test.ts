import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApplication } from '../apps/api/src/application.ts';
import { verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { loadFixtures } from '../packages/orchestrator/src/fixtures.ts';

test('product HTTP refuses arbitrary/live requests and durably exports an actual cancellation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-product-http-'));
  const app = await createApplication(new URL('../', import.meta.url), directory);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); await new Promise<void>(resolve => app.server.close(() => resolve())); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const request = { taskId: 'stable-unique-01', variant: 'patchproof', mode: 'mock', idempotencyKey: 'product-http-cancel' };
  const tasks = await (await fetch(base + '/tasks')).json();
  assert.equal(tasks.realExecutionEnabled, false); assert.equal(tasks.competitionReady, false);
  assert.equal(tasks.maxApprovedSpendUsd, 25);
  assert.equal(tasks.tasks.length, (await loadFixtures(new URL('../', import.meta.url))).length);
  assert.ok(tasks.tasks.every((item: Record<string, unknown>) => !('acceptanceCases' in item) && 'files' in item && 'examples' in item));
  for (const [body, expectedStatus, expectedCode] of [
    [{ ...request, mode: 'live' }, 403, 'authorization_required'],
    [{ ...request, taskId: 'not-curated' }, 400, 'unknown_task'],
    [{ ...request, source: 'arbitrary code' }, 400, 'invalid_request'],
    [{ ...request, runtimeLock: {} }, 400, 'invalid_request'],
  ] as const) {
    const denied = await post('/runs', body); assert.equal(denied.status, expectedStatus);
    assert.equal((await denied.json()).error.code, expectedCode);
  }
  const foreign = await post('/runs', request, { Origin: 'https://unrelated.example' });
  assert.equal(foreign.status, 403);
  const created = await post('/runs', request); assert.equal(created.status, 201);
  const run = await created.json();
  assert.equal((await post(`/runs/${run.id}/cancel`, { injected: true })).status, 400);
  assert.equal((await post(`/runs/${run.id}/cancel`, {})).status, 200);
  await app.coordinator.settled();
  const reused = await post('/runs', request); assert.equal(reused.status, 200);
  assert.equal((await reused.json()).id, run.id);
  const response = await fetch(`${base}/runs/${run.id}/evidence`);
  assert.equal(response.status, 200);
  const bundle = verifyEvidence(await response.json());
  assert.equal(bundle.run.terminalStatus, 'needs_review'); assert.equal(bundle.run.reason, 'cancelled');
  assert.equal(bundle.run.usage.measuredCostUsd, 0);
  assert.equal(response.headers.get('x-patchproof-digest'), bundle.bundleDigest);
  const resumed = await fetch(`${base}/runs/${run.id}/events`, { headers: { 'Last-Event-ID': String(bundle.run.events.length - 1) } });
  const stream = await resumed.text(); assert.match(stream, /event: terminal/); assert.doesNotMatch(stream, /event: state/);
  assert.equal((await fetch(`${base}/runs/${run.id}/events`, { headers: { 'Last-Event-ID': '999999' } })).status, 400);
  assert.equal((await fetch(base + '/runtime-lock.json')).status, 404);
});
