import { z } from 'zod';
import { DigestSchema } from '../../contracts/src/index.ts';
import { digestJson } from '../../contracts/src/digest.ts';
import { EXPERIMENT_REPAIR_POLICY } from './episode-engine.ts';
import { REPEATED_CHECK_PROTOCOL } from './repeated-checks.ts';
import type { SmokeModelProofSchema } from './trusted-smoke.ts';

export const LiveExperimentSettingsSchema = z.strictObject({
  maxOutputTokensPerCall: z.number().int().positive().max(1_000_000),
  maxModelCallSeconds: z.number().int().min(1).max(120), maxCheckBatchSeconds: z.number().int().min(1).max(120),
  accountingTimeoutSeconds: z.number().int().min(1).max(30), cleanupTimeoutSeconds: z.number().int().min(1).max(10),
  hostOverheadSeconds: z.number().finite().positive(),
  adjudicationReserve: z.strictObject({ wallSeconds: z.number().int().min(1).max(120),
    cpuSeconds: z.number().finite().positive(), spendUsd: z.number().finite().positive() }),
  adjudicationBounds: z.strictObject({ maxConcurrentCpuUnits: z.number().finite().positive(),
    maxCostUsdPerSecond: z.number().finite().nonnegative(), fixedCostUsd: z.number().finite().nonnegative() }),
});
export function buildLiveExperimentPolicy(value: z.infer<typeof LiveExperimentSettingsSchema>) {
  return { ...EXPERIMENT_REPAIR_POLICY, calibrated: true as const, settings: LiveExperimentSettingsSchema.parse(value), checkProtocol: REPEATED_CHECK_PROTOCOL,
    executionScope: 'live-calibrated-experiment-v1' as const, originalSourceCheckBatches: 0, maximumRawCheckBatches: 48,
    baselineRuntimeApproval: 'visible-checks-only' as const, otherRuntimeApproval: 'all-declared-requirements-covered' as const,
    sampling: 'provider-defaults-account-reviewed-not-overridden' as const, seed: 'recorded-not-sent-not-a-determinism-claim' as const };
}
export type LiveExperimentPolicy = ReturnType<typeof buildLiveExperimentPolicy>;
export const LiveExperimentAcceptanceSchema = z.strictObject({ schemaVersion: z.literal('1.0'), scope: z.literal('live-experiment-runtime'),
  verifiedAt: z.iso.datetime(), validUntil: z.iso.datetime(), policyDigest: DigestSchema, modelLockDigest: DigestSchema,
  sourceDigest: DigestSchema, sandboxVerificationDigest: DigestSchema, cpuProofDigest: DigestSchema,
  calibrationUsedOnlyDevelopmentData: z.literal(true), noFinalFeedbackUsed: z.literal(true),
  samplingDefaultsReviewed: z.literal(true), hostOverheadBoundVerified: z.literal(true),
  evidenceRefs: z.array(z.string().min(1).max(300)).min(1).max(40),
});
/** The lock records the exact proof/rates used, without adding unsupported sampling API fields. */
export function buildLiveExperimentModelLock(value: { proof: z.infer<typeof SmokeModelProofSchema>; accountVerifiedAt: string;
  inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number }) {
  return { schemaVersion: '1.0', provider: 'nebius-token-factory', modelId: value.proof.modelId,
    modelProofDigest: digestJson(value.proof), tokenizerDigest: value.proof.tokenizerDigest, accountVerifiedAt: value.accountVerifiedAt,
    inputUsdPerMillionTokens: value.inputUsdPerMillionTokens, outputUsdPerMillionTokens: value.outputUsdPerMillionTokens,
    requestBehavior: { responseFormat: 'json_object', stream: false, samplingOverrides: false, seedSent: false } };
}
