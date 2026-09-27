import { z } from 'zod';
import { DigestSchema, MOCK_LABEL, MockLabelSchema, RunViewSchema, ContractError } from '../../contracts/src/index.ts';
import { digestBytes, digestJson } from '../../contracts/src/digest.ts';
import { MOCK_LOG } from './coordinator.ts';
import type { RunView } from '../../contracts/src/index.ts';

const BundleBodySchema = z.strictObject({
  ...MockLabelSchema.shape,
  format: z.literal('patchproof-mock-bundle-v1'),
  run: RunViewSchema,
  runtimeLock: z.json(),
  log: z.literal(MOCK_LOG),
  replayScope: z.literal('integrity_only_no_execution'),
});
const BundleSchema = BundleBodySchema.extend({ bundleDigest: DigestSchema });
export type MockBundle = z.infer<typeof BundleSchema>;

export function buildBundle(runValue: RunView, runtimeLock: unknown): MockBundle {
  const run = RunViewSchema.parse(runValue);
  if (!run.evidence) throw new ContractError('evidence_not_ready', 'Wait for the mock record to finish.', 409);
  const body = BundleBodySchema.parse({
    ...MOCK_LABEL, format: 'patchproof-mock-bundle-v1', run, runtimeLock,
    log: MOCK_LOG, replayScope: 'integrity_only_no_execution',
  });
  const bundle = { ...body, bundleDigest: digestJson(body) };
  return verifyBundle(bundle);
}

export function verifyBundle(value: unknown, trustedDigest?: string): MockBundle {
  const result = BundleSchema.safeParse(value);
  if (!result.success) throw new ContractError('digest_mismatch', 'Invalid or inconsistent mock bundle.');
  const { bundleDigest, ...body } = result.data;
  const evidence = body.run.evidence;
  if (body.run.phase !== 'terminal' || !evidence ||
      bundleDigest !== digestJson(body) ||
      (trustedDigest !== undefined && bundleDigest !== trustedDigest) ||
      evidence.modelLockDigest !== digestJson(body.runtimeLock) ||
      evidence.checks.some(c => c.logDigest !== digestBytes(body.log))) {
    throw new ContractError('digest_mismatch', 'Mock bundle integrity check failed.');
  }
  return result.data;
}
