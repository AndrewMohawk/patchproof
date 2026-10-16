import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { ContractError, LimitsSchema } from '../../contracts/src/index.ts';
import { PRODUCT_CONTRACT_VERSION, ProductRunRequestSchema } from '../../contracts/src/product.ts';
import { ProposalSchema } from '../../contracts/src/product-validation.ts';
import type { CheckRunner, Fixture, ProductEvent, ProductRun, RepairProvider } from '../../contracts/src/product.ts';
import { digestJson } from '../../contracts/src/digest.ts';
import { EvidenceStore, buildEvidence } from './evidence.ts';
import { fixtureDigests, publicTask } from './fixtures.ts';
import { RunJournal } from './journal.ts';
import { LOCAL_REPAIR_POLICY, repairInput, RevisionCheckError, runRevisionLoop } from './episode-engine.ts';
import { FLAKY_CHECK_MESSAGE } from './repeated-checks.ts';
import { resolveTrustedSmokeCapability, TrustedSmokeGateError } from './trusted-smoke.ts';
import type { TrustedSmokeSettings } from './trusted-smoke.ts';
import { resolveLiveLocalCapability } from './live-local.ts';
import type { LiveLocalSettings } from './live-local.ts';
import { resolveCheckBatchSeconds } from './local-check-timing.ts';

export const LOCAL_LIMITS = LimitsSchema.parse({ inferenceCallLimit: 3, inputTokenLimit: 24000,
  outputTokenLimit: 6000, wallTimeLimitSeconds: 120, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 0 });

export class Coordinator {
  readonly journal: RunJournal;
  readonly store: EvidenceStore;
  readonly #fixtures: Map<string, Fixture>;
  readonly #runtimeLock: unknown;
  readonly #provider: RepairProvider;
  readonly #checks: CheckRunner;
  readonly #verifyRuntime: (() => void) | undefined;
  readonly #trustedSmoke: TrustedSmokeSettings | null;
  readonly #liveLocal: LiveLocalSettings | null;
  readonly #checkBatchSeconds: 30 | 60 | 120;
  readonly #jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  readonly #listeners = new Map<string, Set<(event: ProductEvent) => void>>();

  constructor(options: { fixtures: Fixture[]; runtimeLock: unknown; provider: RepairProvider;
    checks: CheckRunner; journal: RunJournal; store: EvidenceStore; verifyRuntime?: () => void; trustedSmokeCapability?: unknown; liveLocalCapability?: unknown }) {
    this.#fixtures = new Map(options.fixtures.map(fixture => [fixture.id, structuredClone(fixture)]));
    this.#checkBatchSeconds = resolveCheckBatchSeconds(options.provider.mode, options.runtimeLock);
    this.#runtimeLock = structuredClone(options.runtimeLock);
    this.#provider = options.provider; this.#checks = options.checks;
    this.#verifyRuntime = options.verifyRuntime;
    this.#trustedSmoke = resolveTrustedSmokeCapability(options.trustedSmokeCapability);
    if (options.trustedSmokeCapability !== undefined && !this.#trustedSmoke) throw new ContractError('authorization_required', 'Trusted smoke capability is invalid.', 403);
    this.#liveLocal = resolveLiveLocalCapability(options.liveLocalCapability);
    if (options.liveLocalCapability !== undefined && !this.#liveLocal) throw new ContractError('authorization_required', 'Live local capability is invalid.', 403);
    this.journal = options.journal; this.store = options.store;
  }

  tasks() { return [...this.#fixtures.values()].map(publicTask); }
  get(id: string) { return this.journal.get(id); }
  list() { return this.journal.list(); }
  async evidence(id: string) {
    let digest = this.journal.evidenceDigest(id);
    // Polling may observe the terminal journal row while its immutable bundle is
    // still being written. Wait only for this terminal job, never active repair.
    const job = !digest ? this.#jobs.get(id) : undefined;
    const publication = job && this.get(id).phase === 'terminal' ? job.promise : undefined;
    if (publication) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([publication, new Promise<void>(resolve => { timer = setTimeout(resolve, 5_000); })]);
      } finally { if (timer !== undefined) clearTimeout(timer); }
      digest = this.journal.evidenceDigest(id);
    }
    if (!digest) throw new ContractError('evidence_not_ready', 'Evidence is not available yet.', 409);
    return this.store.get(digest);
  }

  create(value: unknown): { run: ProductRun; reused: boolean } {
    const parsed = ProductRunRequestSchema.safeParse(value);
    if (!parsed.success) throw new ContractError('invalid_request', 'Invalid run request.');
    const request = parsed.data;
    const fixture = this.#fixtures.get(request.taskId);
    if (!fixture) throw new ContractError('unknown_task', 'Select a curated public task.');
    const trustedLive = request.mode === 'live' && this.#provider.mode === 'live' && this.#trustedSmoke &&
      request.taskId === this.#trustedSmoke.fixtureId && request.variant === this.#trustedSmoke.variant;
    const localLive = request.mode === 'live' && this.#provider.mode === 'live' && this.#liveLocal;
    if (!trustedLive && !localLive && (request.mode !== 'mock' || this.#provider.mode !== 'mock')) {
      throw new ContractError('authorization_required', 'Real execution requires verified Nebius account, runtime and budget gates.', 403);
    }
    const fingerprint = digestJson(request);
    const prior = this.journal.findRequest(request.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ContractError('idempotency_conflict', 'Key already used for a different request.', 409);
      return { run: this.get(prior.id), reused: true };
    }
    this.#verifyRuntime?.();
    if (localLive && this.#jobs.size) throw new ContractError('capacity_exceeded', 'A live run is already active. Try again when it finishes.', 429);
    if (this.#jobs.size >= 3) throw new ContractError('capacity_exceeded', 'Three runs are already active.', 429);
    if (trustedLive) this.#trustedSmoke!.beforeCreate();
    const id = trustedLive ? this.#trustedSmoke!.episodeId : randomUUID();
    const createdAt = new Date().toISOString();
    if (localLive) this.#liveLocal!.beforeCreate(id, fingerprint, createdAt);
    const run: ProductRun = {
      schemaVersion: PRODUCT_CONTRACT_VERSION, id, taskId: fixture.id, variant: request.variant, mode: request.mode,
      competitionReady: false, notice: localLive ? 'Real NVIDIA inference on Nebius Token Factory; declared checks execute in isolated local containers. Unscored demonstration.' : trustedLive ? 'Trusted sponsor smoke path; at most three proposals. Not a calibrated or scored experiment.' : 'Mock model; scripted proposals. Declared checks execute in isolated local containers. Not competition evidence.',
      phase: 'queued', terminalStatus: null, reason: null, createdAt, finishedAt: null,
      ...fixtureDigests(fixture), runtimeLockDigest: digestJson(this.#runtimeLock), limits: { ...(localLive ? this.#liveLocal!.limits : trustedLive ? this.#trustedSmoke!.limits : LOCAL_LIMITS) },
      usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, sandboxCpuSeconds: 0,
        measuredCostUsd: (trustedLive || localLive) ? null : 0, costIsEstimate: false, elapsedMs: 0 },
      baselineChecks: null, candidates: [], selectedCandidateId: null,
      coverage: fixture.requirements.map(r => ({ requirementId: r.id, status: 'unverified', checkIds: [] })), events: [], sandboxOperationIds: [],
    };
    this.journal.insert(request.idempotencyKey, fingerprint, run);
    if (localLive) this.#liveLocal!.bindEventSink(message => this.#event(run, 'repair', message));
    if (trustedLive) this.#trustedSmoke!.bindEventSink(message => this.#event(run, 'repair', message));
    this.#event(run, 'queued', 'Run queued with a fixed shared resource allowance.');
    const controller = new AbortController();
    const promise = this.#execute(run, structuredClone(fixture), controller).finally(() => this.#jobs.delete(id));
    this.#jobs.set(id, { controller, promise });
    return { run: this.get(id), reused: false };
  }

  cancel(id: string) {
    const run = this.get(id);
    const job = this.#jobs.get(id);
    if (job) job.controller.abort(new Error('cancelled'));
    return run;
  }
  subscribe(id: string, listener: (event: ProductEvent) => void) {
    this.get(id);
    const set = this.#listeners.get(id) ?? new Set(); set.add(listener); this.#listeners.set(id, set);
    return () => { set.delete(listener); if (!set.size) this.#listeners.delete(id); };
  }
  async settled() { await Promise.all([...this.#jobs.values()].map(job => job.promise)); }
  async close() {
    for (const job of this.#jobs.values()) job.controller.abort(new Error('shutdown'));
    await this.settled(); this.journal.close();
  }
  async recover() {
    const incompatibleRecovery = new Set(['recovery_contract_changed', 'recovery_runtime_changed', 'recovery_inputs_changed']);
    const pending = this.list().filter(run => run.phase !== 'terminal' ||
      (!this.journal.evidenceDigest(run.id) && !incompatibleRecovery.has(run.reason ?? '')));
    const interrupted = pending.filter(run => run.phase !== 'terminal');
    let cleanup: { remainingOperationIds: string[]; error: string | null } | null = null;
    if (interrupted.length && this.#checks.reconcile) {
      try { cleanup = await this.#checks.reconcile(interrupted.map(run => run.id)); }
      catch { cleanup = { remainingOperationIds: [], error: 'restart_cleanup_failed' }; }
    }
    for (const run of pending) {
      const terminal = run.phase === 'terminal';
      const fixture = this.#fixtures.get(run.taskId);
      const contractChanged = run.schemaVersion !== PRODUCT_CONTRACT_VERSION;
      const runtimeChanged = run.runtimeLockDigest !== digestJson(this.#runtimeLock);
      const fixtureChanged = !fixture || (!contractChanged &&
        (fixtureDigests(fixture, run.schemaVersion).sourceDigest !== run.sourceDigest || fixtureDigests(fixture, run.schemaVersion).policyDigest !== run.policyDigest));
      const compatible = !contractChanged && !runtimeChanged && !fixtureChanged;
      const cleanupConfirmed = cleanup && !cleanup.error && !cleanup.remainingOperationIds.length;
      if (!terminal || !compatible) {
        run.terminalStatus = compatible ? 'infrastructure_error' : 'needs_review';
        run.reason = contractChanged ? 'recovery_contract_changed' : runtimeChanged ? 'recovery_runtime_changed' : fixtureChanged ? 'recovery_inputs_changed' :
          cleanupConfirmed ? 'interrupted_by_restart' : 'restart_cleanup_unverified';
        if (!terminal) run.finishedAt = new Date().toISOString();
        this.#event(run, 'terminal', `${run.terminalStatus}: ${run.reason}. ${terminal ? 'No execution or evidence publication.' :
          `Cleanup ${cleanupConfirmed ? 'confirmed' : 'unverified'}; no retry or inferred success.`}`, false);
        // Old bundles remain immutable historical files, never the current terminal record.
        this.journal.save(run, null);
      }
      if (compatible && fixture) {
        // A terminal record with no digest may have stopped on either side of the
        // bundle write. Rebuild the exact recorded bundle; put verifies an existing
        // immutable file. No candidate, cleanup, accounting or provider job is resumed.
        try { await this.#publish(run, fixture); }
        catch {
          run.terminalStatus = 'infrastructure_error'; run.reason = 'evidence_publish_failed';
          run.events.at(-1)!.message = 'infrastructure_error: evidence_publish_failed. No evidence approval available.';
          this.journal.save(run, null);
        }
      }
      this.#notify(run.id, run.events.at(-1)!);
    }
  }

  #event(run: ProductRun, phase: ProductRun['phase'], message: string, notify = true) {
    run.phase = phase;
    const event: ProductEvent = { sequence: run.events.length + 1, timestamp: new Date().toISOString(), phase, message };
    run.events.push(event); this.journal.save(run);
    if (notify) this.#notify(run.id, event);
  }
  #notify(id: string, event: ProductEvent) {
    const listeners = this.#listeners.get(id);
    for (const listener of listeners ?? []) { try { listener(structuredClone(event)); } catch { listeners?.delete(listener); } }
  }

  async #check(run: ProductRun, fixture: Fixture, files: Record<string, string>, signal: AbortSignal) {
    signal.throwIfAborted();
    this.#trustedSmoke?.validateStep();
    this.#liveLocal?.validateStep();
    const remainingSeconds = Math.floor(run.limits.wallTimeLimitSeconds - (Date.now() - Date.parse(run.createdAt)) / 1000);
    if (remainingSeconds < 1) throw new ContractError('timeout', 'No aggregate wall-time allowance remains for another check batch.');
    const result = await this.#checks.run({ files, entrypoint: fixture.entrypoint,
      cases: [...fixture.visibleCases, ...fixture.acceptanceCases], timeoutSeconds: Math.min(this.#trustedSmoke?.maximumCheckBatchSeconds ?? this.#checkBatchSeconds, remainingSeconds),
      contractVersion: run.schemaVersion, ownerRunId: run.id, onOperation: id => { run.sandboxOperationIds.push(id); this.journal.save(run); },
    }, signal);
    for (const id of result.operationIds) if (!run.sandboxOperationIds.includes(id)) run.sandboxOperationIds.push(id);
    run.usage.sandboxCpuSeconds = result.cpuSeconds === null || run.usage.sandboxCpuSeconds === null ? null : run.usage.sandboxCpuSeconds + result.cpuSeconds;
    if (run.mode === 'live') run.usage.measuredCostUsd = result.measuredCostUsd === null || run.usage.measuredCostUsd === null ? null : run.usage.measuredCostUsd + result.measuredCostUsd;
    const expected = [...fixture.visibleCases, ...fixture.acceptanceCases];
    if (result.checks.length !== expected.length || expected.some(check => !result.checks.some(observed => observed.id === check.id && observed.requirementId === check.requirementId))) {
      result.infrastructureError = 'incomplete_check_results';
    }
    if (run.usage.sandboxCpuSeconds !== null && run.usage.sandboxCpuSeconds > run.limits.sandboxCpuSecondsLimit) {
      result.infrastructureError = 'sandbox_cpu_budget_exceeded';
    }
    const visibleIds = new Set(fixture.visibleCases.map(c => c.id));
    return { result, visible: result.checks.filter(c => visibleIds.has(c.id)), acceptance: result.checks.filter(c => !visibleIds.has(c.id)) };
  }

  async #execute(run: ProductRun, fixture: Fixture, controller: AbortController) {
    await nextTurn();
    const started = Date.now();
    const deadline = Date.parse(run.createdAt) + run.limits.wallTimeLimitSeconds * 1000;
    const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.max(0, deadline - Date.now()));
    try {
      controller.signal.throwIfAborted();
      this.#event(run, 'preflight', run.mode === 'live' ? 'Checking live runtime bindings and the reserved aggregate allowance.' : 'Checking immutable input digests and isolated local runtime.');
      const digests = fixtureDigests(fixture, run.schemaVersion);
      if (digests.sourceDigest !== run.sourceDigest || digests.policyDigest !== run.policyDigest) throw new ContractError('digest_mismatch', 'Input changed after scheduling.');
      if (!fixture.visibleCases.length && !fixture.acceptanceCases.length) {
        run.terminalStatus = 'needs_review'; run.reason = 'no_declared_checks';
        return;
      }
      this.#event(run, 'baseline_capture', 'Running original source against frozen declared checks.');
      const original = await this.#check(run, fixture, fixture.files, controller.signal);
      run.baselineChecks = { visible: original.visible, acceptance: original.acceptance };
      this.journal.save(run);
      this.#liveLocal?.validateStep();
      if (original.result.infrastructureError) {
        if (this.#trustedSmoke && original.result.infrastructureError.startsWith('trusted_smoke_')) throw new TrustedSmokeGateError(original.result.infrastructureError.slice('trusted_smoke_'.length));
        throw new ContractError('infrastructure_error', 'Initial checker infrastructure failure.');
      }
      if (original.result.checks.some(check => check.message === FLAKY_CHECK_MESSAGE)) throw new ContractError('flaky_check', 'Original observations are inconsistent.');
      await runRevisionLoop({ fixture, variant: run.variant, policy: LOCAL_REPAIR_POLICY,
        maximumRevisions: Math.min(3, run.limits.inferenceCallLimit), signal: controller.signal,
        initialFeedback: run.variant === 'baseline' ? original.visible : [...original.visible, ...original.acceptance], revisions: run.candidates,
        propose: async context => {
          const modelRemainingSeconds = Math.floor((deadline - Date.now()) / 1000);
          if (modelRemainingSeconds < 1) throw new ContractError('timeout', 'No aggregate wall-time allowance remains for inference.');
          this.#trustedSmoke?.validateStep();
          this.#liveLocal?.validateStep();
          this.#event(run, 'repair', run.mode === 'live' ? `Requesting NVIDIA model candidate ${context.attempt + 1}; all candidates share the reserved envelope.` : `Requesting scripted candidate ${context.attempt + 1}; no model inference call.`);
          const proposal = ProposalSchema.parse(await this.#provider.propose(repairInput(fixture, context,
            { ...run.limits, inferenceCallLimit: run.limits.inferenceCallLimit - (run.mode === 'live' ? run.usage.inferenceCalls : context.attempt),
              inputTokenLimit: run.limits.inputTokenLimit - run.usage.inputTokens, outputTokenLimit: run.limits.outputTokenLimit - run.usage.outputTokens,
              wallTimeLimitSeconds: modelRemainingSeconds }), controller.signal));
          run.usage.inferenceCalls += proposal.usage.inferenceCalls;
          run.usage.inputTokens += proposal.usage.inputTokens; run.usage.outputTokens += proposal.usage.outputTokens;
          run.usage.measuredCostUsd = proposal.usage.measuredCostUsd === null || run.usage.measuredCostUsd === null ? null : run.usage.measuredCostUsd + proposal.usage.measuredCostUsd;
          if (run.usage.inputTokens > run.limits.inputTokenLimit || run.usage.outputTokens > run.limits.outputTokenLimit ||
              run.usage.inferenceCalls > run.limits.inferenceCallLimit || (run.usage.measuredCostUsd ?? 0) > run.limits.maxApprovedSpendUsd) {
            throw new ContractError('budget_not_approved', 'Aggregate resource allowance exceeded.');
          }
          return proposal;
        },
        onProposed: candidate => { this.journal.save(run); this.#event(run, 'check', `Checking candidate ${candidate.id} in a fresh isolated workspace.`); },
        check: candidate => this.#check(run, fixture, candidate.files, controller.signal),
        validateChecked: () => this.#liveLocal?.validateStep(),
        onChecked: () => this.journal.save(run), onSelection: id => { run.selectedCandidateId = id; },
      });
      this.#coverage(run, fixture);
      const selected = run.candidates.find(c => c.id === run.selectedCandidateId);
      const requirementsUnverified = run.coverage.some(row => row.status === 'unverified');
      run.terminalStatus = selected?.accepted && run.coverage.every(row => row.status === 'pass') ? 'verified_for_declared_checks' :
        requirementsUnverified ? 'needs_review' : 'failed';
      run.reason = run.terminalStatus === 'verified_for_declared_checks' ?
        run.mode === 'live' ? (this.#liveLocal ? 'declared_local_checks_passed' : 'declared_sponsor_smoke_checks_passed') : 'declared_local_checks_passed' :
        requirementsUnverified ? 'declared_requirements_unverified' : 'declared_checks_not_satisfied';
    } catch (error) {
      if (controller.signal.aborted) {
        run.terminalStatus = 'needs_review'; run.reason = controller.signal.reason?.message === 'timeout' ? 'timeout' : 'cancelled';
      } else {
        const providerCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
        const knownCodes = new Set(['mock_task_unavailable', 'rate_limit', 'timeout', 'missing_key', 'protected_path', 'invalid_candidate', 'budget_exceeded', 'budget_exhausted', 'transport_error', 'invalid_response', 'operation_journal_error', 'model_mismatch', 'incomplete_response']);
        run.reason = error instanceof RevisionCheckError && error.checkCode.startsWith('trusted_smoke_') ? error.checkCode : error instanceof TrustedSmokeGateError ? error.gateCode : error instanceof ContractError ? error.code : providerCode && knownCodes.has(providerCode) ? providerCode : 'setup_error';
        run.terminalStatus = ['mock_task_unavailable', 'flaky_check'].includes(run.reason) ? 'needs_review' : 'infrastructure_error';
      }
      if (error && typeof error === 'object' && 'usage' in error) {
        const usage = ProposalSchema.shape.usage.safeParse(error.usage);
        if (usage.success) {
          run.usage.inferenceCalls += usage.data.inferenceCalls; run.usage.inputTokens += usage.data.inputTokens;
          run.usage.outputTokens += usage.data.outputTokens;
          run.usage.measuredCostUsd = this.#provider.mode === 'mock' && usage.data.inferenceCalls === 0 ? 0 :
            usage.data.measuredCostUsd === null || run.usage.measuredCostUsd === null ? null : run.usage.measuredCostUsd + usage.data.measuredCostUsd;
        }
      }
      if (error && typeof error === 'object' && 'providerRequestId' in error && typeof error.providerRequestId === 'string' && /^[A-Za-z0-9_.:/-]{1,200}$/.test(error.providerRequestId)) {
        this.#event(run, 'repair', `Failed inference response ID: ${error.providerRequestId}. Billing remains unreconciled.`);
      }
      this.#coverage(run, fixture);
    } finally {
      clearTimeout(timer); run.finishedAt = new Date().toISOString(); run.usage.elapsedMs = Date.now() - started;
      this.#event(run, 'export', 'Preserving source, patch, checks, costs and observed events.');
      this.#event(run, 'terminal', `${run.terminalStatus}: ${run.reason}. ${run.mode === 'mock' ? 'Mock model mode remains explicit.' : 'Real inference; provider billing remains unreconciled.'}`, false);
      if (run.mode === 'live') {
        try { if (this.#liveLocal) this.#liveLocal.terminal(run); else this.#trustedSmoke!.terminal(run); }
        catch {
          run.terminalStatus = 'infrastructure_error'; run.reason = 'accounting_persistence_failed';
          run.events.at(-1)!.message = 'infrastructure_error: accounting_persistence_failed. Preserve the original reservation; no new paid work.';
        }
      }
      try { await this.#publish(run, fixture); }
      catch {
        run.terminalStatus = 'infrastructure_error'; run.reason = 'evidence_publish_failed';
        run.events.at(-1)!.message = 'infrastructure_error: evidence_publish_failed. No evidence approval available.';
        this.journal.save(run);
      }
      this.#notify(run.id, run.events.at(-1)!);
    }
  }

  #coverage(run: ProductRun, fixture: Fixture) {
    const selected = run.candidates.find(c => c.id === run.selectedCandidateId);
    const checks = selected ? [...selected.visibleChecks, ...selected.acceptanceChecks] : [];
    run.coverage = fixture.requirements.map(requirement => {
      const rows = checks.filter(check => check.requirementId === requirement.id);
      return { requirementId: requirement.id, status: !rows.length || rows.some(c => c.status === 'error') ? 'unverified' : rows.every(c => c.status === 'pass') ? 'pass' : 'fail', checkIds: rows.map(c => c.id) };
    });
  }
  async #publish(run: ProductRun, fixture: Fixture) {
    const bundle = buildEvidence(run, fixture, this.#runtimeLock);
    // Persist any final accounting failure before the asynchronous bundle write so
    // restart publication uses the same terminal record, never an earlier approval.
    this.journal.save(run);
    await this.store.put(bundle); this.journal.save(run, bundle.bundleDigest);
  }
}
