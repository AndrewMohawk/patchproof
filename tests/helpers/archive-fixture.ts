import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FixtureSchema } from '../../packages/contracts/src/product.ts';
import type { ProductContractVersion, ProductRun, ProductEvidence } from '../../packages/contracts/src/product.ts';
import { digestJson } from '../../packages/contracts/src/digest.ts';
import { fixtureDigests } from '../../packages/orchestrator/src/fixtures.ts';
import { createPatch } from '../../packages/orchestrator/src/patch.ts';
import { buildEvidence } from '../../packages/orchestrator/src/evidence.ts';
import { evidenceArchiveConfigDigest } from '../../apps/api/src/evidence-archive.ts';

// Original inert metadata only. No model, interpreter, container, or real fixture is used.
export function syntheticArchiveBundle(mode: 'mock' | 'live' = 'live', schemaVersion: ProductContractVersion = '2.1', variant: ProductRun['variant'] = 'patchproof'): ProductEvidence {
  const fixture = FixtureSchema.parse({ id: 'archive-example-01', repoId: 'invented-archive-repository', split: 'development',
    title: 'Synthetic archive example', description: 'Invented review data. No provider run or candidate execution occurred.',
    requirements: [{ id: 'R01', text: 'Preserve the declared value.' }], files: { 'solution.py': '# inert original input\n' }, editAllowlist: ['solution.py'],
    entrypoint: 'solution.py', visibleCases: [{ id: 'invented-check', requirementId: 'R01', function: 'identity', args: [], expected: 'expected' }], acceptanceCases: [],
    license: 'CC0-1.0', provenance: 'Original synthetic metadata for archive validation.' });
  const files = { 'solution.py': '# <img src=x onerror="globalThis.archiveInjected=true">\n' };
  const runtimeLock = { mode, verification: 'synthetic metadata only; no execution', checkProtocol: { version: 'synthetic-unexecuted' } };
  const usage = { inferenceCalls: mode === 'live' ? 1 : 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: mode === 'live' ? null : 0 };
  const run: ProductRun = { schemaVersion, id: randomUUID(), taskId: fixture.id, variant, mode, competitionReady: false,
    notice: 'Synthetic archive verification fixture. No provider or candidate execution occurred.', phase: 'terminal', terminalStatus: 'failed', reason: 'declared_checks_not_satisfied',
    createdAt: '2026-09-27T00:00:00.000Z', finishedAt: '2026-09-27T00:00:01.000Z', ...fixtureDigests(fixture, schemaVersion), runtimeLockDigest: digestJson(runtimeLock),
    limits: { inferenceCallLimit: 3, inputTokenLimit: 100, outputTokenLimit: 100, wallTimeLimitSeconds: 10, sandboxCpuSecondsLimit: 10, maxApprovedSpendUsd: 0 },
    usage: { ...usage, sandboxCpuSeconds: null, costIsEstimate: false, elapsedMs: 1000 }, baselineChecks: null,
    candidates: [{ id: 1, parentId: null, summary: 'Invented rejected record; no model response.', files, diff: createPatch(fixture.files, files),
      visibleChecks: [{ id: 'invented-check', requirementId: 'R01', status: 'fail', message: 'Invented observation differs.', actual: 'observed', expected: 'expected', durationMs: 0, log: 'Synthetic metadata, not an execution log.' }],
      acceptanceChecks: [], accepted: false, rejectionReason: 'Invented mismatch.', modelId: mode === 'live' ? 'synthetic-model-label' : null,
      providerRequestId: mode === 'live' ? 'synthetic-request-label' : null, sandboxOperationIds: [], elapsedMs: 0, usage }],
    selectedCandidateId: 1, coverage: [{ requirementId: 'R01', status: 'fail', checkIds: ['invented-check'] }],
    events: [{ sequence: 1, timestamp: '2026-09-27T00:00:01.000Z', phase: 'terminal', message: 'Synthetic record assembled; nothing executed.' }], sandboxOperationIds: [] };
  return buildEvidence(run, fixture, runtimeLock);
}

export async function prepareArchiveFixture(bundles = [syntheticArchiveBundle()]) {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-archive-test-')), projectRoot = join(directory, 'project');
  const fixtureDirectory = join(projectRoot, 'fixtures', 'development');
  await mkdir(fixtureDirectory, { recursive: true, mode: 0o700 });
  const fixtureFile = join(fixtureDirectory, 'invented.json');
  await writeFile(fixtureFile, JSON.stringify(bundles[0]!.fixture), { mode: 0o600 });
  const bytes = bundles.map(bundle => Buffer.from(JSON.stringify(bundle, null, 2) + '\n'));
  const paths = bundles.map((_bundle, i) => join(directory, `evidence-${i}.json`));
  await Promise.all(paths.map((path, i) => writeFile(path, bytes[i]!, { mode: 0o600 })));
  const config = { schemaVersion: '1.0' as const, kind: 'patchproof-evidence-archive' as const,
    bundles: bundles.map((bundle, i) => ({ path: paths[i]!, runId: bundle.run.id, bundleDigest: bundle.bundleDigest })) };
  const configFile = join(directory, 'archive.json');
  const writeConfig = async () => { await writeFile(configFile, JSON.stringify(config), { mode: 0o600 }); return evidenceArchiveConfigDigest(config); };
  const expectedConfigDigest = await writeConfig();
  return { directory, projectRoot, configFile, expectedConfigDigest, config, bundles, bytes, paths, fixtureFile, writeConfig,
    close: () => rm(directory, { recursive: true, force: true }) };
}
