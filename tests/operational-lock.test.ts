import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { buildOperationalLock, OPERATIONAL_LOCK_FILES, verifyOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';

test('operational lock detects changed prompts, newly loaded code, config and unsupported sampling claims', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-lock-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ['packages/contracts/src','packages/orchestrator/src','workers/repair','apps/api/src','apps/web','scripts']) await mkdir(join(directory,path), { recursive: true });
  for (const path of OPERATIONAL_LOCK_FILES) {
    await mkdir(join(directory, dirname(path)), { recursive: true });
    await writeFile(join(directory, path), '{}\n');
  }
  const prompt = join(directory,'workers/repair/index.ts'); await writeFile(prompt,'export const prompt = "original";\n');
  const lock = buildOperationalLock(directory); const digest = digestJson(lock);
  assert.deepEqual(verifyOperationalLock(directory, lock, digest), lock);
  assert.equal(lock.liveProtocolFrozen, false); assert.equal(lock.behavior.modelSeed, null);
  await writeFile(prompt,'export const prompt = "changed";\n');
  assert.throws(() => verifyOperationalLock(directory, lock, digest), /Operational source/);
  await writeFile(prompt,'export const prompt = "original";\n');
  await writeFile(join(directory,'workers/repair/new.ts'),'export const added = true;\n');
  assert.throws(() => verifyOperationalLock(directory, lock), /Operational source/);
  await rm(join(directory,'workers/repair/new.ts'));
  await writeFile(join(directory,'scripts/driver.py'),'print("changed checker")\n');
  assert.throws(() => verifyOperationalLock(directory, lock), /Operational source/);
  await rm(join(directory,'scripts/driver.py'));
  await writeFile(join(directory,'workers/repair/request.json'),'{"temperature":0.1}\n');
  assert.throws(() => verifyOperationalLock(directory, lock), /Operational source/);
  await rm(join(directory,'workers/repair/request.json'));
  await symlink(prompt, join(directory,'workers/repair/linked.ts'));
  assert.throws(() => buildOperationalLock(directory), /symlinks/);
  await rm(join(directory,'workers/repair/linked.ts'));
  await writeFile(join(directory,'budget.json'),'{"changed":true}\n');
  assert.throws(() => verifyOperationalLock(directory, lock), /Operational source/);
  await writeFile(join(directory,'budget.json'),'{}\n');
  await writeFile(join(directory,'research/product-v3/model-discovery.json'),'{"changed":true}\n');
  assert.throws(() => verifyOperationalLock(directory, lock), /Operational source/);
  await writeFile(join(directory,'research/product-v3/model-discovery.json'),'{}\n');
  assert.throws(() => verifyOperationalLock(directory, { ...lock, behavior: { ...lock.behavior, modelSeed: 42 } }), /Unsupported/);
  assert.throws(() => verifyOperationalLock(directory, lock, 'sha256:' + 'a'.repeat(64)), /digest mismatch/);
});
