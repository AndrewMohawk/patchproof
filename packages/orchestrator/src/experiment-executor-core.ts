import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContractError, DigestSchema, LimitsSchema, TaskIdSchema, VariantSchema } from '../../contracts/src/index.ts';
import { FixtureSchema } from '../../contracts/src/product.ts';
import type { CandidateRecord, CheckRunner, Fixture, RepairProvider, SandboxCheckResult } from '../../contracts/src/product.ts';
import { ProposalSchema } from '../../contracts/src/product-validation.ts';
import { digestBytes, digestJson } from '../../contracts/src/digest.ts';
import { ExperimentExecutionError, ExecutionFailureReasonSchema } from '../../../workers/evaluator/dispatcher.ts';
import type { DispatcherTransport, ExecutionInput, FinalizedExecution } from '../../../workers/evaluator/dispatcher.ts';
import { hashJson } from '../../../workers/evaluator/protocol.ts';
import { EXPERIMENT_REPAIR_POLICY, repairInput, RevisionCheckError, runRevisionLoop } from './episode-engine.ts';
import { RepeatedCheckRunner } from './repeated-checks.ts';
import { ExperimentTraceStore } from './experiment-trace-store.ts';
import { validatePaths } from './fixtures.ts';
import { usdToMicros } from './budget-ledger.ts';
import type { buildProspectiveExperimentPolicy } from './experiment-policy.ts';
import type { LiveExperimentPolicy } from './live-experiment-policy.ts';

const executionSchema = z.strictObject({ episodeId: z.string().min(1).max(300), dispatchId: z.uuid(), taskId: TaskIdSchema,
  repoId: z.string().min(1), variant: VariantSchema, repetition: z.number().int().min(0).max(2), seed: z.number().int().nonnegative().max(2 ** 32 - 1),
  limits: LimitsSchema, fixtureDigest: DigestSchema, planDigest: DigestSchema, modelLockDigest: DigestSchema.nullable(), policyDigest: DigestSchema });
const handleSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
type Usage = FinalizedExecution['usage'];
export interface ExperimentRuntimeContext {
  input: Omit<ExecutionInput, 'checkpoint'>; fixture: Fixture; operation: (id: string) => void;
  trace: (record: unknown) => void; signal: AbortSignal;
}
export interface ExperimentCoreRuntime {
  provider: RepairProvider; checks: CheckRunner; batchSeconds: number;
  verify: () => void;
  finalizeAccounting?: (value: { usage: Usage; operationIds: string[] }, signal: AbortSignal) => Promise<{
    receiptDigest: string | null; measuredCostUsd: number | null; sandboxCpuSeconds: number | null;
    billingComplete: boolean; inventoryComplete: boolean; cleanupComplete: boolean; coveredOperationIds: string[];
  }>;
}
export interface ExperimentCoreOptions {
  executionMode: 'synthetic' | 'live'; policy: ReturnType<typeof buildProspectiveExperimentPolicy> | LiveExperimentPolicy;
  modelLockDigest: string | null; planDigest: string; traceStore: ExperimentTraceStore;
  loadFixtureBytes: (taskId: string, signal: AbortSignal) => Promise<string | Uint8Array>;
  verifyBindings: () => void; verifyExecution?: (input: Omit<ExecutionInput, 'checkpoint'>) => void;
  createRuntime: (context: ExperimentRuntimeContext, runtimeLimits: z.infer<typeof LimitsSchema>) => ExperimentCoreRuntime;
}
export class ExperimentRuntimeGateError extends ContractError {
  readonly reason: ConstructorParameters<typeof ExperimentExecutionError>[0];
  constructor(reason: ConstructorParameters<typeof ExperimentExecutionError>[0]) { super('authorization_required', reason, 403); this.reason = ExecutionFailureReasonSchema.parse(reason); }
}
function failure(reason: ConstructorParameters<typeof ExperimentExecutionError>[0]): never { throw new ExperimentExecutionError(reason); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([promise, cancelled]).finally(() => signal.removeEventListener('abort', abort));
}
function normalize(error: unknown): ExperimentExecutionError {
  if (error instanceof ExperimentExecutionError) return error;
  if (error instanceof ExperimentRuntimeGateError) return new ExperimentExecutionError(error.reason);
  if (error instanceof RevisionCheckError) return new ExperimentExecutionError(error.checkCode.includes('cleanup') || error.checkCode.includes('submission_unconfirmed') ? 'cleanup_unverified' :
    error.checkCode === 'sandbox_setup_failure' ? 'sandbox_setup_failure' : 'execution_or_setup_failed');
  const code = error instanceof ContractError ? error.code : error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'protected_path' || code === 'invalid_candidate' || code === 'flaky_check' || code === 'missing_key') return new ExperimentExecutionError(code);
  if (code === 'timeout') return new ExperimentExecutionError('provider_timeout');
  if (code === 'rate_limit') return new ExperimentExecutionError('provider_rate_limit');
  if (['budget_exceeded', 'budget_exhausted', 'budget_not_approved'].includes(String(code))) return new ExperimentExecutionError('resource_limit');
  return new ExperimentExecutionError('execution_or_setup_failed');
}

/** Internal loop adapter. Public entry points enforce their own distinct runtime authority. */
export function createExperimentExecutorCore(options: ExperimentCoreOptions): Pick<DispatcherTransport, 'executionMode' | 'modelLockDigest' | 'policyDigest' | 'execute'> {
  const mode = options.executionMode, createRuntime = options.createRuntime, verifyExecution = options.verifyExecution;
  const loadFixtureBytes = options.loadFixtureBytes, verifyBindings = options.verifyBindings, store = options.traceStore;
  const policy = structuredClone(options.policy), policyDigest = hashJson(policy);
  const modelLockDigest = DigestSchema.nullable().parse(options.modelLockDigest), planDigest = DigestSchema.parse(options.planDigest);
  if (!(store instanceof ExperimentTraceStore) || typeof loadFixtureBytes !== 'function' || typeof verifyBindings !== 'function') failure('runtime_binding_changed');
  return { executionMode: mode, modelLockDigest, policyDigest,
    execute: async (value, callerSignal) => {
      const { checkpoint, ...raw } = value;
      const input = executionSchema.parse(raw), started = performance.now();
      if (typeof checkpoint !== 'function' || input.policyDigest !== policyDigest || input.modelLockDigest !== modelLockDigest || input.planDigest !== planDigest ||
          input.limits.inferenceCallLimit !== 24 || input.limits.wallTimeLimitSeconds !== 900) failure('runtime_binding_changed');
      const reserve = policy.settings.adjudicationReserve;
      const runtimeLimits = { ...input.limits, wallTimeLimitSeconds: input.limits.wallTimeLimitSeconds - reserve.wallSeconds,
        sandboxCpuSecondsLimit: input.limits.sandboxCpuSecondsLimit - reserve.cpuSeconds,
        maxApprovedSpendUsd: mode === 'live' ? Number(usdToMicros(input.limits.maxApprovedSpendUsd) - usdToMicros(reserve.spendUsd)) / 1_000_000 : input.limits.maxApprovedSpendUsd - reserve.spendUsd };
      if (runtimeLimits.wallTimeLimitSeconds < 1 || runtimeLimits.sandboxCpuSecondsLimit <= 0 || runtimeLimits.maxApprovedSpendUsd < 0) failure('resource_limit');
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(new DOMException('Runtime deadline exceeded', 'TimeoutError')), runtimeLimits.wallTimeLimitSeconds * 1000);
      const signal = AbortSignal.any([callerSignal, timeout.signal]);
      let runtime: ExperimentCoreRuntime | null = null;
      let closed = false, claimed = false, feedbackRounds = 0, rawBatches = 0, cpuComplete = true, billingComplete = true;
      const operations: string[] = [], revisions: CandidateRecord[] = [];
      const usage: Usage = { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, runtimeFeedbackRounds: 0, elapsedMs: 0, sandboxCpuSeconds: 0, measuredCostUsd: 0 };
      const snapshot = () => ({ ...usage,
        measuredCostUsd: mode === 'live' && !billingComplete && usage.measuredCostUsd === 0 ? null : usage.measuredCostUsd,
        sandboxCpuSeconds: mode === 'live' && !cpuComplete && usage.sandboxCpuSeconds === 0 ? null : usage.sandboxCpuSeconds, runtimeFeedbackRounds: feedbackRounds, elapsedMs: Math.max(usage.elapsedMs, Math.ceil(performance.now() - started)) });
      const trace = (record: unknown) => store.append(input.dispatchId, record);
      const publish = () => { usage.elapsedMs = snapshot().elapsedMs; checkpoint({ usage: snapshot(), operationIds: [...operations] }); };
      const guard = () => { if (closed) failure('runtime_binding_changed'); signal.throwIfAborted(); verifyBindings(); runtime?.verify(); };
      const operation = (id: string) => {
        if (closed) failure('runtime_binding_changed'); handleSchema.parse(id);
        if (!operations.includes(id)) { if (operations.length >= 1000) failure('resource_limit'); operations.push(id); }
        trace({ kind: 'operation', id }); publish();
      };
      const checkLimit = () => {
        if (usage.inferenceCalls > 24 || usage.inputTokens > input.limits.inputTokenLimit || usage.outputTokens > input.limits.outputTokenLimit ||
            feedbackRounds > 24 || (usage.sandboxCpuSeconds ?? 0) > runtimeLimits.sandboxCpuSecondsLimit ||
            (usage.measuredCostUsd ?? 0) > runtimeLimits.maxApprovedSpendUsd) failure('resource_limit');
      };
      const modelObservation = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        if ('usage' in value && value.usage && typeof value.usage === 'object') {
          const used = value.usage as Record<string, unknown>;
          const count = (name: string) => { const parsed = z.number().int().nonnegative().safeParse(used[name]); return parsed.success ? parsed.data : 0; };
          usage.inferenceCalls += Math.max(0, count('inferenceCalls') - 1);
          usage.inputTokens += count('inputTokens'); usage.outputTokens += count('outputTokens');
          const cost = z.number().finite().nonnegative().safeParse(used.measuredCostUsd);
          if (cost.success) usage.measuredCostUsd! += cost.data; else billingComplete = false;
        } else billingComplete = false;
        if ('providerRequestId' in value) {
          const id = handleSchema.safeParse(value.providerRequestId);
          if (id.success) { trace({ kind: 'model-response', providerRequestId: id.data }); operation(id.data); }
        }
      };
      try {
        guard(); verifyExecution?.(input); store.claim(input.dispatchId, digestJson(input)); claimed = true;
        trace({ kind: 'binding', input, policy, synthetic: mode === 'synthetic', benchmarkExecuted: false }); publish();
        const bytes = await abortable(loadFixtureBytes(input.taskId, signal), signal); guard();
        if (Buffer.byteLength(bytes) > 1_048_576 || digestBytes(bytes) !== input.fixtureDigest) failure('source_changed');
        const fixture = FixtureSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
        if (fixture.id !== input.taskId || fixture.repoId !== input.repoId) failure('source_changed');
        validatePaths(fixture.files); if (!Object.hasOwn(fixture.files, fixture.entrypoint)) failure('source_changed');
        const cases = input.variant === 'baseline' ? fixture.visibleCases : [...fixture.visibleCases, ...fixture.acceptanceCases];
        if (!cases.length || new Set(cases.map(check => check.id)).size !== cases.length || cases.some(check => !fixture.requirements.some(requirement => requirement.id === check.requirementId))) failure('source_changed');
        runtime = createRuntime({ input, fixture, operation, trace, signal }, runtimeLimits);
        guard();
        const batchSeconds = runtime.batchSeconds;
        if (!Number.isFinite(batchSeconds) || batchSeconds < 1) failure('resource_limit');
        const propose = runtime.provider.propose.bind(runtime.provider), rawRun = runtime.checks.run.bind(runtime.checks);
        trace({ kind: 'public-source', bytes: Buffer.from(bytes).toString('utf8'), originalCheckBatches: 0,
          maximumRawBatches: 48, batchSeconds, boundIsSynthetic: mode === 'synthetic' });
        const checks = new RepeatedCheckRunner({ run: async (request, checkSignal) => {
          guard(); if (++rawBatches > 48) failure('resource_limit');
          let result: SandboxCheckResult;
          try { const pending = rawRun({ ...request, timeoutSeconds: Math.min(request.timeoutSeconds, batchSeconds) }, checkSignal);
            // The owned live adapter bounds its own waits and completes bounded cleanup before returning.
            result = await (mode === 'live' ? pending : abortable(pending, checkSignal)); }
          catch (error) {
            if (error && typeof error === 'object') {
              const record = error as Record<string, unknown>;
              for (const key of ['operationIds', 'handles']) if (Array.isArray(record[key])) for (const value of record[key]) {
                const id = handleSchema.safeParse(value); if (id.success) operation(id.data);
              }
              const used = record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : record;
              const cpu = z.number().finite().nonnegative().safeParse(used.sandboxCpuSeconds ?? used.cpuSeconds);
              const cost = z.number().finite().nonnegative().safeParse(used.measuredCostUsd);
              if (cpu.success) usage.sandboxCpuSeconds! += cpu.data;
              if (cost.success) usage.measuredCostUsd! += cost.data;
              trace({ kind: 'raw-check-failure', round: rawBatches, knownUsage: snapshot() }); publish();
            }
            cpuComplete = billingComplete = false;
            throw error;
          }
          if (mode === 'synthetic' && result.isolation === 'nebius_sandbox' || mode === 'live' && result.isolation === 'local_container') failure('runtime_binding_changed');
          for (const amount of [result.cpuSeconds, result.measuredCostUsd]) if (amount !== null && (!Number.isFinite(amount) || amount < 0)) failure('execution_or_setup_failed');
          if (result.cpuSeconds === null) cpuComplete = false; else usage.sandboxCpuSeconds! += result.cpuSeconds;
          if (result.measuredCostUsd === null) billingComplete = false; else usage.measuredCostUsd! += result.measuredCostUsd;
          trace({ kind: 'raw-check-observation', round: rawBatches, result, usage: snapshot() }); publish(); checkLimit();
          return result;
        } });
        const result = await runRevisionLoop({ fixture, variant: input.variant, policy: EXPERIMENT_REPAIR_POLICY, maximumRevisions: 24,
          signal, initialFeedback: [], revisions,
          propose: async context => {
            guard(); const remainingWall = Math.floor(runtimeLimits.wallTimeLimitSeconds - (performance.now() - started) / 1000);
            const remainingCpu = runtimeLimits.sandboxCpuSecondsLimit - (usage.sandboxCpuSeconds ?? 0);
            const remainingSpend = runtimeLimits.maxApprovedSpendUsd - (usage.measuredCostUsd ?? 0);
            if (remainingWall < 1 || remainingCpu <= 0 || remainingSpend < 0 || usage.inputTokens >= input.limits.inputTokenLimit || usage.outputTokens >= input.limits.outputTokenLimit) failure('resource_limit');
            usage.inferenceCalls++; checkLimit(); if (mode === 'synthetic') operation(`synthetic:model-intent:${randomUUID()}`);
            const perCallOutput = Math.min(policy.settings.maxOutputTokensPerCall, input.limits.outputTokenLimit - usage.outputTokens);
            let proposed: unknown;
            try { proposed = await abortable(propose(repairInput(fixture, context, { ...runtimeLimits,
              inferenceCallLimit: 25 - usage.inferenceCalls, inputTokenLimit: input.limits.inputTokenLimit - usage.inputTokens,
              outputTokenLimit: perCallOutput,
              sandboxCpuSecondsLimit: remainingCpu, maxApprovedSpendUsd: remainingSpend,
              wallTimeLimitSeconds: remainingWall }), signal), signal); }
            catch (error) {
              modelObservation(error); publish(); checkLimit(); throw error;
            }
            modelObservation(proposed);
            const accounted = ProposalSchema.shape.usage.safeParse(proposed && typeof proposed === 'object' && 'usage' in proposed ? proposed.usage : undefined);
            publish(); checkLimit();
            if (accounted.success && accounted.data.outputTokens > perCallOutput) failure('resource_limit');
            const parsed = ProposalSchema.safeParse(proposed);
            if (!parsed.success || !accounted.success || accounted.data.inferenceCalls !== 1 || !Object.keys(parsed.data.files).length) failure('invalid_candidate');
            try { validatePaths(parsed.data.files, fixture.editAllowlist); } catch { failure('protected_path'); }
            guard(); return parsed.data;
          },
          onProposed: (candidate, context) => { trace({ kind: 'revision', branchId: context.branchId, candidate }); publish(); },
          check: async candidate => {
            guard(); const remainingWall = runtimeLimits.wallTimeLimitSeconds - (performance.now() - started) / 1000;
            if (remainingWall < 1) failure('resource_limit');
            const checked = await checks.run({ files: structuredClone(candidate.files), entrypoint: fixture.entrypoint, cases: structuredClone(cases),
              timeoutSeconds: Math.min(policy.settings.maxCheckBatchSeconds, remainingWall), ownerRunId: input.dispatchId, onOperation: operation }, signal);
            for (const id of checked.operationIds) if (!operations.includes(id)) operation(id);
            if (!checked.infrastructureError) feedbackRounds++;
            trace({ kind: 'checks', candidateId: candidate.id, result: checked, usage: snapshot() }); publish(); checkLimit();
            const visibleIds = new Set(fixture.visibleCases.map(check => check.id));
            return { result: checked, visible: checked.checks.filter(check => visibleIds.has(check.id)), acceptance: checked.checks.filter(check => !visibleIds.has(check.id)) };
          },
          onChecked: (candidate, context) => trace({ kind: 'checked-revision', branchId: context.branchId, candidate }),
          onSelection: candidateId => trace({ kind: 'selection', candidateId }),
        });
        guard(); publish();
        if (mode === 'live') {
          if (!runtime.finalizeAccounting) failure('billing_incomplete');
          const observed = await abortable(runtime.finalizeAccounting!({ usage: snapshot(), operationIds: [...operations] }, signal), signal);
          signal.throwIfAborted(); verifyBindings();
          DigestSchema.nullable().parse(observed.receiptDigest);
          const cost = z.number().finite().nonnegative().nullable().parse(observed.measuredCostUsd);
          const cpu = z.number().finite().nonnegative().nullable().parse(observed.sandboxCpuSeconds);
          const covered = z.array(handleSchema).max(1000).parse(observed.coveredOperationIds);
          if (new Set(covered).size !== covered.length || covered.length !== operations.length || operations.some(id => !covered.includes(id)) ||
              cost !== null && cost < (usage.measuredCostUsd ?? 0) || cpu !== null && cpu < (usage.sandboxCpuSeconds ?? 0)) failure('billing_incomplete');
          if (cost !== null) usage.measuredCostUsd = cost;
          if (cpu !== null) usage.sandboxCpuSeconds = cpu;
          billingComplete = observed.receiptDigest !== null && observed.billingComplete && observed.inventoryComplete && observed.cleanupComplete && cost !== null;
          cpuComplete = observed.inventoryComplete && observed.cleanupComplete && cpu !== null;
          trace({ kind: 'runtime-accounting', receiptDigest: observed.receiptDigest, complete: billingComplete && cpuComplete, usage: snapshot() }); publish(); checkLimit();
        }
        if (!cpuComplete || !billingComplete) failure('billing_incomplete');
        const selected = result.selectedCandidate;
        const output = { selectionFinalized: true as const, selectedCandidate: selected ? { files: structuredClone(selected.files), digest: hashJson(selected.files) } : null,
          runtimeApproved: selected?.accepted ?? false, usage: snapshot(), billingComplete: usage.measuredCostUsd !== null,
          infrastructureExclusion: null };
        closed = true; const artifact = store.finalize(input.dispatchId, { ...output, synthetic: mode === 'synthetic', benchmarkExecuted: false });
        return { ...output, artifactsDigest: artifact.digest };
      } catch (error) {
        const normalized = normalize(error);
        if (claimed) {
          // A checkpoint remains a lower-bound observation; no retry or selected artifact escapes on failure.
          try { publish(); trace({ kind: 'failure', reason: signal.aborted ? 'cancelled_or_deadline' : normalized.reason, usage: snapshot(), operations });
            store.finalize(input.dispatchId, { outcome: 'unverified', reason: signal.aborted ? 'cancelled_or_deadline' : normalized.reason, synthetic: mode === 'synthetic', benchmarkExecuted: false }); }
          catch { /* Original durable claim and completed records remain; failure never creates another grant. */ }
        }
        throw normalized;
      } finally { closed = true; clearTimeout(timer); }
    } };
}
