import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SandboxCheckResult } from '../packages/contracts/src/product.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { createNebiusAdjudicationChecks } from '../workers/evaluator/nebius-adjudication.ts';
import { hashJson } from '../workers/evaluator/protocol.ts';
import { operatorData } from './helpers/smoke-operator-data.ts';

// Independent control: invented public input, temporary ledger and fake HTTP only.
// No provider, candidate process, actual account or evaluation corpus is accessed.
test('late cancellation preserves raw adjudication evidence before a closed final-usage callback rejects', async t => {
  const data = operatorData(), id = randomUUID(), controller = new AbortController();
  data.budget.stages.smoke = 0; data.budget.stages.pilot = 1;
  const ledger = new BudgetLedger({ filename: join(data.state, 'late-evidence.sqlite'), budget: data.budget });
  t.after(() => { ledger.close(); rmSync(data.directory, { recursive: true, force: true }); });
  ledger.reserve({ id, episodeId: id, stage: 'pilot', fingerprint: data.sourceDigest, amountMicros: 1_000_000 });
  ledger.markAttempted(id);
  const operations = new Map<string, boolean>(), rawResults: SandboxCheckResult[] = [];
  const counts = { uploads: 0, instances: 0, deletes: 0, finalUsage: 0 };
  const checks = createNebiusAdjudicationChecks({
    input: { episodeId: id, ownerRunId: id, taskId: data.fixture.id,
      expectedFixtureDigest: data.sourceDigest, expectedOracleDigest: data.sourceDigest,
      selectedCandidateDigest: hashJson(data.fixture.files), selectionFinalized: true, files: data.fixture.files,
      timeoutSeconds: 20, sandboxCpuSecondsLimit: 2, maxApprovedSpendUsd: 0.1, onOperation: () => {},
      onFinalUsage: () => { counts.finalUsage++; throw new Error('unit-callback-closed'); } },
    reservation: { dispatchId: id, reservationFingerprint: data.sourceDigest, stage: 'pilot', amountMicros: '1000000' },
    ledger, sourceDigest: data.sourceDigest, verifySourceDigest: () => data.sourceDigest,
    cpuProof: data.config.cpuProof, sandboxVerification: data.config.sandboxVerification,
    accountingTimeoutSeconds: 2, cleanupTimeoutSeconds: 1, saveRawResult: value => rawResults.push(value),
    sandbox: { authorized: true, expectedProjectId: data.config.sandboxVerification.projectId,
      credential: async () => ({ token: 'UNIT-ONLY-NONSECRET', projectId: data.config.sandboxVerification.projectId }),
      fetch: async (url, init) => {
        const path = String(url);
        if (path.endsWith('/files')) {
          counts.uploads++; const bytes = Buffer.from(init!.body as Uint8Array);
          return Response.json({ uuid: randomUUID(), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, { status: 201 });
        }
        if (path.endsWith('/instances')) {
          counts.instances++; const operation = randomUUID(); operations.set(operation, false);
          return Response.json({ uuid: operation }, { status: 201 });
        }
        const operation = path.split('/').at(-1)!; assert.ok(operations.has(operation));
        if (init?.method === 'DELETE') { counts.deletes++; operations.set(operation, true); return new Response(null, { status: 202 }); }
        if (!operations.get(operation)) {
          ledger.cancel(id); controller.abort(); throw new Error('unit-status-interruption');
        }
        return Response.json({ uuid: operation, kind: 'instance', status: 'CANCELLED',
          image_uuid: data.config.sandboxVerification.imageUuid, consumed_cpu: 0.01,
          metadata: { image: data.config.sandboxVerification.imageUuid } });
      } },
  });
  await assert.rejects(checks.run({ files: data.fixture.files, entrypoint: data.fixture.entrypoint,
    cases: data.fixture.visibleCases, timeoutSeconds: 20, ownerRunId: id }, controller.signal), /unit-callback-closed/);
  assert.deepEqual(counts, { uploads: 1, instances: 1, deletes: 1, finalUsage: 1 });
  assert.equal(rawResults.length, 1);
  assert.equal(rawResults[0]!.cpuSeconds, 0.01); assert.equal(rawResults[0]!.measuredCostUsd, null);
  assert.match(rawResults[0]!.infrastructureError!, /cancelled/);
  assert.ok(rawResults[0]!.operationIds.some(handle => handle.startsWith('nebius:operation:')));
  assert.equal(ledger.snapshot().reservationCount, 1); assert.equal(ledger.snapshot().pendingBillingCount, 1);
  assert.equal(ledger.snapshot().heldMicros, '1000000'); assert.equal(ledger.get(id).state, 'cancelled');
});
