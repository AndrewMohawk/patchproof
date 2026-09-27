import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createMockServer } from '../apps/api/src/server.ts';
import { RunViewSchema, ApiErrorSchema } from '../packages/contracts/src/index.ts';
import { verifyBundle } from '../packages/mock/src/bundle.ts';

test('real loopback HTTP flow: catalogue → mock record → events → typed evidence', async t => {
  const { server, coordinator } = createMockServer({ mode: 'mock' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, value: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value),
  });
  const request = { taskId: 'contract-smoke', mode: 'mock', variant: 'baseline', idempotencyKey: 'http-contract-01' };
  // Node fetch normalizes Host, so send the actual header with the HTTP client.
  const badHost = await new Promise<Response>((resolve, reject) => {
    const req = httpRequest(`${base}/tasks`, { headers: { Host: 'example.com' } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode! })));
    });
    req.on('error', reject); req.end();
  });

  const tasksResponse = await fetch(`${base}/tasks`);
  const tasks = await tasksResponse.json();
  assert.equal(tasks.mode, 'mock');
  assert.equal(tasks.allowance.maxApprovedSpendUsd, 0);
  assert.equal(tasks.tasks.length, 1);
  assert.equal(tasks.tasks[0].executable, false);

  const [created, reused] = await Promise.all([post('/runs', request), post('/runs', request)]);
  assert.deepEqual([created.status, reused.status].sort(), [200, 201]);
  const run = RunViewSchema.parse(await created.json());
  assert.equal(RunViewSchema.parse(await reused.json()).id, run.id);
  await coordinator.settled();

  const history = await fetch(`${base}/runs/${run.id}/events`);
  assert.match(history.headers.get('content-type')!, /text\/event-stream/);
  const historyText = await history.text();
  const events = historyText.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4]);
  assert.ok(events.every(event => event.mode === 'mock' && event.competitionReady === false));
  const resumed = await fetch(`${base}/runs/${run.id}/events`, { headers: { 'Last-Event-ID': '3' } });
  const resumedText = await resumed.text();
  assert.match(resumedText, /id: 4/);
  assert.doesNotMatch(resumedText, /id: 1/);

  const exported = await fetch(`${base}/runs/${run.id}/evidence`);
  assert.equal(exported.headers.get('content-disposition'), `attachment; filename="${run.id}.json"`);
  const bundle = verifyBundle(await exported.json());
  assert.equal(bundle.run.terminalStatus, 'needs_review');
  assert.equal(bundle.run.evidence!.executionPerformed, false);

  const page = await fetch(base);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  const shell = await page.text();
  // The same shell supports live/mock archives. Rendered mode comes from /tasks;
  // until metadata loads, it must remain neutral with execution disabled.
  assert.match(shell, /Loading workspace…/);
  assert.match(shell, /id="compare-run"[^>]*disabled/);
  for (const path of ['/app.js', '/style.css']) assert.equal((await fetch(`${base}${path}`)).status, 200);

  const deniedCases: Array<[Response, number, string]> = [
    [await post('/runs', { ...request, mode: 'live' }), 403, 'authorization_required'],
    [await post('/runs', { ...request, taskId: 'unknown' }), 400, 'unknown_task'],
    [await post('/runs', { ...request, arbitraryCode: 'not accepted' }), 400, 'invalid_request'],
    [await post('/runs', { ...request, variant: 'patchproof' }), 409, 'idempotency_conflict'],
    [await post('/runs', request, { Origin: 'https://example.com' }), 403, 'origin_denied'],
    [badHost, 403, 'origin_denied'],
    [await fetch(`${base}/tasks`, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403, 'origin_denied'],
    [await fetch(`${base}/runtime-lock.json`), 404, 'not_found'],
    [await post(`/runs/${run.id}/cancel`, { command: 'not accepted' }), 400, 'invalid_request'],
    [await fetch(`${base}/runs/${run.id}/events`, { headers: { 'Last-Event-ID': '999' } }), 400, 'invalid_request'],
    [await post('/runs', { ...request, extra: 'x'.repeat(8192) }), 413, 'invalid_request'],
  ];
  for (const [response, status, code] of deniedCases) {
    assert.equal(response.status, status, `${response.url} expected ${code}`);
    const body = ApiErrorSchema.parse(await response.json());
    assert.equal(body.error.code, code);
    assert.equal(body.mode, 'mock');
  }
});
