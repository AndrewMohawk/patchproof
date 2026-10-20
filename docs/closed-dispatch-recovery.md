# Historical closed-dispatch exposure recovery

Status checked October 20, 2026 at 19:55 UTC. Independent review and the complete
780-test serial suite passed. Isolated release `ca783e2c8bca604d93e01381399459286f38693e`
is deployed. The exact historical coverage event was appended once: sequence
100 to 101, with every reservation row unchanged and all $3.60 held. Historical
actual cost remains null, settlement incomplete, and redispatch denied. Public
generation admission is ready for two curated tasks. No inference call was made
for this restoration. See the [production restoration receipt](../research/verification/20261020-isolated-recovery/production-restoration-receipt.json).
The dated validation sections below retain the preceding failures and decisions.

The exact approved image was restored on October 20 before the 18:34 UTC pricing
review. Its identity and protected execution passed. Account-fee evidence was
genuinely reviewed and refreshed separately at 18:34:25 UTC; authenticated catalog
verification completed at 18:34:27 UTC. These operational observations do not
supply the missing competition release receipts.

## Why the historical request blocks admission

Run `06e10471-44b0-4b5c-80b9-a01f9eabd5f9` dispatched one native HTTP request,
`chatcmpl-aa7682ce8eecf855`, on October 20 at 04:03 UTC. The adapter read the
complete successful HTTP response and retained its ID and 3,046 input / 4,000
output tokens. Full completion-envelope parsing failed before accounting receipt
persistence, returned-model equality, and token-overrun validation. The exact
malformed field is unknown because the raw response was not retained.

The durable intent and closure files, terminal run evidence, historical config,
and source manifest bind this request to a closed execution. All 172 source
manifest entries were checked against commit
`2595f7d41a3f5b23e5b65d8685c0a1a953ee39a4`. The historical source enabled thinking
for edit-region requests even though its generic runtime description said false.
Historical evidence is immutable: that discrepancy is disclosed in the reviewed
case, not retroactively corrected. Current request settings and runtime description
now share one constant.

The existing receipt-based `closed-token-factory-inference-v1` contract is
unchanged. Its response digest requirement cannot truthfully be satisfied for
this request. A journal hash must not be passed off as a response hash.

## Separate policy and exposure bound

`packages/orchestrator/src/closed-dispatch-recovery.ts` pins exactly this case,
including reservation, fingerprint, source/config, bundle, dispatch/closure,
pricing/fee evidence, request settings, observed usage and missing evidence.
Changing a binding, adding another historical case, or accepting a different
assumption requires code review. Caller-supplied booleans or lower rates cannot
expand this policy.

The assumptions are explicit: the provider honors the requested model's rates,
`max_completion_tokens` includes reasoning, `n=1` is honored, and the reviewed
native-fetch implementation and complete durable inventory exclude hidden retries
and other billable operations. Returned-model identity and settled cost remain
unknown. This is a provider-contract exposure bound, not a claim that the old
adapter completed its later validation steps.

Each call is bounded by 262,144 input tokens and 4,000 completion tokens at
$0.30/M and $0.90/M. Rounding each call upward gives $0.082244; conservatively
covering all three permitted calls gives **$0.246732**, including the historically
verified zero additional fee. There is one actual intent, not three invented
requests. The full **$0.25** remains held. Historic fee validity covers dispatch;
new work still needs its own current price/fee verification and admission gates.

## Preparation and application contract

`prepareClosedDispatchCoverage` is a pure offline function. It checks canonical
hashes of the retained source lock, config, evidence bundle, open dispatch and
closed accounting record against the reviewed pins. It does not read credentials
or open a ledger. Config paths are not credential contents; callers must never
follow the credential-file reference for this operation.

After an independent review and separate authorization for production changes,
a trusted serialized operator would obtain a fresh ledger checkpoint containing
its event sequence, approval revision/digest and approved total, prepare the proof
from the authentic artifacts, and review it before applying. The checkpoint is
valid for at most five minutes. An intervening write requires fresh review.
No production proof, ledger append, or attestation renewal is included in this PR.

`BudgetLedger.coverClosedDispatch` requires both `allow-covered-inference` and
`closedDispatchRecoveryPolicy: 'historical-20261020-closed-dispatch-v1'` on the
connection. The private live config can explicitly select this exact policy to
recognize already reviewed coverage; omission blocks it, and configuration digest
binding detects changes. Startup never prepares or appends a recovery proof. No
actual operator config is changed or opted in by this PR. Receipt-only and strict
connections continue to block this case.

Inside `BEGIN IMMEDIATE`, application rechecks the exact reservation, unknown
cost, full retained hold, current approval, checkpoint freshness, sufficient cap,
and latest incomplete-accounting event. It rejects sticky freezes, outstanding
reserved work, another uncovered pending dispatch, prepared receipts, or changed
accounting evidence. It appends exactly one
`historical_closed_dispatch_exposure_covered` event. No reservation row, run row,
receipt or approval is rewritten.

A retry after a lost acknowledgment returns the same accepted event, including
after restart or proof-expiry, without creating another event. That does not
extend review validity for a first append. Later reservation/accounting events
or approval revision changes invalidate coverage. Neither proof type can silently
replace invalidated coverage. The hold continues to consume the global and stage
budgets, and the historical reservation remains non-dispatchable. A genuine final
bill can subsequently be processed by the existing authoritative reconciliation
path; this recovery must never manufacture one.

## Offline verification

Tests exercise historical artifact bindings, explicit policies, unchanged money,
unknown settlement, idempotent replay, restart/SIGKILL persistence, failed SQLite
writes and rollback, simultaneous processes, expired/future/stale checkpoints,
altered source/pricing/fees/retry claims, prepared and later accounting evidence,
reduced/exhausted caps, outstanding reservations and sticky freezes. The runtime
regression sends a synthetic malformed completion through the real adapter and
coordinator, confirms durable receipt-based coverage, and checks that repeating
the request does not dispatch again. No test makes a paid inference request.

## Historical pre-restoration validation (October 20, before 18:25 UTC)

The real-history offline simulation used a private SQLite backup and an expired,
fixed test clock. All 24 reservation rows remained unchanged;
$3.60 stayed held and $21.40 stayed available. Coverage changed from 20 to 21 only
in the copy, survived reopening, and remained idempotent. Historical redispatch
was rejected. The production ledger was read only for the backup and was not
opened by `BudgetLedger` or changed by the simulation.

At that earlier observation, the full-suite Docker integration could not find the pinned
image `sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51`.
Read-only Docker inspection then confirmed the image was absent and the production
release pins that same image. No image had then been downloaded or substituted. HTTP health
alone does not establish usable execution; restore the exact image and pass a
fresh protected container check before reopening.

Ten non-container broad-suite failures were reproduced on the unchanged parent
commit `89e1ffe8c30942901af345438afb5cd1ee5786ee`: one frozen fixture count expects
20 files but finds 21 after the historical Humanize addition, and nine export or
release tests omit the required `fixtures` directory from their synthetic project.
Eight Docker-dependent tests fail while the pinned image is unavailable, including
the public scripted abstention control. These tests, fixtures and image pins remain
unchanged. The full result is 766 passed / 18 failed / 0 skipped; the focused recovery,
receipt, config and runtime suite is 84 passed / 0 failed. See the committed
[offline validation receipt](../research/verification/20261020-closed-dispatch/offline-validation.json).

## Isolated candidate verification after restoration

The full suite on `ab701dfc` completed with 769 passed, 10 failed, one cancelled
(timeout), and zero skipped, out of 780 tests. The malformed-completion end-to-end
regression passed. A sequential rerun of affected files, with unchanged deadlines,
passed 46 of 49 tests. The three persistent failures reproduce on deployed
`b2eb1732`: two synthetic projects omit model-discovery metadata, and an accounting
observer deadline test exceeds its 2.5-second assertion (about 3.65 seconds on
both revisions). No timeout or assertion was weakened. Concurrent-run failures
that passed sequentially remain recorded; the full suite is not a clean pass.

The genuine historical release-input manifests were audited on both revisions.
Both return the same blocked gates: expired September scan receipts, nine missing
release receipts, and inherited configuration/research prerequisites. No accepted
live protocol was found in the searched project evidence. These are not current
judge-access or competition-ready attestations. See the [full-suite and audit
receipt](../research/verification/20261020-isolated-recovery/full-suite-audit.json).


## Corrected test-only candidate (October 20, 19:15 UTC)

Commit `d09984addc9858226ce1e36369d8cc4836008227` supplies the required
model-discovery metadata to two synthetic projects and measures observer elapsed
time from actual observer entry. The 1-second observer timeout, 2.5-second
assertion and incomplete-billing checks remain unchanged. No production code
changed from reviewed `ab701dfc`.

The full suite with `--test-concurrency=2` completed: **779 passed, one failed,
zero cancelled or skipped**, of 780. All three corrected tests passed. The
remaining composed fake-provider operator test accepted zero of two expected
accounting receipts. A temporary diagnostic copy passed alone with unchanged
deadlines/assertions and both receipts accepted. Its earlier full-suite failure
remains unresolved; the standalone pass does not replace the failed suite.
See [corrected suite results](../research/verification/20261020-isolated-recovery/corrected-suite-results.json)
and [documented operational checks](../research/verification/20261020-isolated-recovery/operational-checks.json).

Production deployment and one-run recovery remain pending review and applicable
checks. The generic research/competition audit remains separately blocked with
its genuine-input results preserved; no receipt, waiver or bypass was invented.


## Complete serial validation (October 20, 2026)

The complete suite on `932a6653d5055517c55821f3c3e89139c33bf89e`, run with
`node --test --test-concurrency=1 tests/*.test.ts`, passed **780/780**, with zero
failures, skips or cancellations. No runtime deadline, assertion, repeated check
or durable write was changed. The composed operator and malformed-completion
end-to-end regressions passed. Prior concurrent failures and their reproduced
pre-accounting sandbox timeout remain preserved, not superseded or erased.

A genuine authenticated catalog check at 19:28:13 UTC produced candidate-source
bound evidence valid until 20:38:13 UTC. Its existing reviewed fee evidence still
expires October 21 at 18:34:25 UTC; no fee timestamp was extended. The production
ledger stayed at sequence 100/revision 3 with all $3.60 held and identical
reservation rows. Public health and task endpoints returned 200, with new runs
still paused for accounting review. All 23 journaled production runs were terminal
at the read-only snapshot. This is not a deployment lease or permission to skip
fresh recovery checks.

See [serial validation receipt](../research/verification/20261020-isolated-recovery/serial-suite-results.json).
Deployment and recovery remain pending final review and current operational
checks. The generic research/competition audit remains separately blocked.
