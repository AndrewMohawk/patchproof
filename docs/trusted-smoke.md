# Trusted sponsor smoke path

`createTrustedSmokeEpisode()` in
`packages/orchestrator/src/trusted-smoke.ts` joins the existing model and sandbox
adapters, repeated checks, coordinator and durable budget ledger. It is callable
only from trusted local control-plane code with explicit dependencies. The public
application remains mock; no browser field, live CLI command or automatic fallback
enables this factory. No real account record or credentials are included.

The smoke policy allows at most three proposals. It reserves two independent
check repetitions for the original and each of three possible candidates: eight
raw check batches in total. All variants use the same aggregate allowances. This
is a bounded integration exercise, **not** the frozen 24-round experiment executor,
a matched experiment result, or competition-ready evidence.

## Required bindings

The input contains an episode UUID, one owned development/public fixture, variant,
resource limits, `BudgetLedger`, `RunJournal`, `EvidenceStore`, model and sandbox
credential suppliers, injected transports, and a current-source digest verifier.
Dependencies are captured once; mutating the caller's options cannot replace the
ledger or runtime binding mid-episode. Final/evaluator fixtures are rejected.

The account setup must establish the exact NVIDIA model ID, model card, license,
context size, actual account access and rates; the tokenizer artifact digest and
source must match that model. Its counter must conservatively include the whole
request's chat/template overhead. Account evidence must establish that the chosen
output cap includes all billed output/reasoning tokens and that token rates cover
all request charges. The factory does not download or infer a tokenizer, license,
model ID, price or provider control. Generic evidence-reference strings and hashes
do not establish these facts or authenticate an attestation.

A current `SandboxVerification` binds account/project, immutable image and
equivalent isolation, filesystem, network, memory, PID, CPU, cancellation,
retention and billing controls. An additional CPU attestation must establish that
the quota bounds all guest CPU, execution timeout bounds guest execution, and a
finite per-operation overhead covers startup, timer and scheduler-burst CPU.
These are verified external controls, not invented provider API flags. Missing
or stale records fail closed before credentials are requested.

## Resource and accounting behavior

Before dispatch, the factory computes a conservative aggregate model ceiling from
the episode's full input/output token caps and pinned rates, rounded upward using
integer microdollars. It adds eight full sandbox batch charge ceilings. One durable
episode reservation and one dispatch grant cover every model/check branch. The
ledger must have sufficient approved project and smoke-stage capacity.

With `N = 8 × number_of_cases`, quota `q`, CPU limit `C` and attested overhead `h`,
each guest timeout is capped at `floor((C/N - h)/q)` seconds (maximum 900). A result
below one second is refused. Thus `N × (q × timeout + h) ≤ C`, conditional on the
attested controls being true. The host separately enforces the remaining episode
wall allowance and repeated checks share each batch's remaining time. Queue/start
latency and independent cleanup polling are not claimed to be part of the guest
execution timeout. This resource ceiling is not a measured CPU counter; missing
provider CPU measurements remain `null`.

Credential waits, requests and response reads are abort-bounded. Model request
intents are journaled before sending; response IDs and usage survive malformed
candidates and later failures. Sandbox upload/instance intent and known UUID
handles use the existing durable journal callback. Source, verification-window and
approval changes are checked before new work; safe exact blocker codes are
retained. Raw credential/transport error text and provider error bodies are not
copied into evidence. Cancellation/status requests may continue after new-work
gates close so known operations can be stopped and observed.

Actual USD stays `null`: token-rate calculations are ceilings, and the sandbox
API cost field has unspecified units. Successful, failed and cancelled episodes
retain the full unreconciled reservation. Restarting the ledger preserves the
hold and blocks another paid episode. Only separately established cumulative
billing and cleanup evidence can support explicit trusted reconciliation; this
factory does not manufacture that evidence or release a hold automatically.

## Failure and recovery limits

The public API does not provide a documented creation idempotency key or a mapping
from the local run ID to unknown remote operations. A lost response can therefore
leave an unconfirmed intent. Known-operation cancellation is polled to terminal
status; unconfirmed cleanup ends the episode without retry. Host abort cannot
prove that an already accepted remote request was cancelled. Upload retention and
charges also require the verified account policy. Automated crash cleanup and
live restart/resume are not implemented; preserve handles and the durable hold
for trusted account-side investigation before authorizing more paid work.

The existing comparator evaluates observed values on the host; expected answers
and check definitions are never submitted to the sandbox. The immutable driver
shares a Python process with the benign maintenance candidate, so the existing
runtime's process-introspection limitations still apply. This is not a service
for arbitrary hostile source.

## Validation

`node --test tests/trusted-smoke.test.ts tests/runtime-repair.test.ts` exercises
synthetic accounts and injected fake transports only: successful/unsuccessful
lifecycle, one aggregate grant, all repetitions, precredential denial, cancellation,
stalled credential/body waits, journal failures, retained IDs/usage, stale-source
and approval blockers, mutation of caller options, and durable unknown-billing
holds. Fixtures simulate observations without executing candidate Python on the
host. These tests are not actual account, model, isolation or billing receipts.

Real sponsor integration, model/tokenizer verification, provider cancellation,
actual billing reconciliation and live experiment execution: **NOT RUN**, because
the required account access and verified controls remain absent. Official adapter
mappings and documentation dates are recorded in
`research/nebius-sandbox-sources.json` and `workers/sandbox/README.md`.
