import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, openSync, lstatSync, mkdirSync, chmodSync, constants } from 'node:fs';
import { dirname, isAbsolute, parse, join } from 'node:path';
import { z } from 'zod';
import { BudgetSchema } from '../../../scripts/config.ts';

const STAGES = ['smoke', 'pilot', 'evaluate', 'hosting'] as const;
export type BudgetStage = typeof STAGES[number];
type Budget = z.infer<typeof BudgetSchema>;
const MAX_SQL_INTEGER = 9_223_372_036_854_775_807n;
const MAX_RESERVATIONS = 10_000;
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const microdollars = z.union([z.bigint(), z.number().int().nonnegative().refine(Number.isSafeInteger)])
  .transform(value => BigInt(value)).refine(value => value >= 0n && value <= MAX_SQL_INTEGER, 'Microdollars must fit a nonnegative SQLite integer.');
const ReserveSchema = z.strictObject({ id: identifier, episodeId: identifier, stage: z.enum(STAGES),
  amountMicros: microdollars.refine(value => value > 0n, 'A positive bounded reservation is required.'), fingerprint: digest });
const ReconcileSchema = z.strictObject({ id: identifier, actualCostMicros: microdollars.nullable(),
  complete: z.boolean(), evidenceDigest: digest }).refine(value => !value.complete || value.actualCostMicros !== null, 'Complete billing requires a measured cost, including explicit zero.');

export class BudgetLedgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'BudgetLedgerError'; this.code = code; }
}
const fail = (code: string, message: string): never => { throw new BudgetLedgerError(code, message); };
const fingerprint = (value: unknown) => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Exact decimal conversion; sub-microdollar values require an explicit rounding choice.
 * Approval caps use reject. Measured provider totals can explicitly round upward with ceil. */
export function usdToMicros(value: number, rounding: 'reject' | 'ceil' = 'reject'): bigint {
  if (rounding !== 'reject' && rounding !== 'ceil') return fail('invalid_amount', 'Unsupported USD rounding choice.');
  if (!Number.isFinite(value) || value < 0) return fail('invalid_amount', 'USD amount must be finite and nonnegative.');
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match) return fail('invalid_amount', 'Unsupported decimal USD amount.');
  const decimals = match[2] ?? '', exponent = Number(match[3] ?? 0) - decimals.length + 6;
  const coefficient = BigInt(match[1]! + decimals);
  let result: bigint;
  if (exponent >= 0) result = coefficient * 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent), remainder = coefficient % divisor;
    if (remainder && rounding === 'reject') return fail('invalid_amount', 'Approval amounts must be exact whole microdollars.');
    result = coefficient / divisor + (remainder ? 1n : 0n);
  }
  if (result > MAX_SQL_INTEGER) return fail('invalid_amount', 'USD amount exceeds the supported integer range.');
  return result;
}

interface Policy {
  budget: Budget; digest: string; total: bigint; stages: Record<BudgetStage,bigint>;
}
function policy(value: unknown): Policy {
  const budget = BudgetSchema.parse(value);
  return { budget, digest: fingerprint(budget), total: usdToMicros(budget.maxApprovedSpendUsd),
    stages: Object.fromEntries(STAGES.map(stage => [stage,usdToMicros(budget.stages[stage])])) as Record<BudgetStage,bigint> };
}
function prepareFile(filename: string) {
  if (!isAbsolute(filename)) fail('invalid_path', 'Budget ledger requires an absolute durable file path.');
  const parent = dirname(filename), root = parse(parent).root;
  let current = root;
  for (const component of parent.slice(root.length).split('/').filter(Boolean)) {
    current = join(current,component);
    try { mkdirSync(current,{ mode:0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('invalid_path','Budget ledger directory must not use symlinks.');
  }
  try { closeSync(openSync(filename,constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,0o600)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  for (const path of [filename,filename+'-wal',filename+'-shm',filename+'-journal']) {
    try {
      const entry = lstatSync(path);
      if (!entry.isFile() || entry.isSymbolicLink() || (process.getuid && entry.uid !== process.getuid())) fail('invalid_path','Budget ledger files must be owned regular files, without symlinks.');
      chmodSync(path,0o600);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

type Row = Record<string,unknown>;
interface Meta { revision: number; digest: string; policy: Policy; frozenReason: string | null; }
export interface ReservationView {
  id: string; episodeId: string; stage: BudgetStage; fingerprint: string;
  reservedMicros: string; actualCostMicros: string | null; heldMicros: string; committedMicros: string;
  state: 'reserved' | 'attempted' | 'cancelled' | 'reconciled'; attemptedAt: string | null;
  reconciliationComplete: boolean; evidenceDigest: string | null; createdAt: string; updatedAt: string;
}
interface Totals { charged: bigint; held: bigint; committed: bigint; }
interface Accounting { total: Totals; stages: Record<BudgetStage,Totals>; pending: number; count: number; }
export interface BudgetSnapshot {
  currency: 'USD'; unit: 'microdollar'; approvalRevision: number; approvalDigest: string;
  connectionApprovalCurrent: boolean; approvalExpiresAt: string | null; frozen: boolean; freezeReasons: string[];
  approvedMicros: string; chargedMicros: string; heldMicros: string; committedMicros: string; availableMicros: string;
  pendingBillingCount: number; reservationCount: number; verifiedCreditsAppliedMicros: '0';
  stages: Record<BudgetStage,{ approvedMicros:string; chargedMicros:string; heldMicros:string; committedMicros:string; availableMicros:string }>;
}

/** Trusted control-plane ledger only. A reservation is an entire episode's aggregate ceiling.
 * Dispatch only when markAttempted().dispatchGranted is true; never infer permission from a read
 * or an idempotent reserve response. This module makes no provider calls or credit assumptions.
 * Unknown billing blocks other dispatches. Cancellation retains holds until explicit reconciliation.
 * Overrun freezes are sticky; this API deliberately has no automatic thaw or refund operation.
 * syncApproval is an explicit trusted-coordinator CAS, not automatic timestamp-based permission.
 * Provider/entitlement attestations and token/CPU limits must also be checked by the caller. */
export class BudgetLedger {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;
  #revision = 0;
  #approvalDigest: string;

  constructor(options: { filename: string; budget: unknown; now?: () => Date }) {
    const configured = policy(options.budget);
    prepareFile(options.filename);
    this.#now = options.now ?? (() => new Date());
    this.#approvalDigest = configured.digest;
    this.#db = new DatabaseSync(options.filename);
    try {
      this.#db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      this.#db.exec(`CREATE TABLE IF NOT EXISTS budget_meta (
        id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL CHECK(schema_version=1),
        approval_revision INTEGER NOT NULL, approval_digest TEXT NOT NULL, approval_json TEXT NOT NULL,
        frozen_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS budget_reservations (
        id TEXT PRIMARY KEY, episode_id TEXT UNIQUE NOT NULL, stage TEXT NOT NULL CHECK(stage IN ('smoke','pilot','evaluate','hosting')),
        amount_micros INTEGER NOT NULL CHECK(amount_micros>0), fingerprint TEXT NOT NULL, request_digest TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('reserved','attempted','cancelled','reconciled')), attempted_at TEXT,
        actual_micros INTEGER CHECK(actual_micros>=0), reconciliation_complete INTEGER NOT NULL CHECK(reconciliation_complete IN (0,1)),
        evidence_digest TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS budget_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, kind TEXT NOT NULL,
        reservation_id TEXT, approval_revision INTEGER NOT NULL, payload TEXT NOT NULL);`);
      this.#transaction(() => {
        const existing = this.#row('SELECT * FROM budget_meta WHERE id=1');
        if (!existing) {
          const now = this.#timestamp();
          this.#db.prepare('INSERT INTO budget_meta VALUES(1,1,1,?,?,NULL,?,?)').run(configured.digest,JSON.stringify(configured.budget),now,now);
          this.#revision = 1;
          this.#event('approval_initialized',null,{ approvalDigest:configured.digest,approvedMicros:String(configured.total) });
        } else {
          if (existing.approval_digest !== configured.digest) fail('approval_mismatch','Configured budget disagrees with durable approval; trusted synchronization is required.');
          this.#revision = Number(existing.approval_revision);
        }
      });
    } catch (error) { this.#db.close(); throw error; }
  }

  #timestamp() {
    const now = this.#now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return fail('invalid_clock','A valid clock is required for spending approval.');
    return now.toISOString();
  }
  #row(sql: string, ...args: SQLInputValue[]): Row | undefined {
    const statement = this.#db.prepare(sql); statement.setReadBigInts(true);
    return statement.get(...args);
  }
  #rows(sql: string, ...args: SQLInputValue[]): Row[] {
    const statement = this.#db.prepare(sql); statement.setReadBigInts(true);
    return statement.all(...args);
  }
  #transaction<T>(operation: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #meta(): Meta {
    const row = this.#row('SELECT * FROM budget_meta WHERE id=1');
    if (!row || row.schema_version !== 1n) return fail('ledger_corrupt','Budget ledger metadata is unavailable or unsupported.');
    const current = policy(JSON.parse(String(row.approval_json)));
    if (current.digest !== row.approval_digest) return fail('ledger_corrupt','Budget approval digest mismatch.');
    const revision = Number(row.approval_revision);
    if (!Number.isSafeInteger(revision) || revision < 1) return fail('ledger_corrupt','Invalid durable approval revision.');
    return { revision,digest:current.digest,policy:current,frozenReason:row.frozen_reason as string|null };
  }
  #event(kind: string, id: string | null, payload: unknown) {
    this.#db.prepare('INSERT INTO budget_events(timestamp,kind,reservation_id,approval_revision,payload) VALUES(?,?,?,?,?)')
      .run(this.#timestamp(),kind,id,this.#meta().revision,JSON.stringify(payload));
  }
  #reservation(id: string): Row {
    return this.#row('SELECT * FROM budget_reservations WHERE id=?',identifier.parse(id)) ?? fail('reservation_not_found','Budget reservation not found.');
  }
  #view(row: Row): ReservationView {
    const amount = row.amount_micros as bigint, actual = row.actual_micros as bigint|null;
    const complete = row.reconciliation_complete === 1n, held = complete ? 0n : amount > (actual ?? 0n) ? amount-(actual ?? 0n) : 0n;
    return { id:String(row.id),episodeId:String(row.episode_id),stage:row.stage as BudgetStage,fingerprint:String(row.fingerprint),
      reservedMicros:String(amount),actualCostMicros:actual===null ? null : String(actual),heldMicros:String(held),committedMicros:String((actual??0n)+held),
      state:row.state as ReservationView['state'],attemptedAt:row.attempted_at as string|null,reconciliationComplete:complete,
      evidenceDigest:row.evidence_digest as string|null,createdAt:String(row.created_at),updatedAt:String(row.updated_at) };
  }
  #accounting(): Accounting {
    const rows = this.#rows('SELECT * FROM budget_reservations');
    const total: Totals = { charged:0n,held:0n,committed:0n };
    const stages = Object.fromEntries(STAGES.map(stage=>[stage,{ charged:0n,held:0n,committed:0n }])) as Record<BudgetStage,Totals>;
    let pending = 0;
    for (const row of rows) {
      const view = this.#view(row), charged = BigInt(view.actualCostMicros??'0'), held = BigInt(view.heldMicros), committed = charged+held;
      for (const bucket of [total,stages[view.stage]]) { bucket.charged+=charged;bucket.held+=held;bucket.committed+=committed; }
      if ((view.attemptedAt!==null || view.evidenceDigest!==null) && !view.reconciliationComplete) pending++;
    }
    return { total,stages,pending,count:rows.length };
  }
  #reasons(meta: Meta, accounting: Accounting): string[] {
    const reasons: string[] = [], approval = meta.policy.budget.ownerApproval, now = Date.parse(this.#timestamp());
    if (meta.frozenReason) reasons.push(meta.frozenReason);
    if (!approval || meta.policy.total===0n) reasons.push('approval_missing');
    else {
      if (Date.parse(approval.approvedAt)>now) reasons.push('approval_not_yet_valid');
      if (approval.expiresAt!==null && Date.parse(approval.expiresAt)<=now) reasons.push('approval_expired');
    }
    if (meta.revision!==this.#revision || meta.digest!==this.#approvalDigest) reasons.push('approval_changed');
    if (accounting.total.committed>meta.policy.total || STAGES.some(stage=>accounting.stages[stage].committed>meta.policy.stages[stage])) reasons.push('approved_cap_below_commitment');
    if (accounting.pending) reasons.push('billing_pending');
    return reasons;
  }
  #assertReady(meta: Meta, accounting: Accounting) {
    const reasons = this.#reasons(meta,accounting);
    if (reasons.length) fail(reasons[0]!,`Budget dispatch blocked: ${reasons.join(', ')}.`);
  }

  reserve(value: unknown): { created: boolean; reservation: ReservationView } {
    const request = ReserveSchema.parse(value), requestDigest = fingerprint({ ...request,amountMicros:String(request.amountMicros) });
    return this.#transaction(() => {
      const existing = this.#row('SELECT * FROM budget_reservations WHERE id=?',request.id);
      if (existing) {
        if (existing.request_digest!==requestDigest) fail('idempotency_conflict','Reservation ID is bound to a different episode, amount, stage or fingerprint.');
        return { created:false,reservation:this.#view(existing) };
      }
      if (this.#row('SELECT id FROM budget_reservations WHERE episode_id=?',request.episodeId)) fail('episode_already_reserved','An episode has one immutable aggregate reservation; retries cannot obtain a new allowance.');
      const meta = this.#meta(), accounting = this.#accounting();
      this.#assertReady(meta,accounting);
      if (accounting.count>=MAX_RESERVATIONS) fail('reservation_limit','The bounded project episode-reservation limit has been reached.');
      if (accounting.total.committed+request.amountMicros>meta.policy.total || accounting.stages[request.stage].committed+request.amountMicros>meta.policy.stages[request.stage]) {
        fail('budget_exceeded','Reservation exceeds an approved aggregate or stage ceiling.');
      }
      const now = this.#timestamp();
      this.#db.prepare('INSERT INTO budget_reservations VALUES(?,?,?,?,?,?,?,NULL,NULL,0,NULL,?,?)')
        .run(request.id,request.episodeId,request.stage,request.amountMicros,request.fingerprint,requestDigest,'reserved',now,now);
      this.#event('reserved',request.id,{ episodeId:request.episodeId,stage:request.stage,amountMicros:String(request.amountMicros),fingerprint:request.fingerprint });
      return { created:true,reservation:this.#view(this.#reservation(request.id)) };
    });
  }

  markAttempted(id: string): { dispatchGranted: boolean; reservation: ReservationView } {
    return this.#transaction(() => {
      const row = this.#reservation(id);
      if (row.attempted_at!==null) return { dispatchGranted:false,reservation:this.#view(row) };
      if (row.state!=='reserved') fail('invalid_reservation_state','Cancelled or reconciled reservations cannot dispatch.');
      this.#assertReady(this.#meta(),this.#accounting());
      const now = this.#timestamp();
      this.#db.prepare("UPDATE budget_reservations SET state='attempted',attempted_at=?,updated_at=? WHERE id=?").run(now,now,id);
      this.#event('dispatch_attempted',id,{ billing:'unknown',reservationRetained:true });
      return { dispatchGranted:true,reservation:this.#view(this.#reservation(id)) };
    });
  }

  cancel(id: string): ReservationView {
    return this.#transaction(() => {
      const row = this.#reservation(id);
      if (row.state==='cancelled' || row.state==='reconciled') return this.#view(row);
      this.#db.prepare("UPDATE budget_reservations SET state='cancelled',updated_at=? WHERE id=?").run(this.#timestamp(),id);
      this.#event('cancelled',id,{ reservationRetained:true,requiresExplicitReconciliation:true });
      return this.#view(this.#reservation(id));
    });
  }

  reconcile(value: unknown): ReservationView {
    const reconciliation = ReconcileSchema.parse(value);
    return this.#transaction(() => {
      const row = this.#reservation(reconciliation.id), previous = row.actual_micros as bigint|null;
      if (previous!==null && (reconciliation.actualCostMicros===null || reconciliation.actualCostMicros<previous)) fail('charge_regression','Measured cumulative costs cannot be erased or reduced; credits require a separate reviewed process.');
      if (row.actual_micros===reconciliation.actualCostMicros && row.reconciliation_complete===(reconciliation.complete?1n:0n) && row.evidence_digest===reconciliation.evidenceDigest) return this.#view(row);
      const overrun = reconciliation.actualCostMicros!==null && reconciliation.actualCostMicros>(row.amount_micros as bigint);
      const unrecordedDispatch = row.attempted_at===null && (reconciliation.actualCostMicros??0n)>0n;
      if (overrun || unrecordedDispatch) {
        const reason = overrun ? 'reservation_overrun' : 'charge_without_recorded_dispatch';
        this.#db.prepare('UPDATE budget_meta SET frozen_reason=COALESCE(frozen_reason,?),updated_at=? WHERE id=1').run(reason,this.#timestamp());
      }
      // Billing can become uncertain again without making a terminal episode dispatchable.
      const state = reconciliation.complete || row.state==='reconciled' ? 'reconciled' : row.state==='cancelled' ? 'cancelled' : row.attempted_at===null ? 'reserved' : 'attempted';
      this.#db.prepare('UPDATE budget_reservations SET actual_micros=?,reconciliation_complete=?,evidence_digest=?,state=?,updated_at=? WHERE id=?')
        .run(reconciliation.actualCostMicros,reconciliation.complete?1:0,reconciliation.evidenceDigest,state,this.#timestamp(),reconciliation.id);
      this.#event(reconciliation.complete?'billing_reconciled':'billing_incomplete',reconciliation.id,
        { actualCostMicros:reconciliation.actualCostMicros===null?null:String(reconciliation.actualCostMicros),complete:reconciliation.complete,
          evidenceDigest:reconciliation.evidenceDigest,overrun,unrecordedDispatch });
      return this.#view(this.#reservation(reconciliation.id));
    });
  }

  /** Invoke only from the serialized trusted coordinator after reloading owner-authorized config.
   * Equal timestamps do not prove newer authority. Workers must never auto-sync cached config. */
  syncApproval(value: unknown, options: { expectedRevision: number }): BudgetSnapshot {
    const next = policy(value), expected = z.strictObject({ expectedRevision:z.number().int().positive().safe() }).parse(options).expectedRevision;
    const revision = this.#transaction(() => {
      const current = this.#meta();
      if (current.revision!==expected) fail('approval_revision_conflict','Durable approval changed; reload before explicit trusted synchronization.');
      if (current.digest===next.digest) return current.revision;
      if (next.budget.ownerApproval && current.policy.budget.ownerApproval && Date.parse(next.budget.ownerApproval.approvedAt)<Date.parse(current.policy.budget.ownerApproval.approvedAt)) fail('older_approval','An older owner approval cannot replace the durable approval.');
      const revision = current.revision+1;
      if (!Number.isSafeInteger(revision)) fail('ledger_corrupt','Approval revision limit reached.');
      this.#db.prepare('UPDATE budget_meta SET approval_revision=?,approval_digest=?,approval_json=?,updated_at=? WHERE id=1')
        .run(revision,next.digest,JSON.stringify(next.budget),this.#timestamp());
      this.#event('approval_synchronized',null,{ previousRevision:current.revision,approvalDigest:next.digest,approvedMicros:String(next.total),authority:'explicit_trusted_coordinator_cas' });
      return revision;
    });
    this.#revision=revision;this.#approvalDigest=next.digest;
    return this.snapshot();
  }

  get(id: string): ReservationView { return this.#view(this.#reservation(id)); }
  snapshot(): BudgetSnapshot {
    return this.#transaction(() => {
      const meta = this.#meta(), accounting = this.#accounting(), reasons = this.#reasons(meta,accounting);
      const remaining = (cap:bigint,used:bigint) => String(cap>used?cap-used:0n);
      return { currency:'USD',unit:'microdollar',approvalRevision:meta.revision,approvalDigest:meta.digest,
        connectionApprovalCurrent:meta.revision===this.#revision && meta.digest===this.#approvalDigest,
        approvalExpiresAt:meta.policy.budget.ownerApproval?.expiresAt??null,frozen:reasons.length>0,freezeReasons:reasons,
        approvedMicros:String(meta.policy.total),chargedMicros:String(accounting.total.charged),heldMicros:String(accounting.total.held),committedMicros:String(accounting.total.committed),
        availableMicros:remaining(meta.policy.total,accounting.total.committed),pendingBillingCount:accounting.pending,reservationCount:accounting.count,verifiedCreditsAppliedMicros:'0',
        stages:Object.fromEntries(STAGES.map(stage=>[stage,{ approvedMicros:String(meta.policy.stages[stage]),chargedMicros:String(accounting.stages[stage].charged),
          heldMicros:String(accounting.stages[stage].held),committedMicros:String(accounting.stages[stage].committed),availableMicros:remaining(meta.policy.stages[stage],accounting.stages[stage].committed) }])) as BudgetSnapshot['stages'] };
    });
  }
  events(afterSequence = 0, limit = 1000) {
    const query = z.strictObject({ afterSequence:z.number().int().nonnegative().safe(),limit:z.number().int().min(1).max(1000) }).parse({afterSequence,limit});
    return this.#rows('SELECT * FROM budget_events WHERE sequence>? ORDER BY sequence LIMIT ?',query.afterSequence,query.limit).map(row=>({
      sequence:Number(row.sequence),timestamp:String(row.timestamp),kind:String(row.kind),reservationId:row.reservation_id as string|null,
      approvalRevision:Number(row.approval_revision),details:JSON.parse(String(row.payload)) as Record<string,unknown> }));
  }
  close() { this.#db.close(); }
}
