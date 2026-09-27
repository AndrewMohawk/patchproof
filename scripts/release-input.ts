import { z } from 'zod';
import { digestBytes } from '../packages/contracts/src/digest.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import type { Configuration } from './config.ts';
import { readReleaseFile } from './release-files.ts';
import { ReleaseDigestSchema, ReleasePathSchema } from './release-receipts.ts';
import { ReleaseLiveReferenceSchema, resolveReleaseBindings } from './release-protocol.ts';
import type { ReleaseLiveSelection } from './release-protocol.ts';

export const ReleaseInputSchema = z.strictObject({
  receiptPaths: z.array(ReleasePathSchema).max(100), trustedReceiptDigests: z.array(ReleaseDigestSchema).max(100),
  bundles: z.array(z.strictObject({ path: ReleasePathSchema, bundleDigest: ReleaseDigestSchema })).max(20),
  liveProtocol: ReleaseLiveReferenceSchema.optional(),
});
/** Reads explicitly selected repository artifacts; never private operator configurations or credentials. */
export async function readReleaseInput(root: string, path: string, config: Configuration, now?: Date) {
  const input = ReleaseInputSchema.parse(JSON.parse((await readReleaseFile(root, path, 1_048_576)).toString('utf8')));
  let liveProtocol: ReleaseLiveSelection | undefined;
  if (input.liveProtocol) {
    const bytes = await readReleaseFile(root, input.liveProtocol.path, 1_048_576);
    if (digestBytes(bytes) !== input.liveProtocol.digest) throw new Error('release_live_protocol_artifact_changed');
    liveProtocol = { document: JSON.parse(bytes.toString('utf8')), acceptedProofDigest: input.liveProtocol.acceptedProofDigest,
      artifact: { path: input.liveProtocol.path, digest: input.liveProtocol.digest } };
  }
  const { bindings } = resolveReleaseBindings({ operational: buildOperationalLock(root), runtime: config.runtime,
    bundleDigests: input.bundles.map(bundle => bundle.bundleDigest), ...(liveProtocol ? { liveProtocol } : {}), ...(now ? { now } : {}) });
  const receipts = await Promise.all(input.receiptPaths.map(async receipt => JSON.parse((await readReleaseFile(root, receipt, 1_048_576)).toString('utf8'))));
  return { bindings, receipts, trustedReceiptDigests: input.trustedReceiptDigests, bundles: input.bundles, ...(liveProtocol ? { liveProtocol } : {}) };
}
