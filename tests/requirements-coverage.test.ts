import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { CheckRunner, CheckResult, RepairProvider } from '../packages/contracts/src/product.ts';
import { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { EvidenceStore, verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';

// Invented observations only: no Python, Docker or provider transport is invoked.
const scenarios = [
  { name: 'uncovered requirement with passing checks', covered: false, noChecks: false, checkStatus: 'pass',
    status: 'needs_review', reason: 'declared_requirements_unverified', attempts: 1 },
  { name: 'uncovered requirement with a known check failure', covered: false, noChecks: false, checkStatus: 'fail',
    status: 'needs_review', reason: 'declared_requirements_unverified', attempts: 3 },
  { name: 'all requirements covered and passing', covered: true, noChecks: false, checkStatus: 'pass',
    status: 'verified_for_declared_checks', reason: 'declared_local_checks_passed', attempts: 1 },
  { name: 'all requirements covered with a known check failure', covered: true, noChecks: false, checkStatus: 'fail',
    status: 'failed', reason: 'declared_checks_not_satisfied', attempts: 3 },
  { name: 'a declared check cannot verify its requirement', covered: true, noChecks: false, checkStatus: 'error',
    status: 'needs_review', reason: 'declared_requirements_unverified', attempts: 3 },
  { name: 'no requirement has an executable check', covered: false, noChecks: true, checkStatus: 'pass',
    status: 'needs_review', reason: 'no_declared_checks', attempts: 0 },
] as const;

for (const scenario of scenarios) {
  test(`coverage classification: ${scenario.name}`, async t => {
    for (const variant of ['baseline', 'checks_only', 'patchproof'] as const) {
      await t.test(variant, async t => {
        const directory = await mkdtemp(join(tmpdir(), 'patchproof-coverage-unit-'));
        t.after(() => rm(directory, { recursive: true, force: true }));
        const fixture = FixtureSchema.parse({
          id: 'coverage-unit', repoId: 'coverage-unit', split: 'development', title: 'Synthetic coverage control',
          description: 'Invented requirements and observations, not a corpus task.',
          requirements: [{ id: 'R01', text: 'Return the declared value.' }, { id: 'R02', text: 'Preserve another declared behavior.' }],
          files: { 'solution.py': 'original source placeholder\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
          visibleCases: scenario.noChecks ? [] : [{ id: 'visible', requirementId: 'R01', function: 'example', args: [], expected: 2 }],
          acceptanceCases: scenario.covered ? [{ id: 'acceptance', requirementId: 'R02', function: 'example', args: [], expected: 2 }] : [],
          license: 'CC0-1.0', provenance: 'Synthetic classification regression only.',
        });
        let proposals = 0, batches = 0;
        const provider: RepairProvider = { mode: 'mock', async propose() {
          assert.equal(scenario.noChecks, false, 'A task without declared checks must not request a proposal.');
          proposals++;
          return { files: { 'solution.py': 'candidate source placeholder\n' }, summary: 'Synthetic proposal.',
            usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 }, modelId: null, providerRequestId: null };
        } };
        const checks: CheckRunner = { async run(input) {
          assert.equal(scenario.noChecks, false, 'A task without declared checks must not dispatch the checker.');
          batches++;
          return { checks: input.cases.map(c => {
            const status: CheckResult['status'] = c.requirementId === 'R01' ? scenario.checkStatus : 'pass';
            return { id: c.id, requirementId: c.requirementId, status, message: 'Invented classification observation.',
              actual: status === 'pass' ? 2 : null, expected: 2, durationMs: 0, log: 'Synthetic metadata only.' };
          }), isolation: 'local_container', operationIds: [], cpuSeconds: 0, measuredCostUsd: 0, infrastructureError: null };
        } };
        const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks,
          journal: new RunJournal(join(directory, 'runs.sqlite')), store: new EvidenceStore(join(directory, 'evidence')) });
        try {
          const { run } = coordinator.create({ taskId: fixture.id, variant, mode: 'mock', idempotencyKey: 'coverage-control' });
          await coordinator.settled();
          const done = coordinator.get(run.id);
          assert.equal(done.terminalStatus, scenario.status);
          assert.equal(done.reason, scenario.reason);
          assert.deepEqual(done.coverage.map(row => row.status),
            [scenario.noChecks || scenario.checkStatus === 'error' ? 'unverified' : scenario.checkStatus, scenario.covered ? 'pass' : 'unverified']);
          if (scenario.noChecks) {
            assert.equal(done.selectedCandidateId, null);
            assert.deepEqual(done.candidates, []);
            assert.equal(done.baselineChecks, null);
          } else assert.equal(done.candidates.find(c => c.id === done.selectedCandidateId)!.accepted,
            scenario.checkStatus === 'pass', 'Existing candidate acceptance still describes its executed checks.');
          assert.equal(proposals, scenario.attempts);
          const expectedBatches = scenario.noChecks ? 0 : scenario.attempts + 1;
          assert.equal(batches, expectedBatches, 'Classification adds no proposal or check batch.');
          assert.match(done.events.at(-1)!.message, new RegExp(`^${scenario.status}: ${scenario.reason}\\.`));
          const bundle = verifyEvidence(await coordinator.evidence(run.id));
          assert.deepEqual(bundle.run, done);
          await coordinator.evidence(run.id);
          assert.deepEqual([proposals, batches], [scenario.attempts, expectedBatches], 'Evidence reads start no work.');
          assert.equal(bundle.run.usage.inferenceCalls, 0);
          assert.equal(bundle.run.usage.measuredCostUsd, 0);
          assert.deepEqual(bundle.run.sandboxOperationIds, []);
        } finally { await coordinator.close(); }
      });
    }
  });
}
