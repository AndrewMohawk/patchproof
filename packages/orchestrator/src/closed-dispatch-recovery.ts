import { z } from 'zod';
import { digestJson } from '../../contracts/src/digest.ts';

/** One reviewed historical exception, NOT a provider receipt or a general recovery API.
 * This inventory was checked against all 172 source hashes at the pinned commit.
 * Changing any binding or assumption requires a new code review, not operator input.
 * No raw response, returned-model validation, or settled charge is claimed. */
const historicalCase = {
  policyId: 'historical-20261020-closed-dispatch-v1',
  reservationId: 'live-local:06e10471-44b0-4b5c-80b9-a01f9eabd5f9',
  episodeId: '06e10471-44b0-4b5c-80b9-a01f9eabd5f9', stage: 'smoke', reservedMicros: '250000',
  reservationFingerprint: 'sha256:a2792203570ad1c09f617e8b9594e44b578e26e7b7c8d240d7b1dffb496fc05d',
  evidenceDigest: 'sha256:d931aea983c261d612ebb8779f2fa72e28482190900646b6840ef1a01d36acf2',
  sourceCommit: '2595f7d41a3f5b23e5b65d8685c0a1a953ee39a4',
  sourceDigest: 'sha256:aed7c93b7dc29d17277a059eb4865c51167ad1af052d20dbdeab8f2ae773f456',
  configDigest: 'sha256:0528c3269f496e9c3db35212ce80709da92e7c0fc59d23d0f4427c315184af67',
  bundleDigest: 'sha256:63cf9ffba0f104f1542e0bfa04eb1aa650c590b4b1ea38de5cb852a8d573ac39',
  closureDigest: 'sha256:a7e030a9b6397f7941bd96b871dc224f7a0f8cc20e08bb2f9859eb740f5af214',
  openDispatchDigest: 'sha256:6b02ef461eb74f614d7d829719943a38c6e1cf8bb1439cadc9b10129d0dbc146',
  pricingEvidenceDigest: 'sha256:570cb15173df86bdc89fbeb18bc72a6c9c3080a3d3ca0b139c24841fa3c3e87e',
  feeEvidenceDigest: 'sha256:1fddb65de6bca39f6a6c681fbcc4ff149b544d054db7c88b5ccdb6b74522fad0',
  pricingVerifiedAt: '2026-10-20T04:01:38.948Z', pricingValidUntil: '2026-10-20T05:11:38.948Z',
  feesVerifiedAt: '2026-10-19T21:11:58.134Z', feesValidUntil: '2026-10-20T21:11:58.134Z',
  intentId: 'b12dafb1-4c0c-475d-ba52-745348443e07', dispatchedAt: '2026-10-20T04:03:04.776Z',
  providerRequestId: 'chatcmpl-aa7682ce8eecf855', responseRecordedAt: '2026-10-20T04:03:25.954Z',
  closedAt: '2026-10-20T04:03:26.080Z', terminalStatus: 'infrastructure_error', terminalReason: 'invalid_response',
  endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions',
  requestedModel: 'nvidia/nemotron-3-super-120b-a12b', returnedModelVerified: false,
  rawResponseDigest: null, actualCostMicros: null, settlementComplete: false,
  observedInputTokens: 3046, observedOutputTokens: 4000,
  dispatchedCalls: 1, conservativeCallAllowance: 3, inputTokenCeiling: 262144, outputTokenCeiling: 4000,
  maxTokens: 4000, maxCompletionTokens: 4000, completionsPerRequest: 1, thinkingRequested: true,
  inputMicrosPerMillionTokens: '300000', outputMicrosPerMillionTokens: '900000',
  requestFeeMicros: '0', additionalFeeMicros: '0',
  transport: 'single-native-fetch-no-sdk-retries', redirects: 'error', stream: false, store: false,
  dispatchClosed: true, inventoryComplete: true, automaticRetries: 0, otherBillableOperations: 0,
  assumptions: [
    'Provider honors requested-model rates; returned-model equality was not checked before the historical parse failure.',
    'Provider honors max_completion_tokens including reasoning and n=1; saved usage is not a provider bill.',
    'Source-bound single native fetch and durable closed inventory exclude further dispatch; no transport retries or other billable operations.',
    'Reviewed historical account fee evidence applies to this dispatch; future admissions require their own current verification.',
  ],
} as const;
// Canonical immutable text prevents callers mutating the reviewed policy through an exported object.
const reviewedCaseJson = JSON.stringify(historicalCase);
export const CLOSED_DISPATCH_POLICY_ID = historicalCase.policyId;
export const CLOSED_DISPATCH_CASE_DIGEST = digestJson(historicalCase);
export const CLOSED_DISPATCH_COVERAGE_EVENT = 'historical_closed_dispatch_exposure_covered';
export const closedDispatchCase = () => JSON.parse(reviewedCaseJson) as typeof historicalCase;
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative().safe();
const micros = z.string().regex(/^(0|[1-9][0-9]{0,8})$/);
export const ClosedDispatchCoverageSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), kind: z.literal('historical-closed-dispatch-exposure-v1'),
  policyId: z.literal(CLOSED_DISPATCH_POLICY_ID), reviewedCaseDigest: z.literal(CLOSED_DISPATCH_CASE_DIGEST),
  // Exact reviewed facts only: this deliberately cannot be used for another request or altered prices.
  reviewedCase: z.unknown().refine(value => {
    try { return digestJson(value) === CLOSED_DISPATCH_CASE_DIGEST; } catch { return false; }
  }, 'Historical facts differ from the independently reviewed inventory.'),
  checkpoint: z.strictObject({ eventSequence: integer, approvalRevision: integer.positive(), approvalDigest: hash,
    approvedTotalMicros: micros.refine(value => BigInt(value) > 0n && BigInt(value) <= 50_000_000n) }),
  preparedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).refine(value => {
  const start = Date.parse(value.preparedAt), end = Date.parse(value.expiresAt);
  return end > start && end - start <= 300_000;
}, 'Recovery review checkpoint is valid for at most five minutes.');
export type ClosedDispatchCoverage = z.infer<typeof ClosedDispatchCoverageSchema>;

export function closedDispatchMaximumCostMicros(): bigint {
  const c = closedDispatchCase();
  const perCall = BigInt(c.requestFeeMicros) + (BigInt(c.inputTokenCeiling) * BigInt(c.inputMicrosPerMillionTokens) +
    BigInt(c.outputTokenCeiling) * BigInt(c.outputMicrosPerMillionTokens) + 999_999n) / 1_000_000n;
  return perCall * BigInt(c.conservativeCallAllowance) + BigInt(c.additionalFeeMicros);
}

/** Offline preparation only. Require the authentic retained artifacts again, not copied hashes.
 * Config contains paths, not credential contents. Never read the referenced credential file.
 * No ledger, network, clock mutation, receipt invention or inference occurs here. */
export function prepareClosedDispatchCoverage(artifacts: {
  sourceLock: unknown; config: unknown; bundle: unknown; openDispatch: unknown; closure: unknown;
}, checkpoint: ClosedDispatchCoverage['checkpoint'], now: Date): ClosedDispatchCoverage {
  const c = closedDispatchCase();
  const bundle = z.record(z.string(), z.unknown()).parse(artifacts.bundle);
  const { bundleDigest, ...body } = bundle;
  if (bundleDigest !== c.bundleDigest || digestJson(body) !== c.bundleDigest ||
      digestJson(artifacts.sourceLock) !== c.sourceDigest || digestJson(artifacts.config) !== c.configDigest ||
      digestJson(artifacts.openDispatch) !== c.openDispatchDigest || digestJson(artifacts.closure) !== c.closureDigest) {
    throw new Error('Historical recovery artifacts do not match the reviewed case; retain all holds.');
  }
  return ClosedDispatchCoverageSchema.parse({ schemaVersion: '1.0', kind: 'historical-closed-dispatch-exposure-v1',
    policyId: CLOSED_DISPATCH_POLICY_ID, reviewedCaseDigest: CLOSED_DISPATCH_CASE_DIGEST, reviewedCase: c,
    checkpoint, preparedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString() });
}
