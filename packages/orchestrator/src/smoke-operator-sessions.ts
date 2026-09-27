import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, openSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { z } from 'zod';
import { canonicalJson, digestBytes } from '../../contracts/src/digest.ts';

export type SmokeSessionJson = null | boolean | number | string | SmokeSessionJson[] | { [key: string]: SmokeSessionJson };
export interface SmokeOperatorSession {
  episodeId: string;
  configDigest: string;
  scope: 'live' | 'synthetic-test';
  phase: 'starting' | 'running' | 'terminal' | 'interrupted';
  cancelRequested: boolean;
  ownerPid: number;
  ownerAlive: boolean;
  createdAt: string;
  updatedAt: string;
  summary: SmokeSessionJson;
}
export type SmokeSessionClaim = { granted: true; token: string; session: SmokeOperatorSession }
  | { granted: false; token: null; session: SmokeOperatorSession };
export class SmokeOperatorSessionError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'SmokeOperatorSessionError'; this.code = code; }
}
function fail(code: string): never { throw new SmokeOperatorSessionError(code); }
const claimSchema = z.strictObject({ episodeId: z.uuid(), configDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), scope: z.enum(['live', 'synthetic-test']) });
const APPLICATION_ID = 0x50505353;
const MAX_SUMMARY_BYTES = 65_536;
const owned = (entry: Stats) => !process.getuid || entry.uid === process.getuid();
const canonicalId = (id: string) => z.uuid().parse(id).toLowerCase();
type SessionRow = Record<string, unknown>;

function privatePath(filename: string) {
  const parent = dirname(filename), root = parse(parent).root;
  let current = root;
  for (const component of parent.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('invalid_path');
  }
  const directory = lstatSync(parent);
  if (!owned(directory) || (directory.mode & 0o077) !== 0) fail('nonprivate_directory');
  for (const path of [filename, filename + '-wal', filename + '-shm', filename + '-journal']) {
    try {
      const entry = lstatSync(path);
      if (!entry.isFile() || entry.isSymbolicLink() || !owned(entry) || entry.nlink !== 1 || (entry.mode & 0o077) !== 0) fail('invalid_file');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
function syncDirectory(directory: string) {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function summaryJson(value: unknown): string {
  const active = new Set<object>();
  const validate = (item: unknown, depth: number): void => {
    if (depth > 64) fail('invalid_summary');
    if (item === null || typeof item === 'boolean' || typeof item === 'string' || typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || active.has(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) fail('invalid_summary');
    active.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const property = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== 'string' || !property.enumerable || !('value' in property) ||
        Array.isArray(item) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) fail('invalid_summary');
      validate(property.value, depth + 1);
    }
    active.delete(item);
  };
  validate(value, 0);
  let encoded: string;
  try { encoded = canonicalJson(value); } catch { return fail('invalid_summary'); }
  if (Buffer.byteLength(encoded) > MAX_SUMMARY_BYTES) fail('summary_too_large');
  return encoded;
}
function ownerAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) fail('invalid_owner');
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // EPERM, PID reuse, and every inconclusive result are treated as still alive.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Trusted metadata storage only. This module cannot sanitize secrets or candidate content:
 * the caller must project summaries before passing them here. A claim is never reissued.
 * Owner tokens are private capabilities, returned once and never included in status.
 * Only the claiming instance/process can update; restart and dead-owner marking never
 * grant execution. Cancellation is a durable request, not proof of external cleanup.
 * PID reuse conservatively prevents interruption; no takeover or resume exists. */
export class SmokeOperatorSessions {
  readonly #filename: string;
  readonly #db: DatabaseSync;
  readonly #identity: { dev: number; ino: number };
  readonly #tokens = new Map<string, string>();
  #closed = false;
  constructor(options: { filename: string }) {
    const filename = options.filename;
    if (!isAbsolute(filename) || filename.includes('\0') || filename.split(sep).includes('..')) fail('invalid_path');
    this.#filename = resolve(filename);
    privatePath(this.#filename);
    try {
      const fd = openSync(this.#filename, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
      syncDirectory(dirname(this.#filename));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    privatePath(this.#filename);
    const entry = lstatSync(this.#filename);
    this.#identity = { dev: entry.dev, ino: entry.ino };
    this.#db = new DatabaseSync(this.#filename);
    try {
      this.#db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
      this.#transaction(() => {
        const application = Number(this.#db.prepare('PRAGMA application_id').get()!.application_id);
        const version = Number(this.#db.prepare('PRAGMA user_version').get()!.user_version);
        const tables = this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        if (application !== APPLICATION_ID && (application !== 0 || tables.length !== 0 || version !== 0)) fail('wrong_database');
        if (application === APPLICATION_ID && version !== 1) fail('unsupported_schema');
        this.#db.exec(`PRAGMA application_id=${APPLICATION_ID};
          CREATE TABLE IF NOT EXISTS smoke_operator_sessions (
            episode_id TEXT PRIMARY KEY, config_digest TEXT NOT NULL,
            scope TEXT NOT NULL CHECK(scope IN ('live','synthetic-test')),
            phase TEXT NOT NULL CHECK(phase IN ('starting','running','terminal','interrupted')),
            owner_pid INTEGER NOT NULL CHECK(owner_pid>0), token_digest TEXT NOT NULL UNIQUE,
            cancel_requested INTEGER NOT NULL CHECK(cancel_requested IN (0,1)),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, summary_json TEXT NOT NULL);
          PRAGMA user_version=1;`);
      });
      this.#db.exec('PRAGMA journal_mode=WAL;');
      privatePath(this.#filename); syncDirectory(dirname(this.#filename));
    } catch (error) { this.#db.close(); throw error; }
  }
  #check() {
    if (this.#closed) fail('store_closed');
    privatePath(this.#filename);
    const entry = lstatSync(this.#filename);
    if (entry.dev !== this.#identity.dev || entry.ino !== this.#identity.ino) fail('database_replaced');
  }
  #transaction<T>(operation: () => T): T {
    this.#check(); this.#db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #row(id: string): SessionRow | undefined { return this.#db.prepare('SELECT * FROM smoke_operator_sessions WHERE episode_id=?').get(id); }
  #view(row: SessionRow): SmokeOperatorSession {
    return { episodeId: String(row.episode_id), configDigest: String(row.config_digest),
      scope: row.scope as SmokeOperatorSession['scope'], phase: row.phase as SmokeOperatorSession['phase'],
      cancelRequested: row.cancel_requested === 1, ownerPid: Number(row.owner_pid), ownerAlive: ownerAlive(Number(row.owner_pid)),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), summary: JSON.parse(String(row.summary_json)) as SmokeSessionJson };
  }
  claimStart(value: { episodeId: string; configDigest: string; scope: 'live' | 'synthetic-test' }): SmokeSessionClaim {
    const claim = claimSchema.parse(value), id = canonicalId(claim.episodeId);
    return this.#transaction(() => {
      const existing = this.#row(id);
      if (existing) {
        if (existing.config_digest !== claim.configDigest || existing.scope !== claim.scope) fail('binding_conflict');
        return { granted: false, token: null, session: this.#view(existing) };
      }
      const token = randomBytes(32).toString('hex'), now = new Date().toISOString();
      this.#db.prepare('INSERT INTO smoke_operator_sessions VALUES(?,?,?,?,?,?,0,?,?,?)')
        .run(id, claim.configDigest, claim.scope, 'starting', process.pid, digestBytes(token), now, now, 'null');
      this.#tokens.set(token, id);
      return { granted: true, token, session: this.#view(this.#row(id)!) };
    });
  }
  #write(token: string, value: unknown, finish: boolean): SmokeOperatorSession {
    const encoded = summaryJson(value), id = this.#tokens.get(token);
    if (!id) fail('not_owner');
    const session = this.#transaction(() => {
      const row = this.#row(id);
      if (!row || row.owner_pid !== process.pid || row.token_digest !== digestBytes(token)) fail('not_owner');
      if (row.phase !== 'starting' && row.phase !== 'running') fail('session_closed');
      this.#db.prepare('UPDATE smoke_operator_sessions SET phase=?,summary_json=?,updated_at=? WHERE episode_id=?')
        .run(finish ? 'terminal' : 'running', encoded, new Date().toISOString(), id);
      return this.#view(this.#row(id)!);
    });
    if (finish) this.#tokens.delete(token);
    return session;
  }
  update(token: string, summary: unknown): SmokeOperatorSession { return this.#write(token, summary, false); }
  finish(token: string, summary: unknown): SmokeOperatorSession { return this.#write(token, summary, true); }
  status(id: string): SmokeOperatorSession | null {
    id = canonicalId(id); this.#check(); const row = this.#row(id);
    return row ? this.#view(row) : null;
  }
  requestCancel(id: string): SmokeOperatorSession {
    id = canonicalId(id);
    return this.#transaction(() => {
      if (!this.#row(id)) fail('missing_session');
      this.#db.prepare('UPDATE smoke_operator_sessions SET cancel_requested=1,updated_at=? WHERE episode_id=?')
        .run(new Date().toISOString(), id);
      return this.#view(this.#row(id)!);
    });
  }
  markInterrupted(id: string): SmokeOperatorSession {
    id = canonicalId(id);
    return this.#transaction(() => {
      const row = this.#row(id);
      if (!row) fail('missing_session');
      if (row.phase === 'terminal' || row.phase === 'interrupted') return this.#view(row);
      if (ownerAlive(Number(row.owner_pid))) fail('owner_still_alive');
      this.#db.prepare("UPDATE smoke_operator_sessions SET phase='interrupted',updated_at=? WHERE episode_id=?")
        .run(new Date().toISOString(), id);
      return this.#view(this.#row(id)!);
    });
  }
  close() { if (!this.#closed) { this.#db.close(); this.#tokens.clear(); this.#closed = true; } }
}
