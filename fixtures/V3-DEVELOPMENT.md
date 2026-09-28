# Public maintenance scenarios, version 3

These ten original CC0 Python scenarios replace the task picker's one-bug examples with interacting maintenance requirements. They are curated development demonstrations, not sampled upstream issues or a new benchmark result. The frozen v2 split, all old fixtures and their historical evidence remain unchanged; the new identities begin `v3-` and belong to their own public-development catalogue.

Every task has five explicit requirements, five model-visible example checks and seventeen acceptance checks controlled by the host. The repair model receives source, requirements and visible examples, not the acceptance-case definitions or reference implementations. The acceptance cases are public development material, so this is an execution separation rather than a claim that their contents are secret. No sealed final tasks or final-set feedback were used.

| Task | Interacting behavior | Functions | Source lines | Starting checks passed |
| --- | --- | ---: | ---: | ---: |
| Configuration overlays | Nested object merge, list replacement, null/deletion distinction, precise final change paths | 6 | 79 | 15/22 |
| Cursor pagination | Latest revision, tombstones, deterministic order, exclusive cursor, last-page metadata | 6 | 63 | 16/22 |
| Inventory reservation | Duplicate SKU aggregation, priority fairness, all-or-nothing reservation, shortage reporting | 5 | 65 | 18/22 |
| Invoice allocation | Largest-remainder discounts, tie order, post-discount tax, exact rounded totals | 5 | 63 | 13/22 |
| TTL cache | Expiry boundaries, read recency, replacement, eviction, explicit null values | 5 | 74 | 16/22 |
| Weekly schedule | Overnight/week wrap, adjacency, resource isolation, overlapping blackout subtraction | 5 | 70 | 15/22 |
| Asset manifest plan | Canonical names, same-path updates, one-to-one reusable-content moves, byte accounting | 5 | 65 | 14/22 |
| Event materialization | Retry deduplication, revision ordering, deletion/recreation, ordered label edits | 5 | 79 | 17/22 |
| Retry batching | Attempt/readiness boundaries, first-fit packing, weight limits, exclusion groups | 6 | 66 | 17/22 |
| Search ranking | Unicode whole-word matching, all query terms, distinct-field scoring, phrase bonus, total before limit | 5 | 60 | 18/22 |

The meaningful code is 60–79 lines per module. Complexity comes from several policies interacting, not from extra lines or large dependencies. Every module is a pure function library; none opens files, contacts a service, or executes arbitrary commands.

`v3-development-manifest.json` binds exact fixture bytes to requirements/check counts, initial-source line counts, and observed visible-example outputs. Its initial outputs were executed against the buggy starting implementation; they are not invented descriptions. Source and fixture hashes must be rechecked before using those observations after any edit.

## Validation and scope

Authorship and reference repairs used a separate temporary author workspace. No reference repair or patch is present in this repository or in model input. The author executed all 220 declared checks against reference implementations and all buggy starting implementations. Every reference passed; every buggy implementation failed at least four checks. Each of the 31 isolated intended defect mutations was independently detected by at least one check, preventing a task from passing merely because an unrelated bug happened to fail.

A separate reviewer examined public requirements and expected results with independent specification implementations. The review and isolated baseline execution receipt are in `research/product-v3/fixture-review.json`; its exact verdict applies to the hashes recorded there. Separate author-side container reference validation is recorded in `research/product-v3/fixture-author-validation.json` after execution completes. These checks validate fixture preparation; they are not AI repair scores, production adoption evidence, model comparisons, or a correctness guarantee.

Executed author commands:

- `python3 /tmp/patchproof-v3-author-20260928/author.py` — exit 0; 220 reference checks, ten rejected starts, 31 detected isolated defect controls. The author script and reference source remain outside the project.
- `node /tmp/patchproof-v3-author-20260928/validate-reference.mjs` — final outcome is recorded in the author validation receipt; it uses the existing immutable-image `DockerCheckRunner`, no network, one fresh bounded container per check.
- Public schema/digest validation is reproducible using `node scripts/verify-v3-corpus.ts`.

No model calls, paid cloud resources, deployment, public publication, sealed evaluation, or benchmark comparison were performed by the fixture author. Live demonstration outcomes are separate run records owned by the coordinator. A failed repair must remain a full observed example; a reference implementation passing is not a substitute for an actual model repair succeeding.
