import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { CheckRunner } from '../packages/contracts/src/product.ts';
import { externalWorkspace } from '../workers/evaluator/fixture-validation.ts';
import { adjudicateSelectedCandidate } from '../workers/evaluator/adjudicate.ts';
import { hashJson } from '../workers/evaluator/protocol.ts';

const fixture = FixtureSchema.parse({ id: 'boundary-unit', repoId: 'boundary-unit-repo', split: 'final', title: 'Synthetic boundary unit fixture',
  description: 'Test control-plane separation only; not an evaluation task.', requirements: [{ id: 'R01', text: 'Return the fixture value.' }],
  files: { 'solution.py': 'def example():\n    return 0\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [], acceptanceCases: [], license: 'CC0-1.0', provenance: 'Independent unit test only, unrelated to sealed corpus.' });
const oracle = { taskId: fixture.id, sealedCases: [{ id: 'unit-case', requirementId: 'R01', function: 'example', args: [], kwargs: {}, expected: 42, assertArgsUnchanged: false }] };
const bytes = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const digest = (value: unknown) => 'sha256:' + createHash('sha256').update(bytes(value)).digest('hex');

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'patchproof-evaluator-unit-'));
  await Promise.all(['fixtures', 'gold'].map(path => mkdir(join(root,path))));
  await writeFile(join(root,'fixtures',fixture.id+'.json'),bytes(fixture));
  await writeFile(join(root,'gold',fixture.id+'.json'),bytes(oracle));
  await writeFile(join(root,'split-manifest.json'),bytes({ tasks: [{ id: fixture.id, fixtureDigest: digest(fixture), oracleDigest: digest(oracle) }] }));
  return root;
}

test('external evaluator paths reject project descendants and symlink aliases', async () => {
  await assert.rejects(externalWorkspace(resolve('.'), resolve('.')), /outside/);
  await assert.rejects(externalWorkspace('relative', resolve('.')), /absolute/);
  const directory = await mkdtemp(join(tmpdir(), 'patchproof-boundary-link-'));
  try {
    await symlink(resolve('.'), join(directory,'alias'));
    await assert.rejects(externalWorkspace(join(directory,'alias'),resolve('.')), /outside/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('adjudication retains expected values in trusted runner and exports only aggregate verdict', async () => {
  const directory = await workspace();
  let called = 0;
  const runner: CheckRunner = { async run(input) {
    called++;
    assert.deepEqual(Object.keys(input).sort(), ['cases','entrypoint','files','timeoutSeconds']);
    assert(!('goldFiles' in input));
    return { checks: input.cases.map(c => ({ id:c.id,requirementId:c.requirementId,status:'pass',message:'Synthetic unit observation',actual:42,expected:42,durationMs:1,log:'private unit log' })),
      isolation:'local_container',operationIds:['unit:only'],cpuSeconds:null,measuredCostUsd:0,infrastructureError:null };
  }};
  const files = { 'solution.py':'def example():\n    return 42\n' };
  const options = { projectRoot:resolve('.'),workspace:directory,taskId:fixture.id,episodeId:'unit:episode:0',
    expectedFixtureDigest:digest(fixture),expectedOracleDigest:digest(oracle),selectedCandidateDigest:hashJson(files),
    selectionFinalized:true,files,checks:runner,signal:new AbortController().signal };
  try {
    await assert.rejects(adjudicateSelectedCandidate({...options,selectionFinalized:false}), /finalized/);
    assert.equal(called,0);
    const verdict = await adjudicateSelectedCandidate(options);
    assert.equal(verdict.outcome,'correct');
    assert.equal('checks' in verdict,false); assert.equal('actual' in verdict,false); assert.equal('expected' in verdict,false);
    assert.equal(called,1);
    const detailed = JSON.parse(await readFile(join(directory,'artifacts/episodes/unit_episode_0.json'),'utf8'));
    assert.equal(detailed.result.checks[0].expected,42);
    await assert.rejects(adjudicateSelectedCandidate(options), /EEXIST/);
    assert.equal(called,1,'A repeated selected episode must not execute the oracle again.');
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('oracle and selected-candidate drift fail before execution', async () => {
  const directory = await workspace();
  let calls = 0;
  const runner: CheckRunner = { async run() { calls++; throw new Error('must not execute'); } };
  const files = fixture.files;
  const options = { projectRoot:resolve('.'),workspace:directory,taskId:fixture.id,episodeId:'unit:drift:0',
    expectedFixtureDigest:digest(fixture),expectedOracleDigest:digest(oracle),selectedCandidateDigest:hashJson(files),
    selectionFinalized:true,files,checks:runner,signal:new AbortController().signal };
  try {
    await assert.rejects(adjudicateSelectedCandidate({...options,files:{'solution.py':'changed'}}), /candidate digest/);
    await writeFile(join(directory,'gold',fixture.id+'.json'),bytes({...oracle,sealedCases:[]}));
    await assert.rejects(adjudicateSelectedCandidate(options), /oracle digest/);
    assert.equal(calls,0);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
