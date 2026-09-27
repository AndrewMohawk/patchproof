import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FunctionCaseSchema, PRODUCT_CONTRACT_VERSION, ProductContractVersionSchema } from '../../packages/contracts/src/product.ts';
import { cloneJsonData, assertLegacyJsonDomain } from '../../packages/contracts/src/json-data.ts';
import type { CheckRunner, CheckResult, SandboxCheckResult } from '../../packages/contracts/src/product.ts';
import type { NebiusSandboxTransport } from './nebius.ts';
import { SandboxTransportError, SandboxVerificationSchema, terminalOperation, decodeStream, waitForPoll } from './nebius-types.ts';
import type { SandboxOperation, SandboxVerification } from './nebius-types.ts';
import { usdToMicros } from '../../packages/orchestrator/src/budget-ledger.ts';

export interface NebiusSandboxRunnerOptions {
  transport: NebiusSandboxTransport;
  /** Supplied by a trusted account/control verification process; never a task payload. */
  verification: SandboxVerification;
  authorized: boolean;
  /** Conservatively reserved per batch; no refunds from unspecified-currency API costs. */
  maxApprovedSpendUsd: number;
  pollIntervalMs?: number;
  cleanupTimeoutMs?: number;
}

/** Conditional implementation only. Current project configuration has no verified receipt. */
export class NebiusSandboxCheckRunner implements CheckRunner {
  readonly #options: NebiusSandboxRunnerOptions | undefined;
  readonly #pollMs: number;
  readonly #cleanupMs: number;
  #reservedMicros = 0n;
  constructor(options?: NebiusSandboxRunnerOptions) {
    this.#options = options && { ...options, verification: structuredClone(options.verification) };
    this.#pollMs = options?.pollIntervalMs ?? 250;
    this.#cleanupMs = options?.cleanupTimeoutMs ?? 5000;
    if (!Number.isInteger(this.#pollMs) || this.#pollMs < 1 || this.#pollMs > 2000 ||
        !Number.isInteger(this.#cleanupMs) || this.#cleanupMs < 1 || this.#cleanupMs > 10_000) throw new Error('invalid_sandbox_poll_limits');
  }

  #verified(): SandboxVerification | null {
    const options = this.#options;
    if (!options?.authorized || !Number.isFinite(options.maxApprovedSpendUsd) || options.maxApprovedSpendUsd <= 0) return null;
    const parsed = SandboxVerificationSchema.safeParse(options.verification);
    if (!parsed.success || parsed.data.projectId !== options.transport.expectedProjectId || Date.parse(parsed.data.validUntil) <= Date.now()) return null;
    const receipt = parsed.data;
    const proofs = [receipt.account, receipt.image, receipt.billing, ...Object.values(receipt.equivalentControls)];
    if (proofs.some(proof => Date.parse(proof.verifiedAt) > Date.now() || Date.parse(proof.verifiedAt) >= Date.parse(receipt.validUntil))) return null;
    return receipt;
  }

  async #poll(id: string, imageUuid: string, signal: AbortSignal): Promise<SandboxOperation> {
    for (let polls = 0; polls < 1000; polls++) {
      const operation = await this.#options!.transport.getOperation(id, signal);
      if (operation.kind !== 'instance' || (operation.image_uuid != null && operation.image_uuid !== imageUuid) ||
          (operation.metadata.image !== undefined && operation.metadata.image !== imageUuid)) throw new SandboxTransportError('sandbox_operation_identity_mismatch');
      if (terminalOperation(operation)) return operation;
      await waitForPoll(Math.max(this.#pollMs, operation.retryAfterMs ?? 0), signal);
    }
    throw new SandboxTransportError('sandbox_poll_limit');
  }

  async #cleanup(id: string, imageUuid: string): Promise<SandboxOperation | null> {
    // Cancelling the caller signal must not cancel the request that stops its operation.
    const signal = AbortSignal.timeout(this.#cleanupMs);
    try { await this.#options!.transport.cancel(id, signal); }
    catch { /* A racing terminal state can reject DELETE. Only a status response proves termination. */ }
    try { return await this.#poll(id, imageUuid, signal); }
    catch { return null; }
  }

  async run(original: Parameters<CheckRunner['run']>[0], signal: AbortSignal): Promise<SandboxCheckResult> {
    // Lazy import avoids an initialization cycle with index.ts's public re-export.
    const { errorChecks, evaluateObservation } = await import('./index.ts');
    const unavailable = (reason: string): SandboxCheckResult => ({ checks: errorChecks(original.cases, reason), isolation: 'unavailable',
      operationIds: [], cpuSeconds: null, measuredCostUsd: null, infrastructureError: reason });
    if (signal.aborted) return unavailable('cancelled');
    const contractVersion = ProductContractVersionSchema.safeParse(original.contractVersion ?? PRODUCT_CONTRACT_VERSION);
    if (!contractVersion.success) return unavailable('unsupported_product_contract_version');
    try { if (contractVersion.data !== '2.2') assertLegacyJsonDomain(cloneJsonData(original.cases)); }
    catch { return unavailable('unsupported_legacy_json_key'); }
    const receipt = this.#verified();
    if (!receipt) return unavailable('sandbox_controls_unverified');
    // A repeated check can receive a positive remainder smaller than the API's integral second.
    // This is an exhausted usable wall allowance, not authorization to round up and overspend it.
    if (Number.isFinite(original.timeoutSeconds) && original.timeoutSeconds > 0 && original.timeoutSeconds < 1) return unavailable('sandbox_batch_timeout');
    const paths = Object.keys(original.files);
    const cases = z.array(FunctionCaseSchema).min(1).max(receipt.limits.maxCases).safeParse(original.cases);
    if (!cases.success || paths.length === 0 || paths.length > 32 || !paths.includes(original.entrypoint) ||
        paths.some(path => !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.py$/.test(path)) ||
        Object.values(original.files).some(source => typeof source !== 'string') ||
        Object.values(original.files).reduce((n, source) => n + Buffer.byteLength(source), 0) > receipt.limits.maxSourceBytes ||
        !Number.isFinite(original.timeoutSeconds) || original.timeoutSeconds < 1 || original.timeoutSeconds > receipt.limits.maxTimeoutSeconds ||
        (original.ownerRunId !== undefined && !z.uuid().safeParse(original.ownerRunId).success) ||
        cases.data.some(c => !/^[A-Za-z][A-Za-z0-9_]*$/.test(c.function) || Buffer.byteLength(JSON.stringify({ function: c.function, args: c.args, kwargs: c.kwargs })) > 131_072)) return unavailable('invalid_candidate_input');
    const input = { ...original, files: { ...original.files }, cases: cases.data };
    if (Date.parse(receipt.validUntil) <= Date.now() + input.timeoutSeconds * 1000 + this.#cleanupMs) return unavailable('sandbox_verification_expires_during_batch');
    let charge: bigint, allowance: bigint;
    try { charge = usdToMicros(receipt.billing.conservativeBatchChargeCeilingUsd, 'ceil'); allowance = usdToMicros(this.#options!.maxApprovedSpendUsd); }
    catch { return unavailable('sandbox_budget_reservation_unavailable'); }
    if (this.#reservedMicros + charge > allowance) return unavailable('sandbox_budget_reservation_unavailable');
    // Reserve synchronously before any await or external side effect. The durable budget owner must
    // supply a fresh allowance per process; this adapter is deliberately not wired to live startup.
    this.#reservedMicros += charge;
    const deadline = Date.now() + Math.floor(input.timeoutSeconds * 1000);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(Math.floor(input.timeoutSeconds * 1000))]);
    const operationIds: string[] = [], checks: CheckResult[] = [];
    const completed = new Map<string, SandboxOperation>();
    const audit: unknown[] = [];
    let active: string | null = null, submitted = 0, submissionUnconfirmed = false;
    let infrastructureError: string | null = null;
    const record = (id: string) => {
      if (operationIds.includes(id)) return;
      operationIds.push(id);
      try { input.onOperation?.(id); }
      catch { throw new SandboxTransportError('operation_journal_error'); }
    };
    const observeTerminal = (operation: SandboxOperation) => {
      completed.set(operation.uuid, operation);
      audit.push({ operationId: `nebius:operation:${operation.uuid}`, status: operation.status, cpuSeconds: operation.consumed_cpu ?? null,
        providerCostUnspecifiedUnit: operation.metadata.result?.resources?.cost ?? null });
    };
    try {
      const files: Record<string, { uuid: string; uid: number; gid: number; mode: string }> = {};
      for (const path of paths) {
        if (bounded.aborted) throw new SandboxTransportError('cancelled');
        record(`nebius:upload-intent:${randomUUID()}`);
        const uuid = await this.#options!.transport.uploadSource(input.files[path]!, bounded);
        record(`nebius:file:${uuid}`);
        files[`/candidate/${path}`] = { uuid, uid: 65534, gid: 65534, mode: '0444' };
      }
      for (const c of input.cases) {
        // Provider execution timeout is integral seconds. Never round a remaining fraction up.
        const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);
        if (bounded.aborted || remainingSeconds < 1) throw new SandboxTransportError('sandbox_batch_timeout');
        const started = Date.now();
        record(`nebius:instance-intent:${randomUUID()}`);
        submissionUnconfirmed = true;
        active = await this.#options!.transport.spawnInvocation({ imageUuid: receipt.imageUuid, files,
          entrypoint: `/candidate/${input.entrypoint}`, invocation: { function: c.function, args: c.args, kwargs: c.kwargs }, timeoutSeconds: remainingSeconds }, bounded);
        if (completed.has(active)) throw new SandboxTransportError('sandbox_duplicate_operation');
        submitted++;
        submissionUnconfirmed = false;
        record(`nebius:operation:${active}`);
        const operation = await this.#poll(active, receipt.imageUuid, bounded);
        observeTerminal(operation);
        active = null;
        const result = operation.metadata.result;
        if (operation.status !== 'SUCCESS' || !result) throw new SandboxTransportError(`sandbox_operation_${operation.status.toLowerCase()}`);
        if (operation.image_uuid !== receipt.imageUuid && operation.metadata.image !== receipt.imageUuid) throw new SandboxTransportError('sandbox_image_unconfirmed');
        if (result.state.timed_out !== false || result.state.stopped === true || result.state.exit_code !== 0 || (result.state.signal !== 0 && result.state.signal !== null)) throw new SandboxTransportError('sandbox_candidate_process_error');
        const stdout = decodeStream(result.stdout), stderr = decodeStream(result.stderr);
        const check = evaluateObservation(c, stdout, Date.now() - started, contractVersion.data);
        check.log = JSON.stringify({ comparison: JSON.parse(check.log.startsWith('{') ? check.log : '{}'), stdout, stderr, operation: audit.at(-1) });
        checks.push(check);
      }
    } catch (error) {
      const typed = error instanceof SandboxTransportError ? error : new SandboxTransportError('sandbox_runner_error');
      // A schema/status failure can still reveal a real retained file or operation handle.
      let journalFailed = false;
      for (const handle of typed.handles) {
        if (handle.startsWith('nebius:operation:') && active === null) {
          active = handle.slice('nebius:operation:'.length);
          submitted++;
          submissionUnconfirmed = false;
        }
        try { record(handle); } catch { journalFailed = true; }
      }
      infrastructureError = signal.aborted ? 'cancelled' : bounded.aborted ? 'sandbox_batch_timeout' : typed.code;
      if (submissionUnconfirmed) infrastructureError += ':sandbox_submission_unconfirmed';
      if (journalFailed) infrastructureError += ':operation_journal_error';
      if (active !== null) {
        const stopped = await this.#cleanup(active, receipt.imageUuid);
        if (stopped) observeTerminal(stopped);
        else infrastructureError += ':sandbox_cleanup_unconfirmed';
      }
      const remaining = errorChecks(input.cases.slice(checks.length), infrastructureError);
      for (const check of remaining) check.log = JSON.stringify({ error: infrastructureError, operations: audit, handles: operationIds });
      checks.push(...remaining);
    }
    const measuredCpu = !submissionUnconfirmed && submitted > 0 && completed.size === submitted &&
      [...completed.values()].every(operation => operation.consumed_cpu != null);
    return { checks, isolation: submitted > 0 ? 'nebius_sandbox' : 'unavailable', operationIds,
      cpuSeconds: measuredCpu ? [...completed.values()].reduce((sum, operation) => sum + operation.consumed_cpu!, 0) : null,
      measuredCostUsd: null, infrastructureError };
  }
}
