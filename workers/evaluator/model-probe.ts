import { z } from 'zod';
import { DigestSchema, LimitsSchema } from '../../packages/contracts/src/index.ts';
import { digestJson } from '../../packages/contracts/src/digest.ts';
import { usdToMicros } from '../../packages/orchestrator/src/budget-ledger.ts';
import { TaskMetadataSchema } from './protocol.ts';

const ModelSchema = z.strictObject({
  modelId: z.string().regex(/^nvidia\/[A-Za-z0-9._/-]+$/), modelLockDigest: DigestSchema,
  accountProofDigest: DigestSchema, tokenizerDigest: DigestSchema,
  licenseUrl: z.url().startsWith('https://'), modelCardUrl: z.url().startsWith('https://'), accountVerifiedAt: z.iso.datetime(), validUntil: z.iso.datetime(),
});
export const ProbePlanInputSchema = z.strictObject({
  createdAt: z.iso.datetime(), sourceManifestDigest: DigestSchema, sourceDigest: DigestSchema,
  policyDigest: DigestSchema, tasks: z.array(TaskMetadataSchema).length(20),
  models: z.array(ModelSchema).max(4), limits: LimitsSchema,
  plannedBudgetUsd: z.number().finite().nonnegative().max(25),
  minimumCorrectTasks: z.number().int().min(1).max(8),
});
const EpisodeSchema = z.strictObject({
  id: z.string().min(1), taskId: z.string().min(1), repoId: z.string().min(1),
  fixtureDigest: DigestSchema, oracleDigest: DigestSchema, modelId: ModelSchema.shape.modelId,
  modelLockDigest: DigestSchema, variant: z.literal('baseline'), limits: LimitsSchema,
});
export const ProbePlanSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), protocol: z.literal('eight-development-model-probe-v1'),
  kind: z.literal('development-model-selection'), variant: z.literal('baseline'), executionAuthorized: z.literal(false),
  competitionReady: z.literal(false), selection: z.literal('first-two-task-ids-from-each-of-four-development-repositories'),
  input: ProbePlanInputSchema, selectedTaskIds: z.array(z.string()).length(8), episodes: z.array(EpisodeSchema).max(32),
  tieBreak: z.literal('measured-total-usd-then-correct-tasks-then-total-latency-then-model-id'), planDigest: DigestSchema,
});
export type ProbePlan = z.infer<typeof ProbePlanSchema>;
function fail(code: string): never { throw new Error(`model_probe_${code}`); }

/** An offline prospective plan, never an execution grant. Supply only public development metadata. */
export function planModelProbe(value: z.input<typeof ProbePlanInputSchema>): ProbePlan {
  const input = ProbePlanInputSchema.parse(value);
  const tasks = [...input.tasks].sort((a,b) => a.repoId.localeCompare(b.repoId) || a.id.localeCompare(b.id));
  if (tasks.some(task => task.split !== 'development') || new Set(tasks.map(task => task.id)).size !== 20) fail('development_only');
  const repos = [...new Set(tasks.map(task => task.repoId))];
  if (repos.length !== 4 || repos.some(repo => tasks.filter(task => task.repoId === repo).length !== 5)) fail('repository_grid');
  if (new Set(input.models.map(model => model.modelId)).size !== input.models.length ||
      new Set(input.models.map(model => model.modelLockDigest)).size !== input.models.length) fail('duplicate_model');
  const created = Date.parse(input.createdAt);
  for (const model of input.models) if (Date.parse(model.accountVerifiedAt) > created || Date.parse(model.validUntil) <= created) fail('model_proof_window');
  // One baseline proposal per task, through the bounded private smoke path.
  if (input.limits.inferenceCallLimit !== 1 || input.limits.wallTimeLimitSeconds > 120) fail('smoke_envelope');
  const selected = repos.flatMap(repo => tasks.filter(task => task.repoId === repo).slice(0,2));
  const models = [...input.models].sort((a,b) => a.modelId.localeCompare(b.modelId));
  if (usdToMicros(input.limits.maxApprovedSpendUsd) * BigInt(selected.length * models.length) > usdToMicros(input.plannedBudgetUsd)) fail('planned_budget');
  const episodes = models.flatMap((model,index) => selected.map(task => ({
    id: `probe:${index}:${task.id}`, taskId: task.id, repoId: task.repoId,
    fixtureDigest: task.fixtureDigest, oracleDigest: task.oracleDigest, modelId: model.modelId,
    modelLockDigest: model.modelLockDigest, variant: 'baseline' as const, limits: { ...input.limits },
  })));
  const plan = { schemaVersion: '1.0' as const, protocol: 'eight-development-model-probe-v1' as const,
    kind: 'development-model-selection' as const, variant: 'baseline' as const, executionAuthorized: false as const, competitionReady: false as const,
    selection: 'first-two-task-ids-from-each-of-four-development-repositories' as const,
    input: { ...input, tasks, models }, selectedTaskIds: selected.map(task => task.id), episodes,
    tieBreak: 'measured-total-usd-then-correct-tasks-then-total-latency-then-model-id' as const };
  return ProbePlanSchema.parse({ ...plan, planDigest: digestJson(plan) });
}
export function verifyProbePlan(value: unknown): ProbePlan {
  const parsed = ProbePlanSchema.parse(value), rebuilt = planModelProbe(parsed.input);
  if (digestJson(parsed) !== digestJson(rebuilt)) fail('plan_changed');
  return rebuilt;
}

const MicrosSchema = z.string().regex(/^(0|[1-9][0-9]{0,15})$/);
export const ProbeResultSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), scope: z.enum(['actual-provider-observation', 'synthetic-unit-only']),
  planDigest: DigestSchema, episodeId: z.string().min(1), runId: z.uuid(), modelId: ModelSchema.shape.modelId,
  modelLockDigest: DigestSchema, fixtureDigest: DigestSchema, oracleDigest: DigestSchema,
  sourceDigest: DigestSchema, policyDigest: DigestSchema, variant: z.literal('baseline'),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(),
  outcome: z.enum(['correct', 'incorrect', 'no_patch', 'infrastructure_error', 'unverified']),
  runtimeApproved: z.boolean(), bundleDigest: DigestSchema.nullable(), adjudicationDigest: DigestSchema.nullable(),
  independentlyAdjudicated: z.boolean(), measuredCostMicros: MicrosSchema.nullable(), billingComplete: z.boolean(),
  inferenceCalls: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  elapsedMs: z.number().finite().nonnegative(), sandboxCpuSeconds: z.number().finite().nonnegative().nullable(),
  modelRequestIds: z.array(z.string().min(1).max(200)).max(24), sandboxOperationIds: z.array(z.string().min(1).max(200)).max(1000),
  failureReason: z.string().min(1).max(300).nullable(),
}).superRefine((row,ctx) => {
  if (Date.parse(row.finishedAt) < Date.parse(row.startedAt) || row.billingComplete && row.measuredCostMicros === null ||
      row.independentlyAdjudicated && !row.adjudicationDigest ||
      ['correct','incorrect'].includes(row.outcome) && (!row.independentlyAdjudicated || !row.bundleDigest || row.inferenceCalls < 1 || !row.modelRequestIds.length) ||
      row.runtimeApproved && !['correct','incorrect'].includes(row.outcome) ||
      row.elapsedMs !== Date.parse(row.finishedAt)-Date.parse(row.startedAt) ||
      new Set(row.modelRequestIds).size !== row.modelRequestIds.length || new Set(row.sandboxOperationIds).size !== row.sandboxOperationIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Incomplete or inconsistent probe observation.' });
  }
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

/** Accept only separately reviewed observations. This checks bindings, not provider authenticity.
 * It preserves all planned failures/missing rows and never writes a runtime/model selection. */
export function analyzeModelProbe(planValue: unknown, observations: unknown[], options: {
  acceptedResultDigests: string[]; acceptedModelProofDigests: string[]; now?: Date;
}) {
  if (!Array.isArray(observations) || observations.length > 32) fail('observation_bound');
  const plan = verifyProbePlan(planValue), rows = observations.map(value => ProbeResultSchema.parse(value));
  const accepted = new Set(z.array(DigestSchema).parse(options.acceptedResultDigests));
  const acceptedModels = new Set(z.array(DigestSchema).parse(options.acceptedModelProofDigests));
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) fail('clock');
  if (new Set(rows.map(row => row.episodeId)).size !== rows.length || new Set(rows.map(row => row.runId)).size !== rows.length) fail('duplicate_observation');
  const reasons = new Set<string>();
  if (!plan.input.models.length) reasons.add('account_catalog_not_configured');
  const episodes = new Map(plan.episodes.map(episode => [episode.id,episode]));
  for (const row of rows) {
    const episode = episodes.get(row.episodeId);
    if (!episode || row.planDigest !== plan.planDigest || row.modelId !== episode.modelId || row.modelLockDigest !== episode.modelLockDigest ||
        row.fixtureDigest !== episode.fixtureDigest || row.oracleDigest !== episode.oracleDigest || row.sourceDigest !== plan.input.sourceDigest ||
        row.policyDigest !== plan.input.policyDigest || row.variant !== episode.variant) fail('observation_binding');
    const model = plan.input.models.find(item => item.modelId === row.modelId)!;
    if (Date.parse(row.startedAt) < Date.parse(plan.input.createdAt) || Date.parse(row.finishedAt) > now ||
        Date.parse(row.finishedAt) >= Date.parse(model.validUntil)) fail('observation_time');
    if (row.scope !== 'actual-provider-observation') reasons.add('synthetic_observations');
    if (!accepted.has(digestJson(row))) reasons.add('unaccepted_observations');
    if (!row.billingComplete || row.measuredCostMicros === null) reasons.add('incomplete_billing');
    if (row.outcome === 'unverified' || row.runtimeApproved && !row.independentlyAdjudicated) reasons.add('unverified_correctness');
    if (row.sandboxCpuSeconds === null) reasons.add('unmeasured_cpu');
    if (row.inferenceCalls > episode.limits.inferenceCallLimit || row.inputTokens > episode.limits.inputTokenLimit ||
        row.outputTokens > episode.limits.outputTokenLimit || row.elapsedMs > episode.limits.wallTimeLimitSeconds * 1000 ||
        row.sandboxCpuSeconds !== null && row.sandboxCpuSeconds > episode.limits.sandboxCpuSecondsLimit ||
        row.measuredCostMicros !== null && BigInt(row.measuredCostMicros) > usdToMicros(episode.limits.maxApprovedSpendUsd)) reasons.add('unmatched_budget');
    if (row.inferenceCalls > 0 && row.modelRequestIds.length === 0 || ['correct','incorrect'].includes(row.outcome) && row.sandboxOperationIds.length === 0) reasons.add('missing_operation_evidence');
  }
  if (rows.length !== plan.episodes.length) reasons.add('missing_planned_episodes');
  for (const model of plan.input.models) {
    if (!acceptedModels.has(model.accountProofDigest)) reasons.add('unaccepted_model_proof');
    if (Date.parse(model.validUntil) <= now) reasons.add('model_proof_expired');
  }
  const summaries = plan.input.models.map(model => {
    const recorded = rows.filter(row => row.modelId === model.modelId);
    const correct = recorded.filter(row => row.outcome === 'correct').length;
    const falseApprovals = recorded.filter(row => row.runtimeApproved && row.outcome === 'incorrect').length;
    const completeCost = recorded.length === 8 && recorded.every(row => row.billingComplete && row.measuredCostMicros !== null);
    return { modelId: model.modelId, modelLockDigest: model.modelLockDigest, plannedTasks: 8, recordedTasks: recorded.length,
      correctTasks: correct, falseApprovals, failures: recorded.filter(row => row.outcome !== 'correct').length,
      missingTasks: 8-recorded.length, totalMeasuredCostMicros: completeCost ? String(recorded.reduce((sum,row) => sum+BigInt(row.measuredCostMicros!),0n)) : null,
      totalElapsedMs: recorded.reduce((sum,row) => sum+row.elapsedMs,0),
      qualityThresholdMet: recorded.length === 8 && correct >= plan.input.minimumCorrectTasks && falseApprovals === 0 };
  });
  const recordedTotal = rows.reduce((sum,row) => sum+BigInt(row.measuredCostMicros ?? '0'),0n);
  if (recordedTotal > usdToMicros(plan.input.plannedBudgetUsd)) reasons.add('aggregate_budget_exceeded');
  const eligible = summaries.filter(model => model.qualityThresholdMet && model.totalMeasuredCostMicros !== null).sort((a,b) =>
    BigInt(a.totalMeasuredCostMicros!) < BigInt(b.totalMeasuredCostMicros!) ? -1 :
    BigInt(a.totalMeasuredCostMicros!) > BigInt(b.totalMeasuredCostMicros!) ? 1 :
    b.correctTasks-a.correctTasks || a.totalElapsedMs-b.totalElapsedMs || a.modelId.localeCompare(b.modelId));
  if (!eligible.length && plan.input.models.length) reasons.add('no_candidate_meets_frozen_threshold');
  const selected = reasons.size ? null : eligible[0] ?? null;
  return { schemaVersion: '1.0', kind: 'development-model-probe-report', planDigest: plan.planDigest,
    status: selected ? 'selection-recommendation' : 'blocked', executedByThisCommand: false, competitionReady: false,
    authenticityVerified: false, plannedEpisodes: plan.episodes.length, recordedEpisodes: rows.length,
    selectedModelId: selected?.modelId ?? null, selectedModelLockDigest: selected?.modelLockDigest ?? null,
    reasons: [...reasons].sort(), models: summaries, recordedCostLowerBoundMicros: String(recordedTotal),
    observations: rows.map(row => ({ episodeId: row.episodeId, runId: row.runId, outcome: row.outcome, receiptDigest: digestJson(row) })),
    notice: 'Development-only descriptive selection, not a benchmark or execution grant. Missing/failed episodes remain accounted for. Provider authenticity requires trusted ingestion.' };
}
