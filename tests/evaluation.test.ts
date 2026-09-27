import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import { evaluateObservation } from '../workers/sandbox/index.ts';
import { planExperiment, validatePlan, hashJson, assertExecutionReady, classifyProtocolChange } from '../workers/evaluator/protocol.ts';
import { analyzeExperiment, EpisodeResultSchema, pairedRepositoryBootstrap } from '../workers/evaluator/analysis.ts';
import type { EpisodeResult } from '../workers/evaluator/analysis.ts';
import type { TaskMetadata, ExperimentPlan } from '../workers/evaluator/protocol.ts';

const digest = 'sha256:' + 'a'.repeat(64);
const manifest = JSON.parse(await readFile(new URL('../fixtures/split-manifest.json', import.meta.url), 'utf8')) as { tasks: TaskMetadata[]; splits: Record<string, { tasks: number; repositories: string[] }> };
const limits = { inferenceCallLimit: 24, inputTokenLimit: 64_000, outputTokenLimit: 16_000, wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 900, maxApprovedSpendUsd: 0.05 };
function plan(kind: 'pilot' | 'final' = 'pilot') {
  return planExperiment({ kind, tasks: manifest.tasks, limits, sourceManifestDigest: digest, modelLockDigest: digest,
    policyDigest: digest, approvedExperimentBudgetUsd: 25, estimatedExperimentCostUsd: 10, createdAt: '2026-09-27T00:00:00.000Z' });
}
function results(p: ExperimentPlan): EpisodeResult[] {
  return p.episodes.map(episode => ({ episodeId: episode.id, planDigest: hashJson(p), modelLockDigest: digest,
    executionMode: 'live',
    policyDigest: digest, variant: episode.variant, outcome: 'incorrect', runtimeApproved: false,
    sealedChecksExecuted: true, infrastructureExclusion: null, includesSetupAndRetries: true, finalOracleFeedbackRounds: 0,
    usage: { inferenceCalls: 2, inputTokens: 30, outputTokens: 40, runtimeFeedbackRounds: 2, elapsedMs: 100,
      sandboxCpuSeconds: 1, measuredCostUsd: 0.01 }, artifactsDigest: digest }));
}

test('manifest has 60 distinct tasks in 12 disjoint five-task repositories', () => {
  assert.equal(manifest.tasks.length, 60);
  assert.equal(new Set(manifest.tasks.map(task => task.id)).size, 60);
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.splits).map(([split,value]) => [split,value.tasks])), { development: 20, calibration: 10, final: 30 });
  const repositories = new Set(manifest.tasks.map(task => task.repoId));
  assert.equal(repositories.size, 12);
  for (const repository of repositories) {
    const tasks = manifest.tasks.filter(task => task.repoId === repository);
    assert.equal(tasks.length, 5);
    assert.equal(new Set(tasks.map(task => task.split)).size, 1);
  }
});

test('public preparation and independent-review receipts bind the current immutable manifest', async () => {
  const bytes = await readFile(new URL('../fixtures/split-manifest.json', import.meta.url));
  const expected = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const author = JSON.parse(await readFile(new URL('../fixtures/oracle-validation-summary.json', import.meta.url),'utf8'));
  const reviewer = JSON.parse(await readFile(new URL('../fixtures/independent-review-summary.json', import.meta.url),'utf8'));
  assert.equal(author.manifestDigest,expected); assert.equal(reviewer.manifestDigest,expected);
  assert.equal(author.benchmarkExecuted,false);
  assert.equal(author.totalTasks,60); assert.equal(author.goldPassedTasks,60);
  assert.equal(author.buggyRejectedTasks,60); assert.equal(author.repeatStableTasks,60);
  assert.equal(author.infrastructureFailedTasks,0);
  assert.equal(reviewer.status,'reviewed_and_author_runtime_validated');
  assert.equal(reviewer.authorRuntimeEvidenceMatchesManifest,true);
  assert.equal(reviewer.counts.tasksReviewed,60); assert.equal(reviewer.counts.unresolvedFindings,0);
  assert.equal(reviewer.independentHumanReview,false); assert.equal(reviewer.scoredModelEvaluationPerformed,false);
});

test('public fixture bytes match immutable manifest and each check maps to a requirement', async () => {
  for (const split of ['development', 'calibration']) {
    const directory = new URL(`../fixtures/${split}/`, import.meta.url);
    const paths = (await readdir(directory)).filter(file => file.endsWith('.json'));
    assert.equal(paths.length, split === 'development' ? 20 : 10);
    for (const path of paths) {
      const bytes = await readFile(new URL(path, directory));
      const fixture = FixtureSchema.parse(JSON.parse(bytes.toString()));
      assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), manifest.tasks.find(t => t.id === fixture.id)?.fixtureDigest);
      assert.equal(fixture.split, split);
      const checks = [...fixture.visibleCases, ...fixture.acceptanceCases];
      assert.equal(new Set(checks.map(c => c.id)).size, checks.length);
      assert(checks.every(c => fixture.requirements.some(r => r.id === c.requirementId)));
      assert(fixture.requirements.every(r => checks.some(c => c.requirementId === r.id)));
      const sourcePaths = Object.keys(fixture.files);
      assert(sourcePaths.length >= 1 && sourcePaths.length <= 3);
      assert(sourcePaths.every(path => /^[a-zA-Z0-9_-]+\.py$/.test(path)));
      assert(sourcePaths.includes(fixture.entrypoint));
      assert(fixture.editAllowlist.every(path => sourcePaths.includes(path)));
      assert(!('goldFiles' in fixture));
    }
  }
  await assert.rejects(readdir(new URL('../fixtures/final/', import.meta.url)), /ENOENT/);
});

test('stable unique mutation check rejects changed arguments even with the correct return', async () => {
  const fixture = FixtureSchema.parse(JSON.parse(await readFile(new URL('../fixtures/development/stable-unique-01.json',import.meta.url),'utf8')));
  const check = fixture.acceptanceCases.find(c=>c.requirementId==='R02')!;
  assert.equal(check.assertArgsUnchanged, true);
  assert.equal(evaluateObservation(check,JSON.stringify({kind:'return',value:check.expected,argsAfter:check.args,kwargsAfter:check.kwargs}),1).status,'pass');
  assert.equal(evaluateObservation(check,JSON.stringify({kind:'return',value:check.expected,argsAfter:[...check.args,null],kwargsAfter:check.kwargs}),1).status,'fail');
});

test('prospective plans contain balanced 72/270 grids and identical aggregate budgets', () => {
  for (const [kind,count,tasks] of [['pilot',72,12],['final',270,30]] as const) {
    const p = validatePlan(plan(kind));
    assert.equal(p.plannedEpisodes, count);
    assert.equal(new Set(p.episodes.map(e => e.taskId)).size, tasks);
    assert.equal(new Set(p.episodes.map(e => JSON.stringify(e.limits))).size, 1);
    assert.equal(p.finalOracleFeedbackRounds, 0);
    assert.equal(p.benchmarkExecuted, false);
  }
});

test('planning rejects cross-split repositories, incomplete groups and overspending', () => {
  const options = { kind: 'pilot' as const, tasks: manifest.tasks, limits, sourceManifestDigest: digest,
    modelLockDigest: digest, policyDigest: digest, approvedExperimentBudgetUsd: 25 };
  assert.throws(() => planExperiment({ ...options, tasks: manifest.tasks.slice(1) }), /incomplete/);
  const mixed = structuredClone(manifest.tasks);
  mixed[0]!.split = 'final';
  assert.throws(() => planExperiment({ ...options, tasks: mixed }), /crosses/);
  assert.throws(() => planExperiment({ ...options, limits: { ...limits, maxApprovedSpendUsd: 1 } }), /exceed/);
  const altered = plan();
  altered.episodes[0]!.limits.inputTokenLimit++;
  assert.throws(() => validatePlan(altered), /Unmatched/);
});

test('resource access, price, integration and independent oracle gates fail closed', () => {
  assert.throws(() => assertExecutionReady(plan(), { accountAccessVerified: false, sandboxEntitlementVerified: false,
    modelVerified: false, realIntegrationPassed: false, oracleIndependentlyReviewed: false, experimentApproved: false,
    approvedRemainingSpendUsd: 25, pricesVerified: false, finalProtocolFrozen: false }), /NOT RUN: accountAccessVerified/);
});

const verifiedGates = {
  accountAccessVerified: true, sandboxEntitlementVerified: true, modelVerified: true,
  realIntegrationPassed: true, oracleIndependentlyReviewed: true, experimentApproved: true,
  approvedRemainingSpendUsd: 25, pricesVerified: true, finalProtocolFrozen: true,
};

test('execution gate runtime validation requires every boolean and remaining budget', () => {
  for (const key of Object.keys(verifiedGates)) {
    const incomplete: Record<string,unknown> = { ...verifiedGates };
    delete incomplete[key];
    assert.throws(() => assertExecutionReady(plan(),incomplete), /NOT RUN: invalid execution gates/, `Missing ${key} must reject.`);
  }
  assert.throws(() => assertExecutionReady(plan(),{}), /NOT RUN: invalid execution gates/);
});

test('execution gate runtime validation rejects nonfinite, negative and nonnumeric budgets', () => {
  for (const remaining of [NaN,Infinity,-Infinity,-1,'25',null,undefined]) {
    assert.throws(() => assertExecutionReady(plan(),{...verifiedGates,approvedRemainingSpendUsd:remaining}), /NOT RUN: invalid execution gates/);
  }
  assert.throws(() => assertExecutionReady(plan(),{...verifiedGates,approvedRemainingSpendUsd:0}), /NOT RUN: remainingBudget/);
});

test('execution gate runtime validation rejects truthy substitutes and unknown fields', () => {
  assert.throws(() => assertExecutionReady(plan(),{...verifiedGates,experimentApproved:'true'}), /NOT RUN: invalid execution gates/);
  assert.throws(() => assertExecutionReady(plan(),{...verifiedGates,accountAccessVerified:1}), /NOT RUN: invalid execution gates/);
  assert.throws(() => assertExecutionReady(plan(),{...verifiedGates,unrecognizedApproval:true}), /NOT RUN: invalid execution gates/);
});

test('fully verified runtime gates with sufficient finite budget admit the unchanged plan', () => {
  const approved = plan();
  assert.deepEqual(assertExecutionReady(approved,verifiedGates),approved);
});

test('all failed and infrastructure episodes remain in primary denominator', () => {
  const p = plan(), rows = results(p);
  rows[0]!.outcome = 'infrastructure_error'; rows[0]!.sealedChecksExecuted = false;
  rows[0]!.infrastructureExclusion = 'sandbox_setup_failure';
  rows[1]!.outcome = 'correct'; rows[1]!.runtimeApproved = true;
  const report = analyzeExperiment(p, rows);
  assert.equal(report.complete, true);
  const baseline = report.metrics.find(m => m.variant === 'baseline')!;
  assert.equal(baseline.primaryYield.denominator, 36);
  assert.equal(baseline.semanticYield.denominator, 35);
  assert.equal(baseline.infrastructureErrors, 1);
  assert.equal(baseline.measuredCostUsd.toFixed(2), '0.36');
  assert.equal(report.metrics.find(m => m.variant === 'patchproof')!.measuredCostPerCorrectPatchUsd?.toFixed(2), '0.36');
});

test('false approvals show observed denominator and unresolved approvals separately', () => {
  const p = plan(), rows = results(p);
  rows[0]!.runtimeApproved = true;
  rows[2]!.runtimeApproved = true; rows[2]!.outcome = 'unverified'; rows[2]!.sealedChecksExecuted = false;
  const baseline = analyzeExperiment(p, rows).metrics.find(m => m.variant === 'baseline')!;
  assert.deepEqual(baseline.falseApprovals, { numerator: 1, denominator: 1, unresolvedApprovals: 1, fraction: 1 });
});

test('incomplete results suppress inferential claims and retain missing planned episodes', () => {
  const p = plan(); const report = analyzeExperiment(p, results(p).slice(0, 3));
  assert.equal(report.complete, false);
  assert.equal(report.missingEpisodeIds.length, 69);
  assert.equal(report.comparisons.length, 0);
  assert.equal(report.g2?.decision, 'NOT ASSESSED');
  assert(report.metrics.every(m => m.primaryYield.provisional && m.billingIncomplete));
});

test('budget violation cannot support matched-budget inference', () => {
  const p = plan(), rows = results(p);
  rows[0]!.usage.inferenceCalls = 25;
  const report = analyzeExperiment(p, rows);
  assert.equal(report.budgetViolations[0]?.dimension, 'inferenceCalls');
  assert.equal(report.comparisons.length, 0);
  assert.equal(report.g2?.decision, 'NOT ASSESSED');
});

test('unknown billing or CPU usage cannot establish matched-budget advantage', () => {
  const p = plan(), rows = results(p);
  rows[0]!.usage.measuredCostUsd = null; rows[1]!.usage.sandboxCpuSeconds = null;
  const report = analyzeExperiment(p, rows);
  assert.equal(report.budgetEvidenceIncomplete.length,2);
  assert.equal(report.comparisons.length,0);
  assert.equal(report.g2?.decision,'NOT ASSESSED');
  assert.equal(report.metrics[0]?.billingIncomplete,true);
});

test('incorrect oracles, duplicate results and model drift are rejected', () => {
  const p = plan(), rows = results(p);
  assert.throws(() => analyzeExperiment(p, [...rows, rows[0]]), /duplicate/);
  rows[0]!.modelLockDigest = 'sha256:' + 'b'.repeat(64);
  assert.throws(() => analyzeExperiment(p, rows), /frozen/);
  assert.equal(EpisodeResultSchema.safeParse({ ...rows[1], outcome: 'correct', sealedChecksExecuted: false }).success, false);
  assert.equal(EpisodeResultSchema.safeParse({ ...rows[1], finalOracleFeedbackRounds: 1 }).success, false);
  assert.equal(EpisodeResultSchema.safeParse({ ...rows[1], executionMode: 'mock' }).success, false);
});

test('paired bootstrap resamples repository clusters, preserving matched repetitions', () => {
  const groups = [
    { repoId: 'one', pairs: Array.from({ length: 15 }, () => ({ proposed: 1, comparator: 0 })) },
    { repoId: 'two', pairs: Array.from({ length: 15 }, () => ({ proposed: 0, comparator: 1 })) },
  ];
  const result = pairedRepositoryBootstrap(groups, { samples: 1000, seed: 7 });
  assert.equal(result.difference, 0); assert.equal(result.clusterCount, 2); assert.equal(result.pairedEpisodeCount, 30);
  assert.deepEqual(result.confidenceInterval95, [-1, 1]);
  assert.deepEqual(result, pairedRepositoryBootstrap(groups, { samples: 1000, seed: 7 }));
});

test('pilot gate aggregates majority by task and final gate simplifies equal checks-only performance', () => {
  const p = plan(), rows = results(p);
  const tasks = [...new Set(p.episodes.map(e => e.taskId))].slice(0, 2);
  for (const row of rows) if (row.variant === 'patchproof' && tasks.some(task => row.episodeId.includes(`:${task}:`))) row.outcome = 'correct';
  assert.equal(analyzeExperiment(p, rows).g2?.decision, 'go');
  const final = plan('final');
  assert.equal(analyzeExperiment(final, results(final)).g3?.decision, 'simplify_to_checks_only');
});

test('any protocol change after final results is exploratory and preserves original report', () => {
  assert.equal(classifyProtocolChange('a', 'b', true).classification, 'exploratory');
  assert.equal(classifyProtocolChange('a', 'a', true).classification, 'preregistered');
  assert.equal(classifyProtocolChange('a', 'b', false).classification, 'preregistered');
  assert.equal(classifyProtocolChange('a', 'b', true).preserveOriginalReport, true);
});
