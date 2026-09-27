import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ReleasePathSchema } from './release-receipts.ts';

/** Explicit repository-relative regular files only. Never follow an ancestor or final symlink. */
export async function readReleaseFile(root: string, relative: string, maximumBytes = 20_971_520): Promise<Buffer> {
  ReleasePathSchema.parse(relative);
  let path = resolve(root);
  const rootInfo = await lstat(path);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('release_root_not_directory');
  const parts = relative.split('/');
  for (const [i, part] of parts.entries()) {
    path = join(path, part);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new Error('release_symlink_or_invalid_path');
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximumBytes) throw new Error('release_artifact_size_or_type');
    const bytes = await handle.readFile();
    if (bytes.length > maximumBytes) throw new Error('release_artifact_size');
    return bytes;
  } finally { await handle.close(); }
}
