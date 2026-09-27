import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { PhaseAccountingStore, PhaseAccountingReceiptSchema, createPhaseAccountingObserver, phaseAccountingReceiptDigest, phaseInventoryDigest } from '../packages/orchestrator/src/phase-accounting.ts';
import type { PhaseAccountingReceipt, PhaseAccountingRequest } from '../packages/orchestrator/src/phase-accounting.ts';

// Independent invented metadata only. No runtime/provider/candidate files are opened.
const hash = (label: string) => 'sha256:' + createHash('sha256').update(label).digest('hex');
const INVENTED = {
  source: hash('invented reviewed source'), plan: hash('invented fixed plan'), model: hash('invented model lock'),
  policy: hash('invented policy'), reservation: hash('invented reservation binding'),
  checkpoint: hash('invented observed counters and operation inventory'),
};
function request(): PhaseAccountingRequest {
  return { binding: { executionMode: 'live' as const, phase: 'runtime' as const,
    dispatchId: '047a8aab-7707-4e06-8ec0-077a3b4a8470', episodeId: 'invented-episode', reservationId: '047a8aab-7707-4e06-8ec0-077a3b4a8470',
    reservationFingerprint: INVENTED.reservation, stage: 'pilot' as const, reservedMicros: '1000000',
    sourceDigest: INVENTED.source, planDigest: INVENTED.plan, modelLockDigest: INVENTED.model, policyDigest: INVENTED.policy },
    checkpointDigest: INVENTED.checkpoint, operationIds: ['invented-operation-1', 'invented-operation-2'],
    observedCpuLowerBound: 1.25, observedCostLowerBoundUsd: 0.04 };
}
const NOW = '2026-09-27T20:00:00.000Z';
function setup(t: TestContext, req = request()) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-phase-observation-unit-')), filename = join(directory, 'observations.db');
  const clock = { now: NOW }, store = new PhaseAccountingStore({ filename, now: () => new Date(clock.now) });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.recordRequest(req);
  return { directory, filename, store, req, clock };
}
function receipt(req: PhaseAccountingRequest, id = 'invented-receipt-1'): PhaseAccountingReceipt {
  return PhaseAccountingReceiptSchema.parse({ schemaVersion: '1.0', kind: 'phase-accounting-observation', id,
    revision: 1, previousReceiptDigest: null, binding: req.binding, checkpointDigest: req.checkpointDigest,
    scope: 'cumulative_within_phase_including_setup_retries_cleanup_retention',
    inventory: { operationIds: req.operationIds, unresolvedOperationIds: [], complete: true, evidenceDigest: INVENTED.checkpoint },
    cleanup: { complete: true, evidenceDigest: INVENTED.policy }, retention: { final: true, evidenceDigest: INVENTED.policy },
    billing: { currency: 'USD', cumulativeUsd: '0.10', complete: true, evidenceDigest: INVENTED.source },
    cpu: { cumulativeSeconds: 2, complete: true, evidenceDigest: INVENTED.source },
    observedThroughAt: NOW, issuedAt: NOW, validUntil: '2026-09-27T21:00:00.000Z' });
}
function context(req: PhaseAccountingRequest, value: PhaseAccountingReceipt, head: string | null = null) {
  return { expectedBinding: req.binding, expectedCheckpointDigest: req.checkpointDigest,
    expectedInventoryDigest: phaseInventoryDigest(req.operationIds), acceptedReceiptDigest: phaseAccountingReceiptDigest(value), expectedHeadDigest: head };
}
function next(value: PhaseAccountingReceipt): PhaseAccountingReceipt {
  return { ...structuredClone(value), id: value.id + '-next', revision: value.revision + 1, previousReceiptDigest: phaseAccountingReceiptDigest(value) };
}

test('an exact decimal first receipt below the known USD lower bound rejects before projection rounding', t => {
  const s = setup(t), value = receipt(s.req); value.billing.cumulativeUsd = '0.039999999999999999';
  assert.throws(() => s.store.acceptObservation(value, context(s.req, value)), /USD|lower|discard/i);
  assert.equal(s.store.history(s.req.binding).length, 0);
});

test('observer snapshots its original request before polling and cannot be redirected to another phase', async t => {
  const s = setup(t), adjudication = structuredClone(s.req); adjudication.binding.phase = 'adjudication';
  s.store.recordRequest(adjudication);
  const value = receipt(adjudication, 'invented-adjudication'); s.store.acceptObservation(value, context(adjudication, value));
  const controller = new AbortController(), reason = new Error('invented observer stop'), observe = createPhaseAccountingObserver(s.store, 10);
  const mutableRequest = structuredClone(s.req), pending = observe(mutableRequest, controller.signal);
  mutableRequest.binding.phase = 'adjudication';
  const timeout = setTimeout(() => controller.abort(reason), 60);
  try { await assert.rejects(pending); } finally { clearTimeout(timeout); }
  assert.equal(s.store.readObservedUsage(s.req).receiptDigest, null);
});

test('no receipt remains wholly unknown even with a recorded empty operation inventory', t => {
  const s = setup(t), req = request(); req.binding.dispatchId = req.binding.reservationId = 'f314fb40-3c83-47b0-bc34-e4231bc1ebec'; req.operationIds = [];
  req.observedCpuLowerBound = req.observedCostLowerBoundUsd = 0; s.store.recordRequest(req);
  assert.deepEqual(s.store.readObservedUsage(req), { receiptDigest: null, checkpointDigest: null, measuredCostUsd: null, sandboxCpuSeconds: null,
    billingComplete: false, cpuComplete: false, inventoryComplete: false, cleanupComplete: false, retentionFinal: false, coveredOperationIds: [] });
});

test('cumulative revisions replace totals and old accepted duplicates never move the head backwards', t => {
  const s = setup(t), first = receipt(s.req), firstDigest = phaseAccountingReceiptDigest(first);
  const accepted = s.store.acceptObservation(first, context(s.req, first)); assert.equal(accepted.executionAllowed, false);
  const second = next(first); second.billing.cumulativeUsd = '0.20'; second.cpu.cumulativeSeconds = 3;
  const secondDigest = phaseAccountingReceiptDigest(second); s.store.acceptObservation(second, context(s.req, second, firstDigest));
  const duplicate = s.store.acceptObservation(first, context(s.req, first));
  assert.equal(duplicate.status, 'already_accepted'); assert.equal(duplicate.currentHeadDigest, secondDigest);
  const projection = s.store.readObservedUsage(s.req);
  assert.equal(projection.measuredCostUsd, 0.2); assert.equal(projection.sandboxCpuSeconds, 3); assert.equal(projection.receiptDigest, secondDigest);
  assert.equal(s.store.history(s.req.binding).length, 2);
});

test('a stale second connection cannot replace an accepted CAS head', t => {
  const s = setup(t), first = receipt(s.req), firstDigest = phaseAccountingReceiptDigest(first);
  s.store.acceptObservation(first, context(s.req, first));
  const other = new PhaseAccountingStore({ filename: s.filename, now: () => new Date(NOW) });
  try {
    const left = next(first), right = next(first); left.billing.cumulativeUsd = '0.2'; right.billing.cumulativeUsd = '0.3'; right.id += '-different';
    s.store.acceptObservation(left, context(s.req, left, firstDigest));
    assert.throws(() => other.acceptObservation(right, context(s.req, right, firstDigest)), /head|revision/i);
    assert.equal(other.readObservedUsage(s.req).measuredCostUsd, 0.2);
  } finally { other.close(); }
});

test('changed receipt ID content, revision gaps, wrong previous digest and stale head reject', t => {
  const s = setup(t), first = receipt(s.req), digest = phaseAccountingReceiptDigest(first); s.store.acceptObservation(first, context(s.req, first));
  for (const mutate of [
    (value: PhaseAccountingReceipt) => { value.id = first.id; },
    (value: PhaseAccountingReceipt) => { value.revision = 3; },
    (value: PhaseAccountingReceipt) => { value.previousReceiptDigest = INVENTED.policy; }
  ]) { const value = next(first); mutate(value); assert.throws(() => s.store.acceptObservation(value, context(s.req, value, digest))); }
  const value = next(first); assert.throws(() => s.store.acceptObservation(value, context(s.req, value, null)), /head/i);
  assert.equal(s.store.history(s.req.binding).length, 1);
});

test('every immutable identity dimension must match the recorded final request', t => {
  const s = setup(t);
  const mutations: Array<(value: PhaseAccountingReceipt) => void> = [
    value => { value.binding.dispatchId = value.binding.reservationId = 'f314fb40-3c83-47b0-bc34-e4231bc1ebec'; },
    value => { value.binding.episodeId += '-changed'; }, value => { value.binding.reservationFingerprint = INVENTED.source; },
    value => { value.binding.sourceDigest = INVENTED.policy; }, value => { value.binding.planDigest = INVENTED.policy; },
    value => { value.binding.modelLockDigest = INVENTED.policy; }, value => { value.binding.policyDigest = INVENTED.source; },
    value => { value.binding.executionMode = 'synthetic'; }, value => { value.binding.phase = 'adjudication'; },
    value => { value.binding.stage = 'evaluate'; }, value => { value.binding.reservedMicros = '2000000'; },
    value => { value.checkpointDigest = INVENTED.policy; }
  ];
  for (const mutate of mutations) {
    const value = receipt(s.req); mutate(value);
    const trusted = { ...context(s.req, value), expectedBinding: value.binding, expectedCheckpointDigest: value.checkpointDigest };
    assert.throws(() => s.store.acceptObservation(value, trusted));
  }
  assert.equal(s.store.history(s.req.binding).length, 0);
});

test('live null model lock, duplicate operations, changed request and unsupported receipt scope reject', t => {
  const s = setup(t), noModel = structuredClone(s.req); noModel.binding.modelLockDigest = null;
  assert.throws(() => s.store.recordRequest(noModel));
  const duplicate = structuredClone(s.req); duplicate.operationIds.push(duplicate.operationIds[0]!); assert.throws(() => s.store.recordRequest(duplicate));
  const changed = structuredClone(s.req); changed.checkpointDigest = INVENTED.source; assert.throws(() => s.store.recordRequest(changed), /immutable/i);
  const value = receipt(s.req); assert.throws(() => phaseAccountingReceiptDigest({ ...value, scope: 'entire_episode_including_setup_retries_cleanup' }));
});

test('exact inventory set is required; missing known handles cannot be self-authorized by context', t => {
  const s = setup(t), value = receipt(s.req); value.inventory.operationIds.pop();
  assert.throws(() => s.store.acceptObservation(value, { ...context(s.req, value), expectedInventoryDigest: phaseInventoryDigest(value.inventory.operationIds) }), /exact pending request/);
  const reordered = receipt(s.req); reordered.inventory.operationIds.reverse(); s.store.acceptObservation(reordered, context(s.req, reordered));
  assert.equal(s.store.readObservedUsage(s.req).inventoryComplete, true);
});

test('unknown, non-USD or estimated billing never satisfies measured complete observation', t => {
  const s = setup(t), req = structuredClone(s.req); req.binding.dispatchId = req.binding.reservationId = 'f314fb40-3c83-47b0-bc34-e4231bc1ebec';
  req.observedCostLowerBoundUsd = req.observedCpuLowerBound = null; s.store.recordRequest(req);
  const value = receipt(req); value.billing = { currency: null, cumulativeUsd: null, complete: false, evidenceDigest: null };
  value.cpu = { cumulativeSeconds: null, complete: false, evidenceDigest: null };
  s.store.acceptObservation(value, context(req, value));
  const result = s.store.readObservedUsage(req); assert.equal(result.measuredCostUsd, null); assert.equal(result.sandboxCpuSeconds, null);
  assert.equal(result.billingComplete, false); assert.equal(result.cpuComplete, false);
  for (const billing of [{ ...receipt(req).billing, currency: 'EUR' }, { ...receipt(req).billing, currency: null }, { ...receipt(req).billing, estimated: true },
    { ...receipt(req).billing, evidenceDigest: null }]) assert.throws(() => PhaseAccountingReceiptSchema.parse({ ...receipt(req), billing }));
});

test('incomplete cleanup, unresolved inventory and continuing retention cannot complete polling', async t => {
  const s = setup(t), value = receipt(s.req); value.inventory.complete = false; value.inventory.unresolvedOperationIds = [value.inventory.operationIds[0]!];
  value.cleanup.complete = false; value.retention.final = false; s.store.acceptObservation(value, context(s.req, value));
  const result = s.store.readObservedUsage(s.req); assert.equal(result.measuredCostUsd, 0.1);
  assert.equal(result.inventoryComplete, false); assert.equal(result.cleanupComplete, false); assert.equal(result.retentionFinal, false);
  const controller = new AbortController(), pending = createPhaseAccountingObserver(s.store, 10)(s.req, controller.signal);
  const timeout = setTimeout(() => controller.abort(), 30);
  try { await assert.rejects(pending); } finally { clearTimeout(timeout); }
});

test('CPU and USD cannot decrease or become unknown across revisions', t => {
  const s = setup(t), first = receipt(s.req); first.billing.cumulativeUsd = '0.100000000000000002';
  const digest = phaseAccountingReceiptDigest(first); s.store.acceptObservation(first, context(s.req, first));
  for (const mutate of [
    (value: PhaseAccountingReceipt) => { value.billing.cumulativeUsd = '0.100000000000000001'; },
    (value: PhaseAccountingReceipt) => { value.cpu.cumulativeSeconds = 1.99; },
    (value: PhaseAccountingReceipt) => { value.billing = { currency: null, cumulativeUsd: null, complete: false, evidenceDigest: null }; },
    (value: PhaseAccountingReceipt) => { value.cpu = { cumulativeSeconds: null, complete: false, evidenceDigest: null }; }
  ]) { const value = next(first); mutate(value); assert.throws(() => s.store.acceptObservation(value, context(s.req, value, digest))); }
  assert.equal(s.store.history(s.req.binding).length, 1);
});

test('expired receipts and changed checkpoints retain historical lower bounds without completeness', t => {
  const s = setup(t), value = receipt(s.req); s.store.acceptObservation(value, context(s.req, value));
  const changed = structuredClone(s.req); changed.checkpointDigest = INVENTED.source;
  const historical = s.store.readObservedUsage(changed); assert.equal(historical.measuredCostUsd, 0.1);
  assert.equal(historical.billingComplete, false); assert.equal(historical.retentionFinal, false);
  s.clock.now = value.validUntil;
  const expired = s.store.readObservedUsage(s.req); assert.equal(expired.measuredCostUsd, 0.1); assert.equal(expired.cpuComplete, false);
  const late = next(value); assert.throws(() => s.store.acceptObservation(late, context(s.req, late, phaseAccountingReceiptDigest(value))), /expired/);
});

test('pre-checkpoint observations and future-issued receipts reject before acceptance', t => {
  const s = setup(t), early = receipt(s.req); early.observedThroughAt = '2026-09-27T19:59:59.999Z';
  assert.throws(() => s.store.acceptObservation(early, context(s.req, early)), /predates/);
  const future = receipt(s.req); future.issuedAt = '2026-09-27T20:00:00.001Z';
  assert.throws(() => s.store.acceptObservation(future, context(s.req, future)), /future/);
  assert.equal(s.store.history(s.req.binding).length, 0);
});

test('runtime and adjudication remain disjoint cumulative domains and are never summed by the store', t => {
  const s = setup(t), runtime = receipt(s.req); runtime.billing.cumulativeUsd = '0.20'; s.store.acceptObservation(runtime, context(s.req, runtime));
  const req = structuredClone(s.req); req.binding.phase = 'adjudication'; req.observedCostLowerBoundUsd = 0; req.observedCpuLowerBound = 0;
  s.store.recordRequest(req); const evaluation = receipt(req, 'invented-adjudication'); evaluation.billing.cumulativeUsd = '0.05'; evaluation.cpu.cumulativeSeconds = 1;
  s.store.acceptObservation(evaluation, context(req, evaluation));
  assert.equal(s.store.readObservedUsage(s.req).measuredCostUsd, 0.2); assert.equal(s.store.readObservedUsage(req).measuredCostUsd, 0.05);
  assert.equal(s.store.history(req.binding).length, 1); assert.equal(s.store.history(s.req.binding).length, 1);
});

test('read-only reopen preserves accepted history but grants neither recording nor execution', t => {
  const s = setup(t), value = receipt(s.req); s.store.acceptObservation(value, context(s.req, value));
  const reader = new PhaseAccountingStore({ filename: s.filename, readOnly: true, now: () => new Date(NOW) });
  try {
    assert.deepEqual(reader.readObservedUsage(s.req), s.store.readObservedUsage(s.req));
    assert.throws(() => reader.recordRequest(s.req), /Read-only/); assert.throws(() => reader.acceptObservation(value, context(s.req, value)), /Read-only/);
    const result = reader.readObservedUsage(s.req) as unknown as Record<string, unknown>;
    assert.equal('dispatchGranted' in result, false); assert.equal('executionAllowed' in result, false);
  } finally { reader.close(); }
});

test('receipt and request data returned to callers cannot mutate durable bindings', t => {
  const s = setup(t), value = receipt(s.req); s.store.acceptObservation(value, context(s.req, value));
  value.billing.cumulativeUsd = '0.9'; value.binding.sourceDigest = INVENTED.policy;
  const rows = s.store.requests(); rows[0]!.request.binding.sourceDigest = INVENTED.policy;
  const observation = s.store.readObservedUsage(s.req); observation.coveredOperationIds.length = 0;
  assert.equal(s.store.readObservedUsage(s.req).measuredCostUsd, 0.1); assert.equal(s.store.readObservedUsage(s.req).coveredOperationIds.length, 2);
  assert.equal(s.store.requests()[0]!.request.binding.sourceDigest, INVENTED.source);
});

test('private database readers reject missing paths, symlinks, hardlinks and broad permissions', t => {
  const s = setup(t), missing = join(s.directory, 'missing.db');
  assert.throws(() => new PhaseAccountingStore({ filename: missing, readOnly: true })); assert.equal(existsSync(missing), false);
  const alias = join(s.directory, 'alias.db'); symlinkSync(s.filename, alias);
  assert.throws(() => new PhaseAccountingStore({ filename: alias, readOnly: true })); rmSync(alias);
  linkSync(s.filename, alias); assert.throws(() => new PhaseAccountingStore({ filename: alias, readOnly: true })); rmSync(alias);
  chmodSync(s.filename, 0o644); assert.throws(() => new PhaseAccountingStore({ filename: s.filename, readOnly: true })); chmodSync(s.filename, 0o600);
});

test('stored body corruption is detected and does not become authoritative projection', t => {
  const s = setup(t), value = receipt(s.req); s.store.acceptObservation(value, context(s.req, value));
  const db = new DatabaseSync(s.filename); const changed = structuredClone(value); changed.billing.cumulativeUsd = '0.5';
  db.prepare('UPDATE phase_receipts SET body_json=?').run(JSON.stringify(changed)); db.close();
  assert.throws(() => s.store.readObservedUsage(s.req), /changed/);
});

test('exponent and sub-receipt-precision numeric lower bounds never round down to zero', t => {
  for (const [lower, below, enough] of [[1e-7, '0.000000099999999999', '0.0000001'], [1e-19, '0', '0.000000000000000001']] as const) {
    const req = request(); req.observedCostLowerBoundUsd = lower; const s = setup(t, req), value = receipt(req);
    value.billing.cumulativeUsd = below; assert.throws(() => s.store.acceptObservation(value, context(req, value)), /USD/);
    value.billing.cumulativeUsd = enough; s.store.acceptObservation(value, context(req, value));
    assert.equal(s.store.readObservedUsage(req).measuredCostUsd, 0.000001);
  }
});

test('read projection also compares exact decimal amounts before microdollar rounding', t => {
  const req = request(); req.observedCostLowerBoundUsd = null;
  const s = setup(t, req), value = receipt(req); value.billing.cumulativeUsd = '0.039999999999999999';
  s.store.acceptObservation(value, context(req, value));
  const higherBound = structuredClone(req); higherBound.observedCostLowerBoundUsd = 0.04;
  const projection = s.store.readObservedUsage(higherBound);
  assert.equal(projection.measuredCostUsd, 0.04); assert.equal(projection.billingComplete, false);
  assert.equal(projection.retentionFinal, false);
});
