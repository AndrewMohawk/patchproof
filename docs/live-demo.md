# Public real-inference demo

**Availability note — October 13, 2026:** A read-only public-app inspection found
new repairs paused with a pricing-refresh message. The checked source's pricing
validity ended on October 1. This guide describes the implemented workflow and
dated September evidence; it does not establish that new runs are available now.
See [release readiness](release-readiness.md). This documentation update changes
no pricing, resource limit, service, or deployment.

[Open PatchProof](https://patchproof.andrewmohawk.xyz/) to review AI-generated
maintenance changes and their executable check results. The public application
uses NVIDIA Nemotron through Nebius Token Factory. Declared checks run twice in
fresh local Docker containers; the model cannot edit them. Only curated task IDs
can start a run. There are no repository uploads, arbitrary shell commands, or
automatic merges.

## Product v3 experience

**Try a repair** offers ten public Python maintenance tasks, each with a 60–79-line
starting file, five requirements, and five selectable public examples. The
briefing explains the code’s purpose, broken behavior, required outcome, and what
must remain unchanged. The examples cover configuration overlays, pagination,
inventory reservations, invoice allocation, cache expiry, schedules, manifest
merges, event folding, retry packing, and search ranking. They are original
synthetic fixtures with interacting requirements, not representative production
benchmarks.

**How it works** explains the workflow: choose a task, request a patch, execute
protected checks, retain evidence, and let the reviewer decide whether to use the
change. “Independent” describes the checks’ separation from the repair agent;
it does not mean that another model votes on correctness or that passing finite
checks proves correctness.

Both saved walkthroughs have four stages: **The bug → AI patch → Check results →
Your decision**. The failed case exposes its starting code, proposed change,
observed failures, and all attempts. Diffs show file headers, change counts,
original/proposed line numbers, and expandable unchanged context. Reading a saved
walkthrough or downloading evidence starts no inference.

The [product v3 record](../research/product-v3/README.md) is the index for the
upgrade’s evidence. The [initial public review](../research/product-v3/public-review/review.md)
verified the ten tasks, all public source/example controls, How it works, and
both walkthroughs at desktop and mobile sizes. The final public review passed
24 story scenes and 93 layout checks. The successful Super pagination repair
improves 16/22 original checks to 22/22, reproduced by a fresh same-host replay.
The failed configuration story retains five functional failures and separately
explains a later verification timeout. The 149.76-second
[hosted recording](https://patchproof.andrewmohawk.xyz/demo/) includes annotations,
local Chatterbox synthetic narration, a transcript and links to both examples.

## Model and run limits

The September 28 recorded public configuration uses
`nvidia/nemotron-3-super-120b-a12b`. Its exact account catalog identifier and
reservation calculation are recorded in the [model discovery receipt](../research/product-v3/model-discovery.json).
Discovery was read-only and is not evidence of successful model inference. The
[public runtime check](../research/product-v3/public-review/mobile-fixes.json)
verified this model identifier and the limits below while a real repair was in
progress; it does not claim the run succeeded.

Provider defaults are requested without a thinking-disable override. Hidden
reasoning is never retained or displayed; completion-token and spending caps
remain enforced. Truncated responses cannot become accepted patches.

The September 28 recorded v3 allowance was shared by baseline, checks-only, and PatchProof:

| Limit | Per run |
|---|---|
| Model requests | At most 3 |
| Total output allowance | 12,000 tokens |
| Aggregate wall time | 600 seconds |
| Budget reservation | $0.25 |

Historical Nano runs retain their actual recorded limits: three calls, 300
seconds, and a $0.10 reservation, with 6,000 output tokens in the earlier runs and
12,000 in the later configuration and pagination trials. Do not apply the new
limits to old runs
or treat different-model development examples as a matched comparison. The exact
runtime lock and request receipts establish which settings each run used. No
claim about hidden model reasoning follows from these receipts; they establish
only the recorded requests, proposed source, token usage and checked outcomes.

## Spending and accounting

The owner-approved ceiling remains **$25 total**, including a $5 smoke allocation
and $20 pilot allocation. The $0.25 reservation is a hold within that
ceiling, not additional approval or the measured cost of a repair. The designated
ledger retains full holds while authoritative invoice costs remain unknown.
Displayed token-based costs are estimates.

Successful closed request inventories can permit another run while retaining
earlier holds. Transport ambiguity, missing receipts, changed approvals, an
expired pricing review, overrun, or unavailable funds blocks further spending.
A run that never dispatches inference is recorded as zero inference cost. The
[budget](../budget.json) and exact runtime configuration govern execution; this
document does not grant access or spending authority.

## Hosting and reproducibility

A task-owned systemd user unit runs the trusted controller from a pinned source
checkout. A hardened nginx container exposes fixed API routes and the recording,
and proxies to a private Unix socket. The frontend has no Docker socket, provider
credential, or published host port. Candidate containers run without networking,
capabilities, or writable source and cannot access the credential, ledger,
controller, or evaluator workspace. Public cancellation is restricted to the
browser session that created the run.

The credential and operator configuration stay outside the source checkout.
Request receipts contain model/request identifiers, bounds, usage, and digests;
keys and hidden reasoning are not retained in evidence or recordings.

Each downloadable bundle includes frozen source, patch, requirements, repeated
observations, model IDs, event history, and its runtime lock. Replay uses the exact
recorded source and pinned Docker image without inference calls. Passing the
replayed checks establishes that recorded behavior under those checks; it does
not prove general correctness.

The live Token Factory/local-Docker path is separate from historical scripted
mock mode and the unverified Nebius-hosted Sandboxes integration. The scored pilot,
sealed evaluation, reconciled provider invoices, and competition entry remain
separate gates. This public service is an unscored development demonstration.

## Historical evidence

The [original live deployment record](../research/verification/20260928-live-deployment/README.md)
preserves the early service-permission failure, unsuccessful repairs, actual Nano
requests, matched list examples, worksheet failure, fresh-container replays, and
video custody. Later source changes did not erase those failures or rewrite their
runtime locks.

The [interface redesign record](../research/interface-redesign/README.md) preserves
the earlier workbench release and recording. The [judge walkthrough record](../research/judge-experience/README.md)
preserves the explanatory walkthrough, captioned recording, presenter notes, and
public browser receipts. The [archive recorder record](../research/verification/20260927-archive-recorder/)
is older still and uses explicitly labeled mock evidence.

Those dated records contain their exact commits, test totals, durations, playback
checks, and source-bound artifacts. Their values should not be copied forward as
facts about a newer deployment or recording.
