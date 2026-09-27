import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { CheckRunner, RepairInput, RepairProvider } from '../packages/contracts/src/product.ts';
import { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore } from '../packages/orchestrator/src/evidence.ts';

const fixture = FixtureSchema.parse({ id: 'policy-unit', repoId: 'unit', split: 'development', title: 'Synthetic policy check',
  description: 'Synthetic policy test; no benchmark evidence.', requirements: [{ id: 'R01', text: 'Visible behavior.' }, { id: 'R02', text: 'Acceptance behavior.' }],
  files: { 'solution.py': 'original' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [{ id: 'v1', requirementId: 'R01', function: 'f', args: [], expected: 2 }],
  acceptanceCases: [{ id: 'a1', requirementId: 'R02', function: 'f', args: [], expected: 2 }], license: 'CC0-1.0', provenance: 'unit-only policy oracle' });

test('P branches receive immutable original source while B1 progresses, and B0 selection cannot use acceptance scores', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-policy-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const observed: Record<string, RepairInput[]> = {};
  for (const variant of ['baseline', 'checks_only', 'patchproof'] as const) {
    observed[variant] = [];
    const provider: RepairProvider = { mode: 'mock', async propose(input) { observed[variant]!.push(structuredClone(input)); return {
      files: { 'solution.py': `proposal-${input.attempt + 1}` }, summary: 'Synthetic proposal.', modelId: null, providerRequestId: null,
      usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 },
    }; } };
    const checks: CheckRunner = { async run(input) { return { checks: input.cases.map(c => ({
      id: c.id, requirementId: c.requirementId, status: c.id === 'a1' && input.files['solution.py'] !== 'proposal-1' ? 'pass' : 'fail',
      actual: 'synthetic', expected: 'synthetic', durationMs: 0, log: 'Synthetic policy-only observation.', message: 'Synthetic policy-only observation.',
    })), isolation: 'local_container', operationIds: [], cpuSeconds: 0, measuredCostUsd: 0, infrastructureError: null }; } };
    const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock: {}, provider, checks,
      journal: new RunJournal(join(directory, variant + '.sqlite')), store: new EvidenceStore(join(directory, variant)) });
    try {
      const { run } = coordinator.create({ taskId: fixture.id, variant, mode: 'mock', idempotencyKey: 'unit-test-01' });
      await coordinator.settled(); const done = coordinator.get(run.id);
      assert.equal(done.candidates.length, 3);
      if (variant === 'baseline') {
        assert.equal(done.selectedCandidateId, 3, 'B0 retains the latest candidate, regardless of acceptance-score changes.');
        assert.ok(observed[variant]!.every(call => call.feedback.every(row => row.requirementId === 'R01')));
      }
      if (variant === 'patchproof') {
        assert.ok(done.candidates.every(candidate => candidate.parentId === null));
        assert.equal(done.selectedCandidateId, 2, 'P retains the best declared score with earliest tie-breaking.');
      }
      else assert.deepEqual(done.candidates.map(candidate => candidate.parentId), [null, 1, 2]);
      if (variant === 'checks_only') assert.equal(done.selectedCandidateId, 3, 'Checks-only has no best-candidate selection policy.');
    } finally { await coordinator.close(); }
  }
  assert.deepEqual(observed.patchproof!.map(call => call.files['solution.py']), ['original', 'original', 'original']);
  assert.deepEqual(observed.checks_only!.map(call => call.files['solution.py']), ['original', 'proposal-1', 'proposal-2']);
});
