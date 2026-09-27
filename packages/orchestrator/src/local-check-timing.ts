import { isDeepStrictEqual } from 'node:util';
import { ContractError } from '../../contracts/src/index.ts';
import { cloneJsonData } from '../../contracts/src/json-data.ts';

// Recorded in new local mock locks only. This changes one batch's shared wall
// allowance, not repetition counts, proposal counts or the aggregate episode cap.
export const LOCAL_MOCK_CHECK_TIMING_POLICY = Object.freeze({
  id: 'local-mock-check-timing-v1', maximumBatchWallSeconds: 60,
});

export function resolveCheckBatchSeconds(mode: 'mock' | 'live', runtimeLock: unknown): 30 | 60 {
  let lock;
  try { lock = cloneJsonData(runtimeLock); }
  catch { throw new ContractError('setup_error', 'Invalid recorded check timing policy.'); }
  if (lock === null || typeof lock !== 'object' || Array.isArray(lock) || !Object.hasOwn(lock, 'localCheckTimingPolicy')) return 30;
  if (!isDeepStrictEqual(lock.localCheckTimingPolicy, LOCAL_MOCK_CHECK_TIMING_POLICY)) {
    throw new ContractError('setup_error', 'Unsupported recorded check timing policy.');
  }
  // A local policy can never raise live execution or live replay allowances.
  return mode === 'mock' ? 60 : 30;
}
