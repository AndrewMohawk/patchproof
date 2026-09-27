import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, linkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestJson, digestBytes } from '../packages/contracts/src/digest.ts';
import { planModelProbe, analyzeModelProbe, verifyProbePlan, ProbeResultSchema } from '../workers/evaluator/model-probe.ts';
import type { ProbeResult } from '../workers/evaluator/model-probe.ts';
import { runModelProbeOperator } from '../scripts/model-probe.ts';

// Independently invented metadata only. Actual-scope strings exercise validation,
// not observations of any provider, fixture source, candidate, corpus or person.
const now = new Date('2026-09-10T03:00:00.000Z');
const stamp = (ms: number) => new Date(ms).toISOString();
const hash = (s: string) => digestBytes(`independent-unit-only:${s}`);
function fixture() {
  const input = {
    createdAt: '2026-09-10T00:00:00.000Z', sourceManifestDigest: hash('manifest'), sourceDigest: hash('source'), policyDigest: hash('policy'),
    tasks: Array.from({ length: 20 }, (_, i) => ({ id: `independent-task-${String(i).padStart(2, '0')}`, repoId: `invented-repo-${Math.floor(i / 5)}`,
      split: 'development' as const, fixtureDigest: hash(`task-${i}`), oracleDigest: hash(`oracle-${i}`) })),
    models: ['lower', 'higher'].map(name => ({ modelId: `nvidia/invented-${name}`, modelLockDigest: hash(`lock-${name}`), accountProofDigest: hash(`proof-${name}`),
      tokenizerDigest: hash(`tokenizer-${name}`), licenseUrl: 'https://example.invalid/invented-license', modelCardUrl: 'https://example.invalid/invented-card',
      accountVerifiedAt: '2026-09-09T00:00:00.000Z', validUntil: '2026-09-11T00:00:00.000Z' })),
    limits: { inferenceCallLimit: 1, inputTokenLimit: 2400, outputTokenLimit: 600, wallTimeLimitSeconds: 120, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 0.1 },
    plannedBudgetUsd: 2, minimumCorrectTasks: 7,
  };
  const plan = planModelProbe(input);
  const rows: ProbeResult[] = plan.episodes.map((episode, i) => {
    const start = Date.parse(input.createdAt) + i * 5000;
    return ProbeResultSchema.parse({ schemaVersion: '1.0', variant: 'baseline', scope: 'actual-provider-observation', planDigest: plan.planDigest,
      episodeId: episode.id, runId: randomUUID(), modelId: episode.modelId, modelLockDigest: episode.modelLockDigest,
      fixtureDigest: episode.fixtureDigest, oracleDigest: episode.oracleDigest, sourceDigest: input.sourceDigest, policyDigest: input.policyDigest,
      startedAt: stamp(start), finishedAt: stamp(start + 2000), outcome: 'correct', runtimeApproved: true,
      bundleDigest: hash(`bundle-${i}`), adjudicationDigest: hash(`verdict-${i}`), independentlyAdjudicated: true,
      measuredCostMicros: episode.modelId.endsWith('lower') ? '1000' : '10000', billingComplete: true,
      inferenceCalls: 1, inputTokens: 50, outputTokens: 25, elapsedMs: 2000, sandboxCpuSeconds: 0.5,
      modelRequestIds: [`INVENTED-model-operation-${i}`], sandboxOperationIds: [`INVENTED-check-operation-${i}`], failureReason: null });
  });
  const trust = () => ({ acceptedResultDigests: rows.map(digestJson), acceptedModelProofDigests: plan.input.models.map(m => m.accountProofDigest), now });
  return { input, plan, rows, trust };
}
function failBeforeInference(row: ProbeResult, cost: string): ProbeResult {
  return ProbeResultSchema.parse({ ...row, outcome: 'infrastructure_error', runtimeApproved: false, independentlyAdjudicated: false,
    bundleDigest: null, adjudicationDigest: null, inferenceCalls: 0, modelRequestIds: [], sandboxOperationIds: [], measuredCostMicros: cost,
    failureReason: 'Invented setup failure; this is not an actual observation.' });
}

test('independent: failed-task charges can reverse the cheapest eligible model, without deleting the failure', () => {
  const f = fixture(), failed = f.rows.findIndex(r => r.modelId.endsWith('lower'));
  f.rows[failed] = failBeforeInference(f.rows[failed]!, '90000');
  const report = analyzeModelProbe(f.plan, f.rows, f.trust());
  assert.equal(report.status, 'selection-recommendation');
  assert.equal(report.selectedModelId, 'nvidia/invented-higher');
  const lower = report.models.find(m => m.modelId.endsWith('lower'))!;
  assert.equal(lower.correctTasks, 7); assert.equal(lower.failures, 1); assert.equal(lower.plannedTasks, 8);
  assert.equal(lower.totalMeasuredCostMicros, '97000'); assert.equal(report.recordedCostLowerBoundMicros, '177000');
  assert.equal(report.observations.length, 16); assert.equal(report.authenticityVerified, false); assert.equal(report.executedByThisCommand, false);
});

test('independent: one missing expensive-model row blocks selection despite complete cheap-model results', () => {
  const f = fixture(); f.rows.splice(f.rows.findIndex(r => r.modelId.endsWith('higher')), 1);
  const report = analyzeModelProbe(f.plan, f.rows, f.trust());
  assert.equal(report.selectedModelId, null); assert.ok(report.reasons.includes('missing_planned_episodes'));
  const missing = report.models.find(m => m.modelId.endsWith('higher'))!;
  assert.equal(missing.plannedTasks, 8); assert.equal(missing.recordedTasks, 7); assert.equal(missing.missingTasks, 1);
  assert.equal(missing.totalMeasuredCostMicros, null); assert.equal(report.recordedCostLowerBoundMicros, '78000');
});

test('independent: incomplete billing preserves a reported lower bound but cannot establish total cost or selection', () => {
  const f = fixture(), row = f.rows.find(r => r.modelId.endsWith('higher'))!;
  row.billingComplete = false; row.measuredCostMicros = '50000';
  const report = analyzeModelProbe(f.plan, f.rows, f.trust());
  assert.equal(report.selectedModelId, null); assert.ok(report.reasons.includes('incomplete_billing'));
  assert.equal(report.models.find(m => m.modelId.endsWith('higher'))!.totalMeasuredCostMicros, null);
  assert.equal(report.recordedCostLowerBoundMicros, '128000');
});

test('independent: current separately accepted proof and exact accepted observation digests remain mandatory', () => {
  const f = fixture();
  for (const trust of [
    { ...f.trust(), acceptedModelProofDigests: [hash('unrelated-proof')] },
    { ...f.trust(), acceptedResultDigests: [] },
    { ...f.trust(), now: new Date('2026-09-11T00:00:00.000Z') },
  ]) assert.equal(analyzeModelProbe(f.plan, f.rows, trust).selectedModelId, null);
  const trust = f.trust(); f.rows[0]!.inputTokens++;
  assert.ok(analyzeModelProbe(f.plan, f.rows, trust).reasons.includes('unaccepted_observations'));
});

test('independent: synthetic rows stay excluded even when their digests are explicitly accepted', () => {
  const f = fixture(); f.rows.forEach(r => { r.scope = 'synthetic-unit-only'; });
  const report = analyzeModelProbe(f.plan, f.rows, f.trust());
  assert.equal(report.selectedModelId, null); assert.ok(report.reasons.includes('synthetic_observations'));
  assert.equal(report.recordedEpisodes, 16); assert.equal(report.models.reduce((n, m) => n + m.correctTasks, 0), 16);
});

test('independent: accepted failures exceeding a frozen allowance still block an otherwise eligible model', () => {
  const f = fixture(); f.rows[0] = failBeforeInference(f.rows[0]!, '100001');
  const report = analyzeModelProbe(f.plan, f.rows, f.trust());
  assert.equal(report.selectedModelId, null); assert.ok(report.reasons.includes('unmatched_budget'));
  assert.equal(report.models.find(m => m.modelId === f.rows[0]!.modelId)!.failures, 1);
});

test('independent: reviewed approval, model-evidence and timestamp contradictions reject at parsing', () => {
  const row = fixture().rows[0]!;
  const mutations = [
    { outcome: 'no_patch', independentlyAdjudicated: true }, { outcome: 'infrastructure_error', independentlyAdjudicated: true },
    { outcome: 'unverified', independentlyAdjudicated: true }, { inferenceCalls: 0, modelRequestIds: [] },
    { inferenceCalls: 1, modelRequestIds: [] }, { elapsedMs: 1 },
    { finishedAt: stamp(Date.parse(row.startedAt) + 150_000), elapsedMs: 2000 },
    { modelRequestIds: ['same', 'same'] }, { sandboxOperationIds: ['same', 'same'] },
  ];
  for (const mutation of mutations) assert.equal(ProbeResultSchema.safeParse({ ...row, ...mutation }).success, false, JSON.stringify(mutation));
});

test('independent: recomputing a digest cannot legitimize a changed matched episode allowance', () => {
  const f = fixture(), changed = structuredClone(f.plan);
  changed.episodes[0]!.limits.outputTokenLimit = 1;
  const { planDigest: _digest, ...body } = changed; changed.planDigest = digestJson(body);
  assert.throws(() => verifyProbePlan(changed), /model_probe_plan_changed/);
  const rows = structuredClone(f.rows); rows[0]!.policyDigest = hash('other-policy');
  assert.throws(() => analyzeModelProbe(f.plan, rows, f.trust()), /model_probe_observation_binding/);
});

test('independent: private CLI writes a blocked report without altering source inputs or creating runtime state', () => {
  const f = fixture(); f.rows[0]!.billingComplete = false;
  const base = mkdtempSync(join(tmpdir(), 'patchproof-independent-probe-')), project = join(base, 'project'), privateDir = join(base, 'private');
  mkdirSync(project, { mode: 0o700 }); mkdirSync(privateDir, { mode: 0o700 });
  const paths = ['plan', 'rows', 'trust', 'report'].map(n => join(privateDir, n + '.json'));
  const { now: _now, ...accepted } = f.trust();
  const values = [f.plan, f.rows, { planDigest: f.plan.planDigest, ...accepted }];
  try {
    values.forEach((v, i) => writeFileSync(paths[i]!, JSON.stringify(v), { mode: 0o600 }));
    const before = paths.slice(0, 3).map(p => readFileSync(p));
    const result = runModelProbeOperator(['analyze', ...paths], project, now);
    assert.equal(result.exitCode, 2); assert.equal(result.output.status, 'blocked'); assert.equal(result.output.providerCalls, 0);
    assert.equal(JSON.parse(readFileSync(paths[3]!, 'utf8')).selectedModelId, null);
    paths.slice(0, 3).forEach((p, i) => assert.deepEqual(readFileSync(p), before[i]));
    assert.deepEqual(readdirSync(project), []); assert.equal(statSync(paths[3]!).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(privateDir).sort(), ['plan.json', 'report.json', 'rows.json', 'trust.json']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('independent: private CLI refuses linked metadata inputs and leaves the target bytes intact', () => {
  const f = fixture(), base = mkdtempSync(join(tmpdir(), 'patchproof-independent-probe-links-'));
  const project = join(base, 'project'), privateDir = join(base, 'private'); mkdirSync(project, { mode: 0o700 }); mkdirSync(privateDir, { mode: 0o700 });
  const original = join(privateDir, 'original.json'), linked = join(privateDir, 'linked.json'), output = join(privateDir, 'out.json');
  try {
    writeFileSync(original, JSON.stringify(f.input), { mode: 0o600 }); const before = readFileSync(original);
    for (const kind of ['symbolic', 'hard']) {
      if (kind === 'symbolic') symlinkSync(original, linked); else linkSync(original, linked);
      const result = runModelProbeOperator(['plan', linked, output], project, now);
      assert.equal(result.exitCode, 2); assert.equal(result.output.status, 'rejected'); assert.ok(!JSON.stringify(result).includes(base));
      assert.deepEqual(readFileSync(original), before); rmSync(linked);
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('independent: the matched plan explicitly freezes the repair variant before any model result', () => {
  const f = fixture();
  assert.equal(f.plan.variant, 'baseline');
  assert.ok(f.plan.episodes.every(e => e.variant === 'baseline'));
  assert.ok(f.rows.every(r => r.variant === 'baseline'));
  assert.equal(f.plan.input.limits.inferenceCallLimit, 1);
  for (const variant of ['checks_only', 'patchproof', undefined]) {
    const rows = structuredClone(f.rows) as unknown as Array<Record<string, unknown>>;
    rows[0]!.variant = variant;
    assert.throws(() => analyzeModelProbe(f.plan, rows, f.trust()));
  }
  assert.throws(() => planModelProbe({ ...f.input, limits: { ...f.input.limits, inferenceCallLimit: 3 } }));
});
