import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { closedDispatchCase, closedDispatchMaximumCostMicros } from '../packages/orchestrator/src/closed-dispatch-recovery.ts';

const [pricingPath, repairBundlePath] = process.argv.slice(2);
if (!pricingPath || !repairBundlePath) {
  throw new Error('usage: node scripts/verify-private-integration-artifacts.ts <pricing-evidence.json> <repair-evidence.json>');
}

const [pricing, bundle] = await Promise.all([
  readFile(resolve(pricingPath), 'utf8').then(JSON.parse),
  readFile(resolve(repairBundlePath), 'utf8').then(JSON.parse),
]);

// Exact October 16 operator artifact identity. This check deliberately does not
// copy or publish the private receipt into the repository.
assert.equal(digestJson(pricing), 'sha256:9c51dfa981b666f7b2a6548e0545210c9b0813d7e4ced944595e758d946d21b2');
assert.equal(pricing.verifiedAt, '2026-10-16T21:01:00Z');
assert.equal(pricing.validUntil, '2026-10-17T21:00:00Z');
assert.deepEqual(pricing.catalog, {
  endpoint: 'https://api.tokenfactory.nebius.com/v1/models?verbose=true',
  authenticatedReadOnlyRequest: true,
  canonicalTargetRecordSha256: '9f22fd91ff49e74aad004b41b4d441f9019be559ce252fcefd0c203687b65394',
  contextTokens: 262144,
  quantization: 'fp4',
  inputUsdPerMillionTokens: 0.3,
  outputUsdPerMillionTokens: 0.9,
  requestFeeUsd: 0,
});
assert.equal(pricing.spendBoundary.perRunReservationUsd, 0.25);
assert.equal(pricing.spendBoundary.inferenceCallsPerRun, 3);

const c = closedDispatchCase();
const { bundleDigest, ...body } = bundle;
assert.equal(digestJson(body), c.bundleDigest);
assert.equal(bundleDigest, c.bundleDigest);
assert.equal(digestJson(bundle.runtimeLock.operationalLock), c.sourceDigest);
assert.equal(bundle.runtimeLock.operationalLock.sources['workers/repair/index.ts'], 'sha256:067a09ad36d63eac4f3ca0cc7a75425e69e66ba416ee5fa9b7800d73572b91c0');
assert.equal(bundle.run.id, c.episodeId);
assert.equal(bundle.run.terminalStatus, c.terminalStatus);
assert.equal(bundle.run.usage.inputTokens, c.observedInputTokens);
assert.equal(bundle.run.usage.outputTokens, c.observedOutputTokens);
assert.equal(c.returnedModelVerified, false);
assert.equal(c.rawResponseDigest, null);
assert.equal(c.thinkingRequested, true);
assert.equal(closedDispatchMaximumCostMicros(), 246732n);

console.log(JSON.stringify({ status: 'verified', pricingDigest: digestJson(pricing), repairBundleDigest: bundleDigest }));
