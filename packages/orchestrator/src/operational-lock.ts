import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { digestBytes, digestJson } from '../../contracts/src/digest.ts';
import { ContractError } from '../../contracts/src/index.ts';
import { REPEATED_CHECK_PROTOCOL } from './repeated-checks.ts';

const roots = ['packages', 'workers', 'apps', 'scripts'];
const topFiles = ['Makefile', 'tsconfig.json', 'package.json', 'package-lock.json', 'runtime-lock.json', 'budget.json', 'owner-decisions.json',
  'research/product-v3/model-discovery.json'];
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const OperationalLockSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), scope: z.literal('local-unscored-development'), liveProtocolFrozen: z.literal(false),
  sources: z.record(z.string(), hash),
  behavior: z.strictObject({
    modelPromptAndRequest: z.literal('workers/repair/index.ts'), modelSampling: z.literal('provider-defaults-unverified'),
    modelSeed: z.null(), determinismClaimed: z.literal(false),
    baseline: z.literal('progressive-source-visible-feedback-latest-candidate'),
    checksOnly: z.literal('progressive-source-acceptance-feedback-latest-candidate'),
    patchproof: z.literal('original-source-acceptance-feedback-best-declared-score'),
    tieBreak: z.literal('earliest-candidate'), maximumCandidates: z.literal(3),
    inferenceAllowance: z.literal('one-shared-episode-budget'), finalOracleFeedback: z.literal(0),
    checkProtocol: z.literal('repeat-observations-v1'),
  }),
});
export type OperationalLock = z.infer<typeof OperationalLockSchema>;

/** Binds actual local code and configuration; does not assert unverified live model behavior. */
export function buildOperationalLock(root: string): OperationalLock {
  const files = [...topFiles];
  for (const directory of roots) {
    for (const item of readdirSync(join(root, directory), { recursive: true }) as string[]) {
      const path = `${directory}/${item}`;
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) throw new ContractError('setup_error', 'Operational source trees cannot contain symlinks.');
      if (stat.isFile() && /\.(?:ts|js|mjs|cjs|css|html|py|sh|json)$/.test(item)) files.push(path);
    }
  }
  return OperationalLockSchema.parse({ schemaVersion: '1.0', scope: 'local-unscored-development', liveProtocolFrozen: false,
    sources: Object.fromEntries(files.sort().map(path => [path, digestBytes(readFileSync(join(root, path)))])),
    behavior: { modelPromptAndRequest: 'workers/repair/index.ts', modelSampling: 'provider-defaults-unverified', modelSeed: null,
      determinismClaimed: false, baseline: 'progressive-source-visible-feedback-latest-candidate',
      checksOnly: 'progressive-source-acceptance-feedback-latest-candidate', patchproof: 'original-source-acceptance-feedback-best-declared-score',
      tieBreak: 'earliest-candidate', maximumCandidates: 3, inferenceAllowance: 'one-shared-episode-budget', finalOracleFeedback: 0,
      checkProtocol: REPEATED_CHECK_PROTOCOL.id } });
}

export function verifyOperationalLock(root: string, value: unknown, expectedDigest?: string): OperationalLock {
  const parsed = OperationalLockSchema.safeParse(value);
  if (!parsed.success) throw new ContractError('setup_error', 'Unsupported operational lock.');
  if (expectedDigest && digestJson(value) !== expectedDigest) throw new ContractError('digest_mismatch', 'Operational lock digest mismatch.');
  const current = buildOperationalLock(root);
  if (digestJson(current) !== digestJson(value)) throw new ContractError('digest_mismatch', 'Operational source/configuration changed. Use the recorded source checkout or restart development with a new lock.');
  return parsed.data;
}
