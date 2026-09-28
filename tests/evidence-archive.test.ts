import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, link, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEvidenceArchive, evidenceArchiveConfigDigest } from '../apps/api/src/evidence-archive.ts';
import { buildEvidence } from '../packages/orchestrator/src/evidence.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { fixtureDigests } from '../packages/orchestrator/src/fixtures.ts';
import { prepareArchiveFixture, syntheticArchiveBundle } from './helpers/archive-fixture.ts';

async function openArchive(input: Awaited<ReturnType<typeof prepareArchiveFixture>>) {
  const app = await createEvidenceArchive(input);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  return { ...app, base: `http://127.0.0.1:${address.port}`,
    close: async () => { app.server.closeAllConnections(); await new Promise<void>(done => app.server.close(() => done())); } };
}

test('archive serves exact pinned live and historical mock bytes with explicit read-only capabilities', async t => {
  const fixture = await prepareArchiveFixture([syntheticArchiveBundle('live'), syntheticArchiveBundle('mock', '2.0', 'baseline')]); t.after(fixture.close);
  const app = await openArchive(fixture); t.after(app.close);
  const tasks = await (await fetch(app.base + '/tasks')).json();
  assert.equal(tasks.mode, 'archive'); assert.equal(tasks.realExecutionEnabled, false); assert.equal(tasks.authenticityVerified, false);
  assert.deepEqual(tasks.capabilities, { createRuns: false, cancelRuns: false, replay: false, streamEvents: false });
  assert.deepEqual(tasks.recordedModes, ['live', 'mock']); assert.equal(tasks.tasks.length, 1);
  assert.ok('files' in tasks.tasks[0] && 'examples' in tasks.tasks[0] && !('acceptanceCases' in tasks.tasks[0]));
  assert.ok(!JSON.stringify(tasks).includes(fixture.directory));
  const history = await (await fetch(app.base + '/runs')).json(); assert.equal(history.runs.length, 2);
  for (const [i, bundle] of fixture.bundles.entries()) {
    const response = await fetch(`${app.base}/runs/${bundle.run.id}/evidence`);
    assert.equal(response.headers.get('x-patchproof-digest'), bundle.bundleDigest);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture.bytes[i]);
    assert.deepEqual(await (await fetch(`${app.base}/runs/${bundle.run.id}`)).json(), bundle.run);
  }
});

test('opened archive snapshots survive later evidence, configuration, fixture and caller metadata changes', async t => {
  const fixture = await prepareArchiveFixture(); t.after(fixture.close);
  const app = await openArchive(fixture); t.after(app.close);
  const before = await (await fetch(app.base + '/tasks')).text();
  app.manifest.capabilities.createRuns = true as false; app.manifest.recordedModes.push('changed');
  await writeFile(fixture.configFile, '{}'); await unlink(fixture.paths[0]!);
  await writeFile(fixture.fixtureFile, JSON.stringify({ ...fixture.bundles[0]!.fixture, title: 'Changed after startup' }));
  assert.equal(await (await fetch(app.base + '/tasks')).text(), before);
  const downloaded = Buffer.from(await (await fetch(`${app.base}/runs/${fixture.bundles[0]!.run.id}/evidence`)).arrayBuffer());
  assert.deepEqual(downloaded, fixture.bytes[0]);
});

test('all mutation and active event routes reject without creating files or disclosing operator paths', async t => {
  const fixture = await prepareArchiveFixture(); t.after(fixture.close); const app = await openArchive(fixture); t.after(app.close);
  const entries = (await readdir(fixture.directory)).sort(), id = fixture.bundles[0]!.run.id;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) for (const path of ['/runs', `/runs/${id}`, `/runs/${id}/cancel`, '/upload']) {
    const response = await fetch(app.base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '/private', mode: 'live' }) });
    assert.equal(response.status, 405); assert.equal((await response.json()).error.code, 'method_not_allowed');
  }
  for (const suffix of ['events', 'cancel']) assert.equal((await fetch(`${app.base}/runs/${id}/${suffix}`)).status, 405);
  assert.equal((await fetch(app.base + '/runs?path=/private')).status, 400);
  assert.equal((await fetch(app.base + '/private/file.json')).status, 404);
  assert.equal((await fetch(`${app.base}/runs/${randomUUID()}`)).status, 404);
  assert.equal((await fetch(app.base + '/runs', { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
  const foreignHostStatus = await new Promise<number | undefined>((done, reject) => {
    const request = httpRequest(app.base + '/runs', { headers: { Host: 'foreign.invalid' } }, response => { response.resume(); done(response.statusCode); });
    request.once('error', reject); request.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.deepEqual((await readdir(fixture.directory)).sort(), entries);
});

test('wrong config, bundle and run pins reject before serving any archive', async t => {
  const fixture = await prepareArchiveFixture(); t.after(fixture.close);
  await assert.rejects(createEvidenceArchive({ ...fixture, expectedConfigDigest: digestJson('wrong') }), /archive_config_digest_mismatch/);
  const pinned = fixture.config.bundles[0]!;
  pinned.runId = randomUUID(); fixture.expectedConfigDigest = await fixture.writeConfig();
  await assert.rejects(createEvidenceArchive(fixture), /archive_input_invalid/);
  pinned.runId = fixture.bundles[0]!.run.id; pinned.bundleDigest = digestJson('wrong'); fixture.expectedConfigDigest = await fixture.writeConfig();
  await assert.rejects(createEvidenceArchive(fixture), /archive_input_invalid/);
});

test('tampered body and rehashed unapproved fixture content both reject', async t => {
  const fixture = await prepareArchiveFixture(); t.after(fixture.close);
  const changed = structuredClone(fixture.bundles[0]!); changed.run.notice = 'changed without repinning';
  await writeFile(fixture.paths[0]!, JSON.stringify(changed));
  await assert.rejects(createEvidenceArchive(fixture), /archive_input_invalid/);
  changed.fixture.description = 'Different curated task statement';
  Object.assign(changed.run, fixtureDigests(changed.fixture, changed.schemaVersion));
  const rehashed = buildEvidence(changed.run, changed.fixture, changed.runtimeLock);
  await writeFile(fixture.paths[0]!, JSON.stringify(rehashed)); fixture.config.bundles[0]!.bundleDigest = rehashed.bundleDigest;
  fixture.expectedConfigDigest = await fixture.writeConfig();
  await assert.rejects(createEvidenceArchive(fixture), /archive_input_invalid/);
});

test('unapproved task, final split, non-product artifacts and nonterminal records never enter the archive', async t => {
  for (const kind of ['unknown_task', 'final_split', 'experiment_trace', 'candidate_only', 'nonterminal'] as const) await t.test(kind, async t => {
    const fixture = await prepareArchiveFixture(); t.after(fixture.close);
    const original = fixture.bundles[0]!, changed = structuredClone(original);
    if (kind === 'experiment_trace' || kind === 'candidate_only') {
      await writeFile(fixture.paths[0]!, JSON.stringify(kind === 'experiment_trace' ? { format: 'patchproof-experiment-trace-v1', result: {} } : { files: { 'solution.py': '# unrelated' } }));
    } else {
      if (kind === 'unknown_task') changed.run.taskId = changed.fixture.id = 'unapproved-01';
      if (kind === 'final_split') changed.fixture.split = 'final';
      if (kind === 'nonterminal') { changed.run.phase = 'repair'; changed.run.terminalStatus = null; changed.run.finishedAt = null; changed.run.events[0]!.phase = 'repair'; }
      Object.assign(changed.run, fixtureDigests(changed.fixture, changed.schemaVersion));
      const body = buildEvidence(changed.run, changed.fixture, changed.runtimeLock);
      await writeFile(fixture.paths[0]!, JSON.stringify(body)); fixture.config.bundles[0]!.bundleDigest = body.bundleDigest;
      fixture.expectedConfigDigest = await fixture.writeConfig();
    }
    await assert.rejects(createEvidenceArchive(fixture), /archive_(?:input_invalid|fixture_not_curated)/);
  });
});

test('private regular external files are required; links, broad permissions, URLs and oversized inputs reject', async t => {
  for (const kind of ['symlink', 'hardlink', 'permissions', 'inside_project', 'url', 'oversized'] as const) await t.test(kind, async t => {
    const fixture = await prepareArchiveFixture(); t.after(fixture.close); const original = fixture.paths[0]!;
    if (kind === 'symlink' || kind === 'hardlink') {
      const linked = join(fixture.directory, 'linked.json');
      if (kind === 'symlink') await symlink(original, linked); else await link(original, linked);
      fixture.config.bundles[0]!.path = linked;
    }
    if (kind === 'permissions') await chmod(original, 0o644);
    if (kind === 'inside_project') { const path = join(fixture.projectRoot, 'inside.json'); await writeFile(path, fixture.bytes[0]!, { mode: 0o600 }); fixture.config.bundles[0]!.path = path; }
    if (kind === 'url') fixture.config.bundles[0]!.path = 'https://external.invalid/evidence.json';
    if (kind === 'oversized') await writeFile(original, ' '.repeat(4_194_305));
    fixture.expectedConfigDigest = await fixture.writeConfig();
    await assert.rejects(createEvidenceArchive(fixture), /archive_input_invalid/);
  });
});

test('configuration is bounded, strict and unambiguous; source changes before startup reject', async t => {
  const fixture = await prepareArchiveFixture(); t.after(fixture.close);
  assert.throws(() => evidenceArchiveConfigDigest({ ...fixture.config, createRuns: true }));
  assert.throws(() => evidenceArchiveConfigDigest({ ...fixture.config, bundles: Array(31).fill(fixture.config.bundles[0]) }));
  fixture.config.bundles.push({ ...fixture.config.bundles[0]! }); fixture.expectedConfigDigest = await fixture.writeConfig();
  await assert.rejects(createEvidenceArchive(fixture), /archive_duplicate_entry/);
  fixture.config.bundles.pop(); fixture.expectedConfigDigest = await fixture.writeConfig();
  const content = JSON.parse(await readFile(fixture.fixtureFile, 'utf8')); content.files['solution.py'] += '# changed current source\n';
  await writeFile(fixture.fixtureFile, JSON.stringify(content));
  await assert.rejects(createEvidenceArchive(fixture), /archive_input_invalid/);
});
