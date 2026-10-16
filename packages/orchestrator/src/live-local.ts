import { mkdirSync, writeFileSync, openSync, closeSync, fsyncSync, constants } from 'node:fs';
import { join } from 'node:path';
import { ContractError, LimitsSchema } from '../../contracts/src/index.ts';
import { digestJson } from '../../contracts/src/digest.ts';
import type { CheckRunner, Fixture, ProductRun } from '../../contracts/src/product.ts';
import { NebiusRepairProvider } from '../../../workers/repair/index.ts';
import type { InferenceReceipt } from '../../../workers/repair/index.ts';
import { BudgetLedger, usdToMicros } from './budget-ledger.ts';
import { Coordinator } from './coordinator.ts';
import { RepeatedCheckRunner, runnerForLocalScheduling } from './repeated-checks.ts';
import type { RunJournal } from './journal.ts';
import type { EvidenceStore } from './evidence.ts';

export const LIVE_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
export const LIVE_EXECUTION = Object.freeze({ modelProvider: 'nebius-token-factory', checkBackend: 'local_container', modelId: LIVE_MODEL });
export const LIVE_LIMITS = Object.freeze(LimitsSchema.parse({ inferenceCallLimit: 3, inputTokenLimit: 786432,
  outputTokenLimit: 12000, wallTimeLimitSeconds: 600, sandboxCpuSecondsLimit: 900, maxApprovedSpendUsd: 0.25 }));
export const LIVE_RESERVATION_MICROS = usdToMicros(LIVE_LIMITS.maxApprovedSpendUsd);
export const LIVE_PRICING = Object.freeze({ inputUsdPerMillionTokens: 0.3, outputUsdPerMillionTokens: 0.9,
  requestFeeUsd: 0, contextTokens: 262144, maximumOutputTokensPerRequest: 4000,
  inputAccounting: 'full-model-context-conservative-ceiling-per-request', actualBilling: 'unknown-full-reservation-held',
  verifiedAt: '2026-10-16T21:01:00Z', validUntil: '2026-10-17T21:00:00Z' });
export interface LiveLocalSettings {
  limits: typeof LIVE_LIMITS;
  beforeCreate: (id: string, fingerprint: string) => void;
  bindEventSink: (sink: (message: string) => void) => void;
  validateStep: () => void;
  terminal: (run: ProductRun) => void;
}
const capabilities = new WeakMap<object, LiveLocalSettings>();
export function resolveLiveLocalCapability(value: unknown): LiveLocalSettings | null {
  return value !== null && typeof value === 'object' ? capabilities.get(value) ?? null : null;
}

/** Trusted single-flight controller. No request can supply code, a model, limits or credentials.
 * This is real inference with local Docker checks, separately labeled from sponsor Sandboxes.
 * All unresolved charges retain the entire reservation, including failed/ambiguous dispatches. */
export function createLiveLocalCoordinator(input: {
  fixtures: Fixture[]; runtimeLock: unknown; sourceDigest: string; pricingEvidenceDigest: string;
  ledger: BudgetLedger; journal: RunJournal; store: EvidenceStore; checks: CheckRunner;
  credential: () => Promise<string>; fetch: typeof globalThis.fetch; verifyRuntime: () => void;
  accountingDirectory: string;
}) {
  if (!(input.ledger instanceof BudgetLedger) || input.ledger.snapshot().pendingBillingPolicy !== 'allow-covered-inference') {
    throw new ContractError('authorization_required', 'Reviewed durable inference accounting is required.', 403);
  }
  if (!input.fixtures.length || input.fixtures.some(f => f.split !== 'development')) throw new ContractError('unknown_task', 'Only curated development tasks may run publicly.');
  mkdirSync(input.accountingDirectory, { recursive: true, mode: 0o700 });
  type Active = { id: string; reservationId: string; fingerprint: string; intents: string[]; receipts: InferenceReceipt[];
    sink: ((message: string) => void) | null; attempted: boolean; closed: boolean };
  let active: Active | null = null;
  const persist = () => {
    if (!active) return;
    // Every revision is immutable; there is never a stored key or full response reasoning.
    const record = { ...active, sink: undefined, sourceDigest: input.sourceDigest, pricingEvidenceDigest: input.pricingEvidenceDigest };
    const digest = digestJson(JSON.parse(JSON.stringify(record)));
    const filename = join(input.accountingDirectory, `${active.id}-${digest.slice(7)}.json`);
    const fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify(record, null, 2)+'\n'); fsyncSync(fd); } finally { closeSync(fd); }
    const directory = openSync(input.accountingDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  };
  const validate = () => {
    input.verifyRuntime();
    if (Date.now() + LIVE_LIMITS.wallTimeLimitSeconds * 1000 > Date.parse(LIVE_PRICING.validUntil)) throw new ContractError('authorization_required', 'Model pricing verification needs refresh.', 403);
    const snapshot = input.ledger.snapshot();
    if (snapshot.approvalExpiresAt !== null &&
        Date.now() + LIVE_LIMITS.wallTimeLimitSeconds * 1000 > Date.parse(snapshot.approvalExpiresAt)) {
      throw new ContractError('authorization_required', 'The full run must fit within the approved spending window.', 403);
    }
    // The current in-flight call is intentionally pending. Every other pending
    // reservation must already have an immutable bounded closure attestation.
    const ownPending = active?.attempted && !active.closed ? 1 : 0;
    if (snapshot.freezeReasons.some(r => r !== 'billing_pending') || snapshot.blockingPendingBillingCount > ownPending) {
      throw new ContractError('budget_not_approved', 'Paid work is paused pending accounting review.', 403);
    }
  };
  const provider = new NebiusRepairProvider({ modelId: LIVE_MODEL, authorized: true, accountVerifiedAt: LIVE_PRICING.verifiedAt,
    inputUsdPerMillionTokens: LIVE_PRICING.inputUsdPerMillionTokens, outputUsdPerMillionTokens: LIVE_PRICING.outputUsdPerMillionTokens,
    // Omit the disabling override; hosted reasoning behavior remains unverified.
    maximumOutputTokens: LIVE_PRICING.maximumOutputTokensPerRequest, disableThinking: false,
    countInputTokens: () => LIVE_PRICING.contextTokens,
    credential: async () => { validate(); return input.credential(); },
    fetch: async (url, init) => { validate(); if (!active?.attempted || active.closed) throw new ContractError('authorization_required', 'Dispatch reservation is required.', 403); return input.fetch(url, init); },
    onOperation: operation => {
      if (!active || active.closed) throw new ContractError('authorization_required', 'No active bounded run.', 403);
      if (operation.kind === 'request_intent') {
        validate();
        if (active.intents.length >= LIVE_LIMITS.inferenceCallLimit) throw new ContractError('budget_not_approved', 'Call allowance exhausted.', 403);
        if (!active.attempted) {
          if (!input.ledger.markAttempted(active.reservationId).dispatchGranted) throw new ContractError('authorization_required', 'Dispatch already attempted.', 403);
          active.attempted = true;
        }
        active.intents.push(operation.id); persist();
      }
      active.sink?.(`Nebius model ${operation.kind}: ${operation.id}.`);
    },
    onReceipt: receipt => {
      if (!active || active.closed || !active.intents.includes(receipt.intentId) || active.receipts.some(r => r.intentId === receipt.intentId)) {
        throw new ContractError('infrastructure_error', 'Provider receipt does not match a unique dispatch.');
      }
      active.receipts.push(receipt); persist();
    },
  });
  const capability = Object.freeze({});
  capabilities.set(capability, {
    limits: LIVE_LIMITS,
    beforeCreate: (id, fingerprint) => {
      if (active && !active.closed) throw new ContractError('capacity_exceeded', 'One live run is already active.', 429);
      active = null; validate();
      const reservationId = `live-local:${id}`;
      try { input.ledger.reserve({ id: reservationId, episodeId: id, stage: 'smoke', amountMicros: LIVE_RESERVATION_MICROS, fingerprint }); }
      catch { throw new ContractError('budget_not_approved', 'The shared live-demo allowance is exhausted or paused.', 403); }
      active = { id, reservationId, fingerprint, intents: [], receipts: [], sink: null, attempted: false, closed: false }; persist();
    },
    bindEventSink: sink => { if (active) active.sink = sink; }, validateStep: validate,
    terminal: run => {
      if (!active || active.id !== run.id) throw new ContractError('infrastructure_error', 'Accounting run identity mismatch.');
      active.closed = true; persist();
      const evidenceDigest = digestJson({ runId: run.id, status: run.terminalStatus, usage: run.usage, events: run.events, operations: run.sandboxOperationIds });
      if (!active.attempted) {
        // The controller never handed a request to the provider; this is known zero.
        input.ledger.reconcile({ id: active.reservationId, actualCostMicros: 0n, complete: true, evidenceDigest });
      } else {
        input.ledger.reconcile({ id: active.reservationId, actualCostMicros: null, complete: false, evidenceDigest });
        if (active.intents.length === active.receipts.length && active.receipts.every(r => r.modelId === LIVE_MODEL)) {
          const reservation = input.ledger.get(active.reservationId);
          const requests = active.receipts.map(({ providerRequestId: _p, transportRequestId: _t, modelId: _m, ...r }) => r);
          input.ledger.coverPendingInference({ schemaVersion: '1.0', kind: 'closed-token-factory-inference-v1',
            reservationId: active.reservationId, episodeId: active.id, reservationFingerprint: active.fingerprint, stage: 'smoke',
            reservedMicros: reservation.reservedMicros, evidenceDigest, sourceDigest: input.sourceDigest,
            pricingEvidenceDigest: input.pricingEvidenceDigest, closureEvidenceDigest: digestJson(active.receipts), closedAt: new Date().toISOString(),
            endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions', modelId: LIVE_MODEL,
            inputMicrosPerMillionTokens: usdToMicros(LIVE_PRICING.inputUsdPerMillionTokens).toString(),
            outputMicrosPerMillionTokens: usdToMicros(LIVE_PRICING.outputUsdPerMillionTokens).toString(),
            requestFeeMicros: usdToMicros(LIVE_PRICING.requestFeeUsd).toString(),
            dispatchClosed: true, inventoryComplete: true, otherBillableOperations: 0, requests });
        }
      }
      // This number is explicitly an estimate. The ledger keeps actualCostMicros null.
      if (active.attempted && active.intents.length === active.receipts.length) {
        run.usage.measuredCostUsd = (run.usage.inputTokens * LIVE_PRICING.inputUsdPerMillionTokens +
          run.usage.outputTokens * LIVE_PRICING.outputUsdPerMillionTokens) / 1_000_000 +
          run.usage.inferenceCalls * LIVE_PRICING.requestFeeUsd;
        run.usage.costIsEstimate = true;
      }
    },
  });
  return new Coordinator({ fixtures: input.fixtures, runtimeLock: input.runtimeLock, provider,
    checks: new RepeatedCheckRunner(runnerForLocalScheduling(input.checks, input.runtimeLock)), journal: input.journal, store: input.store,
    verifyRuntime: input.verifyRuntime, liveLocalCapability: capability });
}
