import { z } from 'zod';
import { digestJson } from '../../packages/contracts/src/digest.ts';
import type { CheckRunner, SandboxCheckResult } from '../../packages/contracts/src/product.ts';
import { BudgetLedger, usdToMicros } from '../../packages/orchestrator/src/budget-ledger.ts';
import { SmokeCpuProofSchema } from '../../packages/orchestrator/src/trusted-smoke.ts';
import { NebiusSandboxCheckRunner, NebiusSandboxTransport, SandboxVerificationSchema } from '../sandbox/nebius.ts';
import type { SandboxTransportOptions, SandboxVerification } from '../sandbox/nebius.ts';
import type { AdjudicationInput } from './dispatcher.ts';

export interface AdjudicationReservation {
  dispatchId: string; reservationFingerprint: string; stage: 'pilot' | 'evaluate'; amountMicros: string;
}
export interface NebiusAdjudicationOptions {
  input: AdjudicationInput; reservation: AdjudicationReservation; ledger: BudgetLedger;
  sourceDigest: string; verifySourceDigest: () => string; sandbox: SandboxTransportOptions;
  sandboxVerification: SandboxVerification; cpuProof: z.infer<typeof SmokeCpuProofSchema>;
  accountingTimeoutSeconds: number; cleanupTimeoutSeconds: number;
  saveRawResult: (result: SandboxCheckResult) => void;
}
const fail = (): never => { throw new Error('adjudication_control_rejected'); };

/** One protected checker batch, using only the dispatcher's existing attempt and remaining resources. */
export function createNebiusAdjudicationChecks(options: NebiusAdjudicationOptions): CheckRunner {
  const ledger = options.ledger, input = { ...options.input, files: structuredClone(options.input.files) },
    reservation = { ...options.reservation }, sandbox = { ...options.sandbox }, source = options.verifySourceDigest;
  const expectedSource = options.sourceDigest, proof = SandboxVerificationSchema.parse(options.sandboxVerification), cpu = SmokeCpuProofSchema.parse(options.cpuProof);
  const saveRawResult = options.saveRawResult;
  const accountingSeconds = z.number().int().min(1).max(30).parse(options.accountingTimeoutSeconds);
  const cleanupSeconds = z.number().int().min(1).max(10).parse(options.cleanupTimeoutSeconds);
  if (!(ledger instanceof BudgetLedger) || !input.selectionFinalized || input.episodeId !== reservation.dispatchId ||
      input.ownerRunId !== reservation.dispatchId || !sandbox.authorized || sandbox.expectedProjectId !== proof.projectId ||
      [source, sandbox.credential, sandbox.fetch, saveRawResult].some(fn => typeof fn !== 'function')) fail();
  const checkSeconds = Math.min(proof.limits.maxTimeoutSeconds, Math.floor(input.timeoutSeconds - accountingSeconds - cleanupSeconds));
  if (checkSeconds < 1 || proof.billing.conservativeBatchChargeCeilingUsd > input.maxApprovedSpendUsd) fail();
  let invoked = false, ended = false;
  const guard = (newWork: boolean) => {
    const state = ledger.get(reservation.dispatchId);
    if (state.episodeId !== reservation.dispatchId || state.fingerprint !== reservation.reservationFingerprint || state.stage !== reservation.stage ||
        state.reservedMicros !== reservation.amountMicros || !state.attemptedAt ||
        (newWork ? state.state !== 'attempted' : !['attempted', 'cancelled'].includes(state.state))) fail();
    if (newWork) {
      if (ended || source() !== expectedSource || Date.parse(proof.validUntil) <= Date.now() + (checkSeconds + cleanupSeconds + accountingSeconds) * 1000 ||
          [cpu, proof.account, proof.image, proof.billing, ...Object.values(proof.equivalentControls)].some(value => Date.parse(value.verifiedAt) > Date.now())) fail();
      const budget = ledger.snapshot();
      if (budget.freezeReasons.some(reason => reason !== 'billing_pending') || budget.pendingBillingCount > 1) fail();
    }
  };
  guard(true);
  return { run: async (request, signal) => {
    if (invoked) fail(); invoked = true; guard(true); signal.throwIfAborted();
    if (request.ownerRunId !== reservation.dispatchId || digestJson(request.files) !== digestJson(input.files) ||
        request.cases.length < 1 || request.cases.length > proof.limits.maxCases || Object.keys(request.files).length > 32 ||
        Object.values(request.files).reduce((sum, text) => sum + Buffer.byteLength(text), 0) > proof.limits.maxSourceBytes) fail();
    const quota = proof.equivalentControls.resourceCaps.cpuQuota, count = request.cases.length;
    const guestSeconds = Math.min(checkSeconds, proof.limits.maxTimeoutSeconds,
      Math.floor((input.sandboxCpuSecondsLimit / count - cpu.overheadCpuSecondsPerOperation) / quota));
    if (guestSeconds < 1 || count * (quota * guestSeconds + cpu.overheadCpuSecondsPerOperation) > input.sandboxCpuSecondsLimit ||
        usdToMicros(proof.billing.conservativeBatchChargeCeilingUsd, 'ceil') > usdToMicros(input.maxApprovedSpendUsd)) fail();
    let instances = 0, uploads = 0;
    class CappedTransport extends NebiusSandboxTransport {
      override spawnInvocation(value: Parameters<NebiusSandboxTransport['spawnInvocation']>[0], childSignal: AbortSignal) {
        return super.spawnInvocation({ ...value, timeoutSeconds: Math.min(value.timeoutSeconds, guestSeconds) }, childSignal);
      }
    }
    const transport = new CappedTransport({ ...sandbox, credential: async () => { guard(false); return sandbox.credential(); },
      fetch: async (url, init) => {
        const create = init?.method === 'POST'; guard(create);
        if (create) signal.throwIfAborted();
        if (init?.signal?.aborted || create && String(url).endsWith('/instances') && ++instances > count ||
            create && String(url).endsWith('/files') && ++uploads > Object.keys(request.files).length) fail();
        return sandbox.fetch(url, init);
      } });
    const checks = new NebiusSandboxCheckRunner({ transport, verification: proof, authorized: true,
      maxApprovedSpendUsd: input.maxApprovedSpendUsd, cleanupTimeoutMs: cleanupSeconds * 1000 });
    try {
      const result = await checks.run({ ...request, timeoutSeconds: checkSeconds }, AbortSignal.any([signal, AbortSignal.timeout(checkSeconds * 1000)]));
      // Preserve protected raw evidence even if the parent deadline has already closed callbacks.
      saveRawResult(structuredClone(result));
      (input.onFinalUsage ?? input.onUsage)?.({ measuredCostUsd: result.measuredCostUsd, sandboxCpuSeconds: result.cpuSeconds });
      return result;
    } finally { ended = true; }
  } };
}
