// Local observation capture for this handoff; no provider calls or publication.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readConfiguration } from '../../../scripts/config.ts';
import { buildOperationalLock } from '../../../packages/orchestrator/src/operational-lock.ts';
import { digestBytes, digestJson } from '../../../packages/contracts/src/digest.ts';
import { resolveReleaseBindings } from '../../../scripts/release-protocol.ts';
import { RELEASE_GATES, ReleaseReceiptSchema } from '../../../scripts/release-receipts.ts';

const root = new URL('../../../', import.meta.url);
const prefix = 'research/verification/20260927-completion-audit/';
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const save = async (path, value) => writeFile(new URL(prefix + path, root), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
// Refuse silent reuse of this one-shot observation directory.
await assert.rejects(access(new URL(prefix + 'release-scan-receipt.json', root)));
for (const path of ['.gitleaks.toml', '.gitleaksignore', 'artifacts/.gitleaks.toml', 'artifacts/.gitleaksignore']) {
  await assert.rejects(access(new URL(path, root)));
}
const browser = await read(prefix + 'browser-report.json');
const abstention = await read(prefix + 'abstention-observation.json');
assert.equal(browser.status, 'passed');
assert.equal(abstention.run.terminalStatus, 'needs_review');
const ids = [...browser.runs.map(run => run.id), abstention.run.id];
assert.equal(new Set(ids).size, 4);
const scanner = '/home/andrewmohawk/.local/bin/gitleaks';
const version = execFileSync(scanner, ['version'], { encoding: 'utf8' }).trim();
const scannerDigest = digestBytes(await readFile(scanner));
const env = { ...process.env };
delete env.GITLEAKS_CONFIG; delete env.GITLEAKS_CONFIG_TOML;
const startedAt = new Date().toISOString();
const selected = [], scannedArtifacts = [], commands = [], evidence = [];
for (const id of ids) {
  assert.match(id, /^[a-f0-9-]{36}$/);
  const path = `artifacts/${id}.json`, bytes = await readFile(new URL(path, root));
  const bundle = JSON.parse(bytes.toString('utf8'));
  assert.equal(bundle.run.id, id);
  const argv = [scanner, 'dir', '--redact', '--no-banner', '--no-color', '--ignore-gitleaks-allow', path];
  const result = spawnSync(argv[0], argv.slice(1), { cwd: fileURLToPath(root), env, encoding: 'utf8', timeout: 60000 });
  const outputPath = prefix + `scan-${id}.log`;
  const outputBytes = Buffer.from((result.stdout ?? '') + (result.stderr ?? ''));
  await writeFile(new URL(outputPath, root), outputBytes, { flag: 'wx' });
  assert.equal(result.status, 0, 'Actual scanner must exit successfully');
  assert.match(outputBytes.toString('utf8'), /no leaks found/);
  const digest = digestBytes(bytes);
  assert.equal(digestBytes(await readFile(new URL(path, root))), digest);
  selected.push({ path, bundleDigest: bundle.bundleDigest });
  scannedArtifacts.push({ path, digest });
  const output = { path: outputPath, digest: digestBytes(outputBytes) };
  evidence.push(output); commands.push({ argv, exitCode: result.status, output });
}
const config = await readConfiguration(root);
const { bindings } = resolveReleaseBindings({ operational: buildOperationalLock(fileURLToPath(root)), runtime: config.runtime,
  bundleDigests: selected.map(item => item.bundleDigest) });
const observedAt = new Date().toISOString();
const body = { schemaVersion: '1.0', id: randomUUID(), gate: 'release_secrets', observedAt,
  expiresAt: new Date(Date.parse(observedAt) + 86400000).toISOString(), bindings,
  scope: { origin: 'actual', execution: 'local', human: 'none', independence: 'same_host' },
  outcome: 'pass', assertions: [...RELEASE_GATES.release_secrets.assertions], evidence, scannedArtifacts, commands };
const receipt = ReleaseReceiptSchema.parse({ ...body, receiptDigest: digestJson(body) });
await save('release-scan-receipt.json', receipt);
await save('release-input.json', { receiptPaths: [prefix + 'release-scan-receipt.json'], trustedReceiptDigests: [receipt.receiptDigest], bundles: selected });
await save('scan-observation.json', { startedAt, finishedAt: observedAt, scanner, reportedVersion: version, scannerDigest,
  configuration: 'Built-in rules; no custom configuration, baseline or ignore file; inline allow comments ignored',
  review: 'Four explicit original exported JSON files scanned; all exits zero and output reports no leaks. Exact bytes unchanged after scan. No arbitrary directory or ZIP scan.',
  limitation: 'Bounded scanner observation, not a guarantee of the absence of all secrets or authorization to publish.',
  selected, receiptDigest: receipt.receiptDigest });
console.log(JSON.stringify({ selected: selected.length, receiptDigest: receipt.receiptDigest, providerCalls: 0, published: false }));
