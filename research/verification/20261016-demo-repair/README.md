# October 16 guarded demo repair

Current status at 23:17 UTC: immutable release
`b2eb1732a7da5ef14105b7cf127348c200265a8e` is healthy and new generation is enabled.
The audited resume preserved all historical reservations. The shared approved
$25 verification/judge pool has $2.35 held and 90 further $0.25 reservations at
this snapshot. The hourly catalog verifier is installed; fee evidence still
requires genuine renewal before October 17 at 20:50 UTC. No unlimited capacity
or unattended availability through December 15 is claimed.

See [public readiness](public-readiness.json), [renewable deployment](renewable-deployment.json),
[allocation synchronization](shared-allocation-sync.json), [audited resume](public-resume.json),
and the [operations runbook](../../../docs/judge-operations-plan.md).
The sections below preserve dated intermediate checkpoints, including earlier
paused states and the monitor proposal that the implemented controls supersede.

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

The original 13 unresolved reservations totaling $1.60 remain intact. The two
October 14 pre-inference failures and the first October 16 baseline failure are
reconciled at zero. The second October 16 supervised run completed its baseline
but hit the 4,000-token response limit on its first model call. Its estimated
cost is $0.0045753; actual invoiced cost remains unknown, so its full $0.25 hold
remains. After that attempt the ledger held $1.85 across 14 covered pending
reservations, with no blocking pending charges. Aggregated account usage does
not identify individual reservations and is not used to release them.

The renewed approval in budget.json expires December 15 at 20:00 UTC and remains
$25 TOTAL including prior usage and applicable fees. Existing $5 smoke/$20 pilot
allocations remain; hosting is zero and no automatic increase is permitted.
The durable approval was synchronized with compare-and-swap to revision 2.
Andrew explicitly approved the audited operator resume control on October 16.
It clears only an operator pause at the exact reviewed event checkpoint and
rejects stale checkpoints, financial freezes, and underlying accounting anomalies.
All prior reservations are checked unchanged after supervision.

## Baseline cleanup follow-up and supervised validation

Two no-cost baselines under service limits completed in 36.662 and 40.373 seconds.
A full coordinator diagnostic completed both in 55.086 and 52.563 seconds and
measured a 4.075-second event-loop stall while durable journaling was active.
The first supervised run encountered a cleanup inspection timeout. A later run
reproduced a one-second Docker inspect timeout even though stderr reported the
container no longer existed. That timed-out output is never accepted as proof.
Cleanup now repeats read-only inspection within the unchanged five-second cleanup
budget and requires a separate successful absence observation. Ownership mismatch
and malformed inspection remain immediate failures; persistent errors still fail
closed. No container creation or model request is retried by this change.

The second supervised run completed all 44 baseline container operations. Its
model response was incomplete at the unchanged token cap. The next candidate
requests NVIDIA's documented `chat_template_kwargs.enable_thinking=false` for all
live variants and records the setting in runtime evidence. Hosted behavior is
validated by supervision, not inferred from the upstream documentation. Token,
call, time and spending limits remain unchanged.

Public reopening remains gated on verified repairs, durable accounting, and a
maintainable pricing/capacity plan. Failed attempts remain in evidence. There is
no automatic unpause or unlimited judge capacity.

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

## Review follow-up: preserve observations at terminal gates

The post-check deadline gate previously threw before completed results reached
the baseline or candidate evidence. Returned observations and lifecycle logs
are now recorded before the terminal gate. Candidate acceptance and selection
still occur only after that gate succeeds. The evidence verifier recognizes an
explicit matching terminal live gate rejection without converting passing
observations into acceptance. The late-baseline and late-candidate export tests
assert retained observations, lifecycle logs and operation IDs, rejected/unselected
candidates, no additional inference, and unchanged reservation handling.

Evidence-preservation validation: typecheck and **175/175 tests passed** on
Andromeda with concurrency 1. The [full follow-up log](evidence-preservation-tests.log)
includes the previous 135 controls plus late-baseline export, shared experiment
execution, repair policy, historical evidence and archive coverage. Both
pre-fix export failures are retained in [the regression log](evidence-preservation-red.log).
The initial candidate fix also exposed the verifier's passing-observations
assumption; the final version preserves a matching explicit terminal rejection.
No paid calls, deployment changes or ledger changes occurred.

## Final supervised outcomes (22:45 UTC)

The [third supervised receipt](supervised-repairs-third.json) preserves both
outcomes. Configuration overlays passed every declared repeated check with one
model call, 855 output tokens and 88 fresh container operations in 121.686 seconds.
Pagination completed baseline and three candidate check batches without an
infrastructure error, but all candidates failed the revision-tie requirement;
it was correctly rejected after 264.462 seconds and 176 container operations.
The supervisor's requirement that both tasks succeed therefore failed. This is
not represented as a two-task success, and no further paid attempts were made.

There were five new provider calls today across three attempted paid runs,
including the earlier truncated response. Their combined token-rate estimate is
$0.0118197, not invoiced cost. All three $0.25 reservations remain held alongside
the original $1.60: total $2.35, 16 covered pending reservations, zero blocking
pending reservations, and $22.65 project capacity. Current smoke-stage capacity
is $2.65 (10 more $0.25 reservations); pilot capacity is separately allocated.
The ledger is operator-paused. No historical reservation changed.

The final request/runtime/cleanup suite passed 50/50 tests and typechecking.
Earlier evidence/accounting and operator-resume suites remain separately dated.
Both new evidence bundles are retained, including the rejected pagination patches.
The proposed monitor is not installed, the one-day pricing window is not extended,
and free judge access through December 15 is not established. Generation remains
paused; saved walkthrough and evidence access are restored on the validated code.

[Final deployment receipt](final-deployment.json): public health and both evidence
downloads passed at 22:48 UTC. The previous recovery unit was disabled after the
new unit became healthy. No unrelated service was stopped.

## Pagination diagnosis and truthful demo scope

The [request reconstruction receipt](pagination-diagnosis.json) matches all
three dispatched request digests exactly. Every request contained the complete
public requirement, including the equal-revision tie rule. The feedback origins
and original-source branching match the declared policy; protected diagnostic
contents remain withheld. A synthetic transport roundtrip preserves each stored
candidate's source. All three actual candidates passed 21/22 declared checks and
missed the same explicit clause. No specification, context projection, parser or
coordinator defect was established. The raw provider responses are not retained;
parser roundtrip uses the retained proposal, while request verification uses the
immutable actual dispatch digests.

The focused feedback/parser/repair-policy suite passed 16/16 tests on deployed
source. No additional paid call, prompt change, expected-answer disclosure,
fixture edit or hardcoded repair was made for this diagnosis. More identical
attempts are not justified by the evidence. This establishes a limitation of the
observed bounded model configuration, not a universal inability of the model.

The verified configuration-overlay run is a truthful primary demo. Keep the
pagination rejection as a visible example of the checker refusing an incorrect
patch. Do not claim every example repairs successfully or that saved evidence
makes new generation available. See the concrete
[judge operations plan](../../../docs/judge-operations-plan.md) for the remaining
pricing renewal, reserved capacity, implementation and owner decisions.

## Implemented renewal and public reopening (23:17 UTC)

Renewable source/budget/policy-bound evidence, hourly read-only catalog
verification, separate expiring fee attestations, atomic failure states and
per-run receipt recording are implemented and deployed. All 74 final regression
tests and typechecking passed. Real isolated-container startup and rejected
admissions for paused/missing/changed-price/failed-monitor states passed in a
no-cost preflight against a ledger copy. The approved internal allocation was
then synchronized by CAS to revision 3 without changing the $25 total, expiry,
19 reservation rows or $2.35 holds. The historical $5 smoke cap was an internal
allocation, not a permission gap for judge use.

The hourly verifier uses the existing credential and account permissions. No
new credential, account grant, external notification, hosting purchase or
additional paid call was needed. The previously approved audited resume cleared
only the operator pause. Public GET checks confirm healthy runtime, enabled
creation, both curated tasks, 90 remaining reservations and preserved evidence
exports. There are no denied or pending live-control approvals.

Daily account-fee review remains real operational maintenance; the timer does
not forge that observation or extend old evidence. Parent can handle user-only
notifications. Missing renewal, changed prices, exhausted capacity or accounting
uncertainty close generation while saved evidence remains accessible. A perfect
pagination repair, unlimited public traffic, an access-queue redesign or a new
budget grant are not requirements for this checked-maintenance demo.
