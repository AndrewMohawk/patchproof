import { z } from 'zod';
import { JsonDataSchema, jsonRecord, jsonShape, assertLegacyJsonDomain } from './json-data.ts';
import { FixtureSchema as LegacyFixtureSchema } from './legacy-product-v2.ts';
import { DigestSchema, TaskIdSchema, VariantSchema, TerminalStatusSchema, LimitsSchema, RequirementSchema } from './index.ts';

export const PRODUCT_CONTRACT_VERSION = '2.2' as const;
export const ProductContractVersionSchema = z.enum(['2.0', '2.1', '2.2']);
export type ProductContractVersion = z.infer<typeof ProductContractVersionSchema>;
export const ProductModeSchema = z.enum(['mock', 'live']);
const FunctionCaseObjectSchema = z.strictObject({
  id: z.string(), requirementId: z.string(), function: z.string(),
  args: z.array(JsonDataSchema), kwargs: jsonRecord(JsonDataSchema).default({}),
  assertArgsUnchanged: z.boolean().default(false),
  expected: JsonDataSchema.optional(), expectedException: z.string().optional(),
}).refine(value => (value.expected !== undefined) !== (value.expectedException !== undefined), 'Exactly one expected outcome required.');
export const FunctionCaseSchema = jsonShape(FunctionCaseObjectSchema);
const FixtureObjectSchema = z.strictObject({
  id: TaskIdSchema, repoId: z.string(), split: z.enum(['development', 'calibration', 'final']),
  title: z.string(), description: z.string(), requirements: z.array(RequirementSchema).min(1),
  files: jsonRecord(z.string()), editAllowlist: z.array(z.string()).min(1),
  entrypoint: z.string(), visibleCases: z.array(FunctionCaseSchema), acceptanceCases: z.array(FunctionCaseSchema),
  license: z.enum(['CC0-1.0', 'MIT']), provenance: z.string(),
  licenseText: z.string().min(1).optional(),
  editRegion: z.strictObject({ path: z.string(), functionName: z.string(), prefix: z.string().min(1), suffix: z.string().min(1) }).optional(),
});
export const FixtureSchema = jsonShape(FixtureObjectSchema).refine(f => f.license !== 'MIT' || Boolean(f.licenseText), 'MIT license notice required');
export function parseFixtureForVersion(value: unknown, version: ProductContractVersion) {
  const copy = JsonDataSchema.parse(value);
  if (version === '2.2') return FixtureSchema.parse(copy);
  if (version === '2.0' || version === '2.1') { assertLegacyJsonDomain(copy); return LegacyFixtureSchema.parse(copy); }
  throw new Error('Unsupported fixture contract version.');
}
export type Fixture = z.infer<typeof FixtureSchema>;
export type FunctionCase = z.infer<typeof FunctionCaseSchema>;

export interface CandidateProposal {
  files: Record<string, string>;
  summary: string;
  usage: { inputTokens: number; outputTokens: number; inferenceCalls: number; measuredCostUsd: number | null };
  modelId: string | null;
  providerRequestId: string | null;
}
export interface RepairInput {
  taskId: string;
  description: string;
  requirements: Array<{ id: string; text: string }>;
  files: Record<string, string>;
  editAllowlist: string[];
  visibleCases: FunctionCase[];
  editRegion?: { path: string; functionName: string; prefix: string; suffix: string };
  feedback: Array<{ requirementId: string; status: string; message: string }>;
  attempt: number;
  remaining: z.infer<typeof LimitsSchema>;
}
export interface RepairProvider {
  mode: 'mock' | 'live';
  propose(input: RepairInput, signal: AbortSignal): Promise<CandidateProposal>;
}
export interface CheckResult {
  id: string;
  requirementId: string;
  status: 'pass' | 'fail' | 'error';
  message: string;
  actual: unknown;
  expected: unknown;
  durationMs: number;
  log: string;
}
export interface SandboxCheckResult {
  checks: CheckResult[];
  isolation: 'local_container' | 'nebius_sandbox' | 'unavailable';
  operationIds: string[];
  cpuSeconds: number | null;
  measuredCostUsd: number | null;
  infrastructureError: string | null;
}
export interface CheckRunner {
  run(input: { files: Record<string, string>; entrypoint: string; cases: FunctionCase[]; timeoutSeconds: number; contractVersion?: ProductContractVersion;
    ownerRunId?: string; onOperation?: (id: string) => void },
    signal: AbortSignal): Promise<SandboxCheckResult>;
  reconcile?(runIds: string[]): Promise<{ remainingOperationIds: string[]; error: string | null }>;
}

export const ProductRunRequestSchema = z.strictObject({
  taskId: TaskIdSchema, variant: VariantSchema, mode: ProductModeSchema,
  idempotencyKey: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});
export const ProductPhaseSchema = z.enum(['queued', 'preflight', 'baseline_capture', 'repair', 'check', 'export', 'terminal']);
export interface ProductEvent { sequence: number; timestamp: string; phase: z.infer<typeof ProductPhaseSchema>; message: string; }
export interface CandidateRecord {
  id: number; parentId: number | null; summary: string; files: Record<string, string>; diff: string;
  visibleChecks: CheckResult[]; acceptanceChecks: CheckResult[];
  accepted: boolean; rejectionReason: string | null;
  modelId: string | null; providerRequestId: string | null;
  sandboxOperationIds: string[]; elapsedMs: number;
  usage: CandidateProposal['usage'];
}
export interface ProductRun {
  schemaVersion: ProductContractVersion;
  id: string; taskId: string; variant: z.infer<typeof VariantSchema>; mode: 'mock' | 'live';
  competitionReady: false; notice: string; phase: z.infer<typeof ProductPhaseSchema>;
  terminalStatus: z.infer<typeof TerminalStatusSchema> | null;
  reason: string | null; createdAt: string; finishedAt: string | null;
  sourceDigest: string; policyDigest: string; runtimeLockDigest: string;
  limits: z.infer<typeof LimitsSchema>;
  usage: { inferenceCalls: number; inputTokens: number; outputTokens: number; sandboxCpuSeconds: number | null;
    measuredCostUsd: number | null; costIsEstimate: boolean; elapsedMs: number };
  baselineChecks: { visible: CheckResult[]; acceptance: CheckResult[] } | null;
  candidates: CandidateRecord[]; selectedCandidateId: number | null;
  coverage: Array<{ requirementId: string; status: 'pass' | 'fail' | 'unverified'; checkIds: string[] }>;
  events: ProductEvent[];
  sandboxOperationIds: string[];
}

export interface ProductEvidence {
  format: 'patchproof-evidence-v2'; schemaVersion: ProductContractVersion; mode: 'mock' | 'live'; competitionReady: false;
  run: ProductRun; fixture: Fixture; runtimeLock: unknown;
  files: Record<string, { content: string; digest: string }>;
  bundleDigest: string;
}

export const ProductDigestFieldsSchema = z.strictObject({ sourceDigest: DigestSchema, policyDigest: DigestSchema, runtimeLockDigest: DigestSchema });
