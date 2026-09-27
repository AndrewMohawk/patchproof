import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfiguration } from '../../../scripts/config.ts';
import { loadFixtures } from '../../../packages/orchestrator/src/fixtures.ts';
import { Coordinator } from '../../../packages/orchestrator/src/coordinator.ts';
import { RunJournal } from '../../../packages/orchestrator/src/journal.ts';
import { EvidenceStore } from '../../../packages/orchestrator/src/evidence.ts';
import { createLocalRuntime } from '../../../workers/sandbox/index.ts';
import { createProductServer } from './product-server.ts';
import { acquireCoordinatorLease } from '../../../packages/orchestrator/src/lease.ts';
import { RepeatedCheckRunner, REPEATED_CHECK_PROTOCOL } from '../../../packages/orchestrator/src/repeated-checks.ts';
import { buildOperationalLock, verifyOperationalLock } from '../../../packages/orchestrator/src/operational-lock.ts';
import { LOCAL_MOCK_CHECK_TIMING_POLICY, resolveCheckBatchSeconds } from '../../../packages/orchestrator/src/local-check-timing.ts';

export async function createApplication(root: URL, stateDirectory?: string) {
  const config = await readConfiguration(root);
  resolveCheckBatchSeconds('mock', config.runtime); // Reject unknown policy before runtime construction.
  const directory = stateDirectory ?? fileURLToPath(new URL('.local/product/', root));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const release = await acquireCoordinatorLease(directory);
  try {
  const runtime = await createLocalRuntime();
  const operationalLock = buildOperationalLock(fileURLToPath(root));
  const coordinator = new Coordinator({ fixtures: await loadFixtures(root), runtimeLock: { ...config.runtime,
    ...(runtime.provider.mode === 'mock' ? { localCheckTimingPolicy: LOCAL_MOCK_CHECK_TIMING_POLICY } : {}),
    localCheckImage: runtime.status.image, localExecution: runtime.status, checkProtocol: REPEATED_CHECK_PROTOCOL,
    repairPolicy: 'immutable-branches-visible-baseline-v1', operationalLock }, provider: runtime.provider,
    checks: new RepeatedCheckRunner(runtime.checks), journal: new RunJournal(join(directory, 'runs.sqlite')),
    store: new EvidenceStore(join(directory, 'evidence')), verifyRuntime: () => verifyOperationalLock(fileURLToPath(root), operationalLock) });
  await coordinator.recover();
  const server = createProductServer(coordinator, { approvedSpendUsd: config.budget.maxApprovedSpendUsd, localRuntime: runtime.status });
  return { server, coordinator, runtime, close: async () => { try { await coordinator.close(); } finally { await release(); } } };
  } catch (error) { await release(); throw error; }
}
