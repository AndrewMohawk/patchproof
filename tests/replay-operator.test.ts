import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { SmokeOperatorSessions } from '../packages/orchestrator/src/smoke-operator-sessions.ts';
import { createReplayOperator, ReplayOperatorConfigSchema } from '../scripts/replay-operator.ts';
import { replayData, replayFetch } from './helpers/replay-data.ts';
import { privateJson } from './helpers/smoke-operator-data.ts';

function setup() {
  const data = replayData(), transport = replayFetch(), filename = join(data.state, 'replay-config.json');
  const config = ReplayOperatorConfigSchema.parse({ schemaVersion: '1.0', kind: 'patchproof-live-replay', executionAuthorized: true,
    replayId: data.replayId, runId: data.bundle.run.id, bundleFile: join(data.state, 'bundle.json'), bundleDigest: data.bundle.bundleDigest,
    fixture: { taskId: data.fixture.id, fixtureDigest: digestJson(data.fixture), sourceDigest: data.bundle.run.sourceDigest, policyDigest: data.bundle.run.policyDigest },
    sourceDigest: data.sourceDigest, limits: { wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 1 },
    ledgerFile: data.config.ledgerFile, budgetDigest: data.config.budgetDigest, sessionFile: join(data.state, 'replay.sqlite'),
    reportFile: data.reportFile, sandboxCredentialFile: data.config.sandboxCredentialFile,
    verification: data.config.sandboxVerification, cpuProof: data.config.cpuProof,
    acceptedProofDigests: [digestJson(data.config.sandboxVerification), digestJson(data.config.cpuProof)] });
  privateJson(filename, config); privateJson(config.bundleFile, data.bundle);
  const ledger = new BudgetLedger({ filename: config.ledgerFile, budget: data.budget }); ledger.close();
  const operator = createReplayOperator({ projectRoot: data.projectRoot, testing: { scope: 'synthetic-test', sourceDigest: () => data.sourceDigest, fetch: transport.fetch } });
  const rewrite = () => { privateJson(filename, config); return digestJson(config); };
  return { ...data, config, filename, operator, transport, rewrite, accepted: digestJson(config),
    close: () => rmSync(data.directory, { recursive: true, force: true }) };
}
test('preflight is credential-free; exact exported public bundle replays once with durable private results and unknown billing', async () => {
  const unit = setup();
  try {
    privateJson(unit.config.sandboxCredentialFile, { invalid: 'metadata-only preflight must not parse this' });
    const preflight = await unit.operator.preflight(unit.filename, unit.accepted);
    assert.equal(preflight.providerCalls, 0); assert.equal(preflight.credentialsRead, 0);
    assert.equal(existsSync(unit.config.sessionFile), false); assert.equal(existsSync(unit.config.reportFile), false);
    privateJson(unit.config.sandboxCredentialFile, { token: 'SYNTHETIC-UNIT-ONLY' });
    const result = await unit.operator.start(unit.filename, unit.accepted, new AbortController().signal);
    assert.equal(result.status, 'reproduced'); assert.equal(result.scope, 'synthetic-test');
    const report = JSON.parse(readFileSync(unit.config.reportFile, 'utf8'));
    assert.equal(report.result.status, 'reproduced'); assert.equal(report.batches.length, 2);
    assert.equal(report.progress.observedCpuSeconds, 0.02); assert.equal(report.reservation.reconciliationComplete, false);
    assert.equal(report.reservation.heldMicros, '100000'); assert.equal(report.envelope.modelCalls, 0);
    for (const batch of report.batches) assert.equal(digestBytes(readFileSync(batch.path)), batch.digest);
    const priorCalls = unit.transport.calls.length;
    const duplicate = await unit.operator.start(unit.filename, unit.accepted, new AbortController().signal);
    assert.equal(duplicate.reused, true); assert.equal(unit.transport.calls.length, priorCalls);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC-UNIT-ONLY'));
    assert.ok(!JSON.stringify(unit.operator.status(unit.filename, unit.accepted)).includes('rawBatch'));
  } finally { unit.close(); }
});
test('configuration, source, bundle and current curated fixture pins fail before provider dispatch', async () => {
  for (const change of ['config', 'source', 'bundle', 'fixture'] as const) {
    const unit = setup();
    try {
      let accepted = unit.accepted;
      if (change === 'config') accepted = digestBytes('unaccepted');
      if (change === 'source') { unit.config.sourceDigest = digestBytes('changed'); accepted = unit.rewrite(); }
      if (change === 'bundle') privateJson(unit.config.bundleFile, { bad: true });
      if (change === 'fixture') privateJson(join(unit.projectRoot, 'fixtures/development/unit.json'), { ...unit.fixture, description: 'Changed current curated fixture' });
      await assert.rejects(unit.operator.preflight(unit.filename, accepted));
      assert.equal(unit.transport.calls.length, 0); assert.equal(existsSync(unit.config.sessionFile), false);
      const ledger = new BudgetLedger({ filename: unit.config.ledgerFile, budget: unit.budget });
      try { assert.equal(ledger.snapshot().reservationCount, 0); } finally { ledger.close(); }
    } finally { unit.close(); }
  }
});
test('missing ledger, output overwrite and database-sidecar collisions cannot initialize another allowance', async () => {
  for (const change of ['missing', 'output', 'collision'] as const) {
    const unit = setup();
    try {
      if (change === 'missing') unit.config.ledgerFile = join(unit.state, 'absent.sqlite');
      if (change === 'output') privateJson(unit.config.reportFile, { preserve: true });
      if (change === 'collision') unit.config.reportFile = unit.config.ledgerFile + '-wal';
      const accepted = unit.rewrite();
      await assert.rejects(unit.operator.preflight(unit.filename, accepted));
      assert.equal(unit.transport.calls.length, 0); assert.equal(existsSync(unit.config.sessionFile), false);
      if (change === 'missing') assert.equal(existsSync(unit.config.ledgerFile), false);
      if (change === 'output') assert.deepEqual(JSON.parse(readFileSync(unit.config.reportFile, 'utf8')), { preserve: true });
    } finally { unit.close(); }
  }
});
test('status does not create sessions; cancel and recover never grant another start', async () => {
  const unit = setup();
  try {
    assert.equal(unit.operator.status(unit.filename, unit.accepted).status, 'not-started');
    assert.equal(existsSync(unit.config.sessionFile), false);
    assert.throws(() => unit.operator.cancel(unit.filename, unit.accepted), /not_started/);
    const sessions = new SmokeOperatorSessions({ filename: unit.config.sessionFile });
    const claim = sessions.claimStart({ episodeId: unit.config.replayId, configDigest: unit.accepted, scope: 'synthetic-test' });
    assert.equal(claim.granted, true);
    assert.equal(unit.operator.cancel(unit.filename, unit.accepted).session!.cancelRequested, true);
    assert.throws(() => unit.operator.recover(unit.filename, unit.accepted), /owner_still_alive/);
    sessions.finish(claim.token!, { status: 'synthetic-ended' }); sessions.close();
    const result = await unit.operator.start(unit.filename, unit.accepted, new AbortController().signal);
    assert.equal(result.reused, true); assert.equal(unit.transport.calls.length, 0);
  } finally { unit.close(); }
});
test('durable cancellation during a fake running operation drains cleanup and retains the full reservation', async () => {
  const unit = setup(); let requested = false;
  const transport = replayFetch({ beforeRequest: async (url, options) => {
    if (options?.method === 'GET' && !requested) {
      requested = true; unit.operator.cancel(unit.filename, unit.accepted);
      await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
    }
  } });
  const operator = createReplayOperator({ projectRoot: unit.projectRoot,
    testing: { scope: 'synthetic-test', sourceDigest: () => unit.sourceDigest, fetch: transport.fetch } });
  try {
    const result = await operator.start(unit.filename, unit.accepted, new AbortController().signal);
    assert.equal(result.status, 'blocked');
    const report = JSON.parse(readFileSync(unit.config.reportFile, 'utf8'));
    assert.equal(report.errorCode, 'replay_cancelled'); assert.equal(report.progress.phase, 'terminal');
    assert.ok(transport.calls.some(call => call.method === 'DELETE'));
    assert.equal(report.reservation.heldMicros, '100000'); assert.equal(report.reservation.reconciliationComplete, false);
    assert.ok(report.progress.operationIds.some((id: string) => id.startsWith('nebius:operation:')));
  } finally { unit.close(); }
});
