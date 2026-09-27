# Local operations and provider handoff

## Local startup

Follow the root README. `make doctor` reports the installed pinned image and
missing provider gates without spending. The application uses only curated
fixtures and binds to 127.0.0.1:43171. Credentials are not needed for local mode.
Only the operator needs local Docker access; do not add untrusted users to the
Docker group or expose its socket to candidate containers.

One coordinator owns `.local/product/` through a PID/token lease. Stop the dev
server before using `npm run run`; export/reproduce are read-only with respect
to the journal and may run while the app is open. The browser test uses an
independent temporary state directory. There is no background paid worker.

Shutdown with Ctrl-C: active work is cancelled and observed to completion before
the journal closes. On restart, interrupted run UUIDs are reconciled using exact
ownership labels; unrelated/evaluator containers are not removed. An uncertain
cleanup remains an error. Do not globally remove containers by a generic label.
See the runtime guide for delayed Docker-daemon work and parent-death limits.

Back up the SQLite database and its WAL consistently together with the evidence
directory while the app is stopped. Do not delete state to make a failed run
vanish. Content-addressed exports are immutable; a failed integrity check needs
investigation, not overwriting. No automatic retention or paid retry is enabled.

## Reviewer replay

Export a completed run or place its downloaded bundle in `artifacts/<id>.json`:

```sh
make export RUN=<id>
make reproduce RUN=<id>
```

Replay uses the frozen source, full diff, declared policy and pinned image in the
bundle. It does not infer authenticity from hashes. It refuses missing/mismatched
inputs, protected edits, missing image or invalid observations. An abstention has
no selected patch to reproduce. A mock run never changes into a real-provider
result. Selected example bundles are retained beside the local verification logs.

## Provider activation work still required

Obtain project-scoped access outside source, candidate and evaluator workspaces.
Never put keys in chat, `.env` in this checkout, evidence or browser state. The
inference adapter accepts a credential callback; no broad environment/home scan
is implemented. Sandbox requests require their separately verified project/IAM
credentials. No local-to-paid automatic fallback exists.

Discover actual account model availability, model license/card/context behavior,
image/architecture and rate units; fill `runtime-lock.json` with observed facts
and references. Finish and test the refusing Nebius check runner before wiring
live coordinator execution. Verify documented isolation controls against the
account, not only fake transports. Retain the request/operation IDs for two
curated smoke cases, cancellation, timeouts, failed calls and billing records.

Implement durable dollar reservations before concurrent paid scheduling. Reserve
worst-case input/output/sandbox cost for all branches/retries/setup; actual
remaining funds must include unresolved reservations. Unknown prices/costs block
further paid work. The present local coordinator spends zero and is not a paid
budget-reservation implementation. $5 smoke plus $20 pilot shares one $25 ceiling.

Once G1 is evidenced, freeze a prospective affordable pilot plan. A smaller plan
needs a named protocol revision before results. Never discard costly or failed
episodes. Final evaluation and hosting currently have $0 allocation.

## Public operation is not configured

The local runner shares a host kernel and a trusted observation process. It is
intended for authorized benign fixtures, not hostile arbitrary Python. A public
deployment needs a separate least-privilege operator/evaluator boundary,
authenticated administration, curated IDs, concurrency/rate limits, bounded
resource retention, credential injection, external availability monitoring and
independent deployment verification. No public listener or deployment exists.

The current event-source review requires free judge access through December 15,
2026 at noon Pacific; recheck before entry. Operator, hosting cost and funding
remain unassigned. No dollar projection is invented without measured episode
cost and a selected host. This document is a preparation runbook, not evidence
of public-service availability.
