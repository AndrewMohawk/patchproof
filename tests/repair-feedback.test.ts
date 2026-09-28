import assert from 'node:assert/strict';
import test from 'node:test';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import type { CheckResult, Fixture, RepairInput } from '../packages/contracts/src/product.ts';
import { LOCAL_REPAIR_POLICY, REPAIR_FEEDBACK_FORMAT, repairInput, runRevisionLoop } from '../packages/orchestrator/src/episode-engine.ts';
import type { RevisionContext } from '../packages/orchestrator/src/episode-engine.ts';

const fixture = (): Fixture => FixtureSchema.parse({ id: 'feedback-synthetic', repoId: 'synthetic', split: 'development',
  title: 'Synthetic feedback projection', description: 'Invented checks for the repair feedback boundary.',
  requirements: [{ id: 'R01', text: 'Public behavior.' }, { id: 'R02', text: 'Protected behavior.' }],
  files: { 'solution.py': 'def f(value): return value\n' }, editAllowlist: ['solution.py'], entrypoint: 'solution.py',
  visibleCases: [{ id: 'public-nested', requirementId: 'R01', function: 'f', args: [[[1]]], expected: [[1]] }],
  acceptanceCases: [{ id: 'PROTECTED-CHECK-ID', requirementId: 'R02', function: 'f', args: ['PROTECTED-ARG'], expected: 'PROTECTED-EXPECTED' }],
  license: 'CC0-1.0', provenance: 'Entirely synthetic unit fixture; no sealed corpus access.' });
const limits: RepairInput['remaining'] = { inferenceCallLimit: 3, inputTokenLimit: 10000, outputTokenLimit: 6000,
  wallTimeLimitSeconds: 300, sandboxCpuSecondsLimit: 900, maxApprovedSpendUsd: 0 };
const visibleCheck = (): CheckResult => ({ id: 'public-nested', requirementId: 'R01', status: 'fail',
  message: 'DO-NOT-COPY-CHECKER-MESSAGE', actual: { exception: 'TypeError' }, expected: 'DO-NOT-COPY-CHECKER-EXPECTED',
  durationMs: 1, log: 'DO-NOT-COPY-RAW-LOG' });
const protectedCheck = (): CheckResult => ({ ...visibleCheck(), id: 'PROTECTED-CHECK-ID', requirementId: 'R02',
  actual: 'PROTECTED-ACTUAL', expected: 'PROTECTED-EXPECTED', message: 'PROTECTED-MESSAGE', log: 'PROTECTED-LOG' });
const context = (feedback: CheckResult[]): RevisionContext => ({ attempt: 1, branchId: 0, parentId: 1,
  files: fixture().files, feedback, feedbackOrigin: 'on candidate 1', sourceOrigin: 'supplied current source' });
const message = (check: CheckResult, f = fixture()) => repairInput(f, context([check]), limits).feedback[0]!.message;

test('visible feedback includes case identity and observed exception with expected value from the public definition', () => {
  const f = fixture(), c = visibleCheck(), result = repairInput(f, context([c]), limits);
  assert.match(result.feedback[0]!.message, /^visible-outcome-feedback-v1:/);
  assert.match(result.feedback[0]!.message, /Visible case "public-nested"/);
  assert.match(result.feedback[0]!.message, /actual=\{"exception":"TypeError"\}/);
  assert.match(result.feedback[0]!.message, /expected=\[\[1\]\]/);
  assert.doesNotMatch(JSON.stringify(result), /DO-NOT-COPY|PROTECTED-/);
  assert.deepEqual(result.remaining, limits);
  assert.equal(c.expected, 'DO-NOT-COPY-CHECKER-EXPECTED');
  assert.deepEqual(f.visibleCases[0]!.expected, [[1]], 'Projection never mutates the public definition.');
});

test('mutation and expected-exception diagnostics retain the visible outcome shape', () => {
  const f = fixture();
  f.visibleCases[0]!.assertArgsUnchanged = true;
  const c = visibleCheck();
  c.actual = { outcome: [[1]], argsAfter: [[]], kwargsAfter: {} };
  assert.match(message(c, f), /actual=\{"outcome":\[\[1\]\],"argsAfter":\[\[\]\],"kwargsAfter":\{\}\}/);
  assert.match(message(c, f), /expected=\{"outcome":\[\[1\]\],"argsAfter":\[\[\[1\]\]\],"kwargsAfter":\{\}\}/);
  delete f.visibleCases[0]!.expected;
  f.visibleCases[0]!.expectedException = 'ValueError';
  assert.match(message(c, f), /expected=\{"outcome":\{"exception":"ValueError"\}/);
});

test('nonvisible observations retain only requirement/status and generated provenance', () => {
  const result = repairInput(fixture(), context([protectedCheck()]), limits);
  assert.equal(result.feedback[0]!.requirementId, 'R02');
  assert.equal(result.feedback[0]!.status, 'fail');
  assert.match(result.feedback[0]!.message, /Declared requirement check: fail/);
  assert.doesNotMatch(JSON.stringify(result), /PROTECTED-|DO-NOT-COPY|actual=|expected=/);
});

test('mismatched and ambiguous visible identities cannot unlock structured observations', () => {
  const mismatch = { ...visibleCheck(), requirementId: 'R02', actual: 'PROTECTED-MISMATCH' };
  assert.doesNotMatch(message(mismatch), /Visible case|PROTECTED-MISMATCH/);
  const f = fixture(); f.visibleCases.push(structuredClone(f.visibleCases[0]!));
  assert.doesNotMatch(message({ ...visibleCheck(), actual: 'PROTECTED-AMBIGUOUS' }, f), /Visible case|PROTECTED-AMBIGUOUS/);
});

test('diagnostic serialization rejects getters, proxies, toJSON, cycles and non-JSON values without invoking behavior', () => {
  let invoked = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked++; return 'UNSAFE'; } });
  const proxy = new Proxy({}, { ownKeys() { invoked++; return []; }, get() { invoked++; return 'UNSAFE'; } });
  const toJSON = { toJSON() { invoked++; return 'UNSAFE'; } };
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const actual of [accessor, proxy, toJSON, cycle, 1n, NaN, undefined, new Date(0)]) {
    const result = message({ ...visibleCheck(), actual });
    assert.match(result, /actual=\{"unavailable":"invalid JSON data"\}/);
    assert.doesNotMatch(result, /UNSAFE/);
  }
  assert.equal(invoked, 0);
});

test('ordinary JSON keys survive safely and every diagnostic and message has an explicit UTF-8 bound', () => {
  const keyed = JSON.parse('{"__proto__":{"polluted":true},"constructor":"ordinary","toJSON":"ordinary"}');
  const keyResult = message({ ...visibleCheck(), actual: keyed });
  assert.match(keyResult, /"__proto__":\{"polluted":true\}/);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const f = fixture(); f.visibleCases[0]!.expected = '界'.repeat(3000);
  const c = { ...visibleCheck(), actual: '🙂'.repeat(3000) };
  const ctx = context([c]); ctx.feedbackOrigin = '🙂'.repeat(3000);
  const result = repairInput(f, ctx, limits).feedback[0]!.message;
  assert.match(result, /actual=\{"omitted":"diagnostic byte limit"\}/);
  assert.match(result, /expected=\{"omitted":"diagnostic byte limit"\}/);
  assert.match(result, /\[truncated\]/);
  assert.ok(Buffer.byteLength(result, 'utf8') <= REPAIR_FEEDBACK_FORMAT.maximumMessageBytes);
  assert.ok(!result.includes('\uFFFD'), 'UTF-8 truncation must preserve whole code points.');
  const bounded = message({ ...visibleCheck(), actual: 'x'.repeat(REPAIR_FEEDBACK_FORMAT.maximumDiagnosticBytes - 2) });
  assert.match(bounded, /actual="x+"/);
  assert.ok(Buffer.byteLength(bounded, 'utf8') <= REPAIR_FEEDBACK_FORMAT.maximumMessageBytes);
  const longId = '界'.repeat(400), large = 'x'.repeat(REPAIR_FEEDBACK_FORMAT.maximumDiagnosticBytes - 2);
  const combinedFixture = fixture();
  combinedFixture.visibleCases[0]!.id = longId;
  combinedFixture.visibleCases[0]!.expected = large;
  const combined = message({ ...visibleCheck(), id: longId, actual: large }, combinedFixture);
  assert.match(combined, /\[truncated\]$/);
  assert.ok(Buffer.byteLength(combined, 'utf8') <= REPAIR_FEEDBACK_FORMAT.maximumMessageBytes);
  assert.ok(!combined.includes('\uFFFD'));
});

test('all three revision policies use identical visible diagnostics with unchanged resource limits', async () => {
  const projections: Record<string, string[]> = {};
  for (const variant of ['baseline', 'checks_only', 'patchproof'] as const) {
    const f = fixture(), inputs: RepairInput[] = [];
    const checks = [visibleCheck(), protectedCheck()];
    const result = await runRevisionLoop({ fixture: f, variant, policy: LOCAL_REPAIR_POLICY, maximumRevisions: 3,
      signal: new AbortController().signal, initialFeedback: variant === 'baseline' ? [checks[0]!] : checks, revisions: [],
      propose: async ctx => {
        inputs.push(repairInput(f, ctx, limits));
        return { files: { 'solution.py': 'def f(value): return value\n' }, summary: 'Synthetic proposal.',
          usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 }, modelId: null, providerRequestId: null };
      },
      check: async () => ({ visible: [checks[0]!], acceptance: [checks[1]!], result: { checks,
        isolation: 'unavailable', operationIds: [], cpuSeconds: 0, measuredCostUsd: 0, infrastructureError: null } }),
      onProposed() {}, onChecked() {}, onSelection() {},
    });
    assert.equal(result.revisionCount, 3);
    assert.equal(inputs.length, 3);
    projections[variant] = inputs.map(input => {
      assert.deepEqual(input.remaining, limits);
      assert.doesNotMatch(JSON.stringify(input), /PROTECTED-|DO-NOT-COPY/);
      const visible = input.feedback.find(row => row.requirementId === 'R01')!;
      assert.ok(visible.message.startsWith(REPAIR_FEEDBACK_FORMAT.id));
      return visible.message.slice(visible.message.indexOf('Visible case'));
    });
    if (variant === 'baseline') assert.ok(inputs.every(input => input.feedback.length === 1));
    else assert.ok(inputs.every(input => input.feedback.length === 2));
  }
  assert.deepEqual(projections.baseline, projections.checks_only);
  assert.deepEqual(projections.baseline, projections.patchproof);
});
