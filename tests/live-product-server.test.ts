import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createProductServer, type ProductLiveMetadata, type ProductLiveAvailability } from '../apps/api/src/product-server.ts';
import type { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { ContractError } from '../packages/contracts/src/index.ts';
import { ProductRunRequestSchema, type ProductRun } from '../packages/contracts/src/product.ts';
import { syntheticArchiveBundle } from './helpers/archive-fixture.ts';

const execution = { modelProvider: 'nebius-token-factory', checkBackend: 'local_container', modelId: 'synthetic/server-model' } as const;
const hosts = ['patchproof.example.test', 'patchproof.alias.test'];
const live: ProductLiveMetadata = { execution, runtimeLockDigest: 'sha256:' + '1'.repeat(64), allowedHosts: hosts,
  limits: { inferenceCallLimit: 3, inputTokenLimit: 786432, outputTokenLimit: 6000, wallTimeLimitSeconds: 300, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: .1 } };
function fakeCoordinator(mode: 'live' | 'mock' = 'live') {
  const seed = syntheticArchiveBundle(mode, '2.2'); const runs = new Map<string, ProductRun>(), keys = new Map<string, ProductRun>();
  let creates = 0, cancellations = 0;
  const api = {
    tasks: () => [{ id: seed.fixture.id, title: seed.fixture.title }], list: () => [...runs.values()],
    get: (id: string) => { const run = runs.get(id); if (!run) throw new ContractError('not_found', 'Run not found.', 404); return run; },
    create: (value: unknown) => {
      const request = ProductRunRequestSchema.parse(value); creates++;
      if (request.mode !== mode) throw new ContractError('authorization_required', 'Mode unavailable.', 403);
      if (request.taskId !== seed.fixture.id) throw new ContractError('unknown_task', 'Curated task required.');
      const previous = keys.get(request.idempotencyKey); if (previous) return { run: previous, reused: true };
      const run = structuredClone(seed.run); run.id = randomUUID(); runs.set(run.id, run); keys.set(request.idempotencyKey, run);
      return { run, reused: false };
    },
    cancel: (id: string) => { cancellations++; return api.get(id); },
    evidence: async (id: string) => ({ ...seed, run: api.get(id) }), subscribe: () => () => {},
  };
  return { api: api as unknown as Coordinator, seed, counts: () => ({ creates, cancellations }) };
}
async function serve(metadata: ProductLiveMetadata | null = live, fake = fakeCoordinator(metadata ? 'live' : 'mock'), availabilitySource?: () => ProductLiveAvailability) {
  const options = { approvedSpendUsd: 25, localRuntime: { available: true, image: 'synthetic-image', reason: null }, ...(metadata ? { live: structuredClone(metadata) } : {}), ...(availabilitySource ? { liveAvailability: availabilitySource } : {}) };
  const server = createProductServer(fake.api, options); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const headers = metadata?.allowedHosts ? { Host: metadata.allowedHosts[0]!, Origin: `https://${metadata.allowedHosts[0]}` } : {};
  // Native fetch normalizes Host to its URL; raw HTTP models the local reverse proxy's exact Host header.
  const send = (path: string, method: string, requestHeaders: Record<string, string>, body?: string) => new Promise<Response>((done, reject) => {
    const req = httpRequest(base + path, { method, headers: requestHeaders }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.on('error', reject);
      res.on('end', () => { const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) {
          for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, item);
        }
        done(new Response(Buffer.concat(chunks).toString('utf8'), { status: res.statusCode!, headers: responseHeaders }));
      });
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Synthetic HTTP request timed out.'))); req.end(body);
  });
  const get = (path: string, extra: Record<string, string> = {}) => send(path, 'GET', { ...headers, ...extra });
  const post = (path: string, body: unknown, extra: Record<string, string> = {}) => send(path, 'POST', { ...headers, 'Content-Type': 'application/json', ...extra }, JSON.stringify(body));
  return { ...fake, base, options, get, post, close: async () => { if (!server.listening) return; server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}
const input = (taskId: string, key: string, mode: 'live' | 'mock' = 'live') => ({ taskId, variant: 'patchproof', mode, idempotencyKey: key });
function cookie(response: Response) {
  const header = response.headers.get('set-cookie'); assert.ok(header); assert.match(header, /^__Host-patchproof-session=[A-Za-z0-9_-]{43};/);
  for (const part of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict']) assert.ok(header.includes(part));
  assert.doesNotMatch(header, /Domain=/); return header.split(';')[0]!;
}

test('default product server remains mock with loopback guard and existing cancellation behavior', async t => {
  const f = await serve(null, fakeCoordinator('mock')); t.after(f.close);
  const tasks = await (await f.get('/tasks')).json(); assert.equal(tasks.mode, 'mock'); assert.equal(tasks.realExecutionEnabled, false); assert.equal(tasks.limits.maxApprovedSpendUsd, 0);
  assert.deepEqual(await (await f.get('/healthz')).json(), { status: 'ok', mode: 'mock' });
  assert.equal((await f.get('/tasks', { Host: hosts[0]! })).status, 403);
  const created = await f.post('/runs', input(f.seed.fixture.id, 'default-mock-create', 'mock')); assert.equal(created.status, 201); assert.equal(created.headers.get('set-cookie'), null);
  const run = await created.json(); assert.equal((await f.post(`/runs/${run.id}/cancel`, {})).status, 200);
});

test('live metadata and HTTPS hosts are explicit snapshots, while mismatched origins and forwarded hosts cannot override guards', async t => {
  const f = await serve(); t.after(f.close);
  f.options.live!.execution.modelId = 'changed-after-construction'; f.options.live!.allowedHosts!.push('unapproved.example.test'); f.options.live!.limits.maxApprovedSpendUsd = 25;
  const tasks = await (await f.get('/tasks')).json(); assert.equal(tasks.mode, 'live'); assert.equal(tasks.realExecutionEnabled, true);
  assert.equal(tasks.execution.modelId, execution.modelId); assert.equal(tasks.runtimeLockDigest, live.runtimeLockDigest); assert.deepEqual(tasks.limits, live.limits);
  assert.ok(tasks.tasks.every((task: { executionSupported: boolean }) => task.executionSupported));
  for (const host of hosts) assert.deepEqual(await (await f.get('/healthz', { Host: host, Origin: `https://${host}` })).json(), { status: 'ok', mode: 'live', modelProvider: execution.modelProvider, checkBackend: execution.checkBackend });
  for (const extra of [{ Host: 'unapproved.example.test', Origin: 'https://unapproved.example.test' }, { Origin: `https://${hosts[1]}` }, { Origin: `http://${hosts[0]}` },
    { 'Sec-Fetch-Site': 'cross-site' }, { Host: 'localhost:9999', 'X-Forwarded-Host': hosts[0]! }]) {
    const denied = await f.get('/tasks', extra); assert.equal(denied.status, 403); assert.equal((await denied.json()).mode, 'live');
  }
  assert.deepEqual(f.counts(), { creates: 0, cancellations: 0 });
});

test('opaque browser ownership protects live cancellation without changing public run or evidence access', async t => {
  const f = await serve(); t.after(f.close);
  assert.equal((await f.get('/tasks')).headers.get('set-cookie'), null);
  const a = await f.post('/runs', input(f.seed.fixture.id, 'session-a-first')); const ca = cookie(a), ra = await a.json();
  const b = await f.post('/runs', input(f.seed.fixture.id, 'session-b-first')); const cb = cookie(b), rb = await b.json(); assert.notEqual(ca, cb);
  assert.deepEqual((await (await f.get('/runs')).json()).ownedRunIds, []);
  assert.deepEqual((await (await f.get('/runs', { Cookie: ca })).json()).ownedRunIds, [ra.id]);
  assert.deepEqual((await (await f.get('/runs', { Cookie: cb })).json()).ownedRunIds, [rb.id]);
  for (const headers of [{}, { Cookie: cb }, { Cookie: '__Host-patchproof-session=unknown' }, { Cookie: ca + '; ' + ca }]) assert.equal((await f.post(`/runs/${ra.id}/cancel`, {}, headers)).status, 403);
  assert.equal(f.counts().cancellations, 0);
  assert.equal((await f.post(`/runs/${ra.id}/cancel`, { injected: true }, { Cookie: ca })).status, 400);
  assert.equal((await f.post(`/runs/${ra.id}/cancel`, {}, { Cookie: ca })).status, 200); assert.equal(f.counts().cancellations, 1);
  assert.equal((await f.get(`/runs/${ra.id}`)).status, 200);
  const evidence = await f.get(`/runs/${ra.id}/evidence`); assert.equal(evidence.status, 200); assert.equal(evidence.headers.get('content-disposition'), `attachment; filename="${ra.id}.json"`);
  const reused = await f.post('/runs', input(f.seed.fixture.id, 'session-a-first'), { Cookie: cb }); assert.equal(reused.status, 200); assert.equal(reused.headers.get('set-cookie'), null);
  assert.equal((await reused.json()).id, ra.id); assert.deepEqual((await (await f.get('/runs', { Cookie: cb })).json()).ownedRunIds, [rb.id]);
  assert.equal((await f.post(`/runs/${ra.id}/cancel`, {}, { Cookie: cb })).status, 403);
  const anonymousReuse = await f.post('/runs', input(f.seed.fixture.id, 'session-a-first')); assert.equal(anonymousReuse.headers.get('set-cookie'), null);
  const ownReuse = await f.post('/runs', input(f.seed.fixture.id, 'session-a-first'), { Cookie: ca }); assert.equal(ownReuse.status, 200);
  const events = await f.get(`/runs/${ra.id}/events`); assert.match(await events.text(), /event: terminal/);
  assert.equal((await f.get(`/runs/${ra.id}/events`, { 'Last-Event-ID': '999' })).status, 400);
});

test('a process restart never grants an old or replayed cookie ownership of retained public history', async t => {
  const fake = fakeCoordinator(); const first = await serve(live, fake); t.after(first.close);
  const response = await first.post('/runs', input(fake.seed.fixture.id, 'before-process-restart')); const beforeCookie = cookie(response), run = await response.json(); await first.close();
  const second = await serve(live, fake); t.after(second.close);
  assert.equal((await second.get(`/runs/${run.id}`)).status, 200);
  assert.deepEqual((await (await second.get('/runs', { Cookie: beforeCookie })).json()).ownedRunIds, []);
  assert.equal((await second.post(`/runs/${run.id}/cancel`, {}, { Cookie: beforeCookie })).status, 403);
  const replay = await second.post('/runs', input(fake.seed.fixture.id, 'before-process-restart'), { Cookie: beforeCookie }); assert.equal(replay.status, 200); assert.equal(replay.headers.get('set-cookie'), null);
});

test('invalid live host/runtime metadata is refused before serving or coordinator work', () => {
  const fake = fakeCoordinator();
  for (const change of [{ allowedHosts: ['https://patchproof.example.test'] }, { allowedHosts: ['127.0.0.1'] }, { allowedHosts: [] },
    { execution: { ...execution, checkBackend: 'invented' } }, { runtimeLockDigest: 'not-a-digest' }, { limits: { ...live.limits, maxApprovedSpendUsd: -1 } }]) {
    assert.throws(() => createProductServer(fake.api, { approvedSpendUsd: 25, localRuntime: { available: true, image: null, reason: null }, live: { ...live, ...change } as ProductLiveMetadata }));
  }
  assert.deepEqual(fake.counts(), { creates: 0, cancellations: 0 });
});


test('budget availability pauses only new runs, preserves owned cancellation and public history, and fails closed on callback errors', async t => {
  const state: ProductLiveAvailability = { enabled: true, reason: null, remainingRuns: 2 }; let unavailable = false;
  const f = await serve(live, fakeCoordinator(), () => { if (unavailable) throw new Error('private operator details'); return state; }); t.after(f.close);
  const created = await f.post('/runs', input(f.seed.fixture.id, 'availability-owner')); const token = cookie(created), run = await created.json();
  state.enabled = false; state.reason = 'Allowance used. Review saved evidence.'; state.remainingRuns = 0;
  f.options.liveAvailability = () => ({ enabled: true, reason: null, remainingRuns: 999 }); // cannot replace the captured reader
  const paused = await (await f.get('/tasks')).json(); assert.equal(paused.realExecutionEnabled, false); assert.equal(paused.capabilities.createRuns, false);
  assert.equal(paused.capabilities.cancelRuns, true); assert.deepEqual(paused.availability, state); assert.equal(paused.mode, 'live');
  const denied = await f.post('/runs', input(f.seed.fixture.id, 'availability-denied'), { Cookie: token }); assert.equal(denied.status, 403); assert.equal(f.counts().creates, 1);
  assert.equal((await f.get(`/runs/${run.id}/evidence`)).status, 200); assert.deepEqual((await (await f.get('/runs', { Cookie: token })).json()).ownedRunIds, [run.id]);
  assert.equal((await f.post(`/runs/${run.id}/cancel`, {}, { Cookie: token })).status, 200);
  state.enabled = true; state.remainingRuns = 1; state.reason = null;
  assert.equal((await (await f.get('/tasks')).json()).capabilities.createRuns, true);
  unavailable = true;
  const failedReader = await (await f.get('/tasks')).json(); assert.equal(failedReader.capabilities.createRuns, false); assert.doesNotMatch(JSON.stringify(failedReader), /private operator details/);
  assert.equal((await f.post('/runs', input(f.seed.fixture.id, 'availability-reader-error'))).status, 403); assert.equal(f.counts().creates, 1);
  assert.equal((await f.get(`/runs/${run.id}`)).status, 200);
});
