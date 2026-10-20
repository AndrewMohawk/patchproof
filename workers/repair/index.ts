import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { digestBytes, digestJson } from '../../packages/contracts/src/digest.ts';
import type { CandidateProposal, RepairInput, RepairProvider } from '../../packages/contracts/src/product.ts';
import { ContractError } from '../../packages/contracts/src/index.ts';

export class RepairError extends Error {
  readonly code: string;
  readonly usage: { inferenceCalls: number; inputTokens: number; outputTokens: number; measuredCostUsd: number | null };
  readonly providerRequestId: string | null;
  readonly candidateFormatFailure: 'invalid_json' | 'invalid_schema' | null;
  constructor(code: string, message: string,
    usage = { inferenceCalls: 0, inputTokens: 0, outputTokens: 0, measuredCostUsd: null as number | null }, providerRequestId: string | null = null, candidateFormatFailure: 'invalid_json' | 'invalid_schema' | null = null) {
    super(message);
    this.code = code;
    this.usage = usage;
    this.providerRequestId = providerRequestId; this.candidateFormatFailure = candidateFormatFailure;
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
    const correction = input.attempt > 0 && input.feedback.some(row => row.status === 'fail');
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
  id: z.string().regex(/^[A-Za-z0-9_.:/-]{1,200}$/), model: z.string().min(1),
  choices: z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }),
});
export type ModelMessages = Array<{ role: 'system' | 'user'; content: string }>;
export interface InferenceReceipt {
  intentId: string; requestDigest: string; responseDigest: string; usageDigest: string;
  providerRequestId: string; transportRequestId: string | null; modelId: string;
  inputTokenCeiling: number; outputTokenCeiling: number; observedInputTokens: number; observedOutputTokens: number;
}
export interface NebiusRepairOptions {
  maximumOutputTokens?: number;
  disableThinking?: boolean;
  onReceipt?: (receipt: InferenceReceipt) => void;
  modelId: string;
  accountVerifiedAt: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  credential: () => Promise<string>;
  countInputTokens: (messages: ModelMessages) => number;
  fetch: typeof globalThis.fetch;
  authorized: boolean;
  onOperation?: (operation: { kind: 'request_intent' | 'response'; id: string }) => void;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('aborted'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
  });
}
async function boundedResponseText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('missing_body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) throw new Error('output_limit');
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
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
      { role: 'system', content: 'Repair this benign maintenance task so the source satisfies every stated requirement. Check every clause of each requirement, including tie rules and validation boundaries; passing the public examples alone is insufficient. When feedback reports a failing requirement, reassess all its clauses before proposing another change. Make the smallest necessary changes; preserve unrelated code, formatting, comments, and license notices. Return only JSON {"files":{"allowed/path.py":"full replacement source"},"summary":"concise externally observable change"}. Use the exact file paths from editAllowlist as keys. The files must contain the actual repair; a summary alone is not a change. Edit only the allowlist. Do not alter tests or policy. Do not include hidden reasoning in the returned JSON.' },
      { role: 'user', content: JSON.stringify({ taskId: input.taskId, description: input.description,
        requirements: input.requirements, files: input.files, editAllowlist: input.editAllowlist,
        visibleCases: input.visibleCases, feedback: input.feedback }) },
    ];
    if (input.editRegion) {
      messages[0]!.content = messages[0]!.content.replace('full replacement source', 'replacement indented function body');
      messages[0]!.content += ' Encode the body as a valid JSON string: escape newlines and double quotes. The outer object must contain exactly files and summary; do not return Markdown fences or additional fields.';
      messages[0]!.content += ' REGION PROTOCOL: for this task only, files[path] must be the replacement INDENTED BODY of the named function, excluding its def/signature and excluding all other code. Keep every nonblank line indented by at least four spaces and end with a newline. The host restores the immutable prefix and suffix; do not include them in your response.';
      messages[1]!.content = JSON.stringify({ ...JSON.parse(messages[1]!.content), editRegion: { path: input.editRegion.path, functionName: input.editRegion.functionName, output: 'indented body only' } });
    }
    const outputLimit = Math.min(input.remaining.outputTokenLimit, o.maximumOutputTokens ?? input.remaining.outputTokenLimit);
    const promptTokens = o.countInputTokens(messages);
    if (!Number.isSafeInteger(promptTokens) || promptTokens < 1 || promptTokens > input.remaining.inputTokenLimit) {
      throw new RepairError('budget_exhausted', 'Prompt exceeds remaining input-token allowance.');
    }
    const ceiling = (promptTokens * o.inputUsdPerMillionTokens + outputLimit * o.outputUsdPerMillionTokens) / 1_000_000;
    if (ceiling > input.remaining.maxApprovedSpendUsd) throw new RepairError('budget_exhausted', 'Conservative request cost exceeds remaining approved allowance.');
    const deadline = AbortSignal.timeout(Math.max(1, input.remaining.wallTimeLimitSeconds * 1000));
    const combined = AbortSignal.any([signal, deadline]);
    if (combined.aborted) throw new RepairError('cancelled', 'Inference cancelled before credential resolution.');
    let token: string;
    try { token = await abortable(o.credential(), combined); }
    catch (error) {
      if (error instanceof ContractError) throw error;
      throw new RepairError(signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'missing_key', 'Credential resolution did not complete; no inference request dispatched.');
    }
    if (!token || /[\r\n]/.test(token)) throw new RepairError('missing_key', 'A valid externally supplied credential is required.');
    if (combined.aborted) throw new RepairError('cancelled', 'Inference cancelled before dispatch.');
    const intentId = randomUUID();
    const requestBody = { model: o.modelId, messages, max_tokens: outputLimit, max_completion_tokens: outputLimit,
      response_format: { type: 'json_object' }, stream: false, store: false, n: 1,
      ...(o.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}) };
    try { o.onOperation?.({ kind: 'request_intent', id: intentId }); }
    catch (error) {
      if (error instanceof ContractError) throw error;
      throw new RepairError('operation_journal_error', 'Inference intent could not be journaled; no request dispatched.');
    }
    if (combined.aborted) throw new RepairError('cancelled', 'Inference cancelled before dispatch.');
    let usage = { inferenceCalls: 1, inputTokens: 0, outputTokens: 0, measuredCostUsd: null as number | null };
    let response: Response;
    try {
      response = await abortable(o.fetch('https://api.tokenfactory.nebius.com/v1/chat/completions', {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }), combined);
    } catch (error) {
      if (error instanceof ContractError) { Object.assign(error, { usage }); throw error; }
      throw new RepairError(signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'transport_error', 'Inference transport did not complete; provider billing is unreconciled.', usage);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new RepairError(response.status === 429 ? 'rate_limit' : response.status === 401 ? 'missing_key' : 'provider_error', `Inference failed with HTTP ${response.status}; response body withheld.`, usage);
    }
    let raw: string;
    try { raw = await boundedResponseText(response, combined); }
    catch { throw new RepairError(signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : 'invalid_response', 'Inference body could not be retained within the output limit; billing is unreconciled.', usage); }
    let decoded: unknown;
    try { decoded = JSON.parse(raw); }
    catch { throw new RepairError('invalid_response', 'Inference response was not JSON.', usage); }
    // Identity and accounting can be valid even when choices or model fields are malformed.
    // Retain these independently before candidate validation without rereading the body.
    const identity = responseSchema.pick({ id: true }).safeParse(decoded);
    const accounting = responseSchema.pick({ usage: true }).safeParse(decoded);
    const responseContainsCredential = raw.includes(token) || JSON.stringify(decoded).includes(token);
    const responseId = !responseContainsCredential && identity.success ? identity.data.id : null;
    if (accounting.success) usage = { ...usage, inputTokens: accounting.data.usage.prompt_tokens, outputTokens: accounting.data.usage.completion_tokens };
    if (responseContainsCredential) throw new RepairError('invalid_response', 'Provider response contained credential material and was withheld.', usage);
    try { if (responseId !== null) o.onOperation?.({ kind: 'response', id: responseId }); }
    catch (error) {
      if (error instanceof ContractError) { Object.assign(error, { usage, providerRequestId: responseId }); throw error; }
      throw new RepairError('operation_journal_error', 'Inference response identity could not be journaled; retain this failed call.', usage, responseId);
    }
    let parsed: z.infer<typeof responseSchema>;
    try { parsed = responseSchema.parse(decoded); }
    catch { throw new RepairError('invalid_response', 'Inference response did not match the documented completion contract.', usage, responseId); }
    if (parsed.model !== o.modelId) throw new RepairError('model_mismatch', 'Provider returned a different model identifier.', usage, parsed.id);
    if (usage.inputTokens > Math.min(promptTokens, input.remaining.inputTokenLimit) || usage.outputTokens > outputLimit) {
      throw new RepairError('budget_exceeded', 'Provider-reported tokens exceeded the approved allowance; retain this failed call.', usage, parsed.id);
    }
    const reportedCostEstimate = (usage.inputTokens * o.inputUsdPerMillionTokens + usage.outputTokens * o.outputUsdPerMillionTokens) / 1_000_000;
    if (reportedCostEstimate > input.remaining.maxApprovedSpendUsd) throw new RepairError('budget_exceeded', 'Reported token usage exceeds the remaining cost allowance; retain this failed call.', usage, parsed.id);
    const rawTransportId = response.headers.get('x-request-id');
    const transportRequestId = rawTransportId && /^[A-Za-z0-9_.:/-]{1,200}$/.test(rawTransportId) && !rawTransportId.includes(token) ? rawTransportId : null;
    try { o.onReceipt?.({ intentId, requestDigest: digestJson(requestBody), responseDigest: digestBytes(raw), usageDigest: digestJson(parsed.usage),
      providerRequestId: parsed.id, transportRequestId, modelId: parsed.model,
      inputTokenCeiling: promptTokens, outputTokenCeiling: outputLimit, observedInputTokens: usage.inputTokens, observedOutputTokens: usage.outputTokens }); }
    catch (error) {
      if (error instanceof ContractError) { Object.assign(error, { usage, providerRequestId: parsed.id }); throw error; }
      throw new RepairError('operation_journal_error', 'Inference receipt could not be preserved; retain the full reservation.', usage, parsed.id);
    }
    if (parsed.choices[0]!.finish_reason !== 'stop') throw new RepairError('incomplete_response', 'Provider did not return a complete candidate.', usage, parsed.id);
    let candidateValue: unknown;
    try { candidateValue = JSON.parse(parsed.choices[0]!.message.content); }
    catch { throw new RepairError('invalid_candidate', 'Candidate is not valid JSON.', usage, parsed.id, 'invalid_json'); }
    let proposal: z.infer<typeof proposalSchema>;
    try { proposal = proposalSchema.parse(candidateValue); }
    catch { throw new RepairError('invalid_candidate', 'Candidate does not match the files-and-summary schema.', usage, parsed.id, 'invalid_schema'); }
    if ([proposal.summary, ...Object.keys(proposal.files), ...Object.values(proposal.files)].some(value => value.includes(token))) {
      throw new RepairError('invalid_candidate', 'Candidate contained credential material and was withheld.', usage, parsed.id);
    }
    if (!Object.keys(proposal.files).length || Object.keys(proposal.files).some(path => !input.editAllowlist.includes(path))) {
      throw new RepairError('protected_path', 'Candidate edits outside the frozen allowlist were rejected.', usage, parsed.id);
    }
    if (input.editRegion) {
      const region = input.editRegion, body = proposal.files[region.path];
      if (Object.keys(proposal.files).length !== 1 || typeof body !== 'string' || !body.trim() || !body.endsWith('\n') || /[\r\f\v]/.test(body) || body.split('\n').some(line => line.trim() && !line.startsWith('    '))) {
        throw new RepairError('protected_path', 'Invalid function-only replacement body.', usage, parsed.id);
      }
      proposal.files[region.path] = region.prefix + body + region.suffix;
    }
    return { ...proposal, usage, modelId: parsed.model, providerRequestId: parsed.id };
  }
}
