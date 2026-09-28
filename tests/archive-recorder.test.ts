import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createEvidenceArchive } from '../apps/api/src/evidence-archive.ts';
import { archiveBase, captionDwellMs, inspectRecordingArchive, playbackCaption, recordEvidenceArchive, recordingRequestAllowed } from '../scripts/record-evidence-archive.ts';
import { prepareArchiveFixture, syntheticArchiveBundle } from './helpers/archive-fixture.ts';

async function archive(modes: Array<'mock' | 'live'> = ['mock']) {
  const fixture = await prepareArchiveFixture(modes.map(mode => syntheticArchiveBundle(mode, '2.2')));
  const app = await createEvidenceArchive(fixture);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  return { fixture, app, base: `http://127.0.0.1:${address.port}`, ids: fixture.bundles.map(bundle => bundle.run.id),
    close: async () => { app.server.closeAllConnections(); await new Promise<void>(done => app.server.close(() => done())); await fixture.close(); } };
}

test('recording accepts literal loopback only and blocks mutations, events, credentials, queries and unrelated origins', () => {
  const base = 'http://127.0.0.1:43173', ids = ['11111111-1111-4111-8111-111111111111'];
  assert.equal(archiveBase(base + '/'), base);
  for (const bad of ['http://localhost:43173', 'https://127.0.0.1:43173', base + '/tasks', base + '?x=1', 'http://user@127.0.0.1:43173', 'http://127.0.0.1:80']) assert.throws(() => archiveBase(bad));
  for (const path of ['/', '/tasks', '/runs', `/runs/${ids[0]}`, `/runs/${ids[0]}/evidence`]) assert.equal(recordingRequestAllowed(base, ids, 'GET', base + path), true);
  for (const [method, url] of [['POST', base + '/runs'], ['DELETE', base + '/runs'], ['GET', base + `/runs/${ids[0]}/events`],
    ['GET', base + `/runs/${ids[0]}/cancel`], ['GET', base + '/runs/another'], ['GET', base + '/tasks?token=x'],
    ['GET', 'http://127.0.0.1:43174/tasks'], ['GET', 'https://example.invalid/'], ['GET', 'http://user@127.0.0.1:43173/tasks']]) {
    assert.equal(recordingRequestAllowed(base, ids, method!, url!), false);
  }
});

test('single and mixed recorded inputs retain exact bundle bytes and usage without promoting synthetic labels', async t => {
  const a = await archive(['mock', 'live']); t.after(a.close);
  const observed = await inspectRecordingArchive(a.base, a.app.manifest.archiveDigest, a.ids);
  assert.deepEqual(observed.records.map(record => record.bytes), a.fixture.bytes);
  assert.equal(observed.records[1]!.bundle.run.usage.measuredCostUsd, null);
  await assert.rejects(inspectRecordingArchive(a.base, 'sha256:' + '0'.repeat(64), a.ids), /recording_archive_changed/);
  await assert.rejects(inspectRecordingArchive(a.base, a.app.manifest.archiveDigest, [a.ids[0]]), /recording_selection_mismatch/);
  await assert.rejects(inspectRecordingArchive(a.base, a.app.manifest.archiveDigest, [a.ids[0], a.ids[0]]), /recording_duplicate_run/);
});

test('active mock application metadata is refused before run reads or writes', async t => {
  const requests: string[] = [];
  const server = createServer((req, res) => { requests.push(`${req.method} ${req.url}`); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ mode: 'mock', capabilities: { createRuns: true } })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await assert.rejects(inspectRecordingArchive(`http://127.0.0.1:${address.port}`, 'sha256:' + '1'.repeat(64), ['11111111-1111-4111-8111-111111111111']));
  assert.deepEqual(requests, ['GET /tasks']);
});

test('run projection and bundle tampering cannot enter an otherwise pinned archive capture', async t => {
  const a = await archive(); t.after(a.close);
  let change = 'run';
  const proxy = createServer(async (req, res) => {
    const upstream = await fetch(a.base + req.url); const body = await upstream.json();
    if (req.url === `/runs/${a.ids[0]}` && change === 'run') body.reason = 'invented_new_reason';
    if (req.url === `/runs/${a.ids[0]}/evidence` && change === 'bundle') body.run.reason = 'invented_new_reason';
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const address = proxy.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  await assert.rejects(inspectRecordingArchive(base, a.app.manifest.archiveDigest, a.ids), /recording_run_mismatch/);
  change = 'bundle'; await assert.rejects(inspectRecordingArchive(base, a.app.manifest.archiveDigest, a.ids));
});

test('output cannot overwrite an existing directory or follow a symlink before browser launch', async t => {
  const a = await archive(); t.after(a.close);
  const output = join(a.fixture.directory, 'already-exists'); await mkdir(output, { mode: 0o700 });
  const options = { base: a.base, archiveDigest: a.app.manifest.archiveDigest, runIds: a.ids, outputDirectory: output };
  await assert.rejects(recordEvidenceArchive(options), /operator_file_not_private/);
  await symlink(output, join(a.fixture.directory, 'linked'));
  await assert.rejects(recordEvidenceArchive({ ...options, outputDirectory: join(a.fixture.directory, 'linked') }), /operator_file_not_private/);
});

test('captions preserve real recorded verdicts, estimated and unknown costs, and synthetic verification scope', () => {
  const run = syntheticArchiveBundle('live', '2.2').run;
  const caption = playbackCaption(run, true);
  assert.match(caption, /SYNTHETIC VERIFICATION INPUT/); assert.match(caption, /Recorded live/);
  assert.match(caption, /failed/); assert.match(caption, /unmeasured provider cost/); assert.match(caption, /sandbox CPU unmeasured/);
  assert.match(caption, /No inference or checks run during playback/); assert.doesNotMatch(caption, /0 USD/);
  run.usage.measuredCostUsd = .012; run.usage.costIsEstimate = true;
  assert.match(playbackCaption(run, false), /0.012 USD estimated provider cost/);
  assert.equal(captionDwellMs('Short sentence.'), 3000);
  assert.equal(captionDwellMs(Array(35).fill('word').join(' ')), 10000);
  assert.equal(captionDwellMs(Array(35).fill('word').join(' '), true), 1800);
});
