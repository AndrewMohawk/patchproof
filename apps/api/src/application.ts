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

export async function createApplication(root: URL, stateDirectory?: string) {
  const config = await readConfiguration(root);
  const directory = stateDirectory ?? fileURLToPath(new URL('.local/product/', root));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const release = await acquireCoordinatorLease(directory);
  try {
  const runtime = await createLocalRuntime();
  const coordinator = new Coordinator({ fixtures: await loadFixtures(root), runtimeLock: { ...config.runtime,
    localCheckImage: runtime.status.image, localExecution: runtime.status }, provider: runtime.provider,
    checks: runtime.checks, journal: new RunJournal(join(directory, 'runs.sqlite')),
    store: new EvidenceStore(join(directory, 'evidence')) });
  await coordinator.recover();
  const server = createProductServer(coordinator, { approvedSpendUsd: config.budget.maxApprovedSpendUsd, localRuntime: runtime.status });
  return { server, coordinator, runtime, close: async () => { try { await coordinator.close(); } finally { await release(); } } };
  } catch (error) { await release(); throw error; }
}
