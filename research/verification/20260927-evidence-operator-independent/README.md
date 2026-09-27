# Independent private evidence operator review

Reviewed `scripts/evidence-operator.ts` and its original tests from commit
`167898c` (producer change `6312c1`) in an isolated worktree. Source/test fix:
`1603d75ae2470889257261035e363b7f41b7fc40`. Exact source and log hashes, commands,
exit codes and timestamps are in `verification.json`.

One concrete boundary defect was found and fixed. The public inventory checked
literal filesystem names, while the existing fixture loader interpreted the
relative names as URLs. That mismatch allowed a literal inventoried directory
to redirect the loader into an unlisted sibling outside development/calibration.
The control uses only invented inert metadata in a task-owned temporary tree.
It failed before the fix with “Missing expected rejection”, showing that the
operator accepted a fixture outside the advertised inventoried trees.

The operator now verifies each name resolves to exactly the literal path before
the loader opens files. Reinterpreted names fail with the controlled
`evidence_curated_path_invalid` code. Existing symlink/hardlink, byte/count/depth,
source-change and full curated fixture pins remain enforced. Shared fixture
loading code and frozen product schemas were not changed.

The 16 focused controls pass, including the original 14, the new inventory
boundary regression and an additional concurrent-export control. Concurrent
requests produce exactly one new output, preserve the selected original bytes,
and leave the journal/evidence inputs unchanged. Typecheck exits 0.

The read-only code review found no additional concrete defect in the following
bounded areas:

- Private configuration/digest/path checks and collision rejection for the
  selected evidence object, configuration file, database and all sidecars.
- Immutable read-only SQLite opening, refusal of nonempty WAL/rollback data,
  bounded journal/document reads, schema checks and before/after stat checks.
- Exact publication pointer, terminal journal document, evidence digest and
  current full public fixture pins, including legacy 2.0 metadata.
- Exclusive private output creation, no overwrite, original-byte preservation,
  file/directory fsync and compact status without fixture/event contents.

This remains a private same-owner filesystem hygiene boundary, not a sandbox
against an actively hostile same-UID process. Integrity checks do not
establish authenticity or demonstrate candidate behavior. A quiescent immutable
journal snapshot is required; this operator does not checkpoint a live writer.
No actual fixture corpus, credentials, provider, candidate execution, paid
resource or publication was accessed. Full integration and paid replay were
**NOT RUN** in this review.
