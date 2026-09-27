import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { lstat, open, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { appendStudyAction, readStudyEvents, reportReviewerStudy, reviewerPacket, validateReviewerStudy } from './reviewer-study.ts';
import type { StudyAction } from './reviewer-study.ts';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const OpenBody = z.strictObject({ assignmentId: Id, requestId: Id });
const SubmitBody = OpenBody.extend({ answer: z.enum(['accept', 'reject', 'needs_review']) }).strict();
const SkipBody = OpenBody.extend({ reason: z.enum(['declined', 'timeout', 'technical_issue']) }).strict();
class HttpError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };

/** Operator-only configuration. Browser requests never select filesystem paths. */
async function externalPrivateFile(path: string, allowMissing: boolean) {
  if (!isAbsolute(path)) throw new Error('Study paths must be explicit absolute paths outside the source repository.');
  const parent = await realpath(dirname(path)), candidate = resolve(parent, path.slice(path.lastIndexOf(sep) + 1));
  const within = relative(await realpath(projectRoot), candidate);
  if (!within || (!within.startsWith('..' + sep) && within !== '..' && !isAbsolute(within))) throw new Error('Private study state must remain outside the source repository.');
  const directory = await lstat(parent);
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || (process.getuid && directory.uid !== process.getuid())) throw new Error('Study state requires an operator-owned private directory (mode 0700).');
  try {
    const entry = await lstat(candidate);
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0 || (process.getuid && entry.uid !== process.getuid())) throw new Error('Study files must be private owned regular files, without symlinks.');
  } catch (error) { if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return candidate;
}
async function body(request: IncomingMessage) {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') fail(415, 'content_type', 'Use an application/json request.');
  const parts: Buffer[] = []; let length = 0;
  for await (const part of request) {
    const bytes = Buffer.from(part); length += bytes.length;
    if (length > 4096) fail(413, 'body_limit', 'Request is too large.');
    parts.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { return fail(400, 'invalid_request', 'Request must contain valid JSON.'); }
}
function headers(response: ServerResponse) {
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}
function json(response: ServerResponse, status: number, value: unknown) {
  headers(response); response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
}

export async function startReviewerServer(options: { planPath: string; journalPath: string; port?: number }) {
  const port = z.number().int().min(0).max(65535).parse(options.port ?? 43172);
  const planPath = await externalPrivateFile(options.planPath, false), journalPath = await externalPrivateFile(options.journalPath, true);
  if (planPath === journalPath) throw new Error('Plan and journal must use different files.');
  const planBytes = await readFile(planPath, 'utf8'), plan = validateReviewerStudy(JSON.parse(planBytes));
  reportReviewerStudy(plan, await readStudyEvents(journalPath));
  const leasePath = journalPath + '.server-lock', lease = await open(leasePath, 'wx', 0o600);
  const leaseContent = JSON.stringify({ pid: process.pid, token: randomUUID(), planDigest: plan.planDigest });
  await lease.writeFile(leaseContent); await lease.sync();
  const tokens = new Map(plan.participantIds.map(participantId => [randomBytes(32).toString('base64url'), participantId]));
  const assets = new Map<string, { type: string; bytes: Buffer }>();
  let origin = '', closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(operation: () => Promise<T>) => { const work = queue.then(operation); queue = work.catch(() => {}); return work; };
  const releaseLease = async () => { await lease.close(); if (await readFile(leasePath, 'utf8').catch(() => '') === leaseContent) await unlink(leasePath); };
  const snapshot = async (participantId: string) => {
    const events = await readStudyEvents(journalPath), report = reportReviewerStudy(plan, events);
    const assignments = plan.assignments.filter(a => a.participantId === participantId).sort((a,b) => a.presentationIndex - b.presentationIndex);
    const states = report.assignments.filter(a => a.participantId === participantId);
    const next = assignments.find(a => { const state = states.find(s => s.assignmentId === a.id)!; return !['submitted', 'skipped'].includes(state.status); });
    const active = next && states.find(s => s.assignmentId === next.id)?.status === 'opened_without_submission';
    const opened = active ? events.find(e => e.action.assignmentId === next!.id && e.action.kind === 'opened') : undefined;
    return { events, next, public: {
      participantId, status: !next ? 'complete' as const : active ? 'active' as const : 'ready' as const,
      completedAssignments: states.filter(s => ['submitted', 'skipped'].includes(s.status)).length,
      totalAssignments: assignments.length, nextAssignmentId: next?.id ?? null,
      maxAssignmentMs: plan.protocol.maxAssignmentMs, serverNow: new Date().toISOString(),
      openedAt: opened?.recordedAt ?? null,
      deadlineAt: opened ? new Date(Date.parse(opened.recordedAt) + plan.protocol.maxAssignmentMs).toISOString() : null,
      notice: plan.recordingMode === 'synthetic' ? 'Development exercise · synthetic records' : 'Review exercise · pseudonymous assignment',
      sourceNotice: plan.sourceMode === 'local_mock' ? 'Scripted proposal artifacts with local checks. This exercise measures review behavior only.' : 'Previously recorded proposal artifacts. This exercise measures review behavior only.',
      packet: active ? reviewerPacket(plan, events, participantId) : null,
    } };
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) fail(403, 'host_denied', 'Use the operator-provided loopback address.');
      if (request.headers.origin && request.headers.origin !== origin) fail(403, 'origin_denied', 'Cross-origin requests are not accepted.');
      const url = new URL(request.url ?? '/', origin);
      if (url.search) fail(400, 'invalid_request', 'Query parameters are not supported.');
      if (request.method === 'GET' && url.pathname === '/favicon.ico') { headers(response); response.writeHead(204); response.end(); return; }
      if (request.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname)!; headers(response); response.writeHead(200, { 'Content-Type': asset.type }); response.end(asset.bytes); return;
      }
      if (!url.pathname.startsWith('/api/')) fail(404, 'not_found', 'Resource not found.');
      const authorization = request.headers.authorization;
      const participantId = (authorization?.startsWith('Bearer ') ? tokens.get(authorization.slice(7)) : undefined) ?? fail(401, 'access_required', 'A current study access link or token is required.');
      await exclusive(async () => {
        if (await readFile(planPath, 'utf8') !== planBytes) fail(503, 'plan_changed', 'The study plan changed. The operator must review the frozen study state.');
        const current = await snapshot(participantId);
        if (request.method === 'GET' && url.pathname === '/api/session') { json(response, 200, current.public); return; }
        if (request.method !== 'POST' || !['/api/open', '/api/submit', '/api/skip'].includes(url.pathname)) fail(404, 'not_found', 'Resource not found.');
        const schema = url.pathname === '/api/open' ? OpenBody : url.pathname === '/api/submit' ? SubmitBody : SkipBody;
        const parsed = schema.safeParse(await body(request));
        const input = parsed.success ? parsed.data : fail(400, 'invalid_request', 'Unexpected or missing action fields.');
        const action: StudyAction = url.pathname === '/api/open' ? { id: input.requestId, participantId, assignmentId: input.assignmentId, kind: 'opened' } :
          url.pathname === '/api/submit' ? { id: input.requestId, participantId, assignmentId: input.assignmentId, kind: 'submitted', answer: (input as z.infer<typeof SubmitBody>).answer } :
            { id: input.requestId, participantId, assignmentId: input.assignmentId, kind: 'skipped', reason: (input as z.infer<typeof SkipBody>).reason };
        const existing = current.events.find(event => event.action.id === action.id);
        if (existing) {
          if (JSON.stringify(existing.action) !== JSON.stringify(action)) fail(409, 'request_conflict', 'This request ID already belongs to another action.');
          json(response, 200, { ...current.public, actionRecorded: true }); return;
        }
        if (current.next?.id !== input.assignmentId) fail(409, 'assignment_changed', 'This assignment is no longer current. Refresh the review state.');
        if (action.kind === 'opened' && current.public.status === 'active') { json(response, 200, current.public); return; }
        if (action.kind !== 'opened' && current.public.status !== 'active') fail(409, 'assignment_not_open', 'Open the assignment before responding.');
        const expired = current.public.deadlineAt !== null && Date.now() > Date.parse(current.public.deadlineAt);
        if (action.kind === 'submitted' && expired) fail(409, 'assignment_timeout', 'The time allowance ended. Record a timeout skip to continue.');
        if (action.kind === 'skipped' && action.reason === 'timeout' && !expired) fail(409, 'not_expired', 'The time allowance has not ended.');
        try { await appendStudyAction(plan, journalPath, action); }
        catch { fail(409, 'recording_conflict', 'The action was not confirmed. Refresh the current state; contact the operator if the problem continues.'); }
        json(response, 200, { ...(await snapshot(participantId)).public, actionRecorded: true });
      });
    } catch (error) {
      if (!response.headersSent) {
        if (error instanceof HttpError) json(response, error.status, { error: { code: error.code, message: error.message } });
        else json(response, 503, { error: { code: 'study_unavailable', message: 'Study state is unavailable. The operator must inspect the private journal.' } });
      } else response.end();
    }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 5_000; server.keepAliveTimeout = 5_000; server.maxConnections = 32;
  try {
    for (const [url, filename, type] of [['/', 'index.html', 'text/html; charset=utf-8'], ['/app.js', 'app.js', 'text/javascript; charset=utf-8'], ['/style.css', 'style.css', 'text/css; charset=utf-8']] as const) {
      assets.set(url, { type, bytes: await readFile(new URL(`reviewer-web/${filename}`, import.meta.url)) });
    }
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No loopback address was assigned.');
    origin = `http://127.0.0.1:${address.port}`;
  } catch (error) { server.close(); await releaseLease(); throw error; }
  return { origin, participantLinks: [...tokens].map(([token, participantId]) => ({ participantId, url: `${origin}/#token=${token}` })),
    async close() {
      if (closed) return; closed = true;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await queue; tokens.clear(); await releaseLease();
    } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [planPath, journalPath, port, ...extra] = process.argv.slice(2);
    if (!planPath || !journalPath || extra.length) throw new Error('Usage: reviewer-server.ts ABSOLUTE_PRIVATE_PLAN ABSOLUTE_PRIVATE_JOURNAL [PORT]');
    const running = await startReviewerServer({ planPath, journalPath, ...(port === undefined ? {} : { port: Number(port) }) });
    console.log(JSON.stringify({ origin: running.origin, scope: 'Loopback-only study collector. Assignment links identify pseudonyms, not authenticated humans. Keep links private.', participantLinks: running.participantLinks }, null, 2));
    const stop = () => { running.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { console.error(error instanceof Error ? error.message : 'Study server startup failed.'); process.exitCode = 2; }
}
