# Synthetic experiment executor and shared loop

`packages/orchestrator/src/episode-engine.ts` contains the serial revision loop
used by both the existing product Coordinator and the new experiment adapter.
Product and trusted smoke runs retain the original three-proposal behavior,
initial-source checks, P proposals from the original source, and current evidence
contracts. This extraction does not turn their results into experiment evidence.

`createSyntheticExperimentExecutor()` returns the execute side of
`DispatcherTransport`: `{executionMode, modelLockDigest, policyDigest, execute}`.
The caller supplies the separate adjudicator when constructing a dispatcher. The
executor receives no oracle digest, oracle definitions, gold source or adjudication
callback. It neither discovers fixture paths nor opens an evaluator workspace.
An injected trusted loader supplies the exact repair-visible fixture JSON bytes.
The adapter checks their SHA256 before parsing, matching the public fixture
manifest convention. Selected-file digests use the dispatcher's `hashJson(files)`;
local binding and trace objects use canonical digests where explicitly recorded.

## Prospective policy

The new policy is explicitly **uncalibrated and synthetic-only**. Its digest binds
the schedule, feedback rules, stability protocol and configured prospective bounds.
It does not change the frozen evaluation grid or claim a completed experiment.

| Variant | Source trajectory | Runtime feedback | Final selection |
| --- | --- | --- | --- |
| B0 | One progressive branch, at most 24 revisions | Visible checks only, with every stated requirement in the prompt | Latest revision; stop when visible checks pass |
| B1 | One progressive branch, at most 24 revisions | Visible and declared runtime acceptance checks | Latest revision; stop when all declared requirements have passing coverage |
| P | Three progressive branches, sequential round-robin, at most eight revisions per branch | Same declared runtime checks as B1, with that branch's prior feedback | Highest passing-check count; earliest revision breaks ties; stop on complete declared coverage |

There are **zero original-source check batches** in this experiment policy and no
initial checker feedback in the first prompt. Each completed candidate check batch
counts as one runtime-feedback round. The adapter constructs `RepeatedCheckRunner`
itself, so a batch means two actual runner invocations; at most 24 candidate batches
mean at most 48 raw batches. Infrastructure-interrupted partial batches retain
observations and usage but are not counted as completed feedback rounds. Repeated
disagreement stops with `flaky_check`; no further candidate receives that feedback.
Declared runtime acceptance-check definitions and expected values remain in the
trusted checker. The model receives ordinary visible tests (including their public
expectations) and only the policy-permitted observation messages.

All variants share input/output/call, wall, CPU and spend ceilings. The synthetic
configuration includes a per-call output cap and an adjudication reserve for wall,
CPU and money. Runtime stops before consuming that reserve. A conservative bound
allows all 48 raw batches using the supplied synthetic CPU units and per-batch
overhead; an allowance below one execution second is refused. Synthetic bounds
are test inputs, not verified provider controls or calibrated production defaults.
Seeds are recorded as episode metadata and are not sent as invented API fields;
no determinism or fixed sampling claim is made.

B0's runtime approval is explicitly visible-only. It cannot use acceptance scores
for feedback, stopping or selection. B1/P approval requires a passing executed check
for every declared requirement. Independent sealed correctness is always a separate
dispatcher result, never inferred from runtime approval.

## Boundaries and durable records

The constructor rejects a live model provider, a runtime without a synthetic marker,
or a checker without a synthetic marker. It supplies no credentials, network
transport, CLI path or fallback. A separate [guarded live factory](live-experiment-runtime.md)
constructs the real adapters only behind accepted protocol/account/control and
dispatcher-grant gates; this synthetic constructor cannot issue that authority. Injected synthetic dependencies are
trusted local code; a caller falsely labeling arbitrary code synthetic is outside
this marker check's assurance. No real provider integration was performed.

The adapter creates no BudgetLedger reservation or dispatch grant. Those remain
the dispatcher's responsibility. The existing live known-CPU/known-USD gate before
adjudication is unchanged. The executor's counters describe simulated activity in
synthetic traces and never count as actual provider usage or scored results.

`ExperimentTraceStore` makes one exclusive private claim per dispatch UUID, writes
sequenced, hash-linked records with fsync, and finalizes a content-addressed immutable
trace. Sources, branch parents, proposals, diffs, raw observations, selection and
usage are retained. This separate format can store 24 revisions without changing
the product format's three-candidate limit. Claims, records and final files reject
symlinks and overwrites. A new process can read a verified final object, but cannot
resume a partial claim or silently retry its episode. Hashes prove byte consistency,
not the truth of synthetic or external observations.

Model intent and checker operation handles are durably checkpointed before side
effects. Independently valid response IDs and reported counters survive malformed
proposals and typed failures. Raw check observations checkpoint after each repetition,
so a failed second repetition does not erase the first. Missing accounting causes
`billing_incomplete`; retained positive CPU/cost counters on failure are lower bounds,
not complete charges. Errors and cancellation preserve claims and partial records,
fence late callbacks, and never initiate a retry. Arbitrary exception text is withheld;
unknown failures use the non-excluded `execution_or_setup_failed` reason.

The trace store is local evidence persistence, not remote operation cleanup. A
runner must honor its supplied deadline and operation callback. Ignored cancellation
cannot be repaired by post-hoc accounting. No autonomous remote crash reconciliation,
provider billing reader or live restart/resume is implemented here.

## Verification and remaining gates

Tests use invented fixture bytes, simulated model responses and simulated checker
observations only. They execute no candidate Python, access no sealed fixture, call
no provider and reserve no paid resources. The focused commands are:

```sh
node --test tests/experiment-executor.test.ts tests/experiment-trace-store.test.ts
node --test tests/orchestrator.test.ts tests/repair-policy.test.ts tests/trusted-smoke.test.ts
npm run typecheck
npm run check:contracts
```

The executor connects to the public dispatcher interface in a synthetic integration
test; independent adjudication there is an invented aggregate response, not an oracle
execution. Existing product/smoke regressions verify the shared-loop refactor.

Real execution remains **NOT RUN**. The separately implemented live factory still requires actual development-data
calibration, exact model/license/context/tokenizer/sampling verification, real account
controls, a prospective full-episode cost/CPU/wall envelope including adjudication,
durable grant verification, actual billing reconciliation and verified cleanup.
The synthetic factory must not be enabled by changing its output label to `live`.
