import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { operatorData } from './smoke-operator-data.ts';
import { digestJson } from '../../packages/contracts/src/digest.ts';
import type { ProductRun } from '../../packages/contracts/src/product.ts';
import { fixtureDigests } from '../../packages/orchestrator/src/fixtures.ts';
import { createPatch } from '../../packages/orchestrator/src/patch.ts';
import { buildEvidence } from '../../packages/orchestrator/src/evidence.ts';
import { REPEATED_CHECK_PROTOCOL } from '../../packages/orchestrator/src/repeated-checks.ts';

/** Invented public-unit input and observations; never actual live evidence. */
export function replayData() {
  const data = operatorData(), now = new Date().toISOString(), id = randomUUID();
  const runtimeLock = { mode: 'live', scope: 'trusted-smoke-only', calibratedExperiment: false,
    sourceDigest: data.sourceDigest, imageUuid: data.config.sandboxVerification.imageUuid,
    imageDigest: data.config.sandboxVerification.immutableImageDigest, checkProtocol: REPEATED_CHECK_PROTOCOL };
  const check = { id: 'visible', requirementId: 'R01', status: 'pass' as const, actual: 1, expected: 1,
    message: 'SYNTHETIC UNIT OBSERVATION', durationMs: 0, log: 'SYNTHETIC UNIT ONLY; not account evidence.' };
  const run: ProductRun = { schemaVersion: '2.1', id, taskId: data.fixture.id, variant: 'patchproof', mode: 'live',
    competitionReady: false, notice: 'SYNTHETIC UNIT ONLY', phase: 'terminal', terminalStatus: 'verified_for_declared_checks',
    reason: null, createdAt: now, finishedAt: now, ...fixtureDigests(data.fixture), runtimeLockDigest: digestJson(runtimeLock),
    limits: data.config.limits, usage: { inferenceCalls: 1, inputTokens: 1, outputTokens: 1, sandboxCpuSeconds: null,
      measuredCostUsd: null, costIsEstimate: false, elapsedMs: 1 }, baselineChecks: null,
    candidates: [{ id: 1, parentId: null, summary: 'SYNTHETIC UNIT CANDIDATE', files: data.fixture.files,
      diff: createPatch(data.fixture.files, data.fixture.files), visibleChecks: [check], acceptanceChecks: [],
      accepted: true, rejectionReason: null, modelId: 'nvidia/synthetic-unit-model', providerRequestId: 'synthetic-response',
      sandboxOperationIds: [], elapsedMs: 1, usage: { inferenceCalls: 1, inputTokens: 1, outputTokens: 1, measuredCostUsd: null } }],
    selectedCandidateId: 1, coverage: [{ requirementId: 'R01', status: 'pass', checkIds: ['visible'] }],
    events: [{ sequence: 1, timestamp: now, phase: 'terminal', message: 'SYNTHETIC UNIT ONLY' }], sandboxOperationIds: [] };
  const bundle = buildEvidence(run, data.fixture, runtimeLock);
  return { ...data, bundle, replayId: randomUUID(), reportFile: join(data.state, 'replay-report.json') };
}

export function replayFetch(options: { beforeRequest?: (url: string, init?: RequestInit) => Promise<void> | void; resultValue?: number } = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  const invocations = new Map<string, { args: unknown[]; kwargs: Record<string, unknown> }>();
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const target = String(url), method = init?.method ?? 'GET';
    calls.push({ url: target, method }); await options.beforeRequest?.(target, init);
    if (method === 'POST' && target.endsWith('/files')) {
      const bytes = Buffer.from(init!.body as Uint8Array);
      return Response.json({ uuid: randomUUID(), sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }, { status: 201 });
    }
    if (method === 'POST' && target.endsWith('/instances')) {
      const body = JSON.parse(String(init?.body)), id = randomUUID();
      invocations.set(id, JSON.parse(Buffer.from(body.stdin.value, 'base64').toString()));
      return Response.json({ uuid: id }, { status: 201 });
    }
    if (method === 'DELETE') return new Response(null, { status: 202 });
    const id = target.split('/').at(-1)!, invocation = invocations.get(id)!;
    return Response.json({ uuid: id, kind: 'instance', status: 'SUCCESS', consumed_cpu: 0.01,
      image_uuid: '11111111-1111-4111-8111-111111111111',
      metadata: { result: { state: { exit_code: 0, signal: 0, timed_out: false },
        stdout: { value: JSON.stringify({ kind: 'return', value: options.resultValue ?? 1,
          argsAfter: invocation.args, kwargsAfter: invocation.kwargs }), encoding: 'ascii', truncated: false },
        stderr: { value: '', encoding: 'ascii', truncated: false }, resources: { cost: 123 } } } });
  };
  return { fetch, calls };
}
