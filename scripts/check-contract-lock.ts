import { readFile } from 'node:fs/promises';
import { digestBytes } from '../packages/contracts/src/digest.ts';

const root = new URL('../', import.meta.url);
const lock = JSON.parse(await readFile(new URL('research/contracts-v1-lock.json', root), 'utf8')) as {
  version: string; files: Record<string, string>;
};
for (const [path, expected] of Object.entries(lock.files)) {
  const actual = digestBytes(await readFile(new URL(path, root)));
  if (actual !== expected) throw new Error(`Contract changed without a reviewed lock update: ${path}`);
}
console.log(`Contract ${lock.version}: ${Object.keys(lock.files).length} source digests match. Dependency gates remain separate.`);
