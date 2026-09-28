import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEvidenceArchive } from '../apps/api/src/evidence-archive.ts';
import { buildEvidence } from '../packages/orchestrator/src/evidence.ts';
import { recordEvidenceArchive } from './record-evidence-archive.ts';
import { prepareArchiveFixture, syntheticArchiveBundle } from '../tests/helpers/archive-fixture.ts';

// All inputs are original, invented metadata. No candidate, fixture interpreter or provider is executed.
const outputRoot = await mkdtemp(join(tmpdir(), 'patchproof-archive-recording-proof-'));
const results = [];
for (const modes of [['mock'], ['live', 'mock']] as Array<Array<'mock' | 'live'>>) {
  const bundles = modes.map((mode, index) => {
    const bundle = syntheticArchiveBundle(mode, '2.2', index === 0 ? 'patchproof' : 'baseline');
    if (modes.length === 1) {
      bundle.run.candidates = []; bundle.run.selectedCandidateId = null; bundle.run.terminalStatus = 'needs_review';
      bundle.run.reason = 'mock_task_unavailable'; bundle.run.coverage = [{ requirementId: 'R01', status: 'unverified', checkIds: [] }];
    } else if (mode === 'mock') {
      const candidate = bundle.run.candidates[0]!; candidate.accepted = true; candidate.rejectionReason = null;
      candidate.visibleChecks[0]!.status = 'pass'; candidate.visibleChecks[0]!.actual = 'expected';
      candidate.visibleChecks[0]!.message = 'Invented passing observation.';
      bundle.run.coverage[0]!.status = 'pass'; bundle.run.terminalStatus = 'verified_for_declared_checks'; bundle.run.reason = 'declared_local_checks_passed';
    }
    return buildEvidence(bundle.run, bundle.fixture, bundle.runtimeLock);
  });
  const fixture = await prepareArchiveFixture(bundles);
  const app = await createEvidenceArchive(fixture);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const directory = join(outputRoot, `capture-${modes.length}`);
    const receipt = await recordEvidenceArchive({ base, archiveDigest: app.manifest.archiveDigest,
      runIds: fixture.bundles.map(bundle => bundle.run.id), outputDirectory: directory, synthetic: true });
    assert.equal(receipt.status, 'passed', receipt.failure ?? 'capture failed');
    assert.ok(receipt.encodedDurationSeconds! <= 170);
    assert.equal(receipt.executionPerformed, false); assert.deepEqual(receipt.violations, []);
    assert.ok(receipt.requests.every(request => request.method === 'GET'));
    assert.deepEqual(receipt.runs.map(run => run.mode), modes);
    for (const [index, bytes] of fixture.bytes.entries()) assert.deepEqual(await readFile(join(directory, `evidence-${index + 1}.json`)), bytes);
    results.push({ kind: 'positive_capture', modes, recordedStatuses: receipt.runs.map(run => run.status), directory, durationSeconds: receipt.encodedDurationSeconds, status: receipt.status });

    if (modes.length === 1) {
      let prohibitedWrites = 0, unexpectedExternal = 0, styleReads = 0, redirectAttempts = 0;
      const sink = createServer((_req, res) => { unexpectedExternal++; res.end('unexpected'); });
      sink.listen(0, '127.0.0.1'); await once(sink, 'listening');
      const sinkAddress = sink.address(); assert.ok(sinkAddress && typeof sinkAddress !== 'string');
      const proxy = createServer(async (req, res) => {
        if (req.method !== 'GET') { prohibitedWrites++; res.writeHead(500); res.end(); return; }
        if (req.url === '/style.css' && ++styleReads > 1) { redirectAttempts++; res.writeHead(302, { Location: `http://127.0.0.1:${sinkAddress.port}/redirect-target` }); res.end(); return; }
        const upstream = await fetch(base + req.url);
        let bytes = Buffer.from(await upstream.arrayBuffer());
        if (req.url === '/app.js') bytes = Buffer.concat([Buffer.from(`fetch('/runs',{method:'POST'}).catch(()=>{});fetch('http://127.0.0.1:${sinkAddress.port}/outside').catch(()=>{});\n`), bytes]);
        res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream'); res.end(bytes);
      });
      proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
      const proxyAddress = proxy.address(); assert.ok(proxyAddress && typeof proxyAddress !== 'string');
      try {
        const denied = await recordEvidenceArchive({ base: `http://127.0.0.1:${proxyAddress.port}`, archiveDigest: app.manifest.archiveDigest,
          runIds: fixture.bundles.map(bundle => bundle.run.id), outputDirectory: join(outputRoot, 'expected-network-denial'), synthetic: true });
        assert.equal(denied.status, 'failed'); assert.ok(denied.violations.includes('blocked_request'));
        assert.ok(redirectAttempts > 0, 'browser must request the redirecting resource'); assert.ok(denied.violations.includes('request_unavailable'));
        assert.equal(prohibitedWrites, 0); assert.equal(unexpectedExternal, 0);
        results.push({ kind: 'expected_network_denial', blockedRequests: denied.violations.length, redirectAttempts, prohibitedWrites, unexpectedExternal, status: 'passed' });
      } finally { proxy.closeAllConnections(); sink.closeAllConnections(); await Promise.all([new Promise<void>(done => proxy.close(() => done())), new Promise<void>(done => sink.close(() => done()))]); }
      let historyReads = 0;
      const changed = createServer(async (req, res) => {
        const upstream = await fetch(base + req.url); let bytes = Buffer.from(await upstream.arrayBuffer());
        if (req.url === '/runs' && ++historyReads > 1) {
          const value = JSON.parse(bytes.toString('utf8')); value.runs[0].reason = 'transient_unapproved_projection';
          bytes = Buffer.from(JSON.stringify(value));
        }
        res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream'); res.end(bytes);
      });
      changed.listen(0, '127.0.0.1'); await once(changed, 'listening');
      const changedAddress = changed.address(); assert.ok(changedAddress && typeof changedAddress !== 'string');
      try {
        const rejected = await recordEvidenceArchive({ base: `http://127.0.0.1:${changedAddress.port}`, archiveDigest: app.manifest.archiveDigest,
          runIds: fixture.bundles.map(bundle => bundle.run.id), outputDirectory: join(outputRoot, 'expected-history-drift'), synthetic: true });
        assert.equal(rejected.status, 'failed'); assert.ok(rejected.violations.includes('response_bytes_changed'));
        assert.ok(historyReads > 1);
        results.push({ kind: 'transient_history_rejected_before_delivery', historyReads, status: 'passed' });
      } finally { changed.closeAllConnections(); await new Promise<void>(done => changed.close(() => done())); }

    }
  } finally { app.server.closeAllConnections(); await new Promise<void>(done => app.server.close(() => done())); await fixture.close(); }
}
const receipt = { scope: 'synthetic_archive_recording_verification_only', status: 'passed', outputRoot, results,
  providerCalls: 0, candidateExecutions: 0, realProviderEvidence: false, humanStudy: false, published: false };
await writeFile(join(outputRoot, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(receipt, null, 2));
