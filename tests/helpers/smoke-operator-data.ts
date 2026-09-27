import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestBytes, digestJson } from '../../packages/contracts/src/digest.ts';
import { FixtureSchema } from '../../packages/contracts/src/product.ts';
import { SmokeTokenizerArtifactSchema } from '../../packages/orchestrator/src/smoke-tokenizer.ts';
import { BudgetSchema } from '../../scripts/config.ts';
import { SmokeOperatorConfigSchema } from '../../scripts/smoke-operator.ts';
import { operatorJsonDigest } from '../../scripts/operator-files.ts';

export function toyArtifact() {
  return SmokeTokenizerArtifactSchema.parse({ schemaVersion: '1.0', engine: '@huggingface/tokenizers@0.2.0', modelId: 'nvidia/synthetic-unit-model',
    tokenizer: { model: { type: 'WordPiece', unk_token: '[UNK]', continuing_subword_prefix: '##', max_input_chars_per_word: 100,
      vocab: { '[UNK]': 0, hello: 1, world: 2 } }, pre_tokenizer: { type: 'Whitespace' }, decoder: { type: 'WordPiece', prefix: '##', cleanup: true }, normalizer: null, post_processor: null, added_tokens: [] }, tokenizerConfig: {},
    template: { prefix: '', roles: { system: { prefix: '', suffix: ' ' }, user: { prefix: '', suffix: ' ' } }, assistantPrefix: '', addSpecialTokens: false, conservativeMarginTokens: 2 },
    verification: { verifiedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 300_000).toISOString(),
      sourceRefs: ['synthetic://unit-vocabulary'], licenseRefs: ['synthetic://unit-only'], exactAccountTemplateVerified: true, engineCompatibilityVerified: true, conservativeCountVerified: true,
      vectors: [{ messages: [{ role: 'system', content: 'hello' }, { role: 'user', content: 'world' }], expectedCount: 4 },
        { messages: [{ role: 'user', content: '🧪' }], expectedCount: 3 }] } });
}
export function privateJson(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); }
export function operatorData() {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-smoke-operator-unit-'));
  const projectRoot = join(directory, 'project'), state = join(directory, 'private');
  mkdirSync(projectRoot, { mode: 0o700 }); mkdirSync(state, { mode: 0o700 }); mkdirSync(join(projectRoot, 'fixtures', 'development'), { recursive: true });
  const fixture = FixtureSchema.parse({ id: 'smoke-operator-unit', repoId: 'unit', split: 'development', title: 'Synthetic operator unit', description: 'Return the input.',
    requirements: [{ id: 'R01', text: 'Return the input.' }], files: { 'solution.py': 'def f(value): return value\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
    visibleCases: [{ id: 'visible', requirementId: 'R01', function: 'f', args: [1], expected: 1 }], acceptanceCases: [], license: 'CC0-1.0', provenance: 'Invented unit input; no real execution evidence.' });
  privateJson(join(projectRoot, 'fixtures', 'development', 'unit.json'), fixture);
  const artifact = toyArtifact(), now = artifact.verification.verifiedAt, expiry = artifact.verification.validUntil;
  const budget = BudgetSchema.parse({ schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 1,
    ownerApproval: { approvedBy: 'SYNTHETIC TEST', approvedAt: now, expiresAt: expiry, reference: 'Unit-only temporary approval.' }, verifiedCredits: [],
    stages: { smoke: 1, pilot: 0, evaluate: 0, hosting: 0 }, episodeLimits: { inferenceCallLimit: 3, inputTokenLimit: 1000, outputTokenLimit: 500,
      wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 60, candidateBranchLimit: 3 }, note: 'SYNTHETIC TEST ONLY' });
  privateJson(join(projectRoot, 'budget.json'), budget);
  const proof = { verifiedAt: now, evidenceRefs: ['synthetic://not-account-verification'] }, sourceDigest = digestBytes('unit-source');
  const config = SmokeOperatorConfigSchema.parse({ schemaVersion: '1.0', executionAuthorized: true, episodeId: randomUUID(), taskId: fixture.id, variant: 'patchproof',
    limits: { inferenceCallLimit: 3, inputTokenLimit: 1000, outputTokenLimit: 500, wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 1 },
    stateDirectory: state, ledgerFile: join(state, 'budget.sqlite'), budgetDigest: operatorJsonDigest(budget), tokenizerArtifactFile: join(state, 'tokenizer.json'),
    modelCredentialFile: join(state, 'model.json'), sandboxCredentialFile: join(state, 'sandbox.json'),
    model: { modelId: artifact.modelId, accountVerifiedAt: now, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 },
    modelProof: { ...proof, validUntil: expiry, modelId: artifact.modelId, licenseUrl: 'https://example.invalid/unit-license', modelCardUrl: 'https://example.invalid/unit-card',
      contextTokens: 4096, tokenizerDigest: digestJson(artifact), tokenizerModelId: artifact.modelId, conservativeInputCountIncludesTemplate: true,
      outputCapCoversAllBilledTokens: true, tokenRatesCoverAllRequestCharges: true, tokenizerEvidenceRefs: proof.evidenceRefs, pricingEvidenceRefs: proof.evidenceRefs, requestBehaviorEvidenceRefs: proof.evidenceRefs },
    sourceProof: { ...proof, digest: sourceDigest, fixtureDigest: digestJson(fixture) }, cpuProof: { ...proof, overheadCpuSecondsPerOperation: 0, quotaBoundsAllGuestCpu: true, timeoutBoundsGuestExecution: true },
    sandboxVerification: { schemaVersion: '1.0', validUntil: expiry, projectId: 'synthetic-project', imageUuid: '11111111-1111-4111-8111-111111111111', immutableImageDigest: digestBytes('unit-image'),
      account: proof, image: proof, equivalentControls: { isolation: proof, filesystemProtection: proof, resourceCaps: { ...proof, memoryBytes: 134217728, pids: 32, cpuQuota: 0.5 },
        networkDisabled: proof, cancellation: proof, uploadRetention: proof }, billing: { ...proof, conservativeBatchChargeCeilingUsd: 0.05 },
      limits: { maxCases: 2, maxSourceBytes: 262144, maxTimeoutSeconds: 30 } } });
  const filename = join(state, 'config.json');
  privateJson(filename, config); privateJson(config.tokenizerArtifactFile, artifact);
  privateJson(config.modelCredentialFile, { token: 'UNIT-ONLY-MODEL-SECRET' }); privateJson(config.sandboxCredentialFile, { token: 'UNIT-ONLY-SANDBOX-SECRET' });
  return { directory, projectRoot, state, fixture, artifact, budget, config, filename, sourceDigest };
}
