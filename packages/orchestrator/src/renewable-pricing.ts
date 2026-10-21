import { z } from 'zod';
import { digestJson } from '../../contracts/src/digest.ts';
import { usdToMicros } from './budget-ledger.ts';
import { ContractError } from '../../contracts/src/index.ts';

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const RENEWABLE_PRICING_POLICY = Object.freeze({
  id: 'token-factory-renewable-pricing-v3',
  catalogEndpoint: 'https://api.tokenfactory.nebius.com/v1/models?verbose=true',
  modelId: 'nvidia/nemotron-3-super-120b-a12b', contextTokens: 262144, quantization: 'fp4',
  maximumCalls: 3, maximumOutputTokensPerCall: 4000, requestFeeUsd: 0,
  inputAccounting: 'maximum-ordinary-and-cache-rate-full-context',
  rateRounding: 'ceil-microdollars-per-million-then-ceil-each-request',
  maximumCatalogAgeMs: 70 * 60 * 1000, maximumFeeAgeMs: 24 * 60 * 60 * 1000,
  maximumTotalUsd: 25, perRunReservationUsd: 0.25,
});
export const RENEWABLE_PRICING_POLICY_DIGEST = digestJson(RENEWABLE_PRICING_POLICY);
export const PricingRatesSchema = z.object({
  inputUsdPerMillionTokens: z.number().finite().nonnegative(),
  outputUsdPerMillionTokens: z.number().finite().nonnegative(), requestFeeUsd: z.literal(0),
});
export type PricingRates = z.infer<typeof PricingRatesSchema>;
export function conservativePricingBoundMicros(value: unknown): bigint {
  const rates = PricingRatesSchema.parse(value);
  const perCall = (BigInt(RENEWABLE_PRICING_POLICY.contextTokens) * usdToMicros(rates.inputUsdPerMillionTokens, 'ceil') +
    BigInt(RENEWABLE_PRICING_POLICY.maximumOutputTokensPerCall) * usdToMicros(rates.outputUsdPerMillionTokens, 'ceil') + 999_999n) / 1_000_000n;
  return BigInt(RENEWABLE_PRICING_POLICY.maximumCalls) * perCall;
}
export function assertPricingFitsReservation(value: unknown): PricingRates {
  const rates = PricingRatesSchema.parse(value);
  if (conservativePricingBoundMicros(rates) > usdToMicros(RENEWABLE_PRICING_POLICY.perRunReservationUsd)) throw Error('pricing_exceeds_reservation');
  return rates;
}
// Parse catalog decimals exactly, rounding UP to the ledger's rate precision.
// No binary floating-point multiplication may round a tiny positive price to zero.
function catalogRate(value: string | number): number {
  const text = String(value), match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match) throw Error('catalog_mismatch');
  const fractional = match[2] ?? '', exponent = Number(match[3] ?? 0) - fractional.length + 12;
  const coefficient = BigInt(match[1]! + fractional);
  const micros = exponent >= 0 ? coefficient * 10n ** BigInt(exponent) :
    (coefficient + 10n ** BigInt(-exponent) - 1n) / 10n ** BigInt(-exponent);
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('catalog_mismatch');
  return Number(micros) / 1_000_000;
}
export const FeeEvidenceSchema = z.strictObject({ schemaVersion: z.literal('1.0'),
  verifiedAt: z.iso.datetime(), validUntil: z.iso.datetime(), evidenceDigest: hash,
  accountBillingActive: z.literal(true), additionalFeeUsdPerRun: z.literal(0),
  basis: z.literal('operator-reviewed-account-pricing-and-fees'),
});
export const RenewablePricingReceiptSchema = z.strictObject({ schemaVersion: z.literal('1.0'),
  policyDigest: hash, sourceDigest: hash, budgetDigest: hash,
  verifiedAt: z.iso.datetime(), validUntil: z.iso.datetime(), catalogDigest: hash,
  modelId: z.literal('nvidia/nemotron-3-super-120b-a12b'), contextTokens: z.literal(262144), quantization: z.literal('fp4'),
  ...PricingRatesSchema.shape,
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
  try { assertPricingFitsReservation(receipt); } catch { return reject(); }
  if (receipt.policyDigest !== RENEWABLE_PRICING_POLICY_DIGEST || receipt.sourceDigest !== bindings.sourceDigest ||
      receipt.budgetDigest !== bindings.budgetDigest || !Number.isFinite(Date.parse(bindings.approvalExpiresAt)) ||
      deadline > Date.parse(bindings.approvalExpiresAt) || Date.parse(receipt.validUntil) > Date.parse(bindings.approvalExpiresAt) ||
      !validWindow(receipt.verifiedAt, receipt.validUntil, now, RENEWABLE_PRICING_POLICY.maximumCatalogAgeMs, deadline) ||
      !validWindow(fee.verifiedAt, fee.validUntil, now, RENEWABLE_PRICING_POLICY.maximumFeeAgeMs, deadline) ||
      Date.parse(receipt.validUntil) > Date.parse(fee.validUntil) || Date.parse(fee.verifiedAt) > Date.parse(receipt.verifiedAt)) return reject();
  return { digest: digestJson(receipt), evidence: receipt };
}
export function verifyCatalogRecord(value: unknown): { catalogDigest: string; rates: PricingRates } {
  const response = z.object({ data: z.array(z.object({ id: z.string() }).passthrough()).max(1000) }).parse(value);
  const matches = response.data.filter(model => model.id === RENEWABLE_PRICING_POLICY.modelId);
  if (matches.length !== 1) throw Error('catalog_mismatch');
  const price = z.union([z.string().max(64).regex(/^\d+(?:\.\d+)?$/), z.number().finite().nonnegative()]);
  const model = z.object({ id: z.literal(RENEWABLE_PRICING_POLICY.modelId), context_length: z.literal(262144), quantization: z.literal('fp4'),
    pricing: z.strictObject({ prompt: price, completion: price, input_cache_read: price.nullable(),
      request: price, image: price, price_per_video_second: price, price_per_minute: price }) }).parse(matches[0]);
  const p = model.pricing;
  // These billing dimensions are unsupported, even when a token-only bound would fit.
  if ([p.request, p.image, p.price_per_video_second, p.price_per_minute].some(value => catalogRate(value) !== 0)) throw Error('catalog_mismatch');
  const rates = assertPricingFitsReservation({
    inputUsdPerMillionTokens: Math.max(catalogRate(p.prompt), p.input_cache_read === null ? 0 : catalogRate(p.input_cache_read)),
    outputUsdPerMillionTokens: catalogRate(p.completion), requestFeeUsd: 0,
  });
  return { catalogDigest: digestJson(matches[0]), rates };
}
export function makePricingReceipt(catalog: unknown, feeValue: unknown, bindings: PricingBindings, now = Date.now()): RenewablePricingReceipt {
  const fee = FeeEvidenceSchema.parse(feeValue), { catalogDigest, rates } = verifyCatalogRecord(catalog);
  const validUntil = Math.min(now + RENEWABLE_PRICING_POLICY.maximumCatalogAgeMs, Date.parse(fee.validUntil), Date.parse(bindings.approvalExpiresAt));
  const receipt = RenewablePricingReceiptSchema.parse({ schemaVersion: '1.0', policyDigest: RENEWABLE_PRICING_POLICY_DIGEST, sourceDigest: bindings.sourceDigest, budgetDigest: bindings.budgetDigest, verifiedAt: new Date(now).toISOString(), validUntil: new Date(validUntil).toISOString(), catalogDigest,
    modelId: RENEWABLE_PRICING_POLICY.modelId, contextTokens: 262144, quantization: 'fp4',
    ...rates, feeEvidence: fee });
  verifyRenewablePricing({ status: 'verified', receipt }, bindings, now + 600_000, now);
  return receipt;
}
