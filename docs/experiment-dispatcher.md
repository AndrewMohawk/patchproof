# Trusted experiment dispatcher

`workers/evaluator/dispatcher.ts` joins the existing `ExperimentPlan`, an injected bounded executor, independent adjudication and `EpisodeResult` accounting. It validates the existing 72-episode pilot or 270-episode final grid; it does not create another experiment protocol. Current repository plans remain unexecuted. No real-provider benchmark was run while implementing this module.

Create one `ExperimentDispatcher` with an absolute database filename in a private evaluator directory, the frozen plan and a `DispatcherTransport`. The transport declares `synthetic` or `live`, and must match the plan's model and policy digests. Live construction also requires `BudgetLedger`, a current execution-gates callback, and verified prospective adjudication bounds. Store the database, sidecars, selected artifacts and billing evidence outside candidate access. Created files use 0600; the immediate parent must be owned and private, and symlink paths/sidecars reject.

SQLite stores the complete plan, execution mode, transport-bound digest and one deterministic UUID per planned episode. That UUID also identifies the budget reservation, adjudication and runtime owner. A transaction claims an episode once across connections. Changed plans, modes or transport bounds cannot reopen the database under different assumptions.

`dispatch(episodeId, signal)` handles one planned episode. `runAll(signal)` walks the frozen grid. `get`, `snapshot` and `events` expose progress and aggregate records. A snapshot always includes every planned identity, including pending and active entries; it declares completion only when all are terminal. Failed setup, cancellation, missing billing and interrupted execution become recorded rows. Repeated dispatch returns the existing state instead of starting another attempt. This also means terminal gate failures cannot silently become retries after configuration changes.

The executor receives only episode identity, task/repository identity, variant, repetition, seed, frozen limits, fixture digest and public plan/model/policy bindings. It receives no oracle digest, checks, adjudication callback or verdict. It must return `selectionFinalized: true`, one selected artifact and its digest (or null), runtime approval, cumulative usage/billing status and an artifact digest. Its `checkpoint` callback durably records cumulative observed usage and operation IDs during execution only. Record operation intents before side effects. Known positive CPU/cost observations cannot be replaced with null or smaller totals.

The dispatcher copies and durably records the selected artifact before calling the separate adjudicator. A retained execution callback cannot change usage after this boundary. The adjudicator receives the frozen fixture/oracle digests, selected files/digest, finalization marker, owner UUID, operation callback and remaining resource allowance. It returns the existing aggregate adjudication shape. Correctness requires a nonempty, internally consistent completed check set. No verdict or sealed detail is returned to the executor, and exceptions are represented by controlled failure reasons rather than private exception text.

The existing `adjudicateSelectedCandidate` remains the one-use external-workspace boundary. Its optional `ownerRunId`, `onOperation` and `timeoutSeconds` arguments now forward to the trusted check runner. An adapter can call it with the dispatcher input plus explicit external `workspace`, `projectRoot`, `checks` and `signal`; no sealed content belongs in the source repository. Its original external selection marker prevents another patch or retry from consuming the same adjudication identity.

Live execution requires the existing readiness gates and a durable budget reservation before the single dispatch grant. The episode's reservation covers setup, repair attempts, retries and final adjudication together. The first live preflight checks the whole experiment allocation; later dispatches recheck current boolean gates and their immediate remaining monetary allowance, while the ledger enforces current project/stage caps and approval revisions. Unknown billing prevents additional episode dispatches.

Before paid adjudication, runtime billing and CPU must be known. A trusted, verified bound supplies maximum concurrent CPU units, maximum USD per second and fixed setup charge. The dispatcher limits the next batch to the minimum of 120 seconds, remaining episode wall time, remaining CPU divided by that CPU bound, and remaining money after setup divided by the price bound. Less than one available second rejects. The adjudicator receives both the allowance and a corresponding abort signal. These bounds must conservatively cover the actual runner, all cases, setup, cleanup, concurrency and cancellation latency; configuring numbers without provider evidence is not verification.

Result usage adds adjudication CPU, elapsed time and cost to runtime observations. Monetary components round upward to integer microdollars before addition. Incomplete billing is null in result rows and retains the ledger hold. Measured overruns remain recorded and freeze new reservations; the analyzer suppresses budget-violating comparisons. A runner that ignores cancellation or understates its bounds cannot be made safe by post-result accounting, so the concrete live runner must enforce the prospective ceiling itself.

Cancellation terminalizes undispatched episodes and aborts active work; it retains operation IDs and uncertain charges. `recoverInterrupted()` only terminalizes episodes whose recorded process is no longer alive on the same host. It never resumes repair or reruns adjudication. Live/PID-reused owners are not stolen. Restart and exception rows preserve captured counters as observed lower bounds; unknown CPU/cost remain null and prevent a budget-compliance claim. Recovery does not itself cancel remote operations or prove zero charges: use retained handles in trusted runtime cleanup, then explicitly reconcile the ledger. There is no automatic retry or timeout-based lease takeover.

Synthetic results have `executionMode: "synthetic"` and `benchmarkExecuted: false`; the existing live `EpisodeResultSchema` and analyzer reject them. Tests include complete synthetic grids, injected failure/cancellation/restart cases and isolated live-control branches with fake adapters. Those tests are not provider integrations, human results or scored experiments.

Trusted adapters may throw `ExperimentExecutionError` with one of the finite exported
reason codes after checkpointing partial usage and operation handles. This preserves
missing credentials, rate limits, provider timeouts, setup failure, flaky checks and
other declared stops without copying provider exception text. Invalid candidates,
protected edits and flaky checks produce an unverified result; they cannot claim a
sealed incorrect verdict. Only the four prospectively allowed infrastructure reasons
receive an exclusion. Every failed row remains in the primary denominator and stays
terminal. Plain exceptions and unrecognized reason strings remain sanitized.

The [synthetic executor](experiment-executor.md) now connects to this interface in
an invented-input integration test. It shares the product's revision kernel and
records a separate immutable trace for up to 24 revisions across three branches.
The [accounting importer](accounting-reconciliation.md) supplies the trusted receipt
and recovery boundary, including a durable ledger/journal association and revision
checks. Neither module supplies actual provider evidence.

**Remaining wiring:** no calibrated live 24-call/900-second executor is connected,
no CLI invokes this dispatcher, and no account/pricing/runner bound is attested here.
The product coordinator and smoke path remain limited to three proposals. A live
factory must enforce all per-operation limits, pin actual generation behavior,
verify source/account bindings, connect the external adjudicator and authoritative
billing/cleanup ingestion. The [aggregate exporter](experiment-export.md) and
[private export command](experiment-export-operator.md) now provide immutable
metadata rows and offline verification; they do not dispatch work or establish
provider/source authenticity. Human/operator
configuration remains outside candidate control.

Validation commands are `node --test tests/evaluation-dispatcher.test.ts tests/dispatcher-independent.test.ts tests/evaluation-boundary.test.ts` and `npm run typecheck`. All test task metadata and candidate-shaped strings are invented unit inputs; no sealed corpus or candidate execution is involved.
