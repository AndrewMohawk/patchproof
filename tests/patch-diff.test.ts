import assert from 'node:assert/strict';
import test from 'node:test';
import { createPatch, createLegacyPatch, applyPatch } from '../packages/orchestrator/src/patch.ts';
const { parseDiff } = await import(new URL('../apps/web/diff-view.js', import.meta.url).href);

test('a one-line repair preserves unchanged function context and replays exactly', async () => {
  const before = { 'service.py': 'def calculate(value):\n    total = value + 1\n    return total\n' };
  const after = { 'service.py': 'def calculate(value):\n    total = value + 2\n    return total\n' };
  const patch = createPatch(before, after);
  assert.match(patch, /\n def calculate\(value\):\n/);
  assert.doesNotMatch(patch, /\n[-+]def calculate/);
  const files = parseDiff(patch);
  assert.equal(files[0].additions, 1); assert.equal(files[0].deletions, 1);
  assert.deepEqual(await applyPatch(before, patch), after);
});

test('historical whole-file patches display equal lines as context without changing source evidence', () => {
  const patch = 'diff --git a/task.py b/task.py\n--- a/task.py\n+++ b/task.py\n@@ -1,3 +1,3 @@\n-def work():\n-    value = 1\n-    return value\n+def work():\n+    value = 2\n+    return value\n';
  const [file] = parseDiff(patch);
  assert.equal(file.additions, 1); assert.equal(file.deletions, 1);
  assert.deepEqual(file.hunks[0].rows.map((r: any) => [r.type, r.oldLine, r.newLine]), [['context', 1, 1], ['remove', 2, null], ['add', null, 2], ['context', 3, 3]]);
  assert.match(patch, /-def work/);
});

test('newline-only changes stay visible and Unicode, added files and separated hunks replay', async () => {
  for (const [before, after] of [
    [{ 's.py': 'value = "é"' }, { 's.py': 'value = "é"\n' }],
    [{ 's.py': 'x = 1\r\n' }, { 's.py': 'x = 2\r\n', 'helper.py': '# new\n' }],
    [{ 's.py': Array.from({ length: 40 }, (_, i) => `n${i} = ${i}\n`).join('') }, { 's.py': Array.from({ length: 40 }, (_, i) => `n${i} = ${i === 2 || i === 35 ? 90 : i}\n`).join('') }],
  ] as Array<[Record<string, string>, Record<string, string>]>) {
    const patch = createPatch(before, after);
    assert.deepEqual(await applyPatch(before, patch), after);
    const parsed = parseDiff(patch); assert.ok(parsed.length);
    assert.ok(parsed.some((file: any) => file.additions + file.deletions > 0));
  }
});

test('public task projection exposes starting code and visible examples only', async () => {
  const { loadFixtures, publicTask } = await import('../packages/orchestrator/src/fixtures.ts');
  const fixture = (await loadFixtures(new URL('../', import.meta.url))).find(f => f.id === 'stable-unique-01')!;
  const task = publicTask(fixture);
  assert.deepEqual(task.files, fixture.files); assert.deepEqual(task.examples, fixture.visibleCases);
  assert.equal('acceptanceCases' in task, false);
  assert.ok(fixture.acceptanceCases.every(check => !task.examples.some(example => example.id === check.id)));
});

test('legacy and contextual patches both verify, preserve their bytes, and reject source mismatch', async () => {
  const { syntheticArchiveBundle } = await import('./helpers/archive-fixture.ts');
  const { buildEvidence, verifyEvidence } = await import('../packages/orchestrator/src/evidence.ts');
  for (const create of [createLegacyPatch, createPatch]) {
    const bundle = syntheticArchiveBundle('mock', '2.2', 'baseline');
    const candidate = bundle.run.candidates[0]!;
    candidate.diff = create(bundle.fixture.files, candidate.files);
    const saved = buildEvidence(bundle.run, bundle.fixture, bundle.runtimeLock);
    const serialized = JSON.stringify(saved);
    assert.equal(JSON.stringify(verifyEvidence(saved)), serialized);
    candidate.files[bundle.fixture.entrypoint] += '# incompatible change\n';
    assert.throws(() => verifyEvidence(buildEvidence(bundle.run, bundle.fixture, bundle.runtimeLock)), /Diff\/source mismatch/);
  }
});

test('contextual patches replay repeated lines, empty files and boundary edits across varied inputs', async () => {
  let seed = 3791;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const source = () => Array.from({ length: Math.floor(random() * 45) }, () => ['a\n', 'b\n', 'c\n', '\n', 'value = "é"\n'][Math.floor(random() * 5)]!).join('').replace(/\n$/, random() > .5 ? '' : '\n');
  for (let index = 0; index < 40; index++) {
    const before = { 's.py': source() }, after = { 's.py': source(), 'empty.py': '' };
    assert.deepEqual(await applyPatch(before, createPatch(before, after)), after);
  }
});
