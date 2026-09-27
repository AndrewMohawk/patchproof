import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digestBytes } from '../packages/contracts/src/digest.ts';
import { hashJson, planExperiment } from '../workers/evaluator/protocol.ts';
import { captureExperimentSnapshot, exportExperiment, verifyExperimentExport, validateExperimentCapture, liveReadinessReceiptDigest } from '../workers/evaluator/experiment-export.ts';
import type { ExperimentCapture, LiveReadinessReceipt } from '../workers/evaluator/experiment-export.ts';

// Independent controls use invented metadata only. No executor, provider or task files are opened.
const SOURCE = digestBytes('independent synthetic source'), MODEL = digestBytes('independent synthetic model');
const TRANSPORT = digestBytes('independent synthetic transport'), POLICY = digestBytes('independent synthetic policy');
const NOW = '2026-09-27T20:00:00.000Z';
const usage = () => ({ inferenceCalls: 0, inputTokens: 0, outputTokens: 0, runtimeFeedbackRounds: 0, elapsedMs: 0, sandboxCpuSeconds: 0, measuredCostUsd: 0 });
function makeCapture(mode: 'synthetic' | 'live' = 'synthetic'): ExperimentCapture {
  const plan = planExperiment({ kind: 'pilot', tasks: Array.from({ length: 20 }, (_, index) => ({
    id: `invented-item-${index}`, repoId: `invented-repository-${Math.floor(index / 5)}`, split: 'development' as const,
    fixtureDigest: SOURCE, oracleDigest: POLICY })),
    limits: { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 0.01 },
    sourceManifestDigest: SOURCE, modelLockDigest: MODEL, policyDigest: POLICY,
    approvedExperimentBudgetUsd: 3, estimatedExperimentCostUsd: 1, createdAt: NOW });
  const bindings = { sourceDigest: SOURCE, planDigest: hashJson(plan), transportDigest: TRANSPORT };
  return { schemaVersion: '1.0', kind: 'trusted-experiment-metadata', capturedAt: NOW, bindings,
    sourceBinding: 'expected-historical-lock', executionMode: mode, benchmarkExecuted: false, plan,
    episodes: plan.episodes.map(episode => {
      const h = hashJson([bindings.planDigest, episode.id]).slice(7);
      return { episodeId: episode.id, dispatchId: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
        phase: 'pending', reason: null, cancelRequested: false, operationIds: [], observedUsage: usage(), result: null };
    }) };
}
function terminal(capture: ExperimentCapture, index: number, outcome: 'correct' | 'unverified' = 'unverified') {
  const row = capture.episodes[index]!, episode = capture.plan.episodes[index]!;
  row.phase = 'terminal'; row.reason = 'completed';
  const result = { episodeId: episode.id, planDigest: capture.bindings.planDigest, modelLockDigest: MODEL, policyDigest: POLICY,
    variant: episode.variant, outcome, runtimeApproved: false, sealedChecksExecuted: outcome === 'correct', includesSetupAndRetries: true as const,
    finalOracleFeedbackRounds: 0 as const, infrastructureExclusion: null, usage: usage(), artifactsDigest: POLICY };
  row.result = capture.executionMode === 'synthetic' ? { ...result, executionMode: 'synthetic', benchmarkExecuted: false } : { ...result, executionMode: 'live' };
}
function ready(capture: ExperimentCapture): LiveReadinessReceipt {
  return { schemaVersion: '1.0', kind: 'experiment-preflight-readiness', bindings: capture.bindings, observedAt: NOW,
    gates: { accountAccessVerified: true, sandboxEntitlementVerified: true, modelVerified: true, realIntegrationPassed: true,
      oracleIndependentlyReviewed: true, experimentApproved: true, approvedRemainingSpendUsd: 3, pricesVerified: true, finalProtocolFrozen: true } };
}
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-export-independent-')), projectRoot = join(directory, 'project');
  mkdirSync(projectRoot, { mode: 0o700 });
  t.after(() => { for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) chmodSync(join(directory, entry.name), 0o700); rmSync(directory, { recursive: true, force: true }); });
  const output = (name = 'bundle') => join(directory, name);
  const write = (capture: ExperimentCapture, receipt?: LiveReadinessReceipt, name = 'bundle') => exportExperiment({ directory: output(name), projectRoot,
    capture, expected: capture.bindings, ...(receipt ? { liveReadinessReceipt: receipt, acceptedReadinessReceiptDigest: liveReadinessReceiptDigest(receipt) } : {}) });
  return { directory, projectRoot, output, write };
}
function database(directory: string, capture: ExperimentCapture) {
  const filename = join(directory, 'projection.db'); writeFileSync(filename, '', { mode: 0o600 });
  const db = new DatabaseSync(filename); db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE experiment(id INTEGER PRIMARY KEY,plan_digest TEXT,plan_json TEXT,mode TEXT,transport_digest TEXT);
    CREATE TABLE episodes(episode_id TEXT,dispatch_id TEXT,position INTEGER,phase TEXT,reason TEXT,cancel_requested INTEGER,usage_json TEXT,operations_json TEXT,result_json TEXT,execution_json TEXT);
    CREATE TABLE dispatch_events(kind TEXT, details TEXT);`);
  db.prepare('INSERT INTO experiment VALUES(1,?,?,?,?)').run(capture.bindings.planDigest, JSON.stringify(capture.plan), capture.executionMode, capture.bindings.transportDigest);
  for (const [position, row] of capture.episodes.entries()) db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?,?)').run(row.episodeId, row.dispatchId,
    position, row.phase, row.reason, Number(row.cancelRequested), JSON.stringify(row.observedUsage), JSON.stringify(row.operationIds), row.result ? JSON.stringify(row.result) : null,
    'SYNTHETIC_UNSELECTED_DETAIL not valid JSON');
  db.prepare('INSERT INTO dispatch_events VALUES(?,?)').run('metadata_only', 'SYNTHETIC_EVENT_DETAIL not valid JSON');
  return { filename, db };
}
function rehash(directory: string, name: string, value: unknown) {
  chmodSync(directory, 0o700); const path = join(directory, name), bytes = Buffer.from(JSON.stringify(value) + '\n');
  chmodSync(path, 0o600); writeFileSync(path, bytes); chmodSync(path, 0o400);
  const manifestPath = join(directory, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = manifest.artifacts.find((item: { path: string }) => item.path === name); entry.bytes = bytes.length; entry.digest = digestBytes(bytes);
  chmodSync(manifestPath, 0o600); writeFileSync(manifestPath, JSON.stringify(manifest) + '\n'); chmodSync(manifestPath, 0o400);
}

test('inherited object names remain numeric terminal reason counts', t => {
  const s = setup(t), capture = makeCapture();
  for (let index = 0; index < 3; index++) terminal(capture, index);
  capture.episodes[0]!.reason = 'constructor'; capture.episodes[1]!.reason = 'constructor'; capture.episodes[2]!.reason = 'tostring';
  const result = s.write(capture);
  assert.equal(result.summary.byReason.constructor, 2); assert.equal(result.summary.byReason.tostring, 1);
  assert.equal(verifyExperimentExport({ directory: s.output(), expected: capture.bindings }).summary.byReason.constructor, 2);
});

test('unverified rows cannot claim completed sealed adjudication', () => {
  for (const mode of ['synthetic', 'live'] as const) {
    const capture = makeCapture(mode); capture.benchmarkExecuted = mode === 'live'; terminal(capture, 0);
    capture.episodes[0]!.result!.sealedChecksExecuted = true;
    assert.throws(() => validateExperimentCapture(capture, capture.bindings), /verdict|sealed/i);
  }
});

test('capture uses one SQLite snapshot while a concurrent writer changes metadata and grid', t => {
  const s = setup(t), capture = makeCapture(), { filename, db } = database(s.directory, capture); t.after(() => db.close());
  const original = DatabaseSync.prototype.prepare; let changed = false;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
    if (!changed && sql.startsWith('SELECT episode_id,dispatch_id,position')) {
      changed = true;
      db.exec('BEGIN IMMEDIATE');
      original.call(db, 'UPDATE experiment SET transport_digest=? WHERE id=1').run(POLICY);
      db.exec('DELETE FROM episodes WHERE position=0; COMMIT;');
    }
    return original.call(this, sql);
  });
  const result = captureExperimentSnapshot({ dispatcherDatabase: filename, expected: capture.bindings, sourceBinding: 'expected-historical-lock', now: () => new Date(NOW) });
  assert.equal(changed, true); assert.deepEqual(result, capture);
  assert.throws(() => captureExperimentSnapshot({ dispatcherDatabase: filename, expected: capture.bindings, sourceBinding: 'expected-historical-lock' }), /binding/);
});

test('offline verification needs no dispatcher or source tree and exports no private detail columns', t => {
  const s = setup(t), capture = makeCapture(), { filename, db } = database(s.directory, capture); db.close();
  const snapshot = captureExperimentSnapshot({ dispatcherDatabase: filename, expected: capture.bindings, sourceBinding: 'expected-historical-lock', now: () => new Date(NOW) });
  const exported = s.write(snapshot);
  for (const file of readdirSync(s.output())) {
    const text = readFileSync(join(s.output(), file), 'utf8');
    assert.equal(text.includes('SYNTHETIC_UNSELECTED_DETAIL'), false); assert.equal(text.includes('SYNTHETIC_EVENT_DETAIL'), false);
  }
  rmSync(filename); rmSync(s.projectRoot, { recursive: true });
  const verified = verifyExperimentExport({ directory: s.output(), expected: capture.bindings, expectedManifestDigest: exported.manifestDigest });
  assert.equal(verified.integrityVerified, true); assert.equal(verified.authenticityVerified, false);
  assert.equal(verified.manifest.sourceExecutionVerified, false); assert.equal(verified.summary.plannedEpisodes, 72);
});

test('unknown final billing retains observed lower bounds without enabling comparative claims', t => {
  const s = setup(t), capture = makeCapture('live'); capture.benchmarkExecuted = true;
  for (let index = 0; index < capture.episodes.length; index++) terminal(capture, index, 'correct');
  capture.episodes[0]!.observedUsage.measuredCostUsd = 0.004;
  capture.episodes[0]!.observedUsage.sandboxCpuSeconds = 2;
  capture.episodes[0]!.result!.usage.measuredCostUsd = null;
  capture.episodes[0]!.result!.usage.sandboxCpuSeconds = null;
  const result = s.write(capture, ready(capture)), analysis = result.analysis as { report: { comparisons: unknown[]; budgetEvidenceIncomplete: unknown[]; metrics: Array<{ primaryYield: { denominator: number } }> } };
  assert.equal(result.summary.observedUsageLowerBounds.measuredCostUsd, 0.004);
  assert.equal(result.summary.observedUsageLowerBounds.sandboxCpuSeconds, 2);
  assert.deepEqual(result.summary.unknownCostEpisodeIds, [capture.episodes[0]!.episodeId]);
  assert.equal(analysis.report.comparisons.length, 0); assert.equal(analysis.report.budgetEvidenceIncomplete.length, 2);
  assert.equal(analysis.report.metrics.reduce((n, row) => n + row.primaryYield.denominator, 0), 72);
  assert.equal(JSON.parse(readFileSync(join(s.output(), 'results.json'), 'utf8'))[0].usage.measuredCostUsd, null);
});

test('partial live metadata keeps cancelled and missing episodes in the primary denominator', t => {
  const s = setup(t), capture = makeCapture('live'); capture.benchmarkExecuted = true; terminal(capture, 0);
  capture.episodes[0]!.reason = 'cancelled'; capture.episodes[0]!.cancelRequested = true;
  capture.episodes[1]!.phase = 'executing'; capture.episodes[1]!.observedUsage.inferenceCalls = 2;
  const result = s.write(capture, ready(capture)), analysis = result.analysis as { report: { complete: boolean; comparisons: unknown[]; metrics: Array<{ primaryYield: { denominator: number } }> } };
  assert.equal(result.summary.missingResultEpisodeIds.length, 71); assert.equal(result.summary.terminalEpisodes, 1);
  assert.equal(result.summary.cancelledEpisodeIds.length, 1); assert.equal(result.summary.activeEpisodes, 1);
  assert.equal(analysis.report.complete, false); assert.equal(analysis.report.comparisons.length, 0);
  assert.equal(analysis.report.metrics.reduce((n, row) => n + row.primaryYield.denominator, 0), 72);
});

test('readiness cannot be self-authorized, future dated or bound to another transport', t => {
  const s = setup(t), capture = makeCapture('live'); capture.benchmarkExecuted = true;
  const receipt = ready(capture), options = { directory: s.output(), projectRoot: s.projectRoot, capture, expected: capture.bindings };
  assert.throws(() => exportExperiment({ ...options, liveReadinessReceipt: receipt }), /accepted/);
  receipt.observedAt = '2026-09-28T20:00:00.000Z';
  assert.throws(() => exportExperiment({ ...options, liveReadinessReceipt: receipt, acceptedReadinessReceiptDigest: liveReadinessReceiptDigest(receipt) }), /time/);
  receipt.observedAt = NOW; receipt.bindings = { ...receipt.bindings, transportDigest: POLICY };
  assert.throws(() => exportExperiment({ ...options, liveReadinessReceipt: receipt, acceptedReadinessReceiptDigest: liveReadinessReceiptDigest(receipt) }), /binding/);
});

test('consistent file rehashes cannot hide dropped or changed grid identity', t => {
  const s = setup(t), capture = makeCapture(); s.write(capture);
  const progress = JSON.parse(readFileSync(join(s.output(), 'progress.json'), 'utf8'));
  progress.episodes[0].episodeId = progress.episodes[1].episodeId; rehash(s.output(), 'progress.json', progress);
  assert.throws(() => verifyExperimentExport({ directory: s.output(), expected: capture.bindings }), /identity/);
});
