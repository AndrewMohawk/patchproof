import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FunctionCaseSchema } from '../packages/contracts/src/product.ts';
import { NebiusSandboxCheckRunner, NebiusSandboxTransport, SANDBOX_DOCUMENTATION } from '../workers/sandbox/nebius.ts';
import type { SandboxVerification } from '../workers/sandbox/nebius.ts';

// Entire file uses synthetic account proofs and injected fetch. No provider or Docker calls.
const imageId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
const operationId = (n = 1) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const source = 'def unique(values):\n    return values\n';
const check = (extra: Record<string, unknown> = {}) => FunctionCaseSchema.parse({ id: 'public-check', requirementId: 'R01', function: 'unique', args: [[3, 1, 3]], expected: [3, 1], ...extra });
const input = (extra: Record<string, unknown> = {}) => ({ files: { 'solution.py': source }, entrypoint: 'solution.py', cases: [check()], timeoutSeconds: 10, ...extra });
const signal = () => new AbortController().signal;
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const observation = (extra: Record<string, unknown> = {}) => JSON.stringify({ kind: 'return', value: [3, 1], argsAfter: [[3, 1, 3]], kwargsAfter: {}, ...extra });
function terminal(n = 1, extra: Record<string, unknown> = {}) {
  return { uuid: operationId(n), kind: 'instance', status: 'SUCCESS', image_uuid: imageId, consumed_cpu: 0.125,
    metadata: { image: imageId, result: { state: { exit_code: 0, signal: 0, timed_out: false },
      stdout: { encoding: 'base64', value: Buffer.from(observation()).toString('base64'), truncated: false },
      stderr: { encoding: 'ascii', value: '', truncated: false }, resources: { cost: 12.3 } } }, ...extra };
}
function verification(): SandboxVerification {
  const proof = { verifiedAt: new Date(Date.now() - 1000).toISOString(), evidenceRefs: ['synthetic://fake-transport-only/not-account-proof'] };
  return { schemaVersion: '1.0', validUntil: new Date(Date.now() + 60_000).toISOString(), projectId: 'synthetic-project', imageUuid: imageId,
    immutableImageDigest: `sha256:${'a'.repeat(64)}`, account: proof, image: proof,
    equivalentControls: { isolation: proof, filesystemProtection: proof, resourceCaps: { ...proof, memoryBytes: 134_217_728, pids: 32, cpuQuota: 0.5 },
      networkDisabled: proof, cancellation: proof, uploadRetention: proof },
    billing: { ...proof, conservativeBatchChargeCeilingUsd: 0.1 }, limits: { maxCases: 10, maxSourceBytes: 262_144, maxTimeoutSeconds: 30 } };
}
interface Call { url: string; method: string; options: RequestInit; }
function setup(handler?: (call: Call) => Response | Promise<Response> | undefined, receipt = verification(), overrides = {}) {
  const calls: Call[] = [];
  let credentials = 0, spawned = 0;
  const transport = new NebiusSandboxTransport({ authorized: true, expectedProjectId: 'synthetic-project', requestTimeoutMs: 100,
    credential: async () => { credentials++; return { token: 'synthetic-secret-NEVER-LOG', projectId: 'synthetic-project' }; },
    fetch: async (url, options) => {
      const call = { url: String(url), method: options!.method!, options: options! };
      calls.push(call);
      assert.ok(call.url.startsWith('https://api.tokenfactory.nebius.com/sandboxes/v1/'));
      assert.equal((options!.headers as Record<string, string>).Project, 'synthetic-project');
      const override = await handler?.(call);
      if (override) return override;
      if (call.url.endsWith('/files')) {
        const bytes = Buffer.from(options!.body as Uint8Array);
        return json({ uuid: fileId, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }, 201);
      }
      if (call.url.endsWith('/instances')) return json({ uuid: operationId(++spawned) }, 201);
      if (call.method === 'DELETE') return new Response(null, { status: 202 });
      return json(terminal(Number(call.url.slice(-12))));
    },
  });
  const runner = new NebiusSandboxCheckRunner({ transport, verification: receipt, authorized: true, maxApprovedSpendUsd: 1, pollIntervalMs: 1, cleanupTimeoutMs: 30, ...overrides });
  return { runner, calls, transport, credentials: () => credentials };
}

test('unverified, expired, unauthorized and wrong-project receipts forbid credential access and requests', async () => {
  assert.equal((await new NebiusSandboxCheckRunner().run(input(), signal())).infrastructureError, 'sandbox_controls_unverified');
  for (const alter of [
    (v: SandboxVerification) => { v.validUntil = new Date(Date.now() - 1).toISOString(); },
    (v: SandboxVerification) => { v.projectId = 'other-project'; },
    (v: SandboxVerification) => { v.equivalentControls.uploadRetention.evidenceRefs = []; },
    (v: SandboxVerification) => { v.image.verifiedAt = new Date(Date.now() + 60_000).toISOString(); },
  ]) {
    const receipt = verification(); alter(receipt);
    const fake = setup(undefined, receipt);
    const result = await fake.runner.run(input(), signal());
    assert.equal(result.infrastructureError, 'sandbox_controls_unverified');
    assert.equal(result.isolation, 'unavailable'); assert.equal(result.cpuSeconds, null); assert.equal(result.measuredCostUsd, null);
    assert.equal(fake.credentials(), 0); assert.deepEqual(fake.calls, []);
  }
  const unauthorized = setup(undefined, verification(), { authorized: false });
  assert.equal((await unauthorized.runner.run(input(), signal())).infrastructureError, 'sandbox_controls_unverified');
  assert.equal(unauthorized.credentials(), 0);
});

test('fake documented lifecycle sends source and invocation only, journals before dispatch and compares on host', async () => {
  const announced: string[] = [];
  let gets = 0;
  const fake = setup(call => {
    if (call.url.endsWith('/files')) assert.match(announced.at(-1)!, /^nebius:upload-intent:/);
    if (call.url.endsWith('/instances')) assert.match(announced.at(-1)!, /^nebius:instance-intent:/);
    if (call.method === 'GET' && gets++ === 0) return json({ uuid: operationId(), kind: 'instance', status: 'EXECUTING', metadata: { image: imageId }, consumed_cpu: null }, 200, { 'Retry-After': '0' });
  });
  const result = await fake.runner.run({ ...input(), onOperation: id => { announced.push(id); } }, signal());
  assert.equal(SANDBOX_DOCUMENTATION.base, 'https://api.tokenfactory.nebius.com/sandboxes/v1');
  assert.equal(result.checks[0]!.status, 'pass'); assert.equal(result.isolation, 'nebius_sandbox');
  assert.equal(result.infrastructureError, null); assert.equal(result.cpuSeconds, 0.125); assert.equal(result.measuredCostUsd, null);
  assert.deepEqual(result.operationIds, announced);
  assert.deepEqual(announced.filter(id => !id.includes('-intent:')), [`nebius:file:${fileId}`, `nebius:operation:${operationId()}`]);
  const upload = fake.calls.find(c => c.url.endsWith('/files'))!;
  assert.equal(Buffer.from(upload.options.body as Uint8Array).toString(), source);
  assert.equal((upload.options.headers as Record<string, string>)['Content-Type'], 'application/octet-stream');
  const request = JSON.parse(fake.calls.find(c => c.url.endsWith('/instances'))!.options.body as string);
  assert.deepEqual(JSON.parse(Buffer.from(request.stdin.value, 'base64').toString()), { function: 'unique', args: [[3, 1, 3]], kwargs: {} });
  assert.deepEqual(request.networking, { enabled: false }); assert.deepEqual(request.env, {});
  assert.equal(request.preserve_env, false); assert.equal(request.shell, false); assert.equal(request.disposable, true);
  assert.deepEqual(request.resources_limits, { max_layer_bytes: 16_777_216 });
  assert.equal(request.image, imageId); assert.equal(request.files['/candidate/solution.py'].mode, '0444');
  assert.ok(request.timeout > 0 && request.timeout <= 10);
  assert.ok(!JSON.stringify(request).includes('expected'));
  assert.match(result.checks[0]!.log, /providerCostUnspecifiedUnit/);
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
});

test('attested finite positive CPU quota is accepted independently of local Docker quota', async () => {
  const receipt = verification();
  receipt.equivalentControls.resourceCaps.cpuQuota = 1;
  const accepted = setup(call => call.method === 'GET' ? json(terminal(1, { consumed_cpu: null })) : undefined, receipt);
  const result = await accepted.runner.run(input(), signal());
  assert.equal(result.infrastructureError, null); assert.equal(result.checks[0]!.status, 'pass');
  assert.equal(result.cpuSeconds, null, 'An attested quota is not measured CPU usage.');
  for (const quota of [NaN, Infinity, 0, -1]) {
    const invalid = verification(); invalid.equivalentControls.resourceCaps.cpuQuota = quota;
    const rejected = setup(undefined, invalid);
    assert.equal((await rejected.runner.run(input(), signal())).infrastructureError, 'sandbox_controls_unverified');
    assert.equal(rejected.credentials(), 0); assert.equal(rejected.calls.length, 0);
  }
});

test('subsecond repeated-check remainder refuses execution before credentials or budget reservation', async () => {
  const fake = setup(undefined, verification(), { maxApprovedSpendUsd: 0.1 });
  const short = await fake.runner.run({ ...input(), timeoutSeconds: 0.8 }, signal());
  assert.equal(short.infrastructureError, 'sandbox_batch_timeout'); assert.equal(short.isolation, 'unavailable');
  assert.equal(fake.credentials(), 0); assert.equal(fake.calls.length, 0);
  assert.equal((await fake.runner.run(input(), signal())).infrastructureError, null, 'An unstarted subsecond batch must not reserve spend.');
});

test('fake candidate PASS text and mutation cannot approve checks; exceptions use the host comparator', async () => {
  for (const [stdout, caseInput, expectedStatus] of [
    ['PASS', check(), 'error'],
    [observation({ argsAfter: [[1, 3]] }), check({ assertArgsUnchanged: true }), 'fail'],
    [observation({ kind: 'exception', exception: 'TypeError', value: undefined, argsAfter: [null] }), FunctionCaseSchema.parse({ id: 'exception-check', requirementId: 'R01', function: 'unique', args: [null], expectedException: 'TypeError' }), 'pass'],
    [observation(), check({ expected: 'ORACLE-SENTINEL-PRIVATE' }), 'fail'],
  ] as const) {
    const fake = setup(call => {
      assert.ok(!String(call.options.body).includes('ORACLE-SENTINEL-PRIVATE'));
      if (call.method === 'GET') {
        const operation = terminal(); operation.metadata.result.stdout = { encoding: 'ascii', value: stdout, truncated: false };
        return json(operation);
      }
    });
    const result = await fake.runner.run({ ...input(), cases: [caseInput] }, signal());
    assert.equal(result.checks[0]!.status, expectedStatus);
  }
});

test('unknown CPU and unspecified-currency cost remain unknown instead of zero or USD', async () => {
  const fake = setup(call => call.method === 'GET' ? json(terminal(1, { consumed_cpu: null })) : undefined);
  const result = await fake.runner.run(input(), signal());
  assert.equal(result.cpuSeconds, null); assert.equal(result.measuredCostUsd, null);
  assert.equal(result.checks[0]!.status, 'pass');
});

test('synchronous intent-journal failure prevents dispatch; operation-journal failure cancels and confirms stop', async () => {
  const before = setup();
  const failed = await before.runner.run({ ...input(), onOperation: () => { throw new Error('secret-disk-error'); } }, signal());
  assert.equal(failed.infrastructureError, 'operation_journal_error'); assert.equal(before.calls.length, 0);
  assert.equal(failed.operationIds.length, 1);
  let cancelled = false;
  const after = setup(call => {
    if (call.method === 'DELETE') { cancelled = true; assert.equal(call.options.signal!.aborted, false); }
    if (call.method === 'GET') { assert.ok(cancelled); return json(terminal(1, { status: 'CANCELLED', consumed_cpu: 0.02 })); }
  });
  const result = await after.runner.run({ ...input(), onOperation: id => { if (id.startsWith('nebius:operation:')) throw new Error('secret-disk-error'); } }, signal());
  assert.equal(result.infrastructureError, 'operation_journal_error'); assert.equal(result.checks[0]!.status, 'error');
  assert.ok(result.operationIds.includes(`nebius:operation:${operationId()}`)); assert.ok(cancelled);
  assert.equal(result.cpuSeconds, 0.02); assert.ok(!JSON.stringify(result).includes('secret-disk-error'));
});

test('caller cancellation uses a fresh cleanup signal and prevents a second operation', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const fake = setup(call => {
    if (call.method === 'DELETE') { assert.equal(call.options.signal!.aborted, false); cancelled = true; }
    if (call.method === 'GET') {
      if (!cancelled) { controller.abort(); return json({ uuid: operationId(), kind: 'instance', status: 'EXECUTING', metadata: {} }); }
      return json(terminal(1, { status: 'CANCELLED' }));
    }
  });
  const result = await fake.runner.run({ ...input(), cases: [check(), check({ id: 'second' })] }, controller.signal);
  assert.equal(result.infrastructureError, 'cancelled'); assert.ok(cancelled);
  assert.equal(fake.calls.filter(c => c.url.endsWith('/instances')).length, 1);
  assert.equal(result.checks.length, 2); assert.ok(result.checks.every(c => c.status === 'error'));
});

test('202 cancellation alone is not termination; bounded cleanup failure keeps the real handle', async () => {
  const fake = setup(call => call.method === 'GET' ? json({ uuid: operationId(), kind: 'instance', status: 'EXECUTING', metadata: {} }) : undefined);
  const result = await fake.runner.run({ ...input(), onOperation: id => { if (id.startsWith('nebius:operation:')) throw new Error('journal'); } }, signal());
  assert.match(result.infrastructureError!, /^operation_journal_error:sandbox_cleanup_unconfirmed$/);
  assert.ok(result.operationIds.includes(`nebius:operation:${operationId()}`)); assert.equal(result.cpuSeconds, null);
  assert.equal(fake.calls.filter(c => c.method === 'DELETE').length, 1);
});

test('lost creation response retains intent, is never retried and never claims cleanup or measured usage', async () => {
  const fake = setup(call => { if (call.url.endsWith('/instances')) throw new Error('provider secret response'); return undefined; });
  const result = await fake.runner.run(input(), signal());
  assert.equal(result.infrastructureError, 'sandbox_transport_error:sandbox_submission_unconfirmed');
  assert.ok(result.operationIds.some(id => id.startsWith('nebius:instance-intent:')));
  assert.equal(fake.calls.filter(c => c.url.endsWith('/instances')).length, 1);
  assert.equal(fake.calls.filter(c => c.method === 'DELETE').length, 0);
  assert.equal(result.cpuSeconds, null); assert.equal(result.measuredCostUsd, null);
  assert.ok(!JSON.stringify(result).includes('provider secret'));
});

test('upload integrity failure retains returned file ID and forbids execution', async () => {
  const fake = setup(call => call.url.endsWith('/files') ? json({ uuid: fileId, sha256: 'b'.repeat(64), size: source.length }, 201) : undefined);
  const result = await fake.runner.run(input(), signal());
  assert.equal(result.infrastructureError, 'sandbox_upload_integrity_mismatch');
  assert.ok(result.operationIds.includes(`nebius:file:${fileId}`));
  assert.equal(fake.calls.filter(c => c.url.endsWith('/instances')).length, 0);
});

test('unexpected successful HTTP status retains a revealed operation UUID and attempts cleanup', async () => {
  let cancelled = false;
  const fake = setup(call => {
    if (call.url.endsWith('/instances')) return json({ uuid: operationId() }, 200);
    if (call.method === 'DELETE') cancelled = true;
    if (call.method === 'GET') return json(terminal(1, { status: 'CANCELLED' }));
    return undefined;
  });
  const result = await fake.runner.run(input(), signal());
  assert.equal(result.infrastructureError, 'sandbox_unexpected_spawn_status');
  assert.ok(cancelled); assert.ok(result.operationIds.includes(`nebius:operation:${operationId()}`));
  assert.equal(result.checks[0]!.status, 'error');
});

test('a reused operation ID cannot approve a subsequent case', async () => {
  const fake = setup(call => call.url.endsWith('/instances') ? json({ uuid: operationId() }, 201) : undefined);
  const result = await fake.runner.run({ ...input(), cases: [check(), check({ id: 'second' })] }, signal());
  assert.equal(result.checks[0]!.status, 'pass'); assert.equal(result.checks[1]!.status, 'error');
  assert.match(result.infrastructureError!, /sandbox_duplicate_operation/);
  assert.equal(result.cpuSeconds, null);
});

test('truncated output and image mismatches cannot pass; unknown state retains cleanup proof limits', async () => {
  for (const kind of ['truncated', 'image']) {
    const fake = setup(call => {
      if (call.method !== 'GET') return;
      const operation = terminal();
      if (kind === 'truncated') operation.metadata.result.stdout.truncated = true;
      else operation.image_uuid = fileId;
      return json(operation);
    });
    const result = await fake.runner.run(input(), signal());
    assert.equal(result.checks[0]!.status, 'error');
    assert.match(result.infrastructureError!, kind === 'truncated' ? /output_completeness/ : /identity_mismatch/);
  }
});

test('approved batch ceiling is reserved once even on setup failures and cannot be reused', async () => {
  const fake = setup(call => call.url.endsWith('/files') ? new Response('secret-body', { status: 503 }) : undefined,
    verification(), { maxApprovedSpendUsd: 0.1 });
  const first = await fake.runner.run(input(), signal());
  assert.equal(first.infrastructureError, 'sandbox_http_503'); assert.ok(!JSON.stringify(first).includes('secret-body'));
  const second = await fake.runner.run(input(), signal());
  assert.equal(second.infrastructureError, 'sandbox_budget_reservation_unavailable');
  assert.equal(fake.calls.length, 1);
});
