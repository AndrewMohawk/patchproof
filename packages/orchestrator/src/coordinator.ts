import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { ContractError, LimitsSchema } from '../../contracts/src/index.ts';
import { PRODUCT_CONTRACT_VERSION, ProductRunRequestSchema } from '../../contracts/src/product.ts';
import { ProposalSchema } from '../../contracts/src/product-validation.ts';
import type { CandidateRecord, CheckResult, CheckRunner, Fixture, ProductEvent, ProductRun, RepairProvider, SandboxCheckResult } from '../../contracts/src/product.ts';
import { digestJson } from '../../contracts/src/digest.ts';
import { EvidenceStore, buildEvidence } from './evidence.ts';
import { fixtureDigests, publicTask, validatePaths } from './fixtures.ts';
import { RunJournal } from './journal.ts';
import { createPatch } from './patch.ts';
import { FLAKY_CHECK_MESSAGE } from './repeated-checks.ts';

export const LOCAL_LIMITS = LimitsSchema.parse({ inferenceCallLimit: 3, inputTokenLimit: 24000,
  outputTokenLimit: 6000, wallTimeLimitSeconds: 120, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 0 });
const allPass = (checks: CheckResult[]) => checks.length > 0 && checks.every(check => check.status === 'pass');

export class Coordinator {
  readonly journal: RunJournal;
  readonly store: EvidenceStore;
  readonly #fixtures: Map<string, Fixture>;
  readonly #runtimeLock: unknown;
  readonly #provider: RepairProvider;
  readonly #checks: CheckRunner;
  readonly #verifyRuntime: (() => void) | undefined;
  readonly #jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  readonly #listeners = new Map<string, Set<(event: ProductEvent) => void>>();

  constructor(options: { fixtures: Fixture[]; runtimeLock: unknown; provider: RepairProvider;
    checks: CheckRunner; journal: RunJournal; store: EvidenceStore; verifyRuntime?: () => void }) {
    this.#fixtures = new Map(options.fixtures.map(fixture => [fixture.id, structuredClone(fixture)]));
    this.#runtimeLock = structuredClone(options.runtimeLock);
    this.#provider = options.provider; this.#checks = options.checks;
    this.#verifyRuntime = options.verifyRuntime;
    this.journal = options.journal; this.store = options.store;
  }

  tasks() { return [...this.#fixtures.values()].map(publicTask); }
  get(id: string) { return this.journal.get(id); }
  list() { return this.journal.list(); }
  async evidence(id: string) {
    const digest = this.journal.evidenceDigest(id);
    if (!digest) throw new ContractError('evidence_not_ready', 'Evidence is not available yet.', 409);
    return this.store.get(digest);
  }

  create(value: unknown): { run: ProductRun; reused: boolean } {
    const parsed = ProductRunRequestSchema.safeParse(value);
    if (!parsed.success) throw new ContractError('invalid_request', 'Invalid run request.');
    const request = parsed.data;
    const fixture = this.#fixtures.get(request.taskId);
    if (!fixture) throw new ContractError('unknown_task', 'Select a curated public task.');
    if (request.mode !== 'mock' || this.#provider.mode !== 'mock') {
      throw new ContractError('authorization_required', 'Real execution requires verified Nebius account, runtime and budget gates.', 403);
    }
    const fingerprint = digestJson(request);
    const prior = this.journal.findRequest(request.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ContractError('idempotency_conflict', 'Key already used for a different request.', 409);
      return { run: this.get(prior.id), reused: true };
    }
    this.#verifyRuntime?.();
    if (this.#jobs.size >= 3) throw new ContractError('capacity_exceeded', 'Three runs are already active.', 429);
    const id = randomUUID();
    const run: ProductRun = {
      schemaVersion: PRODUCT_CONTRACT_VERSION, id, taskId: fixture.id, variant: request.variant, mode: request.mode,
      competitionReady: false, notice: 'Mock model; scripted proposals. Declared checks execute in isolated local containers. Not competition evidence.',
      phase: 'queued', terminalStatus: null, reason: null, createdAt: new Date().toISOString(), finishedAt: null,
      ...fixtureDigests(fixture), runtimeLockDigest: digestJson(this.#runtimeLock), limits: { ...LOCAL_LIMITS },
      usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, sandboxCpuSeconds: 0,
        measuredCostUsd: 0, costIsEstimate: false, elapsedMs: 0 },
      baselineChecks: null, candidates: [], selectedCandidateId: null,
      coverage: fixture.requirements.map(r => ({ requirementId: r.id, status: 'unverified', checkIds: [] })), events: [], sandboxOperationIds: [],
    };
    this.journal.insert(request.idempotencyKey, fingerprint, run);
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
    const interrupted = this.list().filter(run => run.phase !== 'terminal');
    let cleanup: { remainingOperationIds: string[]; error: string | null } | null = null;
    if (interrupted.length && this.#checks.reconcile) {
      try { cleanup = await this.#checks.reconcile(interrupted.map(run => run.id)); }
      catch { cleanup = { remainingOperationIds: [], error: 'restart_cleanup_failed' }; }
    }
    for (const run of interrupted) {
      const fixture = this.#fixtures.get(run.taskId);
      const contractChanged = run.schemaVersion !== PRODUCT_CONTRACT_VERSION;
      const runtimeChanged = run.runtimeLockDigest !== digestJson(this.#runtimeLock);
      const fixtureChanged = !fixture || (!contractChanged &&
        (fixtureDigests(fixture, run.schemaVersion).sourceDigest !== run.sourceDigest || fixtureDigests(fixture, run.schemaVersion).policyDigest !== run.policyDigest));
      const compatible = !contractChanged && !runtimeChanged && !fixtureChanged;
      const cleanupConfirmed = cleanup && !cleanup.error && !cleanup.remainingOperationIds.length;
      run.terminalStatus = compatible ? 'infrastructure_error' : 'needs_review';
      run.reason = contractChanged ? 'recovery_contract_changed' : runtimeChanged ? 'recovery_runtime_changed' : fixtureChanged ? 'recovery_inputs_changed' :
        cleanupConfirmed ? 'interrupted_by_restart' : 'restart_cleanup_unverified';
      run.finishedAt = new Date().toISOString();
      this.#event(run, 'terminal', `${run.terminalStatus}: ${run.reason}. Cleanup ${cleanupConfirmed ? 'confirmed' : 'unverified'}; no retry or inferred success.`, false);
      // Old bundles remain immutable historical files, never the current terminal record.
      this.journal.save(run, null);
      if (compatible && fixture) {
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
    const remainingSeconds = Math.floor(run.limits.wallTimeLimitSeconds - (Date.now() - Date.parse(run.createdAt)) / 1000);
    if (remainingSeconds < 1) throw new ContractError('timeout', 'No aggregate wall-time allowance remains for another check batch.');
    const result = await this.#checks.run({ files, entrypoint: fixture.entrypoint,
      cases: [...fixture.visibleCases, ...fixture.acceptanceCases], timeoutSeconds: Math.min(30, remainingSeconds),
      ownerRunId: run.id, onOperation: id => { run.sandboxOperationIds.push(id); this.journal.save(run); },
    }, signal);
    for (const id of result.operationIds) if (!run.sandboxOperationIds.includes(id)) run.sandboxOperationIds.push(id);
    run.usage.sandboxCpuSeconds = result.cpuSeconds === null || run.usage.sandboxCpuSeconds === null ? null : run.usage.sandboxCpuSeconds + result.cpuSeconds;
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
    const timer = setTimeout(() => controller.abort(new Error('timeout')), run.limits.wallTimeLimitSeconds * 1000);
    try {
      controller.signal.throwIfAborted();
      this.#event(run, 'preflight', 'Checking immutable input digests and isolated local runtime.');
      const digests = fixtureDigests(fixture, run.schemaVersion);
      if (digests.sourceDigest !== run.sourceDigest || digests.policyDigest !== run.policyDigest) throw new ContractError('digest_mismatch', 'Input changed after scheduling.');
      this.#event(run, 'baseline_capture', 'Running original source against frozen declared checks.');
      const original = await this.#check(run, fixture, fixture.files, controller.signal);
      run.baselineChecks = { visible: original.visible, acceptance: original.acceptance };
      if (original.result.infrastructureError) throw new ContractError('infrastructure_error', 'Initial checker infrastructure failure.');
      if (original.result.checks.some(check => check.message === FLAKY_CHECK_MESSAGE)) throw new ContractError('flaky_check', 'Original observations are inconsistent.');
      let files = structuredClone(fixture.files);
      let feedback = run.variant === 'baseline' ? original.visible : [...original.visible, ...original.acceptance];
      for (let attempt = 0; attempt < Math.min(3, run.limits.inferenceCallLimit); attempt++) {
        const candidateStarted = Date.now();
        controller.signal.throwIfAborted();
        this.#event(run, 'repair', `Requesting scripted candidate ${attempt + 1}; no model inference call.`);
        const proposal = ProposalSchema.parse(await this.#provider.propose({ taskId: fixture.id, description: fixture.description,
          requirements: fixture.requirements, files: run.variant === 'patchproof' ? structuredClone(fixture.files) : files,
          editAllowlist: fixture.editAllowlist, visibleCases: fixture.visibleCases,
          feedback: feedback.map(c => ({ requirementId: c.requirementId, status: c.status,
            message: `Observed ${attempt === 0 ? 'on original source' : `on candidate ${attempt}`}; next proposal starts from ${run.variant === 'patchproof' ? 'original source' : 'supplied current source'}. ${c.message}` })), attempt,
          remaining: { ...run.limits, inferenceCallLimit: run.limits.inferenceCallLimit - attempt,
            inputTokenLimit: run.limits.inputTokenLimit - run.usage.inputTokens, outputTokenLimit: run.limits.outputTokenLimit - run.usage.outputTokens },
        }, controller.signal));
        run.usage.inferenceCalls += proposal.usage.inferenceCalls;
        run.usage.inputTokens += proposal.usage.inputTokens; run.usage.outputTokens += proposal.usage.outputTokens;
        run.usage.measuredCostUsd = proposal.usage.measuredCostUsd === null || run.usage.measuredCostUsd === null ? null : run.usage.measuredCostUsd + proposal.usage.measuredCostUsd;
        if (run.usage.inputTokens > run.limits.inputTokenLimit || run.usage.outputTokens > run.limits.outputTokenLimit ||
            run.usage.inferenceCalls > run.limits.inferenceCallLimit || (run.usage.measuredCostUsd ?? 0) > run.limits.maxApprovedSpendUsd) {
          throw new ContractError('budget_not_approved', 'Aggregate resource allowance exceeded.');
        }
        validatePaths(proposal.files, fixture.editAllowlist);
        const candidateFiles = { ...(run.variant === 'patchproof' ? fixture.files : files), ...proposal.files };
        const candidate: CandidateRecord = {
          id: attempt + 1, parentId: run.variant === 'patchproof' || attempt === 0 ? null : attempt,
          summary: proposal.summary.slice(0, 2000), files: candidateFiles, diff: createPatch(fixture.files, candidateFiles),
          visibleChecks: [], acceptanceChecks: [], accepted: false, rejectionReason: null,
          modelId: proposal.modelId, providerRequestId: proposal.providerRequestId,
          sandboxOperationIds: [], elapsedMs: 0, usage: proposal.usage,
        };
        run.candidates.push(candidate); this.journal.save(run);
        this.#event(run, 'check', `Checking candidate ${candidate.id} in a fresh isolated workspace.`);
        const checked = await this.#check(run, fixture, candidateFiles, controller.signal);
        candidate.visibleChecks = checked.visible; candidate.acceptanceChecks = checked.acceptance;
        candidate.sandboxOperationIds = checked.result.operationIds;
        if (checked.result.infrastructureError) {
          candidate.rejectionReason = checked.result.infrastructureError;
          candidate.elapsedMs = Date.now() - candidateStarted;
          this.journal.save(run);
          throw new ContractError('infrastructure_error', 'Candidate checker infrastructure failure.');
        }
        candidate.accepted = allPass([...checked.visible, ...checked.acceptance]);
        candidate.rejectionReason = candidate.accepted ? null : 'One or more declared checks failed or were unavailable.';
        candidate.elapsedMs = Date.now() - candidateStarted;
        if (checked.result.checks.some(check => check.message === FLAKY_CHECK_MESSAGE)) {
          candidate.rejectionReason = 'flaky_check';
          throw new ContractError('flaky_check', 'Candidate observations are inconsistent; no further repair feedback.');
        }
        if (run.variant !== 'patchproof') run.selectedCandidateId = candidate.id;
        else {
          const previous = run.candidates.find(c => c.id === run.selectedCandidateId);
          const score = (record: CandidateRecord) => [...record.visibleChecks, ...record.acceptanceChecks].filter(c => c.status === 'pass').length;
          if (!previous || score(candidate) > score(previous)) run.selectedCandidateId = candidate.id;
        }
        files = candidateFiles;
        feedback = run.variant === 'baseline' ? checked.visible : [...checked.visible, ...checked.acceptance];
        if (run.variant === 'baseline' ? allPass(checked.visible) : candidate.accepted) break;
      }
      this.#coverage(run, fixture);
      const selected = run.candidates.find(c => c.id === run.selectedCandidateId);
      run.terminalStatus = selected?.accepted && run.coverage.every(row => row.status === 'pass') ? 'verified_for_declared_checks' :
        selected && [...selected.visibleChecks, ...selected.acceptanceChecks].some(check => check.status === 'error') ? 'needs_review' : 'failed';
      run.reason = selected?.accepted ? 'declared_local_checks_passed' : 'declared_checks_not_satisfied';
    } catch (error) {
      if (controller.signal.aborted) {
        run.terminalStatus = 'needs_review'; run.reason = controller.signal.reason?.message === 'timeout' ? 'timeout' : 'cancelled';
      } else {
        const providerCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
        const knownCodes = new Set(['mock_task_unavailable', 'rate_limit', 'timeout', 'missing_key', 'protected_path', 'invalid_candidate', 'budget_exceeded', 'transport_error', 'invalid_response']);
        run.reason = error instanceof ContractError ? error.code : providerCode && knownCodes.has(providerCode) ? providerCode : 'setup_error';
        run.terminalStatus = ['mock_task_unavailable', 'flaky_check'].includes(run.reason) ? 'needs_review' : 'infrastructure_error';
        if (error && typeof error === 'object' && 'usage' in error) {
          const usage = ProposalSchema.shape.usage.safeParse(error.usage);
          if (usage.success) {
            run.usage.inferenceCalls += usage.data.inferenceCalls; run.usage.inputTokens += usage.data.inputTokens;
            run.usage.outputTokens += usage.data.outputTokens;
            run.usage.measuredCostUsd = this.#provider.mode === 'mock' && usage.data.inferenceCalls === 0 ? 0 :
              usage.data.measuredCostUsd === null || run.usage.measuredCostUsd === null ? null : run.usage.measuredCostUsd + usage.data.measuredCostUsd;
          }
        }
      }
      this.#coverage(run, fixture);
    } finally {
      clearTimeout(timer); run.finishedAt = new Date().toISOString(); run.usage.elapsedMs = Date.now() - started;
      this.#event(run, 'export', 'Preserving source, patch, checks, costs and observed events.');
      this.#event(run, 'terminal', `${run.terminalStatus}: ${run.reason}. Mock model mode remains explicit.`, false);
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
    await this.store.put(bundle); this.journal.save(run, bundle.bundleDigest);
  }
}
