import { mkdir, readFile, open, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
import { createLiveLocalCoordinator, LIVE_EXECUTION, LIVE_LIMITS, LIVE_PRICING, LIVE_MODEL, LIVE_RESERVATION_MICROS } from '../../../packages/orchestrator/src/live-local.ts';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const LIVE_PRICING_EVIDENCE_PATH = 'research/verification/20261014-live-pricing-refresh/pricing-evidence.json';
const LivePricingEvidenceSchema = z.object({ schemaVersion: z.literal('1.0'),
  verifiedAt: z.iso.datetime(), validUntil: z.iso.datetime(),
  provider: z.literal('nebius-token-factory'), modelId: z.string(),
  catalog: z.object({ contextTokens: z.number().int().positive(), quantization: z.string(),
    inputUsdPerMillionTokens: z.number().nonnegative(), outputUsdPerMillionTokens: z.number().nonnegative(),
    requestFeeUsd: z.number().nonnegative() }),
  spendBoundary: z.object({ perRunReservationUsd: z.number().positive(), inferenceCallsPerRun: z.number().int().positive() }),
});
export function verifyLivePricingEvidence(value: unknown, expectedDigest: string) {
  if (digestJson(value) !== expectedDigest) throw new Error('live_demo_pricing_changed');
  const evidence = LivePricingEvidenceSchema.parse(value);
  if (evidence.modelId !== LIVE_MODEL || evidence.verifiedAt !== LIVE_PRICING.verifiedAt ||
      evidence.validUntil !== LIVE_PRICING.validUntil || evidence.catalog.contextTokens !== LIVE_PRICING.contextTokens ||
      evidence.catalog.quantization !== 'fp4' || evidence.catalog.inputUsdPerMillionTokens !== LIVE_PRICING.inputUsdPerMillionTokens ||
      evidence.catalog.outputUsdPerMillionTokens !== LIVE_PRICING.outputUsdPerMillionTokens ||
      evidence.catalog.requestFeeUsd !== LIVE_PRICING.requestFeeUsd ||
      evidence.spendBoundary.perRunReservationUsd !== LIVE_LIMITS.maxApprovedSpendUsd ||
      evidence.spendBoundary.inferenceCallsPerRun !== LIVE_LIMITS.inferenceCallLimit) throw new Error('live_demo_pricing_mismatch');
  return evidence;
}
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
    const pricingEvidence = JSON.parse(await readFile(new URL(LIVE_PRICING_EVIDENCE_PATH, root), 'utf8'));
    verifyLivePricingEvidence(pricingEvidence, config.pricingEvidenceDigest);
    const discovery = JSON.parse(await readFile(new URL('research/product-v3/model-discovery.json', root), 'utf8'));
    const checks = new DockerCheckRunner(), status = await checks.status();
    if (!status.available) throw new Error('live_demo_local_runtime_unavailable');
    // Execute a fixed benign control under the service's real UID and umask before
    // accepting paid work. Image metadata alone does not establish usable isolation.
    const readinessId = randomUUID();
    const readiness = await checks.run({ files: { 'startup/check.py': 'def ready():\n    return "patchproof-ready"\n' },
      entrypoint: 'startup/check.py', cases: [{ id: 'runtime-readiness', requirementId: 'R01', function: 'ready',
        args: [], kwargs: {}, expected: 'patchproof-ready', assertArgsUnchanged: true }],
      timeoutSeconds: 20, contractVersion: '2.2', ownerRunId: readinessId }, AbortSignal.timeout(25000));
    await writeFile(join(config.stateDirectory, `startup-${readinessId}.json`), JSON.stringify({
      checkedAt: new Date().toISOString(), sourceDigest: config.sourceDigest, providerCalls: 0, ...readiness }, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
    if (readiness.infrastructureError || readiness.checks.length !== 1 || readiness.checks[0]?.status !== 'pass') {
      throw new Error('live_demo_execution_readiness_failed');
    }
    const all = await loadFixtures(root);
    const fixtures = config.taskIds.map(id => all.find(f => f.id === id && f.split === 'development'));
    if (new Set(config.taskIds).size !== config.taskIds.length || fixtures.some(f => !f || f.visibleCases.length + f.acceptanceCases.length > 22)) throw new Error('live_demo_task_not_available');
    const runtimeLock = { mode: 'live', scope: 'public-curated-development-demo', competitionReady: false,
      model: { id: LIVE_MODEL, providerQuantization: 'fp4', tokenizerPin: null,
        modelCardUrl: discovery.upstreamModelCard.url, modelCardRevision: discovery.upstreamModelCard.revision,
        hostedWeightsRevision: null, licenseUrl: discovery.license.url, license: discovery.license.name,
        cardScope: 'upstream NVFP4 card; hosted weights revision and tokenizer equivalence unverified' },
      inferenceInterface: { version: '20260923-f93df18ab', openApiDigest: 'sha256:c8b46cf3fdd00280b920f55175c05a8ca1db0d723a975c7600ac7c6cb6a26b7f',
        endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions', sampling: 'provider defaults; no thinking override; hidden reasoning not retained; no determinism claim' },
      execution: LIVE_EXECUTION, liveLocalCheckTimingPolicy: LIVE_LOCAL_CHECK_TIMING_POLICY, pricing: LIVE_PRICING, sourceDigest: config.sourceDigest, pricingEvidenceDigest: config.pricingEvidenceDigest,
      localCheckImage: status.image, localExecution: status, checkProtocol: REPEATED_CHECK_PROTOCOL,
      repairPolicy: 'immutable-branches-visible-baseline-v1', operationalLock, limits: LIVE_LIMITS,
      sponsorSandboxesVerified: false, calibration: 'unscored-development-only', transportRetries: 0 };
    const verifyRuntime = () => {
      verifyOperationalLock(projectRoot, operationalLock);
      if (digestJson(LiveDemoConfigSchema.parse(readPrivateOperatorJson(configFile, { projectRoot }))) !== fixedConfigDigest) throw new Error('live_demo_config_changed');
    };
    ledger = new BudgetLedger({ filename: config.ledgerFile, budget, existingOnly: true, pendingBillingPolicy: 'allow-covered-inference' });
    const journalPath = join(config.stateDirectory, 'runs.sqlite');
    try { const file = await open(journalPath, 'wx', 0o600); await file.close(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    journal = new RunJournal(journalPath);
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
        const remainingRuns = Math.floor(Math.min(Number(snapshot.availableMicros), Number(snapshot.stages.smoke.availableMicros)) / Number(LIVE_RESERVATION_MICROS));
        const expired = Date.now() + LIVE_LIMITS.wallTimeLimitSeconds * 1000 > Date.parse(LIVE_PRICING.validUntil);
        const running = coordinator.list().some(run => run.phase !== 'terminal');
        return { enabled: !snapshot.frozen && !expired && !running && remainingRuns > 0, remainingRuns,
          reason: expired ? 'Model pricing verification needs refresh.' : running ? 'A live run is in progress. You can follow its evidence.' :
            snapshot.frozen ? 'Live execution is paused pending accounting review.' : remainingRuns < 1 ? 'The live-demo allowance is exhausted.' : null };
      } });
    return { server, coordinator, config, runtimeLock, close: async () => { try { await coordinator.close(); } finally { ledger!.close(); await release(); } } };
  } catch (error) { journal?.close(); ledger?.close(); await release(); throw error; }
}
