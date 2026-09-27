import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cloneJsonData, JSON_DATA_LIMITS } from '../packages/contracts/src/json-data.ts';
import { FunctionCaseSchema, FixtureSchema, parseFixtureForVersion, PRODUCT_CONTRACT_VERSION } from '../packages/contracts/src/product.ts';
import type { CheckRunner, ProductContractVersion } from '../packages/contracts/src/product.ts';
import { FunctionCaseSchema as HistoricalFunctionCaseSchema } from '../packages/contracts/src/legacy-product-v2.ts';
import { ProductEvidenceSchema, ProductRunSchema } from '../packages/contracts/src/product-validation.ts';
import { canonicalJson, digestJson } from '../packages/contracts/src/digest.ts';
import { buildEvidence, verifyEvidence, reproduceEvidence } from '../packages/orchestrator/src/evidence.ts';
import { fixtureDigests } from '../packages/orchestrator/src/fixtures.ts';
import { REPEATED_CHECK_PROTOCOL } from '../packages/orchestrator/src/repeated-checks.ts';
import { evaluateObservation, DockerCheckRunner } from '../workers/sandbox/index.ts';
import { createEvidenceArchive } from '../apps/api/src/evidence-archive.ts';
import { exportPrivateEvidence, privateEvidenceConfigDigest } from '../scripts/evidence-operator.ts';
import { prepareArchiveFixture, syntheticArchiveBundle } from './helpers/archive-fixture.ts';

// Invented JSON metadata only. Tests never execute source, containers, models, or providers.
const dictionary = () => JSON.parse('{"constructor":"ordinary name","__proto__":{"kept":true},"prototype":0,"toString":false,"hasOwnProperty":null,"":[],"nested":{"constructor":{"__proto__":"nested value"}}}') as Record<string, unknown>;
const caseInput = () => ({ id: 'invented-check', requirementId: 'R01', function: 'identity', args: [dictionary()], kwargs: dictionary(), expected: dictionary(), assertArgsUnchanged: true });
function keyedBundle(version: ProductContractVersion = '2.2') {
  const original = syntheticArchiveBundle('mock', version);
  const fixture = FixtureSchema.parse({ ...original.fixture, visibleCases: [caseInput()] });
  const runtimeLock = dictionary();
  const run = structuredClone(original.run);
  Object.assign(run, fixtureDigests(fixture, version), { runtimeLockDigest: digestJson(runtimeLock) });
  run.candidates[0]!.visibleChecks[0]!.actual = dictionary();
  run.candidates[0]!.visibleChecks[0]!.expected = dictionary();
  return buildEvidence(run, fixture, runtimeLock);
}

test('2.2 faithfully clones every own JSON key into detached ordinary objects', () => {
  assert.equal(PRODUCT_CONTRACT_VERSION, '2.2');
  const input = dictionary(), parsed = cloneJsonData(input) as Record<string, unknown>;
  assert.deepEqual(parsed, input); assert.notEqual(parsed, input);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(Object.hasOwn(parsed, 'constructor'), true);
  assert.equal(canonicalJson(parsed), canonicalJson(input));
  (input.__proto__ as Record<string, unknown>).kept = false;
  assert.deepEqual(parsed.__proto__, { kept: true });
  assert.equal(({} as Record<string, unknown>).kept, undefined);
  const shared = { value: 1 }, aliases = cloneJsonData([shared, shared]) as Array<Record<string, unknown>>;
  assert.deepEqual(aliases, [shared, shared]); assert.notEqual(aliases[0], aliases[1]);
});

test('function arguments, outer and nested kwargs, and expected values preserve special keys', () => {
  const input = caseInput(), parsed = FunctionCaseSchema.parse(input);
  assert.deepEqual(parsed, input); assert.notEqual(parsed.kwargs, input.kwargs);
  assert.equal(Object.getPrototypeOf(parsed.kwargs), Object.prototype);
  assert.equal(digestJson(parsed), digestJson(input));
  const defaults = FunctionCaseSchema.parse({ id: 'default', requirementId: 'R01', function: 'identity', args: [], expected: null });
  assert.deepEqual(defaults.kwargs, {}); assert.equal(defaults.assertArgsUnchanged, false);
  assert.equal(FunctionCaseSchema.safeParse({ ...input, expected: undefined }).success, false);
});

test('historical parser defect is reproduced on inert metadata while the current parser retains keys', () => {
  const original = { id: 'old', requirementId: 'R01', function: 'identity', args: [], expected: JSON.parse('{"__proto__":7}') };
  const old = HistoricalFunctionCaseSchema.parse(original);
  assert.equal(Object.hasOwn(old.expected as object, '__proto__'), false, 'Frozen legacy dependency silently omitted this own key.');
  const current = FunctionCaseSchema.parse(original);
  assert.equal(Object.hasOwn(current.expected as object, '__proto__'), true);
  assert.deepEqual(current.expected, original.expected);
  assert.equal(HistoricalFunctionCaseSchema.safeParse({ ...original, expected: { constructor: 7 } }).success, false);
});

test('non-JSON values and lossy object/array shapes are refused without invoking accessors or proxy traps', () => {
  let calls = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return 1; } });
  const arrayAccessor = Object.defineProperty([1], '0', { enumerable: true, get() { calls++; return 1; } });
  const proxy = new Proxy({}, { getPrototypeOf() { calls++; return Object.prototype; }, ownKeys() { calls++; return []; }, get() { calls++; return 1; } });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const sparse = new Array(2), extra = Object.assign([1], { extra: 2 });
  const symbolKey = { [Symbol('key')]: 1 }, hidden = Object.defineProperty({}, 'value', { value: 1 });
  const values: unknown[] = [undefined, () => 1, Symbol('value'), 1n, NaN, Infinity, -Infinity, new Date(0), Object.create(null),
    Object.create({ inherited: 1 }), accessor, arrayAccessor, proxy, cycle, sparse, extra, symbolKey, hidden];
  for (const value of values) {
    assert.throws(() => cloneJsonData(value));
    assert.equal(FunctionCaseSchema.safeParse({ ...caseInput(), expected: value }).success, false);
  }
  assert.equal(calls, 0);
  const envelope = Object.defineProperty(caseInput(), 'args', { enumerable: true, get() { calls++; return []; } });
  assert.equal(FunctionCaseSchema.safeParse(envelope).success, false); assert.equal(calls, 0);
});

test('JSON depth, node count and encoded bytes are explicitly bounded', () => {
  let depth: unknown = null;
  for (let i = 0; i < JSON_DATA_LIMITS.maximumDepth; i++) depth = [depth];
  assert.doesNotThrow(() => cloneJsonData(depth));
  assert.throws(() => cloneJsonData([depth]), /json_depth_limit/);
  assert.throws(() => cloneJsonData(Array(JSON_DATA_LIMITS.maximumNodes).fill(null)), /json_node_limit/);
  assert.throws(() => cloneJsonData('x'.repeat(JSON_DATA_LIMITS.maximumBytes)), /json_byte_limit/);
  assert.throws(() => cloneJsonData('\u0000'.repeat(Math.ceil(JSON_DATA_LIMITS.maximumBytes / 6))), /json_byte_limit/);
});

test('2.2 run, evidence, runtime lock and check observations retain keys and original property order', () => {
  const bundle = keyedBundle(), raw = JSON.stringify(bundle), parsed = verifyEvidence(JSON.parse(raw), bundle.bundleDigest);
  assert.equal(JSON.stringify(parsed), raw);
  assert.deepEqual(ProductRunSchema.parse(bundle.run), bundle.run);
  assert.deepEqual(ProductEvidenceSchema.parse(bundle), bundle);
  assert.equal(Object.hasOwn(parsed.runtimeLock as object, '__proto__'), true);
  assert.equal(Object.hasOwn(parsed.run.candidates[0]!.visibleChecks[0]!.actual as object, '__proto__'), true);
  assert.equal(Object.hasOwn(parsed.fixture.visibleCases[0]!.kwargs, '__proto__'), true);
  assert.notEqual(parsed.run, bundle.run);
  assert.throws(() => buildEvidence(bundle.run, bundle.fixture, { notJson: undefined }), /json_non_data_value/);
  const run = structuredClone(bundle.run); run.candidates[0]!.visibleChecks[0]!.actual = NaN;
  assert.throws(() => buildEvidence(run, bundle.fixture, {}), /json_nonfinite_number/);
});

test('valid 2.0 and 2.1 evidence keeps exact projection, bytes-derived digest and original formula', () => {
  for (const version of ['2.0', '2.1'] as const) {
    const bundle = syntheticArchiveBundle('mock', version), raw = JSON.stringify(bundle);
    assert.equal(JSON.stringify(verifyEvidence(JSON.parse(raw), bundle.bundleDigest)), raw);
    assert.equal(JSON.stringify(ProductRunSchema.parse(bundle.run)), JSON.stringify(bundle.run));
    assert.deepEqual(parseFixtureForVersion(bundle.fixture, version), bundle.fixture);
    const changed = { ...bundle.fixture, description: 'Different inert metadata.' };
    assert.equal(fixtureDigests(changed, version).policyDigest === fixtureDigests(bundle.fixture, version).policyDigest, version === '2.0');
  }
  const fixture = syntheticArchiveBundle('mock', '2.2').fixture;
  assert.deepEqual(fixtureDigests(fixture, '2.1'), fixtureDigests(fixture, '2.2'));
});

test('legacy lossy keys reject explicitly instead of being silently migrated or normalized', () => {
  for (const version of ['2.0', '2.1'] as const) {
    const bundle = keyedBundle(version);
    assert.throws(() => verifyEvidence(bundle), /Unsupported legacy JSON key/);
    assert.throws(() => parseFixtureForVersion(bundle.fixture, version), /unsupported_legacy_json_key/);
    for (const schema of [ProductRunSchema, ProductEvidenceSchema]) {
      const parsed = schema.safeParse(schema === ProductRunSchema ? bundle.run : bundle);
      assert.equal(parsed.success, false);
      if (!parsed.success) assert.ok(parsed.error.issues.some(issue => issue.message === 'unsupported_legacy_json_key'));
    }
  }
});

test('evidence versions and normalization-sensitive omissions cannot be relabeled under a different projection', () => {
  const bundle = syntheticArchiveBundle('mock', '2.2');
  for (const value of [{ ...bundle, schemaVersion: '2.1' }, { ...bundle, schemaVersion: '9.9' },
    { ...bundle, run: { ...bundle.run, schemaVersion: '2.1' } }]) assert.throws(() => verifyEvidence(value));
  const omitted = JSON.parse(JSON.stringify(bundle)); delete omitted.fixture.visibleCases[0].kwargs;
  assert.equal(ProductEvidenceSchema.safeParse(omitted).success, false);
  let reads = 0;
  const accessor = Object.defineProperty({ ...bundle }, 'run', { enumerable: true, get() { reads++; return bundle.run; } });
  assert.equal(ProductEvidenceSchema.safeParse(accessor).success, false); assert.equal(reads, 0);
});

test('host observation parser preserves returned keys, compares complete mappings, and refuses legacy loss', () => {
  const c = FunctionCaseSchema.parse(caseInput());
  const observation = { kind: 'return', value: dictionary(), argsAfter: c.args, kwargsAfter: c.kwargs };
  const result = evaluateObservation(c, JSON.stringify(observation), 1, '2.2');
  assert.equal(result.status, 'pass'); assert.deepEqual((result.actual as { outcome: unknown }).outcome, dictionary());
  const changed = structuredClone(observation); delete changed.value.__proto__;
  assert.equal(evaluateObservation(c, JSON.stringify(changed), 1, '2.2').status, 'fail');
  for (const version of ['2.0', '2.1'] as const) {
    const historical = evaluateObservation(c, JSON.stringify(observation), 1, version);
    assert.equal(historical.status, 'error'); assert.equal(historical.message, 'unsupported_legacy_json_key');
  }
  const plain = FunctionCaseSchema.parse({ id: 'plain', requirementId: 'R01', function: 'identity', args: [], expected: 1 });
  for (const version of ['2.0', '2.1', '2.2'] as const)
    assert.equal(evaluateObservation(plain, '{"kind":"return","value":1,"argsAfter":[],"kwargsAfter":{}}', 1, version).status, 'pass');
});

test('historical unsupported input is rejected before any local process invocation', async () => {
  let invoked = 0;
  const runner = new DockerCheckRunner({ process: async () => { invoked++; throw new Error('Must not invoke any process.'); } });
  const result = await runner.run({ files: { 'solution.py': '# Inert; never executed.\n' }, entrypoint: 'solution.py', cases: [FunctionCaseSchema.parse(caseInput())],
    timeoutSeconds: 1, contractVersion: '2.1' }, new AbortController().signal);
  assert.equal(invoked, 0); assert.equal(result.infrastructureError, 'unsupported_legacy_json_key');
});

test('replay passes the bound version through repeated checks to an inert metadata-only runner', async () => {
  for (const version of ['2.0', '2.1', '2.2'] as const) {
    const base = syntheticArchiveBundle('mock', version), lock = { checkProtocol: REPEATED_CHECK_PROTOCOL };
    const run = { ...base.run, runtimeLockDigest: digestJson(lock) }, bundle = buildEvidence(run, base.fixture, lock);
    const seen: unknown[] = [];
    const runner: CheckRunner = { async run(input) { seen.push(input.contractVersion); return { checks: structuredClone(run.candidates[0]!.visibleChecks),
      operationIds: [], isolation: 'unavailable', cpuSeconds: null, measuredCostUsd: null, infrastructureError: null }; } };
    const result = await reproduceEvidence(bundle, runner, new AbortController().signal);
    assert.equal(result.executionPerformed, false); assert.deepEqual(seen, [version, version]);
  }
});

test('private export and read-only archive admit the same 2.2 projection and preserve exact selected bytes', async t => {
  const bundle = keyedBundle(), setup = await prepareArchiveFixture([bundle]); t.after(setup.close);
  const state = join(setup.directory, 'state'); mkdirSync(join(state, 'evidence'), { recursive: true, mode: 0o700 });
  const database = join(state, 'runs.sqlite'), db = new DatabaseSync(database);
  db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, document TEXT NOT NULL, evidence_digest TEXT)');
  db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run(bundle.run.id, 'invented-request', digestJson('invented'), JSON.stringify(bundle.run), bundle.bundleDigest); db.close(); chmodSync(database, 0o600);
  writeFileSync(join(state, 'evidence', bundle.bundleDigest.slice(7) + '.json'), setup.bytes[0]!, { mode: 0o600 });
  const config = { schemaVersion: '1.0', kind: 'product-evidence-operator', stateDirectory: state, runId: bundle.run.id, bundleDigest: bundle.bundleDigest,
    fixture: { taskId: bundle.fixture.id, fixtureDigest: digestJson(bundle.fixture), ...fixtureDigests(bundle.fixture, '2.2') }, outputFile: join(setup.directory, 'export.json') };
  const configPath = join(setup.directory, 'operator.json'); writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  await exportPrivateEvidence({ projectRoot: setup.projectRoot, configPath, expectedConfigDigest: privateEvidenceConfigDigest(config) });
  assert.deepEqual(readFileSync(config.outputFile), setup.bytes[0]);
  const app = await createEvidenceArchive(setup); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); await new Promise<void>(done => app.server.close(() => done())); });
  const address = app.server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  assert.deepEqual(await (await fetch(`${base}/runs/${bundle.run.id}`)).json(), bundle.run);
  assert.deepEqual(Buffer.from(await (await fetch(`${base}/runs/${bundle.run.id}/evidence`)).arrayBuffer()), setup.bytes[0]);
  assert.equal((await fetch(`${base}/runs`, { method: 'POST' })).status, 405);
});

test('observation exception and argument envelopes retain mapping keys and malformed JSON stays an error', () => {
  const { expected: _expected, ...input } = caseInput();
  const c = FunctionCaseSchema.parse({ ...input, expectedException: 'ValueError' });
  const observed = { kind: 'exception', exception: 'ValueError', argsAfter: c.args, kwargsAfter: c.kwargs };
  assert.equal(evaluateObservation(c, JSON.stringify(observed), 0).status, 'pass');
  const changed = structuredClone(observed); delete changed.kwargsAfter.__proto__;
  assert.equal(evaluateObservation(c, JSON.stringify(changed), 0).status, 'fail');
  assert.equal(evaluateObservation(c, '{broken', 0).status, 'error');
});
