import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { digestBytes } from '../packages/contracts/src/digest.ts';
import { planExperiment, hashJson } from '../workers/evaluator/protocol.ts';
import { ExperimentSessionConfigSchema, experimentSessionConfigDigest, runExperimentSession } from '../workers/evaluator/experiment-session.ts';
import type { ExperimentSessionCommand, ExperimentSessionDependencies, SessionFactoryContext } from '../workers/evaluator/experiment-session.ts';
import { runExperimentSessionOperator } from '../scripts/experiment-session-cli.ts';

// Invented plans, metadata callbacks and private temporary journals only. No candidate or provider work.
const SOURCE = digestBytes('invented source'), POLICY = digestBytes('invented policy'), FACTORY = digestBytes('invented factory'), ORACLE = digestBytes('invented unused oracle identity');
const usage = () => ({ inferenceCalls: 0, inputTokens: 0, outputTokens: 0, runtimeFeedbackRounds: 0, elapsedMs: 0, sandboxCpuSeconds: 0, measuredCostUsd: 0 });
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-session-independent-')), projectRoot = join(directory, 'project');
  mkdirSync(projectRoot, { mode: 0o700 }); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const plan = planExperiment({ kind: 'pilot', tasks: Array.from({ length: 20 }, (_, i) => ({ id: `invented-task-${i}`,
    repoId: `invented-repo-${Math.floor(i / 5)}`, split: 'development' as const, fixtureDigest: SOURCE, oracleDigest: ORACLE })),
    limits: { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 900, maxApprovedSpendUsd: 0 },
    sourceManifestDigest: SOURCE, modelLockDigest: null, policyDigest: POLICY, approvedExperimentBudgetUsd: 0, estimatedExperimentCostUsd: null, createdAt: '2026-09-27T00:00:00.000Z' });
  const config = ExperimentSessionConfigSchema.parse({ schemaVersion: '1.0', kind: 'patchproof-experiment-session', sessionId: '02fcf1d0-a53b-4d03-969d-c9f260a38b20',
    dispatcherDatabase: join(directory, 'dispatch.db'), planPath: join(directory, 'plan.json'), planDigest: hashJson(plan), sourceDigest: SOURCE,
    executionMode: 'synthetic', modelLockDigest: null, policyDigest: POLICY, adjudicationBounds: null,
    transportDigest: hashJson({ modelLockDigest: null, policyDigest: POLICY, adjudicationBounds: null }), factoryDigest: FACTORY, maxNewSpendUsd: 0, readiness: null });
  const configPath = join(directory, 'config.json'); save(config.planPath, plan); save(configPath, config);
  const calls = { created: 0, closed: 0, episodes: [] as string[], contexts: [] as SessionFactoryContext[] };
  const dependencies: ExperimentSessionDependencies = { currentSourceDigest: () => SOURCE, factory: { factoryDigest: FACTORY, sourceDigest: SOURCE,
    transportDigest: config.transportDigest, create: context => {
      calls.created++; calls.contexts.push(context);
      return { transport: { executionMode: 'synthetic', modelLockDigest: null, policyDigest: POLICY,
        execute: async input => { calls.episodes.push(input.episodeId); return { selectionFinalized: true, selectedCandidate: null, runtimeApproved: false,
          usage: usage(), billingComplete: true, artifactsDigest: SOURCE, infrastructureExclusion: null }; },
        adjudicate: async () => { throw new Error('No candidate exists in this metadata test.'); } }, close: () => { calls.closed++; } };
    } } };
  const request = (command: ExperimentSessionCommand, episodeId?: string) => ({ command, configPath,
    expectedConfigDigest: experimentSessionConfigDigest(config), projectRoot, ...(episodeId === undefined ? {} : { episodeId }) });
  return { directory, projectRoot, plan, config, configPath, dependencies, calls, request, saveConfig: () => save(configPath, config) };
}

test('async factory boundary cannot redirect a command away from its validated audited episode', async t => {
  const s = setup(t), original = s.dependencies.factory!.create;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  s.dependencies.factory!.create = async context => { await waiting; return original(context); };
  const mutable = s.request('run-one', s.plan.episodes[0]!.id), pending = runExperimentSession(mutable, s.dependencies);
  mutable.episodeId = s.plan.episodes[1]!.id; release();
  await pending;
  assert.deepEqual(s.calls.episodes, [s.plan.episodes[0]!.id]);
  const db = new DatabaseSync(s.config.dispatcherDatabase + '.session.sqlite', { readOnly: true });
  try { assert.equal(db.prepare('SELECT episode_id FROM operator_commands').get()!.episode_id, s.calls.episodes[0]); } finally { db.close(); }
});

test('plan files cannot alias future dispatcher sidecars or be destroyed during initialization', async t => {
  for (const journal of ['', '.session.sqlite']) for (const suffix of ['-wal', '-shm', '-journal']) {
    const s = setup(t); s.config.planPath = s.config.dispatcherDatabase + journal + suffix; save(s.config.planPath, s.plan); s.saveConfig();
    const before = readFileSync(s.config.planPath);
    let rejected = false;
    try { await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), s.dependencies); } catch { rejected = true; }
    assert.equal(existsSync(s.config.planPath), true, `${suffix} input must survive refusal`);
    assert.deepEqual(readFileSync(s.config.planPath), before, `${suffix} input bytes must remain unchanged`);
    assert.equal(rejected, true, `${suffix} input/database collision must reject`);
    assert.equal(s.calls.created, 0); assert.equal(existsSync(s.config.dispatcherDatabase), false);
  }
});

test('config files also cannot alias either journal main file or SQLite sidecars', async t => {
  for (const journal of ['', '.session.sqlite']) for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const s = setup(t), alias = s.config.dispatcherDatabase + journal + suffix; save(alias, s.config);
    const before = readFileSync(alias), command = { ...s.request('run-one', s.plan.episodes[0]!.id), configPath: alias };
    await assert.rejects(runExperimentSession(command, s.dependencies), /session_path_collision/);
    assert.deepEqual(readFileSync(alias), before); assert.equal(s.calls.created, 0);
  }
});

test('status and completed-row replay do not invoke factory or current-source hooks', async t => {
  const s = setup(t); await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), s.dependencies);
  const forbidden = { ...s.dependencies, currentSourceDigest: () => { throw new Error('source lookup must not run'); },
    factory: { ...s.dependencies.factory!, create: () => { throw new Error('factory must not run'); } } };
  const status = await runExperimentSession(s.request('status'), forbidden);
  const duplicate = await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), forbidden);
  assert.equal(status.executionPerformed, false); assert.equal(duplicate.executionPerformed, false);
  assert.equal(s.calls.created, 1); assert.equal(s.calls.episodes.length, 1);
});

test('an aborted command after local factory preparation never enters a synthetic executor', async t => {
  const s = setup(t), original = s.dependencies.factory!.create, controller = new AbortController();
  s.dependencies.signal = controller.signal;
  s.dependencies.factory!.create = async context => { const runtime = await original(context); controller.abort(); return runtime; };
  const result = await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), s.dependencies);
  assert.equal(result.executionPerformed, false); assert.equal(s.calls.episodes.length, 0); assert.equal(s.calls.closed, 1);
  assert.ok('status' in result); assert.equal(result.status.capture!.episodes[0]!.reason, 'cancelled');
});

test('factory identity mismatch after construction closes local resources once without entering execution', async t => {
  const s = setup(t), original = s.dependencies.factory!.create;
  s.dependencies.factory!.create = async context => { const runtime = await original(context); runtime.transport.policyDigest = SOURCE; return runtime; };
  await assert.rejects(runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), s.dependencies), /created_transport_binding_mismatch/);
  assert.equal(s.calls.created, 1); assert.equal(s.calls.closed, 1); assert.equal(s.calls.episodes.length, 0);
  const result = await runExperimentSession(s.request('status')); assert.ok('status' in result); assert.equal(result.status.terminalEpisodes, 0);
});

test('a stale uninitialized session marker cannot adopt already executed dispatcher state', async t => {
  const s = setup(t); await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), s.dependencies);
  const db = new DatabaseSync(s.config.dispatcherDatabase + '.session.sqlite'); db.exec('UPDATE operator_session SET initialized=0'); db.close();
  await assert.rejects(runExperimentSession(s.request('run-one', s.plan.episodes[1]!.id), s.dependencies), /uncommitted_session_requires_review/);
  assert.equal(s.calls.created, 1); assert.equal(s.calls.episodes.length, 1);
});

test('missing initialized dispatcher and orphan dispatcher both stop before factory creation', async t => {
  for (const removed of ['dispatcher', 'journal'] as const) {
    const s = setup(t); await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), s.dependencies);
    rmSync(removed === 'dispatcher' ? s.config.dispatcherDatabase : s.config.dispatcherDatabase + '.session.sqlite');
    await assert.rejects(runExperimentSession(s.request('run-one', s.plan.episodes[1]!.id), s.dependencies), /state_lost|orphan_dispatcher/);
    assert.equal(s.calls.created, 1); assert.equal(s.calls.episodes.length, 1);
  }
});

test('public factory projection has no oracle or private path and cannot accept augmented inputs', async t => {
  const s = setup(t); await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), s.dependencies);
  const context = s.calls.contexts[0]!, text = JSON.stringify(context);
  assert.equal(text.includes(ORACLE), false); assert.equal(text.includes(s.directory), false); assert.equal(text.includes('oracleDigest'), false);
  assert.throws(() => context.reservationForExecution({ ...context.publicEpisodes[0], oracleDigest: ORACLE }));
  const changed = structuredClone(context.publicEpisodes[0]!); changed.repetition = (changed.repetition + 1) % 3;
  assert.throws(() => context.reservationForExecution(changed), /binding/);
  const reservation = context.reservationForExecution(context.publicEpisodes[0]);
  assert.equal(Object.keys(reservation).sort().join(','), 'amountMicros,dispatchId,publicInputDigest,reservationFingerprint,stage');
});

test('control commands never construct runtime and preserve all planned entries', async t => {
  const s = setup(t); await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id), s.dependencies);
  const forbidden = { factory: { ...s.dependencies.factory!, create: () => { throw new Error('control runtime forbidden'); } } };
  const cancelled = await runExperimentSession(s.request('cancel', s.plan.episodes[1]!.id), forbidden);
  const recovered = await runExperimentSession(s.request('recover'), forbidden);
  assert.ok('status' in cancelled); assert.ok('status' in recovered);
  assert.equal(cancelled.status.capture!.episodes[1]!.reason, 'cancelled'); assert.equal(recovered.status.plannedEpisodeIds.length, 72);
  assert.equal(s.calls.created, 1); assert.equal(s.calls.episodes.length, 1);
});

test('run error after local close failure stays unknown in sanitized CLI output and cannot replay terminal state', async t => {
  const s = setup(t), original = s.dependencies.factory!.create;
  s.dependencies.factory!.create = async context => { const runtime = await original(context); runtime.close = () => { throw new Error('private-close-sentinel'); }; return runtime; };
  const output = await runExperimentSessionOperator(['run-one', s.configPath, experimentSessionConfigDigest(s.config), s.plan.episodes[0]!.id], s.projectRoot, s.dependencies);
  assert.equal(output.exitCode, 2); assert.equal(output.output.executionPerformed, null); assert.equal(JSON.stringify(output).includes('private-close-sentinel'), false);
  assert.equal(s.calls.episodes.length, 1);
  const duplicate = await runExperimentSession(s.request('run-one', s.plan.episodes[0]!.id)); assert.equal(duplicate.executionPerformed, false);
});
