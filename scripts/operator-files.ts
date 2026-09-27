import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export class OperatorFileError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const fail = (code: string): never => { throw new OperatorFileError(code); };
const owned = (stat: Stats) => !process.getuid || stat.uid === process.getuid();
const privateFile = (stat: Stats) => stat.isFile() && !stat.isSymbolicLink() &&
  owned(stat) && (Number(stat.mode) & 0o077) === 0 && stat.nlink === 1;

/** Explicit operator paths only. This is a file hygiene check, not a same-UID sandbox. */
export function assertPrivateOperatorPath(filename: string, projectRoot: string,
  options: { allowMissing?: boolean; database?: boolean } = {}): boolean {
  if (typeof filename !== 'string' || filename.length > 4096 || /[\x00-\x1f\x7f]/.test(filename) ||
      !isAbsolute(filename) || resolve(filename) !== filename) fail('operator_path_invalid');
  const fromProject = relative(resolve(projectRoot), filename);
  if (!fromProject || (!fromProject.startsWith('..' + sep) && fromProject !== '..' && !isAbsolute(fromProject))) {
    fail('operator_path_inside_project');
  }
  const parent = dirname(filename), root = parse(parent).root;
  let current = root;
  for (const component of parent.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, component);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('operator_directory_invalid');
  }
  const directory = lstatSync(parent);
  if (!owned(directory) || (Number(directory.mode) & 0o077) !== 0) fail('operator_directory_not_private');
  let exists = true;
  try { if (!privateFile(lstatSync(filename))) fail('operator_file_not_private'); }
  catch (error) {
    if (options.allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
    else throw error;
  }
  if (options.database) {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try { if (!privateFile(lstatSync(filename + suffix))) fail('operator_database_sidecar_invalid'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  return exists;
}

export function readPrivateOperatorJson(filename: string,
  options: { projectRoot: string; maximumBytes?: number }): unknown {
  const maximumBytes = options.maximumBytes ?? 2_097_152;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 20_971_520) fail('operator_read_bound_invalid');
  assertPrivateOperatorPath(filename, options.projectRoot);
  const before = lstatSync(filename);
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(descriptor);
    if (!privateFile(opened) || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > maximumBytes) {
      fail('operator_file_changed_or_oversized');
    }
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length <= maximumBytes) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > maximumBytes) fail('operator_file_changed_or_oversized');
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } finally { closeSync(descriptor); }
}

/** Hash the parsed, schema-ordered JSON value, not the file bytes. */
export const operatorJsonDigest = (value: unknown): string =>
  'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
