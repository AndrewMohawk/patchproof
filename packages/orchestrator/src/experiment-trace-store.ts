import { closeSync, constants, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { z } from 'zod';
import { canonicalJson, digestBytes, digestJson } from '../../contracts/src/digest.ts';

export type TraceJson = null | boolean | number | string | TraceJson[] | { [key: string]: TraceJson };
export interface ExperimentTraceClaim { format: 'patchproof-experiment-trace-claim-v1'; id: string; bindingDigest: string; claimedAt: string; }
export interface ExperimentTraceRecord { sequence: number; previousDigest: string; value: TraceJson; digest: string; }
export interface ExperimentTrace { format: 'patchproof-experiment-trace-v1'; claim: ExperimentTraceClaim; records: ExperimentTraceRecord[]; result: TraceJson; }
interface ActiveClaim { claim: ExperimentTraceClaim; claimDigest: string; count: number; previousDigest: string; closed: boolean; }
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const claimSchema = z.strictObject({ format: z.literal('patchproof-experiment-trace-claim-v1'), id: z.uuid(),
  bindingDigest: digestSchema, claimedAt: z.iso.datetime() });
function fail(message: string): never { throw new Error(message); }
const owned = (info: Stats) => !process.getuid || info.uid === process.getuid();
const canonicalId = (id: string) => z.uuid().parse(id).toLowerCase();

function privateDirectory(path: string) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || !owned(info) || (info.mode & 0o077) !== 0) fail('Trace directory must be private, owned and without symlinks.');
}
function verifyAncestors(path: string) {
  const root = parse(path).root;
  let current = root;
  for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('Trace directory ancestors must not use symlinks.');
  }
}
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function createDirectory(path: string) {
  mkdirSync(path, { mode: 0o700 });
  privateDirectory(path); syncDirectory(path); syncDirectory(dirname(path));
}
function prepareDirectory(path: string) {
  const root = parse(path).root;
  let current = root;
  for (const component of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    try { createDirectory(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('Trace directory ancestors must not use symlinks.');
  }
  privateDirectory(path);
}
function writeExclusive(path: string, bytes: string) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(path));
}
function readPrivate(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || !owned(info) || (info.mode & 0o077) !== 0 || info.nlink !== 1) fail('Trace file must be a private owned regular file.');
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
function normalize(value: unknown): TraceJson {
  const seen = new Set<object>();
  const check = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || !item || seen.has(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) fail('Trace values must be finite, acyclic JSON.');
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor) ||
          (Array.isArray(item) && (!/^(0|[1-9][0-9]*)$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) >= item.length))) fail('Trace values must contain only JSON data properties.');
      check(descriptor.value);
    }
    seen.delete(item);
  };
  check(value);
  return JSON.parse(canonicalJson(value)) as TraceJson;
}
function verifyTrace(value: unknown): ExperimentTrace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Invalid experiment trace.');
  const trace = value as ExperimentTrace;
  if (Object.keys(trace).sort().join(',') !== 'claim,format,records,result' || trace.format !== 'patchproof-experiment-trace-v1' || !Array.isArray(trace.records)) fail('Invalid experiment trace.');
  claimSchema.parse(trace.claim);
  let previous = digestJson(trace.claim);
  for (const [index, record] of trace.records.entries()) {
    if (!record || Object.keys(record).sort().join(',') !== 'digest,previousDigest,sequence,value' || record.sequence !== index + 1 || record.previousDigest !== previous) fail('Trace record sequence or chain mismatch.');
    const { digest, ...body } = record;
    if (digestSchema.parse(digest) !== digestJson(body)) fail('Trace record digest mismatch.');
    normalize(record.value); previous = digest;
  }
  normalize(trace.result);
  return trace;
}

/** Private trusted JSON storage. A claimed run is writable only by this instance.
 * A process/instance restart cannot resume it, and write failures close it to further writes. */
export class ExperimentTraceStore {
  readonly directory: string;
  readonly #claims = new Map<string, ActiveClaim>();
  constructor(directory: string) {
    if (!isAbsolute(directory) || directory.includes('\0') || directory.split(sep).includes('..')) fail('An absolute trace path without traversal is required.');
    this.directory = resolve(directory);
    prepareDirectory(this.directory);
    for (const name of ['runs', 'objects']) {
      const path = join(this.directory, name);
      try { createDirectory(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      privateDirectory(path);
    }
  }
  #root() { verifyAncestors(this.directory); privateDirectory(this.directory); privateDirectory(join(this.directory, 'runs')); privateDirectory(join(this.directory, 'objects')); }
  #run(id: string) { const parsed = canonicalId(id); this.#root(); return join(this.directory, 'runs', parsed); }
  #active(id: string) {
    const path = this.#run(id), state = this.#claims.get(canonicalId(id));
    if (!state || state.closed) fail('Trace claim is not writable by this instance.');
    privateDirectory(path); privateDirectory(join(path, 'records'));
    const claimBytes = readPrivate(join(path, 'claim.json'));
    if (digestBytes(claimBytes) !== state.claimDigest) { state.closed = true; fail('Trace claim changed after creation.'); }
    return { path, state };
  }
  claim(id: string, bindingDigest: string): ExperimentTraceClaim {
    id = canonicalId(id);
    const path = this.#run(id); digestSchema.parse(bindingDigest);
    const claim: ExperimentTraceClaim = { format: 'patchproof-experiment-trace-claim-v1', id, bindingDigest, claimedAt: new Date().toISOString() };
    // The directory itself is the exclusive reservation, including interrupted partial claims.
    createDirectory(path);
    createDirectory(join(path, 'records'));
    writeExclusive(join(path, 'claim.json'), canonicalJson(claim));
    const claimDigest = digestJson(claim);
    this.#claims.set(id, { claim, claimDigest, count: 0, previousDigest: claimDigest, closed: false });
    return structuredClone(claim);
  }
  append(id: string, value: unknown): { sequence: number; digest: string; path: string } {
    const { path, state } = this.#active(id), data = normalize(value);
    const body = { sequence: state.count + 1, previousDigest: state.previousDigest, value: data };
    const record: ExperimentTraceRecord = { ...body, digest: digestJson(body) };
    const filename = join(path, 'records', String(body.sequence).padStart(8, '0') + '.json');
    try { writeExclusive(filename, canonicalJson(record)); }
    catch (error) { state.closed = true; throw error; }
    state.count = body.sequence; state.previousDigest = record.digest;
    return { sequence: body.sequence, digest: record.digest, path: filename };
  }
  finalize(id: string, value: unknown): { digest: string; path: string } {
    const { path, state } = this.#active(id), result = normalize(value);
    state.closed = true;
    const expected = Array.from({ length: state.count }, (_, index) => String(index + 1).padStart(8, '0') + '.json');
    const actual = readdirSync(join(path, 'records')).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('Trace records changed or are incomplete.');
    const records = expected.map(name => JSON.parse(readPrivate(join(path, 'records', name))) as ExperimentTraceRecord);
    const trace = verifyTrace({ format: 'patchproof-experiment-trace-v1', claim: state.claim, records, result });
    if ((records.at(-1)?.digest ?? state.claimDigest) !== state.previousDigest) fail('Committed trace record changed.');
    const bytes = canonicalJson(trace), digest = digestBytes(bytes), filename = join(this.directory, 'objects', digest.slice(7) + '.json');
    writeExclusive(join(path, 'finalization.json'), canonicalJson({ digest }));
    writeExclusive(filename, bytes);
    return { digest, path: filename };
  }
  get(digest: string): ExperimentTrace {
    digestSchema.parse(digest); this.#root();
    const bytes = readPrivate(join(this.directory, 'objects', digest.slice(7) + '.json'));
    if (digestBytes(bytes) !== digest) fail('Experiment trace digest mismatch.');
    return verifyTrace(JSON.parse(bytes));
  }
}
