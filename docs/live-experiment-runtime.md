# Guarded live experiment runtime

`createLiveExperimentExecutor()` in `packages/orchestrator/src/live-experiment.ts`
is a separate trusted factory for the execute side of `DispatcherTransport`.
It constructs the existing Nebius model and sandbox adapters, then uses the same
revision-loop core as the synthetic experiment executor. It does not accept an
arbitrary caller-supplied model/checker with a changed mode label. The synthetic
constructor still requires synthetic components and its policy digest is unchanged.
Product and three-proposal smoke behavior and frozen product schemas are unchanged.

The factory is implemented and tested with injected fake HTTP transports and invented
proofs. **Actual live execution, calibration, account verification and provider
billing remain NOT RUN.** No accepted real calibration record, account access or
approved live limits are created by this implementation. A successful synthetic
unit test is not a model result, account receipt or benchmark result.

## Trusted input boundary

`LiveExperimentOptions` requires explicit settings, an accepted calibration record
and its independently accepted canonical digest, model/account/rate/license/context
proof, a bound tokenizer counter, sandbox/control/CPU proofs, source verifier,
private trace store, existing project ledger, exact reservation projection,
phase-accounting observer and repair-visible fixture-byte loader. Credential
callbacks and transports are injected and captured once. No home/environment
credential discovery, CLI, fallback or adjudicator callback exists in this factory.

`LiveExperimentAcceptanceSchema` binds the exact prospective policy, model lock,
source, sandbox verification and CPU proof digests. It records that calibration used
only development data, no final feedback changed the policy, provider sampling defaults
were reviewed, and the configured host-overhead allowance was established. Its
canonical digest must be present in `acceptedProofDigests`. That list is trusted
intake context, not proof that the statements are true: hashes/booleans/reference
strings do not authenticate an account or establish calibration.

The model lock is `digestJson(buildLiveExperimentModelLock(...))`; it includes the
exact model proof digest, tokenizer digest, account-verification time and rates.
No temperature, seed or other unsupported request field is invented. The adapter's
existing request behavior remains JSON output, streaming off and provider sampling
defaults. The recorded experiment seed is not sent and is not a determinism claim.
The tokenizer must conservatively count the actual full prompt and framing; the
factory checks that its count plus the per-call output cap fits the verified context.

For live experiment/session/export wiring, `acceptance.sourceDigest` is
`digestJson(buildOperationalLock(root).sources)`. The injected verifier must recompute
that exact source-map digest. Historical smoke configuration uses the whole lock
digest instead; those two conventions must not be substituted. Policy digests use
`hashJson(buildLiveExperimentPolicy(settings))`; fixture identity uses the exact
repair-visible JSON file bytes before parsing; selected-source identity uses
`hashJson(files)`.

The trusted loader alone projects fixture bytes. The executor discovers no paths,
opens no evaluator workspace, and receives no oracle digest, gold source or sealed
adjudication definitions. It validates byte identity and task/repository mappings.
Runtime declared checks remain in the host comparator; the model gets visible
checks and the variant-permitted observation messages. Sandbox payloads contain
candidate source and invocation arguments, never expected values or check definitions.

## One grant, one execution

The dispatcher remains the only creator of the aggregate episode reservation and
`markAttempted` grant. The factory never calls reserve, markAttempted, reconcile or
cancel on the ledger. Its trusted `reservationForExecution` callback accepts the
strict public execution projection (without checkpoint) and returns only:

```ts
{
  reservationFingerprint, stage, amountMicros, dispatchId, publicInputDigest
}
```

The protected metadata layer computes the original dispatcher fingerprint without
exposing its private episode fields. The factory compares it with the existing
ledger record: exact dispatch/episode identity, stage, amount, fingerprint and
attempted state. It also checks current approval/source/account gates before new
work. The factory must be constructed **before** the dispatcher attempts the grant;
an attempt timestamp older than construction is rejected. Together with an in-memory
seen-dispatch fence and the immutable trace claim, this prevents restart/resume or
repeat execution through this factory. A missing grant never resolves credentials.

Use the same designated project ledger across all sessions. A different file is not
another allowance; this trusted local module cannot protect against a same-UID owner
replacing all state or intentionally constructing alternate ledgers.

## Prospective entire-episode envelope

The accepted policy is 24 calls/revisions, no original-source checker feedback,
24 candidate feedback batches and two raw observations per batch: at most 48 raw
batches. P has three sequential round-robin progressive branches; B0/B1 have one.
Stopping, feedback scope, coverage requirements and tie-breaking reuse the shared
kernel. All variants receive the same overall caps and envelope computed using all
visible plus declared runtime cases, even when B0 executes visible cases only.

The factory checks every bound before credentials or provider calls:

- The full aggregate input/output ceilings at the pinned quoted rates, rounded up
  in integer microdollars, plus 48 full sandbox batch ceilings fit the runtime spend
  allowance. A separate adjudication reserve remains in the dispatcher reservation.
- With `N = 48 × all_runtime_cases`, verified quota `q`, per-operation overhead `h`
  and runtime CPU allowance `C`, each guest timeout is capped at
  `floor((C/N - h)/q)`, further limited by the verified API/batch caps. Thus
  `N × (q × guest_timeout + h) ≤ C`, conditional on the attested controls.
- The prospective wall sum is `24 × model_call_cap + 48 × raw_batch_cap +
  accounting_wait_cap + one_cleanup_cap + attested_host_overhead`. It must fit
  the 900-second episode after the reserved adjudication wall slice. The host also
  enforces the aggregate runtime deadline. A failed batch stops the run, so the
  failure path reserves one bounded cleanup window rather than retrying batches.
- Adjudication's CPU/spend reserve must cover its independently supplied CPU/rate/
  fixed-cost bounds for its reserved wall slice. The dispatcher still recomputes
  its remaining allowance from known runtime measurements before adjudicating.
- Upload/instance POST counters and the possible complete intent/ID inventory fit
  their prospective bounds and the dispatcher's 1,000-handle limit. No extra retry
  is permitted after uncertain submission or cleanup.

These CPU and wall calculations are conditional resource ceilings, not measured
usage. Host-overhead calibration and scheduler/timeout assumptions are external
verification obligations. Synchronous filesystem or tokenizer work can delay signal
handling; an absolute operating-system kill guarantee is not claimed. Unknown
provider CPU remains unknown until an accepted observation establishes it.

Sandbox batch reservations also use exact microdollars, avoiding cumulative floating
error at the 48th batch. This arithmetic change does not create a second durable grant
and does not convert a quoted price into actual billing.

## Actual accounting and finalization

The existing adapters deliberately leave measured USD `null`; the provider's sandbox
`resources.cost` field has unspecified currency/units and is never interpreted as USD.
Known CPU/tokens/handles checkpoint after observations, including failures. Missing
measurements stay unknown; positive retained partial measurements are lower bounds.

After runtime operations quiesce, the factory records one immutable runtime phase
accounting request in its trace. The request binds dispatch, episode, reservation,
plan, model, policy, source, exact safe checkpoint and complete known handle inventory.
It contains counters/IDs only, never candidate or oracle data. The injected
`PhaseAccountingObserver` may wait, within both its own configured cap and the
remaining runtime deadline, for independently accepted actual receipt metadata.

A complete result requires the exact checkpoint and every current operation ID,
an accepted receipt digest, measured USD and CPU no lower than retained observations,
and all billing/CPU/inventory/cleanup/final-retention flags. Cumulative phase amounts
replace aggregate fields; they are never added to earlier partial totals. Runtime and
adjudication scopes are disjoint. Quotes, stale/malformed receipts, incomplete retention,
missing IDs, unknown values and an observer ignoring abort cannot yield a finalized
selection. Source/grant validity is rechecked after receipt observation.

The observer and executor never release a reservation. Phase completeness is not
whole-episode completeness. The unchanged dispatcher known-USD/known-CPU gate precedes
adjudication, and only the independently established whole-episode reconciliation can
release a remaining hold. Missing accounting terminates without retry and retains
intent/operation evidence and the project hold.

Cancellation prevents new work, while GET/DELETE cleanup of known operations can
continue under the existing bounded cleanup signal after approval/source/new-work
gates close. The owned live checker is awaited through its cleanup before the executor
finalizes failure evidence. Unknown creation responses cannot be mapped to remote
objects by an invented idempotency API; no immediate atomic cleanup is claimed.

The separate immutable experiment trace records the accepted bindings, prospective
envelope, source/branch history, observations, selection and accounting request/result.
Runtime traces set `benchmarkExecuted: false`: this module alone never performs sealed
adjudication or establishes a scored benchmark. Tests using fake transports do not
make that claim either.

## Tested scope

`tests/live-experiment.test.ts` covers constructor/grant/envelope denial before
credentials, full 24-call/48-batch fake lifecycle, no additional ledger grant,
unknown/incomplete accounting, stalled observer/credential cancellation, post-dispatch
cleanup after source/ledger closure, malformed response identity/usage retention and
capture of trusted dependencies against caller mutation. Existing synthetic executor,
smoke, model and sandbox tests verify compatibility. No test calls an actual provider,
executes candidate Python, reads sealed evaluator data or spends money.

Account calibration, tokenizer/model compatibility, real control enforcement,
independent runtime billing/retention receipts, actual sponsor execution and a scored
24-round experiment remain **NOT RUN**. Verification commands and source hashes are
recorded under `research/verification/20260927-live-experiment/`.
