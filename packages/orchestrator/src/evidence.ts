import { constants } from 'node:fs';
import { mkdir, open, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { digestBytes, digestJson } from '../../contracts/src/digest.ts';
import { ContractError } from '../../contracts/src/index.ts';
import { parseFixtureForVersion } from '../../contracts/src/product.ts';
import { cloneJsonData } from '../../contracts/src/json-data.ts';
import { ProductEvidenceSchema } from '../../contracts/src/product-validation.ts';
import type { CheckRunner, Fixture, ProductEvidence, ProductRun } from '../../contracts/src/product.ts';
import { fixtureDigests, validatePaths } from './fixtures.ts';
import { applyPatch, createPatch } from './patch.ts';
import { runnerForFrozenProtocol } from './repeated-checks.ts';
import { isDeepStrictEqual } from 'node:util';
import { resolveCheckBatchSeconds } from './local-check-timing.ts';

const normalize = <T>(value: T): T => cloneJsonData(value) as T;
export function buildEvidence(runValue: ProductRun, fixture: Fixture, runtimeLock: unknown): ProductEvidence {
  const run = normalize(runValue);
  const selected = run.candidates.find(candidate => candidate.id === run.selectedCandidateId);
  const artifact = (content: string) => ({ content, digest: digestBytes(content) });
  const files: ProductEvidence['files'] = {
    'patch.diff': artifact(selected?.diff ?? ''),
    'commands.json': artifact(JSON.stringify({ replay: `make reproduce RUN=${run.id}`, isolatedEntrypoint: fixture.entrypoint }, null, 2)),
    'coverage.json': artifact(JSON.stringify(run.coverage, null, 2)),
    'cost-ledger.json': artifact(JSON.stringify({ mode: run.mode, aggregate: run.usage, attempts: run.candidates.map(c => ({ id: c.id, usage: c.usage })) }, null, 2)),
    'events.json': artifact(JSON.stringify(run.events, null, 2)),
  };
  for (const candidate of run.candidates) {
    for (const check of [...candidate.visibleChecks, ...candidate.acceptanceChecks]) {
      files[`candidate-${candidate.id}/${check.id}.log`] = artifact(check.log);
    }
  }
  const body = normalize({ format: 'patchproof-evidence-v2' as const, schemaVersion: run.schemaVersion,
    mode: run.mode, competitionReady: false as const, run, fixture, runtimeLock, files });
  return { ...body, bundleDigest: digestJson(body) };
}

export function verifyEvidence(value: unknown, trustedDigest?: string): ProductEvidence {
  if (!value || typeof value !== 'object') throw new ContractError('digest_mismatch', 'Invalid evidence.');
  const parsed = ProductEvidenceSchema.safeParse(value);
  if (!parsed.success) {
    const legacy = parsed.error.issues.some(issue => issue.message === 'unsupported_legacy_json_key');
    throw new ContractError('digest_mismatch', legacy ? 'Unsupported legacy JSON key; original evidence must not be reinterpreted.' : 'Evidence schema validation failed.');
  }
  const bundle = parsed.data;
  const { bundleDigest, ...body } = bundle;
  if (body.format !== 'patchproof-evidence-v2' || body.competitionReady !== false ||
      bundleDigest !== digestJson(body) || (trustedDigest !== undefined && bundleDigest !== trustedDigest)) {
    throw new ContractError('digest_mismatch', 'Evidence digest mismatch.');
  }
  const fixture = parseFixtureForVersion(bundle.fixture, bundle.schemaVersion);
  const run = bundle.run;
  if (!z.uuid().safeParse(run.id).success || run.phase !== 'terminal' || run.schemaVersion !== body.schemaVersion ||
      run.competitionReady !== false || run.taskId !== fixture.id || run.mode !== body.mode) {
    throw new ContractError('digest_mismatch', 'Evidence/run identity mismatch.');
  }
  const digests = fixtureDigests(fixture, run.schemaVersion);
  if (run.sourceDigest !== digests.sourceDigest || run.policyDigest !== digests.policyDigest ||
      run.runtimeLockDigest !== digestJson(bundle.runtimeLock)) throw new ContractError('digest_mismatch', 'Immutable input mismatch.');
  validatePaths(fixture.files);
  const candidateIds = new Set<number>();
  for (const candidate of run.candidates) {
    if (candidateIds.has(candidate.id)) throw new ContractError('digest_mismatch', 'Duplicate candidate.');
    candidateIds.add(candidate.id);
    validatePaths(candidate.files);
    validatePaths(Object.fromEntries(Object.entries(candidate.files).filter(([path, content]) => fixture.files[path] !== content)), fixture.editAllowlist);
    if (Object.keys(fixture.files).some(path => !(path in candidate.files))) throw new ContractError('digest_mismatch', 'Original source omitted from candidate.');
    if (candidate.diff !== createPatch(fixture.files, candidate.files)) throw new ContractError('digest_mismatch', 'Diff/source mismatch.');
    const declared = [...fixture.visibleCases, ...fixture.acceptanceCases];
    const checked = [...candidate.visibleChecks, ...candidate.acceptanceChecks];
    const complete = checked.length === declared.length && declared.every(c => checked.some(result => result.id === c.id && result.requirementId === c.requirementId));
    if (candidate.accepted !== (complete && checked.every(check => check.status === 'pass'))) throw new ContractError('digest_mismatch', 'Unsupported candidate approval.');
  }
  if (run.selectedCandidateId !== null && !candidateIds.has(run.selectedCandidateId)) throw new ContractError('digest_mismatch', 'Missing selected candidate.');
  const checkIds = new Set([...fixture.visibleCases, ...fixture.acceptanceCases].map(c => c.id));
  const reqIds = new Set(fixture.requirements.map(r => r.id));
  if (run.coverage.length !== reqIds.size || new Set(run.coverage.map(row => row.requirementId)).size !== reqIds.size || run.coverage.some(row => !reqIds.has(row.requirementId) || row.checkIds.some(id => !checkIds.has(id)))) {
    throw new ContractError('digest_mismatch', 'Coverage mapping mismatch.');
  }
  for (const artifact of Object.values(bundle.files)) {
    if (artifact.digest !== digestBytes(artifact.content)) throw new ContractError('digest_mismatch', 'Artifact/log digest mismatch.');
  }
  if (JSON.stringify(buildEvidence(run, fixture, bundle.runtimeLock)) !== JSON.stringify(bundle)) {
    // Canonical digest comparison avoids object key order being an authenticity signal.
    if (buildEvidence(run, fixture, bundle.runtimeLock).bundleDigest !== bundle.bundleDigest) {
      throw new ContractError('digest_mismatch', 'Derived artifact mismatch.');
    }
  }
  return bundle;
}

export class EvidenceStore {
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Evidence directory must be a real directory.');
  }
  async put(bundle: ProductEvidence) {
    verifyEvidence(bundle);
    await this.prepare();
    const path = join(this.directory, bundle.bundleDigest.slice(7) + '.json');
    try {
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(JSON.stringify(bundle, null, 2) + '\n'); } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      verifyEvidence(JSON.parse(await readFile(path, 'utf8')), bundle.bundleDigest);
    }
  }
  async get(digest: string) {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid evidence digest.');
    const file = await open(join(this.directory, digest.slice(7) + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return verifyEvidence(JSON.parse(await file.readFile('utf8')), digest); }
    finally { await file.close(); }
  }
}

export async function reproduceEvidence(bundleValue: unknown, runner: CheckRunner, signal: AbortSignal) {
  const bundle = verifyEvidence(bundleValue);
  const timeoutSeconds = resolveCheckBatchSeconds(bundle.mode, bundle.runtimeLock);
  const selected = bundle.run.candidates.find(c => c.id === bundle.run.selectedCandidateId);
  if (!selected) return { status: 'no_selected_patch', mode: bundle.mode, competitionReady: false, executionPerformed: false };
  const files = await applyPatch(bundle.fixture.files, bundle.files['patch.diff']!.content);
  if (digestJson(files) !== digestJson(selected.files)) throw new ContractError('digest_mismatch', 'Applied patch differs from candidate.');
  const checks = await runnerForFrozenProtocol(runner, bundle.runtimeLock).run({ files, entrypoint: bundle.fixture.entrypoint,
    cases: [...bundle.fixture.visibleCases, ...bundle.fixture.acceptanceCases], timeoutSeconds, contractVersion: bundle.schemaVersion }, signal);
  const expected = [...selected.visibleChecks, ...selected.acceptanceChecks];
  const consistent = checks.infrastructureError === null && checks.checks.length === expected.length && checks.checks.every(check =>
    expected.some(previous => previous.id === check.id && previous.requirementId === check.requirementId && previous.status === check.status && isDeepStrictEqual(previous.actual, check.actual)));
  return { status: consistent ? 'reproduced' : 'mismatch_or_infrastructure_error', mode: bundle.mode,
    competitionReady: false, executionPerformed: checks.isolation !== 'unavailable', isolation: checks.isolation,
    checkCount: checks.checks.length, checks: checks.checks, infrastructureError: checks.infrastructureError };
}
