# Judge operations through December 15, 2026, 20:00 UTC

Renewable evidence controls and the shared budget allocation are implemented.
See the dated deployment receipt and live `/tasks` response for the actual installed
state. October 20 recovery restored admission with all holds retained; October 21
catalog drift then blocked admission. Cache-price compatibility restoration is
recorded separately under `research/verification/20261021-cache-pricing/`.
A successful configuration repair and a correctly rejected pagination repair are
accepted demonstrations of checked maintenance; a perfect pagination repair is
not a reopening requirement. Failed attempts remain visible.

- Verified walkthrough: https://patchproof.andrewmohawk.xyz/#evidence/352bcf84-ffa2-4668-801c-af258ea79e2c
- Rejected walkthrough: https://patchproof.andrewmohawk.xyz/#evidence/3171cb35-a100-4b01-92b9-0a51642992b6

## Approved shared capacity

The October 16 approval covers verification AND judge demo use within the same
$25 TOTAL, including historical usage and fees. The old $5 smoke/$20 pilot split
was an internal allocation, not a permission boundary. The live controller's
existing stage name `smoke` now contains the shared $25 pool; all other stages
are zero. Synchronize the existing ledger by explicit compare-and-swap. Never
create a second budget, reset accounting or release unresolved reservations.

At the October 21 pre-deployment snapshot, $3.60 remains held and $21.40 remains
available: at most 85 additional $0.25 reservations. This is finite capacity,
not a guarantee of 85 successful repairs or uninterrupted access. Failed and ambiguous requests
retain their holds; verification and judge requests draw from the same total.
No further permission is needed merely to use the already approved judge purpose.
No automatic increase, hosting purchase or inferred trial-credit allowance exists.

## Implemented evidence controls

`packages/orchestrator/src/renewable-pricing.ts` validates source, budget and
policy bindings, exact model/context/FP4, bounded verified rates and zero supported
fees, a maximum 70-minute
catalog window, and separate account-fee evidence no older than 24 hours.
Following explicit October 21 approval, current input/output/cache token rates
may change if the conservative cost of all three calls still fits the unchanged
$0.25 reservation. Every input token uses the greater of ordinary and cached-input
rates. Decimal rates and each request cost round upward. Nonzero request or other
unsupported fees, missing/malformed/unbounded prices, model/context/FP4 changes,
and unknown pricing dimensions still fail closed. Harmless descriptive metadata
does not block verification. During a run, the component-wise maximum of all
verified rates must also fit the hold; this prevents mixing two individually
affordable schedules into an unaffordable combined bound. Durable accounting
records bind that ceiling and every accepted pricing receipt. Historical holds
and actual costs are unchanged; no settlement is inferred from a lower rate.
Every admission and paid dispatch revalidates current evidence against the
original run deadline. Missing, malformed, future, stale, blocked or mismatched
evidence closes admissions. Valid catalog observations cannot extend fee evidence
or the December 15 approval. The $0.25 hold, three calls, 12,000 aggregate output
tokens, 600 seconds, repeated checks, isolation and single flight are unchanged.

`scripts/verify-live-pricing.ts` performs one authenticated GET to the existing
model catalog. It writes private immutable receipts and atomically replaces the
current state. A failed observation immediately writes a blocked state. A
single-writer lease prevents overlap; a crashed process can be recovered by the
existing dead-process lease logic. A failed write cannot extend the preceding
short-lived receipt. Request size/time and service resources are bounded.

`deploy/patchproof-pricing@.service` and `.timer` provide hourly on-host execution
using the existing credential, UID and catalog endpoint. This requires no new
account-access grant, key or persistent account permission. Installation/enabling
is an operational deployment of the authorized verification; any exact action
rejected by approval review must still be reported before proceeding. The timer
never resumes generation, changes the budget, reconciles holds, makes inference
calls, or sends external notifications. It does not read account billing PII.

Renewed pricing receipts are embedded in per-run evidence events and immutable
accounting records. The old October 16 receipt remains a historical rate/fee
anchor, not the renewal authority when renewable verification is configured.

## Account-fee renewal runbook

Account-fee automation is not established: the observed dashboard is aggregated,
and a supported authoritative per-operation/account-fee API has not been verified.
Do not guess endpoints, mint credentials, reuse browser session secrets, or
pretend hourly model-catalog reads renew tax/fee verification.

The October 21 actual account review produced fee evidence expiring October 22
at 16:17:45.204 UTC. Its full-run cutoff is 16:07:45.204 UTC. Review again
before that cutoff, with a primary and backup scheduled early enough to respond.
The actual next expiry in the private receipt governs; a suggested cadence never
extends it. Hourly catalog checks do not perform this account review.

1. Using existing authorized access, inspect account billing status, account
   model prices, applicable fees/taxes and the authoritative published policy.
   Record a dated minimal review receipt with source references and observations;
   retain no billing PII, card details or credentials. If anything is unknown or
   changed, keep generation unavailable and investigate; do not reuse old facts.
2. Create a private fee attestation with `schemaVersion: "1.0"`, actual
   `verifiedAt`, justified `validUntil` no more than 24 hours later,
   `evidenceDigest` of that new review, `accountBillingActive: true`,
   `additionalFeeUsdPerRun: 0`, and
   `basis: "operator-reviewed-account-pricing-and-fees"`. Zero fees must have
   been verified; a nonzero or unknown fee needs a reviewed pricing policy and
   conservative reservation calculation, not this zero-fee renewal path.
3. Atomically replace the configured `feeEvidenceFile` in its existing private
   directory with mode 0600. This is evidence renewal, not credential creation.
   Never extend the prior attestation by changing only its date.
4. Start the installed `patchproof-pricing@<release>.service`, or invoke the
   committed verifier once with the explicit existing private config. Check its
   JSON result, current receipt, fee expiry and public `/tasks` availability.
   Catalog verification makes no paid calls. A blocked result stays blocked.
5. Any public resume uses the existing audited operator-pause control at the
   current ledger checkpoint after reviewing pricing, budget and actual health.
   The verifier cannot clear the pause or any financial freeze.

A named primary and backup must own these observations through December 15.
This is an operational responsibility, not a new spending grant. Parent can
handle user-only reminders/notifications; this deployment creates none.
Without a completed renewal, fail closed and keep saved evidence accessible.

## Readiness and incident procedure

Inspect the current service/timer status, latest verifier JSON, `/healthz`,
`/tasks`, available reservations and nonterminal runs. Alert the owner on failed
or stale verification, unavailable generation, uncertain accounting or five or
fewer remaining reservations. A destination for external messages would require
separate authorization; no such messages are sent here. Do not release holds
based on aggregated usage; invoices or authoritative per-operation records are
needed for reconciliation.

The implementation is tested for exact expiry, fee and price changes, source/
budget/policy mismatch, failed fetches, private atomic writes, overlapping
writers, loss of evidence during baseline, preserved exported evidence, budget
exhaustion, pause state and concurrent admission. A real no-cost preflight also
checks isolated-container startup against an isolated ledger copy. See
`research/verification/20261016-demo-repair/renewable-final-tests.log` and
`renewable-preflight.json`.

Keep the service paused when deploying changed policy. Review any source/config
binding mismatch; never make the old receipt valid by editing its timestamp.
If the timer crashes, its receipt expires in at most 70 minutes and admissions
stop ten minutes before that. Restart the reviewed verifier after diagnosing
the failure. No model retry is needed just to verify a pricing renewal.

Use the existing host only. No unrelated workload shutdown, new paid hosting,
credential creation, persistent access expansion or security-setting changes
are authorized by this plan. Existing read-only service continuity and disk/log
headroom need normal operator care; no uptime guarantee is invented.

At December 15, 20:00 UTC approval expires. The last possible admission is 19:50
UTC when all other evidence remains valid. The verifier refuses catalog access
once the full run no longer fits the approval window. Stop the timer at handoff,
preserve accounting/receipts, and retain read-only access only within existing
hosting authorization. No automatic purchase, renewal or extension follows.
