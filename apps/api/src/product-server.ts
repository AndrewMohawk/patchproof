import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { ContractError } from '../../../packages/contracts/src/index.ts';
import { LOCAL_LIMITS } from '../../../packages/orchestrator/src/coordinator.ts';
import type { Coordinator } from '../../../packages/orchestrator/src/coordinator.ts';
import type { ProductEvent } from '../../../packages/contracts/src/product.ts';
import { PRODUCT_CONTRACT_VERSION } from '../../../packages/contracts/src/product.ts';
import { guardRequest, jsonBody, sendJson } from './server.ts';

const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const runRoute = /^\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(events|cancel|evidence))?$/;

export function createProductServer(coordinator: Coordinator, options: {
  approvedSpendUsd: number; localRuntime: { available: boolean; image: string | null; reason: string | null };
}) {
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      guardRequest(req);
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path)!;
        const bytes = await readFile(new URL(`../../web/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(bytes); return;
      }
      if (req.method === 'GET' && path === '/tasks') {
        sendJson(res, 200, { schemaVersion: PRODUCT_CONTRACT_VERSION, mode: 'mock', competitionReady: false, tasks: coordinator.tasks(),
          limits: LOCAL_LIMITS, maxApprovedSpendUsd: options.approvedSpendUsd,
          realExecutionEnabled: false, localRuntime: options.localRuntime }); return;
      }
      if (req.method === 'GET' && path === '/runs') {
        sendJson(res, 200, { mode: 'mock', competitionReady: false, runs: coordinator.list() }); return;
      }
      if (req.method === 'POST' && path === '/runs') {
        const result = coordinator.create(await jsonBody(req)); sendJson(res, result.reused ? 200 : 201, result.run); return;
      }
      const match = runRoute.exec(path);
      if (!match) throw new ContractError('not_found', 'Resource not found.', 404);
      const id = match[1]!; const action = match[2];
      if (req.method === 'GET' && !action) { sendJson(res, 200, coordinator.get(id)); return; }
      if (req.method === 'POST' && action === 'cancel') {
        const body = await jsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new ContractError('invalid_request', 'Cancellation body must be an empty object.');
        sendJson(res, 200, coordinator.cancel(id)); return;
      }
      if (req.method === 'GET' && action === 'evidence') {
        const bundle = await coordinator.evidence(id);
        res.setHeader('Content-Disposition', `attachment; filename="${id}.json"`);
        res.setHeader('X-PatchProof-Digest', bundle.bundleDigest);
        sendJson(res, 200, bundle); return;
      }
      if (req.method === 'GET' && action === 'events') {
        const run = coordinator.get(id);
        const last = req.headers['last-event-id'] ?? '0';
        if (typeof last !== 'string' || !/^\d{1,8}$/.test(last) || Number(last) > run.events.length) throw new ContractError('invalid_request', 'Invalid Last-Event-ID.');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        const emit = (event: ProductEvent) => {
          res.write(`id: ${event.sequence}\nevent: ${event.phase === 'terminal' ? 'terminal' : 'state'}\ndata: ${JSON.stringify(event)}\n\n`);
          if (event.phase === 'terminal') res.end();
        };
        for (const event of run.events.filter(e => e.sequence > Number(last))) emit(event);
        if (run.phase === 'terminal') { res.end(); return; }
        const unsubscribe = coordinator.subscribe(id, emit); res.on('close', unsubscribe); return;
      }
      throw new ContractError('method_not_allowed', 'Method not allowed.', 405);
    } catch (error) {
      const known = error instanceof ContractError ? error : new ContractError('infrastructure_error', 'Request failed.', 500);
      if (!res.headersSent) sendJson(res, known.httpStatus, { mode: 'mock', competitionReady: false, error: { code: known.code, message: known.message } });
      else res.end();
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 64;
  return server;
}
