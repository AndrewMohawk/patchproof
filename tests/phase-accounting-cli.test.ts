import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { PhaseAccountingStore, createPhaseAccountingObserver, phaseInventoryDigest, phaseAccountingReceiptDigest } from '../packages/orchestrator/src/phase-accounting.ts';
import type { PhaseAccountingRequest, PhaseAccountingReceipt } from '../packages/orchestrator/src/phase-accounting.ts';
import { runPhaseAccountingOperator } from '../scripts/phase-accounting-cli.ts';

const H = 'sha256:' + 'a'.repeat(64), ID = '10000000-0000-4000-8000-000000000001';
const request = (): PhaseAccountingRequest => ({ binding: { executionMode: 'synthetic', phase: 'runtime', dispatchId: ID,
  episodeId: 'invented-unit-episode', reservationId: ID, reservationFingerprint: H, stage: 'pilot', reservedMicros: '1000000',
  sourceDigest: H, planDigest: H, modelLockDigest: null, policyDigest: H }, checkpointDigest: H, operationIds: ['intent/unit', 'response/unit'],
  observedCpuLowerBound: null, observedCostLowerBoundUsd: null });
function receipt(): PhaseAccountingReceipt { const now = new Date().toISOString(); return { schemaVersion: '1.0', kind: 'phase-accounting-observation',
  id: 'invented-receipt', revision: 1, previousReceiptDigest: null, binding: request().binding, checkpointDigest: H,
  scope: 'cumulative_within_phase_including_setup_retries_cleanup_retention', inventory: { operationIds: request().operationIds, unresolvedOperationIds: [], complete: true, evidenceDigest: H },
  cleanup: { complete: true, evidenceDigest: H }, retention: { final: true, evidenceDigest: H },
  billing: { currency: 'USD', cumulativeUsd: '0.125', complete: true, evidenceDigest: H }, cpu: { cumulativeSeconds: 0.75, complete: true, evidenceDigest: H },
  observedThroughAt: now, issuedAt: now, validUntil: new Date(Date.now() + 60_000).toISOString() }; }
async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-phase-cli-')), journalPath = join(dir, 'phase.sqlite');
  const store = new PhaseAccountingStore({ filename: journalPath }); store.recordRequest(request());
  const config = { schemaVersion: '1.0', kind: 'patchproof-phase-accounting-operator', journalPath }, configPath = join(dir, 'config.json');
  const write = async (name: string, value: unknown) => { const path = join(dir, name); await writeFile(path, JSON.stringify(value), { mode: 0o600 }); return path; };
  await write('config.json', config);
  const value = receipt(), context = { expectedBinding: value.binding, expectedCheckpointDigest: H, expectedInventoryDigest: phaseInventoryDigest(value.inventory.operationIds),
    acceptedReceiptDigest: phaseAccountingReceiptDigest(value), expectedHeadDigest: null };
  const receiptPath = await write('receipt.json', value), contextPath = await write('context.json', context);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const args = [configPath, digestJson(config)], run = (...commands: string[]) => runPhaseAccountingOperator(commands, process.cwd());
  return { dir, store, config, value, context, write, args, run, receiptPath, contextPath };
}

test('private intake feeds a waiting observer without a ledger or dispatch grant', async t => {
  const fixture = await setup(t), controller = new AbortController(); t.after(() => controller.abort());
  const waiting = createPhaseAccountingObserver(fixture.store, 10)(request(), controller.signal);
  const result = fixture.run('accept', ...fixture.args, fixture.receiptPath, fixture.contextPath, digestJson(fixture.context));
  assert.equal(result.exitCode, 0); assert.equal(result.output.ledgerModified, false); assert.equal(result.output.dispatchGranted, false);
  const observed = await waiting; assert.equal(observed.measuredCostUsd, 0.125); assert.equal(observed.sandboxCpuSeconds, 0.75); assert.equal(observed.retentionFinal, true);
});
test('read-only status and private request export preserve the exact pending request', async t => {
  const fixture = await setup(t), output = join(fixture.dir, 'pending.json');
  assert.equal(fixture.run('status', ...fixture.args).exitCode, 0);
  assert.equal(fixture.run('request', ...fixture.args, ID, 'runtime', output).exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).request, request()); assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.equal(fixture.run('request', ...fixture.args, ID, 'runtime', output).exitCode, 2);
  assert.equal(fixture.store.history(request().binding).length, 0);
});
test('config/context digest and exact pending inventory reject before receipt mutation', async t => {
  const fixture = await setup(t);
  for (const args of [['status', fixture.args[0]!, H], ['accept', ...fixture.args, fixture.receiptPath, fixture.contextPath, H]]) {
    assert.equal(fixture.run(...args).exitCode, 2); assert.equal(fixture.store.history(request().binding).length, 0);
  }
  fixture.value.inventory.operationIds = ['intent/unit']; fixture.context.expectedInventoryDigest = phaseInventoryDigest(fixture.value.inventory.operationIds);
  fixture.context.acceptedReceiptDigest = phaseAccountingReceiptDigest(fixture.value);
  await fixture.write('receipt.json', fixture.value); await fixture.write('context.json', fixture.context);
  assert.equal(fixture.run('accept', ...fixture.args, fixture.receiptPath, fixture.contextPath, digestJson(fixture.context)).exitCode, 2);
  assert.equal(fixture.store.history(request().binding).length, 0);
});
test('missing journal status cannot create state and error output excludes paths and raw input', async t => {
  const fixture = await setup(t), config = { ...fixture.config, journalPath: join(fixture.dir, 'private-sensitive-does-not-exist.sqlite') };
  const path = await fixture.write('missing.json', config), result = fixture.run('status', path, digestJson(config));
  assert.equal(result.exitCode, 2); assert.doesNotMatch(JSON.stringify(result.output), /private-sensitive|sqlite|\/tmp\//);
  await assert.rejects(stat(config.journalPath));
});
test('observer deadline preserves pending request and never manufactures zero billing', async t => {
  const fixture = await setup(t), controller = new AbortController();
  const waiting = createPhaseAccountingObserver(fixture.store, 10)(request(), controller.signal);
  controller.abort(new Error('invented-unit-deadline')); await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(fixture.store.requests().length, 1); const observation = fixture.store.readObservedUsage(request());
  assert.equal(observation.measuredCostUsd, null); assert.equal(observation.sandboxCpuSeconds, null); assert.equal(observation.billingComplete, false);
});
test('operator input or exported request cannot alias a SQLite journal sidecar', async t => {
  const fixture = await setup(t);
  const config = { ...fixture.config, journalPath: join(fixture.dir, 'alias.sqlite') };
  // Deliberately misname the config itself; refusal must occur before opening the DB.
  const path = await fixture.write('alias.sqlite-wal', config), original = await readFile(path);
  const result = fixture.run('status', path, digestJson(config)); assert.equal(result.exitCode, 2);
  assert.deepEqual(await readFile(path), original);
  const exported = fixture.run('request', ...fixture.args, ID, 'runtime', fixture.config.journalPath + '-wal');
  assert.equal(exported.exitCode, 2); assert.match(JSON.stringify(exported.output), /phase_operator_path_collision/);
});
