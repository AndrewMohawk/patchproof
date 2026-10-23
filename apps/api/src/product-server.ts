import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { ContractError, DigestSchema, LimitsSchema } from '../../../packages/contracts/src/index.ts';
import { LOCAL_LIMITS } from '../../../packages/orchestrator/src/coordinator.ts';
import type { Coordinator } from '../../../packages/orchestrator/src/coordinator.ts';
import type { ProductEvent } from '../../../packages/contracts/src/product.ts';
import { PRODUCT_CONTRACT_VERSION } from '../../../packages/contracts/src/product.ts';
import { guardRequest, jsonBody, sendJson } from './server.ts';

const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/walkthrough.js', ['walkthrough.js', 'text/javascript']], ['/diff-view.js', ['diff-view.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const runRoute = /^\/runs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(events|cancel|evidence))?$/;

const LiveMetadataSchema = z.strictObject({
  execution: z.strictObject({ modelProvider: z.literal('nebius-token-factory'), checkBackend: z.literal('local_container'), modelId: z.string().min(1).max(512) }),
  runtimeLockDigest: DigestSchema, limits: LimitsSchema,
  allowedHosts: z.array(z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)).min(1).max(2).optional(),
});
export type ProductLiveMetadata = z.infer<typeof LiveMetadataSchema>;
const LiveAvailabilitySchema = z.strictObject({ enabled: z.boolean(), reason: z.string().max(1024).nullable(), remainingRuns: z.number().int().nonnegative() });
export type ProductLiveAvailability = z.infer<typeof LiveAvailabilitySchema>;
const LocalRuntimeStatusSchema = z.strictObject({ available: z.boolean(), image: z.string().min(1).max(1024).nullable(), reason: z.string().min(1).max(1024).nullable() })
  .superRefine((value, context) => {
    if (value.available ? value.image === null || value.reason !== null : value.image !== null || value.reason === null) {
      context.addIssue({ code: 'custom', message: 'Inconsistent local runtime status.' });
    }
  });
const LiveReadinessSchema = LiveAvailabilitySchema.extend({ localRuntime: LocalRuntimeStatusSchema.optional() });
export type ProductLiveReadiness = z.infer<typeof LiveReadinessSchema>;
const sessionCookie = '__Host-patchproof-session';
function guardLiveHost(req: IncomingMessage, allowedHosts: readonly string[] | undefined) {
  if (!allowedHosts) { guardRequest(req); return; }
  const host = req.headers.host;
  if (!host || !allowedHosts.includes(host) || (req.headers.origin && req.headers.origin !== `https://${host}`) ||
      req.headers['sec-fetch-site'] === 'cross-site') throw new ContractError('origin_denied', 'Same-origin requests only.', 403);
}
function requestSession(req: IncomingMessage, sessions: ReadonlySet<string>): string | undefined {
  const matches = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(sessionCookie + '='));
  if (matches.length !== 1) return;
  const token = matches[0]!.slice(sessionCookie.length + 1);
  return sessions.has(token) ? token : undefined;
}
export function createProductServer(coordinator: Coordinator, options: {
  approvedSpendUsd: number; localRuntime: { available: boolean; image: string | null; reason: string | null }; live?: ProductLiveMetadata;
  liveAvailability?: () => ProductLiveReadiness | Promise<ProductLiveReadiness>;
}) {
  // Snapshot configured identity before serving. Request fields cannot select providers, limits or hosts.
  const { liveAvailability: availabilitySource, ...configuration } = options;
  const settings = structuredClone(configuration);
  const live = settings.live === undefined ? undefined : LiveMetadataSchema.parse(settings.live);
  const mode = live ? 'live' : 'mock';
  const readiness = async () => {
    if (!live || !availabilitySource) return undefined;
    try {
      const { localRuntime, ...available } = LiveReadinessSchema.parse(await availabilitySource());
      if (localRuntime?.available === false) return { availability: { ...available, enabled: false,
        reason: 'The protected local checker is unavailable. Recorded evidence remains accessible.' }, localRuntime };
      return { availability: available, localRuntime: localRuntime ?? settings.localRuntime };
    } catch {
      return { availability: { enabled: false, reason: 'New runs are temporarily unavailable. Recorded evidence remains accessible.', remainingRuns: 0 },
        localRuntime: { available: false, image: null, reason: 'local_runtime_status_unavailable' } };
    }
  };
  const sessions = new Set<string>(), owners = new Map<string, string>();
  const ownedRunIds = (req: IncomingMessage) => {
    const token = requestSession(req, sessions);
    return token ? [...owners].filter(([, owner]) => owner === token).map(([id]) => id) : [];
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      guardLiveHost(req, live?.allowedHosts);
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && path === '/healthz') {
        sendJson(res, 200, live ? { status: 'ok', mode, modelProvider: live.execution.modelProvider, checkBackend: live.execution.checkBackend } : { status: 'ok', mode }); return;
      }
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path)!;
        const bytes = await readFile(new URL(`../../web/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(bytes); return;
      }
      if (req.method === 'GET' && path === '/tasks') {
        const current = await readiness(), available = current?.availability;
        sendJson(res, 200, { schemaVersion: PRODUCT_CONTRACT_VERSION, mode, competitionReady: false, tasks: coordinator.tasks().map(task => live ? { ...task, executionSupported: true } : task),
          capabilities: { createRuns: available?.enabled ?? true, cancelRuns: true, replay: false, streamEvents: true },
          limits: live?.limits ?? LOCAL_LIMITS, maxApprovedSpendUsd: settings.approvedSpendUsd,
          realExecutionEnabled: Boolean(live) && (available?.enabled ?? true), ...(available ? { availability: available } : {}), localRuntime: current?.localRuntime ?? settings.localRuntime,
          ...(live ? { execution: live.execution, runtimeLockDigest: live.runtimeLockDigest } : {}) }); return;
      }
      if (req.method === 'GET' && path === '/runs') {
        sendJson(res, 200, { mode, competitionReady: false, runs: coordinator.list(), ...(live ? { ownedRunIds: ownedRunIds(req), availability: (await readiness())?.availability } : {}) }); return;
      }
      if (req.method === 'POST' && path === '/runs') {
        const value = await jsonBody(req);
        const available = (await readiness())?.availability;
        if (available?.enabled === false) throw new ContractError('budget_not_approved', available.reason ?? 'New runs are paused.', 403);
        const existingSession = live ? requestSession(req, sessions) : undefined;
        if (live && ((!existingSession && sessions.size >= 1024) || owners.size >= 4096)) throw new ContractError('rate_limit', 'New run capacity is currently unavailable.', 429);
        const result = coordinator.create(value);
        if (live && !result.reused) {
          const token = existingSession ?? randomBytes(32).toString('base64url');
          sessions.add(token); owners.set(result.run.id, token);
          if (!existingSession) res.setHeader('Set-Cookie', `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`);
        }
        sendJson(res, result.reused ? 200 : 201, result.run); return;
      }
      const match = runRoute.exec(path);
      if (!match) throw new ContractError('not_found', 'Resource not found.', 404);
      const id = match[1]!; const action = match[2];
      if (req.method === 'GET' && !action) { sendJson(res, 200, coordinator.get(id)); return; }
      if (req.method === 'POST' && action === 'cancel') {
        if (live && !ownedRunIds(req).includes(id)) { req.resume(); throw new ContractError('authorization_required', 'Only the browser session that started this run can cancel it.', 403); }
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
      if (!res.headersSent) sendJson(res, known.httpStatus, { mode, competitionReady: false, error: { code: known.code, message: known.message } });
      else res.end();
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 64;
  return server;
}
