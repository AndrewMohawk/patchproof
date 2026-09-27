# Trusted accounting receipt import

`packages/orchestrator/src/accounting-receipts.ts` imports an operator-reviewed cumulative accounting receipt into the existing `BudgetLedger`. It has no provider, cleanup, retry, dispatch or credential callbacks. This module does not fetch billing evidence, establish its authenticity, grant account access or run an episode. The [private operator command](accounting-operator.md) now supplies explicit receipt import and expired-write recovery. Live billing verification and automatic runtime ingestion remain integration work.

The receipt binds the reservation ID, episode ID, immutable reservation fingerprint, stage, reserved microdollars, source digest and frozen experiment-plan digest. Pilot/evaluation receipts require a plan digest. Operation records bind each intent to its remote operation ID or an evidenced `confirmed_not_created` outcome. An unknown/lost intent remains unresolved. Cleanup has a separate observation digest. Strict schemas exclude candidate files, checks, outputs and arbitrary extra fields; callers must also keep sensitive content out of identifiers and digest inputs.

Import requires an independently assembled `AccountingImportContext`: expected bindings, expected operation/cleanup digests, and the exact receipt digest accepted by trusted evidence ingestion. Copying these fields from an unverified receipt defeats that boundary. The importer checks consistency, not provider authenticity or operator authorization; every successful result explicitly returns `authenticityVerified: false`. Digests do not prove that charges are real, final or denominated in USD. No signatures, provider fetcher or exchange-rate conversion are implied.

```ts
const importer = new AccountingReceiptImporter({
  filename: privateReceiptJournalPath,
  ledger,
});
try {
  const result = importer.import(reviewedReceipt, independentlyVerifiedContext);
  // Inspect result.reservation; importing does not authorize another dispatch.
} finally {
  importer.close();
}
```

`AccountingReceiptSchema`, `AccountingBindingSchema`, `OperationManifestSchema` and `CleanupObservationSchema` are the runtime interfaces. Their exported digest helpers hash the parsed schemas, including their fixed field ordering. `accountingReceiptDigest` identifies the entire immutable receipt. The operator must supply an observation window covering the episode through setup, retries and cleanup, with a current issue/expiry window. Receipt revisions are contiguous and name the previous receipt digest, including rejected revisions; the same receipt ID can never name different content.

## Measured totals and holds

USD is an explicit decimal string, preserving up to 18 fractional decimal places. `measuredUsdToMicros` rounds the ledger charge upward to the next integer microdollar; exact decimal totals are still compared before rounding. Unknown currency/amount is represented by `currency: null`, `cumulativeUsd: null`, `complete: false`. The importer does not guess USD, convert credits or infer zero. CPU is a finite nonnegative cumulative seconds value or `null`; a known amount requires its evidence digest.

The unused reservation releases only when billing, CPU, operation inventory and cleanup are all complete. Complete billing requires an explicit measured amount, including zero. Partial charges are recorded while the remainder stays held. Unknown CPU, unfinished cleanup, active operations and lost intents keep the hold and the ledger's pending-billing block. Numeric known USD/CPU cannot decrease or disappear in a later receipt. Known remote identities and resolved operation evidence cannot be silently changed or removed.

Later evidence can mark previously complete billing or CPU incomplete. That restores the remaining hold without erasing the known total, deleting earlier proof or making the episode dispatchable again. Any additional uncertainty about a previously resolved operation must be represented explicitly, preserving the original resolved record. Overruns and charges without a recorded dispatch retain the existing sticky ledger freeze. There is no refund, automatic thaw or implicit retry.

## Durability and recovery

The receipt database uses a private owned directory, mode 0600 files, rejected symlink paths, WAL and full synchronous writes. Its random logical journal identity is bound one-to-one to a durable ledger identity; the association does not depend on a filesystem path. Reopening the same pair works. A replacement journal against that ledger, or the same journal against a different ledger, rejects before reconciliation.

The write order is deliberately explicit because the two SQLite files are not one transaction:

1. Commit the immutable receipt as `prepared` in the receipt journal.
2. Anchor its reservation, revision, digest and previous digest in the ledger under the bound journal identity.
3. Reconcile using `expectedLedgerEvidenceDigest`, checked inside the ledger transaction.
4. Mark the receipt `applied` in the receipt journal.

The ledger anchor prevents an old copy of the same journal from skipping newer receipt/CPU history, even when that copy knows the current billing digest. A missing or conflicting anchor fails before reconciliation. A crash before anchoring leaves a prepared body; a crash after anchoring leaves the same body and an idempotent anchor. A crash after reconciliation can finish the prepared journal entry without a second accounting change, including after receipt expiry.

`BudgetLedger.reconcile` now accepts optional `expectedEvidenceDigest` for compare-and-swap and `expectedAccountingReceiptDigest` to check the anchored receipt revision in the same transaction. Existing trusted callers remain compatible, but receipt imports and recovery use both checks. A stale accounting writer cannot overwrite newer billing evidence, release its hold, or tombstone a later receipt after a recovery race. `bindAccountingJournal` and `anchorAccountingReceipt` are trusted importer support APIs, not candidate-facing operations.

An expired prepared entry that never reconciled can be recovered explicitly:

```ts
const recovery = importer.recoverExpiredPrepared(receiptId, {
  expectedReceiptDigest: reviewedReceiptDigest,
  acceptedReceiptDigests: independentlyAcceptedReceiptDigests,
});
```

Recovery verifies the stored receipt and its binding. If its reconciliation already committed, recovery finishes `applied`. Otherwise it writes a deterministic recovery digest using ledger CAS, retaining the current known charge with `complete: false`, then preserves the receipt as `rejected`. That recovery digest fences the old prepared writer. A crash after this write can finish the rejection idempotently. A newly reviewed next revision must reference the rejected receipt and the current ledger evidence digest. Unexpired prepared entries cannot be abandoned through this API. Recovery performs no remote action and grants no dispatch permission.

Repeating an applied receipt is a read-only historical lookup: it validates immutable reservation binding and returns that receipt's identity/CPU with the **current** reservation. It does not try to replace newer higher charges with its older amount. A duplicate rejected receipt cannot be reused. The history API exposes safe journal metadata while preserving original bodies internally.

Back up and restore the ledger and receipt journal together using SQLite-consistent backups. A detected stale/missing revision requires restoring matched durable state or exact reviewed history; the importer does not silently reconstruct missing evidence. These checks do not protect against a privileged operator rolling back or editing both databases. Direct low-level ledger reconciliation remains a trusted interface and does not itself enforce receipt CPU/history rules; production ingestion must route reviewed receipts through this importer.

## Verification boundary

`node --test tests/accounting-receipts.test.ts tests/accounting-receipts-independent.test.ts tests/budget-ledger.test.ts` passed 58 tests, and `npm run typecheck` passed. The combined run includes six separately authored independent controls; its [test log](../research/verification/runtime-followup/accounting-receipts-test.log) records the result. The [independent review receipt](../research/verification/runtime-followup/accounting-independent-review.json) binds source hashes and preserves five resolved findings with their original evidence limits. Controls use invented IDs, inert metadata and temporary SQLite files. They cover concurrent evidence changes, stale and copied journals, lower totals, late uncertainty, immutable operation proofs, reopened databases, overruns and real child-process termination at three write boundaries. No fixture definitions, candidate execution, tokens, provider calls or billing assertions were involved. External billing authenticity, complete provider operation inventory and live cleanup remain unverified until authorized account integration.
