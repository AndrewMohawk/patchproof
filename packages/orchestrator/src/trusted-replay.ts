import { z } from 'zod';
import { digestJson } from '../../contracts/src/digest.ts';
import type { CheckRunner, ProductEvidence, SandboxCheckResult } from '../../contracts/src/product.ts';
import { BudgetLedger, usdToMicros } from './budget-ledger.ts';
import { reproduceEvidence, verifyEvidence } from './evidence.ts';
import { REPEATED_CHECK_PROTOCOL } from './repeated-checks.ts';
import { SmokeCpuProofSchema } from './trusted-smoke.ts';
import { NebiusSandboxCheckRunner, NebiusSandboxTransport, SandboxTransportError, SandboxVerificationSchema } from '../../../workers/sandbox/nebius.ts';
import type { SandboxTransportOptions } from '../../../workers/sandbox/nebius.ts';

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ReplayLimitsSchema = z.strictObject({
  wallTimeLimitSeconds: z.number().int().min(1).max(120),
  sandboxCpuSecondsLimit: z.number().finite().positive(),
  maxApprovedSpendUsd: z.number().finite().positive(),
});
export interface ReplayProgress {
  replayId: string; originalRunId: string; bundleDigest: string; reservationId: string;
  phase: 'prepared' | 'running' | 'terminal'; operationIds: string[];
  observedCpuSeconds: number; measuredCostUsd: null; billingComplete: false;
}
export class TrustedReplayError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const fail = (code: string): never => { throw new TrustedReplayError(`replay_${code}`); };
export interface TrustedReplayInput {
  replayId: string; bundle: ProductEvidence; sourceDigest: string;
  limits: z.infer<typeof ReplayLimitsSchema>;
  sandbox: SandboxTransportOptions; verification: z.infer<typeof SandboxVerificationSchema>;
  cpuProof: z.infer<typeof SmokeCpuProofSchema>; acceptedProofDigests: string[];
  ledger: BudgetLedger; verifyCurrent: () => string;
  saveProgress: (progress: ReplayProgress) => void;
  saveRawBatch: (batch: SandboxCheckResult) => void;
}

/** One explicitly funded replay of an existing selected patch. No inference, repair,
 * new selection, evaluator access, automatic retry or accounting completion occurs. */
export function createTrustedReplay(input: TrustedReplayInput) {
  const replayId = z.uuid().parse(input.replayId), bundle = verifyEvidence(structuredClone(input.bundle));
  const sourceDigest = digest.parse(input.sourceDigest), limits = ReplayLimitsSchema.parse(input.limits);
  const verification = SandboxVerificationSchema.parse(input.verification), cpuProof = SmokeCpuProofSchema.parse(input.cpuProof);
  const accepted = new Set(z.array(digest).min(2).max(20).parse(input.acceptedProofDigests));
  const sandbox = Object.freeze({ ...input.sandbox }), ledger = input.ledger;
  const verifyCurrent = input.verifyCurrent, saveProgress = input.saveProgress, saveRawBatch = input.saveRawBatch;
  if (!(ledger instanceof BudgetLedger) || [verifyCurrent, saveProgress, saveRawBatch, sandbox.fetch, sandbox.credential].some(fn => typeof fn !== 'function')) fail('trusted_dependencies_required');
  if (!sandbox.authorized || !accepted.has(digestJson(verification)) || !accepted.has(digestJson(cpuProof))) fail('accepted_controls_required');
  if (bundle.mode !== 'live' || bundle.fixture.split === 'final' || !bundle.run.selectedCandidateId) fail('selected_public_live_patch_required');
  const lock = bundle.runtimeLock as Record<string, unknown>;
  if (lock.mode !== 'live' || lock.scope !== 'trusted-smoke-only' || lock.sourceDigest !== sourceDigest ||
      lock.imageUuid !== verification.imageUuid || lock.imageDigest !== verification.immutableImageDigest ||
      digestJson(lock.checkProtocol) !== digestJson(REPEATED_CHECK_PROTOCOL)) fail('recorded_runtime_mismatch');
  if (sandbox.expectedProjectId !== undefined && sandbox.expectedProjectId !== verification.projectId) fail('project_mismatch');
  const caseCount = bundle.fixture.visibleCases.length + bundle.fixture.acceptanceCases.length;
  const maximumBatches = REPEATED_CHECK_PROTOCOL.repetitions, maximumOperations = maximumBatches * caseCount;
  if (!caseCount || caseCount > verification.limits.maxCases) fail('case_envelope');
  const selected = bundle.run.candidates.find(candidate => candidate.id === bundle.run.selectedCandidateId)!;
  const fileCount = Object.keys(selected.files).length;
  if (!fileCount || fileCount > 32 || Object.values(selected.files).reduce((sum, text) => sum + Buffer.byteLength(text), 0) > verification.limits.maxSourceBytes) fail('source_envelope');
  const quota = verification.equivalentControls.resourceCaps.cpuQuota;
  const guestTimeoutSeconds = Math.min(30, verification.limits.maxTimeoutSeconds,
    Math.floor((limits.sandboxCpuSecondsLimit / maximumOperations - cpuProof.overheadCpuSecondsPerOperation) / quota));
  if (guestTimeoutSeconds < 1) fail('cpu_envelope');
  const reservationMicros = usdToMicros(verification.billing.conservativeBatchChargeCeilingUsd, 'ceil') * BigInt(maximumBatches);
  if (reservationMicros > usdToMicros(limits.maxApprovedSpendUsd) || reservationMicros > BigInt(Number.MAX_SAFE_INTEGER)) fail('spend_envelope');
  const reservationId = `replay:${replayId}`;
  const envelope = Object.freeze({ maximumBatches, maximumOperations, maximumUploads: maximumBatches * fileCount, guestTimeoutSeconds,
    maximumCpuSeconds: maximumOperations * (quota * guestTimeoutSeconds + cpuProof.overheadCpuSecondsPerOperation),
    reservedMicros: String(reservationMicros), modelCalls: 0 });
  const fingerprint = digestJson({ replayId, bundleDigest: bundle.bundleDigest, sourceDigest, limits,
    verificationDigest: digestJson(verification), cpuProofDigest: digestJson(cpuProof), envelope });
  const progress: ReplayProgress = { replayId, originalRunId: bundle.run.id, bundleDigest: bundle.bundleDigest, reservationId,
    phase: 'prepared', operationIds: [], observedCpuSeconds: 0, measuredCostUsd: null, billingComplete: false };
  const current = () => {
    if (verifyCurrent() !== sourceDigest) fail('source_or_configuration_changed');
    const now = Date.now();
    if (Date.parse(verification.validUntil) <= now + limits.wallTimeLimitSeconds * 1000 + 10_000) fail('verification_window');
    for (const proof of [cpuProof, verification.account, verification.image, verification.billing, ...Object.values(verification.equivalentControls)]) {
      if (Date.parse(proof.verifiedAt) > now) fail('future_verification');
    }
  };
  current();
  const available = ledger.snapshot();
  if (available.frozen || BigInt(available.availableMicros) < reservationMicros || BigInt(available.stages.smoke.availableMicros) < reservationMicros) fail('budget_unavailable');
  let attempted = false, ended = false, batches = 0, instances = 0, uploads = 0;
  let execution: Promise<unknown> | null = null;
  const checkpoint = () => saveProgress(structuredClone(progress));
  const grant = (newWork: boolean) => {
    if (!attempted || (ended && newWork)) fail('dispatch_required');
    if (newWork) {
      current();
      const reservation = ledger.get(reservationId), state = ledger.snapshot();
      if (reservation?.state !== 'attempted' || !reservation.attemptedAt || reservation.fingerprint !== fingerprint ||
          state.freezeReasons.some(reason => reason !== 'billing_pending')) fail('dispatch_revoked');
    }
  };
  const rawFetch = sandbox.fetch!;
  const guardedFetch: typeof globalThis.fetch = async (url, options) => {
    const post = options?.method === 'POST';
    try { grant(post); }
    catch (error) { throw new SandboxTransportError(error instanceof TrustedReplayError ? error.code : 'replay_guard_failed'); }
    if (options?.signal?.aborted) throw new SandboxTransportError('cancelled');
    if (post && String(url).endsWith('/instances') && ++instances > maximumOperations) throw new SandboxTransportError('replay_operation_limit');
    if (post && String(url).endsWith('/files') && ++uploads > envelope.maximumUploads) throw new SandboxTransportError('replay_upload_limit');
    return rawFetch(url, options);
  };
  class ReplayTransport extends NebiusSandboxTransport {
    override spawnInvocation(request: Parameters<NebiusSandboxTransport['spawnInvocation']>[0], signal: AbortSignal) {
      return super.spawnInvocation({ ...request, timeoutSeconds: Math.min(request.timeoutSeconds, guestTimeoutSeconds) }, signal);
    }
  }
  const transport = new ReplayTransport({ ...sandbox, expectedProjectId: verification.projectId, fetch: guardedFetch,
    credential: async () => { grant(false); return sandbox.credential!(); } });
  const raw = new NebiusSandboxCheckRunner({ authorized: true, transport, verification,
    maxApprovedSpendUsd: Number(reservationMicros) / 1_000_000 });
  const runner: CheckRunner = { async run(request, signal) {
    grant(true);
    if (++batches > maximumBatches) fail('batch_limit');
    const result = await raw.run({ ...request, ownerRunId: replayId, onOperation: id => {
      if (!progress.operationIds.includes(id)) progress.operationIds.push(id);
      if (progress.operationIds.length > 1000) fail('operation_journal_limit');
      checkpoint();
    } }, signal);
    for (const id of result.operationIds) if (!progress.operationIds.includes(id)) progress.operationIds.push(id);
    if (result.cpuSeconds !== null) progress.observedCpuSeconds += result.cpuSeconds;
    if (progress.observedCpuSeconds > limits.sandboxCpuSecondsLimit) result.infrastructureError = 'replay_cpu_envelope_exceeded';
    // Preserve raw results independently, while retaining known usage even if its sink fails.
    try { saveRawBatch(structuredClone(result)); } finally { checkpoint(); }
    return result;
  } };
  return {
    envelope, reservationId, fingerprint, snapshot: () => structuredClone(progress),
    start(signal: AbortSignal) {
      if (execution || attempted) fail('already_started');
      signal.throwIfAborted(); current(); checkpoint();
      ledger.reserve({ id: reservationId, episodeId: reservationId, stage: 'smoke', amountMicros: reservationMicros, fingerprint });
      if (!ledger.markAttempted(reservationId).dispatchGranted) fail('already_attempted');
      attempted = true; progress.phase = 'running';
      const combined = AbortSignal.any([signal, AbortSignal.timeout(limits.wallTimeLimitSeconds * 1000)]);
      execution = (async () => {
        try {
          checkpoint();
          const result = await reproduceEvidence(bundle, runner, combined);
          combined.throwIfAborted(); current();
          return result;
        } finally {
          ended = true; progress.phase = 'terminal';
          ledger.reconcile({ id: reservationId, actualCostMicros: null, complete: false, evidenceDigest: digestJson(progress) });
          if (combined.aborted) ledger.cancel(reservationId);
          checkpoint();
        }
      })();
      return execution;
    },
    async settled() { if (execution) await execution.catch(() => {}); },
  };
}
