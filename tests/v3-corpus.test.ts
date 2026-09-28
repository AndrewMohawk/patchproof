import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import { fixtureDigests, validatePaths } from '../packages/orchestrator/src/fixtures.ts';

const root = new URL('../', import.meta.url);
const ids = ['config-overlay', 'cursor-pagination', 'event-fold', 'inventory-reservation',
  'invoice-allocation', 'manifest-merge', 'retry-batches', 'search-ranking', 'ttl-cache', 'weekly-schedule']
  .map(slug => `v3-${slug}`).sort();

test('public development v3 manifest binds exactly ten distinct curated scenarios', async () => {
  const manifest = JSON.parse(await readFile(new URL('fixtures/v3-development-manifest.json', root), 'utf8'));
  const names = await readdir(new URL('fixtures/development/', root));
  assert.equal(manifest.corpusId, 'owned-public-development-v3');
  assert.equal(manifest.referenceRepairsIncluded, false);
  assert.equal(manifest.originalCorpusPreserved, true);
  assert.equal(manifest.taskCount, ids.length);
  assert.equal(manifest.totalChecks, 220);
  assert.equal(manifest.visibleChecks, 50);
  assert.deepEqual(manifest.tasks.map((task: {id: string}) => task.id).sort(), ids);
  assert.deepEqual(names.filter(name => /^v3-.*\.json$/.test(name)).map(name => name.slice(0, -5)).sort(), ids);
  for (const task of manifest.tasks) {
    const bytes = await readFile(new URL(`fixtures/development/${task.id}.json`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), task.fixtureSha256, `${task.id} fixture byte digest`);
    const fixture = FixtureSchema.parse(JSON.parse(bytes.toString()));
    assert.equal(fixture.id, task.id);
    assert.equal(fixture.repoId, `owned-${task.id}`);
    assert.equal(fixture.split, 'development');
    assert.equal(fixture.license, 'CC0-1.0');
    assert.deepEqual(fixtureDigests(fixture), {sourceDigest: task.sourceDigest, policyDigest: task.policyDigest});
    validatePaths(fixture.files, fixture.editAllowlist);
    assert.deepEqual(Object.keys(fixture.files), [fixture.entrypoint]);
    assert.deepEqual(fixture.editAllowlist, [fixture.entrypoint]);
    const source = fixture.files[fixture.entrypoint]!;
    assert.match(source, /SPDX-License-Identifier: CC0-1\.0/);
    assert.equal(source.trimEnd().split('\n').length, task.sourceLines);
    assert.equal(source.split('\n').filter(line => line.startsWith('def ')).length, task.helperFunctions);
    assert(task.sourceLines >= 60 && task.sourceLines <= 120);
    assert(task.helperFunctions >= 4);
  }
});

test('v3 check coverage and observed starting examples remain bound to declared tasks', async () => {
  const manifest = JSON.parse(await readFile(new URL('fixtures/v3-development-manifest.json', root), 'utf8'));
  for (const task of manifest.tasks) {
    const fixture = FixtureSchema.parse(JSON.parse(await readFile(new URL(`fixtures/development/${task.id}.json`, root), 'utf8')));
    assert.equal(fixture.requirements.length, 5);
    assert.equal(fixture.visibleCases.length, 5);
    assert.equal(fixture.acceptanceCases.length, 17);
    const checks = [...fixture.visibleCases, ...fixture.acceptanceCases];
    const requirements = new Set(fixture.requirements.map(requirement => requirement.id));
    assert.equal(new Set(checks.map(check => check.id)).size, checks.length);
    assert(checks.every(check => check.id.startsWith(`${fixture.id}-`) && requirements.has(check.requirementId)));
    assert(checks.every(check => check.assertArgsUnchanged));
    assert.deepEqual(new Set(checks.map(check => check.requirementId)), requirements);
    assert.equal(task.checks, checks.length);
    assert.equal(task.visibleChecks, fixture.visibleCases.length);
    assert.deepEqual(task.baselineVisibleObservations.map((observation: {id: string}) => observation.id), fixture.visibleCases.map(check => check.id));
    assert(task.baselineVisibleObservations.every((observation: {passed: boolean; argsUnchanged: boolean}) =>
      typeof observation.passed === 'boolean' && typeof observation.argsUnchanged === 'boolean'));
    assert(task.baselinePassed <= checks.length - 4);
    assert.equal(task.referencePassed, checks.length);
    assert(task.isolatedDefectControls.length >= 3);
    assert(task.isolatedDefectControls.every((control: {rejectedByChecks: number}) => control.rejectedByChecks > 0));
  }
});
