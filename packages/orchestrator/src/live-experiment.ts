import { z } from 'zod';
import { DigestSchema } from '../../contracts/src/index.ts';
import type { RepairProvider, SandboxCheckResult } from '../../contracts/src/product.ts';
import { digestJson } from '../../contracts/src/digest.ts';
import type { ExecutionInput } from '../../../workers/evaluator/dispatcher.ts';
import { hashJson } from '../../../workers/evaluator/protocol.ts';
import { NebiusRepairProvider } from '../../../workers/repair/index.ts';
import type { NebiusRepairOptions } from '../../../workers/repair/index.ts';
import { NebiusSandboxCheckRunner, NebiusSandboxTransport, SandboxVerificationSchema } from '../../../workers/sandbox/nebius.ts';
import type { SandboxTransportOptions, SandboxVerification } from '../../../workers/sandbox/nebius.ts';
import { withAbort } from '../../../workers/sandbox/nebius-types.ts';
import { BudgetLedger, usdToMicros } from './budget-ledger.ts';
import { SmokeCpuProofSchema, SmokeModelProofSchema } from './trusted-smoke.ts';
import { createExperimentExecutorCore, ExperimentRuntimeGateError } from './experiment-executor-core.ts';
import type { ExperimentTraceStore } from './experiment-trace-store.ts';
import { buildLiveExperimentModelLock, buildLiveExperimentPolicy, LiveExperimentAcceptanceSchema } from './live-experiment-policy.ts';
import type { LiveExperimentSettingsSchema } from './live-experiment-policy.ts';
import type { PhaseAccountingObserver, PhaseAccountingRequest } from './phase-accounting.ts';

export interface ReservationProjection {
  reservationFingerprint: string; stage: 'pilot' | 'evaluate'; amountMicros: string; dispatchId: string; publicInputDigest: string;
}
export interface LiveExperimentOptions {
  settings: z.infer<typeof LiveExperimentSettingsSchema>; acceptance: z.infer<typeof LiveExperimentAcceptanceSchema>;
  acceptedProofDigests: string[]; planDigest: string; traceStore: ExperimentTraceStore; ledger: BudgetLedger;
  model: Omit<NebiusRepairOptions, 'onOperation' | 'countInputTokens'>; modelProof: z.infer<typeof SmokeModelProofSchema>;
  tokenizer: { digest: string; countInputTokens: NebiusRepairOptions['countInputTokens']; verifyCurrent: () => void };
  sandbox: SandboxTransportOptions; sandboxVerification: SandboxVerification; cpuProof: z.infer<typeof SmokeCpuProofSchema>;
  verifySourceDigest: () => string; reservationForExecution: (input: Omit<ExecutionInput, 'checkpoint'>) => ReservationProjection;
  accountingObserver: PhaseAccountingObserver;
  loadFixtureBytes: (taskId: string, signal: AbortSignal) => Promise<string | Uint8Array>;
}
const projectionSchema = z.strictObject({ reservationFingerprint: DigestSchema, stage: z.enum(['pilot', 'evaluate']),
  amountMicros: z.string().regex(/^[1-9][0-9]*$/), dispatchId: z.uuid(), publicInputDigest: DigestSchema });
const observationSchema = z.strictObject({ receiptDigest: DigestSchema.nullable(), checkpointDigest: DigestSchema.nullable(),
  measuredCostUsd: z.number().finite().nonnegative().nullable(), sandboxCpuSeconds: z.number().finite().nonnegative().nullable(),
  billingComplete: z.boolean(), cpuComplete: z.boolean(), inventoryComplete: z.boolean(), cleanupComplete: z.boolean(), retentionFinal: z.boolean(),
  coveredOperationIds: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/)).max(1000) });
const failure = (reason: ConstructorParameters<typeof ExperimentRuntimeGateError>[0]): never => { throw new ExperimentRuntimeGateError(reason); };

/** Separate trusted issuer: owns no budget grant, discovery, adjudicator, account intake or CLI. */
export function createLiveExperimentExecutor(options: LiveExperimentOptions) {
  const constructedAt = Date.now(), seen = new Set<string>(), ledger = options.ledger;
  const pending = new Set<Promise<unknown>>();
  const owned = <T>(promise: Promise<T>): Promise<T> => {
    pending.add(promise);
    void promise.finally(() => { pending.delete(promise); }).catch(() => {});
    return promise;
  };
  const model = Object.freeze({ ...options.model }), sandbox = Object.freeze({ ...options.sandbox }), tokenizer = Object.freeze({ ...options.tokenizer });
  const source = options.verifySourceDigest, projectReservation = options.reservationForExecution, observeAccounting = options.accountingObserver;
  const acceptance = LiveExperimentAcceptanceSchema.parse(options.acceptance), policy = buildLiveExperimentPolicy(options.settings);
  if (policy.settings.adjudicationReserve.wallSeconds < policy.settings.accountingTimeoutSeconds + policy.settings.cleanupTimeoutSeconds + 1) failure('resource_limit');
  const proof = SmokeModelProofSchema.parse(options.modelProof), controls = SandboxVerificationSchema.parse(options.sandboxVerification), cpu = SmokeCpuProofSchema.parse(options.cpuProof);
  const planDigest = DigestSchema.parse(options.planDigest), policyDigest = hashJson(policy), acceptedDigests = z.array(DigestSchema).min(1).max(100).parse(options.acceptedProofDigests);
  const modelLock = buildLiveExperimentModelLock({ proof, accountVerifiedAt: model.accountVerifiedAt,
    inputUsdPerMillionTokens: model.inputUsdPerMillionTokens, outputUsdPerMillionTokens: model.outputUsdPerMillionTokens });
  const modelLockDigest = digestJson(modelLock);
  if (!(ledger instanceof BudgetLedger) || [source, projectReservation, observeAccounting, model.credential, model.fetch,
    sandbox.credential, sandbox.fetch, tokenizer.countInputTokens, tokenizer.verifyCurrent].some(fn => typeof fn !== 'function')) failure('runtime_binding_changed');
  if (!acceptedDigests.includes(digestJson(acceptance)) || acceptance.policyDigest !== policyDigest || acceptance.modelLockDigest !== modelLockDigest ||
      acceptance.sandboxVerificationDigest !== digestJson(controls) || acceptance.cpuProofDigest !== digestJson(cpu)) failure('account_verification_failed');
  if (!model.authorized || !sandbox.authorized || model.modelId !== proof.modelId || proof.tokenizerModelId !== model.modelId ||
      tokenizer.digest !== proof.tokenizerDigest || sandbox.expectedProjectId !== controls.projectId ||
      !Number.isFinite(Date.parse(model.accountVerifiedAt)) || [model.inputUsdPerMillionTokens, model.outputUsdPerMillionTokens].some(n => !Number.isFinite(n) || n < 0) ||
      policy.settings.maxOutputTokensPerCall >= proof.contextTokens) failure('account_verification_failed');
  const verifyCurrent = (windowMs = 0) => {
    const now = Date.now(), end = now + windowMs;
    let current: string;
    try { current = source(); } catch { return failure('source_changed'); }
    if (current !== acceptance.sourceDigest) failure('source_changed');
    try { tokenizer.verifyCurrent(); } catch { return failure('account_verification_failed'); }
    if (Date.parse(model.accountVerifiedAt) > now || [acceptance, proof, controls].some(record => Date.parse(record.validUntil) <= end) ||
        [acceptance, proof, cpu, controls.account, controls.image, controls.billing, ...Object.values(controls.equivalentControls)].some(record => Date.parse(record.verifiedAt) > now)) failure('account_verification_failed');
  };
  verifyCurrent(910_000);
  const verifyGrant = (input: Omit<ExecutionInput, 'checkpoint'>, newWork: boolean): ReservationProjection => {
    let projected: ReservationProjection;
    try { projected = projectionSchema.parse(projectReservation(structuredClone(input))); } catch { return failure('runtime_binding_changed'); }
    if (projected.dispatchId !== input.dispatchId || projected.publicInputDigest !== digestJson(input) ||
        projected.amountMicros !== String(usdToMicros(input.limits.maxApprovedSpendUsd))) failure('runtime_binding_changed');
    let reservation: ReturnType<BudgetLedger['get']>;
    try { reservation = ledger.get(input.dispatchId); } catch { return failure('runtime_binding_changed'); }
    if (reservation.id !== input.dispatchId || reservation.episodeId !== input.dispatchId || reservation.fingerprint !== projected.reservationFingerprint ||
        reservation.reservedMicros !== projected.amountMicros || reservation.stage !== projected.stage || !reservation.attemptedAt ||
        Date.parse(reservation.attemptedAt) < constructedAt || Date.parse(reservation.attemptedAt) > Date.now() ||
        (newWork ? reservation.state !== 'attempted' : !['attempted', 'cancelled'].includes(reservation.state))) failure('runtime_binding_changed');
    if (newWork) {
      verifyCurrent();
      const snapshot = ledger.snapshot();
      if (snapshot.freezeReasons.some(reason => reason !== 'billing_pending') || snapshot.pendingBillingCount > 1) failure('resource_limit');
    }
    return projected;
  };
  const result = createExperimentExecutorCore({ executionMode: 'live', policy, modelLockDigest, planDigest, traceStore: options.traceStore,
    loadFixtureBytes: options.loadFixtureBytes, verifyBindings: verifyCurrent,
    verifyExecution: input => {
      if (seen.has(input.dispatchId)) failure('runtime_binding_changed');
      verifyCurrent(910_000);
      verifyGrant(input, true); seen.add(input.dispatchId);
    },
    createRuntime: (context, limits) => {
      const { input, fixture, operation, trace } = context, settings = policy.settings;
      const projection = verifyGrant(input, true);
      const caseCount = fixture.visibleCases.length + fixture.acceptanceCases.length;
      const fileCount = new Set([...Object.keys(fixture.files), ...fixture.editAllowlist]).size;
      if (caseCount < 1 || caseCount > controls.limits.maxCases || fileCount < 1 || fileCount > 32 ||
          48 * (2 * fileCount + 2 * caseCount) + 48 > 1000 || Object.values(fixture.files).reduce((n, text) => n + Buffer.byteLength(text), 0) > controls.limits.maxSourceBytes) failure('resource_limit');
      const maximumGuestOperations = 48 * caseCount, quota = controls.equivalentControls.resourceCaps.cpuQuota;
      const guestSeconds = Math.min(controls.limits.maxTimeoutSeconds, settings.maxCheckBatchSeconds,
        Math.floor((limits.sandboxCpuSecondsLimit / maximumGuestOperations - cpu.overheadCpuSecondsPerOperation) / quota));
      const maximumCpuSeconds = maximumGuestOperations * (quota * guestSeconds + cpu.overheadCpuSecondsPerOperation);
      const reserve = settings.adjudicationReserve, adjudication = settings.adjudicationBounds;
      const maximumRuntimeWallSeconds = 24 * settings.maxModelCallSeconds + 48 * settings.maxCheckBatchSeconds +
        settings.accountingTimeoutSeconds + settings.cleanupTimeoutSeconds + settings.hostOverheadSeconds;
      if (guestSeconds < 1 || maximumCpuSeconds > limits.sandboxCpuSecondsLimit || maximumRuntimeWallSeconds > limits.wallTimeLimitSeconds ||
          settings.maxCheckBatchSeconds > controls.limits.maxTimeoutSeconds || reserve.cpuSeconds < reserve.wallSeconds * adjudication.maxConcurrentCpuUnits ||
          reserve.spendUsd < adjudication.fixedCostUsd + reserve.wallSeconds * adjudication.maxCostUsdPerSecond) failure('resource_limit');
      const divideUp = (value: bigint) => (value + 999_999n) / 1_000_000n;
      const modelMicros = divideUp(BigInt(input.limits.inputTokenLimit) * usdToMicros(model.inputUsdPerMillionTokens, 'ceil') +
        BigInt(input.limits.outputTokenLimit) * usdToMicros(model.outputUsdPerMillionTokens, 'ceil'));
      const checkMicros = 48n * usdToMicros(controls.billing.conservativeBatchChargeCeilingUsd, 'ceil');
      if (modelMicros + checkMicros > usdToMicros(limits.maxApprovedSpendUsd) ||
          modelMicros + checkMicros + usdToMicros(reserve.spendUsd) > BigInt(projection.amountMicros)) failure('resource_limit');
      trace({ kind: 'live-prospective-envelope', acceptedProofDigest: digestJson(acceptance), modelLock, sourceDigest: acceptance.sourceDigest,
        maximumProposals: 24, maximumRawBatches: 48, originalSourceBatches: 0, maximumGuestOperations, guestTimeoutSeconds: guestSeconds,
        maximumCpuSeconds, maximumRuntimeWallSeconds, modelCeilingMicros: String(modelMicros), sandboxCeilingMicros: String(checkMicros),
        adjudicationReserve: reserve, reservationId: input.dispatchId, reservationFingerprint: projection.reservationFingerprint,
        measuredCostUsd: null, calibratedFactsExternallyAttested: true });
      let ended = false, modelCalls = 0, batchCalls = 0, instances = 0, uploads = 0;
      let sandboxGate: ExperimentRuntimeGateError | null = null;
      const gate = (newWork: boolean) => {
        if (newWork && ended) failure('runtime_binding_changed');
        if (newWork) context.signal.throwIfAborted();
        return verifyGrant(input, newWork);
      };
      const sandboxGateCall = (newWork: boolean) => {
        try { return gate(newWork); } catch (error) { if (error instanceof ExperimentRuntimeGateError) sandboxGate = error; throw error; }
      };
      class CappedTransport extends NebiusSandboxTransport {
        override spawnInvocation(request: Parameters<NebiusSandboxTransport['spawnInvocation']>[0], signal: AbortSignal) {
          return super.spawnInvocation({ ...request, timeoutSeconds: Math.min(request.timeoutSeconds, guestSeconds) }, signal);
        }
      }
      const transport = new CappedTransport({ ...sandbox, credential: async () => { sandboxGateCall(false); return sandbox.credential(); },
        fetch: async (url, request) => {
          const post = request?.method === 'POST'; sandboxGateCall(post);
          if (request?.signal?.aborted) failure('runtime_binding_changed');
          if (post && String(url).endsWith('/instances') && ++instances > maximumGuestOperations ||
              post && String(url).endsWith('/files') && ++uploads > 48 * fileCount) failure('resource_limit');
          return sandbox.fetch(url, request);
        } });
      const checker = new NebiusSandboxCheckRunner({ transport, verification: controls, authorized: true,
        maxApprovedSpendUsd: Number(checkMicros) / 1_000_000, cleanupTimeoutMs: settings.cleanupTimeoutSeconds * 1000 });
      const repair = new NebiusRepairProvider({ ...model,
        countInputTokens: messages => {
          gate(true); const tokens = tokenizer.countInputTokens(messages);
          if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens + settings.maxOutputTokensPerCall > proof.contextTokens) failure('resource_limit');
          return tokens;
        }, credential: async () => { gate(true); return model.credential(); },
        fetch: async (url, request) => { gate(true); if (request?.signal?.aborted || ++modelCalls > 24) failure('resource_limit'); return model.fetch(url, request); },
        onOperation: event => { gate(event.kind === 'request_intent'); operation(event.kind === 'request_intent' ? `nebius:model-intent:${event.id}` : event.id); },
      });
      const provider: RepairProvider = { mode: 'live', propose: (request, signal) => owned(repair.propose({ ...request,
        remaining: { ...request.remaining, wallTimeLimitSeconds: Math.min(settings.maxModelCallSeconds, request.remaining.wallTimeLimitSeconds) } }, signal)) };
      return { provider, batchSeconds: settings.maxCheckBatchSeconds, verify: () => { gate(true); },
        checks: { run: async (request, signal) => {
          gate(true); if (++batchCalls > 48) failure('resource_limit'); sandboxGate = null;
          const checked: SandboxCheckResult = await owned(checker.run(request, signal));
          if (sandboxGate) { const error = sandboxGate as ExperimentRuntimeGateError;
            Object.assign(error, { operationIds: checked.operationIds, usage: { cpuSeconds: checked.cpuSeconds, measuredCostUsd: checked.measuredCostUsd } }); throw error; }
          return checked;
        } },
        finalizeAccounting: async (value, signal) => {
          gate(true); ended = true;
          const binding: PhaseAccountingRequest['binding'] = { executionMode: 'live', phase: 'runtime', dispatchId: input.dispatchId, episodeId: input.episodeId,
            reservationId: input.dispatchId, reservationFingerprint: projection.reservationFingerprint, stage: projection.stage, reservedMicros: projection.amountMicros,
            sourceDigest: acceptance.sourceDigest, planDigest, modelLockDigest, policyDigest };
          const checkpointDigest = digestJson({ binding, usage: value.usage, operationIds: value.operationIds });
          const request: PhaseAccountingRequest = { binding, checkpointDigest, operationIds: [...value.operationIds],
            observedCpuLowerBound: value.usage.sandboxCpuSeconds, observedCostLowerBoundUsd: value.usage.measuredCostUsd };
          trace({ kind: 'runtime-accounting-request', request });
          const bounded = AbortSignal.any([signal, AbortSignal.timeout(settings.accountingTimeoutSeconds * 1000)]);
          let observed: Awaited<ReturnType<PhaseAccountingObserver>>;
          try { observed = observationSchema.parse(await withAbort(observeAccounting(request, bounded), bounded)); }
          catch { return failure('billing_incomplete'); }
          signal.throwIfAborted();
          verifyGrant(input, true);
          if (observed.checkpointDigest !== checkpointDigest || observed.receiptDigest === null &&
              (observed.measuredCostUsd !== null || observed.sandboxCpuSeconds !== null)) failure('billing_incomplete');
          if (!observed.cpuComplete || !observed.retentionFinal) {
            return { ...observed, billingComplete: false, inventoryComplete: false, cleanupComplete: false };
          }
          return observed;
        },
      };
    },
  });
  return { ...result, execute: (...args: Parameters<typeof result.execute>) => owned(result.execute(...args)),
    // A caller's abort race can finish before owned adapters complete bounded cleanup.
    // Keep their shared ledger/journals open until this drain resolves.
    settled: async () => { while (pending.size) await Promise.allSettled([...pending]); },
    adjudicationBounds: structuredClone(policy.settings.adjudicationBounds) };
}
