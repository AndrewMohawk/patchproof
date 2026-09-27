import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { digestJson } from '../../contracts/src/digest.ts';
import type { ModelMessages } from '../../../workers/repair/index.ts';

const message = z.strictObject({ role: z.enum(['system', 'user']), content: z.string().max(1_048_576) });
const frame = z.strictObject({ prefix: z.string().max(16_384), suffix: z.string().max(16_384) });
export const SmokeTokenizerArtifactSchema = z.strictObject({ schemaVersion: z.literal('1.0'),
  engine: z.literal('@huggingface/tokenizers@0.2.0'), modelId: z.string().regex(/^nvidia\/[A-Za-z0-9._/-]+$/),
  tokenizer: z.record(z.string(), z.json()), tokenizerConfig: z.record(z.string(), z.json()),
  template: z.strictObject({ prefix: z.string().max(16_384), roles: z.strictObject({ system: frame, user: frame }),
    assistantPrefix: z.string().max(16_384), addSpecialTokens: z.boolean(), conservativeMarginTokens: z.number().int().min(0).max(100_000) }),
  verification: z.strictObject({ verifiedAt: z.iso.datetime(), validUntil: z.iso.datetime(),
    sourceRefs: z.array(z.string().min(1).max(300)).min(1).max(20), licenseRefs: z.array(z.string().min(1).max(300)).min(1).max(20),
    exactAccountTemplateVerified: z.literal(true), engineCompatibilityVerified: z.literal(true), conservativeCountVerified: z.literal(true),
    vectors: z.array(z.strictObject({ messages: z.array(message).min(1).max(10), expectedCount: z.number().int().positive() })).min(2).max(20) }),
});
export type SmokeTokenizerArtifact = z.infer<typeof SmokeTokenizerArtifactSchema>;

export function renderSmokeMessages(artifact: SmokeTokenizerArtifact, value: unknown) {
  const messages = z.array(message).min(1).max(100).parse(value);
  return artifact.template.prefix + messages.map(item => artifact.template.roles[item.role].prefix + item.content + artifact.template.roles[item.role].suffix).join('') + artifact.template.assistantPrefix;
}

/** Trusted fixed subprocess tokenizes text only. No candidate execution, downloads or ambient environment. */
export function prepareSmokeTokenizer(value: unknown, modelId: string, expectedDigest: string) {
  const artifact = SmokeTokenizerArtifactSchema.parse(value);
  if (artifact.modelId !== modelId || digestJson(artifact) !== expectedDigest) throw new Error('smoke_tokenizer_binding');
  const verifyCurrent = () => {
    if (Date.parse(artifact.verification.verifiedAt) > Date.now() || Date.parse(artifact.verification.validUntil) <= Date.now()) throw new Error('smoke_tokenizer_expired');
  };
  const countMany = (frames: ModelMessages[]) => {
    verifyCurrent(); frames.forEach(messages => renderSmokeMessages(artifact, messages));
    try {
      const result = execFileSync(process.execPath, ['--max-old-space-size=256', '--no-addons', fileURLToPath(new URL('./smoke-tokenizer-worker.ts', import.meta.url))],
        { input: JSON.stringify({ artifact, frames }), encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65_536,
          env: { LANG: 'C.UTF-8' }, cwd: '/', stdio: ['pipe', 'pipe', 'pipe'] });
      return z.array(z.number().int().positive()).length(frames.length).parse(JSON.parse(result));
    } catch { throw new Error('smoke_tokenizer_unavailable'); }
  };
  const vectors = artifact.verification.vectors;
  const observed = countMany(vectors.map(vector => vector.messages));
  if (observed.some((count, index) => count !== vectors[index]!.expectedCount)) throw new Error('smoke_tokenizer_vector_mismatch');
  return { digest: expectedDigest, countInputTokens: (messages: ModelMessages) => countMany([messages])[0]!, verifyCurrent };
}
