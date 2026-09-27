import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FixtureSchema, FunctionCaseSchema } from '../../packages/contracts/src/product.ts';
import type { CheckRunner } from '../../packages/contracts/src/product.ts';
import { externalWorkspace } from './fixture-validation.ts';
import { hashJson } from './protocol.ts';

/** Run only after candidate selection is irreversibly recorded. No repair callback exists here.
 * Return aggregate adjudication, while oracle values and logs stay in the external workspace. */
export async function adjudicateSelectedCandidate(options: {
  projectRoot: string; workspace: string; taskId: string; episodeId: string;
  expectedFixtureDigest: string; expectedOracleDigest: string; selectedCandidateDigest: string;
  selectionFinalized: boolean; files: Record<string,string>; checks: CheckRunner; signal: AbortSignal;
}) {
  if (!options.selectionFinalized) throw new Error('Sealed adjudication requires a finalized selection.');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(options.taskId) || !/^[a-zA-Z0-9:_-]{1,200}$/.test(options.episodeId)) throw new Error('Invalid adjudication identity.');
  if (hashJson(options.files) !== options.selectedCandidateDigest) throw new Error('Selected candidate digest changed.');
  const workspace = await externalWorkspace(options.workspace, options.projectRoot);
  const bytes = await readFile(join(workspace, 'fixtures', `${options.taskId}.json`));
  const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  if (digest !== options.expectedFixtureDigest) throw new Error('Frozen fixture digest mismatch.');
  const fixture = FixtureSchema.parse(JSON.parse(bytes.toString()));
  if (fixture.id !== options.taskId) throw new Error('Fixture identity mismatch.');
  const manifest = JSON.parse(await readFile(join(workspace, 'split-manifest.json'), 'utf8')) as { tasks: Array<{ id: string; oracleDigest: string; fixtureDigest: string }> };
  const record = manifest.tasks.find(t => t.id === options.taskId);
  const oracleBytes = await readFile(join(workspace, 'gold', `${options.taskId}.json`));
  if (!record || record.fixtureDigest !== digest || record.oracleDigest !== options.expectedOracleDigest ||
      options.expectedOracleDigest !== 'sha256:' + createHash('sha256').update(oracleBytes).digest('hex')) throw new Error('Frozen oracle digest mismatch.');
  const oracle = JSON.parse(oracleBytes.toString()) as { taskId: string; sealedCases: unknown[] };
  if (oracle.taskId !== options.taskId) throw new Error('Oracle identity mismatch.');
  const cases = [...fixture.visibleCases, ...fixture.acceptanceCases, ...oracle.sealedCases.map(c => FunctionCaseSchema.parse(c))];
  if (!oracle.sealedCases.length || fixture.requirements.some(requirement => !cases.some(c => c.requirementId === requirement.id))) throw new Error('Incomplete independent check coverage.');
  const paths = new Set([...Object.keys(fixture.files), ...Object.keys(options.files)]);
  for (const path of paths) {
    if (!fixture.editAllowlist.includes(path) && fixture.files[path] !== options.files[path]) throw new Error('Protected source changed.');
  }
  if (Object.keys(options.files).some(path => !(path in fixture.files)) || !options.files[fixture.entrypoint]) throw new Error('Unsupported candidate path changes.');
  await mkdir(join(workspace, 'artifacts', 'episodes'), { recursive: true, mode: 0o700 });
  const episodePath = join(workspace, 'artifacts', 'episodes', `${options.episodeId.replaceAll(':','_')}.json`);
  // Reserve once before executing, so a process failure cannot enable oracle retries on another patch.
  await writeFile(episodePath + '.selection', JSON.stringify({ selectedCandidateDigest: options.selectedCandidateDigest, startedAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
  const result = await options.checks.run({ files: options.files, entrypoint: fixture.entrypoint,
    cases, timeoutSeconds: 120 }, options.signal);
  const complete = result.isolation !== 'unavailable' && result.checks.length === cases.length &&
    result.checks.every((c,index) => c.status !== 'error' && c.id === cases[index]!.id && c.requirementId === cases[index]!.requirementId) && !result.infrastructureError;
  const verdict = { episodeId: options.episodeId, taskId: options.taskId, selectedCandidateDigest: options.selectedCandidateDigest,
    outcome: result.infrastructureError ? 'infrastructure_error' : !complete ? 'unverified' : result.checks.every(c => c.status === 'pass') ? 'correct' : 'incorrect',
    sealedChecksExecuted: Boolean(complete), checkCount: result.checks.length,
    passedCheckCount: result.checks.filter(c => c.status === 'pass').length,
    infrastructureError: result.infrastructureError,
    evaluationUsage: { measuredCostUsd: result.measuredCostUsd, sandboxCpuSeconds: result.cpuSeconds },
    sandboxOperationIds: result.operationIds,
    artifactsDigest: hashJson(result), finalOracleFeedbackRounds: 0 as const,
  };
  await writeFile(episodePath,
    JSON.stringify({ verdict, result }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return verdict;
}
