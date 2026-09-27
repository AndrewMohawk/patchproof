import test from 'node:test';
import assert from 'node:assert/strict';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { prepareSmokeTokenizer, renderSmokeMessages, SmokeTokenizerArtifactSchema } from '../packages/orchestrator/src/smoke-tokenizer.ts';
import { toyArtifact } from './helpers/smoke-operator-data.ts';

test('pinned local tokenizer counts all declaratively framed roles, Unicode and conservative margin', () => {
  const artifact = toyArtifact(), counter = prepareSmokeTokenizer(artifact, artifact.modelId, digestJson(artifact));
  assert.equal(counter.countInputTokens([{ role: 'system', content: 'hello' }, { role: 'user', content: 'world 🧪' }]), 5);
  artifact.template.roles.system = { prefix: '<system>', suffix: '</system>' };
  artifact.template.roles.user = { prefix: '<user>', suffix: '</user>' };
  artifact.template.prefix = '<begin>'; artifact.template.assistantPrefix = '<assistant>';
  assert.equal(renderSmokeMessages(artifact, [{ role: 'system', content: 'hello' }, { role: 'user', content: 'world' }]), '<begin><system>hello</system><user>world</user><assistant>');
  assert.throws(() => renderSmokeMessages(artifact, [{ role: 'assistant', content: 'not supported' }]));
  assert.throws(() => renderSmokeMessages(artifact, [{ role: 'user', content: [{ type: 'text', text: 'not supported' }] }]));
});

test('tokenizer refuses stale or different model/artifact and mismatched account vectors', () => {
  const artifact = toyArtifact();
  assert.throws(() => prepareSmokeTokenizer(artifact, 'nvidia/different', digestJson(artifact)), /binding/);
  assert.throws(() => prepareSmokeTokenizer(artifact, artifact.modelId, digestJson({ changed: true })), /binding/);
  artifact.verification.validUntil = new Date(Date.now() - 1).toISOString();
  assert.throws(() => prepareSmokeTokenizer(artifact, artifact.modelId, digestJson(artifact)), /expired/);
  artifact.verification.validUntil = new Date(Date.now() + 300_000).toISOString(); artifact.verification.vectors[0]!.expectedCount = 1;
  assert.throws(() => prepareSmokeTokenizer(artifact, artifact.modelId, digestJson(artifact)), /vector_mismatch/);
  assert.throws(() => SmokeTokenizerArtifactSchema.parse({ ...artifact, executable: '/private/arbitrary-code' }));
});

test('malformed engine data fails with a fixed error and does not echo text or subprocess details', () => {
  const artifact = toyArtifact(); artifact.tokenizer = { model: { type: 'SECRET-INVALID-TYPE' } };
  assert.throws(() => prepareSmokeTokenizer(artifact, artifact.modelId, digestJson(artifact)), error => error instanceof Error && error.message === 'smoke_tokenizer_unavailable');
});
