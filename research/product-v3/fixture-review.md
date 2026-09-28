# Independent v3 development fixture review

Status: **complete**. Reviewed public development fixtures only; no sealed/calibration/final evaluator material or author reference implementations were accessed.

These are more involved maintenance examples, with interacting policies and multiple helpers. This review does not establish benchmark difficulty, model superiority, or comprehensive correctness.

| Task | Source lines / functions | Visible / acceptance | Original pass / fail / error | Current bytes checked |
| --- | ---: | ---: | ---: | --- |
| v3-config-overlay | 79 / 6 | 5 / 17 | 15 / 7 / 0 | yes |
| v3-cursor-pagination | 63 / 6 | 5 / 17 | 16 / 6 / 0 | yes |
| v3-event-fold | 79 / 5 | 5 / 17 | 17 / 5 / 0 | yes |
| v3-inventory-reservation | 65 / 5 | 5 / 17 | 18 / 4 / 0 | yes |
| v3-invoice-allocation | 63 / 5 | 5 / 17 | 13 / 9 / 0 | yes |
| v3-manifest-merge | 65 / 5 | 5 / 17 | 14 / 8 / 0 | yes |
| v3-retry-batches | 66 / 6 | 5 / 17 | 17 / 5 / 0 | yes |
| v3-search-ranking | 60 / 5 | 5 / 17 | 18 / 4 / 0 | yes |
| v3-ttl-cache | 74 / 5 | 5 / 17 | 16 / 6 / 0 | yes |
| v3-weekly-schedule | 70 / 5 | 5 / 17 | 15 / 7 / 0 | yes |

All ten final baseline snapshots completed: **159 pass / 61 fail / 0 error** across 220 declared checks. All tasks exhibit real original-code failures. The 145 independently calculated return values and 75 manually reviewed exception expectations agree with their requirements. No outstanding oracle or specification blocker remains.

## Findings resolved during authoring and review

- Invoice large-money originally used `10000000000000001`, which JavaScript silently rounds. The author replaced this with exactly representable JSON amounts; intended integer arithmetic remains specified.
- Configuration deletion now distinguishes Boolean `true` from numeric `1`, with a rejection case, and checks type changes nested in lists.
- Configuration requirements now forbid a deletion marker as a whole layer, with a `ValueError` case. This closes a specification ambiguity before model runs.
- Search tokenization now explicitly specifies Unicode alphanumeric characters, including non-ASCII numeric characters, with a corresponding case.
- Author self-review found a missing configuration path-order boundary: punctuation-prefix siblings require globally sorted changed paths. An independent calculation confirms the new expected order; the final fixture was rerun.

## Method and evidence

Positive results are independently recalculated from the written requirements in a reviewer-only temporary program, without importing fixture source or reading the author reference implementation. Cache recency uses an ordered list oracle; weekly intervals use independent minute-set occupancy. All 145 positive expected values were independently recomputed. The other 75 exception expectations were manually checked against the written validation requirements. Original broken sources run through the existing DockerCheckRunner with all declared checks; source hashes, operation IDs, full observations, timing, image pin and cleanup receipts are embedded in [fixture-review.json](fixture-review.json).

Each task has five model-visible examples plus seventeen acceptance cases. Acceptance case inputs and expected outputs remain outside repair input; the runtime shares requirement-level pass/fail feedback. Every case asserts that invocation arguments remain unchanged. Tasks declare original project-owned CC0-1.0 authorship, with matching source notices; this is provenance documentation rather than an independent legal determination.

Commands (no external inference):

- `python3 /tmp/patchproof-v3-independent-review-hj7uv8/expected-values.py` — exit 0; all 145 positive expected values match.
- `node /tmp/patchproof-v3-independent-review-hj7uv8/check-baselines.mjs <explicit v3 task ids>` — exit 0 for completed receipts; current-byte coverage is shown in the table. Superseded development receipts are preserved.

Base commit: `bead49261dc55a71d1ae830b23b1521dc0cb5ef5`; new fixture working-tree bytes are bound by SHA-256 in the JSON report. Superseded development runs for config and search are retained in the JSON report and temporary workspace; both were rerun after review changes. Temporary reviewer programs and raw receipts remain at `/tmp/patchproof-v3-independent-review-hj7uv8`. The report includes their hashes.

Runtime: Node v25.5.0; reviewer Python 3.12.3; Docker server 29.8.1. Pinned checker image and repository digest are recorded in the JSON report. No image pull was required.

Remaining limits: the JSON call interface can verify values and unchanged inputs, but does not establish post-return object-identity or alias behavior. No claim of exhaustive specification coverage is made.
