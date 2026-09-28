# Public product v3 review

Inspected the deployed public FQDN on 2026-09-28 at 05:24–05:25 UTC, release reported by the coordinator as `b663723`. This was a read-only browser review: no model call, run creation, cancellation, or other POST was attempted. The coordinator's configuration-overlay repair was already running.

## Functional evidence

- The public catalogue contains all 10 v3 tasks. Each has one 60–79-line Python source file, five explicit requirements, and five public examples.
- At desktop 1440×1000 and mobile 390×844, every source line matched the file supplied by the actual API. All 50 example selections worked at both sizes. Inputs, required values/exceptions, and input-preservation requirements are displayed as task goals rather than invented observed results.
- Try a repair now explains what code exists, what behavior should change, what must be preserved, and what Generate patch will do. Source navigation identifies the entry function and the editable file. The visible task topics are materially more realistic than the previous single list exercise: configuration layers, revision pagination, stock reservation, invoice allocation, expiry/eviction, schedules, manifest moves, event folding, retry packing, and search ranking.
- How it works gives a clear five-stage account: choose code and requirements, generate a proposal, execute fixed checks, retain evidence, and leave the decision to the person. It explicitly distinguishes protected checks from a second-model vote and distinguishes saved walkthroughs from Generate patch. The remainder is a long reference page, especially on mobile, but the first screen provides the essential explanation and a clear action.
- Both recorded stories have the same four stages: bug and goal, AI patch, check results, and decision. The failed story includes its source, exact example, full diff, requirements, and all three attempts. The retained attempt has 11/13 passing checks and two failures; attempts 2 and 3 each show 13 execution errors. It says no repair was accepted.
- The new diff has file headers, change totals, hunk headers, original/proposed line gutters, unchanged context, and expandable context. `def unique(values):` is now one unchanged context line, with original line 2 and proposed line 1, rather than a false removal and addition. The newline change at the end of the file remains shown and labeled. Expanding a context group revealed the omitted unchanged lines.
- All 20 captured desktop/mobile layouts fit the document width. No page or console errors occurred.

## Material findings sent to the coordinator

1. At 390px, the selected fourth walkthrough step was clipped to `4.`. Its right edge was 476.8px while the step bar ended at 374px. The decision heading remained clear, but the active progress label was not readable. The selected step should be scrolled into view.
2. While the coordinator's live run was active, the mobile fixed Generate patch button was disabled without a nearby explanation. The reason and evidence link were far below the code and examples. A visitor could interpret this as a broken control. The active-run explanation and progress link should be visible near the task introduction and the disabled action.

The coordinator acknowledged both findings and prepared fixes for the next release. Those fixes were **not** part of this receipt and require public rechecking.

## Judge-facing assessment

A first-time developer can now answer what is being repaired, inspect the starting code, choose a concrete behavior example, and understand what the model will be asked to do. The How it works page explains who controls the checks and who makes the final use decision. The failed walkthrough no longer feels like a short warning attached to the successful case; it supports the same inspection sequence.

The walkthroughs still reference the earlier real list/worksheet records in this release. A new v3 repair was in progress during inspection, so this review does not claim that the harder fixtures have already produced a successful real repair or that new story pins are deployed. It also makes no benchmark or superiority claim.

## Artifacts

- `receipt.json`: exact deployed asset hashes, all 20 task/viewport source checks, 16 story-stage observations, diff findings, and API availability.
- `inspect-public.mjs`: the executed read-only check. Exit code 0; status `functional-checks-passed`.
- `initial-screens.json`: the earlier focused inspection.
- Large screenshots are outside the repository at `/tmp/patchproof-v3-public-review/`, with exact filenames recorded in the receipt.
