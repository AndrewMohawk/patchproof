# Private accounting operator

The metadata-only command imports reviewed accounting receipts or recovers an expired
prepared import. It performs no provider request, credential read, reservation,
approval change, cleanup, dispatch or episode retry. Successful accounting never
changes an experiment's terminal result or turns synthetic evidence into live proof.

```sh
node scripts/accounting-cli.ts import CONFIG.json RECEIPT.json CONTEXT.json CONTEXT_DIGEST
node scripts/accounting-cli.ts recover-expired CONFIG.json RECEIPT.json CONTEXT.json CONTEXT_DIGEST
```

All three paths must be absolute. Inputs, the approval snapshot and the two databases
belong in a private operator directory outside the project and candidate workspaces.
Use owned mode-0600 regular files and mode-0700 immediate parent directories. Symlink
ancestors, hard links, broad file permissions and oversized JSON inputs reject.
These checks are file hygiene; a process with the same Unix identity remains trusted.
The CLI reads only explicitly supplied paths. It does not discover credentials.

`CONFIG.json` uses `AccountingOperatorConfigSchema`:

- `schemaVersion`: `"1.0"`; `kind`: `"patchproof-accounting-operator"`.
- `budgetPath`: the absolute path to the existing ledger's reviewed `BudgetSchema`
  approval snapshot. Opening the ledger requires the same durable approval; this
  command cannot update or increase it.
- `expectedBudgetDigest`: the SHA-256 digest of that parsed, schema-ordered budget.
- `ledgerPath`: an existing budget SQLite file containing the reservation.
- `journalPath`: the fixed accounting receipt journal associated with this ledger.
  The first import may create it; recovery requires it already to exist. Keep both
  databases and their consistent backups together.

`RECEIPT.json` follows `AccountingReceiptSchema`, described in
[accounting reconciliation](accounting-reconciliation.md). `CONTEXT.json` is an
independently reviewed `AccountingOperatorContextSchema`: expected reservation,
source and plan bindings; expected operation and cleanup digests; and the accepted
receipt digests. Do not construct this trust context by copying an unverified
receipt. The command checks its separate `CONTEXT_DIGEST` before opening a database.
Pilot and final-stage bindings require a plan digest; non-experiment bindings can
use explicit `null`.

Digest helpers use parsed schema values in their defined field order, not pretty
printed file bytes. Use `operatorJsonDigest(BudgetSchema.parse(value))` and
`operatorJsonDigest(AccountingOperatorContextSchema.parse(value))`; use
`accountingReceiptDigest(value)` for a receipt. Hashes establish consistency, not
provider authenticity. The operator must first establish that billing units,
operation inventory, cleanup and evidence refer to the intended entire episode.
Provider evidence fetching and authentication remain separate account-integration
work; this command does not invent that evidence.

Malformed/mismatched input, absent reservations and missing/empty ledger paths fail
before journal creation. The importer preserves its existing revision, cumulative
amount, operation-history and crash-recovery controls. Unknown costs, incomplete
CPU or incomplete cleanup can be imported successfully while retaining the hold.
Expired spending approval does not prevent recording already-incurred costs under
the same durable approval. It never grants permission for another dispatch.

`recover-expired` requires the original exact reviewed receipt and context. An
already committed reconciliation finishes its journal record. An uncommitted expired
prepared record becomes a retained rejection with a CAS tombstone, known charges
preserved and remaining funds held. Issue a separately reviewed next revision;
never rewrite or delete the rejected receipt. Unexpired prepared writes reject.

Output includes the receipt's revision and historical CPU observation, current
reservation totals in decimal microdollar strings, pending-billing count and freeze
reasons. A duplicate old receipt can therefore show older receipt CPU alongside a
newer current charge; `receiptValuesAreHistorical` makes that distinction explicit.
Raw receipts, operation handles, context, approval text, paths and exception stacks
are not printed. Every response declares `executionPerformed: false`,
`dispatchGranted: false`, `providerCalls: 0`, `authenticityVerified: false` and
`competitionReady: false`. Exit 0 means the requested accounting action completed;
it does not imply all holds released. Exit 2 means validation/reconciliation failed.

There is no status verb in this first CLI: opening the mutable importer can initialize
identity metadata, so it is not presented as a read-only inspection. Existing runtime
and journal APIs remain available to trusted code. No runtime call site automatically
imports bills or reopens an episode.

Validation: `node --test tests/accounting-cli.test.ts` covers an actual CLI subprocess,
exact contexts, retained unknown holds, expired prepared recovery, absent/empty
ledgers, private file boundaries and suppressed raw input/error text. All inputs are
invented accounting metadata in temporary databases; no provider bills were verified.
