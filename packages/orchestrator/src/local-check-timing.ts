import { isDeepStrictEqual } from 'node:util';
import { ContractError } from '../../contracts/src/index.ts';
import { cloneJsonData } from '../../contracts/src/json-data.ts';

// Recorded in new local mock locks only. This changes one batch's shared wall
// allowance, not repetition counts, proposal counts or the aggregate episode cap.
export const LOCAL_MOCK_CHECK_TIMING_POLICY = Object.freeze({
  id: 'local-mock-check-timing-v1', maximumBatchWallSeconds: 60,
});

const LIVE_LOCAL_CHECK_TIMING_V1 = Object.freeze({ id: 'live-local-check-timing-v1', maximumBatchWallSeconds: 60 });
export const LIVE_LOCAL_CHECK_TIMING_POLICY = Object.freeze({ id: 'live-local-check-timing-v2', maximumBatchWallSeconds: 120 });

export function resolveCheckBatchSeconds(mode: 'mock' | 'live', runtimeLock: unknown): 30 | 60 | 120 {
  let lock;
  try { lock = cloneJsonData(runtimeLock); }
  catch { throw new ContractError('setup_error', 'Invalid recorded check timing policy.'); }
  if (lock && typeof lock === 'object' && !Array.isArray(lock) && Object.hasOwn(lock, 'liveLocalCheckTimingPolicy')) {
    const current = isDeepStrictEqual(lock.liveLocalCheckTimingPolicy, LIVE_LOCAL_CHECK_TIMING_POLICY);
    const historical = isDeepStrictEqual(lock.liveLocalCheckTimingPolicy, LIVE_LOCAL_CHECK_TIMING_V1);
    if (mode !== 'live' || (!current && !historical) ||
      !lock.execution || typeof lock.execution !== 'object' || Array.isArray(lock.execution) || lock.execution.checkBackend !== 'local_container') {
      throw new ContractError('setup_error', 'Unsupported recorded live local check timing policy.');
    }
    return current ? 120 : 60;
  }
  if (lock === null || typeof lock !== 'object' || Array.isArray(lock) || !Object.hasOwn(lock, 'localCheckTimingPolicy')) return 30;
  if (!isDeepStrictEqual(lock.localCheckTimingPolicy, LOCAL_MOCK_CHECK_TIMING_POLICY)) {
    throw new ContractError('setup_error', 'Unsupported recorded check timing policy.');
  }
  // A local policy can never raise live execution or live replay allowances.
  return mode === 'mock' ? 60 : 30;
}
