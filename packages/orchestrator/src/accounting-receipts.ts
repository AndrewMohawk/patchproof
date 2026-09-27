import { createHash,randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync,closeSync,constants,lstatSync,mkdirSync,openSync } from 'node:fs';
import { dirname,isAbsolute,join,parse } from 'node:path';
import { z } from 'zod';
import { BudgetLedger } from './budget-ledger.ts';

const Id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const OperationId=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/);
const Digest=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Integer=z.string().regex(/^(0|[1-9][0-9]*)$/).refine(value=>BigInt(value)<=9_223_372_036_854_775_807n);
const Usd=z.string().regex(/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,18})?$/);
const usdAtoms=(value:string)=>{const[whole,fraction='']=Usd.parse(value).split('.');return BigInt(whole!)*10n**18n+BigInt((fraction+'0'.repeat(18)).slice(0,18));};
const hash=(value:unknown)=>'sha256:'+createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const AccountingBindingSchema=z.strictObject({reservationId:Id,episodeId:Id,reservationFingerprint:Digest,
  stage:z.enum(['smoke','pilot','evaluate','hosting']),reservedMicros:Integer,sourceDigest:Digest,planDigest:Digest.nullable()})
  .refine(value=>!['pilot','evaluate'].includes(value.stage)||value.planDigest!==null,'Experiment accounting requires its frozen plan digest.');
export type AccountingBinding=z.infer<typeof AccountingBindingSchema>;
const OperationSchema=z.strictObject({intentId:OperationId,operationId:OperationId.nullable(),status:z.enum(['terminal','confirmed_not_created','unknown','active']),evidenceDigest:Digest.nullable()})
  .superRefine((value,ctx)=>{
    if(value.status==='terminal'&&(!value.operationId||!value.evidenceDigest)||value.status==='confirmed_not_created'&&(value.operationId!==null||!value.evidenceDigest))ctx.addIssue({code:'custom',message:'Resolved operation requires matching identity and evidence.'});
  });
export const OperationManifestSchema=z.strictObject({inventoryComplete:z.boolean(),operations:z.array(OperationSchema).max(1000)})
  .superRefine((value,ctx)=>{
    const intents=value.operations.map(operation=>operation.intentId),operations=value.operations.flatMap(operation=>operation.operationId?[operation.operationId]:[]);
    if(new Set(intents).size!==intents.length||new Set(operations).size!==operations.length)ctx.addIssue({code:'custom',message:'Duplicate operation/intent identity.'});
  });
export const CleanupObservationSchema=z.strictObject({complete:z.boolean(),unresolvedIntentIds:z.array(OperationId).max(1000),evidenceDigest:Digest.nullable()})
  .refine(value=>new Set(value.unresolvedIntentIds).size===value.unresolvedIntentIds.length,'Duplicate unresolved intent.');
export const AccountingReceiptSchema=z.strictObject({schemaVersion:z.literal('1.0'),kind:z.literal('episode-accounting-reconciliation'),
  id:Id,revision:z.number().int().positive().safe(),previousReceiptDigest:Digest.nullable(),expectedLedgerEvidenceDigest:Digest.nullable(),
  binding:AccountingBindingSchema,operationDigest:Digest,cleanupDigest:Digest,
  operationManifest:OperationManifestSchema,cleanup:CleanupObservationSchema,
  observedThroughAt:z.iso.datetime(),issuedAt:z.iso.datetime(),validUntil:z.iso.datetime(),
  scope:z.literal('entire_episode_including_setup_retries_cleanup'),
  billing:z.strictObject({currency:z.literal('USD').nullable(),cumulativeUsd:Usd.nullable(),complete:z.boolean(),evidenceDigest:Digest.nullable()}),
  cpu:z.strictObject({cumulativeSeconds:z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),complete:z.boolean(),evidenceDigest:Digest.nullable()}),
}).superRefine((value,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(hash(value.operationManifest)!==value.operationDigest||hash(value.cleanup)!==value.cleanupDigest)issue('Operation or cleanup digest mismatch.');
  if(value.billing.cumulativeUsd!==null&&(value.billing.currency!=='USD'||value.billing.evidenceDigest===null))issue('Measured USD requires explicit USD and evidence.');
  if(value.billing.complete&&(value.billing.cumulativeUsd===null||value.billing.currency!=='USD'||value.billing.evidenceDigest===null))issue('Complete billing requires measured cumulative USD.');
  if(value.cpu.cumulativeSeconds!==null&&value.cpu.evidenceDigest===null||value.cpu.complete&&(value.cpu.cumulativeSeconds===null||value.cpu.evidenceDigest===null))issue('Measured CPU requires cumulative CPU evidence.');
  const unresolved=value.operationManifest.operations.filter(operation=>!['terminal','confirmed_not_created'].includes(operation.status));
  if(value.cleanup.complete&&(!value.operationManifest.inventoryComplete||unresolved.length||value.cleanup.unresolvedIntentIds.length||!value.cleanup.evidenceDigest))issue('Cleanup cannot complete with unknown, active or unaccounted intents.');
  if(Date.parse(value.observedThroughAt)>Date.parse(value.issuedAt)||Date.parse(value.issuedAt)>=Date.parse(value.validUntil))issue('Invalid accounting observation window.');
});
export type AccountingReceipt=z.infer<typeof AccountingReceiptSchema>;
export function operationManifestDigest(value:unknown){return hash(OperationManifestSchema.parse(value));}
export function cleanupObservationDigest(value:unknown){return hash(CleanupObservationSchema.parse(value));}
export function accountingReceiptDigest(value:unknown){return hash(AccountingReceiptSchema.parse(value));}

/** Decimal USD only: retain original receipt precision, round the ledger charge upward to a microdollar. */
export function measuredUsdToMicros(value:string):bigint{
  const [whole,fraction='']=Usd.parse(value).split('.');
  const result=BigInt(whole!)*1_000_000n+BigInt((fraction+'000000').slice(0,6))+(fraction.slice(6).replaceAll('0','')?1n:0n);
  if(result>9_223_372_036_854_775_807n)throw new Error('Measured USD exceeds ledger integer range.');return result;
}
function privateDatabase(filename:string){
  if(!isAbsolute(filename))throw new Error('Accounting importer requires an absolute private database path.');
  const parent=dirname(filename),root=parse(parent).root;let current=root;
  for(const component of parent.slice(root.length).split('/').filter(Boolean)){
    current=join(current,component);try{mkdirSync(current,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const stat=lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Accounting directory must not use symlinks.');
  }
  const parentStat=lstatSync(parent);if((parentStat.mode&0o077)!==0||(process.getuid&&parentStat.uid!==process.getuid()))throw new Error('Accounting directory must be private and owned.');
  try{closeSync(openSync(filename,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600));}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  for(const path of[filename,filename+'-wal',filename+'-shm',filename+'-journal']){try{const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||(process.getuid&&stat.uid!==process.getuid()))throw new Error('Accounting files must be owned regular files.');chmodSync(path,0o600);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
}
type Stored={id:string;digest:string;reservation_id:string;revision:number;body_json:string;status:'prepared'|'applied'|'rejected';reason:string|null};
const ContextSchema=z.strictObject({expectedBinding:AccountingBindingSchema,expectedOperationDigest:Digest,expectedCleanupDigest:Digest,acceptedReceiptDigests:z.array(Digest).min(1).max(1000)});
export type AccountingImportContext=z.infer<typeof ContextSchema>;

/** Trusted operator ingestion only. Digests establish consistency, never authenticity.
 * Uses a durable prepare/apply journal plus ledger evidence CAS; no provider/cleanup/dispatch callbacks. */
export class AccountingReceiptImporter{
  readonly #db:DatabaseSync;readonly #ledger:BudgetLedger;readonly #now:()=>Date;readonly #journalDigest:string;
  constructor(options:{filename:string;ledger:BudgetLedger;now?:()=>Date}){
    this.#ledger=options.ledger;this.#now=options.now??(()=>new Date());privateDatabase(options.filename);this.#db=new DatabaseSync(options.filename);
    try{
    this.#db.exec(`PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS accounting_registry(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,journal_digest TEXT NOT NULL,ledger_id TEXT);
      CREATE TABLE IF NOT EXISTS accounting_receipts(id TEXT PRIMARY KEY,digest TEXT UNIQUE NOT NULL,reservation_id TEXT NOT NULL,revision INTEGER NOT NULL,
        body_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('prepared','applied','rejected')),reason TEXT,prepared_at TEXT NOT NULL,applied_at TEXT,
        UNIQUE(reservation_id,revision));`);
    const registry=this.#transaction(()=>{
      const existing=this.#db.prepare('SELECT * FROM accounting_registry WHERE id=1').get();
      if(existing){if(existing.schema_version!==1)throw new Error('Unsupported accounting journal version.');return existing;}
      const journalDigest=hash({kind:'accounting_journal',id:randomUUID()});this.#db.prepare('INSERT INTO accounting_registry VALUES(1,1,?,NULL)').run(journalDigest);
      return{schema_version:1,journal_digest:journalDigest,ledger_id:null};
    });
    const ledgerId=this.#ledger.bindAccountingJournal(String(registry.journal_digest),registry.ledger_id===null?undefined:String(registry.ledger_id));
    this.#journalDigest=String(registry.journal_digest);
    this.#db.prepare('UPDATE accounting_registry SET ledger_id=? WHERE id=1').run(ledgerId);
    }catch(error){this.#db.close();throw error;}
  }
  #transaction<T>(fn:()=>T):T{this.#db.exec('BEGIN IMMEDIATE');try{const result=fn();this.#db.exec('COMMIT');return result;}catch(error){this.#db.exec('ROLLBACK');throw error;}}
  #time(){const value=this.#now();if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw new Error('Invalid accounting clock.');return value.toISOString();}
  #stored(id:string){return this.#db.prepare('SELECT * FROM accounting_receipts WHERE id=?').get(id) as unknown as Stored|undefined;}
  #validateBinding(receipt:AccountingReceipt){
    const reservation=this.#ledger.get(receipt.binding.reservationId),binding=receipt.binding;
    if(reservation.episodeId!==binding.episodeId||reservation.fingerprint!==binding.reservationFingerprint||reservation.stage!==binding.stage||reservation.reservedMicros!==binding.reservedMicros)throw new Error('Reservation binding mismatch.');
    if(Date.parse(receipt.observedThroughAt)<Date.parse(reservation.attemptedAt??reservation.createdAt))throw new Error('Accounting predates the reserved/attempted episode.');
    return reservation;
  }
  #validateLedger(receipt:AccountingReceipt){
    const reservation=this.#validateBinding(receipt);
    const amount=receipt.billing.cumulativeUsd===null?null:measuredUsdToMicros(receipt.billing.cumulativeUsd);
    if(reservation.actualCostMicros!==null&&(amount===null||amount<BigInt(reservation.actualCostMicros)))throw new Error('Accounting would discard known ledger charges.');
    return reservation;
  }
  #complete(receipt:AccountingReceipt){return receipt.billing.complete&&receipt.cpu.complete&&receipt.cleanup.complete&&receipt.operationManifest.inventoryComplete;}
  #anchor(receipt:AccountingReceipt,digest:string){this.#ledger.anchorAccountingReceipt({journalDigest:this.#journalDigest,reservationId:receipt.binding.reservationId,revision:receipt.revision,receiptDigest:digest,previousReceiptDigest:receipt.previousReceiptDigest});}
  #matchesApplied(receipt:AccountingReceipt,digest:string){
    const state=this.#ledger.get(receipt.binding.reservationId),amount=receipt.billing.cumulativeUsd===null?null:String(measuredUsdToMicros(receipt.billing.cumulativeUsd));
    return state.evidenceDigest===digest&&state.actualCostMicros===amount&&state.reconciliationComplete===this.#complete(receipt);
  }
  import(value:unknown,contextValue:unknown){
    const receipt=AccountingReceiptSchema.parse(value),context=ContextSchema.parse(contextValue),digest=hash(receipt),now=this.#time();
    if(!context.acceptedReceiptDigests.includes(digest))throw new Error('Receipt has not been accepted by trusted evidence ingestion.');
    if(hash(receipt.binding)!==hash(context.expectedBinding)||receipt.operationDigest!==context.expectedOperationDigest||receipt.cleanupDigest!==context.expectedCleanupDigest)throw new Error('Trusted source/plan/operation/cleanup binding mismatch.');
    const existing=this.#stored(receipt.id);
    if(existing&&existing.digest!==digest)throw new Error('Receipt ID is bound to different contents.');
    this.#validateBinding(receipt);
    if(existing?.status==='applied')return this.#result(receipt,digest,'already_applied');
    if(existing?.status==='rejected')throw new Error('Receipt was rejected; preserve it and issue the next reviewed revision.');
    // A post-ledger-commit crash needs only an idempotent journal completion, not renewed spending authority.
    const recovered=existing?.status==='prepared'&&this.#matchesApplied(receipt,digest);
    if(!recovered&&(Date.parse(receipt.issuedAt)>Date.parse(now)||Date.parse(receipt.validUntil)<=Date.parse(now)))throw new Error('Receipt is future-dated or expired.');
    this.#validateLedger(receipt);
    this.#transaction(()=>{
      const duplicate=this.#stored(receipt.id);if(duplicate){if(duplicate.digest!==digest)throw new Error('Receipt ID is bound to different contents.');return;}
      const previous=this.#db.prepare('SELECT * FROM accounting_receipts WHERE reservation_id=? ORDER BY revision DESC LIMIT 1').get(receipt.binding.reservationId) as unknown as Stored|undefined;
      if(previous?.status==='prepared')throw new Error('Previous prepared receipt requires reconciliation first.');
      if(receipt.revision!==(previous?.revision??0)+1||receipt.previousReceiptDigest!==(previous?.digest??null))throw new Error('Stale or noncontiguous accounting receipt revision.');
      if(previous){const prior=AccountingReceiptSchema.parse(JSON.parse(previous.body_json));
        if(hash(prior)!==previous.digest)throw new Error('Prior accounting receipt digest mismatch.');
        if(hash(prior.binding)!==hash(receipt.binding))throw new Error('Immutable source/plan/reservation binding changed.');
        if(Date.parse(receipt.observedThroughAt)<Date.parse(prior.observedThroughAt)||Date.parse(receipt.issuedAt)<Date.parse(prior.issuedAt))throw new Error('Accounting observation regressed.');
        if(prior.cpu.cumulativeSeconds!==null&&(receipt.cpu.cumulativeSeconds===null||receipt.cpu.cumulativeSeconds<prior.cpu.cumulativeSeconds))throw new Error('Cumulative CPU cannot decrease or become unknown.');
        if(prior.billing.cumulativeUsd!==null&&(receipt.billing.cumulativeUsd===null||usdAtoms(receipt.billing.cumulativeUsd)<usdAtoms(prior.billing.cumulativeUsd)))throw new Error('Cumulative USD cannot decrease or become unknown.');
        const known=new Map(receipt.operationManifest.operations.map(operation=>[operation.intentId,operation]));
        for(const operation of prior.operationManifest.operations){const next=known.get(operation.intentId);
          if(!next||operation.operationId!==null&&operation.operationId!==next.operationId)throw new Error('Known operation intent or remote identity disappeared.');
          if(['terminal','confirmed_not_created'].includes(operation.status)&&(operation.status!==next.status||operation.evidenceDigest!==next.evidenceDigest))throw new Error('Resolved operation proof cannot change or regress.');
        }
        if(prior.cleanup.unresolvedIntentIds.some(id=>!known.has(id)&&!receipt.cleanup.unresolvedIntentIds.includes(id)))throw new Error('Unresolved intent disappeared without an explicit outcome.');
      }
      this.#db.prepare('INSERT INTO accounting_receipts(id,digest,reservation_id,revision,body_json,status,prepared_at) VALUES(?,?,?,?,?,?,?)')
        .run(receipt.id,digest,receipt.binding.reservationId,receipt.revision,JSON.stringify(receipt),'prepared',now);
    });
    try{
      this.#anchor(receipt,digest);
      if(!this.#matchesApplied(receipt,digest))this.#ledger.reconcile({id:receipt.binding.reservationId,
        actualCostMicros:receipt.billing.cumulativeUsd===null?null:measuredUsdToMicros(receipt.billing.cumulativeUsd),complete:this.#complete(receipt),evidenceDigest:digest,expectedEvidenceDigest:receipt.expectedLedgerEvidenceDigest,expectedAccountingReceiptDigest:digest});
    }catch(error){
      if(!this.#matchesApplied(receipt,digest)){
        const reason=error instanceof Error&&'code'in error&&typeof error.code==='string'?error.code:'ledger_reconciliation_failed';
        this.#db.prepare("UPDATE accounting_receipts SET status='rejected',reason=? WHERE id=? AND status='prepared'").run(reason,receipt.id);throw error;
      }
    }
    this.#db.prepare("UPDATE accounting_receipts SET status='applied',applied_at=? WHERE id=? AND status='prepared'").run(this.#time(),receipt.id);
    return this.#result(receipt,digest,'applied');
  }
  #result(receipt:AccountingReceipt,digest:string,status:'applied'|'already_applied'){return{status,receiptDigest:digest,revision:receipt.revision,
    recordedCpuSeconds:receipt.cpu.cumulativeSeconds,authenticityVerified:false as const,reservation:this.#ledger.get(receipt.binding.reservationId)};}
  /** Recover an expired prepared write without releasing money or authorizing dispatch.
   * The tombstone fences any old writer at the ledger CAS, including across a recovery crash. */
  recoverExpiredPrepared(id:string,contextValue:unknown){
    const context=z.strictObject({expectedReceiptDigest:Digest,acceptedReceiptDigests:z.array(Digest).min(1).max(1000)}).parse(contextValue);
    const stored=this.#stored(Id.parse(id));if(!stored)throw new Error('Unknown prepared accounting receipt.');
    const receipt=AccountingReceiptSchema.parse(JSON.parse(stored.body_json)),digest=hash(receipt);
    if(digest!==stored.digest||digest!==context.expectedReceiptDigest||!context.acceptedReceiptDigests.includes(digest))throw new Error('Prepared recovery requires the exact accepted receipt.');
    this.#validateBinding(receipt);
    if(stored.status==='applied')return this.#result(receipt,digest,'already_applied');
    if(stored.status==='rejected')return{status:'already_rejected' as const,receiptDigest:digest,reservation:this.#ledger.get(receipt.binding.reservationId)};
    if(Date.parse(receipt.validUntil)>Date.parse(this.#time()))throw new Error('Only expired prepared receipts can be abandoned.');
    this.#anchor(receipt,digest);
    const tombstone=hash({kind:'expired_accounting_receipt_tombstone',receiptDigest:digest});
    for(let attempt=0;attempt<3;attempt++){
      if(this.#matchesApplied(receipt,digest)){
        this.#db.prepare("UPDATE accounting_receipts SET status='applied',applied_at=? WHERE id=? AND status='prepared'").run(this.#time(),id);
        return this.#result(receipt,digest,'applied');
      }
      const current=this.#ledger.get(receipt.binding.reservationId);
      if(current.evidenceDigest!==tombstone){
        try{this.#ledger.reconcile({id:current.id,actualCostMicros:current.actualCostMicros===null?null:BigInt(current.actualCostMicros),complete:false,evidenceDigest:tombstone,expectedEvidenceDigest:current.evidenceDigest,expectedAccountingReceiptDigest:digest});}
        catch(error){if(error instanceof Error&&'code'in error&&error.code==='reconciliation_conflict')continue;throw error;}
      }
      this.#db.prepare("UPDATE accounting_receipts SET status='rejected',reason='expired_prepared_tombstone' WHERE id=? AND status='prepared'").run(id);
      return{status:'rejected' as const,receiptDigest:digest,tombstoneDigest:tombstone,reservation:this.#ledger.get(receipt.binding.reservationId)};
    }
    throw new Error('Accounting changed during prepared recovery; preserve state and retry trusted recovery.');
  }
  history(reservationId:string){return this.#db.prepare('SELECT id,digest,revision,status,reason,prepared_at,applied_at FROM accounting_receipts WHERE reservation_id=? ORDER BY revision').all(Id.parse(reservationId));}
  close(){this.#db.close();}
}
