import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureSchema, PRODUCT_CONTRACT_VERSION } from '../packages/contracts/src/product.ts';
import type { CheckRunner, RepairProvider } from '../packages/contracts/src/product.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore, buildEvidence, reproduceEvidence, verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { fixtureDigests } from '../packages/orchestrator/src/fixtures.ts';
import { createPatch, applyPatch } from '../packages/orchestrator/src/patch.ts';
import { acquireCoordinatorLease } from '../packages/orchestrator/src/lease.ts';

const fixture = FixtureSchema.parse({ id: 'owned-unit-fixture', repoId: 'unit-only', split: 'development', title: 'Unit fixture',
  description: 'Unit test data, never an experiment task.', requirements: [{ id: 'R01', text: 'Return two.' }, { id: 'R02', text: 'Preserve helper.' }],
  files: { 'solution.py': 'def f():\n    return 1\n', 'helper.py': 'VALUE = 1\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [{ id: 'visible', requirementId: 'R01', function: 'f', args: [], expected: 2 }],
  acceptanceCases: [{ id: 'acceptance', requirementId: 'R02', function: 'f', args: [], expected: 2 }], license: 'CC0-1.0', provenance: 'unit-only original fixture',
});
const provider: RepairProvider = { mode: 'mock', async propose() { return {
  files: { 'solution.py': 'def f():\n    return 2\n' }, summary: 'Synthetic unit-test proposal.',
  usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 }, modelId: null, providerRequestId: null,
}; } };
const checker: CheckRunner = { async run(input) {
  input.onOperation?.('synthetic-unit-operation');
  const pass = input.files['solution.py']!.includes('return 2');
  return { checks: input.cases.map(c => ({ id: c.id, requirementId: c.requirementId, status: pass ? 'pass' : 'fail', message: 'Synthetic unit check',
    actual: pass ? 2 : 1, expected: 2, durationMs: 1, log: 'Synthetic unit-test observation.' })), isolation: 'local_container',
    operationIds: ['synthetic-unit-operation'], cpuSeconds: 0, measuredCostUsd: 0, infrastructureError: null };
} };

test('coordinator preserves protected helpers, publishes coherent evidence, and replays actual diff', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-orchestrator-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks: checker,
    journal: new RunJournal(join(dir, 'runs.sqlite')), store: new EvidenceStore(join(dir, 'evidence')) });
  const request = { taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'unit-request-01' };
  const { run } = coordinator.create(request);
  assert.equal(coordinator.create(request).run.id, run.id);
  coordinator.subscribe(run.id, () => { throw new Error('broken subscriber'); });
  await coordinator.settled();
  const done = coordinator.get(run.id);
  assert.equal(done.terminalStatus, 'verified_for_declared_checks');
  assert.equal(done.candidates[0]!.files['helper.py'], fixture.files['helper.py']);
  assert.ok(done.sandboxOperationIds.length > 0);
  const bundle = await coordinator.evidence(run.id);
  assert.equal(verifyEvidence(bundle).run.id, run.id);
  assert.equal((await reproduceEvidence(bundle, checker, new AbortController().signal)).status, 'reproduced');
  assert.throws(() => verifyEvidence({ ...bundle, competitionReady: true }));
  await coordinator.close();
  const reopened = new RunJournal(join(dir, 'runs.sqlite'), true);
  assert.equal(reopened.get(run.id).terminalStatus, 'verified_for_declared_checks'); reopened.close();
});

test('infrastructure errors retain partial checks and operation IDs in evidence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-infra-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const fault: CheckRunner = { async run(input, signal) {
    const result = await checker.run(input, signal);
    if (++calls === 2) { result.infrastructureError = 'timeout'; result.checks.forEach(c => { c.status = 'error'; }); }
    return result;
  } };
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks: fault,
    journal: new RunJournal(join(dir, 'runs.sqlite')), store: new EvidenceStore(join(dir, 'evidence')) });
  const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'failed-run-01' });
  await coordinator.settled();
  const bundle = await coordinator.evidence(run.id);
  assert.equal(bundle.run.terminalStatus, 'infrastructure_error');
  assert.equal(bundle.run.candidates[0]!.visibleChecks[0]!.status, 'error');
  assert.equal(bundle.run.candidates[0]!.sandboxOperationIds.length, 1);
  await coordinator.close();
});

test('publication failure cannot leave an approval in the final journal event', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-publish-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  class FailedStore extends EvidenceStore { override async put() { throw new Error('disk unavailable'); } }
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks: checker,
    journal: new RunJournal(join(dir, 'runs.sqlite')), store: new FailedStore(join(dir, 'evidence')) });
  const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'unit-test-01' });
  await coordinator.settled(); const done = coordinator.get(run.id);
  assert.equal(done.reason, 'evidence_publish_failed');
  assert.match(done.events.at(-1)!.message, /infrastructure_error/);
  assert.doesNotMatch(done.events.at(-1)!.message, /verified_for_declared_checks/);
  await coordinator.close();
});

test('restart recovery reconciles run-owned handles before recording interruption', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-restart-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = new RunJournal(join(dir, 'runs.sqlite'));
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks: checker, journal, store: new EvidenceStore(join(dir, 'evidence')) });
  const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'restart-test-01' });
  await coordinator.settled(); const interrupted = coordinator.get(run.id);
  interrupted.phase = 'check'; interrupted.terminalStatus = null; interrupted.finishedAt = null;
  interrupted.events.at(-1)!.phase = 'check'; journal.save(interrupted);
  await coordinator.close();
  let recovered: string[] = [];
  const recoveryChecker: CheckRunner = { ...checker, async reconcile(ids) { recovered = ids; return { remainingOperationIds: [], error: null }; } };
  const restarted = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks: recoveryChecker,
    journal: new RunJournal(join(dir, 'runs.sqlite')), store: new EvidenceStore(join(dir, 'evidence')) });
  await restarted.recover();
  assert.deepEqual(recovered, [run.id]); assert.equal(restarted.get(run.id).reason, 'interrupted_by_restart');
  await restarted.close();
});

test('recovery with a changed runtime preserves old bindings without serving stale or fabricated evidence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-recovery-lock-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'runs.sqlite'), store = new EvidenceStore(join(dir, 'evidence'));
  const journal = new RunJournal(path);
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: { revision: 'original' }, provider, checks: checker, journal, store });
  const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'runtime-drift-01' });
  await coordinator.settled();
  const oldDigest = journal.evidenceDigest(run.id)!;
  const interrupted = coordinator.get(run.id);
  interrupted.phase = 'check'; interrupted.terminalStatus = null; interrupted.finishedAt = null; interrupted.events.at(-1)!.phase = 'check';
  journal.save(interrupted);
  await coordinator.close();
  const nextJournal = new RunJournal(path);
  const restarted = new Coordinator({ fixtures: [fixture], runtimeLock: { revision: 'changed' }, provider,
    checks: { ...checker, async reconcile() { return { remainingOperationIds: [], error: null }; } }, journal: nextJournal, store });
  try {
    await restarted.recover();
    const done = restarted.get(run.id);
    assert.equal(done.phase, 'terminal');
    assert.equal(done.terminalStatus, 'needs_review');
    assert.equal(done.reason, 'recovery_runtime_changed');
    assert.equal(done.runtimeLockDigest, interrupted.runtimeLockDigest);
    assert.equal(done.sourceDigest, interrupted.sourceDigest);
    assert.equal(nextJournal.evidenceDigest(run.id), null);
    await assert.rejects(restarted.evidence(run.id), /not available/);
    assert.deepEqual((await store.get(oldDigest)).runtimeLock, { revision: 'original' });
    await restarted.recover();
    assert.equal(restarted.get(run.id).events.length, done.events.length, 'Terminal interruption is not retried.');
  } finally { await restarted.close(); }
});

test('recovery checker failure records an infrastructure error without blocking startup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-recovery-error-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'runs.sqlite'), store = new EvidenceStore(join(dir, 'evidence'));
  const journal = new RunJournal(path);
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks: checker, journal, store });
  const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'recovery-error-01' });
  await coordinator.settled();
  const interrupted = coordinator.get(run.id);
  interrupted.phase = 'check'; interrupted.terminalStatus = null; interrupted.finishedAt = null; interrupted.events.at(-1)!.phase = 'check';
  journal.save(interrupted); await coordinator.close();
  const restarted = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, journal: new RunJournal(path), store,
    checks: { ...checker, async reconcile() { throw new Error('synthetic daemon outage'); } } });
  try {
    await restarted.recover();
    const bundle = await restarted.evidence(run.id);
    assert.equal(bundle.run.terminalStatus, 'infrastructure_error');
    assert.equal(bundle.run.reason, 'restart_cleanup_unverified');
    assert.match(bundle.run.events.at(-1)!.message, /Cleanup unverified/);
  } finally { await restarted.close(); }
});

test('coordinator lease refuses a second live owner and releases its own lease', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-lease-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const release = await acquireCoordinatorLease(dir);
  await assert.rejects(acquireCoordinatorLease(dir), /already running/); await release();
  await (await acquireCoordinatorLease(dir))();
});

test('diff replay reconstructs added files and exact missing final newlines', async () => {
  const before = { 'solution.py': 'old' };
  const after = { 'solution.py': 'new\n', 'helper.py': 'helper' };
  assert.deepEqual(await applyPatch(before, createPatch(before, after)), after);
});

test('current evidence binds all task metadata and never guesses a legacy digest after mismatch', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'patchproof-evidence-version-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks: checker,
    journal: new RunJournal(join(dir, 'runs.sqlite')), store: new EvidenceStore(join(dir, 'evidence')) });
  try {
    const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'metadata-binding-01' });
    await coordinator.settled();
    const bundle = await coordinator.evidence(run.id);
    assert.equal(bundle.schemaVersion, PRODUCT_CONTRACT_VERSION);
    assert.equal(bundle.schemaVersion, '2.2');
    const redigest = <T extends { bundleDigest: string }>(value: T) => { const { bundleDigest: _digest, ...body } = value; return { ...body, bundleDigest: digestJson(body) }; };
    for (const field of ['description', 'title', 'repoId', 'provenance'] as const) {
      const changed = structuredClone(bundle);
      changed.fixture[field] += ' changed';
      assert.notEqual(fixtureDigests(changed.fixture).policyDigest, bundle.run.policyDigest, field);
      assert.equal(fixtureDigests(changed.fixture).sourceDigest, bundle.run.sourceDigest);
      assert.throws(() => verifyEvidence(redigest(changed)), /Immutable input mismatch/, field);
    }
    const changedSplit = structuredClone(bundle);
    changedSplit.fixture.split = 'calibration';
    assert.throws(() => verifyEvidence(redigest(changedSplit)), /Immutable input mismatch/);
    const legacy = buildEvidence({ ...bundle.run, schemaVersion: '2.0', ...fixtureDigests(fixture, '2.0') }, fixture, {});
    assert.notEqual(legacy.run.policyDigest, bundle.run.policyDigest);
    assert.equal(verifyEvidence(legacy).schemaVersion, '2.0');
    assert.equal((await reproduceEvidence(legacy, checker, new AbortController().signal)).status, 'reproduced');
    assert.equal((await reproduceEvidence(bundle, checker, new AbortController().signal)).status, 'reproduced');
    // Re-labelling a version must not trigger a fallback to whichever formula matches.
    assert.throws(() => verifyEvidence(redigest({ ...bundle, schemaVersion: '2.0', run: { ...bundle.run, schemaVersion: '2.0' } })), /Immutable input mismatch/);
    assert.throws(() => verifyEvidence(redigest({ ...legacy, schemaVersion: '2.1', run: { ...legacy.run, schemaVersion: '2.1' } })), /Immutable input mismatch/);
    assert.throws(() => verifyEvidence(redigest({ ...bundle, schemaVersion: '2.0' })), /schema validation failed/);
    assert.throws(() => verifyEvidence(redigest({ ...bundle, schemaVersion: '9.9', run: { ...bundle.run, schemaVersion: '9.9' } })), /schema validation failed/);
    const interruptedLegacy = structuredClone(legacy.run);
    interruptedLegacy.phase = 'check'; interruptedLegacy.terminalStatus = null; interruptedLegacy.finishedAt = null;
    interruptedLegacy.events.at(-1)!.phase = 'check';
    coordinator.journal.save(interruptedLegacy);
    await coordinator.recover();
    const recovered = coordinator.get(run.id);
    assert.equal(recovered.reason, 'recovery_contract_changed');
    assert.equal(recovered.terminalStatus, 'needs_review');
    assert.equal(recovered.schemaVersion, '2.0');
    assert.equal(recovered.policyDigest, legacy.run.policyDigest);
    await assert.rejects(coordinator.evidence(run.id), /not available/);
  } finally { await coordinator.close(); }
});
