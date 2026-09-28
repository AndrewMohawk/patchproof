import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readConfiguration } from '../../../scripts/config.ts';
import { assertPrivateOperatorPath, readPrivateOperatorJson } from '../../../scripts/operator-files.ts';
import { digestJson } from '../../../packages/contracts/src/digest.ts';
import { loadFixtures } from '../../../packages/orchestrator/src/fixtures.ts';
import { RunJournal } from '../../../packages/orchestrator/src/journal.ts';
import { EvidenceStore } from '../../../packages/orchestrator/src/evidence.ts';
import { DockerCheckRunner } from '../../../workers/sandbox/index.ts';
import { createProductServer } from './product-server.ts';
import { acquireCoordinatorLease } from '../../../packages/orchestrator/src/lease.ts';
import { REPEATED_CHECK_PROTOCOL } from '../../../packages/orchestrator/src/repeated-checks.ts';
import { buildOperationalLock, verifyOperationalLock } from '../../../packages/orchestrator/src/operational-lock.ts';
import { LIVE_LOCAL_CHECK_TIMING_POLICY } from '../../../packages/orchestrator/src/local-check-timing.ts';
import { BudgetLedger } from '../../../packages/orchestrator/src/budget-ledger.ts';
import { createLiveLocalCoordinator, LIVE_EXECUTION, LIVE_LIMITS, LIVE_PRICING, LIVE_MODEL } from '../../../packages/orchestrator/src/live-local.ts';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const LiveDemoConfigSchema = z.strictObject({ schemaVersion: z.literal('1.0'), executionAuthorized: z.literal(true),
  publicHostingAuthorized: z.literal(true), stateDirectory: z.string().min(1), ledgerFile: z.string().min(1),
  modelCredentialFile: z.string().min(1), socketFile: z.string().min(1), sourceDigest: hash,
  pricingEvidenceDigest: hash, taskIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).min(1).max(20),
  allowedHosts: z.array(z.enum(['patchproof.andrewmohawk.xyz', 'patchproof.lab.andrewmohawk.xyz'])).min(1).max(2),
});
export async function createLiveApplication(root: URL, configFile: string) {
  const projectRoot = fileURLToPath(root);
  const config = LiveDemoConfigSchema.parse(readPrivateOperatorJson(configFile, { projectRoot }));
  const fixedConfigDigest = digestJson(config);
  const { budget, owner } = await readConfiguration(root);
  if (!owner.publicDemoAuthorized || !owner.eligibilityReviewed || !owner.contributionRightsConfirmed || !owner.aiAssistanceReviewed) throw new Error('live_demo_authorization_missing');
  for (const path of [config.stateDirectory, config.ledgerFile, config.modelCredentialFile, config.socketFile]) {
    if (resolve(path) !== path || path.startsWith(resolve(projectRoot) + '/')) throw new Error('live_demo_external_path_required');
  }
  assertPrivateOperatorPath(config.modelCredentialFile, projectRoot);
  assertPrivateOperatorPath(config.ledgerFile, projectRoot, { database: true });
  await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  assertPrivateOperatorPath(join(config.stateDirectory, 'runs.sqlite'), projectRoot, { allowMissing: true, database: true });
  const release = await acquireCoordinatorLease(config.stateDirectory);
  let ledger: BudgetLedger | undefined, journal: RunJournal | undefined;
  try {
    const operationalLock = buildOperationalLock(projectRoot);
    if (digestJson(operationalLock) !== config.sourceDigest) throw new Error('live_demo_source_changed');
    const discovery = JSON.parse(await readFile(new URL('research/verification/20260927-account-access/discovery.json', root), 'utf8'));
    if (digestJson(discovery) !== config.pricingEvidenceDigest) throw new Error('live_demo_pricing_changed');
    const model = discovery.modelCatalog.nvidiaModels.find((m: {id: string}) => m.id === LIVE_MODEL);
    if (model?.contextLength !== 262144 || model.pricing.prompt !== '0.00000006' || model.pricing.completion !== '0.00000024' || model.pricing.request !== '0') throw new Error('live_demo_pricing_mismatch');
    const checks = new DockerCheckRunner(), status = await checks.status();
    if (!status.available) throw new Error('live_demo_local_runtime_unavailable');
    const all = await loadFixtures(root);
    const fixtures = config.taskIds.map(id => all.find(f => f.id === id && f.split === 'development'));
    if (new Set(config.taskIds).size !== config.taskIds.length || fixtures.some(f => !f || f.visibleCases.length + f.acceptanceCases.length > 22)) throw new Error('live_demo_task_not_available');
    const runtimeLock = { mode: 'live', scope: 'public-curated-development-demo', competitionReady: false,
      model: { id: LIVE_MODEL, providerQuantization: 'fp8', tokenizerPin: null,
        modelCardUrl: 'https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16',
        licenseUrl: 'https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/',
        license: 'NVIDIA Open Model License Agreement', cardScope: 'base-family BF16 card; provider FP8 tokenizer equivalence unverified' },
      inferenceInterface: { version: '20260923-f93df18ab', openApiDigest: 'sha256:c8b46cf3fdd00280b920f55175c05a8ca1db0d723a975c7600ac7c6cb6a26b7f',
        endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions', sampling: 'provider defaults; thinking disabled; no determinism claim' },
      execution: LIVE_EXECUTION, liveLocalCheckTimingPolicy: LIVE_LOCAL_CHECK_TIMING_POLICY, pricing: LIVE_PRICING, sourceDigest: config.sourceDigest, pricingEvidenceDigest: config.pricingEvidenceDigest,
      localCheckImage: status.image, localExecution: status, checkProtocol: REPEATED_CHECK_PROTOCOL,
      repairPolicy: 'immutable-branches-visible-baseline-v1', operationalLock, limits: LIVE_LIMITS,
      sponsorSandboxesVerified: false, calibration: 'unscored-development-only', transportRetries: 0 };
    const verifyRuntime = () => {
      verifyOperationalLock(projectRoot, operationalLock);
      if (digestJson(LiveDemoConfigSchema.parse(readPrivateOperatorJson(configFile, { projectRoot }))) !== fixedConfigDigest) throw new Error('live_demo_config_changed');
    };
    ledger = new BudgetLedger({ filename: config.ledgerFile, budget, existingOnly: true, pendingBillingPolicy: 'allow-covered-inference' });
    journal = new RunJournal(join(config.stateDirectory, 'runs.sqlite'));
    const coordinator = createLiveLocalCoordinator({ fixtures: fixtures.filter(f => f !== undefined), runtimeLock,
      sourceDigest: config.sourceDigest, pricingEvidenceDigest: config.pricingEvidenceDigest, ledger, journal,
      store: new EvidenceStore(join(config.stateDirectory, 'evidence')), checks, verifyRuntime, fetch: globalThis.fetch,
      accountingDirectory: join(config.stateDirectory, 'inference-accounting'), credential: async () => {
        const value = z.strictObject({ token: z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/) }).parse(
          readPrivateOperatorJson(config.modelCredentialFile, { projectRoot, maximumBytes: 32768 }));
        return value.token;
      } });
    await coordinator.recover();
    const server = createProductServer(coordinator, { approvedSpendUsd: budget.maxApprovedSpendUsd, localRuntime: status,
      live: { execution: LIVE_EXECUTION, runtimeLockDigest: digestJson(runtimeLock), limits: LIVE_LIMITS, allowedHosts: config.allowedHosts },
      liveAvailability: () => {
        const snapshot = ledger!.snapshot();
        const remainingRuns = Math.floor(Math.min(Number(snapshot.availableMicros), Number(snapshot.stages.smoke.availableMicros)) / 100000);
        const expired = Date.now() + LIVE_LIMITS.wallTimeLimitSeconds * 1000 > Date.parse(LIVE_PRICING.validUntil);
        const running = coordinator.list().some(run => run.phase !== 'terminal');
        return { enabled: !snapshot.frozen && !expired && !running && remainingRuns > 0, remainingRuns,
          reason: expired ? 'Model pricing verification needs refresh.' : running ? 'A live run is in progress. You can follow its evidence.' :
            snapshot.frozen ? 'Live execution is paused pending accounting review.' : remainingRuns < 1 ? 'The live-demo allowance is exhausted.' : null };
      } });
    return { server, coordinator, config, runtimeLock, close: async () => { try { await coordinator.close(); } finally { ledger!.close(); await release(); } } };
  } catch (error) { journal?.close(); ledger?.close(); await release(); throw error; }
}
