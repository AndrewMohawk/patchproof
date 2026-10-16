import { z } from 'zod';
import { digestJson } from '../../contracts/src/digest.ts';
import { ContractError } from '../../contracts/src/index.ts';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const RENEWABLE_PRICING_POLICY = Object.freeze({
  id: 'token-factory-renewable-pricing-v1',
  catalogEndpoint: 'https://api.tokenfactory.nebius.com/v1/models?verbose=true',
  modelId: 'nvidia/nemotron-3-super-120b-a12b', contextTokens: 262144, quantization: 'fp4',
  inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 0.9, requestFeeUsd: 0,
  maximumCatalogAgeMs: 70 * 60 * 1000, maximumFeeAgeMs: 24 * 60 * 60 * 1000,
  maximumTotalUsd: 25, perRunReservationUsd: 0.25,
});
export const RENEWABLE_PRICING_POLICY_DIGEST = digestJson(RENEWABLE_PRICING_POLICY);
export const FeeEvidenceSchema = z.strictObject({ schemaVersion: z.literal('1.0'),
  verifiedAt: z.iso.datetime(), validUntil: z.iso.datetime(), evidenceDigest: hash,
  accountBillingActive: z.literal(true), additionalFeeUsdPerRun: z.literal(0),
  basis: z.literal('operator-reviewed-account-pricing-and-fees'),
});
export const RenewablePricingReceiptSchema = z.strictObject({ schemaVersion: z.literal('1.0'),
  policyDigest: hash, sourceDigest: hash, budgetDigest: hash,
  verifiedAt: z.iso.datetime(), validUntil: z.iso.datetime(), catalogDigest: hash,
  modelId: z.literal('nvidia/nemotron-3-super-120b-a12b'), contextTokens: z.literal(262144), quantization: z.literal('fp4'),
  inputUsdPerMillionTokens: z.literal(0.3), outputUsdPerMillionTokens: z.literal(0.9), requestFeeUsd: z.literal(0),
  feeEvidence: FeeEvidenceSchema,
});
export type RenewablePricingReceipt = z.infer<typeof RenewablePricingReceiptSchema>;
export const PricingMonitorStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('verified'), receipt: RenewablePricingReceiptSchema }),
  z.strictObject({ status: z.literal('blocked'), checkedAt: z.iso.datetime(), reason: z.enum([
    'catalog_unavailable', 'catalog_mismatch', 'fee_evidence_invalid', 'configuration_invalid', 'verification_failed']) }),
]);
export interface PricingBindings { sourceDigest: string; budgetDigest: string; approvalExpiresAt: string; }
export interface VerifiedPricing { digest: string; evidence: RenewablePricingReceipt; }
function reject(): never { throw new ContractError('authorization_required', 'Current model pricing and account-fee verification are required.', 403); }
function validWindow(verifiedAt: string, validUntil: string, now: number, maximum: number, deadline: number) {
  const start = Date.parse(verifiedAt), end = Date.parse(validUntil);
  return Number.isFinite(now) && Number.isFinite(deadline) && deadline > now && start <= now && end > now && end > start && end - start <= maximum && deadline <= end;
}
export function verifyRenewablePricing(value: unknown, bindings: PricingBindings, deadline: number, now = Date.now()): VerifiedPricing {
  const state = PricingMonitorStateSchema.safeParse(value);
  if (!state.success || state.data.status !== 'verified') return reject();
  const receipt = state.data.receipt, fee = receipt.feeEvidence;
  if (receipt.policyDigest !== RENEWABLE_PRICING_POLICY_DIGEST || receipt.sourceDigest !== bindings.sourceDigest ||
      receipt.budgetDigest !== bindings.budgetDigest || !Number.isFinite(Date.parse(bindings.approvalExpiresAt)) ||
      deadline > Date.parse(bindings.approvalExpiresAt) || Date.parse(receipt.validUntil) > Date.parse(bindings.approvalExpiresAt) ||
      !validWindow(receipt.verifiedAt, receipt.validUntil, now, RENEWABLE_PRICING_POLICY.maximumCatalogAgeMs, deadline) ||
      !validWindow(fee.verifiedAt, fee.validUntil, now, RENEWABLE_PRICING_POLICY.maximumFeeAgeMs, deadline) ||
      Date.parse(receipt.validUntil) > Date.parse(fee.validUntil) || Date.parse(fee.verifiedAt) > Date.parse(receipt.verifiedAt)) return reject();
  return { digest: digestJson(receipt), evidence: receipt };
}
export function verifyCatalogRecord(value: unknown): { catalogDigest: string } {
  const response = z.object({ data: z.array(z.object({ id: z.string() }).passthrough()).max(1000) }).parse(value);
  const matches = response.data.filter(model => model.id === RENEWABLE_PRICING_POLICY.modelId);
  if (matches.length !== 1) throw Error('catalog_mismatch');
  const model = z.object({ id: z.literal(RENEWABLE_PRICING_POLICY.modelId), context_length: z.literal(262144), quantization: z.literal('fp4'),
    pricing: z.record(z.string(), z.union([z.string().regex(/^\d+(?:\.\d+)?$/), z.number().finite().nonnegative(), z.null()])) }).parse(matches[0]);
  const expected: Record<string, number | null> = { prompt: 0.0000003, completion: 0.0000009, request: 0,
    image: 0, price_per_video_second: 0, price_per_minute: 0, input_cache_read: null };
  if (Object.keys(model.pricing).some(key => !(key in expected)) || Object.keys(expected).some(key =>
      expected[key] === null ? model.pricing[key] !== null : model.pricing[key] === null || model.pricing[key] === undefined ||
        Number(model.pricing[key]) !== expected[key])) throw Error('catalog_mismatch');
  return { catalogDigest: digestJson(matches[0]) };
}
export function makePricingReceipt(catalog: unknown, feeValue: unknown, bindings: PricingBindings, now = Date.now()): RenewablePricingReceipt {
  const fee = FeeEvidenceSchema.parse(feeValue), { catalogDigest } = verifyCatalogRecord(catalog);
  const validUntil = Math.min(now + RENEWABLE_PRICING_POLICY.maximumCatalogAgeMs, Date.parse(fee.validUntil), Date.parse(bindings.approvalExpiresAt));
  const receipt = RenewablePricingReceiptSchema.parse({ schemaVersion: '1.0', policyDigest: RENEWABLE_PRICING_POLICY_DIGEST, sourceDigest: bindings.sourceDigest, budgetDigest: bindings.budgetDigest, verifiedAt: new Date(now).toISOString(), validUntil: new Date(validUntil).toISOString(), catalogDigest,
    modelId: RENEWABLE_PRICING_POLICY.modelId, contextTokens: 262144, quantization: 'fp4',
    inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 0.9, requestFeeUsd: 0, feeEvidence: fee });
  verifyRenewablePricing({ status: 'verified', receipt }, bindings, now + 600_000, now);
  return receipt;
}
