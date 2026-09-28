import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ContractError, DigestSchema } from '../../../packages/contracts/src/index.ts';
import { ProductEvidenceSchema } from '../../../packages/contracts/src/product-validation.ts';
import { PRODUCT_CONTRACT_VERSION } from '../../../packages/contracts/src/product.ts';
import { digestJson } from '../../../packages/contracts/src/digest.ts';
import { fixtureDigests, publicTask } from '../../../packages/orchestrator/src/fixtures.ts';
import { readPrivateOperatorJson } from '../../../scripts/operator-files.ts';
import { readPrivateEvidenceBytes, verifyCuratedProductEvidence } from '../../../scripts/evidence-operator.ts';
import { guardRequest, sendJson } from './server.ts';

export const EvidenceArchiveConfigSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), kind: z.literal('patchproof-evidence-archive'),
  bundles: z.array(z.strictObject({ path: z.string().min(1).max(4096), runId: z.uuid(), bundleDigest: DigestSchema })).min(1).max(30),
});
export const evidenceArchiveConfigDigest = (value: unknown) => digestJson(EvidenceArchiveConfigSchema.parse(value));
export class EvidenceArchiveError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new EvidenceArchiveError(code); }
const capabilities = Object.freeze({ createRuns: false, cancelRuns: false, replay: false, streamEvents: false });
const route = /^\/runs\/([0-9a-f-]{36})(?:\/(evidence|events|cancel))?$/i;

/** Load only explicit private, pinned public-fixture evidence; never instantiate an execution runtime. */
export async function createEvidenceArchive(options: { projectRoot: string; configFile: string; expectedConfigDigest: string }) {
  try {
    const projectRoot = resolve(options.projectRoot);
    const config = EvidenceArchiveConfigSchema.parse(readPrivateOperatorJson(options.configFile, { projectRoot, maximumBytes: 65_536 }));
    const configDigest = evidenceArchiveConfigDigest(config);
    if (DigestSchema.parse(options.expectedConfigDigest) !== configDigest) fail('archive_config_digest_mismatch');
    if (new Set(config.bundles.map(item => item.runId)).size !== config.bundles.length ||
        new Set(config.bundles.map(item => item.path)).size !== config.bundles.length) fail('archive_duplicate_entry');
    const records = new Map<string, { run: string; evidence: Buffer; bundleDigest: string }>();
    const tasks = new Map<string, ReturnType<typeof publicTask>>();
    let totalBytes = 0;
    for (const entry of config.bundles) {
      const bytes = readPrivateEvidenceBytes(entry.path, { projectRoot, maximumBytes: 4_194_304 });
      totalBytes += bytes.length;
      if (totalBytes > 33_554_432) fail('archive_size_limit');
      const parsed = ProductEvidenceSchema.parse(JSON.parse(bytes.toString('utf8')));
      const fixture = parsed.fixture;
      if (fixture.split === 'final') fail('archive_fixture_not_curated');
      const digests = fixtureDigests(fixture, parsed.schemaVersion);
      // The verifier independently matches this proposed identity against the bounded current public tree.
      const bundle = await verifyCuratedProductEvidence({ projectRoot, bytes, runId: entry.runId, bundleDigest: entry.bundleDigest,
        fixture: { taskId: fixture.id, fixtureDigest: digestJson(fixture), ...digests } });
      if (bundle.run.phase !== 'terminal') fail('archive_run_not_terminal');
      records.set(entry.runId, { run: JSON.stringify(bundle.run), evidence: Buffer.from(bytes), bundleDigest: entry.bundleDigest });
      tasks.set(fixture.id, publicTask(fixture));
    }
    const bundles = config.bundles.map(({ runId, bundleDigest }) => ({ runId, bundleDigest }));
    const archiveDigest = digestJson({ configDigest, bundles });
    const modes = [...new Set([...records.values()].map(item => JSON.parse(item.run).mode as string))].sort();
    const metadata = JSON.stringify({ schemaVersion: PRODUCT_CONTRACT_VERSION, mode: 'archive', readOnly: true,
      competitionReady: false, realExecutionEnabled: false, capabilities, archiveDigest, integrityVerified: true,
      authenticityVerified: false, recordedModes: modes, bundles, tasks: [...tasks.values()] });
    const history = JSON.stringify({ mode: 'archive', competitionReady: false, capabilities,
      runs: [...records.values()].map(item => JSON.parse(item.run)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    // Freeze assets as well as evidence: this listener does not reread changing source or operator files.
    const assets = new Map<string, { bytes: Buffer; type: string }>();
    for (const [url, file, type] of [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/walkthrough.js', 'walkthrough.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']] as const) {
      assets.set(url, { bytes: await readFile(new URL(`../../web/${file}`, import.meta.url)), type });
    }
    const server = createServer((req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      try {
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) throw new ContractError('origin_denied', 'Loopback access required.', 403);
        guardRequest(req);
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.search) throw new ContractError('invalid_request', 'Archive routes do not accept query parameters.');
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); req.resume(); throw new ContractError('method_not_allowed', 'Recorded evidence is read only.', 405); }
        if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        const asset = assets.get(url.pathname);
        if (asset) { res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); res.end(asset.bytes); return; }
        const json = (value: string) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(value); };
        if (url.pathname === '/tasks') { json(metadata); return; }
        if (url.pathname === '/runs') { json(history); return; }
        const match = route.exec(url.pathname);
        if (!match) throw new ContractError('not_found', 'Archive resource not found.', 404);
        const record = records.get(match[1]!);
        if (!record) throw new ContractError('not_found', 'Archived run not found.', 404);
        if (match[2] === 'events' || match[2] === 'cancel') throw new ContractError('method_not_allowed', 'Recorded evidence has no active execution stream or cancellation.', 405);
        if (match[2] === 'evidence') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${match[1]}.json"`, 'X-PatchProof-Digest': record.bundleDigest });
          res.end(record.evidence); return;
        }
        json(record.run);
      } catch (error) {
        const known = error instanceof ContractError ? error : new ContractError('infrastructure_error', 'Archive request failed.', 500);
        sendJson(res, known.httpStatus, { mode: 'archive', competitionReady: false, error: { code: known.code, message: known.message } });
      }
    });
    server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 32;
    // Only a safe manifest is exposed; callers cannot mutate the private byte snapshots.
    return { server, manifest: { archiveDigest, bundleCount: records.size, recordedModes: [...modes], capabilities: { ...capabilities } } };
  } catch (error) {
    if (error instanceof EvidenceArchiveError) throw error;
    throw new EvidenceArchiveError('archive_input_invalid');
  }
}
