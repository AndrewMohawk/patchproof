import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { DockerCheckRunner } from '../sandbox/index.ts';
import { validateFixtureOracles } from './fixture-validation.ts';

const workspace = process.argv[2];
if (!workspace) throw new Error('Usage: node workers/evaluator/validate-fixtures.ts /absolute/external/workspace');
const summary = await validateFixtureOracles({ workspace, projectRoot: resolve('.'), checks: new DockerCheckRunner(), concurrency: 6,
  onProgress: (completed, total) => { if (completed % 10 === 0) process.stderr.write(`Oracle preparation: ${completed}/${total} tasks executed.\n`); },
});
await writeFile(resolve('fixtures/oracle-validation-summary.json'), JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
if (summary.goldPassedTasks !== 60 || summary.buggyRejectedTasks !== 60 || summary.repeatStableTasks !== 60 || summary.infrastructureFailedTasks) process.exitCode = 1;
