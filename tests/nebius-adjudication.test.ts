import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { createNebiusAdjudicationChecks } from '../workers/evaluator/nebius-adjudication.ts';
import type { NebiusAdjudicationOptions } from '../workers/evaluator/nebius-adjudication.ts';
import { hashJson } from '../workers/evaluator/protocol.ts';
import { operatorData } from './helpers/smoke-operator-data.ts';

function setup(t: TestContext) {
  const data = operatorData(); data.budget.stages.smoke = 0; data.budget.stages.pilot = 1;
  const ledger = new BudgetLedger({ filename: join(data.state, 'adjudication-budget.sqlite'), budget: data.budget });
  t.after(() => { ledger.close(); rmSync(data.directory, { recursive: true, force: true }); });
  const id = randomUUID(), operations = new Map<string, boolean>(), timeouts: number[] = [], handles: string[] = [];
  const counts = { fetch: 0, credential: 0, deletes: 0 };
  const rawResults: unknown[] = [];
  const hooks: { firstStatus?: () => void } = {};
  ledger.reserve({ id, episodeId: id, stage: 'pilot', fingerprint: data.sourceDigest, amountMicros: 1_000_000 });
  const options: NebiusAdjudicationOptions = { input: { episodeId: id, ownerRunId: id, taskId: data.fixture.id,
    expectedFixtureDigest: data.sourceDigest, expectedOracleDigest: data.sourceDigest, selectedCandidateDigest: hashJson(data.fixture.files),
    selectionFinalized: true, files: data.fixture.files, timeoutSeconds: 20, sandboxCpuSecondsLimit: 2, maxApprovedSpendUsd: 0.1, onOperation: id => handles.push(id) },
    reservation: { dispatchId: id, reservationFingerprint: data.sourceDigest, stage: 'pilot', amountMicros: '1000000' },
    ledger, sourceDigest: data.sourceDigest, verifySourceDigest: () => data.sourceDigest,
    cpuProof: data.config.cpuProof, sandboxVerification: data.config.sandboxVerification, accountingTimeoutSeconds: 2, cleanupTimeoutSeconds: 1, saveRawResult: result => rawResults.push(result),
    sandbox: { authorized: true, expectedProjectId: data.config.sandboxVerification.projectId,
      credential: async () => { counts.credential++; return { token: 'UNIT-ONLY-NONSECRET', projectId: data.config.sandboxVerification.projectId }; },
      fetch: async (url, init) => {
        counts.fetch++; const value = String(url);
        if (value.endsWith('/files')) { const bytes = Buffer.from(init!.body as Uint8Array); return Response.json({ uuid: randomUUID(), size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex') }, { status: 201 }); }
        if (value.endsWith('/instances')) { const body = JSON.parse(init!.body as string), operation = randomUUID();
          timeouts.push(body.timeout); operations.set(operation, false); return Response.json({ uuid: operation }, { status: 201 }); }
        const operation = value.split('/').at(-1)!; assert.ok(operations.has(operation));
        if (init?.method === 'DELETE') { counts.deletes++; operations.set(operation, true); return new Response(null, { status: 202 }); }
        const hook = hooks.firstStatus; delete hooks.firstStatus; hook?.();
        return Response.json({ uuid: operation, kind: 'instance', status: operations.get(operation) ? 'CANCELLED' : 'SUCCESS',
          image_uuid: data.config.sandboxVerification.imageUuid, consumed_cpu: 0.01,
          metadata: { image: data.config.sandboxVerification.imageUuid, result: { state: { exit_code: 0, signal: 0, timed_out: false },
            stdout: { encoding: 'ascii', value: JSON.stringify({ kind: 'return', value: 1, argsAfter: [1], kwargsAfter: {} }), truncated: false },
            stderr: { encoding: 'ascii', value: '', truncated: false }, resources: { cost: 99 } } } });
      } } };
  const invocation = { files: data.fixture.files, entrypoint: data.fixture.entrypoint, cases: data.fixture.visibleCases, timeoutSeconds: 20,
    ownerRunId: id, onOperation: options.input.onOperation };
  return { options, invocation, ledger, id, counts, timeouts, handles, data, hooks, rawResults };
}

test('protected adjudication uses one existing attempt and bounded guest CPU without inventing USD', async t => {
  const s = setup(t); s.ledger.markAttempted(s.id); const before = s.ledger.snapshot();
  const checks = createNebiusAdjudicationChecks(s.options), result = await checks.run(s.invocation, new AbortController().signal);
  assert.equal(result.checks[0]?.status, 'pass'); assert.equal(result.measuredCostUsd, null); assert.equal(result.cpuSeconds, 0.01);
  assert.equal(s.counts.deletes, 0); assert.ok(s.timeouts.every(seconds => seconds <= 4)); assert.ok(s.handles.some(id => id.includes('intent')));
  assert.deepEqual(s.ledger.snapshot(), before); await assert.rejects(checks.run(s.invocation, new AbortController().signal));
});
test('unattempted, cancelled and wrong reservation binding refuse before credentials or transport', t => {
  const s = setup(t); assert.throws(() => createNebiusAdjudicationChecks(s.options)); s.ledger.markAttempted(s.id);
  assert.throws(() => createNebiusAdjudicationChecks({ ...s.options, reservation: { ...s.options.reservation, amountMicros: '1' } }));
  s.ledger.cancel(s.id); assert.throws(() => createNebiusAdjudicationChecks(s.options)); assert.equal(s.counts.fetch + s.counts.credential, 0);
});
test('changed source and insufficient wall/cost/CPU cannot start paid work', async t => {
  const s = setup(t); s.ledger.markAttempted(s.id);
  for (const input of [{ ...s.options.input, timeoutSeconds: 3 }, { ...s.options.input, maxApprovedSpendUsd: 0.001 }]) assert.throws(() => createNebiusAdjudicationChecks({ ...s.options, input }));
  const checks = createNebiusAdjudicationChecks({ ...s.options, input: { ...s.options.input, sandboxCpuSecondsLimit: 0.001 } });
  await assert.rejects(checks.run(s.invocation, new AbortController().signal));
  assert.throws(() => createNebiusAdjudicationChecks({ ...s.options, verifySourceDigest: () => 'sha256:' + 'f'.repeat(64) }));
  assert.equal(s.counts.fetch + s.counts.credential, 0);
});
test('changed candidate, extra cases or cancellation before invocation cannot consume the grant', async t => {
  const s = setup(t); s.ledger.markAttempted(s.id);
  const changed = createNebiusAdjudicationChecks(s.options);
  await assert.rejects(changed.run({ ...s.invocation, files: { 'solution.py': 'changed' } }, new AbortController().signal));
  const extra = createNebiusAdjudicationChecks(s.options);
  await assert.rejects(extra.run({ ...s.invocation, cases: [...s.invocation.cases, ...s.invocation.cases, ...s.invocation.cases] }, new AbortController().signal));
  const cancelled = createNebiusAdjudicationChecks(s.options), signal = AbortSignal.abort();
  await assert.rejects(cancelled.run(s.invocation, signal)); assert.equal(s.counts.fetch + s.counts.credential, 0);
});
test('cancelled existing reservation still permits cleanup of an already created instance', async t => {
  const s = setup(t); s.ledger.markAttempted(s.id); const controller = new AbortController();
  s.hooks.firstStatus = () => { s.ledger.cancel(s.id); controller.abort(); throw new Error('synthetic-status-interruption'); };
  const result = await createNebiusAdjudicationChecks(s.options).run(s.invocation, controller.signal);
  assert.equal(s.counts.deletes, 1); assert.match(result.infrastructureError!, /cancelled/); assert.equal(result.measuredCostUsd, null);
  assert.equal(s.rawResults.length, 1);
  assert.equal(s.ledger.snapshot().pendingBillingCount, 1); assert.equal(s.ledger.snapshot().heldMicros, '1000000');
});
