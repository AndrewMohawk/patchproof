import { constants, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { FeeEvidenceSchema, makePricingReceipt, PricingMonitorStateSchema, RENEWABLE_PRICING_POLICY, verifyCatalogRecord } from '../packages/orchestrator/src/renewable-pricing.ts';
import { LiveDemoConfigSchema } from '../apps/api/src/live-application.ts';
import { assertPrivateOperatorPath, readPrivateOperatorJson } from './operator-files.ts';
import { readConfiguration } from './config.ts';
import { acquireCoordinatorLease } from '../packages/orchestrator/src/lease.ts';

export function publishPricingState(path: string, state: z.infer<typeof PricingMonitorStateSchema>, projectRoot: string) {
  PricingMonitorStateSchema.parse(state);
  assertPrivateOperatorPath(path, projectRoot, { allowMissing: true });
  const bytes = JSON.stringify(state, null, 2) + '\n', digest = digestJson(state);
  const immutable = join(dirname(path), `pricing-state-${digest.slice(7)}.json`);
  assertPrivateOperatorPath(immutable, projectRoot, { allowMissing: true });
  let fd: number | undefined;
  try { fd = openSync(immutable, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, bytes); fsyncSync(fd);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || digestJson(readPrivateOperatorJson(immutable, { projectRoot })) !== digest) throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const file = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(file, bytes); fsyncSync(file); } finally { closeSync(file); }
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  return digest;
}
export async function readBoundedCatalog(fetcher: typeof fetch, token: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetcher(RENEWABLE_PRICING_POLICY.catalogEndpoint, { method: 'GET', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok || !response.body) throw Error('catalog_unavailable');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > 1_048_576) throw Error('catalog_unavailable'); chunks.push(next.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function verifyLivePricingOnce(root: URL, configFile: string, fetcher: typeof fetch = globalThis.fetch) {
  const projectRoot = fileURLToPath(root);
  const config = LiveDemoConfigSchema.parse(readPrivateOperatorJson(configFile, { projectRoot }));
  if (!config.pricingVerification) throw Error('renewable_pricing_not_configured');
  const stateFile = config.pricingVerification.stateFile;
  assertPrivateOperatorPath(stateFile, projectRoot, { allowMissing: true });
  const release = await acquireCoordinatorLease(dirname(stateFile));
  try {
    let reason: 'configuration_invalid' | 'fee_evidence_invalid' | 'catalog_unavailable' | 'catalog_mismatch' | 'verification_failed' = 'configuration_invalid';
    try {
      const { budget } = await readConfiguration(root);
      if (budget.maxApprovedSpendUsd !== RENEWABLE_PRICING_POLICY.maximumTotalUsd || budget.stages.smoke !== RENEWABLE_PRICING_POLICY.maximumTotalUsd || budget.stages.pilot !== 0 || budget.stages.evaluate !== 0 || budget.stages.hosting !== 0 ||
          !budget.ownerApproval?.expiresAt || Date.now() + 600_000 > Date.parse(budget.ownerApproval.expiresAt) ||
          digestJson(buildOperationalLock(projectRoot)) !== config.sourceDigest) throw Error('configuration_invalid');
      const bindings = { sourceDigest: config.sourceDigest, budgetDigest: digestJson(budget), approvalExpiresAt: budget.ownerApproval.expiresAt };
      reason = 'fee_evidence_invalid';
      const fee = FeeEvidenceSchema.parse(readPrivateOperatorJson(config.pricingVerification.feeEvidenceFile, { projectRoot, maximumBytes: 32768 }));
      const now = Date.now(), start = Date.parse(fee.verifiedAt), end = Date.parse(fee.validUntil);
      if (start > now || end - start > RENEWABLE_PRICING_POLICY.maximumFeeAgeMs || end <= start || now + 600_000 > end) throw Error('fee_evidence_invalid');
      reason = 'catalog_unavailable';
      const credential = z.strictObject({ token: z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/) }).parse(
        readPrivateOperatorJson(config.modelCredentialFile, { projectRoot, maximumBytes: 32768 }));
      const catalog = await readBoundedCatalog(fetcher, credential.token, AbortSignal.timeout(15_000));
      reason = 'catalog_mismatch'; verifyCatalogRecord(catalog);
      reason = 'verification_failed'; const receipt = makePricingReceipt(catalog, fee, bindings);
      const state = { status: 'verified' as const, receipt };
      const digest = publishPricingState(stateFile, state, projectRoot);
      return { status: 'verified' as const, digest, verifiedAt: receipt.verifiedAt, validUntil: receipt.validUntil, feeValidUntil: fee.validUntil, paidCalls: 0 };
    } catch {
      // A failed observation replaces the previous ready state immediately. If the
      // write itself fails, the prior short receipt still expires; never unpause.
      publishPricingState(stateFile, { status: 'blocked', checkedAt: new Date().toISOString(), reason }, projectRoot);
      return { status: 'blocked' as const, reason, paidCalls: 0 };
    }
  } finally { await release(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  if (process.argv.length !== 3) throw Error('explicit_private_config_required');
  const result = await verifyLivePricingOnce(new URL('../', import.meta.url), process.argv[2]!);
  console.log(JSON.stringify(result)); if (result.status !== 'verified') process.exitCode = 1;
}
