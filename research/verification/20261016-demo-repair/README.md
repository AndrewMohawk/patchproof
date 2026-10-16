# October 16 guarded demo repair

This is a validated repair candidate. The public service remains on release
`8ad4b27f76e437cf603e9dd1bfd022909da36abd`, with new runs disabled and the
`operator_paused_supervised_only` ledger freeze preserved. Judge access is **not
ready**. No paid inference was performed for this change.

## Baseline reliability

On Andromeda (96 logical CPUs, initial load average approximately 23), the
unchanged pagination baseline took 82,325 ms for 44 isolated container lifecycles.
The two-case diagnostic measured attached start at 1,322–1,449 ms per case,
excluding create/inspection/cleanup. This confirms substantial cumulative
lifecycle overhead; it does not prove the exact host condition on October 14.

The new scheduling policy permits two concurrent lanes, each retaining a fresh
network-disabled container for every check. It keeps both observations, the
120-second shared batch deadline, immutable image, non-root user, read-only
mounts/root filesystem, dropped capabilities, process/memory/CPU limits, operation
journaling and scoped cleanup. At most two 0.5-CPU/128-MiB containers run together.
Infrastructure uncertainty cancels the peer; both lanes drain before returning.
The policy is recorded in runtime evidence and selected during replay. Historical
bundles without it retain sequential scheduling.

[Measured baseline receipt](baseline-timing.json):

| Fixture | Time | Repeated result | Fresh containers | Cleanup |
| --- | ---: | --- | ---: | --- |
| Configuration overlays | 44,345 ms | 15 pass / 7 fail | 44 | confirmed |
| Cursor pagination | 43,414 ms | 16 pass / 6 fail | 44 | confirmed |

These are expected failures of original buggy fixtures, not successful model
repairs. No timeout or repetition limit was increased. This single-host result
does not guarantee performance under every load.

## Pricing, accounting and approval

The [new pricing receipt](pricing-evidence.json) records an authenticated model
catalog read and the account Prices, Usage and Billing details screens. Current
rates remain $0.30/M input and $0.90/M output, with zero request fee. The account's
tax jurisdiction is outside the US states currently charged under the published
Nebius policy; no personal billing details are retained here.

The conservative three-call envelope is $0.2467296 against a $0.25 hold, leaving
$0.0032704. An unknown fee or price increase must block admissions rather than
consume this small margin speculatively.

The existing durable ledger still contains 13 unresolved reservations totaling
$1.60. Two October 14 pre-inference failures remain reconciled at zero. The
account usage screen for September 16–October 16, updated at 19:38 UTC, shows
product costs totaling $0.01281912. Aggregated product rows do not map charges to
individual reservations, so no reservation was released or reset.

The renewed approval in budget.json expires December 15 at 20:00 UTC and remains
$25 TOTAL including prior usage and applicable fees. Existing $5 smoke/$20 pilot
allocations remain; hosting is zero and no automatic increase is permitted.
The deployed ledger approval has **not** been changed to the new file. An
explicit compare-and-swap approval synchronization is required during a guarded
rollout. Changing a checkout is not a new spending allowance.

## Remaining rollout gates

- Review this change and its no-cost tests. The new pricing/code/source digest
  bindings are prepared together; the deployed configuration is unchanged.
- Establish an audited operator resume procedure for the existing operator
  pause. The ledger deliberately has no automatic thaw API. Do not clear
  overrun, unknown-billing or other freezes, or directly reset ledger rows to
  obtain a green state.
- After durable approval synchronization and controlled operator resume, perform
  at most one supervised repair per currently exposed fixture, preserving all
  reservations and unsuccessful outcomes. Paid repair validation is NOT RUN.
- Reopen only after successful end-to-end checks and verified accounting.
  The current one-day pricing receipt alone is insufficient for judge access.

## Maintainable monitoring proposal through December 15, 20:00 UTC

Run a read-only hourly operator monitor against the existing authenticated
catalog and public /tasks and /healthz endpoints, plus the existing ledger.
It must never submit a repair, top up billing, create keys, extend approval,
release reservations, or unpause automatically. Record timestamped, bounded
receipts and alert on changed prices/model context, unknown fees, unavailable
billing, low reservation capacity, nonterminal orphaned runs, baseline latency,
or disabled admission. Use a no-cost baseline check only when needed to verify
runtime health, serializing it with paid work.

A reviewed refresh should bind the exact catalog and account-fee evidence to the
immutable release and private configuration. Fail closed on missing/stale
evidence, changed pricing, approval expiry, exhausted stage/project capacity,
in-flight work, unresolved blocking accounting, or unconfirmed cleanup. Keep the
whole 600-second allowance within the evidence and approval windows. Preserve
saved examples while creation is disabled; surface the actual reason and finite
remaining capacity. Reserve judge capacity explicitly within the existing total
before reopening; do not promise unlimited runs or availability based on trial
credit. The UI currently exposes two tasks; ten exist in the repository.

This is a proposal, not an installed monitor or funded availability commitment.


## Validation

The initial typecheck and all **72** targeted tests passed on Andromeda, including exact
pricing expiry boundaries, mismatched prices, approval-window expiry, exhausted
budget, persisted operator pause, concurrent-run rejection, two-lane cancellation,
historical scheduling, and real container cleanup controls. Fixture integrity
confirmed ten tasks and 220 checks. The staged change secret scan found no leaks.
See [validation receipt](validation-receipt.json) and [test log](targeted-tests.log).

An earlier concurrent suite attempt failed an existing cleanup timing assertion;
its [log](parallel-suite-attempt.log) is retained. The serialized rerun passed
without changing cleanup code or timeouts. Initial test-only typing/key errors
were corrected. Full repository tests and paid end-to-end repairs are NOT RUN.

## Review follow-up: fixed admission deadline

An advancing clock reproduced the sliding-expiry bug for both pricing and
approval: a run admitted exactly ten minutes before expiry was stopped after
its baseline because later gates demanded another full ten minutes. Admission
now persists one absolute deadline shared with the run creation timestamp.
Later checks, credential access and dispatch validate that deadline against
current pricing and approval; queue time consumes the allowance. A final check
returning after the deadline cannot publish a verified result. No expiry,
timeout, reservation, or isolation limit was increased.

The two-lane runner now retains the first originating infrastructure failure
regardless of lane order, while still waiting for both cleanup paths.
The second-lane-first cancellation regression is covered.

The live ledger is unchanged: approval revision 1, operator pause present,
13 unresolved reservations totaling $1.60. An audited resume API was proposed
but its implementation was rejected by automatic approval review as a
security-sensitive control change requiring explicit approval. No part of that
denied implementation ran. Paid validation and rollout remain blocked on that
approval; this timing fix does not clear any freeze.

Final review validation: typecheck and **135/135 tests passed** on Andromeda
with test concurrency 1. See [follow-up log](review-followup-tests.log).
The expanded suite includes the coordinator, API, UI and trusted synthetic
transport controls in addition to the original accounting, pricing and real
Docker cleanup tests. The prior clock-fixture attempt is retained; the
approval-before case now starts after pricing verification so it isolates the
intended boundary. Candidate source, pricing and private configuration hashes
were verified together after the code change. No paid provider calls occurred.
