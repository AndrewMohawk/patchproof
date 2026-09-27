import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digestBytes } from '../packages/contracts/src/digest.ts';
import { inspectContractLocks } from '../scripts/contract-locks.ts';

test('current contract locks and exact historical snapshots are validated independently', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-contract-locks-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const write = async (path: string, value: string) => { const file = join(directory, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, value); };
  await write('current-v1.ts', 'invented v1'); await write('current-v2.ts', 'invented v2.2'); await write('legacy-reader.ts', 'invented guarded historical reader');
  await write('research/contracts-v1-lock.json', JSON.stringify({ version: '1.0', files: { 'current-v1.ts': digestBytes('invented v1') } }));
  await write('research/contracts-v2.2-lock.json', JSON.stringify({ version: '2.2', files: { 'current-v2.ts': digestBytes('invented v2.2'), 'legacy-reader.ts': digestBytes('invented guarded historical reader') } }));
  const original = JSON.stringify({ version: '2.1', files: { 'packages/contracts/src/product.ts': digestBytes('invented historical product'),
    'packages/contracts/src/product-validation.ts': digestBytes('invented historical validation') } }, null, 2);
  await write('research/contracts-v2-lock.json', original); await write('research/contracts-history/2.1/contracts-v2-lock.json', original);
  await write('research/contracts-history/2.1/product.ts', 'invented historical product');
  await write('research/contracts-history/2.1/product-validation.ts', 'invented historical validation');
  const check = () => inspectContractLocks(pathToFileURL(directory + '/'));
  assert.deepEqual((await check()).map(row => row.status), ['pass', 'pass', 'pass']);
  await write('current-v2.ts', 'changed current source'); assert.deepEqual((await check()).map(row => row.status), ['pass', 'blocked', 'pass']);
  await write('current-v2.ts', 'invented v2.2'); await write('legacy-reader.ts', 'changed compatibility reader');
  assert.deepEqual((await check()).map(row => row.status), ['pass', 'blocked', 'pass']);
  await write('legacy-reader.ts', 'invented guarded historical reader'); await write('research/contracts-history/2.1/product.ts', 'changed old snapshot');
  assert.deepEqual((await check()).map(row => row.status), ['pass', 'pass', 'blocked']);
  await write('research/contracts-history/2.1/product.ts', 'invented historical product'); await write('research/contracts-history/2.1/contracts-v2-lock.json', original + '\n');
  assert.deepEqual((await check()).map(row => row.status), ['pass', 'pass', 'blocked'], 'Even whitespace drift changes exact historical lock evidence.');
});
