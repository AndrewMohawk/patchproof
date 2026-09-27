import { z } from 'zod';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { buildLiveExperimentPolicy, LiveExperimentAcceptanceSchema, LiveExperimentSettingsSchema } from '../packages/orchestrator/src/live-experiment-policy.ts';
import type { OperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { REPEATED_CHECK_PROTOCOL } from '../packages/orchestrator/src/repeated-checks.ts';
import { hashJson } from '../workers/evaluator/protocol.ts';
import { RuntimeSchema } from './config.ts';
import type { Configuration } from './config.ts';
import { buildReleaseBindings, ReleaseDigestSchema, ReleasePathSchema } from './release-receipts.ts';
import type { ReleaseBindings } from './release-receipts.ts';

const ModelLockSchema = z.strictObject({ schemaVersion: z.literal('1.0'), provider: z.literal('nebius-token-factory'),
  modelId: z.string().regex(/^nvidia\/[A-Za-z0-9._/-]+$/), modelProofDigest: ReleaseDigestSchema, tokenizerDigest: ReleaseDigestSchema,
  accountVerifiedAt: z.iso.datetime(), inputUsdPerMillionTokens: z.number().finite().nonnegative(), outputUsdPerMillionTokens: z.number().finite().nonnegative(),
  requestBehavior: z.strictObject({ responseFormat: z.literal('json_object'), stream: z.literal(false), samplingOverrides: z.literal(false), seedSent: z.literal(false) }),
});
/** Public metadata projection: no private paths, credentials, account callbacks or provider transport. */
export const ReleaseLiveProtocolSchema = z.strictObject({ schemaVersion: z.literal('1.0'), scope: z.literal('accepted-live-experiment-release'),
  operationalLockDigest: ReleaseDigestSchema, runtime: RuntimeSchema, settings: LiveExperimentSettingsSchema,
  modelLock: ModelLockSchema, acceptance: LiveExperimentAcceptanceSchema,
});
export type ReleaseLiveProtocol = z.infer<typeof ReleaseLiveProtocolSchema>;
export interface ReleaseLiveSelection {
  document: unknown;
  /** Exact proof digest accepted by trusted ingestion, separately from release receipt content. */
  acceptedProofDigest: string;
  artifact?: { path: string; digest: string };
}
export const ReleaseLiveReferenceSchema = z.strictObject({ path: ReleasePathSchema, digest: ReleaseDigestSchema, acceptedProofDigest: ReleaseDigestSchema });
const fail = (reason: string): never => { throw new Error(`release_live_protocol_${reason}`); };

/** Checks bindings and accepted attestations; no hash establishes the truth of calibration/account claims. */
export function validateReleaseLiveProtocol(selection: ReleaseLiveSelection, expected: {
  sourceDigest: string; operationalLockDigest: string; runtime: Configuration['runtime']; now?: Date;
}): ReleaseLiveProtocol {
  const parsed = ReleaseLiveProtocolSchema.safeParse(selection.document);
  if (!parsed.success) fail('invalid');
  const value = parsed.data!, now = expected.now?.getTime() ?? Date.now();
  if (!Number.isFinite(now)) fail('clock');
  const { acceptance, modelLock: model, runtime, settings } = value;
  if (!ReleaseDigestSchema.safeParse(selection.acceptedProofDigest).success || digestJson(acceptance) !== selection.acceptedProofDigest) fail('untrusted');
  if (acceptance.sourceDigest !== expected.sourceDigest || value.operationalLockDigest !== expected.operationalLockDigest) fail('source_changed');
  if (runtime.mode !== 'live' || expected.runtime.mode !== 'live' || digestJson(runtime) !== digestJson(expected.runtime)) fail('runtime_changed');
  if (Date.parse(acceptance.verifiedAt) > now || Date.parse(acceptance.validUntil) <= now || Date.parse(acceptance.validUntil) <= Date.parse(acceptance.verifiedAt) ||
      Date.parse(runtime.observedAt) > now || Date.parse(model.accountVerifiedAt) > now) fail('stale');
  if (acceptance.policyDigest !== hashJson(buildLiveExperimentPolicy(settings))) fail('policy_changed');
  if (acceptance.modelLockDigest !== digestJson(model) || model.modelId !== runtime.model.id || model.accountVerifiedAt !== runtime.model.accountVerifiedAt ||
      model.inputUsdPerMillionTokens !== runtime.model.inputUsdPerMillionTokens || model.outputUsdPerMillionTokens !== runtime.model.outputUsdPerMillionTokens ||
      !runtime.model.licenseUrl || !runtime.model.modelCardUrl || !runtime.model.contextLimit || settings.maxOutputTokensPerCall >= runtime.model.contextLimit) fail('model_changed');
  if (!runtime.sandbox.endpoint || !runtime.sandbox.sdkVersion || !runtime.sandbox.imageDigest || !runtime.sandbox.architecture || !runtime.sandbox.accountVerifiedAt ||
      !runtime.sandbox.networkControlsVerifiedAt || !runtime.sandbox.cancellationVerifiedAt || !runtime.sandbox.billingUnit || runtime.sandbox.usdPerBillingUnit === null ||
      [runtime.sandbox.accountVerifiedAt, runtime.sandbox.networkControlsVerifiedAt, runtime.sandbox.cancellationVerifiedAt].some(date => Date.parse(date) > now)) fail('controls_missing');
  if (settings.adjudicationReserve.wallSeconds < settings.accountingTimeoutSeconds + settings.cleanupTimeoutSeconds + 1) fail('reserve');
  return value;
}

export function resolveReleaseBindings(input: { operational: OperationalLock; runtime: Configuration['runtime']; bundleDigests: string[];
  liveProtocol?: ReleaseLiveSelection; now?: Date }) {
  const live = input.liveProtocol ? validateReleaseLiveProtocol(input.liveProtocol, {
    sourceDigest: digestJson(input.operational.sources), operationalLockDigest: digestJson(input.operational), runtime: input.runtime,
    ...(input.now ? { now: input.now } : {}),
  }) : null;
  return { bindings: buildReleaseBindings({ sources: input.operational.sources, runtime: input.runtime,
    protocol: live ?? input.operational.behavior, liveProtocolFrozen: live !== null, runtimeMode: input.runtime.mode, bundleDigests: input.bundleDigests }),
    liveProtocol: live };
}

export function classifyReleaseBundle(runtimeValue: unknown, mode: 'mock' | 'live', bindings: ReleaseBindings, live: ReleaseLiveProtocol | null) {
  if (!runtimeValue || typeof runtimeValue !== 'object') return 'historical_or_unbound' as const;
  const runtime = runtimeValue as Record<string, unknown>;
  if (live) {
    // Existing smoke producer is intentionally a three-proposal policy, distinct from the release's frozen experiment policy.
    const matches = mode === 'live' && bindings.runtimeMode === 'live' && runtime.mode === 'live' && runtime.scope === 'trusted-smoke-only' &&
      runtime.calibratedExperiment === false && runtime.sourceDigest === live.operationalLockDigest &&
      runtime.modelId === live.modelLock.modelId && runtime.modelProofDigest === live.modelLock.modelProofDigest && runtime.tokenizerDigest === live.modelLock.tokenizerDigest &&
      runtime.inputUsdPerMillionTokens === live.modelLock.inputUsdPerMillionTokens && runtime.outputUsdPerMillionTokens === live.modelLock.outputUsdPerMillionTokens &&
      runtime.sandboxVerificationDigest === live.acceptance.sandboxVerificationDigest && runtime.cpuProofDigest === live.acceptance.cpuProofDigest &&
      runtime.imageDigest === live.runtime.sandbox.imageDigest && runtime.repairPolicy === 'immutable-branches-visible-baseline-v1' &&
      runtime.checkProtocol !== undefined && digestJson(runtime.checkProtocol) === digestJson(REPEATED_CHECK_PROTOCOL);
    return matches ? 'compatible_presentation' as const : 'historical_or_unbound' as const;
  }
  const operational = runtime.operationalLock as { sources?: unknown; behavior?: unknown } | undefined;
  const { localCheckImage: _image, localExecution: _execution, checkProtocol: _checks, repairPolicy: _repair, operationalLock: _lock, ...baseRuntime } = runtime;
  return operational?.sources !== undefined && operational.behavior !== undefined && digestJson(operational.sources) === bindings.sourceDigest &&
    digestJson(operational.behavior) === bindings.protocolDigest && digestJson(baseRuntime) === bindings.runtimeDigest && mode === bindings.runtimeMode ?
    'current' as const : 'historical_or_unbound' as const;
}
