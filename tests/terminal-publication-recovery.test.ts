import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { FixtureSchema, PRODUCT_CONTRACT_VERSION } from '../packages/contracts/src/product.ts';
import type { CheckRunner, Fixture, ProductRun, RepairProvider } from '../packages/contracts/src/product.ts';
import { Coordinator, LOCAL_LIMITS } from '../packages/orchestrator/src/coordinator.ts';
import { buildEvidence, EvidenceStore, verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { fixtureDigests } from '../packages/orchestrator/src/fixtures.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { createPatch } from '../packages/orchestrator/src/patch.ts';

const fixture = FixtureSchema.parse({ id: 'publication-unit-fixture', repoId: 'publication-unit-only', split: 'development',
  title: 'Publication unit fixture', description: 'Synthetic journal data; candidate source is never executed.',
  requirements: [{ id: 'R01', text: 'Return two.' }], files: { 'solution.py': 'def value():\n    return 1\n' },
  editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [{ id: 'visible', requirementId: 'R01', function: 'value', args: [], expected: 2 }], acceptanceCases: [],
  license: 'CC0-1.0', provenance: 'Original synthetic publication test fixture' });
const runtimeLock = { revision: 'synthetic-publication-runtime' };

function terminalRun(mode: 'mock' | 'live' = 'mock'): ProductRun {
  const timestamp = '2026-09-27T00:00:00.000Z', id = randomUUID(), files = { 'solution.py': 'def value():\n    return 2\n' };
  const usage = { inferenceCalls: mode === 'live' ? 1 : 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: mode === 'live' ? null : 0 };
  return { schemaVersion: PRODUCT_CONTRACT_VERSION, id, taskId: fixture.id, variant: 'patchproof', mode, competitionReady: false,
    notice: 'Synthetic unit observations; no candidate, provider or sandbox execution.', phase: 'terminal',
    terminalStatus: 'verified_for_declared_checks', reason: mode === 'live' ? 'declared_sponsor_smoke_checks_passed' : 'declared_local_checks_passed',
    createdAt: timestamp, finishedAt: timestamp, ...fixtureDigests(fixture), runtimeLockDigest: digestJson(runtimeLock), limits: { ...LOCAL_LIMITS },
    usage: { ...usage, sandboxCpuSeconds: mode === 'live' ? null : 0, costIsEstimate: false, elapsedMs: 1 }, baselineChecks: null,
    candidates: [{ id: 1, parentId: null, summary: 'Synthetic recorded proposal.', files, diff: createPatch(fixture.files, files),
      visibleChecks: [{ id: 'visible', requirementId: 'R01', status: 'pass', message: 'Synthetic unit observation.', actual: 2, expected: 2,
        durationMs: 0, log: 'Synthetic observation; candidate source was not executed.' }], acceptanceChecks: [], accepted: true, rejectionReason: null,
      modelId: mode === 'live' ? 'nvidia/synthetic-unit-only' : null, providerRequestId: mode === 'live' ? 'synthetic-response' : null,
      sandboxOperationIds: [], elapsedMs: 1, usage }], selectedCandidateId: 1,
    coverage: [{ requirementId: 'R01', status: 'pass', checkIds: ['visible'] }],
    events: [{ sequence: 1, timestamp, phase: 'terminal', message: mode === 'live' ? 'Synthetic terminal observation; billing remains unreconciled.' : 'Synthetic terminal observation.' }],
    sandboxOperationIds: [] };
}

async function setup(t: TestContext, run: ProductRun, bundleExists: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-publication-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'runs.sqlite'), store = new EvidenceStore(join(directory, 'evidence'));
  const bundle = verifyEvidence(buildEvidence(run, fixture, runtimeLock));
  await store.prepare();
  if (bundleExists) await store.put(bundle);
  const journal = new RunJournal(filename);
  journal.insert('synthetic-publication-request', digestJson({ id: run.id }), run);
  journal.close();
  let workCalls = 0;
  const noWork = async (): Promise<never> => { workCalls++; throw new Error('Recovery must not execute work.'); };
  const provider: RepairProvider = { mode: run.mode, propose: noWork };
  const checks: CheckRunner = { run: noWork, reconcile: noWork };
  const open = (options: { fixtures?: Fixture[]; lock?: unknown; store?: EvidenceStore } = {}) => new Coordinator({
    fixtures: options.fixtures ?? [fixture], runtimeLock: options.lock ?? runtimeLock, provider, checks,
    journal: new RunJournal(filename), store: options.store ?? store });
  return { open, store, bundle, path: join(store.directory, bundle.bundleDigest.slice(7) + '.json'), assertNoWork: () => assert.equal(workCalls, 0) };
}

test('restart completes either terminal publication window without changing observations or running work', async t => {
  for (const mode of ['mock', 'live'] as const) for (const bundleExists of [false, true]) {
    await t.test(`${mode}: ${bundleExists ? 'bundle written before digest' : 'terminal written before bundle'}`, async t => {
      const run = terminalRun(mode), state = await setup(t, run, bundleExists);
      const historical = bundleExists ? await readFile(state.path, 'utf8') : null;
      const coordinator = state.open();
      try {
        assert.equal(coordinator.journal.evidenceDigest(run.id), null);
        await coordinator.recover();
        const bundle = await coordinator.evidence(run.id);
        assert.deepEqual(bundle, state.bundle);
        assert.deepEqual(coordinator.get(run.id), run);
        assert.equal(coordinator.journal.evidenceDigest(run.id), state.bundle.bundleDigest);
        assert.deepEqual(await readdir(state.store.directory), [state.bundle.bundleDigest.slice(7) + '.json']);
        if (historical !== null) assert.equal(await readFile(state.path, 'utf8'), historical);
        await coordinator.recover();
        assert.deepEqual(coordinator.get(run.id), run);
        state.assertNoWork();
      } finally { await coordinator.close(); }
    });
  }
});

test('pending publication with incompatible bindings stays unavailable and preserves historical bytes', async t => {
  for (const change of ['runtime', 'source', 'policy', 'contract'] as const) await t.test(change, async t => {
    const run = terminalRun();
    if (change === 'contract') run.schemaVersion = '2.1';
    const state = await setup(t, run, true), historical = await readFile(state.path, 'utf8');
    const changed = structuredClone(fixture);
    if (change === 'source') changed.files['solution.py'] += '# changed\n';
    if (change === 'policy') changed.description += ' Changed requirement context.';
    const coordinator = state.open({ fixtures: [changed], lock: change === 'runtime' ? { revision: 'changed' } : runtimeLock });
    try {
      await coordinator.recover();
      const recovered = coordinator.get(run.id);
      assert.equal(recovered.terminalStatus, 'needs_review');
      assert.equal(recovered.reason, change === 'runtime' ? 'recovery_runtime_changed' : change === 'contract' ? 'recovery_contract_changed' : 'recovery_inputs_changed');
      for (const key of ['schemaVersion', 'sourceDigest', 'policyDigest', 'runtimeLockDigest'] as const) assert.equal(recovered[key], run[key]);
      assert.equal(coordinator.journal.evidenceDigest(run.id), null);
      await assert.rejects(coordinator.evidence(run.id), { code: 'evidence_not_ready' });
      assert.equal(await readFile(state.path, 'utf8'), historical);
      assert.deepEqual(await readdir(state.store.directory), [state.bundle.bundleDigest.slice(7) + '.json']);
      await coordinator.recover();
      assert.deepEqual(coordinator.get(run.id), recovered, 'An incompatible terminal is not rewritten on every restart.');
      state.assertNoWork();
    } finally { await coordinator.close(); }
  });
});

test('publication recovery failure remains unapproved and can later export that failure without rerunning', async t => {
  const run = terminalRun(), state = await setup(t, run, false);
  class UnavailableStore extends EvidenceStore { override async put() { throw new Error('Synthetic storage outage.'); } }
  const coordinator = state.open({ store: new UnavailableStore(state.store.directory) });
  try {
    await coordinator.recover();
    assert.equal(coordinator.get(run.id).terminalStatus, 'infrastructure_error');
    assert.equal(coordinator.get(run.id).reason, 'evidence_publish_failed');
    await assert.rejects(coordinator.evidence(run.id), { code: 'evidence_not_ready' });
  } finally { await coordinator.close(); }
  const restarted = state.open();
  try {
    const failed = restarted.get(run.id);
    await restarted.recover();
    assert.deepEqual((await restarted.evidence(run.id)).run, failed);
    assert.equal(restarted.get(run.id).terminalStatus, 'infrastructure_error');
    state.assertNoWork();
  } finally { await restarted.close(); }
});
