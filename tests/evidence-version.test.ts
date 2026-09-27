import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import { fixtureDigests } from '../packages/orchestrator/src/fixtures.ts';
import { digestBytes } from '../packages/contracts/src/digest.ts';

test('the historical demonstration retains its frozen 2.0 fingerprint while 2.1 binds metadata', async () => {
  // Exact public fixture bytes from 4e0116d, preserved independently of the current corpus.
  // SHA-256: ede00162da2d803f5acd98c0a6cc0edeaf71d18302ec2dc2b670811cef4cccfb.
  const bytes = await readFile(new URL('./fixtures/stable-unique-contract-2.0.json', import.meta.url));
  assert.equal(digestBytes(bytes), 'sha256:ede00162da2d803f5acd98c0a6cc0edeaf71d18302ec2dc2b670811cef4cccfb');
  const fixture = FixtureSchema.parse(JSON.parse(bytes.toString('utf8')));
  const legacy = fixtureDigests(fixture, '2.0');
  // Recorded in pre-migration 2.0 exports; do not regenerate from the current algorithm.
  assert.equal(legacy.sourceDigest, 'sha256:694bd79688a00b1293a74b2f003599ac280cfd6f774a3bff157e4f0a37b0aa24');
  assert.equal(legacy.policyDigest, 'sha256:d118da1e9bb2059ba3fa588e1497d760bd1c2ffdfb99a26376691c10db1062aa');
  const changed = { ...fixture, description: `${fixture.description} Additional review-only requirement.` };
  assert.equal(fixtureDigests(changed, '2.0').policyDigest, legacy.policyDigest, 'Legacy weakness stays explicit; its formula is never silently revised.');
  assert.notEqual(fixtureDigests(changed, '2.1').policyDigest, fixtureDigests(fixture, '2.1').policyDigest);
  assert.throws(() => fixtureDigests(fixture, '9.9' as '2.1'), /Unsupported fixture digest version/);
});
