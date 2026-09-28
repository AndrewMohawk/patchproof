import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import { fixtureDigests, validatePaths } from '../packages/orchestrator/src/fixtures.ts';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('fixtures/v3-development-manifest.json', root), 'utf8'));
assert.equal(manifest.taskCount, 10);
assert.equal(manifest.totalChecks, 220);
assert.equal(manifest.referenceRepairsIncluded, false);
assert.equal(new Set(manifest.tasks.map((task: {id: string}) => task.id)).size, manifest.taskCount);
let totalChecks = 0;
for (const task of manifest.tasks) {
  assert.match(task.id, /^v3-[a-z]+(?:-[a-z]+)*$/);
  const bytes = await readFile(new URL(`fixtures/development/${task.id}.json`, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), task.fixtureSha256, `${task.id} changed since validation`);
  const fixture = FixtureSchema.parse(JSON.parse(bytes.toString()));
  assert.equal(fixture.id, task.id);
  assert.deepEqual(fixtureDigests(fixture), {sourceDigest: task.sourceDigest, policyDigest: task.policyDigest});
  assert.equal(fixture.split, 'development');
  assert.equal(fixture.requirements.length, 5);
  assert.equal(fixture.visibleCases.length, 5);
  assert.equal(fixture.acceptanceCases.length, 17);
  validatePaths(fixture.files, fixture.editAllowlist);
  const checks = [...fixture.visibleCases, ...fixture.acceptanceCases];
  const requirements = new Set(fixture.requirements.map(requirement => requirement.id));
  assert.equal(new Set(checks.map(check => check.id)).size, checks.length);
  assert(checks.every(check => requirements.has(check.requirementId) && check.assertArgsUnchanged));
  assert.equal(new Set(checks.map(check => check.requirementId)).size, 5);
  assert.equal(task.baselineVisibleObservations.length, 5);
  assert(task.baselinePassed < checks.length);
  assert.equal(task.referencePassed, checks.length);
  assert(task.isolatedDefectControls.every((control: {rejectedByChecks: number}) => control.rejectedByChecks > 0));
  totalChecks += checks.length;
}
assert.equal(totalChecks, manifest.totalChecks);
console.log(JSON.stringify({status: 'pass', fixtures: manifest.taskCount, declaredChecks: totalChecks,
  note: 'Schema, integrity and preparation receipt consistency; this command does not execute repairs or Python checks.'}, null, 2));
