import { z } from 'zod';

export const CONTRACT_VERSION = '1.0' as const;
export const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const TaskIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const VariantSchema = z.enum(['baseline', 'checks_only', 'patchproof']);
export const ModeSchema = z.enum(['mock', 'live']);
export const TerminalStatusSchema = z.enum([
  'verified_for_declared_checks', 'needs_review', 'failed', 'infrastructure_error',
]);
export const PhaseSchema = z.enum([
  'queued', 'preflight', 'baseline_capture', 'repair', 'check', 'export', 'terminal',
]);

export const LimitsSchema = z.strictObject({
  inferenceCallLimit: z.number().int().min(1).max(24),
  inputTokenLimit: z.number().int().positive().max(10_000_000),
  outputTokenLimit: z.number().int().positive().max(1_000_000),
  wallTimeLimitSeconds: z.number().int().min(1).max(900),
  sandboxCpuSecondsLimit: z.number().int().positive().max(900),
  maxApprovedSpendUsd: z.number().finite().nonnegative().max(1_000),
});

export const RunSpecSchema = z.strictObject({
  taskId: TaskIdSchema,
  repoDigest: DigestSchema,
  policyDigest: DigestSchema,
  variant: VariantSchema,
  ...LimitsSchema.shape,
  seed: z.number().int().min(0).max(2 ** 32 - 1),
});

export const RunRequestSchema = z.strictObject({
  taskId: TaskIdSchema,
  variant: VariantSchema,
  mode: ModeSchema,
  idempotencyKey: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

export const RequirementSchema = z.strictObject({
  id: z.string().regex(/^R[0-9]{2}$/),
  text: z.string().min(1).max(1000),
});

export const TaskSchema = z.strictObject({
  id: TaskIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  requirements: z.array(RequirementSchema).min(1),
  repoDigest: DigestSchema,
  policyDigest: DigestSchema,
  executable: z.literal(false),
  purpose: z.literal('contract_fixture'),
});

export const MockLabelSchema = z.strictObject({
  mode: z.literal('mock'),
  competitionReady: z.literal(false),
  notice: z.literal('MOCK — no model inference, sandbox execution or patch verification.'),
});

export const MOCK_LABEL = MockLabelSchema.parse({
  mode: 'mock', competitionReady: false,
  notice: 'MOCK — no model inference, sandbox execution or patch verification.',
});

export const ErrorCodeSchema = z.enum([
  'invalid_request', 'unknown_task', 'not_found', 'idempotency_conflict',
  'authorization_required', 'budget_not_approved', 'provider_not_implemented',
  'evidence_not_ready', 'capacity_exceeded', 'origin_denied', 'method_not_allowed',
  'rate_limit', 'timeout', 'missing_key', 'setup_error', 'flaky_check',
  'digest_mismatch', 'cancelled', 'infrastructure_error',
]);

export const ApiErrorSchema = z.strictObject({
  ...MockLabelSchema.shape,
  error: z.strictObject({ code: ErrorCodeSchema, message: z.string() }),
});

export const RunEventSchema = z.strictObject({
  ...MockLabelSchema.shape,
  sequence: z.number().int().positive(),
  runId: z.uuid(),
  timestamp: z.iso.datetime(),
  phase: PhaseSchema,
  kind: z.enum(['state', 'cancel_requested', 'terminal']),
  message: z.string(),
});

// This first contract is deliberately mock-only. A future live contract must be
// separately versioned/reviewed after G0/G1; relabeling a mock is invalid.
export const EvidenceManifestSchema = z.strictObject({
  schemaVersion: z.literal(CONTRACT_VERSION),
  ...MockLabelSchema.shape,
  runId: z.uuid(),
  sourceDigest: DigestSchema,
  patchDigest: z.null(),
  modelLockDigest: DigestSchema,
  policyDigest: DigestSchema,
  checks: z.array(z.strictObject({
    id: z.string().min(1),
    status: z.literal('error'),
    logDigest: DigestSchema,
    requirementId: RequirementSchema.shape.id,
  })).min(1),
  coverage: z.array(z.strictObject({
    requirementId: RequirementSchema.shape.id,
    status: z.literal('unverified'),
    reason: z.string().min(1),
  })).min(1),
  terminalStatus: z.literal('needs_review'),
  terminationReason: z.enum(['mock_only', 'cancelled', 'mock_error']),
  replayCommand: z.string().regex(/^make reproduce RUN=[0-9a-f-]{36}$/),
  measuredCostUsd: z.literal(0),
  costIsEstimate: z.literal(false),
  modelId: z.null(),
  sandboxOperationIds: z.array(z.never()).length(0),
  executionPerformed: z.literal(false),
});

export const RunViewSchema = z.strictObject({
  ...MockLabelSchema.shape,
  schemaVersion: z.literal(CONTRACT_VERSION),
  id: z.uuid(),
  task: TaskSchema,
  spec: RunSpecSchema,
  createdAt: z.iso.datetime(),
  phase: PhaseSchema,
  terminalStatus: z.literal('needs_review').nullable(),
  cancelled: z.boolean(),
  usage: z.strictObject({
    inferenceCalls: z.literal(0), inputTokens: z.literal(0),
    outputTokens: z.literal(0), sandboxCpuSeconds: z.literal(0), measuredCostUsd: z.literal(0),
  }),
  events: z.array(RunEventSchema).min(1),
  evidence: EvidenceManifestSchema.nullable(),
}).superRefine((run, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (run.task.id !== run.spec.taskId || run.task.repoDigest !== run.spec.repoDigest ||
      run.task.policyDigest !== run.spec.policyDigest) invalid('Task/spec mismatch.');
  if (run.spec.maxApprovedSpendUsd !== 0) invalid('Mock spending must be zero.');
  const requirements = run.task.requirements.map(r => r.id);
  if (new Set(requirements).size !== requirements.length) invalid('Duplicate requirements.');
  run.events.forEach((event, i) => {
    if (event.runId !== run.id || event.sequence !== i + 1) invalid('Event ownership/order mismatch.');
    if (i < run.events.length - 1 && event.phase === 'terminal') invalid('Event after terminal.');
  });
  if (run.events.at(-1)?.phase !== run.phase) invalid('Event phase mismatch.');
  if (run.phase === 'terminal') {
    if (run.terminalStatus !== 'needs_review' || !run.evidence || run.events.at(-1)?.kind !== 'terminal') {
      invalid('Incomplete terminal state.');
    }
  } else if (run.terminalStatus !== null || run.evidence !== null) invalid('Premature terminal evidence.');
  const evidence = run.evidence;
  if (!evidence) return;
  if (evidence.runId !== run.id || evidence.sourceDigest !== run.spec.repoDigest ||
      evidence.policyDigest !== run.spec.policyDigest ||
      evidence.replayCommand !== `make reproduce RUN=${run.id}`) invalid('Evidence identity mismatch.');
  if ((evidence.terminationReason === 'cancelled') !== run.cancelled) invalid('Cancellation mismatch.');
  for (const rows of [evidence.checks, evidence.coverage]) {
    const ids = rows.map(r => r.requirementId);
    if (ids.length !== requirements.length || new Set(ids).size !== ids.length ||
        ids.some(id => !requirements.includes(id))) invalid('Requirement mapping mismatch.');
  }
  if (new Set(evidence.checks.map(c => c.id)).size !== evidence.checks.length) invalid('Duplicate checks.');
});

export type Task = z.infer<typeof TaskSchema>;
export type RunSpec = z.infer<typeof RunSpecSchema>;
export type RunRequest = z.infer<typeof RunRequestSchema>;
export type RunView = z.infer<typeof RunViewSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export class ContractError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  constructor(code: ErrorCode, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function parseRunRequest(value: unknown, knownTaskIds: readonly string[]): RunRequest {
  const parsed = RunRequestSchema.safeParse(value);
  if (!parsed.success) throw new ContractError('invalid_request', 'Invalid run request.');
  if (!knownTaskIds.includes(parsed.data.taskId)) {
    throw new ContractError('unknown_task', 'Select a task from the curated catalogue.');
  }
  return parsed.data;
}
