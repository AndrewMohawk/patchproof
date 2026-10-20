import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digestBytes, digestJson } from '../../packages/contracts/src/digest.ts';
import { buildOperationalLock } from '../../packages/orchestrator/src/operational-lock.ts';
import { buildLiveExperimentModelLock, buildLiveExperimentPolicy } from '../../packages/orchestrator/src/live-experiment-policy.ts';
import { REPEATED_CHECK_PROTOCOL } from '../../packages/orchestrator/src/repeated-checks.ts';
import { hashJson } from '../../workers/evaluator/protocol.ts';
import { readConfiguration } from '../../scripts/config.ts';
import { ReleaseLiveProtocolSchema } from '../../scripts/release-protocol.ts';
import type { ReleaseLiveProtocol } from '../../scripts/release-protocol.ts';

/** Invented metadata only. No actual account, credential, provider, participant or corpus is accessed. */
export async function syntheticReleaseData(existingRoot?: string) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'patchproof-release-live-'));
  const now = new Date(), verifiedAt = new Date(now.getTime() - 1000).toISOString(), validUntil = new Date(now.getTime() + 60_000).toISOString();
  const json = (path: string, value: unknown) => writeFile(join(root, path), JSON.stringify(value));
  for (const name of ['packages', 'workers', 'apps', 'scripts', 'research', 'research/product-v3']) await mkdir(join(root, name), { recursive: true });
  for (const path of ['Makefile', 'tsconfig.json', 'package-lock.json', 'scripts/unit.ts']) await writeFile(join(root, path), '{}');
  await json('research/product-v3/model-discovery.json', { scope: 'synthetic-release-test-only', modelId: 'nvidia/synthetic-release-unit' });
  await json('package.json', { name: 'synthetic-release-unit', license: 'UNLICENSED', dependencies: {} });
  await json('budget.json', { schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 0, ownerApproval: null, verifiedCredits: [],
    stages: { smoke: 0, pilot: 0, evaluate: 0, hosting: 0 }, episodeLimits: { inferenceCallLimit: 24, inputTokenLimit: null, outputTokenLimit: null,
      wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: null, candidateBranchLimit: 3 }, note: 'SYNTHETIC UNIT ONLY; no spending approval.' });
  await json('owner-decisions.json', { schemaVersion: '1.0', repository: { name: 'unit', visibility: 'private', creationAuthorized: false, pushAuthorized: false, basis: 'unit-only' },
    eligibilityReviewed: false, contributionRightsConfirmed: false, aiAssistanceReviewed: false, openSourceLicense: null, publicSourceAuthorized: false,
    publicDemoAuthorized: false, entryAuthorized: false, demoOperator: null, confirmedAt: null });
  const modelProof = { verifiedAt, validUntil, modelId: 'nvidia/synthetic-release-unit', licenseUrl: 'https://example.invalid/unit-license', modelCardUrl: 'https://example.invalid/unit-card',
    contextTokens: 4096, tokenizerDigest: digestBytes('synthetic tokenizer'), tokenizerModelId: 'nvidia/synthetic-release-unit',
    conservativeInputCountIncludesTemplate: true as const, outputCapCoversAllBilledTokens: true as const, tokenRatesCoverAllRequestCharges: true as const,
    evidenceRefs: ['synthetic://not-account-evidence'], tokenizerEvidenceRefs: ['synthetic://unit'], pricingEvidenceRefs: ['synthetic://unit'], requestBehaviorEvidenceRefs: ['synthetic://unit'] };
  const runtime = { schemaVersion: '1.0', mode: 'live', observedAt: verifiedAt, local: { node: process.versions.node, npm: 'unit', python: 'unit', architecture: process.arch, platform: process.platform },
    model: { provider: 'nebius-token-factory', baseUrl: 'https://api.tokenfactory.nebius.com/v1/', id: modelProof.modelId, accountVerifiedAt: verifiedAt,
      licenseUrl: modelProof.licenseUrl, modelCardUrl: modelProof.modelCardUrl, contextLimit: 4096, toolOutputBehavior: 'synthetic-reviewed', inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 },
    sandbox: { provider: 'nebius-sandboxes', endpoint: 'https://api.tokenfactory.nebius.com/sandboxes/v1/', sdkVersion: 'synthetic-http-v1',
      imageDigest: digestBytes('synthetic-image'), architecture: process.arch, accountVerifiedAt: verifiedAt, billingUnit: 'synthetic', usdPerBillingUnit: 1,
      networkControlsVerifiedAt: verifiedAt, cancellationVerifiedAt: verifiedAt }, integrationOperationIds: [], sources: ['https://example.invalid/synthetic-only'] };
  await json('runtime-lock.json', runtime);
  for (const version of [1, 2]) await json(`research/contracts-v${version}-lock.json`, { files: { 'scripts/unit.ts': digestBytes('{}') } });
  const config = await readConfiguration(pathToFileURL(root + '/')), operational = buildOperationalLock(root);
  const settings = { maxOutputTokensPerCall: 100, maxModelCallSeconds: 5, maxCheckBatchSeconds: 3, accountingTimeoutSeconds: 5, cleanupTimeoutSeconds: 1, hostOverheadSeconds: 1,
    adjudicationReserve: { wallSeconds: 20, cpuSeconds: 10, spendUsd: 0.05 }, adjudicationBounds: { maxConcurrentCpuUnits: 0.5, maxCostUsdPerSecond: 0, fixedCostUsd: 0.001 } };
  const modelLock = buildLiveExperimentModelLock({ proof: modelProof, accountVerifiedAt: verifiedAt, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 });
  const acceptance = { schemaVersion: '1.0', scope: 'live-experiment-runtime', verifiedAt, validUntil, policyDigest: hashJson(buildLiveExperimentPolicy(settings)), modelLockDigest: digestJson(modelLock),
    sourceDigest: digestJson(operational.sources), sandboxVerificationDigest: digestBytes('synthetic-controls'), cpuProofDigest: digestBytes('synthetic-cpu-proof'),
    calibrationUsedOnlyDevelopmentData: true, noFinalFeedbackUsed: true, samplingDefaultsReviewed: true, hostOverheadBoundVerified: true, evidenceRefs: ['synthetic://no-real-calibration'] };
  const document = ReleaseLiveProtocolSchema.parse({ schemaVersion: '1.0', scope: 'accepted-live-experiment-release', operationalLockDigest: digestJson(operational), runtime: config.runtime,
    settings, modelLock, acceptance });
  const bytes = Buffer.from(JSON.stringify(document)), artifact = { path: 'research/unit-live-protocol.json', digest: digestBytes(bytes) };
  await writeFile(join(root, artifact.path), bytes);
  return { root, now, config, operational, document, selection: { document, acceptedProofDigest: digestJson(document.acceptance), artifact }, json };
}

export function syntheticSmokeLock(live: ReleaseLiveProtocol) {
  return { mode: 'live', scope: 'trusted-smoke-only', calibratedExperiment: false, sourceDigest: live.operationalLockDigest,
    modelId: live.modelLock.modelId, inputUsdPerMillionTokens: live.modelLock.inputUsdPerMillionTokens, outputUsdPerMillionTokens: live.modelLock.outputUsdPerMillionTokens,
    modelProofDigest: live.modelLock.modelProofDigest, tokenizerDigest: live.modelLock.tokenizerDigest, sandboxVerificationDigest: live.acceptance.sandboxVerificationDigest,
    cpuProofDigest: live.acceptance.cpuProofDigest, imageUuid: '11111111-1111-4111-8111-111111111111', imageDigest: live.runtime.sandbox.imageDigest,
    envelope: { synthetic: true }, checkProtocol: REPEATED_CHECK_PROTOCOL, repairPolicy: 'immutable-branches-visible-baseline-v1' };
}
