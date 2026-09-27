import { z } from 'zod';
import { FixtureSchema } from '../../contracts/src/product.ts';
import type { CheckRunner, Fixture, ProductRun } from '../../contracts/src/product.ts';
import { ContractError, LimitsSchema, VariantSchema } from '../../contracts/src/index.ts';
import { digestJson } from '../../contracts/src/digest.ts';
import { NebiusRepairProvider } from '../../../workers/repair/index.ts';
import type { NebiusRepairOptions } from '../../../workers/repair/index.ts';
import { NebiusSandboxCheckRunner, NebiusSandboxTransport, SandboxVerificationSchema, SandboxTransportError } from '../../../workers/sandbox/nebius.ts';
import type { SandboxVerification } from '../../../workers/sandbox/nebius.ts';
import type { SandboxTransportOptions } from '../../../workers/sandbox/nebius.ts';
import { BudgetLedger, usdToMicros } from './budget-ledger.ts';
import { Coordinator } from './coordinator.ts';
import { RepeatedCheckRunner, REPEATED_CHECK_PROTOCOL } from './repeated-checks.ts';
import type { RunJournal } from './journal.ts';
import type { EvidenceStore } from './evidence.ts';
import { validatePaths } from './fixtures.ts';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const proof = z.strictObject({ verifiedAt: z.iso.datetime(), evidenceRefs: z.array(z.string().min(1).max(300)).min(1).max(20) });
export const SmokeModelProofSchema = z.strictObject({
  ...proof.shape, validUntil: z.iso.datetime(), modelId: z.string().regex(/^nvidia\/[A-Za-z0-9._/-]+$/),
  licenseUrl: z.url(), modelCardUrl: z.url(), contextTokens: z.number().int().positive(),
  tokenizerDigest: hash, tokenizerModelId: z.string().min(1),
  conservativeInputCountIncludesTemplate: z.literal(true), outputCapCoversAllBilledTokens: z.literal(true),
  tokenRatesCoverAllRequestCharges: z.literal(true),
  tokenizerEvidenceRefs: z.array(z.string().min(1).max(300)).min(1), pricingEvidenceRefs: z.array(z.string().min(1).max(300)).min(1),
  requestBehaviorEvidenceRefs: z.array(z.string().min(1).max(300)).min(1),
});
export const SmokeSourceProofSchema = proof.extend({ digest: hash, fixtureDigest: hash });
export const SmokeCpuProofSchema = proof.extend({
  /** Verified maximum CPU outside quota × guest timeout, including startup/timer/burst overhead. */
  overheadCpuSecondsPerOperation: z.number().finite().nonnegative(),
  quotaBoundsAllGuestCpu: z.literal(true), timeoutBoundsGuestExecution: z.literal(true),
});
export interface TrustedSmokeInput {
  episodeId: string; fixture: Fixture; variant: z.infer<typeof VariantSchema>; limits: z.infer<typeof LimitsSchema>;
  model: Omit<NebiusRepairOptions, 'onOperation'>; modelProof: z.infer<typeof SmokeModelProofSchema>;
  sandbox: SandboxTransportOptions; sandboxVerification: SandboxVerification; cpuProof: z.infer<typeof SmokeCpuProofSchema>;
  sourceProof: z.infer<typeof SmokeSourceProofSchema>; verifySourceDigest: () => string;
  ledger: BudgetLedger; journal: RunJournal; store: EvidenceStore;
}
export interface TrustedSmokeSettings {
  episodeId: string; fixtureId: string; variant: z.infer<typeof VariantSchema>; limits: z.infer<typeof LimitsSchema>;
  maximumCheckBatchSeconds: number;
  beforeCreate: () => void;
  validateStep: () => void;
  bindEventSink: (sink: (message: string) => void) => void;
  terminal: (run: ProductRun) => void;
}
const capabilities = new WeakMap<object, TrustedSmokeSettings>();
/** Identity lookup only: there is no exported capability issuer or browser-controlled flag. */
export function resolveTrustedSmokeCapability(value: unknown): TrustedSmokeSettings | null {
  return value !== null && typeof value === 'object' ? capabilities.get(value) ?? null : null;
}
export class TrustedSmokeGateError extends ContractError {
  readonly gateCode: string;
  constructor(code: string) {
    const safe = /^[a-z_]{1,80}$/.test(code) ? code : 'invalid_gate_code';
    super('authorization_required', `trusted_smoke_${safe}`, 403);
    this.gateCode = `trusted_smoke_${safe}`;
  }
}
const fail = (code: string): never => { throw new TrustedSmokeGateError(code); };

/** Trusted control plane only. Construction validates envelopes but resolves no credentials. */
export function createTrustedSmokeEpisode(input: TrustedSmokeInput) {
  // Snapshot trusted dependencies before validation; later caller property changes cannot
  // replace the ledger, credentials, transport or source-verification binding mid-episode.
  const ledger = input.ledger, journal = input.journal, store = input.store;
  const model = Object.freeze({ ...input.model }), sandbox = Object.freeze({ ...input.sandbox });
  const verifySourceDigest = input.verifySourceDigest;
  const episodeId = z.uuid().parse(input.episodeId), variant = VariantSchema.parse(input.variant);
  const fixture = FixtureSchema.parse(structuredClone(input.fixture)), limits = LimitsSchema.parse(input.limits);
  const modelProof = SmokeModelProofSchema.parse(input.modelProof), sourceProof = SmokeSourceProofSchema.parse(input.sourceProof);
  const sandboxProof = SandboxVerificationSchema.parse(input.sandboxVerification), cpuProof = SmokeCpuProofSchema.parse(input.cpuProof);
  if (!(ledger instanceof BudgetLedger)) fail('durable_budget_required');
  if ([model.credential, model.fetch, model.countInputTokens, sandbox.credential, sandbox.fetch, verifySourceDigest].some(fn => typeof fn !== 'function')) fail('injected_runtime_required');
  if (fixture.split === 'final' || digestJson(fixture) !== sourceProof.fixtureDigest) fail('owned_public_fixture_required');
  validatePaths(fixture.files);
  if (!Object.hasOwn(fixture.files, fixture.entrypoint) || [...fixture.visibleCases, ...fixture.acceptanceCases].some(c => !/^[A-Za-z][A-Za-z0-9_]*$/.test(c.function))) fail('invalid_fixture_invocation');
  if (!model.authorized || !sandbox.authorized) fail('authorization_required');
  if (sandbox.expectedProjectId !== undefined && sandbox.expectedProjectId !== sandboxProof.projectId) fail('project_mismatch');
  if (limits.inferenceCallLimit > 3 || limits.inferenceCallLimit < 1) fail('smoke_call_limit');
  if (model.modelId !== modelProof.modelId || modelProof.tokenizerModelId !== modelProof.modelId) fail('model_tokenizer_mismatch');
  if (limits.inputTokenLimit + limits.outputTokenLimit > modelProof.contextTokens) fail('context_envelope_exceeded');
  if (![model.inputUsdPerMillionTokens, model.outputUsdPerMillionTokens].every(rate => Number.isFinite(rate) && rate >= 0)) fail('pricing_unknown');
  if (typeof model.countInputTokens !== 'function') fail('token_counter_required');
  const caseCount = fixture.visibleCases.length + fixture.acceptanceCases.length;
  if (caseCount < 1 || caseCount > sandboxProof.limits.maxCases || Object.keys(fixture.files).length > 32 ||
      Object.values(fixture.files).reduce((total, source) => total + Buffer.byteLength(source), 0) > sandboxProof.limits.maxSourceBytes) fail('fixture_exceeds_verified_controls');
  const maximumBatches = 8; // two repetitions × (original + at most three candidates), shared across variants.
  const maximumGuestOperations = maximumBatches * caseCount;
  const quota = sandboxProof.equivalentControls.resourceCaps.cpuQuota;
  const guestTimeoutSeconds = Math.min(900, Math.floor((limits.sandboxCpuSecondsLimit / maximumGuestOperations - cpuProof.overheadCpuSecondsPerOperation) / quota));
  if (!Number.isSafeInteger(guestTimeoutSeconds) || guestTimeoutSeconds < 1) fail('cpu_envelope_unavailable');
  const maximumCpuSeconds = maximumGuestOperations * (quota * guestTimeoutSeconds + cpuProof.overheadCpuSecondsPerOperation);
  if (!Number.isFinite(maximumCpuSeconds) || maximumCpuSeconds > limits.sandboxCpuSecondsLimit) fail('cpu_envelope_exceeded');
  // Round each quoted USD-per-million rate upward to a microdollar before exact integer
  // multiplication/division; floating products must never shave a reservation boundary.
  const ceilingDivide = (value: bigint, denominator: bigint) => (value + denominator - 1n) / denominator;
  const modelCeilingMicros = ceilingDivide(BigInt(limits.inputTokenLimit) * usdToMicros(model.inputUsdPerMillionTokens, 'ceil') +
    BigInt(limits.outputTokenLimit) * usdToMicros(model.outputUsdPerMillionTokens, 'ceil'), 1_000_000n);
  const sandboxCeilingMicros = usdToMicros(sandboxProof.billing.conservativeBatchChargeCeilingUsd, 'ceil') * BigInt(maximumBatches);
  const reserveMicros = modelCeilingMicros + sandboxCeilingMicros;
  if (reserveMicros > BigInt(Number.MAX_SAFE_INTEGER)) fail('unsupported_reservation_size');
  if (reserveMicros > usdToMicros(limits.maxApprovedSpendUsd)) fail('episode_ceiling_exceeds_allowance');
  const envelope = { protocol: 'trusted-smoke-v1' as const, calibratedExperiment: false as const, maximumProposals: 3,
    maximumBatches, maximumGuestOperations, guestTimeoutSeconds, maximumCpuSeconds,
    modelCostCeilingMicros: String(modelCeilingMicros), sandboxCostCeilingMicros: String(sandboxCeilingMicros), reservedMicros: String(reserveMicros), measuredCostUsd: null };
  const validateCurrent = () => {
    const now = Date.now(), end = now + limits.wallTimeLimitSeconds * 1000 + 10_000;
    let currentSource: string;
    try { currentSource = verifySourceDigest(); } catch { return fail('source_verification_failed'); }
    if (currentSource !== sourceProof.digest) fail('source_changed');
    if (!Number.isFinite(Date.parse(model.accountVerifiedAt)) || Date.parse(model.accountVerifiedAt) > now ||
        Date.parse(modelProof.validUntil) <= end || Date.parse(sandboxProof.validUntil) <= end) fail('verification_window');
    for (const item of [modelProof, sourceProof, cpuProof, sandboxProof.account, sandboxProof.image, sandboxProof.billing, ...Object.values(sandboxProof.equivalentControls)]) {
      if (Date.parse(item.verifiedAt) > now) fail('future_verification');
    }
  };
  validateCurrent();
  const before = ledger.snapshot();
  if (before.frozen || BigInt(before.availableMicros) < reserveMicros || BigInt(before.stages.smoke.availableMicros) < reserveMicros) fail('budget_unavailable');
  const runtimeLock = { mode: 'live', scope: 'trusted-smoke-only', calibratedExperiment: false, sourceDigest: sourceProof.digest,
    modelId: modelProof.modelId, inputUsdPerMillionTokens: model.inputUsdPerMillionTokens, outputUsdPerMillionTokens: model.outputUsdPerMillionTokens, modelProofDigest: digestJson(modelProof), tokenizerDigest: modelProof.tokenizerDigest,
    sandboxVerificationDigest: digestJson(sandboxProof), imageUuid: sandboxProof.imageUuid, imageDigest: sandboxProof.immutableImageDigest,
    cpuProofDigest: digestJson(cpuProof), envelope, checkProtocol: REPEATED_CHECK_PROTOCOL, repairPolicy: 'immutable-branches-visible-baseline-v1' };
  const fingerprint = digestJson({ episodeId, fixtureDigest: sourceProof.fixtureDigest, variant, limits, runtimeLock });
  const reservationId = `smoke:${episodeId}`;
  let granted = false, ended = false, eventSink: ((message: string) => void) | null = null;
  let guestOperations = 0, uploads = 0, modelRequests = 0;
  const requireGrant = (newWork: boolean) => {
    if (!granted || (newWork && ended)) fail('dispatch_grant_required');
    if (newWork) {
      validateCurrent();
      const state = ledger.snapshot();
      const reasons = state.freezeReasons.filter(reason => reason !== 'billing_pending');
      if (reasons.length) {
        const known = new Set(['approval_missing', 'approval_not_yet_valid', 'approval_expired', 'approval_changed', 'approved_cap_below_commitment', 'reservation_overrun', 'charge_without_recorded_dispatch']);
        fail(known.has(reasons[0]!) ? reasons[0]! : 'budget_frozen');
      }
    }
  };
  let sandboxGateFailure: string | null = null;
  const sandboxFetch: typeof globalThis.fetch = async (url, options) => {
    const post = options?.method === 'POST';
    try { requireGrant(post); }
    catch (error) {
      if (!(error instanceof TrustedSmokeGateError)) throw error;
      sandboxGateFailure = error.gateCode;
      throw new SandboxTransportError(error.gateCode);
    }
    if (options?.signal?.aborted) fail('cancelled');
    if (post && String(url).endsWith('/instances') && ++guestOperations > maximumGuestOperations) fail('sandbox_operation_limit');
    if (post && String(url).endsWith('/files') && ++uploads > maximumBatches * Object.keys(fixture.files).length) fail('upload_limit');
    return sandbox.fetch(url, options);
  };
  class CappedTransport extends NebiusSandboxTransport {
    override spawnInvocation(request: Parameters<NebiusSandboxTransport['spawnInvocation']>[0], signal: AbortSignal) {
      return super.spawnInvocation({ ...request, timeoutSeconds: Math.min(request.timeoutSeconds, guestTimeoutSeconds) }, signal);
    }
  }
  const transport = new CappedTransport({ ...sandbox, expectedProjectId: sandboxProof.projectId, fetch: sandboxFetch,
    credential: async () => { requireGrant(false); return sandbox.credential(); } });
  const rawChecks = new NebiusSandboxCheckRunner({ transport, verification: sandboxProof, authorized: true,
    maxApprovedSpendUsd: Number(sandboxCeilingMicros) / 1_000_000 });
  let batches = 0, knownCpuSeconds = 0;
  const boundedChecks: CheckRunner = { async run(request, signal) {
    try { requireGrant(true); }
    catch (error) {
      if (!(error instanceof TrustedSmokeGateError)) throw error;
      return { checks: request.cases.map(c => ({ id: c.id, requirementId: c.requirementId, status: 'error', message: error.gateCode,
        actual: null, expected: c.expectedException ? { exception: c.expectedException } : c.expected, durationMs: 0, log: error.gateCode })),
        isolation: 'unavailable', operationIds: [], cpuSeconds: 0, measuredCostUsd: null, infrastructureError: error.gateCode };
    }
    if (++batches > maximumBatches) fail('check_batch_limit');
    sandboxGateFailure = null;
    const result = await rawChecks.run(request, signal);
    // Preserve the safe blocker separately from transport cleanup detail in check logs.
    if (sandboxGateFailure) result.infrastructureError = sandboxGateFailure;
    if (result.cpuSeconds !== null) knownCpuSeconds += result.cpuSeconds;
    if (knownCpuSeconds > limits.sandboxCpuSecondsLimit) result.infrastructureError = 'sandbox_cpu_budget_exceeded';
    return result;
  } };
  const checks = new RepeatedCheckRunner(boundedChecks);
  const provider = new NebiusRepairProvider({ ...model,
    credential: async () => { requireGrant(true); return model.credential(); },
    fetch: async (url, options) => {
      requireGrant(true); if (options?.signal?.aborted) fail('cancelled');
      if (++modelRequests > limits.inferenceCallLimit) fail('model_call_limit');
      return model.fetch(url, options);
    },
    onOperation: operation => {
      requireGrant(operation.kind === 'request_intent');
      if (!eventSink) fail('event_sink_missing');
      eventSink!(`Nebius model ${operation.kind}: ${operation.id}. Billing remains unreconciled.`);
    },
  });
  const capability = Object.freeze({});
  capabilities.set(capability, {
    episodeId, fixtureId: fixture.id, variant, limits: Object.freeze({ ...limits }), maximumCheckBatchSeconds: Math.min(30, sandboxProof.limits.maxTimeoutSeconds),
    beforeCreate: () => {
      validateCurrent();
      ledger.reserve({ id: reservationId, episodeId, stage: 'smoke', amountMicros: reserveMicros, fingerprint });
      const attempt = ledger.markAttempted(reservationId);
      if (!attempt.dispatchGranted) fail('dispatch_already_attempted');
      granted = true;
    },
    validateStep: () => requireGrant(true),
    bindEventSink: sink => { eventSink = sink; },
    terminal: run => {
      ended = true;
      ledger.reconcile({ id: reservationId, actualCostMicros: null, complete: false,
        evidenceDigest: digestJson({ runId: run.id, status: run.terminalStatus, usage: run.usage, events: run.events, operations: run.sandboxOperationIds }) });
      if (run.reason === 'cancelled' || run.reason === 'timeout' || run.terminalStatus === 'infrastructure_error') ledger.cancel(reservationId);
    },
  });
  const coordinator = new Coordinator({ fixtures: [fixture], runtimeLock, provider, checks, journal: journal, store: store,
    trustedSmokeCapability: capability, verifyRuntime: validateCurrent });
  return {
    coordinator, envelope, reservationId,
    start: (signal?: AbortSignal) => {
      if (signal?.aborted) fail('cancelled');
      const result = coordinator.create({ taskId: fixture.id, variant, mode: 'live', idempotencyKey: `smoke-${episodeId}` });
      if (signal) {
        const abort = () => coordinator.cancel(result.run.id);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        void coordinator.settled().finally(() => signal.removeEventListener('abort', abort));
      }
      return result;
    },
    settled: async () => { await coordinator.settled(); return coordinator.get(episodeId); },
    cancel: () => coordinator.cancel(episodeId), close: () => coordinator.close(),
    accounting: () => ledger.get(reservationId),
  };
}
