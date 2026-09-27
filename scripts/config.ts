import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const amount = z.number().finite().nonnegative();
const timestamp = z.iso.datetime();
const OwnerSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  repository: z.strictObject({ name: z.string(), visibility: z.enum(['private', 'public']),
    creationAuthorized: z.boolean(), pushAuthorized: z.boolean(), basis: z.string() }),
  eligibilityReviewed: z.boolean(), contributionRightsConfirmed: z.boolean(),
  aiAssistanceReviewed: z.boolean(), openSourceLicense: z.string().nullable(),
  publicSourceAuthorized: z.boolean(), publicDemoAuthorized: z.boolean(),
  entryAuthorized: z.boolean(), demoOperator: z.string().nullable(), confirmedAt: timestamp.nullable(),
  localBuildBeforeProviderAccess: z.strictObject({ authorized: z.boolean(), confirmedAt: timestamp, basis: z.string(), scope: z.string() }).optional(),
});

export const BudgetSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), currency: z.literal('USD'), maxApprovedSpendUsd: amount,
  ownerApproval: z.strictObject({ approvedBy: z.string().min(1), approvedAt: timestamp,
    expiresAt: timestamp.nullable(), reference: z.string().min(1) }).nullable(),
  verifiedCredits: z.array(z.strictObject({ service: z.string().min(1), amountUsd: amount,
    verifiedAt: timestamp, expiresAt: timestamp, evidenceRef: z.string().min(1) })),
  stages: z.strictObject({ smoke: amount, pilot: amount, evaluate: amount, hosting: amount }),
  episodeLimits: z.strictObject({
    inferenceCallLimit: z.number().int().min(1).max(24), inputTokenLimit: z.number().int().positive().nullable(),
    outputTokenLimit: z.number().int().positive().nullable(), wallTimeLimitSeconds: z.number().int().min(1).max(900),
    sandboxCpuSecondsLimit: z.number().int().positive().nullable(), candidateBranchLimit: z.number().int().min(1).max(3),
  }),
  note: z.string(),
}).superRefine((budget, ctx) => {
  if (Object.values(budget.stages).reduce((sum, value) => sum + value, 0) > budget.maxApprovedSpendUsd) {
    ctx.addIssue({ code: 'custom', message: 'Stage caps exceed aggregate approval.' });
  }
  if (budget.maxApprovedSpendUsd > 0 && !budget.ownerApproval) {
    ctx.addIssue({ code: 'custom', message: 'Positive spending requires an owner approval record.' });
  }
});

const RuntimeSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), mode: z.enum(['mock', 'live']), observedAt: timestamp,
  local: z.strictObject({ node: z.string(), npm: z.string(), python: z.string(), architecture: z.string(), platform: z.string() }),
  model: z.strictObject({
    provider: z.literal('nebius-token-factory'), baseUrl: z.literal('https://api.tokenfactory.nebius.com/v1/'),
    id: z.string().nullable(), accountVerifiedAt: timestamp.nullable(), licenseUrl: z.url().nullable(),
    modelCardUrl: z.url().nullable(), contextLimit: z.number().int().positive().nullable(),
    toolOutputBehavior: z.string().nullable(), inputUsdPerMillionTokens: amount.nullable(), outputUsdPerMillionTokens: amount.nullable(),
  }),
  sandbox: z.strictObject({
    provider: z.literal('nebius-sandboxes'), endpoint: z.url().nullable(), sdkVersion: z.string().nullable(),
    imageDigest: z.string().nullable(), architecture: z.string().nullable(), accountVerifiedAt: timestamp.nullable(),
    billingUnit: z.string().nullable(), usdPerBillingUnit: amount.nullable(),
    networkControlsVerifiedAt: timestamp.nullable(), cancellationVerifiedAt: timestamp.nullable(),
  }),
  integrationOperationIds: z.array(z.string()), sources: z.array(z.url()),
});

export async function readConfiguration(root: URL) {
  const read = async (file: string) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
  const [budget, owner, runtime] = await Promise.all([
    read('budget.json'), read('owner-decisions.json'), read('runtime-lock.json'),
  ]);
  return { budget: BudgetSchema.parse(budget), owner: OwnerSchema.parse(owner), runtime: RuntimeSchema.parse(runtime) };
}

export type Configuration = Awaited<ReturnType<typeof readConfiguration>>;

export function readiness(config: Configuration, now = new Date()): string[] {
  const { owner, runtime, budget } = config;
  const blockers: string[] = [];
  if (!owner.eligibilityReviewed) blockers.push('Owner eligibility/conflict review pending.');
  if (!owner.contributionRightsConfirmed) blockers.push('Owner contribution-rights confirmation pending.');
  if (!owner.aiAssistanceReviewed) blockers.push('Owner AI-assistance review pending.');
  if (!owner.confirmedAt) blockers.push('Owner decision timestamp missing.');
  if (!budget.ownerApproval || budget.maxApprovedSpendUsd === 0) blockers.push('No paid resource allowance authorized.');
  else if (budget.ownerApproval.expiresAt && new Date(budget.ownerApproval.expiresAt) <= now) blockers.push('Resource authorization expired.');
  if (!runtime.model.id || !runtime.model.accountVerifiedAt) blockers.push('NVIDIA model/account availability not verified.');
  if (!runtime.model.licenseUrl || !runtime.model.modelCardUrl) blockers.push('Selected model license/card not pinned.');
  if (runtime.model.inputUsdPerMillionTokens === null || runtime.model.outputUsdPerMillionTokens === null) blockers.push('Model billing rates unknown.');
  if (!runtime.sandbox.endpoint || !runtime.sandbox.accountVerifiedAt) blockers.push('Sandbox endpoint/entitlement not verified.');
  if (!runtime.sandbox.sdkVersion || !runtime.sandbox.imageDigest || !runtime.sandbox.architecture) blockers.push('Sandbox SDK/image/architecture not pinned.');
  if (!runtime.sandbox.networkControlsVerifiedAt) blockers.push('Sandbox network controls not verified.');
  if (runtime.sandbox.usdPerBillingUnit === null || !runtime.sandbox.billingUnit) blockers.push('Sandbox billing rate/unit unknown.');
  if (!budget.episodeLimits.inputTokenLimit || !budget.episodeLimits.outputTokenLimit || !budget.episodeLimits.sandboxCpuSecondsLimit) {
    blockers.push('Episode token/CPU limits not calibrated.');
  }
  blockers.push('Real-provider smoke, sandbox isolation and billing reconciliation have not been verified; no automatic fallback.');
  return blockers;
}
