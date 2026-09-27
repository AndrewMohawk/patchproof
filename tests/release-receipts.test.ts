import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { buildReleaseBindings, RELEASE_GATES, validateReleaseReceipts } from '../scripts/release-receipts.ts';
import type { ReleaseGate, ReleaseReceipt } from '../scripts/release-receipts.ts';

const now = new Date('2026-09-27T12:00:00.000Z');
const contents = Buffer.from('SYNTHETIC UNIT INPUT: no provider, participant, deployment or release observation.');
const bindings = buildReleaseBindings({ sources: { 'unit.ts': digestBytes('synthetic source') }, runtime: { synthetic: true }, protocol: { synthetic: true },
  runtimeMode: 'mock', liveProtocolFrozen: false, bundleDigests: [digestBytes('synthetic bundle')] });
function receipt(gate: ReleaseGate, patch: Partial<ReleaseReceipt> = {}): ReleaseReceipt {
  const policy = RELEASE_GATES[gate];
  const body = { schemaVersion: '1.0' as const, id: randomUUID(), gate, observedAt: '2026-09-27T11:00:00.000Z', expiresAt: '2026-09-28T12:00:00.000Z', bindings,
    scope: { origin: 'synthetic' as const, execution: policy.execution, human: policy.human ? 'synthetic' as const : 'none' as const,
      independence: policy.independent ? 'independent_machine' as const : 'not_applicable' as const },
    outcome: 'pass' as const, assertions: [...policy.assertions], evidence: [{ path: 'research/unit.log', digest: digestBytes(contents) }], scannedArtifacts: [], commands: [], ...patch };
  const { receiptDigest: _old, ...withoutDigest } = body as typeof body & { receiptDigest?: string };
  return { ...withoutDigest, receiptDigest: digestJson(withoutDigest) };
}
const assess = (receipts: unknown[], other = {}) => validateReleaseReceipts({ bindings, receipts,
  trustedReceiptDigests: [...new Set(receipts.map(r => (r as ReleaseReceipt).receiptDigest).filter(Boolean))], readArtifact: async () => contents, now, ...other });

test('complete synthetic receipt grid never fulfills actual release gates even with trusted digest ingestion', async () => {
  const result = await assess((Object.keys(RELEASE_GATES) as ReleaseGate[]).map(gate => receipt(gate)));
  assert.equal(result.status, 'blocked'); assert.ok(result.gates.every(gate => gate.status === 'synthetic_only'));
  assert.equal(result.authenticityVerified, false); assert.equal(result.publicationAuthorized, false);
});

test('missing, malformed, expired, future-dated and ambiguous receipts fail closed', async () => {
  const missing = await assess([]); assert.ok(missing.gates.every(gate => gate.status === 'missing'));
  assert.equal((await assess([{ nonsense: true }])).malformedCount, 1);
  for (const patch of [{ expiresAt: '2026-09-27T12:00:00.000Z' }, { observedAt: '2026-09-29T12:00:00.000Z' }]) {
    assert.equal((await assess([receipt('live_smoke', patch)])).gates.find(g => g.id === 'live_smoke')!.status, 'stale');
  }
  const duplicate = receipt('live_smoke');
  assert.equal((await assess([duplicate, duplicate])).gates.find(g => g.id === 'live_smoke')!.status, 'invalid');
  await assert.rejects(assess([duplicate], { trustedReceiptDigests: [duplicate.receiptDigest, duplicate.receiptDigest] }));
});

test('every source/runtime/protocol/bundle binding mutation invalidates a receipt', async () => {
  for (const field of ['sourceDigest', 'runtimeDigest', 'protocolDigest', 'bundleDigests'] as const) {
    const changed = { ...bindings, [field]: field === 'bundleDigests' ? [digestBytes('changed')] : digestBytes('changed') };
    const result = await assess([receipt('live_smoke', { bindings: changed })]);
    assert.equal(result.gates.find(g => g.id === 'live_smoke')!.status, 'mismatched', field);
  }
  assert.throws(() => buildReleaseBindings({ sources: { '../outside': digestBytes('no') }, runtime: {}, protocol: {}, runtimeMode: 'mock', liveProtocolFrozen: false, bundleDigests: [] }));
});

test('actual-labelled hypothetical claims cannot bypass local scope, absent humans or lack of trusted ingestion', async () => {
  // Deliberately forged labels exercise rejection, not records of actual external activity.
  for (const gate of ['live_smoke', 'pilot', 'reviewer_study', 'independent_replay', 'current_rules'] as const) {
    const forged = receipt(gate, { scope: { origin: 'actual', execution: 'local', human: 'none', independence: 'same_host' } });
    const result = await assess([forged]);
    assert.equal(result.gates.find(g => g.id === gate)!.status, 'scope_mismatch');
  }
  const forged = receipt('independent_replay', { scope: { origin: 'actual', execution: 'local', human: 'none', independence: 'independent_machine' } });
  assert.equal((await assess([forged], { trustedReceiptDigests: [] })).gates.find(g => g.id === 'independent_replay')!.status, 'untrusted');
});

test('recomputed receipt hashes do not excuse changed referenced artifacts or failed outcomes', async () => {
  // The scope is hypothetical; the altered bytes must still be rejected even after trusted ingestion.
  const forged = receipt('independent_replay', { scope: { origin: 'actual', execution: 'local', human: 'none', independence: 'independent_machine' } });
  assert.equal((await assess([forged], { readArtifact: async () => Buffer.from('tampered') })).gates.find(g => g.id === 'independent_replay')!.status, 'invalid');
  assert.equal((await assess([{ ...forged, outcome: 'fail' }])).gates.find(g => g.id === 'independent_replay')!.status, 'invalid');
  const failed = receipt('independent_replay', { scope: forged.scope, outcome: 'fail' });
  assert.equal((await assess([failed])).gates.find(g => g.id === 'independent_replay')!.status, 'failed');
});
