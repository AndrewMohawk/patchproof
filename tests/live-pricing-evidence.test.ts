import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { LIVE_PRICING_EVIDENCE_PATH, verifyLivePricingEvidence } from '../apps/api/src/live-application.ts';

const evidence = JSON.parse(readFileSync(new URL('../research/verification/20261014-live-pricing-refresh/pricing-evidence.json', import.meta.url), 'utf8'));

test('current live pricing evidence matches the runtime constants and its digest', () => {
  assert.equal(verifyLivePricingEvidence(evidence, digestJson(evidence)).modelId, 'nvidia/nemotron-3-super-120b-a12b');
});

test('live pricing evidence rejects digest and rate changes', () => {
  assert.throws(() => verifyLivePricingEvidence(evidence, `sha256:${'0'.repeat(64)}`), /live_demo_pricing_changed/);
  const changed = structuredClone(evidence);
  changed.catalog.outputUsdPerMillionTokens = 0.91;
  assert.throws(() => verifyLivePricingEvidence(changed, digestJson(changed)), /live_demo_pricing_mismatch/);
});

test('deployment and startup bind the same pricing evidence artifact', () => {
  const deploy = readFileSync(new URL('../research/product-v3/verification/deploy-release.py', import.meta.url), 'utf8');
  assert.ok(deploy.includes(`readFileSync('${LIVE_PRICING_EVIDENCE_PATH}','utf8')`));
});

test('offline deployment recovery remains explicit and requires the previous unit to be down', () => {
  const deploy = readFileSync(new URL('../research/product-v3/verification/deploy-release.py', import.meta.url), 'utf8');
  assert.ok(deploy.includes("os.environ.get('PATCHPROOF_RECOVER_OFFLINE') != '1'"));
  assert.ok(deploy.includes("status.stdout.strip() in {'failed', 'inactive'}"));
});

test('the operational source lock binds model and license metadata', () => {
  const lock = buildOperationalLock(new URL('..', import.meta.url).pathname);
  assert.match(lock.sources['research/product-v3/model-discovery.json'] ?? '', /^sha256:[a-f0-9]{64}$/);
});
