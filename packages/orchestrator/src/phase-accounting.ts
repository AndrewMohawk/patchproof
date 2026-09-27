import { DatabaseSync } from 'node:sqlite';
import { closeSync, constants, lstatSync, openSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { digestJson } from '../../contracts/src/digest.ts';
import { measuredUsdToMicros } from './accounting-receipts.ts';

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Handle = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const Usd = z.string().regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,18})?$/);
const Amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Handles = z.array(Handle).max(1000).refine(ids => new Set(ids).size === ids.length, 'Duplicate operation identity.');
const atoms = (value: string) => { const [whole, fraction = ''] = Usd.parse(value).split('.');
  return BigInt(whole!) * 10n ** 18n + BigInt((fraction + '0'.repeat(18)).slice(0, 18)); };
// Interpret a numeric lower bound through its decimal serialization, including exponent notation.
// If it is below receipt precision, round the bound up rather than silently discarding it.
const lowerBoundAtoms = (value: number) => {
  const [mantissa, exponent = '0'] = Amount.parse(value).toString().split('e');
  const [whole, fraction = ''] = mantissa!.split('.'), digits = BigInt(whole! + fraction);
  const power = 18 + Number(exponent) - fraction.length;
  if (power >= 0) return digits * 10n ** BigInt(power);
  const divisor = 10n ** BigInt(-power); return (digits + divisor - 1n) / divisor;
};
export const PhaseAccountingBindingSchema = z.strictObject({
  executionMode: z.enum(['live', 'synthetic']), phase: z.enum(['runtime', 'adjudication']),
  dispatchId: z.uuid(), episodeId: z.string().min(1).max(300), reservationId: z.uuid(), reservationFingerprint: Digest,
  stage: z.enum(['pilot', 'evaluate']), reservedMicros: z.string().regex(/^(0|[1-9][0-9]*)$/)
    .refine(value => BigInt(value) <= 9_223_372_036_854_775_807n),
  sourceDigest: Digest, planDigest: Digest, modelLockDigest: Digest.nullable(), policyDigest: Digest,
}).refine(value => value.reservationId === value.dispatchId, 'Reservation must identify this dispatch.')
  .refine(value => value.executionMode !== 'live' || value.modelLockDigest !== null, 'Live accounting requires a model lock.');
export const PhaseAccountingRequestSchema = z.strictObject({
  binding: PhaseAccountingBindingSchema, checkpointDigest: Digest, operationIds: Handles,
  observedCpuLowerBound: Amount.nullable(), observedCostLowerBoundUsd: Amount.nullable(),
});
export type PhaseAccountingRequest = z.infer<typeof PhaseAccountingRequestSchema>;
export interface PhaseAccountingObservation {
  receiptDigest: string | null; checkpointDigest: string | null;
  measuredCostUsd: number | null; sandboxCpuSeconds: number | null;
  billingComplete: boolean; cpuComplete: boolean; inventoryComplete: boolean; cleanupComplete: boolean; retentionFinal: boolean;
  coveredOperationIds: string[];
}
export type PhaseAccountingObserver = (request: PhaseAccountingRequest, signal: AbortSignal) => Promise<PhaseAccountingObservation>;
export const PhaseAccountingReceiptSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), kind: z.literal('phase-accounting-observation'), id: Id,
  revision: z.number().int().positive().safe(), previousReceiptDigest: Digest.nullable(),
  binding: PhaseAccountingBindingSchema, checkpointDigest: Digest,
  scope: z.literal('cumulative_within_phase_including_setup_retries_cleanup_retention'),
  inventory: z.strictObject({ operationIds: Handles, unresolvedOperationIds: Handles, complete: z.boolean(), evidenceDigest: Digest.nullable() }),
  cleanup: z.strictObject({ complete: z.boolean(), evidenceDigest: Digest.nullable() }),
  retention: z.strictObject({ final: z.boolean(), evidenceDigest: Digest.nullable() }),
  billing: z.strictObject({ currency: z.literal('USD').nullable(), cumulativeUsd: Usd.nullable(), complete: z.boolean(), evidenceDigest: Digest.nullable() }),
  cpu: z.strictObject({ cumulativeSeconds: Amount.nullable(), complete: z.boolean(), evidenceDigest: Digest.nullable() }),
  observedThroughAt: z.iso.datetime(), issuedAt: z.iso.datetime(), validUntil: z.iso.datetime(),
}).superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const { inventory, cleanup, retention, billing, cpu } = value;
  if (inventory.unresolvedOperationIds.some(id => !inventory.operationIds.includes(id))) issue('Unresolved operation is absent from inventory.');
  if (inventory.complete && (inventory.unresolvedOperationIds.length || !inventory.evidenceDigest)) issue('Complete inventory requires resolved operations and evidence.');
  if (cleanup.complete && (!inventory.complete || !cleanup.evidenceDigest)) issue('Complete cleanup requires complete inventory and evidence.');
  if (retention.final && (!cleanup.complete || !retention.evidenceDigest)) issue('Final retention requires complete cleanup and evidence.');
  if ((billing.cumulativeUsd !== null || billing.complete) && (billing.currency !== 'USD' || billing.cumulativeUsd === null || !billing.evidenceDigest)) issue('Measured billing requires explicit cumulative USD and evidence.');
  if ((cpu.cumulativeSeconds !== null || cpu.complete) && (cpu.cumulativeSeconds === null || !cpu.evidenceDigest)) issue('Measured CPU requires cumulative seconds and evidence.');
  if (Date.parse(value.observedThroughAt) > Date.parse(value.issuedAt) || Date.parse(value.issuedAt) >= Date.parse(value.validUntil)) issue('Invalid observation window.');
});
export type PhaseAccountingReceipt = z.infer<typeof PhaseAccountingReceiptSchema>;
export const PhaseAccountingContextSchema = z.strictObject({
  expectedBinding: PhaseAccountingBindingSchema, expectedCheckpointDigest: Digest, expectedInventoryDigest: Digest,
  acceptedReceiptDigest: Digest, expectedHeadDigest: Digest.nullable(),
});
export const phaseInventoryDigest = (ids: string[]) => digestJson(Handles.parse(ids).slice().sort());
export const phaseAccountingReceiptDigest = (value: unknown) => digestJson(PhaseAccountingReceiptSchema.parse(value));
const key = (binding: PhaseAccountingRequest['binding']) => `${binding.dispatchId}:${binding.phase}`;
const complete = (value: PhaseAccountingObservation) => value.billingComplete && value.cpuComplete && value.inventoryComplete && value.cleanupComplete && value.retentionFinal;

function privateDatabase(filename: string, readOnly: boolean) {
  if (!isAbsolute(filename) || resolve(filename) !== filename) throw new Error('Phase journal requires a canonical absolute path.');
  const parent = dirname(filename), root = parse(parent).root; let current = root;
  for (const component of parent.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, component); const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Phase journal directories cannot use symlinks.');
  }
  const owner = (uid: number) => !process.getuid || uid === process.getuid();
  const directory = lstatSync(parent);
  if ((directory.mode & 0o077) || !owner(directory.uid)) throw new Error('Phase journal directory must be private and owned.');
  if (!readOnly) try { closeSync(openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  for (const path of [filename, filename + '-wal', filename + '-shm', filename + '-journal']) {
    try { const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) || !owner(stat.uid)) throw new Error('Phase journal files must be private owned regular files.');
    } catch (error) { if (path === filename || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
type Stored = { digest: string; body_json: string; revision: number };

/** Trusted metadata intake only. No ledger, dispatch or provider writes. A digest is not authenticity proof. */
export class PhaseAccountingStore {
  readonly #db: DatabaseSync; readonly #now: () => Date; readonly #readOnly: boolean;
  constructor(options: { filename: string; now?: () => Date; readOnly?: boolean }) {
    this.#now = options.now ?? (() => new Date()); this.#readOnly = options.readOnly ?? false;
    privateDatabase(options.filename, this.#readOnly); this.#db = new DatabaseSync(options.filename, { readOnly: this.#readOnly });
    try {
      this.#db.exec('PRAGMA busy_timeout=5000');
      if (!this.#readOnly) this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS phase_accounting_meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
        INSERT OR IGNORE INTO phase_accounting_meta VALUES(1,1);
        CREATE TABLE IF NOT EXISTS phase_requests(phase_key TEXT PRIMARY KEY,digest TEXT NOT NULL,body_json TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS phase_receipts(id TEXT PRIMARY KEY,digest TEXT UNIQUE NOT NULL,phase_key TEXT NOT NULL,revision INTEGER NOT NULL,body_json TEXT NOT NULL,
          accepted_at TEXT NOT NULL,UNIQUE(phase_key,revision));`);
      if (this.#db.prepare('SELECT version FROM phase_accounting_meta WHERE id=1').get()?.version !== 1) throw new Error('Unsupported phase accounting version.');
    } catch (error) { this.#db.close(); throw error; }
  }
  #time() { const date = this.#now(); if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Invalid phase accounting clock.'); return date.toISOString(); }
  #transaction<T>(fn: () => T): T {
    if (this.#readOnly) throw new Error('Read-only phase journal.');
    this.#db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #head(phaseKey: string) { return this.#db.prepare('SELECT digest,body_json,revision FROM phase_receipts WHERE phase_key=? ORDER BY revision DESC LIMIT 1').get(phaseKey) as Stored | undefined; }
  #receipt(row: Stored) {
    const value = PhaseAccountingReceiptSchema.parse(JSON.parse(row.body_json));
    if (digestJson(value) !== row.digest || value.revision !== row.revision) throw new Error('Stored phase receipt changed.'); return value;
  }
  recordRequest(raw: unknown) {
    const request = PhaseAccountingRequestSchema.parse(raw), digest = digestJson(request);
    this.#transaction(() => {
      const previous = this.#db.prepare('SELECT digest FROM phase_requests WHERE phase_key=?').get(key(request.binding));
      if (previous) { if (previous.digest !== digest) throw new Error('Phase request is immutable; no resume or changed checkpoint.'); return; }
      this.#db.prepare('INSERT INTO phase_requests VALUES(?,?,?,?)').run(key(request.binding), digest, JSON.stringify(request), this.#time());
    }); return { requestDigest: digest, executionAllowed: false as const };
  }
  requests() { return this.#db.prepare('SELECT digest,body_json,created_at FROM phase_requests ORDER BY created_at,phase_key').all().map(row => {
    const request = PhaseAccountingRequestSchema.parse(JSON.parse(String(row.body_json)));
    if (digestJson(request) !== row.digest) throw new Error('Stored phase request changed.');
    return { requestDigest: String(row.digest), request, createdAt: String(row.created_at) };
  }); }
  acceptObservation(raw: unknown, rawContext: unknown) {
    const receipt = PhaseAccountingReceiptSchema.parse(raw), context = PhaseAccountingContextSchema.parse(rawContext), digest = digestJson(receipt), now = this.#time();
    if (context.acceptedReceiptDigest !== digest || digestJson(receipt.binding) !== digestJson(context.expectedBinding) ||
      receipt.checkpointDigest !== context.expectedCheckpointDigest || phaseInventoryDigest(receipt.inventory.operationIds) !== context.expectedInventoryDigest) throw new Error('Independent accepted receipt context mismatch.');
    const status = this.#transaction(() => {
      const duplicate = this.#db.prepare('SELECT digest FROM phase_receipts WHERE id=?').get(receipt.id);
      if (duplicate) { if (duplicate.digest !== digest) throw new Error('Receipt ID is bound to different contents.'); return 'already_accepted' as const; }
      if (Date.parse(receipt.issuedAt) > Date.parse(now) || Date.parse(receipt.validUntil) <= Date.parse(now)) throw new Error('Phase receipt is future-dated or expired.');
      const row = this.#db.prepare('SELECT digest,body_json,created_at FROM phase_requests WHERE phase_key=?').get(key(receipt.binding));
      if (!row) throw new Error('Trusted runtime request required before phase intake.');
      const request = PhaseAccountingRequestSchema.parse(JSON.parse(String(row.body_json)));
      if (digestJson(request) !== row.digest || digestJson(request.binding) !== digestJson(receipt.binding) || request.checkpointDigest !== receipt.checkpointDigest ||
          phaseInventoryDigest(request.operationIds) !== phaseInventoryDigest(receipt.inventory.operationIds)) throw new Error('Receipt does not cover the exact pending request.');
      if (Date.parse(receipt.observedThroughAt) < Date.parse(String(row.created_at))) throw new Error('Receipt predates the final runtime checkpoint.');
      if (request.observedCpuLowerBound !== null && (receipt.cpu.cumulativeSeconds === null || receipt.cpu.cumulativeSeconds < request.observedCpuLowerBound)) throw new Error('Receipt discards observed CPU.');
      if (request.observedCostLowerBoundUsd !== null && (receipt.billing.cumulativeUsd === null || atoms(receipt.billing.cumulativeUsd) < lowerBoundAtoms(request.observedCostLowerBoundUsd))) throw new Error('Receipt discards observed USD.');
      const head = this.#head(key(receipt.binding));
      if ((head?.digest ?? null) !== context.expectedHeadDigest || receipt.previousReceiptDigest !== (head?.digest ?? null) || receipt.revision !== (head?.revision ?? 0) + 1) throw new Error('Stale phase head or noncontiguous revision.');
      if (head) {
        const prior = this.#receipt(head);
        if (digestJson(prior.binding) !== digestJson(receipt.binding)) throw new Error('Phase binding changed.');
        if (Date.parse(receipt.observedThroughAt) < Date.parse(prior.observedThroughAt) || Date.parse(receipt.issuedAt) < Date.parse(prior.issuedAt)) throw new Error('Phase time regressed.');
        if (prior.billing.cumulativeUsd !== null && (receipt.billing.cumulativeUsd === null || atoms(receipt.billing.cumulativeUsd) < atoms(prior.billing.cumulativeUsd))) throw new Error('Cumulative USD regressed.');
        if (prior.cpu.cumulativeSeconds !== null && (receipt.cpu.cumulativeSeconds === null || receipt.cpu.cumulativeSeconds < prior.cpu.cumulativeSeconds)) throw new Error('Cumulative CPU regressed.');
        if (prior.inventory.operationIds.some(id => !receipt.inventory.operationIds.includes(id))) throw new Error('Known operation disappeared.');
      }
      this.#db.prepare('INSERT INTO phase_receipts VALUES(?,?,?,?,?,?)').run(receipt.id, digest, key(receipt.binding), receipt.revision, JSON.stringify(receipt), now);
      return 'accepted' as const;
    });
    return { status, receiptDigest: digest, currentHeadDigest: this.#head(key(receipt.binding))!.digest, executionAllowed: false as const, authenticityVerified: false as const };
  }
  readObservedUsage(raw: unknown): PhaseAccountingObservation {
    const request = PhaseAccountingRequestSchema.parse(raw), head = this.#head(key(request.binding));
    const empty: PhaseAccountingObservation = { receiptDigest: null, checkpointDigest: null, measuredCostUsd: null, sandboxCpuSeconds: null,
      billingComplete: false, cpuComplete: false, inventoryComplete: false, cleanupComplete: false, retentionFinal: false, coveredOperationIds: [] };
    if (!head) return empty;
    const receipt = this.#receipt(head);
    if (digestJson(receipt.binding) !== digestJson(request.binding)) throw new Error('Phase binding mismatch.');
    // Different checkpoints, inventories or expired receipts can only contribute historical lower bounds.
    const current = Date.parse(receipt.validUntil) > Date.parse(this.#time()) && Date.parse(receipt.issuedAt) <= Date.parse(this.#time()) &&
      receipt.checkpointDigest === request.checkpointDigest && phaseInventoryDigest(receipt.inventory.operationIds) === phaseInventoryDigest(request.operationIds) &&
      (request.observedCpuLowerBound === null || (receipt.cpu.cumulativeSeconds !== null && receipt.cpu.cumulativeSeconds >= request.observedCpuLowerBound)) &&
      (request.observedCostLowerBoundUsd === null || (receipt.billing.cumulativeUsd !== null && atoms(receipt.billing.cumulativeUsd) >= lowerBoundAtoms(request.observedCostLowerBoundUsd)));
    const micros = receipt.billing.cumulativeUsd === null ? null : measuredUsdToMicros(receipt.billing.cumulativeUsd);
    if (micros !== null && micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('USD projection exceeds exact microdollar range.');
    return { receiptDigest: head.digest, checkpointDigest: receipt.checkpointDigest,
      measuredCostUsd: micros === null ? null : Number(micros) / 1_000_000, sandboxCpuSeconds: receipt.cpu.cumulativeSeconds,
      billingComplete: current && receipt.billing.complete, cpuComplete: current && receipt.cpu.complete,
      inventoryComplete: current && receipt.inventory.complete, cleanupComplete: current && receipt.cleanup.complete,
      retentionFinal: current && receipt.retention.final, coveredOperationIds: [...receipt.inventory.operationIds] };
  }
  history(binding: PhaseAccountingRequest['binding']) {
    return this.#db.prepare('SELECT id,digest,revision,accepted_at FROM phase_receipts WHERE phase_key=? ORDER BY revision').all(key(PhaseAccountingBindingSchema.parse(binding)));
  }
  close() { this.#db.close(); }
}

/** The caller supplies its remaining deadline. Waiting performs no paid work and grants no retry. */
export function createPhaseAccountingObserver(store: PhaseAccountingStore, pollIntervalMs = 250): PhaseAccountingObserver {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 1000) throw new Error('Invalid observation poll interval.');
  return async (raw, signal) => {
    const request = PhaseAccountingRequestSchema.parse(raw);
    signal.throwIfAborted(); store.recordRequest(request);
    for (;;) { signal.throwIfAborted(); const observation = store.readObservedUsage(request);
      if (complete(observation)) return observation;
      await delay(pollIntervalMs, undefined, { signal });
    }
  };
}
