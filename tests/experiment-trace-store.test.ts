import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ExperimentTraceStore } from '../packages/orchestrator/src/experiment-trace-store.ts';
import { canonicalJson, digestBytes, digestJson } from '../packages/contracts/src/digest.ts';

const BINDING = digestBytes('invented trace binding; no provider or fixture inputs');
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-json-trace-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new ExperimentTraceStore(join(directory, 'store')), id: randomUUID() };
}

test('trace claim, sequenced records and final result survive a new reader instance', t => {
  const { store, id } = setup(t), claim = store.claim(id, BINDING);
  const input = { label: 'synthetic first record', nested: { value: 1 } };
  const first = store.append(id, input); input.nested.value = 99;
  const second = store.append(id, ['synthetic second record', null, true]);
  assert.equal(first.sequence, 1); assert.equal(second.sequence, 2);
  const finalized = store.finalize(id, { state: 'synthetic-complete' });
  const reader = new ExperimentTraceStore(store.directory), trace = reader.get(finalized.digest);
  assert.deepEqual(trace.claim, claim); assert.equal(trace.records.length, 2);
  assert.deepEqual(trace.records[0]!.value, { label: 'synthetic first record', nested: { value: 1 } });
  assert.equal(trace.records[1]!.previousDigest, first.digest);
  assert.deepEqual(trace.result, { state: 'synthetic-complete' });
  assert.equal(digestBytes(readFileSync(finalized.path)), finalized.digest);
  assert.equal(readFileSync(finalized.path, 'utf8'), canonicalJson(trace));
  trace.records.length = 0; assert.equal(reader.get(finalized.digest).records.length, 2);
});

test('claims are exclusive, finalized claims close and reopen never resumes interrupted claims', t => {
  const { store, id } = setup(t); store.claim(id, BINDING); store.append(id, 'synthetic partial record');
  const reopened = new ExperimentTraceStore(store.directory);
  for (const instance of [store, reopened]) assert.throws(() => instance.claim(id, BINDING), /EEXIST/);
  assert.throws(() => store.claim(id.toUpperCase(), BINDING), /EEXIST/);
  assert.throws(() => reopened.append(id, 'not allowed'), /not writable/);
  assert.throws(() => reopened.finalize(id, 'not allowed'), /not writable/);
  const result = store.finalize(id, null), bytes = readFileSync(result.path);
  assert.throws(() => store.append(id, 'after finalization'), /not writable/);
  assert.throws(() => store.finalize(id, 'second finalization'), /not writable/);
  assert.deepEqual(readFileSync(result.path), bytes);
});

test('claim return values cannot mutate the privately retained binding', t => {
  const { store, id } = setup(t), claim = store.claim(id, BINDING);
  claim.bindingDigest = digestBytes('changed');
  const result = store.finalize(id, 'synthetic empty trace');
  assert.equal(store.get(result.digest).claim.bindingDigest, BINDING);
  assert.deepEqual(store.get(result.digest).records, []);
});

test('invalid IDs, digests and traversal cannot create or read arbitrary paths', t => {
  const { store, directory } = setup(t);
  for (const id of ['../outside', '/absolute', 'not-a-uuid']) assert.throws(() => store.claim(id, BINDING));
  assert.throws(() => store.claim(randomUUID(), '../wrong'));
  assert.throws(() => store.get('../outside'));
  assert.throws(() => new ExperimentTraceStore('relative'));
  assert.throws(() => new ExperimentTraceStore(join(directory, 'store') + '/../other'));
  assert.deepEqual(readdirSync(join(store.directory, 'runs')), []);
});

test('trace values reject non-JSON, cyclic, sparse and accessor data before committing a record', t => {
  const { store, id } = setup(t); store.claim(id, BINDING);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const values = [undefined, NaN, Infinity, 1n, () => 1, new Date(), cycle, Array(1), { value: undefined },
    Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('getter must not execute'); } }),
    { [Symbol('not JSON')]: 'hidden' }];
  for (const value of values) assert.throws(() => store.append(id, value));
  assert.deepEqual(readdirSync(join(store.directory, 'runs', id, 'records')), []);
  assert.equal(store.append(id, 'valid synthetic JSON').sequence, 1);
});

test('all created state directories and files are private', t => {
  const { store, id } = setup(t); store.claim(id, BINDING);
  const record = store.append(id, 'synthetic record'), final = store.finalize(id, 'synthetic result');
  for (const path of [store.directory, join(store.directory, 'runs'), join(store.directory, 'objects'), join(store.directory, 'runs', id), join(store.directory, 'runs', id, 'records')]) {
    assert.equal(statSync(path).mode & 0o777, 0o700);
  }
  for (const path of [join(store.directory, 'runs', id, 'claim.json'), join(store.directory, 'runs', id, 'finalization.json'), record.path, final.path]) {
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
});

test('nonprivate directories and symlink ancestors reject before claim creation', t => {
  const { directory } = setup(t), shared = join(directory, 'shared'), target = join(directory, 'target'), alias = join(directory, 'alias');
  mkdirSync(shared, { mode: 0o700 }); chmodSync(shared, 0o755);
  assert.throws(() => new ExperimentTraceStore(shared), /private/);
  mkdirSync(target, { mode: 0o700 }); symlinkSync(target, alias);
  assert.throws(() => new ExperimentTraceStore(join(alias, 'nested')), /symlink/);
  assert.deepEqual(readdirSync(target), []);
});

test('claim modification is detected before any further record is committed', t => {
  const { store, id } = setup(t); store.claim(id, BINDING);
  writeFileSync(join(store.directory, 'runs', id, 'claim.json'), '{}');
  assert.throws(() => store.append(id, 'synthetic record'), /claim changed/);
  assert.deepEqual(readdirSync(join(store.directory, 'runs', id, 'records')), []);
});

test('record tampering or deletion prevents finalization and does not reopen the claim', t => {
  const { store, id } = setup(t); store.claim(id, BINDING);
  const record = store.append(id, 'synthetic original');
  const modified = JSON.parse(readFileSync(record.path, 'utf8')); modified.value = 'synthetic modified';
  writeFileSync(record.path, JSON.stringify(modified));
  assert.throws(() => store.finalize(id, 'synthetic result'), /digest mismatch/);
  assert.throws(() => store.append(id, 'retry'), /not writable/);
  assert.deepEqual(readdirSync(join(store.directory, 'objects')), []);
  const next = randomUUID(); store.claim(next, BINDING); const missing = store.append(next, null); rmSync(missing.path);
  assert.throws(() => store.finalize(next, null), /incomplete/);
});

test('record collision closes the claim instead of overwriting committed bytes', t => {
  const { store, id } = setup(t); store.claim(id, BINDING);
  const filename = join(store.directory, 'runs', id, 'records', '00000001.json');
  writeFileSync(filename, 'synthetic pre-existing bytes', { mode: 0o600 });
  assert.throws(() => store.append(id, null), /EEXIST/);
  assert.equal(readFileSync(filename, 'utf8'), 'synthetic pre-existing bytes');
  assert.throws(() => store.append(id, null), /not writable/);
});

test('final trace reads reject tampering, symlinks and nonprivate files', t => {
  const { store, id, directory } = setup(t); store.claim(id, BINDING);
  const final = store.finalize(id, 'synthetic result'), original = readFileSync(final.path);
  writeFileSync(final.path, '{}'); assert.throws(() => store.get(final.digest), /digest mismatch/);
  writeFileSync(final.path, original); chmodSync(final.path, 0o644); assert.throws(() => store.get(final.digest), /private/);
  chmodSync(final.path, 0o600); rmSync(final.path);
  const target = join(directory, 'synthetic-target.json'); writeFileSync(target, original, { mode: 0o600 }); symlinkSync(target, final.path);
  assert.throws(() => store.get(final.digest)); assert.deepEqual(readFileSync(target), original);
});

test('an existing content-addressed destination is never overwritten', t => {
  const { store, id } = setup(t), claim = store.claim(id, BINDING);
  const digest = digestJson({ format: 'patchproof-experiment-trace-v1', claim, records: [], result: null });
  const filename = join(store.directory, 'objects', digest.slice(7) + '.json');
  writeFileSync(filename, 'synthetic existing artifact', { mode: 0o600 });
  assert.throws(() => store.finalize(id, null), /EEXIST/);
  assert.equal(readFileSync(filename, 'utf8'), 'synthetic existing artifact');
  assert.throws(() => store.finalize(id, null), /not writable/);
});

test('process interruption leaves an exclusive claim that no new process can resume', async t => {
  const { store, id, directory } = setup(t), child = join(directory, 'claim-child.mjs');
  writeFileSync(child, `import { ExperimentTraceStore } from ${JSON.stringify(new URL('../packages/orchestrator/src/experiment-trace-store.ts', import.meta.url).href)};\nconst store = new ExperimentTraceStore(process.argv[2]);\nstore.claim(process.argv[3], ${JSON.stringify(BINDING)});\nstore.append(process.argv[3], 'synthetic child checkpoint');\nprocess.exit(17);\n`, { mode: 0o600 });
  await assert.rejects(promisify(execFile)(process.execPath, [child, store.directory, id], { env: {} }), { code: 17 });
  const reopened = new ExperimentTraceStore(store.directory);
  assert.throws(() => reopened.claim(id, BINDING), /EEXIST/);
  assert.throws(() => reopened.append(id, 'retry'), /not writable/);
  assert.throws(() => reopened.finalize(id, 'retry'), /not writable/);
  const record = JSON.parse(readFileSync(join(store.directory, 'runs', id, 'records', '00000001.json'), 'utf8'));
  assert.equal(record.value, 'synthetic child checkpoint');
});

test('concurrent processes grant exactly one claim for the same UUID', async t => {
  const { store, id, directory } = setup(t), child = join(directory, 'race-child.mjs');
  writeFileSync(child, `import { ExperimentTraceStore } from ${JSON.stringify(new URL('../packages/orchestrator/src/experiment-trace-store.ts', import.meta.url).href)};\nconst store = new ExperimentTraceStore(process.argv[2]);\ntry { store.claim(process.argv[3], ${JSON.stringify(BINDING)}); console.log('claimed'); } catch (error) { if (error.code === 'EEXIST') console.log('already-claimed'); else throw error; }\n`, { mode: 0o600 });
  const outputs = await Promise.all(Array.from({ length: 3 }, () => promisify(execFile)(process.execPath, [child, store.directory, id], { env: {} })));
  assert.deepEqual(outputs.map(output => output.stdout.trim()).sort(), ['already-claimed', 'already-claimed', 'claimed']);
  assert.equal(JSON.parse(readFileSync(join(store.directory, 'runs', id, 'claim.json'), 'utf8')).id, id);
});
