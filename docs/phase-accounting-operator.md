# Active phase accounting

`packages/orchestrator/src/phase-accounting.ts` records independently reviewed, cumulative accounting for **one runtime or adjudication phase**. It does not reserve, charge, release, or reconcile ledger funds; it cannot grant execution or reopen a terminal result. Whole-episode reconciliation remains in `docs/accounting-operator.md` and must include adjudication as well as runtime charges.

The live runtime records one immutable final checkpoint after its operations quiesce, then waits within its remaining deadline. `createPhaseAccountingObserver` polls the private journal every 250 ms, does no paid work, and exits on abort. A missing or late receipt leaves execution blocked and billing unresolved. This is an ingestion boundary, not an implemented Nebius billing API. An operator or separately verified collector must establish actual USD, CPU, the complete intent/operation inventory, cleanup and final retention charges. Token price estimates and sandbox resource `cost` with unspecified currency cannot establish actual USD.

Receipts use strict `PhaseAccountingReceiptSchema`. They bind execution mode, phase, dispatch, episode, reservation fingerprint and amount, source, plan, model, policy, final checkpoint and exact operation inventory. Every receipt needs independently accepted evidence digests, an explicit USD decimal (up to 18 fractional digits), CPU seconds and observation validity. Unknown measurements stay null. Numeric projections round USD upward to a microdollar; the original decimal is retained. The five completeness flags must all hold for the current checkpoint before an observer returns successfully. Numeric amounts from expired/incomplete receipts are historical lower bounds only.

The store preserves immutable bodies, contiguous revisions and the previous receipt digest, with an atomic expected-head check. USD and CPU cannot decrease or become unknown. Re-importing an old exact receipt does not move the head or add its cumulative amount again. Runtime and adjudication are separate domains; the dispatcher adds their final measured totals once. Digests demonstrate consistency, not provider authenticity. All operator files belong outside the project in an owned private directory; the journal and files use mode 0600. These checks do not isolate code running as the same Unix user.

The private config has this shape (the path is illustrative):

```json
{"schemaVersion":"1.0","kind":"patchproof-phase-accounting-operator","journalPath":"/private/operator/phase.sqlite"}
```

Both config and context digest arguments use canonical `digestJson` of the schema-parsed value. The context contains `expectedBinding`, `expectedCheckpointDigest`, `expectedInventoryDigest`, `acceptedReceiptDigest` and `expectedHeadDigest` (null for revision 1). `phaseInventoryDigest` sorts the unique inventory IDs before hashing; `phaseAccountingReceiptDigest` hashes the strict parsed receipt. Acceptance of a digest must come from independent review of its evidence, not merely computing a matching hash.

```sh
node scripts/phase-accounting-cli.ts status CONFIG CONFIG_DIGEST
node scripts/phase-accounting-cli.ts request CONFIG CONFIG_DIGEST DISPATCH_ID runtime NEW_PRIVATE_OUTPUT
node scripts/phase-accounting-cli.ts accept CONFIG CONFIG_DIGEST RECEIPT CONTEXT CONTEXT_DIGEST
```

The request export is private and refuses to overwrite a file. Status opens the journal read-only. Intake requires an existing journal and matching pending request; a misspelled path cannot initialize accounting state. Late intake can preserve evidence but grants no execution and cannot restart an expired episode. The final whole-episode importer should be used only after all work, including adjudication, has stopped and its complete accounting scope is established.

This implementation has been tested with invented local metadata. Account access, authoritative evidence collection, actual costs and provider cleanup remain unverified. It is not competition evidence.
