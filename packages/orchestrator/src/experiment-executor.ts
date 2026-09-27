import { z } from 'zod';
import { ExperimentExecutionError } from '../../../workers/evaluator/dispatcher.ts';
import type { CheckRunner, RepairProvider } from '../../contracts/src/product.ts';
import { createExperimentExecutorCore } from './experiment-executor-core.ts';
import type { ExperimentTraceStore } from './experiment-trace-store.ts';
import { buildProspectiveExperimentPolicy, ExperimentSettingsSchema } from './experiment-policy.ts';
export { buildProspectiveExperimentPolicy, ExperimentSettingsSchema } from './experiment-policy.ts';

export interface SyntheticExperimentRuntime {
  executionMode: 'synthetic'; provider: RepairProvider & { executionMode: 'synthetic'; mode: 'mock' };
  checks: CheckRunner & { executionMode: 'synthetic' };
}
type Options = { runtime: SyntheticExperimentRuntime; settings: z.infer<typeof ExperimentSettingsSchema>;
  modelLockDigest: string | null; planDigest: string; traceStore: ExperimentTraceStore;
  loadFixtureBytes: (taskId: string, signal: AbortSignal) => Promise<string | Uint8Array>;
  verifyBindings: () => void };

/** Synthetic entry point rejects live providers; there are no credentials or paid grants here. */
export function createSyntheticExperimentExecutor(options: Options) {
  if (options.runtime.executionMode !== 'synthetic' || options.runtime.provider.executionMode !== 'synthetic' ||
      options.runtime.provider.mode !== 'mock' || options.runtime.checks.executionMode !== 'synthetic') throw new ExperimentExecutionError('runtime_binding_changed');
  const provider = { mode: 'mock' as const, propose: options.runtime.provider.propose.bind(options.runtime.provider) };
  const checks = { run: options.runtime.checks.run.bind(options.runtime.checks) };
  const policy = buildProspectiveExperimentPolicy(options.settings);
  return createExperimentExecutorCore({ ...options, policy, executionMode: 'synthetic', createRuntime: (_context, limits) => ({
    provider, checks, verify: () => {}, batchSeconds: Math.min(policy.settings.maxCheckBatchSeconds,
      Math.floor((limits.sandboxCpuSecondsLimit / 48 - policy.settings.overheadCpuSecondsPerBatch) / policy.settings.checkCpuUnits)),
  }) });
}
