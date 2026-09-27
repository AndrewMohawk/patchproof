import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixtures, publicTask } from '../packages/orchestrator/src/fixtures.ts';
import { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { EvidenceStore, reproduceEvidence, verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { MockRepairProvider } from '../workers/repair/index.ts';
import { DockerCheckRunner, LOCAL_IMAGE_ID } from '../workers/sandbox/index.ts';

test('unsupported public scripted task exports durable needs_review with zero provider activity and no selected patch', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-abstention-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Exercise the current public catalogue without depending on a retired corpus filename.
  const fixture = (await loadFixtures(new URL('../', import.meta.url)))
    .find(task => task.split === 'development' && !publicTask(task).mockSupported);
  assert.ok(fixture, 'The public catalogue must include an unsupported development task.');
  const journalPath = join(directory, 'runs.sqlite');
  const store = new EvidenceStore(join(directory, 'evidence'));
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: { mode: 'mock', localCheckImage: LOCAL_IMAGE_ID },
    provider: new MockRepairProvider(), checks: new DockerCheckRunner(), journal: new RunJournal(journalPath), store });
  let runId: string, evidenceDigest: string;
  try {
    const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'public-unsupported-task' });
    runId = run.id;
    await coordinator.settled();
    const done = coordinator.get(run.id);
    assert.equal(done.phase, 'terminal');
    assert.equal(done.terminalStatus, 'needs_review');
    assert.equal(done.reason, 'mock_task_unavailable');
    assert.equal(done.mode, 'mock');
    assert.equal(done.competitionReady, false);
    assert.deepEqual(done.candidates, []);
    assert.equal(done.selectedCandidateId, null);
    assert.equal(done.usage.measuredCostUsd, 0);
    assert.equal(done.usage.costIsEstimate, false);
    assert.equal(done.usage.inferenceCalls, 0);
    assert.equal(done.usage.inputTokens, 0);
    assert.equal(done.usage.outputTokens, 0);
    assert.equal(done.usage.sandboxCpuSeconds, null, 'Unknown measured CPU must not be fabricated.');
    assert.equal(done.baselineChecks!.visible.length, fixture.visibleCases.length);
    assert.equal(done.baselineChecks!.acceptance.length, fixture.acceptanceCases.length);
    assert.ok(done.baselineChecks!.acceptance.some(check => check.status === 'fail'), 'Original fixture failures must remain observable.');
    assert.ok([...done.baselineChecks!.visible, ...done.baselineChecks!.acceptance].every(check => check.status !== 'error'));
    assert.equal(done.sandboxOperationIds.length, fixture.visibleCases.length + fixture.acceptanceCases.length);
    assert.ok(done.sandboxOperationIds.every(id => id.startsWith('docker:patchproof-check-')));
    assert.ok(done.coverage.every(row => row.status === 'unverified' && row.checkIds.length === 0));
    assert.match(done.events.at(-1)!.message, /^needs_review: mock_task_unavailable\./);
    const bundle = verifyEvidence(await coordinator.evidence(run.id));
    evidenceDigest = bundle.bundleDigest;
    assert.deepEqual(bundle.run, done);
    assert.equal(bundle.files['patch.diff']!.content, '');
    const ledger = JSON.parse(bundle.files['cost-ledger.json']!.content);
    assert.equal(ledger.mode, 'mock');
    assert.equal(ledger.aggregate.measuredCostUsd, 0);
    assert.equal(ledger.aggregate.inferenceCalls, 0);
    assert.deepEqual(ledger.attempts, []);
    let replayExecutions = 0;
    const replay = await reproduceEvidence(bundle, { async run() { replayExecutions++; throw new Error('Abstention has no patch to execute.'); } }, new AbortController().signal);
    assert.equal(replay.status, 'no_selected_patch');
    assert.equal(replay.executionPerformed, false);
    assert.equal(replayExecutions, 0);
  } finally { await coordinator.close(); }
  const reopened = new RunJournal(journalPath, true);
  try {
    assert.equal(reopened.get(runId!).terminalStatus, 'needs_review');
    assert.equal(reopened.evidenceDigest(runId!), evidenceDigest!);
    assert.equal((await store.get(evidenceDigest!)).run.usage.measuredCostUsd, 0);
  } finally { reopened.close(); }
});
