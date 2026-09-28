import assert from 'node:assert/strict';
import test from 'node:test';

// Deliberately invented parser inputs. Matching public record identifiers exercise
// the projector's selection rules; these objects are not verified run evidence.
const moduleUrl = new URL('../apps/web/walkthrough.js', import.meta.url).href;
const { projectStory, storyRecords } = await import(moduleUrl);

function projectionInput(kind: 'success' | 'failure' = 'success') {
  const record = storyRecords[kind];
  const definition = { id: record.checkId, args: [[[1, null], [2, 3]]], kwargs: { fill: 9 },
    expected: [[1, 2], [null, 3]], assertArgsUnchanged: true };
  const observation = { id: record.checkId, status: 'fail', actual: {
    outcome: [[1, 2], [9, 3]], argsAfter: [[[1, null], [2, 3]]], kwargsAfter: { fill: 9 } },
    expected: { outcome: [[1, 2], [null, 3]], argsAfter: [[[1, null], [2, 3]]], kwargsAfter: { fill: 9 } } };
  return { mode: 'live', bundleDigest: record.digest,
    fixture: { id: record.taskId, entrypoint: 'example.py', files: { 'example.py': 'original source' }, visibleCases: [definition] },
    run: { id: record.id, mode: 'live', selectedCandidateId: 2,
      baselineChecks: { visible: [structuredClone(observation)] },
      candidates: [{ id: 1, files: { 'example.py': 'earlier proposal' }, visibleChecks: [] },
        { id: 2, files: { 'example.py': 'selected proposal' }, visibleChecks: [structuredClone(observation)] }] } };
}

test('walkthrough projects actual returned values separately from retained argument observations', () => {
  const input = projectionInput('failure');
  const result = projectStory(input);
  assert.ok(result);
  assert.deepEqual(result.input, [[1, null], [2, 3]]);
  assert.deepEqual(result.kwargs, { fill: 9 });
  assert.deepEqual(result.expected, [[1, 2], [null, 3]]);
  assert.deepEqual(result.before, [[1, 2], [9, 3]]);
  assert.deepEqual(result.after, [[1, 2], [9, 3]]);
  assert.equal(result.candidateId, 2);
  assert.equal(result.afterSource, 'selected proposal');
  assert.notDeepEqual(result.after, input.run.candidates[1]!.visibleChecks[0]!.actual, 'the observation wrapper is not the function output');
  input.fixture.visibleCases[0]!.args[0]![0]![0] = 77;
  input.run.candidates[1]!.visibleChecks[0]!.actual.outcome[0]![0] = 88;
  assert.deepEqual(result.input, [[1, null], [2, 3]], 'display data is detached from mutable transport objects');
  assert.deepEqual(result.after, [[1, 2], [9, 3]]);
});

test('walkthrough never substitutes a mock, mismatched identity, unrelated case, or unobserved check', () => {
  const mutations = [
    (input: any) => { input.mode = 'mock'; },
    (input: any) => { input.run.mode = 'mock'; },
    (input: any) => { input.bundleDigest = 'sha256:' + '0'.repeat(64); },
    (input: any) => { input.run.id = 'unrelated'; },
    (input: any) => { input.fixture.id = 'other-task'; },
    (input: any) => { input.run.selectedCandidateId = 99; },
    (input: any) => { input.fixture.visibleCases[0].id = 'other-case'; },
    (input: any) => { input.fixture.visibleCases[0].assertArgsUnchanged = false; },
    (input: any) => { input.run.baselineChecks.visible[0].status = 'error'; },
    (input: any) => { input.run.candidates[1].visibleChecks[0].status = 'error'; },
    (input: any) => { input.run.candidates[1].visibleChecks[0].actual = null; },
    (input: any) => { input.run.candidates[1].visibleChecks[0].actual = { argsAfter: [] }; },
  ];
  for (const mutate of mutations) {
    const input = projectionInput(); mutate(input);
    assert.equal(projectStory(input), null, String(mutate));
  }
});

test('an observed null return is distinct from unavailable observation data', () => {
  const input: any = projectionInput('failure');
  input.run.candidates[1].visibleChecks[0].actual.outcome = null;
  assert.equal(projectStory(input).after, null, 'a wrapped null is an actual returned value');
  input.run.candidates[1].visibleChecks[0].actual = null;
  assert.equal(projectStory(input), null, 'a missing observation cannot be narrated as a returned null');
});
