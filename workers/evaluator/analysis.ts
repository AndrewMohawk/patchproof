import { z } from 'zod';
import { DigestSchema, VariantSchema } from '../../packages/contracts/src/index.ts';
import { INFRASTRUCTURE_EXCLUSIONS, validatePlan, hashJson } from './protocol.ts';
import type { ExperimentPlan } from './protocol.ts';

export const EpisodeResultSchema = z.strictObject({
  episodeId: z.string().min(1), planDigest: DigestSchema, modelLockDigest: DigestSchema,
  executionMode: z.literal('live'),
  policyDigest: DigestSchema, variant: VariantSchema,
  outcome: z.enum(['correct', 'incorrect', 'unverified', 'infrastructure_error']),
  runtimeApproved: z.boolean(), sealedChecksExecuted: z.boolean(),
  includesSetupAndRetries: z.literal(true), finalOracleFeedbackRounds: z.literal(0),
  infrastructureExclusion: z.enum(INFRASTRUCTURE_EXCLUSIONS).nullable(),
  usage: z.strictObject({ inferenceCalls: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(), runtimeFeedbackRounds: z.number().int().nonnegative(), elapsedMs: z.number().finite().nonnegative(),
    sandboxCpuSeconds: z.number().finite().nonnegative().nullable(), measuredCostUsd: z.number().finite().nonnegative().nullable() }),
  artifactsDigest: DigestSchema,
}).superRefine((row, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (['correct', 'incorrect'].includes(row.outcome) && !row.sealedChecksExecuted) issue('Correctness requires sealed checks.');
  if (row.outcome !== 'infrastructure_error' && row.infrastructureExclusion !== null) issue('Only infrastructure errors can have an exclusion reason.');
  if (row.outcome === 'infrastructure_error' && row.sealedChecksExecuted) issue('Infrastructure-invalid episode cannot claim completed sealed checks.');
});
export type EpisodeResult = z.infer<typeof EpisodeResultSchema>;

export interface VariantMetrics {
  variant: string; plannedEpisodes: number; recordedEpisodes: number; missingEpisodes: number;
  independentlyCorrect: number; incorrect: number; unverified: number; infrastructureErrors: number;
  primaryYield: { numerator: number; denominator: number; fraction: number; provisional: boolean };
  semanticYield: { numerator: number; denominator: number; excludedInfrastructure: number; fraction: number | null };
  falseApprovals: { numerator: number; denominator: number; unresolvedApprovals: number; fraction: number | null };
  taskMajorityCorrect: number; taskCount: number;
  measuredCostUsd: number; billingIncomplete: boolean; measuredCostPerCorrectPatchUsd: number | null;
  elapsedMs: number; elapsedMsPerCorrectPatch: number | null;
  usage: { inferenceCalls: number; inputTokens: number; outputTokens: number };
}

function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function quantile(sorted: number[], p: number): number {
  const position = (sorted.length - 1) * p, low = Math.floor(position), high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

/** Resample repository clusters, retaining every task, repetition and matched variant in each draw. */
export function pairedRepositoryBootstrap(groups: Array<{ repoId: string; pairs: Array<{ proposed: number; comparator: number }> }>,
  options: { samples: number; seed: number }) {
  if (groups.length < 2 || groups.some(g => !g.pairs.length) || new Set(groups.map(g => g.repoId)).size !== groups.length) throw new Error('At least two distinct nonempty repository clusters are required.');
  if (!Number.isInteger(options.samples) || options.samples < 100 || options.samples > 100_000) throw new Error('Invalid bootstrap sample count.');
  if (groups.some(g => g.pairs.some(pair => ![0, 1].includes(pair.proposed) || ![0, 1].includes(pair.comparator)))) throw new Error('Paired outcomes must be binary.');
  const random = rng(options.seed);
  const statistic = (selected: typeof groups) => {
    const pairs = selected.flatMap(g => g.pairs);
    return pairs.reduce((total, pair) => total + pair.proposed - pair.comparator, 0) / pairs.length;
  };
  const draws = Array.from({ length: options.samples }, () => statistic(Array.from({ length: groups.length }, () => groups[Math.floor(random() * groups.length)]!))).sort((a, b) => a - b);
  return { difference: statistic(groups), confidenceInterval95: [quantile(draws, 0.025), quantile(draws, 0.975)],
    clusterCount: groups.length, pairedEpisodeCount: groups.reduce((n, g) => n + g.pairs.length, 0),
    samplingUnit: 'repository' as const, samples: options.samples, seed: options.seed,
    limitation: 'Few synthetic repository clusters give coarse uncertainty; repetitions are not independent tasks.' };
}

export function analyzeExperiment(planValue: unknown, values: unknown[]) {
  const plan = validatePlan(planValue), rows = values.map(value => EpisodeResultSchema.parse(value));
  const planDigest = hashJson(plan), planned = new Map(plan.episodes.map(e => [e.id, e]));
  const byId = new Map<string, EpisodeResult>();
  const budgetViolations: Array<{ episodeId: string; dimension: string }> = [];
  const budgetEvidenceIncomplete: Array<{ episodeId: string; dimension: string }> = [];
  for (const row of rows) {
    const episode = planned.get(row.episodeId);
    if (!episode || byId.has(row.episodeId)) throw new Error('Unexpected or duplicate episode result.');
    if (row.planDigest !== planDigest || row.variant !== episode.variant || row.policyDigest !== plan.policyDigest || row.modelLockDigest !== plan.modelLockDigest) throw new Error('Episode does not match frozen plan and runtime.');
    const dimensions = [
      ['inferenceCalls', row.usage.inferenceCalls, episode.limits.inferenceCallLimit],
      ['inputTokens', row.usage.inputTokens, episode.limits.inputTokenLimit],
      ['outputTokens', row.usage.outputTokens, episode.limits.outputTokenLimit],
      ['runtimeFeedbackRounds', row.usage.runtimeFeedbackRounds, plan.fixedRuntimeFeedbackRounds],
      ['elapsedMs', row.usage.elapsedMs, episode.limits.wallTimeLimitSeconds * 1000],
      ['sandboxCpuSeconds', row.usage.sandboxCpuSeconds, episode.limits.sandboxCpuSecondsLimit],
      ['measuredCostUsd', row.usage.measuredCostUsd, episode.limits.maxApprovedSpendUsd],
    ] as const;
    for (const [dimension, actual, cap] of dimensions) {
      if (actual === null) budgetEvidenceIncomplete.push({ episodeId: row.episodeId, dimension });
      else if (actual > cap + 1e-9) budgetViolations.push({ episodeId: row.episodeId, dimension });
    }
    byId.set(row.episodeId, row);
  }
  const complete = rows.length === plan.plannedEpisodes;
  const metrics: VariantMetrics[] = [...new Set(plan.episodes.map(e => e.variant))].map(variant => {
    const all = plan.episodes.filter(e => e.variant === variant), results = all.map(e => byId.get(e.id)).filter((r): r is EpisodeResult => !!r);
    const count = (outcome: EpisodeResult['outcome']) => results.filter(r => r.outcome === outcome).length;
    const correct = count('correct'), excluded = results.filter(r => r.infrastructureExclusion && plan.analysis.infrastructureExclusions.includes(r.infrastructureExclusion)).length;
    const approved = results.filter(r => r.runtimeApproved), falseApprovals = approved.filter(r => r.outcome === 'incorrect').length;
    const adjudicatedApproved = approved.filter(r => r.outcome === 'correct' || r.outcome === 'incorrect').length;
    const taskIds = [...new Set(all.map(e => e.taskId))];
    const measuredCostUsd = results.reduce((n, r) => n + (r.usage.measuredCostUsd ?? 0), 0);
    const elapsedMs = results.reduce((n, r) => n + r.usage.elapsedMs, 0);
    const billingIncomplete = results.some(r => r.usage.measuredCostUsd === null) || results.length !== all.length;
    return { variant, plannedEpisodes: all.length, recordedEpisodes: results.length, missingEpisodes: all.length - results.length,
      independentlyCorrect: correct, incorrect: count('incorrect'), unverified: count('unverified'), infrastructureErrors: count('infrastructure_error'),
      primaryYield: { numerator: correct, denominator: all.length, fraction: correct / all.length, provisional: !complete },
      semanticYield: { numerator: correct, denominator: all.length - excluded, excludedInfrastructure: excluded, fraction: all.length > excluded ? correct / (all.length - excluded) : null },
      falseApprovals: { numerator: falseApprovals, denominator: adjudicatedApproved, unresolvedApprovals: approved.length - adjudicatedApproved, fraction: adjudicatedApproved ? falseApprovals / adjudicatedApproved : null },
      taskMajorityCorrect: taskIds.filter(taskId => all.filter(e => e.taskId === taskId && byId.get(e.id)?.outcome === 'correct').length >= 2).length,
      taskCount: taskIds.length, measuredCostUsd, billingIncomplete, measuredCostPerCorrectPatchUsd: !billingIncomplete && correct ? measuredCostUsd / correct : null,
      elapsedMs, elapsedMsPerCorrectPatch: complete && correct ? elapsedMs / correct : null,
      usage: { inferenceCalls: results.reduce((n, r) => n + r.usage.inferenceCalls, 0), inputTokens: results.reduce((n, r) => n + r.usage.inputTokens, 0), outputTokens: results.reduce((n, r) => n + r.usage.outputTokens, 0) },
    };
  });
  const cost = metrics.reduce((n, m) => n + m.measuredCostUsd, 0);
  if (cost > plan.approvedExperimentBudgetUsd + 1e-9) budgetViolations.push({ episodeId: 'experiment', dimension: 'measuredCostUsd' });
  const comparisonReady = complete && !budgetViolations.length && !budgetEvidenceIncomplete.length;
  const comparisons = comparisonReady ? metrics.filter(m => m.variant !== 'patchproof').map(comparator => {
    const groups = [...new Set(plan.episodes.map(e => e.repoId))].map(repoId => ({ repoId,
      pairs: plan.episodes.filter(e => e.repoId === repoId && e.variant === 'patchproof').map(e => {
        const matched = plan.episodes.find(other => other.taskId === e.taskId && other.repetition === e.repetition && other.variant === comparator.variant)!;
        return { proposed: byId.get(e.id)?.outcome === 'correct' ? 1 : 0, comparator: byId.get(matched.id)?.outcome === 'correct' ? 1 : 0 };
      }) }));
    return { comparator: comparator.variant, ...pairedRepositoryBootstrap(groups, { samples: plan.analysis.bootstrapSamples, seed: plan.analysis.bootstrapSeed }) };
  }) : [];
  const proposed = metrics.find(m => m.variant === 'patchproof')!, baseline = metrics.find(m => m.variant === 'baseline')!;
  const g2 = plan.kind !== 'pilot' ? null : !comparisonReady ? { decision: 'NOT ASSESSED', reason: 'Incomplete episodes, budget measurements or matched-budget violations.' } : {
    decision: proposed.taskMajorityCorrect >= baseline.taskMajorityCorrect + 2 && proposed.falseApprovals.numerator <= baseline.falseApprovals.numerator && proposed.falseApprovals.unresolvedApprovals === 0 && baseline.falseApprovals.unresolvedApprovals === 0 ? 'go' : 'simplify_or_stop',
    reason: 'Prospective gate: majority-correct task gain of at least two, no increase in observed false approvals, no unresolved approvals, matched budgets.',
  };
  const strongest = metrics.filter(m => m.variant !== 'patchproof').sort((a,b) => b.primaryYield.fraction - a.primaryYield.fraction)[0]!;
  const checksOnlyComparison = comparisons.find(c => c.comparator === 'checks_only');
  const strongestComparison = comparisons.find(c => c.comparator === strongest.variant);
  const g3 = plan.kind !== 'final' ? null : !comparisonReady ? { decision: 'NOT ASSESSED', reason: 'Incomplete episodes, budget measurements or matched-budget violations.' } : {
    decision: checksOnlyComparison && checksOnlyComparison.confidenceInterval95[0]! <= 0 && checksOnlyComparison.confidenceInterval95[1]! >= 0 ? 'simplify_to_checks_only' :
      strongestComparison && strongestComparison.difference >= 0.1 && comparisons.every(c => c.confidenceInterval95[0]! > 0) ? 'target_met_with_limited_evidence' : 'no_demonstrated_target_advantage',
    strongestObservedBaseline: strongest.variant,
    reason: 'Report both prespecified comparisons; target is 10 percentage points over the strongest observed baseline with both intervals above zero. Few clusters limit claims.',
  };
  return { schemaVersion: '1.0', planDigest, kind: plan.kind, evidenceStatus: complete ? 'recorded-episodes-analyzed' : 'incomplete-no-final-claim',
    complete, plannedEpisodes: plan.plannedEpisodes, recordedEpisodes: rows.length,
    missingEpisodeIds: plan.episodes.filter(e => !byId.has(e.id)).map(e => e.id), budgetViolations, budgetEvidenceIncomplete, metrics, comparisons, g2, g3,
    infrastructureFailuresRetained: true, finalOracleFeedbackUsedForRepair: false,
    limitations: ['Synthetic task suite and few repository clusters limit external validity.', 'Infrastructure failures remain in the primary denominator; the separate semantic view excludes only preregistered reasons.', 'An all-zero or incomplete yield is not evidence of useful abstention.'] };
}
