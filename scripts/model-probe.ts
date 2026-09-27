import { closeSync, constants, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DigestSchema } from '../packages/contracts/src/index.ts';
import { digestBytes } from '../packages/contracts/src/digest.ts';
import { planModelProbe, ProbePlanInputSchema, analyzeModelProbe, verifyProbePlan, ProbeResultSchema } from '../workers/evaluator/model-probe.ts';
import { assertPrivateOperatorPath, readPrivateOperatorJson } from './operator-files.ts';

const TrustSchema = z.strictObject({ planDigest: DigestSchema,
  acceptedResultDigests: z.array(DigestSchema).max(32), acceptedModelProofDigests: z.array(DigestSchema).max(4) });
function outputFile(filename: string, value: unknown, root: string) {
  assertPrivateOperatorPath(filename, root, { allowMissing: true });
  const bytes = Buffer.from(JSON.stringify(value,null,2)+'\n');
  const fd = openSync(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try { writeFileSync(fd,bytes); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(dirname(filename),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
  return digestBytes(bytes);
}
/** Offline metadata only. No candidate execution, network calls or ledger mutations occur. */
export function runModelProbeOperator(args: string[], projectRoot: string, now?: Date) {
  try {
    const [command,...paths] = args;
    if (command !== 'plan' && command !== 'analyze' || paths.length !== (command === 'plan' ? 2 : 4)) throw Error('usage');
    if (new Set(paths.map(path => resolve(path))).size !== paths.length) throw Error('path_collision');
    const output = paths.at(-1)!;
    assertPrivateOperatorPath(output,projectRoot,{allowMissing:true});
    for (const path of paths.slice(0,-1)) assertPrivateOperatorPath(path,projectRoot);
    let result: ReturnType<typeof planModelProbe> | ReturnType<typeof analyzeModelProbe>;
    if (command === 'plan') result = planModelProbe(ProbePlanInputSchema.parse(readPrivateOperatorJson(paths[0]!,{projectRoot})));
    else {
      const plan = verifyProbePlan(readPrivateOperatorJson(paths[0]!,{projectRoot}));
      const rows = z.array(ProbeResultSchema).max(32).parse(readPrivateOperatorJson(paths[1]!,{projectRoot,maximumBytes:20_971_520}));
      const trust = TrustSchema.parse(readPrivateOperatorJson(paths[2]!,{projectRoot}));
      if (trust.planDigest !== plan.planDigest) throw Error('plan_not_accepted');
      result = analyzeModelProbe(plan,rows,{...trust,...(now?{now}:{})});
    }
    const digest = outputFile(output,result,projectRoot);
    return { exitCode: 'status' in result && result.status === 'blocked' ? 2 : 0,
      output: { command, status: 'status' in result ? result.status : 'planned-not-executed',
        planDigest: result.planDigest, artifactDigest: digest, providerCalls: 0, executionAuthorized: false, competitionReady: false } };
  } catch {
    return { exitCode: 2, output: { command: 'model-probe', status: 'rejected', error: { code: 'model_probe_input_or_output_rejected' }, providerCalls: 0, executionAuthorized: false, competitionReady: false } };
  }
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runModelProbeOperator(process.argv.slice(2),fileURLToPath(new URL('../',import.meta.url)));
  console.log(JSON.stringify(result.output,null,2)); process.exitCode = result.exitCode;
}
