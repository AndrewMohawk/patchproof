import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { z } from 'zod';
import { ContractError } from '../../contracts/src/index.ts';
import { verifyBundle } from './bundle.ts';
import type { MockBundle } from './bundle.ts';

type Directory = '.local/mock/' | 'artifacts/';

async function directoryPath(root: URL, directory: Directory, create: boolean): Promise<URL> {
  let parent = root;
  for (const component of directory.split('/').filter(Boolean)) {
    const entry = new URL(component, parent);
    const path = new URL(`${component}/`, parent);
    if (create) {
      try { await mkdir(entry, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const info = await lstat(entry);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new ContractError('invalid_request', 'Artifact directories must be real project directories.');
    }
    parent = path;
  }
  return parent;
}

function validateId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new ContractError('invalid_request', 'RUN must be a run UUID.');
}

export async function readBundle(root: URL, directory: Directory, id: string): Promise<MockBundle> {
  validateId(id);
  const parent = await directoryPath(root, directory, false);
  const file = await open(new URL(`${id}.json`, parent), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1_000_000) throw new ContractError('invalid_request', 'Invalid artifact file or size.');
    const bundle = verifyBundle(JSON.parse(await file.readFile('utf8')));
    if (bundle.run.id !== id) throw new ContractError('digest_mismatch', 'Stored run ID differs from requested ID.');
    return bundle;
  } finally { await file.close(); }
}

export async function optionalBundle(root: URL, directory: Directory, id: string): Promise<MockBundle | null> {
  try { return await readBundle(root, directory, id); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function writeBundle(root: URL, directory: Directory, bundleValue: MockBundle): Promise<void> {
  const bundle = verifyBundle(bundleValue);
  const parent = await directoryPath(root, directory, true);
  const path = new URL(`${bundle.run.id}.json`, parent);
  let file;
  try {
    file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readBundle(root, directory, bundle.run.id);
    verifyBundle(existing, bundle.bundleDigest); // Idempotent, never overwrite different bytes.
    return;
  }
  try { await file.writeFile(JSON.stringify(bundle, null, 2) + '\n'); }
  finally { await file.close(); }
}
