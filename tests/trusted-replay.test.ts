import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { createTrustedReplay } from '../packages/orchestrator/src/trusted-replay.ts';
import type { ReplayProgress, TrustedReplayInput } from '../packages/orchestrator/src/trusted-replay.ts';
import type { SandboxCheckResult } from '../packages/contracts/src/product.ts';
import { replayData, replayFetch } from './helpers/replay-data.ts';

function setup() {
  const data = replayData(), transport = replayFetch(), progress: ReplayProgress[] = [], raw: SandboxCheckResult[] = [];
  const ledger = new BudgetLedger({ filename: data.config.ledgerFile, budget: data.budget });
  let credentials = 0;
  const input: TrustedReplayInput = { replayId: data.replayId, bundle: data.bundle, sourceDigest: data.sourceDigest,
    limits: { wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 1 },
    sandbox: { authorized: true, fetch: transport.fetch, expectedProjectId: data.config.sandboxVerification.projectId,
      credential: async () => { credentials++; return { token: 'SYNTHETIC-UNIT-ONLY', projectId: data.config.sandboxVerification.projectId }; } },
    verification: data.config.sandboxVerification, cpuProof: data.config.cpuProof,
    acceptedProofDigests: [digestJson(data.config.sandboxVerification), digestJson(data.config.cpuProof)], ledger,
    verifyCurrent: () => data.sourceDigest, saveProgress: value => progress.push(value), saveRawBatch: value => raw.push(value) };
  return { data, transport, progress, raw, ledger, input, credentials: () => credentials,
    close: () => { ledger.close(); rmSync(data.directory, { recursive: true, force: true }); } };
}

test('live replay reserves once, performs only frozen checks, retains raw IDs and never guesses billing from provider cost', async () => {
  const unit = setup();
  try {
    const replay = createTrustedReplay(unit.input);
    assert.equal(unit.credentials(), 0); assert.equal(unit.ledger.snapshot().reservationCount, 0);
    const result = await replay.start(new AbortController().signal) as { status: string };
    assert.equal(result.status, 'reproduced', JSON.stringify({ result, raw: unit.raw })); assert.equal(unit.raw.length, 2);
    assert.equal(unit.transport.calls.filter(call => call.url.endsWith('/instances')).length, 2);
    assert.ok(unit.transport.calls.every(call => call.url.includes('/sandboxes/')));
    assert.equal(replay.snapshot().observedCpuSeconds, 0.02);
    assert.ok(replay.snapshot().operationIds.length >= 4);
    const reservation = unit.ledger.get(replay.reservationId)!;
    assert.equal(reservation.actualCostMicros, null); assert.equal(reservation.heldMicros, '100000');
    assert.equal(reservation.reconciliationComplete, false);
    assert.throws(() => replay.start(new AbortController().signal), /already_started/);
    assert.equal(unit.ledger.snapshot().reservationCount, 1);
    assert.throws(() => createTrustedReplay(unit.input), /budget_unavailable/);
  } finally { unit.close(); }
});

test('source, accepted-control, image, CPU and budget drift reject before credentials or any dispatch', () => {
  const unit = setup();
  try {
    for (const change of [
      { verifyCurrent: () => digestBytes('changed') },
      { acceptedProofDigests: [digestBytes('no'), digestBytes('proof')] },
      { verification: { ...unit.input.verification, imageUuid: '11111111-1111-4111-8111-111111111112' } },
      { limits: { ...unit.input.limits, sandboxCpuSecondsLimit: 0.1 } },
      { limits: { ...unit.input.limits, maxApprovedSpendUsd: 0.01 } },
    ]) assert.throws(() => createTrustedReplay({ ...unit.input, ...change }));
    assert.equal(unit.credentials(), 0); assert.equal(unit.transport.calls.length, 0);
    assert.equal(unit.ledger.snapshot().reservationCount, 0);
  } finally { unit.close(); }
});

test('credential-time revocation denies new requests while retaining the attempted reservation', async () => {
  const unit = setup(); let current = unit.data.sourceDigest;
  try {
    const replay = createTrustedReplay({ ...unit.input, verifyCurrent: () => current,
      sandbox: { ...unit.input.sandbox, credential: async () => {
        current = digestBytes('source-changed-during-credential-read');
        return { token: 'SYNTHETIC-UNIT-ONLY', projectId: unit.input.verification.projectId };
      } } });
    await assert.rejects(replay.start(new AbortController().signal));
    assert.equal(unit.transport.calls.length, 0);
    assert.ok(replay.snapshot().operationIds.length > 0, 'The denied upload intent is retained.');
    assert.equal(unit.ledger.get(replay.reservationId)!.heldMicros, '100000');
  } finally { unit.close(); }
});

test('raw persistence failure retains known CPU and operation handles without releasing billing hold', async () => {
  const unit = setup();
  try {
    const replay = createTrustedReplay({ ...unit.input, saveRawBatch: () => { throw new Error('synthetic persistence failure'); } });
    await assert.rejects(replay.start(new AbortController().signal), /persistence failure/);
    assert.equal(replay.snapshot().observedCpuSeconds, 0.01);
    assert.ok(replay.snapshot().operationIds.length > 0);
    assert.equal(unit.progress.at(-1)!.phase, 'terminal');
    assert.equal(unit.ledger.get(replay.reservationId)!.heldMicros, '100000');
  } finally { unit.close(); }
});

test('changed observations produce a mismatch and pre-cancellation cannot reserve or read a credential', async () => {
  const unit = setup();
  try {
    const wrong = replayFetch({ resultValue: 9 });
    const replay = createTrustedReplay({ ...unit.input, sandbox: { ...unit.input.sandbox, fetch: wrong.fetch } });
    const controller = new AbortController(); controller.abort();
    assert.throws(() => replay.start(controller.signal));
    assert.equal(unit.ledger.snapshot().reservationCount, 0);
    const result = await replay.start(new AbortController().signal) as { status: string };
    assert.equal(result.status, 'mismatch_or_infrastructure_error');
    assert.equal(unit.ledger.get(replay.reservationId)!.reconciliationComplete, false);
  } finally { unit.close(); }
});
