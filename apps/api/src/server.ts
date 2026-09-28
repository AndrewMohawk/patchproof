import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { catalogue } from '../../../packages/contracts/src/catalogue.ts';
import { ApiErrorSchema, ContractError, MOCK_LABEL } from '../../../packages/contracts/src/index.ts';
import type { RunEvent } from '../../../packages/contracts/src/index.ts';
import { MockCoordinator } from '../../../packages/mock/src/coordinator.ts';
import { buildBundle } from '../../../packages/mock/src/bundle.ts';

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/walkthrough.js', ['walkthrough.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const runRoute = new RegExp(`^/runs/(${uuid})(/(events|cancel|evidence))?$`);

export function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

export function guardRequest(req: IncomingMessage) {
  const port = req.socket.localPort;
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? '')) {
    throw new ContractError('origin_denied', 'Loopback host required.', 403);
  }
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
    throw new ContractError('origin_denied', 'Same-origin requests only.', 403);
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw new ContractError('origin_denied', 'Cross-site requests denied.', 403);
  }
}

export async function jsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new ContractError('invalid_request', 'Expected application/json.', 415);
  }
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > 8192) throw new ContractError('invalid_request', 'Request body exceeds 8 KiB.', 413);
    parts.push(Buffer.from(part));
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new ContractError('invalid_request', 'Malformed JSON body.'); }
}

function streamEvents(req: IncomingMessage, res: ServerResponse, coordinator: MockCoordinator, id: string) {
  const run = coordinator.get(id);
  const rawLast = req.headers['last-event-id'];
  if (rawLast !== undefined && (typeof rawLast !== 'string' || !/^\d{1,6}$/.test(rawLast))) {
    throw new ContractError('invalid_request', 'Invalid Last-Event-ID.');
  }
  const last = Number(rawLast ?? 0);
  if (last > run.events.length) throw new ContractError('invalid_request', 'Last-Event-ID exceeds history.');
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const emit = (event: RunEvent) => {
    res.write(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    if (event.phase === 'terminal') res.end();
  };
  for (const event of run.events.filter(e => e.sequence > last)) emit(event);
  if (run.phase === 'terminal') { res.end(); return; }
  const unsubscribe = coordinator.subscribe(id, emit);
  res.on('close', unsubscribe);
}

export function createMockServer(runtimeLock: unknown) {
  const lockSnapshot = structuredClone(runtimeLock);
  const coordinator = new MockCoordinator(lockSnapshot);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      guardRequest(req);
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && STATIC_FILES.has(path)) {
        const [file, type] = STATIC_FILES.get(path)!;
        const bytes = await readFile(new URL(`../../web/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type! });
        res.end(bytes);
        return;
      }
      if (req.method === 'GET' && path === '/tasks') {
        sendJson(res, 200, {
          ...MOCK_LABEL, tasks: catalogue(), allowance: { maxApprovedSpendUsd: 0 },
          persistence: 'memory_only', realExecutionEnabled: false,
        });
        return;
      }
      if (path === '/runs' && req.method === 'POST') {
        const result = coordinator.create(await jsonBody(req));
        sendJson(res, result.reused ? 200 : 201, result.run);
        return;
      }
      const match = runRoute.exec(path);
      if (match) {
        const id = match[1]!;
        const action = match[3];
        if (req.method === 'GET' && !action) { sendJson(res, 200, coordinator.get(id)); return; }
        if (req.method === 'GET' && action === 'events') { streamEvents(req, res, coordinator, id); return; }
        if (req.method === 'POST' && action === 'cancel') {
          // Cancellation has no configurable payload or executable instruction.
          const body = await jsonBody(req);
          if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
            throw new ContractError('invalid_request', 'Cancellation body must be an empty object.');
          }
          sendJson(res, 200, coordinator.cancel(id)); return;
        }
        if (req.method === 'GET' && action === 'evidence') {
          const bundle = buildBundle(coordinator.get(id), lockSnapshot);
          res.setHeader('Content-Disposition', `attachment; filename="${id}.json"`);
          sendJson(res, 200, bundle); return;
        }
        throw new ContractError('method_not_allowed', 'Method not allowed for this resource.', 405);
      }
      throw new ContractError('not_found', 'Resource not found.', 404);
    } catch (error) {
      const known = error instanceof ContractError ? error :
        new ContractError('infrastructure_error', 'Mock handler failed.', 500);
      if (!res.headersSent) {
        sendJson(res, known.httpStatus, ApiErrorSchema.parse({
          ...MOCK_LABEL, error: { code: known.code, message: known.message },
        }));
      } else res.end();
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.maxConnections = 32;
  return { server, coordinator };
}
