import { readFileSync } from 'node:fs';
import { Tokenizer } from '@huggingface/tokenizers';
import { SmokeTokenizerArtifactSchema, renderSmokeMessages } from './smoke-tokenizer.ts';

// Fixed local text-processing helper. Never imports an owner-supplied executable or model code.
try {
  const raw = readFileSync(0);
  if (raw.byteLength > 24 * 1024 * 1024) throw new Error('input_limit');
  const input = JSON.parse(raw.toString('utf8'));
  const artifact = SmokeTokenizerArtifactSchema.parse(input.artifact);
  if (!Array.isArray(input.frames) || input.frames.length > 20) throw new Error('invalid_frames');
  const tokenizer = new Tokenizer(artifact.tokenizer, artifact.tokenizerConfig);
  const counts = input.frames.map((messages: unknown) => tokenizer.encode(renderSmokeMessages(artifact, messages), { add_special_tokens: artifact.template.addSpecialTokens }).ids.length + artifact.template.conservativeMarginTokens);
  process.stdout.write(JSON.stringify(counts));
} catch { process.stderr.write('smoke_tokenizer_unavailable\n'); process.exitCode = 2; }
