import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { auditRelease } from '../scripts/release-audit.ts';
import { readReleaseInput } from '../scripts/release-input.ts';
import { resolveReleaseBindings, classifyReleaseBundle } from '../scripts/release-protocol.ts';
import { buildReleaseBindings, RELEASE_GATES, validateReleaseReceipts } from '../scripts/release-receipts.ts';
import { LOCAL_MOCK_CHECK_TIMING_POLICY } from '../packages/orchestrator/src/local-check-timing.ts';
import { syntheticReleaseData, syntheticSmokeLock } from './helpers/release-live-data.ts';

test('recorded local timing metadata preserves matching mock release identity without modifying exports', () => {
  const runtime = { mode: 'mock', fixture: 'invented release metadata' };
  const operationalLock = { sources: { 'unit.ts': digestBytes('inert source') }, behavior: { unitOnly: true } };
  const bindings = buildReleaseBindings({ sources: operationalLock.sources, runtime, protocol: operationalLock.behavior,
    bundleDigests: [], runtimeMode: 'mock', liveProtocolFrozen: false });
  for (const metadata of [{}, { localCheckTimingPolicy: LOCAL_MOCK_CHECK_TIMING_POLICY }]) {
    const lock = { ...runtime, ...metadata, operationalLock }, original = JSON.stringify(lock);
    assert.equal(classifyReleaseBundle(lock, 'mock', bindings, null), 'current');
    assert.equal(JSON.stringify(lock), original);
    assert.equal(classifyReleaseBundle(lock, 'live', bindings, null), 'historical_or_unbound');
    for (const field of ['sourceDigest', 'runtimeDigest', 'protocolDigest'] as const) {
      assert.equal(classifyReleaseBundle(lock, 'mock', { ...bindings, [field]: digestBytes('different') }, null), 'historical_or_unbound');
    }
  }
});

test('unknown or malformed local timing cannot be discarded to manufacture a current release binding', () => {
  const runtime = { mode: 'mock' };
  const operationalLock = { sources: { 'unit.ts': digestBytes('inert source') }, behavior: { unitOnly: true } };
  const bindings = buildReleaseBindings({ sources: operationalLock.sources, runtime, protocol: operationalLock.behavior,
    bundleDigests: [], runtimeMode: 'mock', liveProtocolFrozen: false });
  for (const policy of [null, {}, '60', { ...LOCAL_MOCK_CHECK_TIMING_POLICY, id: 'unknown' },
    { ...LOCAL_MOCK_CHECK_TIMING_POLICY, maximumBatchWallSeconds: 61 }, { ...LOCAL_MOCK_CHECK_TIMING_POLICY, extra: true }]) {
    assert.equal(classifyReleaseBundle({ ...runtime, operationalLock, localCheckTimingPolicy: policy }, 'mock', bindings, null), 'historical_or_unbound');
  }
  assert.equal(classifyReleaseBundle({ ...runtime, operationalLock, anotherUnrecognizedPolicy: {} }, 'mock', bindings, null), 'historical_or_unbound');
});

test('default release bindings stay local and supplied calibrated proof explicitly selects a distinct frozen protocol', async t => {
  const s = await syntheticReleaseData(); t.after(() => rm(s.root, { recursive: true, force: true }));
  const local = resolveReleaseBindings({ operational: s.operational, runtime: s.config.runtime, bundleDigests: [] });
  assert.equal(local.bindings.liveProtocolFrozen, false); assert.equal(local.bindings.protocolDigest, digestJson(s.operational.behavior));
  const selected = resolveReleaseBindings({ operational: s.operational, runtime: s.config.runtime, bundleDigests: [], liveProtocol: s.selection, now: s.now });
  assert.equal(selected.bindings.liveProtocolFrozen, true); assert.equal(selected.bindings.protocolDigest, digestJson(s.document));
  assert.notEqual(selected.bindings.protocolDigest, local.bindings.protocolDigest); assert.equal(s.operational.liveProtocolFrozen, false);
});

test('missing trust, stale proofs and changed source/runtime/model/calibration fail closed', async t => {
  const s = await syntheticReleaseData(); t.after(() => rm(s.root, { recursive: true, force: true }));
  const run = (selection = s.selection, operational = s.operational) => resolveReleaseBindings({ operational, runtime: s.config.runtime, bundleDigests: [], liveProtocol: selection, now: s.now });
  assert.throws(() => run({ ...s.selection, acceptedProofDigest: digestBytes('unaccepted') }), /untrusted/);
  for (const [change, error] of [
    [(value: typeof s.document) => { value.acceptance.validUntil = s.now.toISOString(); }, /stale/],
    [(value: typeof s.document) => { value.acceptance.sourceDigest = digestBytes('stale source'); }, /source_changed/],
    [(value: typeof s.document) => { value.settings.maxModelCallSeconds++; }, /policy_changed/],
    [(value: typeof s.document) => { value.runtime.local.python = 'changed'; }, /runtime_changed/],
    [(value: typeof s.document) => { value.modelLock.outputUsdPerMillionTokens++; }, /model_changed/],
  ] as const) {
    const document = structuredClone(s.document); change(document);
    // Even a newly accepted digest cannot excuse disagreement with current bindings or the frozen policy.
    assert.throws(() => run({ ...s.selection, document, acceptedProofDigest: digestJson(document.acceptance) }), error);
  }
  await writeFile(join(s.root, 'scripts/unit.ts'), 'source changed');
  assert.throws(() => run(s.selection, buildOperationalLock(s.root)), /source_changed/);
});

test('CLI input and audit share live selection; receipts cannot select it and synthetic scope still blocks actual gates', async t => {
  const s = await syntheticReleaseData(); t.after(() => rm(s.root, { recursive: true, force: true }));
  const bundleDigest = digestBytes('synthetic bundle'), contents = Buffer.from('SYNTHETIC plumbing only; no external observations.');
  const request = { receiptPaths: [], trustedReceiptDigests: [], bundles: [{ path: `artifacts/${randomUUID()}.json`, bundleDigest }],
    liveProtocol: { ...s.selection.artifact, acceptedProofDigest: s.selection.acceptedProofDigest } };
  await s.json('research/input.json', request);
  const input = await readReleaseInput(s.root, 'research/input.json', s.config, s.now);
  const audit = await auditRelease(pathToFileURL(s.root + '/'), s.config, { ...input, now: s.now });
  assert.equal(audit.checks.find(check => check.id === 'release_binding')?.status, 'pass');
  assert.equal(audit.receiptAssessment.bindings.liveProtocolFrozen, true); assert.equal(audit.status, 'blocked');
  const body = { schemaVersion: '1.0', id: randomUUID(), gate: 'pilot', observedAt: s.document.acceptance.verifiedAt, expiresAt: s.document.acceptance.validUntil,
    bindings: input.bindings, scope: { origin: 'synthetic', execution: 'live', human: 'none', independence: 'not_applicable' }, outcome: 'pass',
    assertions: [...RELEASE_GATES.pilot.assertions], evidence: [{ path: 'research/unit.log', digest: digestBytes(contents) }], scannedArtifacts: [], commands: [] };
  const check = async (value: typeof body) => {
    const receipt = { ...value, receiptDigest: digestJson(value) };
    return validateReleaseReceipts({ bindings: input.bindings, receipts: [receipt], trustedReceiptDigests: [receipt.receiptDigest], readArtifact: async () => contents, now: s.now });
  };
  assert.equal((await check(body)).gates.find(gate => gate.id === 'pilot')?.status, 'synthetic_only');
  assert.equal((await check({ ...body, scope: { ...body.scope, origin: 'actual', execution: 'local' } })).gates.find(gate => gate.id === 'pilot')?.status, 'scope_mismatch');
  const noProof = await auditRelease(pathToFileURL(s.root + '/'), s.config, { bindings: input.bindings, receipts: [], trustedReceiptDigests: [], now: s.now });
  assert.equal(noProof.checks.find(check => check.id === 'release_binding')?.status, 'blocked'); assert.equal(noProof.receiptAssessment.bindings.liveProtocolFrozen, false);
  await s.json('research/input.json', { ...request, liveProtocol: { ...request.liveProtocol, digest: digestBytes('wrong') } });
  await assert.rejects(readReleaseInput(s.root, 'research/input.json', s.config, s.now), /artifact_changed/);
});

test('matching smoke retains its own presentation policy while mock, historical and mismatched pins never become current experiment execution', async t => {
  const s = await syntheticReleaseData(); t.after(() => rm(s.root, { recursive: true, force: true }));
  const { bindings, liveProtocol } = resolveReleaseBindings({ operational: s.operational, runtime: s.config.runtime, bundleDigests: [], liveProtocol: s.selection, now: s.now });
  const smoke = syntheticSmokeLock(s.document);
  assert.equal(classifyReleaseBundle(smoke, 'live', bindings, liveProtocol), 'compatible_presentation');
  assert.equal(classifyReleaseBundle(smoke, 'mock', bindings, liveProtocol), 'historical_or_unbound');
  for (const field of ['sourceDigest', 'modelProofDigest', 'tokenizerDigest', 'sandboxVerificationDigest', 'cpuProofDigest', 'imageDigest'] as const) {
    assert.equal(classifyReleaseBundle({ ...smoke, [field]: digestBytes('changed') }, 'live', bindings, liveProtocol), 'historical_or_unbound', field);
  }
  assert.equal(classifyReleaseBundle({ ...smoke, calibratedExperiment: true }, 'live', bindings, liveProtocol), 'historical_or_unbound');
});
