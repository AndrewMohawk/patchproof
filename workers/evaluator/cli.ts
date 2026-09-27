import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { planExperiment } from './protocol.ts';
import type { TaskMetadata } from './protocol.ts';
import { analyzeExperiment } from './analysis.ts';

const [command, ...args] = process.argv.slice(2);
if (command === 'plan') {
  const kind = args[0];
  if (kind !== 'pilot' && kind !== 'final') throw new Error('Usage: node workers/evaluator/cli.ts plan pilot|final OUTPUT.json');
  if (!args[1]) throw new Error('Explicit output path required.');
  const bytes = await readFile(resolve('fixtures/split-manifest.json'));
  const manifest = JSON.parse(bytes.toString()) as { tasks: TaskMetadata[] };
  const digest = (data: Buffer) => 'sha256:' + createHash('sha256').update(data).digest('hex');
  const plan = planExperiment({ kind, tasks: manifest.tasks,
    limits: { inferenceCallLimit: 24, inputTokenLimit: 64_000, outputTokenLimit: 16_000,
      wallTimeLimitSeconds: 900, sandboxCpuSecondsLimit: 900, maxApprovedSpendUsd: 0 },
    sourceManifestDigest: digest(bytes), modelLockDigest: null,
    policyDigest: digest(await readFile(new URL('./protocol.ts', import.meta.url))),
    approvedExperimentBudgetUsd: 0, estimatedExperimentCostUsd: null });
  await writeFile(resolve(args[1]), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`PLANNED ONLY: ${plan.plannedEpisodes} ${kind} episodes; allocated experiment spend $0; account/pricing/oracle-review gates remain.\n`);
} else if (command === 'analyze') {
  if (args.length !== 3) throw new Error('Usage: node workers/evaluator/cli.ts analyze PLAN.json EPISODES.json OUTPUT.json');
  const report = analyzeExperiment(JSON.parse(await readFile(resolve(args[0]!), 'utf8')), JSON.parse(await readFile(resolve(args[1]!), 'utf8')));
  await writeFile(resolve(args[2]!), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`${report.evidenceStatus}: ${report.recordedEpisodes}/${report.plannedEpisodes} episode rows.\n`);
} else throw new Error('Supported commands: plan, analyze. This offline tool never invokes inference or spends money.');
