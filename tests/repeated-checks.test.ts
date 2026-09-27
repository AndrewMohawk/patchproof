import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { CheckRunner, RepairProvider } from '../packages/contracts/src/product.ts';
import { RepeatedCheckRunner, REPEATED_CHECK_PROTOCOL, FLAKY_CHECK_MESSAGE, runnerForFrozenProtocol } from '../packages/orchestrator/src/repeated-checks.ts';
import { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore, reproduceEvidence } from '../packages/orchestrator/src/evidence.ts';

const fixture = FixtureSchema.parse({ id: 'repeat-unit', repoId: 'unit', split: 'development', title: 'Synthetic repeat check',
  description: 'Synthetic unit-only fixture.', requirements: [{ id: 'R01', text: 'Return two.' }], files: { 'solution.py': 'def f(): return 1\n' },
  editAllowlist: ['solution.py'], entrypoint: 'solution.py', visibleCases: [{ id: 'v1', requirementId: 'R01', function: 'f', args: [], expected: 2 }],
  acceptanceCases: [], license: 'CC0-1.0', provenance: 'unit test only' });
const invocation = { files: fixture.files, entrypoint: fixture.entrypoint, cases: fixture.visibleCases, timeoutSeconds: 10 };
function checker(values: number[], options: { infra?: boolean; tick?: () => void } = {}) {
  let calls = 0;
  const allowances: number[] = [];
  const raw: CheckRunner = { async run(input) {
    allowances.push(input.timeoutSeconds); const value = values[calls++] ?? values.at(-1)!;
    options.tick?.(); const operation = `synthetic-repeat-${calls}`; input.onOperation?.(operation);
    return { checks: input.cases.map(c => ({ id: c.id, requirementId: c.requirementId, status: value === 2 ? 'pass' : 'fail',
      message: 'Synthetic unit observation.', actual: value, expected: c.expected, durationMs: 1, log: 'Synthetic fixture observation.' })),
    isolation: 'local_container', operationIds: [operation], cpuSeconds: null, measuredCostUsd: 0,
    infrastructureError: options.infra ? 'container_cleanup_unconfirmed' : null };
  } };
  return { raw, calls: () => calls, allowances };
}

test('repeat observations retain both passes, failures, operation handles and shared time allowance', async () => {
  let now = 0; const stable = checker([2, 2], { tick: () => { now += 2000; } });
  const result = await new RepeatedCheckRunner(stable.raw, () => now).run(invocation, new AbortController().signal);
  assert.deepEqual(stable.allowances, [10, 8]); assert.equal(result.checks[0]!.status, 'pass');
  assert.equal(result.operationIds.length, 2); assert.equal(result.cpuSeconds, null);
  const log = JSON.parse(result.checks[0]!.log); assert.equal(log.stability, 'consistent'); assert.equal(log.observations.length, 2);
  const failure = await new RepeatedCheckRunner(checker([1, 1]).raw).run(invocation, new AbortController().signal);
  assert.equal(failure.checks[0]!.status, 'fail');
  const unstable = await new RepeatedCheckRunner(checker([2, 3]).raw).run(invocation, new AbortController().signal);
  assert.equal(unstable.checks[0]!.status, 'error'); assert.equal(unstable.checks[0]!.message, FLAKY_CHECK_MESSAGE);
  assert.deepEqual(unstable.checks[0]!.actual, { observations: [2, 3] });
});

test('infrastructure uncertainty and expired batch allowance cannot trigger another repeat or pass', async () => {
  const uncertain = checker([2, 2], { infra: true });
  const result = await new RepeatedCheckRunner(uncertain.raw).run(invocation, new AbortController().signal);
  assert.equal(uncertain.calls(), 1); assert.equal(result.checks[0]!.status, 'error');
  assert.equal(result.infrastructureError, 'container_cleanup_unconfirmed');
  let now = 0; const slow = checker([2, 2], { tick: () => { now += 11000; } });
  const timed = await new RepeatedCheckRunner(slow.raw, () => now).run(invocation, new AbortController().signal);
  assert.equal(slow.calls(), 1); assert.equal(timed.infrastructureError, 'verification_timeout');
  assert.equal(timed.checks[0]!.status, 'error');
  assert.throws(() => runnerForFrozenProtocol(slow.raw, { checkProtocol: { id: 'invented' } }), /Unsupported frozen/);
  assert.equal(runnerForFrozenProtocol(slow.raw, {}), slow.raw, 'Explicit historical bundles retain their original single-observation protocol.');
});

test('a candidate with contradictory fresh observations abstains and exports both records without another model call', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-flake-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let proposals = 0;
  const provider: RepairProvider = { mode: 'mock', async propose() { proposals++; return { files: { 'solution.py': 'def f(): return 2\n' }, summary: 'Synthetic proposal.',
    usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 }, modelId: null, providerRequestId: null }; } };
  const raw = checker([1, 1, 2, 3]);
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: { checkProtocol: REPEATED_CHECK_PROTOCOL }, provider,
    checks: new RepeatedCheckRunner(raw.raw), journal: new RunJournal(join(directory, 'runs.sqlite')), store: new EvidenceStore(join(directory, 'evidence')) });
  try {
    const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'repeat-test-01' });
    await coordinator.settled(); const result = coordinator.get(run.id);
    assert.equal(result.terminalStatus, 'needs_review'); assert.equal(result.reason, 'flaky_check');
    assert.equal(proposals, 1); assert.equal(raw.calls(), 4); assert.equal(result.candidates[0]!.accepted, false);
    assert.equal(result.candidates[0]!.rejectionReason, 'flaky_check');
    const evidence = await coordinator.evidence(run.id);
    assert.equal(JSON.parse(evidence.files['candidate-1/v1.log']!.content).observations.length, 2);
    assert.equal((await reproduceEvidence(evidence, raw.raw, new AbortController().signal)).status, 'no_selected_patch');
  } finally { await coordinator.close(); }
});

test('replay honors the frozen repeat protocol and does not approve a single lucky observation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-repeat-replay-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const provider: RepairProvider = { mode: 'mock', async propose() { return { files: { 'solution.py': 'def f(): return 2\n' }, summary: 'Synthetic proposal.',
    usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 }, modelId: null, providerRequestId: null }; } };
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: { checkProtocol: REPEATED_CHECK_PROTOCOL }, provider,
    checks: new RepeatedCheckRunner(checker([1, 1, 2, 2]).raw), journal: new RunJournal(join(directory, 'runs.sqlite')), store: new EvidenceStore(join(directory, 'evidence')) });
  try {
    const { run } = coordinator.create({ taskId: fixture.id, variant: 'patchproof', mode: 'mock', idempotencyKey: 'repeat-replay-01' });
    await coordinator.settled(); const evidence = await coordinator.evidence(run.id);
    assert.equal(evidence.run.terminalStatus, 'verified_for_declared_checks');
    const stable = checker([2, 2]);
    assert.equal((await reproduceEvidence(evidence, stable.raw, new AbortController().signal)).status, 'reproduced');
    assert.equal(stable.calls(), 2);
    const unstable = checker([2, 3]);
    assert.equal((await reproduceEvidence(evidence, unstable.raw, new AbortController().signal)).status, 'mismatch_or_infrastructure_error');
    assert.equal(unstable.calls(), 2);
  } finally { await coordinator.close(); }
});
