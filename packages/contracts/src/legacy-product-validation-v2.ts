import { z } from 'zod';
import { DigestSchema, LimitsSchema, TerminalStatusSchema, VariantSchema } from './index.ts';
import { FixtureSchema, ProductContractVersionSchema, ProductPhaseSchema } from './legacy-product-v2.ts';

export const ProposalSchema = z.strictObject({
  files: z.record(z.string(), z.string()), summary: z.string().max(20000),
  usage: z.strictObject({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
    inferenceCalls: z.number().int().nonnegative(), measuredCostUsd: z.number().nonnegative().nullable() }),
  modelId: z.string().nullable(), providerRequestId: z.string().nullable(),
});
const CheckSchema = z.strictObject({
  id: z.string(), requirementId: z.string(), status: z.enum(['pass', 'fail', 'error']), message: z.string(),
  actual: z.json(), expected: z.json(), durationMs: z.number().nonnegative(), log: z.string(),
});
export const ProductRunSchema = z.strictObject({
  schemaVersion: ProductContractVersionSchema, id: z.uuid(), taskId: z.string(), variant: VariantSchema,
  mode: z.enum(['mock', 'live']), competitionReady: z.literal(false), notice: z.string(), phase: ProductPhaseSchema,
  terminalStatus: TerminalStatusSchema.nullable(), reason: z.string().nullable(), createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
  sourceDigest: DigestSchema, policyDigest: DigestSchema, runtimeLockDigest: DigestSchema, limits: LimitsSchema,
  usage: z.strictObject({ inferenceCalls: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
    sandboxCpuSeconds: z.number().nonnegative().nullable(), measuredCostUsd: z.number().nonnegative().nullable(), costIsEstimate: z.boolean(), elapsedMs: z.number().nonnegative() }),
  baselineChecks: z.strictObject({ visible: z.array(CheckSchema), acceptance: z.array(CheckSchema) }).nullable(),
  candidates: z.array(z.strictObject({
    id: z.number().int().positive(), parentId: z.number().int().positive().nullable(), summary: z.string(), files: z.record(z.string(), z.string()), diff: z.string(),
    visibleChecks: z.array(CheckSchema), acceptanceChecks: z.array(CheckSchema), accepted: z.boolean(), rejectionReason: z.string().nullable(),
    modelId: z.string().nullable(), providerRequestId: z.string().nullable(), sandboxOperationIds: z.array(z.string()), elapsedMs: z.number().nonnegative(),
    usage: ProposalSchema.shape.usage,
  })).max(3),
  selectedCandidateId: z.number().int().positive().nullable(),
  coverage: z.array(z.strictObject({ requirementId: z.string(), status: z.enum(['pass', 'fail', 'unverified']), checkIds: z.array(z.string()) })),
  events: z.array(z.strictObject({ sequence: z.number().int().positive(), timestamp: z.iso.datetime(), phase: ProductPhaseSchema, message: z.string() })),
  sandboxOperationIds: z.array(z.string()),
}).superRefine((run, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (run.phase === 'terminal' && (!run.terminalStatus || !run.finishedAt)) invalid('Incomplete terminal run.');
  if (run.events.at(-1)?.phase !== run.phase || run.events.some((event, i) => event.sequence !== i + 1)) invalid('Invalid journal sequence/state.');
  if (run.terminalStatus === 'verified_for_declared_checks' &&
      (!run.candidates.find(candidate => candidate.id === run.selectedCandidateId)?.accepted || run.coverage.some(row => row.status !== 'pass'))) invalid('Unsupported approval.');
  if (run.mode === 'mock' && (run.usage.inferenceCalls !== 0 || run.usage.measuredCostUsd !== 0 || run.candidates.some(c => c.modelId !== null || c.providerRequestId !== null))) invalid('Mock run claims provider activity.');
});

export const ProductEvidenceSchema = z.strictObject({
  format: z.literal('patchproof-evidence-v2'), schemaVersion: ProductContractVersionSchema, mode: z.enum(['mock', 'live']), competitionReady: z.literal(false),
  run: ProductRunSchema, fixture: FixtureSchema, runtimeLock: z.json(),
  files: z.record(z.string(), z.strictObject({ content: z.string(), digest: DigestSchema })), bundleDigest: DigestSchema,
}).refine(bundle => bundle.schemaVersion === bundle.run.schemaVersion, 'Evidence and run contract versions must match.');
