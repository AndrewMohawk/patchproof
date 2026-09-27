import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DigestSchema, LimitsSchema, TaskIdSchema, VariantSchema } from '../../packages/contracts/src/index.ts';

export const PROTOCOL_VERSION = 'patchproof-evaluation-v1';
export const INFRASTRUCTURE_EXCLUSIONS = ['provider_unavailable', 'provider_rate_limit', 'sandbox_setup_failure', 'provider_timeout'] as const;
export const TaskMetadataSchema = z.strictObject({ id: TaskIdSchema, repoId: z.string().min(1), split: z.enum(['development', 'calibration', 'final']),
  fixtureDigest: DigestSchema, oracleDigest: DigestSchema });
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;
export const EpisodePlanSchema = z.strictObject({
  id: z.string().min(1), taskId: TaskIdSchema, repoId: z.string().min(1), variant: VariantSchema,
  repetition: z.number().int().min(0).max(2), seed: z.number().int().nonnegative().max(2 ** 32 - 1),
  limits: LimitsSchema, fixtureDigest: DigestSchema, oracleDigest: DigestSchema,
});
export const ExperimentPlanSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.enum(['pilot', 'final']), evidenceStatus: z.literal('planned-not-executed'),
  benchmarkExecuted: z.literal(false), createdAt: z.string(), sourceManifestDigest: DigestSchema,
  modelLockDigest: DigestSchema.nullable(), policyDigest: DigestSchema,
  approvedExperimentBudgetUsd: z.number().finite().nonnegative().max(25),
  estimatedExperimentCostUsd: z.number().finite().nonnegative().nullable(),
  fixedRuntimeFeedbackRounds: z.number().int().min(1).max(24),
  finalOracleFeedbackRounds: z.literal(0), repetitions: z.literal(3),
  plannedEpisodes: z.number().int().positive(), episodes: z.array(EpisodePlanSchema),
  analysis: z.strictObject({ samplingUnit: z.literal('repository'), paired: z.literal(true),
    bootstrapSamples: z.number().int().min(100).max(100_000), bootstrapSeed: z.number().int().nonnegative().max(2 ** 32 - 1),
    confidenceLevel: z.literal(0.95), primaryDenominator: z.literal('all_planned_episodes'),
    infrastructureExclusions: z.array(z.enum(INFRASTRUCTURE_EXCLUSIONS)),
    taskAggregation: z.literal('majority_of_three_repetitions'),
  }),
});
export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>;

export function hashJson(value: unknown): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Fixed sampling before outcomes exist: three tasks from each of four development repositories;
 * every final task. It plans no network calls and does not reserve or authorize spending. */
export function planExperiment(options: {
  kind: 'pilot' | 'final'; tasks: TaskMetadata[]; limits: z.infer<typeof LimitsSchema>;
  sourceManifestDigest: string; modelLockDigest: string | null; policyDigest: string;
  approvedExperimentBudgetUsd: number; estimatedExperimentCostUsd?: number | null;
  seed?: number; createdAt?: string;
}): ExperimentPlan {
  const tasks = options.tasks.map(task => TaskMetadataSchema.parse(task));
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('Duplicate task identifiers.');
  const repoSplits = new Map<string, string>();
  for (const task of tasks) {
    if (repoSplits.has(task.repoId) && repoSplits.get(task.repoId) !== task.split) throw new Error('Repository crosses evaluation splits.');
    repoSplits.set(task.repoId, task.split);
  }
  const relevant = tasks.filter(task => task.split === (options.kind === 'pilot' ? 'development' : 'final'))
    .sort((a, b) => a.repoId.localeCompare(b.repoId) || a.id.localeCompare(b.id));
  const repositories = [...new Set(relevant.map(task => task.repoId))];
  const expectedRepos = options.kind === 'pilot' ? 4 : 6;
  if (repositories.length !== expectedRepos || relevant.length !== expectedRepos * 5 || repositories.some(repo => relevant.filter(t => t.repoId === repo).length !== 5)) {
    throw new Error('Required repository-disjoint five-task fixture groups are incomplete.');
  }
  const selected = options.kind === 'pilot' ? repositories.flatMap(repo => relevant.filter(t => t.repoId === repo).slice(0, 3)) : relevant;
  const variants = options.kind === 'pilot' ? ['baseline', 'patchproof'] as const : ['baseline', 'checks_only', 'patchproof'] as const;
  const episodes: z.infer<typeof EpisodePlanSchema>[] = [];
  const limits = LimitsSchema.parse(options.limits);
  const plannedEpisodes = selected.length * variants.length * 3;
  if (limits.inferenceCallLimit !== 24 || limits.wallTimeLimitSeconds !== 900) throw new Error('Protocol v1 fixes 24 calls and 900 seconds per episode. A different protocol must be prospectively versioned.');
  if (limits.maxApprovedSpendUsd * plannedEpisodes > options.approvedExperimentBudgetUsd + 1e-9) throw new Error('Episode reservations exceed approved experiment budget.');
  const baseSeed = options.seed ?? 20260927;
  for (let repetition = 0; repetition < 3; repetition++) for (const task of selected) for (const variant of variants) {
    episodes.push({ id: `${options.kind}:${task.id}:${variant}:${repetition}`, taskId: task.id, repoId: task.repoId, variant,
      repetition, seed: (baseSeed + repetition) >>> 0, limits: { ...limits }, fixtureDigest: task.fixtureDigest, oracleDigest: task.oracleDigest });
  }
  return ExperimentPlanSchema.parse({
    schemaVersion: '1.0', protocolVersion: PROTOCOL_VERSION, kind: options.kind, evidenceStatus: 'planned-not-executed', benchmarkExecuted: false,
    createdAt: options.createdAt ?? new Date().toISOString(), sourceManifestDigest: options.sourceManifestDigest,
    modelLockDigest: options.modelLockDigest, policyDigest: options.policyDigest,
    approvedExperimentBudgetUsd: options.approvedExperimentBudgetUsd, estimatedExperimentCostUsd: options.estimatedExperimentCostUsd ?? null,
    fixedRuntimeFeedbackRounds: limits.inferenceCallLimit, finalOracleFeedbackRounds: 0, repetitions: 3,
    plannedEpisodes, episodes,
    analysis: { samplingUnit: 'repository', paired: true, bootstrapSamples: 10_000, bootstrapSeed: baseSeed >>> 0,
      confidenceLevel: 0.95, primaryDenominator: 'all_planned_episodes', infrastructureExclusions: [...INFRASTRUCTURE_EXCLUSIONS],
      taskAggregation: 'majority_of_three_repetitions' },
  });
}

export function validatePlan(value: unknown): ExperimentPlan {
  const plan = ExperimentPlanSchema.parse(value);
  const count = plan.kind === 'pilot' ? 72 : 270;
  if (plan.plannedEpisodes !== count || plan.episodes.length !== count || new Set(plan.episodes.map(e => e.id)).size !== count) throw new Error('Incomplete or duplicate planned episode grid.');
  const variants = plan.kind === 'pilot' ? ['baseline', 'patchproof'] : ['baseline', 'checks_only', 'patchproof'];
  const tasks = [...new Set(plan.episodes.map(e => e.taskId))];
  const repositories = [...new Set(plan.episodes.map(e => e.repoId))];
  if (tasks.length !== (plan.kind === 'pilot' ? 12 : 30) || repositories.length !== (plan.kind === 'pilot' ? 4 : 6) ||
    repositories.some(repo => new Set(plan.episodes.filter(e => e.repoId === repo).map(e => e.taskId)).size !== (plan.kind === 'pilot' ? 3 : 5))) throw new Error('Invalid repository-cluster grid.');
  if (plan.episodes.some(e => e.limits.inferenceCallLimit !== 24 || e.limits.wallTimeLimitSeconds !== 900) || plan.fixedRuntimeFeedbackRounds !== 24) throw new Error('Protocol v1 resource caps changed.');
  for (const task of tasks) {
    const rows = plan.episodes.filter(e => e.taskId === task);
    if (rows.length !== variants.length * 3 || new Set(rows.map(e => e.repoId)).size !== 1 ||
      new Set(rows.map(e => e.fixtureDigest)).size !== 1 || new Set(rows.map(e => e.oracleDigest)).size !== 1) throw new Error('Unmatched task inputs.');
    for (const variant of variants) for (let repetition = 0; repetition < 3; repetition++) {
      if (rows.filter(e => e.variant === variant && e.repetition === repetition).length !== 1) throw new Error('Missing matched variant/repetition.');
    }
    for (let repetition = 0; repetition < 3; repetition++) {
      if (new Set(rows.filter(e => e.repetition === repetition).map(e => e.seed)).size !== 1) throw new Error('Unmatched episode seeds.');
    }
  }
  if (new Set(plan.episodes.map(e => JSON.stringify(e.limits))).size !== 1) throw new Error('Unmatched aggregate limits.');
  if (plan.episodes.reduce((sum, e) => sum + e.limits.maxApprovedSpendUsd, 0) > plan.approvedExperimentBudgetUsd + 1e-9) throw new Error('Plan exceeds approved resource reservation.');
  return plan;
}

export const ExecutionGatesSchema = z.strictObject({
  accountAccessVerified: z.boolean(), sandboxEntitlementVerified: z.boolean(), modelVerified: z.boolean(),
  realIntegrationPassed: z.boolean(), oracleIndependentlyReviewed: z.boolean(), experimentApproved: z.boolean(),
  approvedRemainingSpendUsd: z.number().finite().nonnegative(), pricesVerified: z.boolean(), finalProtocolFrozen: z.boolean(),
});

export function assertExecutionReady(planValue: unknown, gatesValue: unknown) {
  const plan = validatePlan(planValue);
  const parsed = ExecutionGatesSchema.safeParse(gatesValue);
  if (!parsed.success) throw new Error('Experiment NOT RUN: invalid execution gates; every required boolean and a finite nonnegative remaining budget must be provided.');
  const gates = parsed.data;
  const missing = Object.entries(gates).filter(([key, value]) => key !== 'approvedRemainingSpendUsd' && !value).map(([key]) => key);
  if (!plan.modelLockDigest) missing.push('modelLockDigest');
  if (plan.estimatedExperimentCostUsd === null) missing.push('measuredPriceProjection');
  if (plan.approvedExperimentBudgetUsd <= 0 || gates.approvedRemainingSpendUsd < plan.approvedExperimentBudgetUsd) missing.push('remainingBudget');
  if (plan.episodes.some(episode => episode.limits.maxApprovedSpendUsd <= 0)) missing.push('episodeBudgetAllocation');
  if (plan.estimatedExperimentCostUsd !== null && plan.estimatedExperimentCostUsd > plan.approvedExperimentBudgetUsd) missing.push('projectedCostWithinBudget');
  if (missing.length) throw new Error(`Experiment NOT RUN: ${missing.join(', ')}.`);
  return plan;
}

/** Preserve original report; any post-result protocol change becomes a separately identified exploration. */
export function classifyProtocolChange(originalDigest: string, newDigest: string, finalResultsObserved: boolean) {
  return { changed: originalDigest !== newDigest,
    classification: finalResultsObserved && originalDigest !== newDigest ? 'exploratory' : 'preregistered',
    preserveOriginalReport: true as const, originalProtocolDigest: originalDigest, newProtocolDigest: newDigest };
}
