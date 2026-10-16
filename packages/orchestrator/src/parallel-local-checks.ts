import type { CheckRunner, SandboxCheckResult } from '../../contracts/src/product.ts';
import { errorChecks } from '../../../workers/sandbox/index.ts';

export const LOCAL_CHECK_SCHEDULING_POLICY = Object.freeze({
  id: 'fresh-container-two-lanes-v1', maximumConcurrentContainers: 2,
});
const sumKnown = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;

/** Two bounded lanes retain a fresh isolated container per case. Both lanes
 * share one deadline, stop together on uncertainty, and drain cleanup before return. */
export class TwoLaneLocalCheckRunner implements CheckRunner {
  readonly runner: CheckRunner;
  constructor(runner: CheckRunner) { this.runner = runner; }
  async reconcile(ids: string[]) {
    return this.runner.reconcile ? this.runner.reconcile(ids) :
      { remainingOperationIds: ids, error: 'reconciliation_unavailable' };
  }
  async run(input: Parameters<CheckRunner['run']>[0], signal: AbortSignal): Promise<SandboxCheckResult> {
    if (input.cases.length < 2 || !Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds <= 0 || input.timeoutSeconds > 900) return this.runner.run(input, signal);
    const deadline = performance.now() + input.timeoutSeconds * 1000;
    const stop = new AbortController();
    const combined = AbortSignal.any([signal, stop.signal]);
    const lanes = [input.cases.filter((_, i) => i % 2 === 0), input.cases.filter((_, i) => i % 2 === 1)];
    let originatingFailure: string | null = null;
    const results = await Promise.all(lanes.map(async cases => {
      const operationIds: string[] = [];
      try {
        const result = await this.runner.run({ ...input, files: structuredClone(input.files),
          cases: structuredClone(cases), timeoutSeconds: Math.max(0.001, (deadline - performance.now()) / 1000),
          onOperation: id => { operationIds.push(id); input.onOperation?.(id); } }, combined);
        if (result.infrastructureError) { originatingFailure ??= result.infrastructureError; stop.abort(); }
        return result;
      } catch {
        originatingFailure ??= 'local_lane_error';
        stop.abort();
        return { checks: errorChecks(cases, 'local_lane_error'), operationIds, isolation: 'unavailable' as const,
          cpuSeconds: null, measuredCostUsd: null, infrastructureError: 'local_lane_error' };
      }
    }));
    const rows = results.flatMap(r => r.checks);
    return { checks: input.cases.flatMap(c => rows.filter(row => row.id === c.id && row.requirementId === c.requirementId)),
      operationIds: results.flatMap(r => r.operationIds),
      isolation: results.every(r => r.isolation === 'local_container') ? 'local_container' : 'unavailable',
      cpuSeconds: results.reduce<number | null>((n, r) => sumKnown(n, r.cpuSeconds), 0),
      measuredCostUsd: results.reduce<number | null>((n, r) => sumKnown(n, r.measuredCostUsd), 0),
      infrastructureError: originatingFailure };
  }
}
