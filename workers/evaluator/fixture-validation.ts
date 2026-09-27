import { readFile, realpath, writeFile } from 'node:fs/promises';
import { relative, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { FixtureSchema, FunctionCaseSchema } from '../../packages/contracts/src/product.ts';
import type { CheckRunner } from '../../packages/contracts/src/product.ts';

export async function externalWorkspace(workspace: string, projectRoot: string): Promise<string> {
  if (!isAbsolute(workspace)) throw new Error('Evaluator workspace must be an explicit absolute path.');
  const root = await realpath(projectRoot), external = await realpath(workspace);
  const distance = relative(root, external);
  if (distance === '' || (!distance.startsWith('..' + '/') && distance !== '..' && !isAbsolute(distance))) {
    throw new Error('Evaluator workspace must be outside the repair project.');
  }
  return external;
}

export interface OracleValidationSummary {
  schemaVersion: '1.0'; purpose: 'fixture-oracle-preparation'; benchmarkExecuted: false;
  totalTasks: number; goldPassedTasks: number; buggyRejectedTasks: number;
  repeatStableTasks: number; infrastructureFailedTasks: number;
  independentlyReviewed: false; independentReviewStatus: 'NOT RUN';
  runner: 'local_container'; manifestDigest: string; startedAt: string; finishedAt: string;
}

/** Evaluator-side preparation only. Candidate workspaces receive source files and one invocation,
 * never fixture JSON, expected outcomes, gold source, manifests or this module. */
export async function validateFixtureOracles(options: {
  workspace: string; projectRoot: string; checks: CheckRunner; concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}): Promise<OracleValidationSummary> {
  const workspace = await externalWorkspace(options.workspace, options.projectRoot);
  const manifestBytes = await readFile(join(workspace, 'split-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString()) as {
    tasks: Array<{ id: string; fixtureDigest: string; oracleDigest: string }>;
  };
  const digest = (data: Buffer) => 'sha256:' + createHash('sha256').update(data).digest('hex');
  const summary: OracleValidationSummary = {
    schemaVersion: '1.0', purpose: 'fixture-oracle-preparation', benchmarkExecuted: false,
    totalTasks: manifest.tasks.length, goldPassedTasks: 0, buggyRejectedTasks: 0, repeatStableTasks: 0,
    infrastructureFailedTasks: 0, independentlyReviewed: false, independentReviewStatus: 'NOT RUN',
    runner: 'local_container', manifestDigest: digest(manifestBytes), startedAt: new Date().toISOString(), finishedAt: '',
  };
  const reports: unknown[] = [];
  let next = 0, completed = 0;
  async function worker() {
    while (next < manifest.tasks.length) {
      const metadata = manifest.tasks[next++]!;
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(metadata.id)) throw new Error('Invalid task identifier.');
      const fixtureBytes = await readFile(join(workspace, 'fixtures', `${metadata.id}.json`));
      const oracleBytes = await readFile(join(workspace, 'gold', `${metadata.id}.json`));
      if (digest(fixtureBytes) !== metadata.fixtureDigest || digest(oracleBytes) !== metadata.oracleDigest) {
        throw new Error('Evaluator fixture/oracle digest mismatch.');
      }
      const fixture = FixtureSchema.parse(JSON.parse(fixtureBytes.toString()));
      const oracle = JSON.parse(oracleBytes.toString()) as { taskId: string; goldFiles: Record<string, string>; sealedCases: unknown[] };
      if (fixture.id !== metadata.id || oracle.taskId !== metadata.id) throw new Error('Fixture/oracle identity mismatch.');
      const cases = [...fixture.visibleCases, ...fixture.acceptanceCases, ...oracle.sealedCases.map(c => FunctionCaseSchema.parse(c))];
      const invocation = { entrypoint: fixture.entrypoint, cases, timeoutSeconds: 120 };
      const run = (files: Record<string, string>) => checks.run({ ...invocation, files }, new AbortController().signal);
      const gold = await run(oracle.goldFiles), start = await run(fixture.files), repeat = await run(oracle.goldFiles);
      const infra = [gold, start, repeat].some(result => result.infrastructureError !== null || result.isolation !== 'local_container');
      if (infra) summary.infrastructureFailedTasks++;
      if (!infra && gold.checks.length === cases.length && gold.checks.every(c => c.status === 'pass')) summary.goldPassedTasks++;
      if (!infra && start.checks.some(c => c.status === 'fail')) summary.buggyRejectedTasks++;
      if (!infra && JSON.stringify(gold.checks.map(c => [c.id, c.status, c.actual])) === JSON.stringify(repeat.checks.map(c => [c.id, c.status, c.actual]))) summary.repeatStableTasks++;
      reports.push({ id: fixture.id, gold, start, repeat });
      optionsProgress(++completed, summary.totalTasks);
    }
  }
  const checks = options.checks, optionsProgress = options.onProgress ?? (() => {});
  await Promise.all(Array.from({ length: Math.min(6, Math.max(1, options.concurrency ?? 3)) }, () => worker()));
  summary.finishedAt = new Date().toISOString();
  // Detailed outcomes stay beside the sealed oracles. Only summary counts may enter the project.
  await writeFile(join(workspace, 'artifacts', 'oracle-validation-private.json'), JSON.stringify({ summary, reports }, null, 2) + '\n', { mode: 0o600 });
  return summary;
}
