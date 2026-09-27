import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { catalogue } from '../../contracts/src/catalogue.ts';
import { digestBytes, digestJson } from '../../contracts/src/digest.ts';
import {
  CONTRACT_VERSION, ContractError, EvidenceManifestSchema, MOCK_LABEL,
  RunSpecSchema, RunViewSchema, parseRunRequest,
} from '../../contracts/src/index.ts';
import type { RunEvent, RunView } from '../../contracts/src/index.ts';

export const MOCK_LOG = 'NOT RUN: mock contract fixture; no model, sandbox or acceptance check executed.\n';

export class MockCoordinator {
  readonly #runs = new Map<string, RunView>();
  readonly #idempotency = new Map<string, { digest: string; id: string }>();
  readonly #listeners = new Map<string, Set<(event: RunEvent) => void>>();
  readonly #pending = new Set<Promise<void>>();
  readonly #runtimeLockDigest: string;
  readonly #step: () => Promise<unknown>;
  readonly #capacity: number;

  constructor(runtimeLock: unknown, options: { step?: () => Promise<unknown>; capacity?: number } = {}) {
    this.#runtimeLockDigest = digestJson(runtimeLock);
    this.#step = options.step ?? nextTurn;
    this.#capacity = options.capacity ?? 100;
  }

  create(value: unknown): { run: RunView; reused: boolean } {
    const tasks = catalogue();
    const request = parseRunRequest(value, tasks.map(t => t.id));
    if (request.mode !== 'mock') {
      throw new ContractError('authorization_required', 'G0/G1 blocked: real-provider execution is unavailable.', 403);
    }
    const fingerprint = digestJson(request);
    const previous = this.#idempotency.get(request.idempotencyKey);
    if (previous) {
      if (previous.digest !== fingerprint) {
        throw new ContractError('idempotency_conflict', 'Idempotency key already used for a different request.', 409);
      }
      return { run: this.get(previous.id), reused: true };
    }
    if (this.#runs.size >= this.#capacity) {
      throw new ContractError('capacity_exceeded', 'Mock session capacity reached; restart to clear session state.', 429);
    }
    const task = tasks.find(t => t.id === request.taskId)!;
    const id = randomUUID();
    const run: RunView = {
      ...MOCK_LABEL, schemaVersion: CONTRACT_VERSION, id, task,
      spec: RunSpecSchema.parse({
        taskId: task.id, repoDigest: task.repoDigest, policyDigest: task.policyDigest,
        variant: request.variant, inferenceCallLimit: 1, inputTokenLimit: 1,
        outputTokenLimit: 1, wallTimeLimitSeconds: 1, sandboxCpuSecondsLimit: 1,
        maxApprovedSpendUsd: 0, seed: 0,
      }),
      createdAt: new Date().toISOString(), phase: 'queued', terminalStatus: null,
      cancelled: false,
      usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, sandboxCpuSeconds: 0, measuredCostUsd: 0 },
      events: [], evidence: null,
    };
    this.#runs.set(id, run);
    this.#idempotency.set(request.idempotencyKey, { digest: fingerprint, id });
    this.#event(run, 'state', 'queued', 'Mock contract request accepted; no execution scheduled.');
    const pending = this.#finish(run).catch(() => this.#complete(run, 'mock_error'));
    this.#pending.add(pending);
    void pending.then(() => this.#pending.delete(pending), () => this.#pending.delete(pending));
    return { run: this.get(id), reused: false };
  }

  get(id: string): RunView {
    const run = this.#runs.get(id);
    if (!run) throw new ContractError('not_found', 'Run not found.', 404);
    return RunViewSchema.parse(structuredClone(run));
  }

  cancel(id: string): RunView {
    const run = this.#runs.get(id);
    if (!run) throw new ContractError('not_found', 'Run not found.', 404);
    if (run.phase !== 'terminal' && !run.cancelled) {
      run.cancelled = true;
      this.#event(run, 'cancel_requested', run.phase, 'Mock cancellation requested; no provider jobs exist.');
    }
    return this.get(id);
  }

  subscribe(id: string, listener: (event: RunEvent) => void): () => void {
    this.get(id);
    const set = this.#listeners.get(id) ?? new Set();
    set.add(listener);
    this.#listeners.set(id, set);
    return () => { set.delete(listener); if (!set.size) this.#listeners.delete(id); };
  }

  async settled(): Promise<void> { await Promise.all(this.#pending); }

  #event(run: RunView, kind: RunEvent['kind'], phase: RunEvent['phase'], message: string) {
    run.phase = phase;
    const event: RunEvent = {
      ...MOCK_LABEL, runId: run.id, sequence: run.events.length + 1,
      timestamp: new Date().toISOString(), phase, kind, message,
    };
    run.events.push(event);
    const listeners = this.#listeners.get(run.id);
    for (const listener of listeners ?? []) {
      try { listener(structuredClone(event)); }
      catch { listeners?.delete(listener); }
    }
  }

  async #finish(run: RunView) {
    await this.#step();
    this.#event(run, 'state', 'preflight', 'Mock mode confirmed. All execution and checks are NOT RUN.');
    this.#complete(run, 'mock_only');
  }

  #complete(run: RunView, reason: 'mock_only' | 'mock_error') {
    this.#event(run, 'state', 'export', 'Creating mock contract record with all requirements unverified.');
    run.evidence = EvidenceManifestSchema.parse({
      ...MOCK_LABEL, schemaVersion: CONTRACT_VERSION, runId: run.id,
      sourceDigest: run.spec.repoDigest, patchDigest: null,
      modelLockDigest: this.#runtimeLockDigest, policyDigest: run.spec.policyDigest,
      checks: run.task.requirements.map(r => ({
        id: `not-run-${r.id}`, status: 'error', logDigest: digestBytes(MOCK_LOG), requirementId: r.id,
      })),
      coverage: run.task.requirements.map(r => ({
        requirementId: r.id, status: 'unverified', reason: 'NOT RUN: mock contract fixture.',
      })),
      terminalStatus: 'needs_review', terminationReason: run.cancelled ? 'cancelled' : reason,
      replayCommand: `make reproduce RUN=${run.id}`,
      measuredCostUsd: 0, costIsEstimate: false,
      modelId: null, sandboxOperationIds: [], executionPerformed: false,
    });
    run.terminalStatus = 'needs_review';
    this.#event(run, 'terminal', 'terminal', 'Mock record complete; no patch has been verified.');
  }
}
