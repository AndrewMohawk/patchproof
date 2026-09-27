import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { ProductRun } from '../packages/contracts/src/product.ts';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { fixtureDigests } from '../packages/orchestrator/src/fixtures.ts';
import { buildEvidence } from '../packages/orchestrator/src/evidence.ts';
import { createPatch } from '../packages/orchestrator/src/patch.ts';
import { buildReleaseBindings, RELEASE_GATES } from '../scripts/release-receipts.ts';
import { buildReleasePacket, verifyReleasePacket } from '../scripts/release-packet.ts';
import type { ReleasePacketInput } from '../scripts/release-packet.ts';
import { readReleaseFile } from '../scripts/release-files.ts';
import { resolveReleaseBindings } from '../scripts/release-protocol.ts';
import { syntheticReleaseData, syntheticSmokeLock } from './helpers/release-live-data.ts';

const fixture = FixtureSchema.parse({ id: 'release-unit-fixture', repoId: 'synthetic-unit-only', split: 'development',
  title: 'Synthetic release test', description: 'Unit-only data, never a model evaluation or human observation.',
  requirements: [{ id: 'R01', text: 'Return two.' }], files: { 'solution.py': 'def f(): return 1\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [{ id: 'case-one', requirementId: 'R01', function: 'f', args: [], expected: 2 }], acceptanceCases: [], license: 'CC0-1.0', provenance: 'Original synthetic unit fixture.' });

async function prepare(root: string): Promise<ReleasePacketInput> {
  await mkdir(join(root, 'artifacts'), { recursive: true }); await mkdir(join(root, 'research'), { recursive: true });
  const sources = { 'unit.ts': digestBytes('synthetic unit source') }, runtime = { mode: 'mock', description: 'synthetic unit runtime' }, protocol = { unitOnly: true };
  const now = new Date();
  const runtimeLock = { ...runtime, operationalLock: { sources, behavior: protocol } };
  const bundles = [];
  for (const success of [true, false]) {
    const files = { 'solution.py': `def f(): return ${success ? 2 : 0}\n` };
    const check = { id: 'case-one', requirementId: 'R01', status: success ? 'pass' as const : 'fail' as const, message: 'SYNTHETIC test observation', actual: success ? 2 : 0,
      expected: 2, durationMs: 0, log: 'SYNTHETIC: no execution used for this unit bundle.' };
    const run: ProductRun = { schemaVersion: '2.1', id: randomUUID(), taskId: fixture.id, variant: 'patchproof', mode: 'mock', competitionReady: false,
      notice: 'SYNTHETIC UNIT ONLY', phase: 'terminal', terminalStatus: success ? 'verified_for_declared_checks' : 'needs_review', reason: success ? null : 'synthetic_failure',
      createdAt: now.toISOString(), finishedAt: now.toISOString(), ...fixtureDigests(fixture), runtimeLockDigest: digestJson(runtimeLock),
      limits: { inferenceCallLimit: 3, inputTokenLimit: 24000, outputTokenLimit: 6000, wallTimeLimitSeconds: 120, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 0 },
      usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, sandboxCpuSeconds: null, measuredCostUsd: 0, costIsEstimate: false, elapsedMs: 0 }, baselineChecks: null,
      candidates: [{ id: 1, parentId: null, summary: 'SYNTHETIC candidate', files, diff: createPatch(fixture.files, files), visibleChecks: [check], acceptanceChecks: [],
        accepted: success, rejectionReason: success ? null : 'synthetic_failure', modelId: null, providerRequestId: null, sandboxOperationIds: [], elapsedMs: 0,
        usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 } }], selectedCandidateId: 1,
      coverage: [{ requirementId: 'R01', status: success ? 'pass' : 'fail', checkIds: ['case-one'] }],
      events: [{ sequence: 1, phase: 'terminal', timestamp: now.toISOString(), message: 'SYNTHETIC unit terminal state' }], sandboxOperationIds: [] };
    const bundle = buildEvidence(run, fixture, runtimeLock);
    const path = `artifacts/${run.id}.json`;
    await writeFile(join(root, path), JSON.stringify(bundle, null, 2) + '\n');
    bundles.push({ path, bundleDigest: bundle.bundleDigest });
  }
  const bindings = buildReleaseBindings({ sources, runtime, protocol, bundleDigests: bundles.map(bundle => bundle.bundleDigest), runtimeMode: 'mock', liveProtocolFrozen: false });
  return { root, bindings, bundles, receipts: [], trustedReceiptDigests: [], sourceCommit: 'a'.repeat(40), workingTreeDirty: true, now };
}

async function captureTestScan(input: ReleasePacketInput) {
  // This actually executes a deliberately narrow local canary scan of the synthetic JSON files.
  // Its receipt covers that unit-test scan only, never a real release/security review or live gate.
  const scanner = 'import{readFileSync}from"node:fs";for(const p of process.argv.slice(2)){if(readFileSync(p,"utf8").includes("PATCHPROOF_SECRET_CANARY"))process.exit(2)}console.log("UNIT CANARY SCAN ONLY: no canary detected")';
  const script = join(input.root, 'unit-scan.mjs'); await writeFile(script, scanner);
  const paths = [...input.bundles.map(bundle => bundle.path), ...(input.liveProtocol?.artifact ? [input.liveProtocol.artifact.path] : [])];
  const argv = [process.execPath, script, ...paths.map(path => join(input.root, path))];
  const result = await promisify(execFile)(argv[0]!, argv.slice(1));
  const output = { path: 'research/unit-scan.log', digest: digestBytes(result.stdout) };
  await writeFile(join(input.root, output.path), result.stdout);
  const body = { schemaVersion: '1.0', id: randomUUID(), gate: 'release_secrets', observedAt: input.now!.toISOString(), expiresAt: new Date(input.now!.getTime() + 60_000).toISOString(),
    bindings: input.bindings, scope: { origin: 'actual', execution: 'local', human: 'none', independence: 'same_host' }, outcome: 'pass',
    assertions: [...RELEASE_GATES.release_secrets.assertions], evidence: [output],
    scannedArtifacts: await Promise.all(paths.map(async path => ({ path, digest: digestBytes(await readFile(join(input.root, path))) }))),
    commands: [{ argv, exitCode: 0, output }] };
  const receipt = { ...body, receiptDigest: digestJson(body) };
  input.receipts = [receipt]; input.trustedReceiptDigests = [receipt.receiptDigest];
}
async function cleanup(root: string, packet?: string) {
  if (packet) { await chmod(packet, 0o700); await chmod(join(packet, 'bundles'), 0o700); }
  await rm(root, { recursive: true, force: true });
}

test('packet requires scanned selected bytes, copies verified success/failure bundles and remains local blocked preparation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'patchproof-release-packet-')); let packet: string | undefined;
  try {
    const input = await prepare(root);
    await assert.rejects(buildReleasePacket(input), /release_bundle_scan_required/);
    await captureTestScan(input);
    const result = await buildReleasePacket(input); packet = result.directory;
    assert.equal(result.published, false); assert.equal(result.paidCalls, 0); assert.equal(result.manifest.evidenceStatus, 'blocked');
    assert.equal(result.manifest.competitionReady, false); assert.equal(result.manifest.publicationAuthorized, false);
    assert.ok(result.assessment.gates.filter(gate => gate.id !== 'release_secrets').every(gate => gate.status === 'missing'));
    assert.ok(result.manifest.bundles.every(bundle => bundle.mode === 'mock' && bundle.sourceBinding === 'current'));
    assert.equal((await stat(join(packet, 'manifest.json'))).mode & 0o777, 0o444);
    assert.deepEqual(await verifyReleasePacket(packet, result.packetDigest), { status: 'consistent', packetDigest: result.packetDigest, authenticityVerified: false, publicationAuthorized: false });
    assert.match(await readFile(join(packet, 'SETUP.md'), 'utf8'), /npm ci --ignore-scripts --no-audit --no-fund/);
    assert.match(await readFile(join(packet, 'SETUP.md'), 'utf8'), /Working tree dirty at capture: true/);
    await assert.rejects(readFile(join(packet, 'unit-scan.mjs')), /ENOENT/);
    await assert.rejects(buildReleasePacket(input), /EEXIST/);
    await chmod(join(packet, 'NOTICES.md'), 0o644); await writeFile(join(packet, 'NOTICES.md'), 'tampered');
    await assert.rejects(verifyReleasePacket(packet, result.packetDigest), /file_digest_mismatch/);
  } finally { await cleanup(root, packet); }
});

test('changed bundle bytes after scan and selected digest substitution fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'patchproof-release-packet-'));
  try {
    const input = await prepare(root); await captureTestScan(input);
    await assert.rejects(buildReleasePacket({ ...input, bundles: [{ ...input.bundles[0]!, bundleDigest: digestBytes('wrong') }, input.bundles[1]!] }), /selected_bundle_mismatch/);
    const path = join(root, input.bundles[0]!.path); await writeFile(path, (await readFile(path, 'utf8')) + '\n');
    await assert.rejects(buildReleasePacket(input), /release_bundle_scan_required/);
  } finally { await cleanup(root); }
});

test('historical source references remain explicitly blocked and tampered evidence cannot be packaged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'patchproof-release-packet-')); let packet: string | undefined;
  try {
    const input = await prepare(root); input.bindings.sourceDigest = digestBytes('different current release'); await captureTestScan(input);
    const result = await buildReleasePacket(input); packet = result.directory;
    assert.ok(result.manifest.bundles.every(bundle => bundle.sourceBinding === 'historical_or_unbound'));
    assert.equal(result.manifest.evidenceStatus, 'blocked');
    const path = join(root, input.bundles[0]!.path);
    const bundle = JSON.parse(await readFile(path, 'utf8')); bundle.run.candidates[0].files['solution.py'] = 'tampered'; await writeFile(path, JSON.stringify(bundle));
    await captureTestScan(input);
    await assert.rejects(buildReleasePacket(input), /digest mismatch/i);
  } finally { await cleanup(root, packet); }
});

test('repository evidence reads reject traversal, symlinks, oversized files and directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'patchproof-release-files-'));
  try {
    await writeFile(join(root, 'value.txt'), 'safe'); await symlink(join(root, 'value.txt'), join(root, 'link.txt'));
    await assert.rejects(readReleaseFile(root, '../outside'));
    await assert.rejects(readReleaseFile(root, 'link.txt'), /symlink/);
    await assert.rejects(readReleaseFile(root, 'value.txt', 2), /size/);
    await mkdir(join(root, 'folder')); await assert.rejects(readReleaseFile(root, 'folder'), /size_or_type/);
  } finally { await cleanup(root); }
});

test('versioned live protocol packet accepts matching smoke presentation scope only after its metadata is scanned, without granting experiment completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'patchproof-release-packet-live-')); let packet: string | undefined;
  try {
    const input = await prepare(root), s = await syntheticReleaseData(root), runtime = syntheticSmokeLock(s.document);
    // These are explicitly invented live-shaped contract bundles, not observations of any provider.
    for (const selected of input.bundles) {
      const existing = JSON.parse(await readFile(join(root, selected.path), 'utf8'));
      const run: ProductRun = { ...existing.run, mode: 'live', runtimeLockDigest: digestJson(runtime) };
      const bundle = buildEvidence(run, fixture, runtime); selected.bundleDigest = bundle.bundleDigest;
      await writeFile(join(root, selected.path), JSON.stringify(bundle) + '\n');
    }
    input.now = s.now;
    input.bindings = resolveReleaseBindings({ operational: s.operational, runtime: s.config.runtime,
      bundleDigests: input.bundles.map(bundle => bundle.bundleDigest), liveProtocol: s.selection, now: s.now }).bindings;
    await captureTestScan(input);
    await assert.rejects(buildReleasePacket(input), /live_protocol_required/);
    input.liveProtocol = s.selection;
    await assert.rejects(buildReleasePacket(input), /live_protocol_not_scanned/);
    await captureTestScan(input);
    const result = await buildReleasePacket(input); packet = result.directory;
    assert.equal(result.manifest.schemaVersion, '1.1'); assert.equal(result.manifest.evidenceStatus, 'blocked');
    assert.match(await readFile(join(packet, 'NOTICES.md'), 'utf8'), /Smoke bundles retain their own three-proposal policy/);
    assert.ok(result.manifest.bundles.every(bundle => bundle.sourceBinding === 'compatible_presentation' && bundle.executionScope === 'trusted-smoke-only'));
    assert.equal(result.assessment.gates.find(gate => gate.id === 'pilot')?.status, 'missing');
    assert.equal(result.assessment.gates.find(gate => gate.id === 'sealed_evaluation')?.status, 'missing');
    assert.equal(result.manifest.competitionReady, false); assert.equal(result.manifest.publicationAuthorized, false);
    assert.equal((await verifyReleasePacket(packet, result.packetDigest)).status, 'consistent');
    assert.deepEqual(JSON.parse(await readFile(join(packet, 'live-protocol.json'), 'utf8')), s.document);
  } finally { await cleanup(root, packet); }
});


test('default CLI refuses live replay before any local checker fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'patchproof-release-live-replay-'));
  let exported: string | undefined;
  try {
    const input = await prepare(root), selected = input.bundles[0]!;
    const existing = JSON.parse(await readFile(join(root, selected.path), 'utf8'));
    const runtimeLock = { mode: 'live', scope: 'SYNTHETIC CLI refusal control only', localCheckImage: 'synthetic-never-run' };
    const run: ProductRun = { ...existing.run, mode: 'live', runtimeLockDigest: digestJson(runtimeLock) };
    const bundle = buildEvidence(run, fixture, runtimeLock);
    const directory = fileURLToPath(new URL('../artifacts/', import.meta.url));
    await mkdir(directory, { recursive: true });
    exported = join(directory, `${run.id}.json`);
    await writeFile(exported, JSON.stringify(bundle), { flag: 'wx', mode: 0o600 });
    const command = promisify(execFile);
    await assert.rejects(command(process.execPath, [fileURLToPath(new URL('../scripts/product-cli.ts', import.meta.url)), 'reproduce', run.id],
      { env: { ...process.env, PATH: '/nonexistent-patchproof-test-path' } }), error => {
      const result = error as Error & { code: number; stdout: string };
      assert.equal(result.code, 2);
      const value = JSON.parse(result.stdout);
      assert.equal(value.mode, 'live'); assert.equal(value.error.code, 'live_replay_configuration_required');
      return true;
    });
  } finally {
    if (exported) await rm(exported, { force: true });
    await cleanup(root);
  }
});
