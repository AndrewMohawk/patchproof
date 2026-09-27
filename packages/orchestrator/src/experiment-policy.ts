import { z } from 'zod';
import { EXPERIMENT_REPAIR_POLICY } from './episode-engine.ts';
import { REPEATED_CHECK_PROTOCOL } from './repeated-checks.ts';

export const ExperimentSettingsSchema = z.strictObject({
  maxOutputTokensPerCall: z.number().int().positive().max(1_000_000),
  // Explicit synthetic prospective controls, not an attestation of a provider.
  checkCpuUnits: z.number().finite().positive(), overheadCpuSecondsPerBatch: z.number().finite().nonnegative(),
  maxCheckBatchSeconds: z.number().int().min(1).max(120),
  adjudicationReserve: z.strictObject({ wallSeconds: z.number().int().min(1).max(120),
    cpuSeconds: z.number().finite().nonnegative(), spendUsd: z.number().finite().nonnegative() }),
});
export function buildProspectiveExperimentPolicy(value: z.infer<typeof ExperimentSettingsSchema>) {
  return { ...EXPERIMENT_REPAIR_POLICY, settings: ExperimentSettingsSchema.parse(value), checkProtocol: REPEATED_CHECK_PROTOCOL,
    executionScope: 'synthetic-only' as const, originalSourceCheckBatches: 0, maximumRawCheckBatches: 48,
    baselineRuntimeApproval: 'visible-checks-only' as const, otherRuntimeApproval: 'all-declared-requirements-covered' as const,
    sampling: 'unverified-not-sent' as const, seed: 'recorded-not-a-determinism-claim' as const };
}
