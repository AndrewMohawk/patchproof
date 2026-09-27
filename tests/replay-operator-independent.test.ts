import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { createReplayOperator, ReplayOperatorConfigSchema } from '../scripts/replay-operator.ts';
import { replayData, replayFetch } from './helpers/replay-data.ts';
import { privateJson } from './helpers/smoke-operator-data.ts';

function setup() {
  const data = replayData(), transport = replayFetch(), filename = join(data.state, 'independent-replay.json');
  const config = ReplayOperatorConfigSchema.parse({ schemaVersion: '1.0', kind: 'patchproof-live-replay', executionAuthorized: true,
    replayId: data.replayId, runId: data.bundle.run.id, bundleFile: join(data.state, 'bundle.json'), bundleDigest: data.bundle.bundleDigest,
    fixture: { taskId: data.fixture.id, fixtureDigest: digestJson(data.fixture), sourceDigest: data.bundle.run.sourceDigest, policyDigest: data.bundle.run.policyDigest },
    sourceDigest: data.sourceDigest, limits: { wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 1 },
    ledgerFile: data.config.ledgerFile, budgetDigest: data.config.budgetDigest, sessionFile: join(data.state, 'replay.sqlite'),
    reportFile: data.reportFile, sandboxCredentialFile: data.config.sandboxCredentialFile,
    verification: data.config.sandboxVerification, cpuProof: data.config.cpuProof,
    acceptedProofDigests: [digestJson(data.config.sandboxVerification), digestJson(data.config.cpuProof)] });
  privateJson(filename, config); privateJson(config.bundleFile, data.bundle);
  const operator = createReplayOperator({ projectRoot: data.projectRoot,
    testing: { scope: 'synthetic-test', sourceDigest: () => data.sourceDigest, fetch: transport.fetch } });
  return { ...data, config, filename, operator, transport, accepted: digestJson(config) };
}

test('replay preflight rejects empty or unrelated existing ledger files without creating a fresh approval', async t => {
  for (const kind of ['empty', 'unrelated']) {
    const unit = setup(); t.after(() => rmSync(unit.directory, { recursive: true, force: true }));
    writeFileSync(unit.config.ledgerFile, '', { mode: 0o600 });
    if (kind === 'unrelated') { const db = new DatabaseSync(unit.config.ledgerFile); db.exec('CREATE TABLE unrelated(value TEXT)'); db.close(); }
    privateJson(unit.config.sandboxCredentialFile, { invalid: 'must remain unread' });
    const before = readFileSync(unit.config.ledgerFile);
    await assert.rejects(unit.operator.preflight(unit.filename, unit.accepted), /schema is missing/);
    assert.deepEqual(readFileSync(unit.config.ledgerFile), before); assert.equal(unit.transport.calls.length, 0);
    assert.equal(existsSync(unit.config.sessionFile), false); assert.equal(existsSync(unit.config.reportFile), false);
  }
});

test('late report collision preserves raw batches and a durable terminal no-retry claim', async t => {
  const unit = setup(); t.after(() => rmSync(unit.directory, { recursive: true, force: true }));
  const ledger = new BudgetLedger({ filename: unit.config.ledgerFile, budget: unit.budget }); ledger.close();
  let installed = false;
  const transport = replayFetch({ beforeRequest: (_url, init) => {
    if (init?.method === 'POST' && !installed) { installed = true; privateJson(unit.config.reportFile, { preserve: 'independent concurrent output' }); }
  } });
  const operator = createReplayOperator({ projectRoot: unit.projectRoot,
    testing: { scope: 'synthetic-test', sourceDigest: () => unit.sourceDigest, fetch: transport.fetch } });
  await assert.rejects(operator.start(unit.filename, unit.accepted, new AbortController().signal), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(readFileSync(unit.config.reportFile, 'utf8')), { preserve: 'independent concurrent output' });
  const session = operator.status(unit.filename, unit.accepted).session!;
  assert.equal(session.phase, 'terminal'); assert.equal((session.summary as { status: string }).status, 'blocked');
  for (const index of [1, 2]) assert.equal(existsSync(unit.config.reportFile + `.batch-${index}.json`), true);
  const calls = transport.calls.length, repeated = await operator.start(unit.filename, unit.accepted, new AbortController().signal);
  assert.equal(repeated.reused, true); assert.equal(transport.calls.length, calls);
  const reopened = new BudgetLedger({ filename: unit.config.ledgerFile, budget: unit.budget, existingOnly: true });
  try { assert.equal(reopened.snapshot().pendingBillingCount, 1); assert.equal(reopened.snapshot().heldMicros, '100000'); }
  finally { reopened.close(); }
});
