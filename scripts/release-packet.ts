import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { readReleaseFile } from './release-files.ts';
import { ReleaseBindingsSchema, ReleaseDigestSchema, ReleasePathSchema, ReleaseReceiptSchema, validateReleaseReceipts } from './release-receipts.ts';
import type { ReleaseBindings } from './release-receipts.ts';

export interface ReleasePacketInput {
  root: string;
  bindings: ReleaseBindings;
  receipts: unknown[];
  trustedReceiptDigests: string[];
  bundles: Array<{ path: string; bundleDigest: string }>;
  outputDirectory?: string;
  sourceCommit?: string | null;
  workingTreeDirty: boolean;
  now?: Date;
}
const bundleSelection = z.array(z.strictObject({
  path: z.string().regex(/^artifacts\/[a-f0-9-]{36}\.json$/), bundleDigest: ReleaseDigestSchema,
})).min(2).max(20);
const manifestSchema = z.strictObject({
  format: z.literal('patchproof-local-release-packet'), schemaVersion: z.literal('1.0'), createdAt: z.iso.datetime(),
  status: z.literal('local_preparation'), competitionReady: z.literal(false), publicationAuthorized: z.literal(false), authenticityVerified: z.literal(false),
  bindings: ReleaseBindingsSchema,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).nullable(), workingTreeDirty: z.boolean(),
  evidenceStatus: z.enum(['complete', 'blocked']),
  gates: z.array(z.strictObject({ id: z.string(), status: z.string(), receiptDigest: ReleaseDigestSchema.nullable() })),
  bundles: z.array(z.strictObject({ path: ReleasePathSchema, originalPath: ReleasePathSchema, byteDigest: ReleaseDigestSchema,
    bundleDigest: ReleaseDigestSchema, runId: z.uuid(), mode: z.enum(['mock', 'live']), terminalStatus: z.string(),
    runtimeLockDigest: ReleaseDigestSchema, sourceBinding: z.enum(['current', 'historical_or_unbound']) })),
  files: z.record(ReleasePathSchema, ReleaseDigestSchema),
  packetDigest: ReleaseDigestSchema,
});

async function ensureDirectory(root: string, relative: string) {
  ReleasePathSchema.parse(relative);
  let current = resolve(root);
  for (const part of relative.split('/')) {
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('release_output_not_directory');
  }
  return current;
}

/** Writes a new, local-only packet. This does not execute scans, tests, providers or publication. */
export async function buildReleasePacket(input: ReleasePacketInput) {
  const bindings = ReleaseBindingsSchema.parse(input.bindings);
  const sourceCommit = z.string().regex(/^[a-f0-9]{40}$/).nullable().parse(input.sourceCommit ?? null);
  const workingTreeDirty = z.boolean().parse(input.workingTreeDirty);
  const selections = bundleSelection.parse(input.bundles);
  if (new Set(selections.map(bundle => bundle.path)).size !== selections.length ||
      new Set(selections.map(bundle => bundle.bundleDigest)).size !== selections.length ||
      digestJson(selections.map(bundle => bundle.bundleDigest).sort()) !== digestJson([...bindings.bundleDigests].sort())) throw new Error('release_selected_bundle_mismatch');
  const now = input.now ?? new Date();
  const assessment = await validateReleaseReceipts({ bindings, receipts: input.receipts, trustedReceiptDigests: input.trustedReceiptDigests,
    now, readArtifact: path => readReleaseFile(input.root, path) });
  if (assessment.malformedCount || assessment.gates.find(gate => gate.id === 'release_secrets')?.status !== 'pass') throw new Error('release_bundle_scan_required');
  const scanDigest = assessment.gates.find(gate => gate.id === 'release_secrets')!.receiptDigest;
  const scan = input.receipts.map(value => ReleaseReceiptSchema.safeParse(value)).find(value => value.success && value.data.receiptDigest === scanDigest);
  if (!scan?.success) throw new Error('release_bundle_scan_required');
  const files: Record<string, Buffer> = {};
  const references: z.infer<typeof manifestSchema>['bundles'] = [];
  let totalBytes = 0;
  for (const selection of selections) {
    const bytes = await readReleaseFile(input.root, selection.path);
    totalBytes += bytes.length;
    if (totalBytes > 67_108_864) throw new Error('release_packet_size_limit');
    const byteDigest = digestBytes(bytes);
    if (!scan.data.scannedArtifacts.some(ref => ref.path === selection.path && ref.digest === byteDigest)) throw new Error('release_bundle_not_scanned');
    const bundle = verifyEvidence(JSON.parse(bytes.toString('utf8')), selection.bundleDigest);
    if (selection.path !== `artifacts/${bundle.run.id}.json`) throw new Error('release_bundle_identity_mismatch');
    const runtime = bundle.runtimeLock as Record<string, unknown>;
    const operational = runtime && typeof runtime === 'object' ? runtime.operationalLock as { sources?: unknown; behavior?: unknown } | undefined : undefined;
    const { localCheckImage: _image, localExecution: _execution, checkProtocol: _checks, repairPolicy: _repair, operationalLock: _lock, ...baseRuntime } = runtime;
    const current = operational?.sources !== undefined && operational.behavior !== undefined &&
      digestJson(operational.sources) === bindings.sourceDigest && digestJson(operational.behavior) === bindings.protocolDigest &&
      digestJson(baseRuntime) === bindings.runtimeDigest && bundle.mode === bindings.runtimeMode;
    // Old bundles remain useful failure/history references but cannot masquerade as this source release.
    const path = `bundles/${selection.bundleDigest.slice(7)}.json`;
    files[path] = bytes;
    references.push({ path, originalPath: selection.path, byteDigest, bundleDigest: bundle.bundleDigest, runId: bundle.run.id, mode: bundle.mode,
      terminalStatus: bundle.run.terminalStatus!, runtimeLockDigest: bundle.run.runtimeLockDigest, sourceBinding: current ? 'current' : 'historical_or_unbound' });
  }
  if (!references.some(bundle => bundle.terminalStatus === 'verified_for_declared_checks') || !references.some(bundle => bundle.terminalStatus !== 'verified_for_declared_checks')) throw new Error('release_success_and_failure_required');
  if (new Set(references.map(bundle => bundle.runId)).size !== references.length) throw new Error('release_duplicate_run_identity');
  const currentRelease = references.every(bundle => bundle.sourceBinding === 'current');
  const presentationSet = references.every(bundle => bundle.mode === 'live') && references.filter(bundle => bundle.terminalStatus === 'verified_for_declared_checks').length >= 3;
  files['NOTICES.md'] = Buffer.from(`# Local release preparation\n\nThis packet is private local preparation, not publication or competition approval.\nModel mocks, local execution and synthetic evidence are not sponsor-backed results.\nDigests detect changed content; they do not authenticate people, measurements or claims.\nBundle licenses and provenance remain in each verified bundle. Application and dependency\nredistribution still require the separate license-review gate.\nThe selected bundles were covered by an accepted scan receipt; that is not proof of the\nabsence of every possible secret. Raw receipt text, credentials and arbitrary files are not copied.\nSource bindings: ${currentRelease ? 'all selected bundles match the selected source/protocol digests' : 'historical or unbound bundles are included and do not establish this release'}.\nPublication, demo hosting and entry remain separate owner actions.\n`);
  files['SETUP.md'] = Buffer.from(`# Reproduce from the bound source checkout\n\nSource commit reference: ${sourceCommit ?? 'not supplied'}. Working tree dirty at capture: ${workingTreeDirty}.\nThese labels are supplied by the caller; the operational sources hash is authoritative.\n${workingTreeDirty ? 'The commit alone does not recover working-tree changes; retain the exact source snapshot before handoff.\n' : ''}Use the source checkout whose operational sources hash equals\n\`${bindings.sourceDigest}\`. Pin the recorded runtime and image; do not substitute latest tags.\nThe packet contains selected evidence bundles, not a source archive or dependencies.\nFrom that checkout, the local setup commands are:\n\n\`\`\`sh\nnpm ci --ignore-scripts --no-audit --no-fund\nmake doctor\nmake test\nnpm run check:contracts\n\`\`\`\n\nThese commands are instructions, not a claim that this packet builder ran them.\nProvider smoke, evaluation, hosting and publication are not setup steps.\n`);
  files['VERIFY.md'] = Buffer.from(`# Packet and evidence verification\n\nFrom this packet directory run \`sha256sum --check SHA256SUMS\`.\nUse \`verifyReleasePacket(directory, expectedPacketDigest)\` from the bound source\nto validate the manifest, exact file set and embedded evidence bundle integrity.\nA trusted expected digest must come from separate custody; this packet cannot authenticate itself.\n\nCopy the selected JSON files into the bound checkout's \`artifacts/\` directory\nwith the run UUID filename shown below, then run the corresponding command there.\nHistorical bundles need their own recorded source checkout/runtime.\n\n${references.map(bundle => `- \`${bundle.path}\` -> \`artifacts/${bundle.runId}.json\`; \`make reproduce RUN=${bundle.runId}\` (${bundle.mode}; ${bundle.terminalStatus}; ${bundle.sourceBinding})`).join('\n')}\n\nA failure/abstention may correctly return no selected patch or a nonzero replay result.\nDo not report it as a successful repair. Live replay is NOT authorized by this packet.\n`);
  const body = { format: 'patchproof-local-release-packet' as const, schemaVersion: '1.0' as const, createdAt: now.toISOString(),
    status: 'local_preparation' as const, competitionReady: false as const, publicationAuthorized: false as const, authenticityVerified: false as const,
    bindings, sourceCommit, workingTreeDirty, evidenceStatus: assessment.status === 'complete' && currentRelease && presentationSet ? 'complete' as const : 'blocked' as const,
    gates: assessment.gates.map(({ id, status, receiptDigest }) => ({ id, status, receiptDigest })), bundles: references,
    files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, digestBytes(bytes)])) };
  const manifest = manifestSchema.parse({ ...body, packetDigest: digestJson(body) });
  files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  files['SHA256SUMS'] = Buffer.from(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => `${digestBytes(bytes).slice(7)}  ${path}\n`).join(''));
  const parent = await ensureDirectory(input.root, input.outputDirectory ?? 'artifacts/release-packets');
  const directory = join(parent, manifest.packetDigest.slice(7));
  await mkdir(directory, { mode: 0o700 }); // Exclusive creation; never overwrite an existing packet.
  try {
    await mkdir(join(directory, 'bundles'), { mode: 0o700 });
    for (const [path, bytes] of Object.entries(files)) {
      const handle = await open(join(directory, path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o444);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    }
    await chmod(join(directory, 'bundles'), 0o555);
    await chmod(directory, 0o555);
  } catch (error) { await chmod(directory, 0o700).catch(() => {}); await chmod(join(directory, 'bundles'), 0o700).catch(() => {}); await rm(directory, { recursive: true, force: true }); throw error; }
  return { directory, packetDigest: manifest.packetDigest, manifest, assessment, paidCalls: 0, published: false };
}

export async function verifyReleasePacket(directory: string, expectedPacketDigest: string) {
  ReleaseDigestSchema.parse(expectedPacketDigest);
  const manifest = manifestSchema.parse(JSON.parse((await readReleaseFile(directory, 'manifest.json', 1_048_576)).toString('utf8')));
  const { packetDigest, ...body } = manifest;
  if (packetDigest !== expectedPacketDigest || digestJson(body) !== packetDigest) throw new Error('release_packet_digest_mismatch');
  const expectedFiles = [...Object.keys(manifest.files), 'manifest.json', 'SHA256SUMS'].sort();
  const actual: string[] = [];
  for (const path of await readdir(directory, { recursive: true }) as string[]) {
    const info = await lstat(join(directory, path));
    if (info.isSymbolicLink() || (!info.isFile() && path !== 'bundles')) throw new Error('release_packet_unexpected_path');
    if (info.isFile()) actual.push(path);
  }
  if (digestJson(actual.sort()) !== digestJson(expectedFiles)) throw new Error('release_packet_file_set_mismatch');
  const checksums: string[] = [];
  for (const path of [...Object.keys(manifest.files), 'manifest.json'].sort((a, b) => a.localeCompare(b))) {
    const bytes = await readReleaseFile(directory, path);
    const hash = digestBytes(bytes);
    if (path !== 'manifest.json' && hash !== manifest.files[path]) throw new Error('release_packet_file_digest_mismatch');
    checksums.push(`${hash.slice(7)}  ${path}\n`);
  }
  if ((await readReleaseFile(directory, 'SHA256SUMS')).toString('utf8') !== checksums.join('')) throw new Error('release_packet_checksums_mismatch');
  for (const reference of manifest.bundles) {
    const bytes = await readReleaseFile(directory, reference.path);
    const bundle = verifyEvidence(JSON.parse(bytes.toString('utf8')), reference.bundleDigest);
    if (digestBytes(bytes) !== reference.byteDigest || bundle.run.id !== reference.runId || bundle.mode !== reference.mode || bundle.run.terminalStatus !== reference.terminalStatus ||
        bundle.run.runtimeLockDigest !== reference.runtimeLockDigest) throw new Error('release_packet_bundle_reference_mismatch');
  }
  return { status: 'consistent' as const, packetDigest, authenticityVerified: false as const, publicationAuthorized: false as const };
}
