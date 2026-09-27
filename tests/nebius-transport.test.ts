import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NebiusSandboxTransport } from '../workers/sandbox/nebius.ts';

// Synthetic transports only. These tests never contact the documented endpoint.
const id = '12345678-9abc-4aba-aeda-0123456789ab';
const signal = () => new AbortController().signal;
const credential = async () => ({ token: 'test-token-secret', projectId: 'project-synthetic' });
const spawnInput = { imageUuid: id, files: { '/candidate/solution.py': { uuid: id, uid: 65534, gid: 65534, mode: '0444' } }, entrypoint: '/candidate/solution.py',
  invocation: { function: 'unique', args: [[1]], kwargs: {} }, timeoutSeconds: 10 };

test('binary upload validates exact bytes, SHA256 and documented unknown size', async () => {
  const source = '# Unicode: \u03bb\ndef unique(values): return values\n';
  const transport = new NebiusSandboxTransport({ authorized: true, credential, fetch: async (url, options) => {
    assert.equal(String(url), 'https://api.tokenfactory.nebius.com/sandboxes/v1/files');
    const bytes = Buffer.from(options!.body as Uint8Array);
    assert.equal(bytes.toString(), source);
    assert.equal(new Headers(options!.headers).get('Content-Type'), 'application/octet-stream');
    return Response.json({ uuid: id, sha256: createHash('sha256').update(bytes).digest('hex'), size: -1 }, { status: 201 });
  } });
  assert.equal(await transport.uploadSource(source, signal()), id);
});

test('authorization and already-aborted requests do not resolve credentials or dispatch', async () => {
  let credentials = 0, requests = 0;
  const options = { credential: async () => { credentials++; return credential(); }, fetch: async () => { requests++; return new Response(); } };
  await assert.rejects(new NebiusSandboxTransport({ ...options, authorized: false }).getOperation(id, signal()), /authorization_required/);
  await assert.rejects(new NebiusSandboxTransport({ ...options, authorized: true }).getOperation(id, AbortSignal.abort()), /cancelled/);
  assert.equal(credentials, 0); assert.equal(requests, 0);
});

test('project mismatch fails before dispatch and injected credential errors never escape', async () => {
  let requests = 0;
  const fetch = async () => { requests++; return new Response(); };
  await assert.rejects(new NebiusSandboxTransport({ authorized: true, credential, fetch, expectedProjectId: 'other' }).getOperation(id, signal()), /project_mismatch/);
  await assert.rejects(new NebiusSandboxTransport({ authorized: true, fetch, credential: async () => { throw new Error('credential-secret'); } }).getOperation(id, signal()),
    error => error instanceof Error && error.message === 'sandbox_transport_error');
  assert.equal(requests, 0);
});

test('HTTP and transport errors expose stable codes without provider bodies or secrets', async () => {
  for (const fetch of [async () => new Response('secret-provider-body', { status: 403 }), async (): Promise<Response> => { throw new Error('test-token-secret'); }]) {
    const transport = new NebiusSandboxTransport({ authorized: true, credential, fetch });
    await assert.rejects(transport.getOperation(id, signal()), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^sandbox_(http_403|transport_error)$/);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});

test('response byte limit rejects oversized bodies instead of parsing unbounded JSON', async () => {
  const transport = new NebiusSandboxTransport({ authorized: true, credential, fetch: async () => new Response('x'.repeat(1_048_577)) });
  await assert.rejects(transport.getOperation(id, signal()), /sandbox_response_limit/);
});

test('request deadlines bound ignored fetch signals, stalled credentials and stalled response streams', async () => {
  // The explicit scoped timer keeps Node alive while AbortSignal.timeout uses an unref'ed timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    for (const stall of ['credentials', 'fetch', 'body']) {
      let cancelledBody = false;
      const transport = new NebiusSandboxTransport({ authorized: true, requestTimeoutMs: 15,
        credential: stall === 'credentials' ? () => new Promise(() => {}) : credential,
        fetch: stall === 'fetch' ? () => new Promise(() => {}) : async () => new Response(new ReadableStream({
          start() {}, cancel() { cancelledBody = true; },
        })),
      });
      const started = Date.now();
      await assert.rejects(transport.getOperation(id, signal()), /sandbox_request_timeout/);
      assert.ok(Date.now() - started < 500, `unbounded ${stall}`);
      if (stall === 'body') assert.ok(cancelledBody);
    }
  } finally { clearTimeout(keepAlive); }
});

test('spawn ignores Location, rejects incomplete file mappings and never follows redirected credentials', async () => {
  let requests = 0;
  const transport = new NebiusSandboxTransport({ authorized: true, credential, fetch: async (_url, options) => {
    requests++; assert.equal(options!.redirect, 'error');
    return Response.json({ uuid: id }, { status: 201, headers: { Location: 'https://untrusted.invalid/steal-token' } });
  } });
  await assert.rejects(transport.spawnInvocation({ ...spawnInput, files: {} }, signal()), /invalid_sandbox_request/);
  assert.equal(await transport.spawnInvocation(spawnInput, signal()), id);
  assert.equal(requests, 1);
});

test('operation identity and cancellation response must match the documented contract', async () => {
  const wrongIdentity = new NebiusSandboxTransport({ authorized: true, credential, fetch: async () => Response.json({
    uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'instance', status: 'SUCCESS', metadata: {},
  }) });
  await assert.rejects(wrongIdentity.getOperation(id, signal()), /invalid_operation_response/);
  const wrongStatus = new NebiusSandboxTransport({ authorized: true, credential, fetch: async () => new Response(null, { status: 200 }) });
  await assert.rejects(wrongStatus.cancel(id, signal()), /cancellation_unconfirmed/);
});
