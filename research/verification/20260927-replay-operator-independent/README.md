# Independent replay operator metadata review

Owned source/tests: `bd0096a8dbfa4d45a912ae9b70c1c92ce57b9ce6`.
Reviewed copied root `scripts/replay-operator.ts` with its metadata dependencies
and tests. Exact tested source hashes and command/log hashes are in
`verification.json`. The copied replay/core/helper files were uncommitted root
work at review time and are not part of the owned commit. Integration requires
the root replay constructor to use:

```ts
new BudgetLedger({ filename: config.ledgerFile, budget, existingOnly: true })
```

## Confirmed finding and fix

Preflight required an existing ledger path but opened it with the initializing
`BudgetLedger` constructor. An existing zero-byte file therefore acquired a new
schema and approval during preflight. An unrelated or old SQLite database could
also be migrated by the initializer. The independent empty-file control fails
before integration with “Missing expected rejection”. No provider is involved.

`BudgetLedger({ existingOnly:true })` now requires canonical owned private
regular files, rejects filesystem aliases and permissive modes without chmod,
and opens SQLite with `mode=rw` rather than a create-capable initializer. It
validates the existing tables, absence of ledger triggers, existing WAL mode and
current durable approval in a read transaction. Missing or changed schemas,
absent approval and budget mismatch fail without CREATE, migration, journal-mode
change or approval initialization. The default initializer is unchanged.

The option permits normal existing-ledger operations and live WAL visibility;
it is not a read-only accounting API or independent authentication of approval.
It does not turn an alternate ledger into another allowance. Operators must
continue using the fixed project ledger. As with the other private operators,
this is filesystem hygiene and durable accounting, not a hostile same-UID
process sandbox.

## Verified boundaries

All **34** focused tests pass; typecheck exits **0**. The suite includes the
existing ledger and replay controls plus six independent controls:

- Missing paths, empty files and unrelated databases cannot initialize approval.
- A reader sees the updated current approval and reservation inventory through
  a live WAL without creating extra approval/events/reservations.
- Missing tables, absent approval and added triggers are refused without repair.
- Permissive modes and filesystem aliases are refused without chmod/following.
- Replay preflight applies the existing-only option, reads no credential
  contents, creates no session/report and performs no transport request on
  empty/unrelated ledger rejection.
- A report appearing after dispatch is preserved. Both raw batches survive,
  the session becomes terminal, the unknown charge remains held and a repeated
  start performs no additional fake transport work.

No additional concrete defect was found in the reviewed private path/collision,
claim, cancellation, report/raw-file ordering and no-automatic-retry boundaries.
The existing metadata status command may touch the already existing private
SQLite session metadata for live WAL visibility; it does not create a missing
session file. Cancellation/recovery report metadata only and do not claim
remote cleanup or billing reconciliation. Raw results and final reports use
separate exclusive private files.

This review used invented metadata, task-owned temporary SQLite/filesystem state
and injected fake HTTP responses only. No credentials from an actual account,
fixture corpus, candidate execution, provider, paid resource or publication was
accessed. Full integrated tests and actual paid replay were **NOT RUN** here.
Root owns the replay core review and integrated verification of its final source.
