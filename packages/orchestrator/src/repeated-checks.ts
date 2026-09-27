import { isDeepStrictEqual } from 'node:util';
import { ContractError } from '../../contracts/src/index.ts';
import type { CheckRunner, CheckResult, SandboxCheckResult } from '../../contracts/src/product.ts';

export const REPEATED_CHECK_PROTOCOL = Object.freeze({ id: 'repeat-observations-v1', repetitions: 2,
  disagreement: 'needs_review', budget: 'shared-batch-wall-time' });
export const FLAKY_CHECK_MESSAGE = 'flaky_check: repeated observations disagree.';
const sumKnown = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;

/** Repeats identical immutable inputs in fresh runner invocations; never retries infrastructure uncertainty. */
export class RepeatedCheckRunner implements CheckRunner {
  readonly #runner: CheckRunner;
  readonly #now: () => number;
  constructor(runner: CheckRunner, now = () => performance.now()) { this.#runner = runner; this.#now = now; }
  async reconcile(ids: string[]) {
    return this.#runner.reconcile ? this.#runner.reconcile(ids) : { remainingOperationIds: [], error: 'reconciliation_unavailable' };
  }
  async run(input: Parameters<CheckRunner['run']>[0], signal: AbortSignal): Promise<SandboxCheckResult> {
    const started = this.#now();
    const runs: SandboxCheckResult[] = [];
    let stopped: string | null = null;
    for (let round = 0; round < REPEATED_CHECK_PROTOCOL.repetitions; round++) {
      const remaining = input.timeoutSeconds - (this.#now() - started) / 1000;
      if (signal.aborted || remaining <= 0) { stopped = signal.aborted ? 'cancelled' : 'verification_timeout'; break; }
      const result = await this.#runner.run({ ...input, files: structuredClone(input.files), cases: structuredClone(input.cases), timeoutSeconds: remaining }, signal);
      runs.push(structuredClone(result));
      const complete = result.checks.length === input.cases.length && input.cases.every(c =>
        result.checks.filter(row => row.id === c.id && row.requirementId === c.requirementId).length === 1);
      if (result.infrastructureError || !complete) { stopped = result.infrastructureError ?? 'incomplete_check_results'; break; }
    }
    const checks: CheckResult[] = input.cases.map(c => {
      const observations = runs.flatMap(run => run.checks.filter(row => row.id === c.id && row.requirementId === c.requirementId));
      const first = observations[0];
      const complete = observations.length === REPEATED_CHECK_PROTOCOL.repetitions && observations.every(row => row.status !== 'error') && !stopped;
      const consistent = complete && observations.every(row => row.status === first!.status && isDeepStrictEqual(row.actual, first!.actual));
      const unstable = complete && !consistent;
      return { id: c.id, requirementId: c.requirementId, status: consistent ? first!.status : 'error',
        message: unstable ? FLAKY_CHECK_MESSAGE : consistent ? `${first!.message} Repeated observations agree.` : `verification_unavailable: ${stopped ?? 'check_error'}.`,
        actual: unstable ? { observations: observations.map(row => row.actual) } : first?.actual ?? null,
        expected: first?.expected ?? (c.expectedException ? { exception: c.expectedException } : c.expected),
        durationMs: observations.reduce((total, row) => total + row.durationMs, 0),
        log: JSON.stringify({ protocol: REPEATED_CHECK_PROTOCOL.id, stability: unstable ? 'inconsistent' : consistent ? 'consistent' : 'unverified', observations }),
      };
    });
    return { checks, operationIds: runs.flatMap(run => run.operationIds), isolation: runs[0]?.isolation ?? 'unavailable',
      cpuSeconds: runs.reduce<number | null>((total, run) => sumKnown(total, run.cpuSeconds), 0),
      measuredCostUsd: runs.reduce<number | null>((total, run) => sumKnown(total, run.measuredCostUsd), 0), infrastructureError: stopped };
  }
}

export function runnerForFrozenProtocol(runner: CheckRunner, lock: unknown): CheckRunner {
  const protocol = lock && typeof lock === 'object' && 'checkProtocol' in lock ? lock.checkProtocol : undefined;
  if (protocol === undefined) return runner; // Explicit historical bundles had one observation.
  if (!isDeepStrictEqual(protocol, REPEATED_CHECK_PROTOCOL)) throw new ContractError('setup_error', 'Unsupported frozen check protocol.');
  return new RepeatedCheckRunner(runner);
}
