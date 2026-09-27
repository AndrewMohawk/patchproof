import { z } from 'zod';
import type { CandidateProposal, RepairInput, RepairProvider } from '../../packages/contracts/src/product.ts';

export class RepairError extends Error {
  readonly code: string;
  readonly usage: { inferenceCalls: number; inputTokens: number; outputTokens: number; measuredCostUsd: number | null };
  constructor(code: string, message: string,
    usage = { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: null as number | null }) {
    super(message);
    this.code = code;
    this.usage = usage;
  }
}

export const SCRIPTED_BAD = 'def unique(values):\n    return sorted(set(values))\n';
const SCRIPTED_CORRECTION = 'def unique(values):\n    if values is None:\n        raise TypeError("values must not be None")\n    result = []\n    for value in values:\n        if value not in result:\n            result.append(value)\n    return result\n';

/** An explicit demonstration script. It is never an inference or benchmark result. */
export class MockRepairProvider implements RepairProvider {
  readonly mode = 'mock' as const;
  async propose(input: RepairInput, signal: AbortSignal): Promise<CandidateProposal> {
    if (signal.aborted) throw new RepairError('cancelled', 'Scripted proposal cancelled.');
    if (input.taskId !== 'stable-unique-01') throw new RepairError('mock_task_unavailable', 'Scripted mock supports only stable-unique-01; no model was called.');
    if (!input.editAllowlist.includes('solution.py')) throw new RepairError('protected_path', 'Demonstration source is not editable.');
    const correction = input.files['solution.py'] === SCRIPTED_BAD && input.feedback.some(row => row.status === 'fail');
    return {
      files: { 'solution.py': correction ? SCRIPTED_CORRECTION : SCRIPTED_BAD },
      summary: correction ? 'SCRIPTED MOCK: preserve first occurrence order and caller input after observed failure.' :
        'SCRIPTED MOCK: try sorted deduplication; independent checks determine its outcome.',
      usage: { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: 0 },
      modelId: null, providerRequestId: null,
    };
  }
}

const proposalSchema = z.strictObject({ files: z.record(z.string(), z.string()), summary: z.string().max(2000) });
const responseSchema = z.object({
  id: z.string().min(1), model: z.string().min(1),
  choices: z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }),
});
export type ModelMessages = Array<{ role: 'system' | 'user'; content: string }>;
export interface NebiusRepairOptions {
  modelId: string;
  accountVerifiedAt: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  credential: () => Promise<string>;
  countInputTokens: (messages: ModelMessages) => number;
  fetch: typeof globalThis.fetch;
  authorized: boolean;
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) throw new Error('missing_body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) { await reader.cancel(); throw new Error('output_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Documented HTTP mapping; constructor does not contact Nebius or read ambient credentials. */
export class NebiusRepairProvider implements RepairProvider {
  readonly mode = 'live' as const;
  readonly #options: NebiusRepairOptions;
  constructor(options: NebiusRepairOptions) { this.#options = options; }

  async propose(input: RepairInput, signal: AbortSignal): Promise<CandidateProposal> {
    const o = this.#options;
    if (signal.aborted) throw new RepairError('cancelled', 'Inference cancelled before dispatch.');
    if (!o.authorized || !o.modelId.startsWith('nvidia/') || !Number.isFinite(Date.parse(o.accountVerifiedAt)) ||
        Date.parse(o.accountVerifiedAt) > Date.now()) throw new RepairError('authorization_required', 'A pinned account-verified NVIDIA model and explicit authorization are required.');
    const rates = [o.inputUsdPerMillionTokens, o.outputUsdPerMillionTokens];
    if (rates.some(rate => !Number.isFinite(rate) || rate < 0)) throw new RepairError('billing_unknown', 'Verified token rates are required.');
    if (input.remaining.inferenceCallLimit < 1 || input.remaining.outputTokenLimit < 1) throw new RepairError('budget_exhausted', 'Inference allowance exhausted.');
    const messages: ModelMessages = [
      { role: 'system', content: 'Repair this benign maintenance task. Return only JSON {"files":{"allowed/path.py":"full replacement source"},"summary":"concise externally observable change"}. Edit only the allowlist. Do not alter tests or policy. Do not include hidden reasoning.' },
      { role: 'user', content: JSON.stringify({ taskId: input.taskId, description: input.description,
        requirements: input.requirements, files: input.files, editAllowlist: input.editAllowlist,
        visibleCases: input.visibleCases, feedback: input.feedback }) },
    ];
    const promptTokens = o.countInputTokens(messages);
    if (!Number.isSafeInteger(promptTokens) || promptTokens < 1 || promptTokens > input.remaining.inputTokenLimit) {
      throw new RepairError('budget_exhausted', 'Prompt exceeds remaining input-token allowance.');
    }
    const ceiling = (promptTokens * o.inputUsdPerMillionTokens + input.remaining.outputTokenLimit * o.outputUsdPerMillionTokens) / 1_000_000;
    if (ceiling > input.remaining.maxApprovedSpendUsd) throw new RepairError('budget_exhausted', 'Conservative request cost exceeds remaining approved allowance.');
    const token = await o.credential();
    if (!token || /[\r\n]/.test(token)) throw new RepairError('missing_key', 'A valid externally supplied credential is required.');
    const deadline = AbortSignal.timeout(Math.max(1, input.remaining.wallTimeLimitSeconds * 1000));
    const combined = AbortSignal.any([signal, deadline]);
    let usage = { inferenceCalls: 1, inputTokens: 0, outputTokens: 0, measuredCostUsd: null as number | null };
    let response: Response;
    try {
      response = await o.fetch('https://api.tokenfactory.nebius.com/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: o.modelId, messages, max_tokens: input.remaining.outputTokenLimit,
          response_format: { type: 'json_object' }, stream: false }),
      });
    } catch {
      throw new RepairError(signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'transport_error', 'Inference transport did not complete; provider billing is unreconciled.', usage);
    }
    if (!response.ok) throw new RepairError(response.status === 429 ? 'rate_limit' : response.status === 401 ? 'missing_key' : 'provider_error', `Inference failed with HTTP ${response.status}; response body withheld.`, usage);
    let raw: string;
    try { raw = await boundedResponseText(response); }
    catch { throw new RepairError(signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'invalid_response', 'Inference body could not be retained within the output limit; billing is unreconciled.', usage); }
    let parsed: z.infer<typeof responseSchema>;
    try { parsed = responseSchema.parse(JSON.parse(raw)); }
    catch { throw new RepairError('invalid_response', 'Inference response did not match the documented completion contract.', usage); }
    usage = { ...usage, inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens };
    if (parsed.model !== o.modelId) throw new RepairError('model_mismatch', 'Provider returned a different model identifier.', usage);
    if (usage.inputTokens > input.remaining.inputTokenLimit || usage.outputTokens > input.remaining.outputTokenLimit) {
      throw new RepairError('budget_exceeded', 'Provider-reported tokens exceeded the approved allowance; retain this failed call.', usage);
    }
    const reportedCostEstimate = (usage.inputTokens * o.inputUsdPerMillionTokens + usage.outputTokens * o.outputUsdPerMillionTokens) / 1_000_000;
    if (reportedCostEstimate > input.remaining.maxApprovedSpendUsd) throw new RepairError('budget_exceeded', 'Reported token usage exceeds the remaining cost allowance; retain this failed call.', usage);
    if (parsed.choices[0]!.finish_reason !== 'stop') throw new RepairError('incomplete_response', 'Provider did not return a complete candidate.', usage);
    let proposal: z.infer<typeof proposalSchema>;
    try { proposal = proposalSchema.parse(JSON.parse(parsed.choices[0]!.message.content)); }
    catch { throw new RepairError('invalid_candidate', 'Candidate is not the required files-and-summary JSON.', usage); }
    if (!Object.keys(proposal.files).length || Object.keys(proposal.files).some(path => !input.editAllowlist.includes(path))) {
      throw new RepairError('protected_path', 'Candidate edits outside the frozen allowlist were rejected.', usage);
    }
    return { ...proposal, usage, modelId: parsed.model, providerRequestId: parsed.id };
  }
}
