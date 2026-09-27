# Guarded replay of a recorded live patch

The private replay command applies an already selected patch from verified
product evidence and reruns its declared checks. It makes **zero model calls**,
does not create another candidate, and cannot read sealed checks. Actual Nebius
replay is **NOT RUN**: account access and verified controls are still deferred.
Tests use explicit in-memory fake HTTP transports and invented unit bundles.

Replay is a new paid operation, separately reserved against the existing smoke
allowance. It cannot use an unresolved original run's reservation. Unknown
billing blocks subsequent spending; provider cost fields with unspecified units
are never interpreted as USD. The total approved project ceiling remains $25.

Use the same recorded source/configuration checkout and an immutable private
export from the [evidence operator](private-evidence.md). The current curated
public fixture must match the bundle. Only recorded `live` / `trusted-smoke-only`
bundles with a selected patch and the frozen two-observation protocol qualify.
Historical mock bundles retain their local Docker replay route.

The exact input schema is `ReplayOperatorConfigSchema` in
`scripts/replay-operator.ts`. All paths are absolute, outside the repository,
owned private regular files under 0700 directories. No paths may collide with
another input/output or either SQLite database's sidecars.

| Field | Required binding |
|---|---|
| `schemaVersion`, `kind`, `executionAuthorized` | `1.0`, `patchproof-live-replay`, explicit `true`. |
| `replayId` | A new UUID for this one replay attempt. Never reused for a different configuration. |
| `runId`, `bundleFile`, `bundleDigest` | Exact selected export and original run. |
| `fixture` | Current curated `taskId`, `fixtureDigest`, `sourceDigest`, `policyDigest`. |
| `sourceDigest` | Whole operational-lock digest recorded in the smoke runtime. |
| `limits` | Positive wall-time (at most 120 seconds), cumulative CPU and USD ceilings, within approved episode/stage limits. |
| `ledgerFile`, `budgetDigest` | Existing initialized durable ledger and schema-ordered digest of current approved `budget.json`. |
| `sessionFile`, `reportFile` | Dedicated private session database and a new exclusive report filename. |
| `sandboxCredentialFile` | Private JSON containing the project-scoped `token`; never place it in chat, the repository or evidence. |
| `verification`, `cpuProof`, `acceptedProofDigests` | Independently verified sandbox/control/billing and CPU records, plus their separately accepted canonical digests. |

The configuration digest is `digestJson(ReplayOperatorConfigSchema.parse(value))`
from the contracts package. It is canonical JSON, unlike the schema-ordered
budget/evidence-operator digest. Acceptance is an explicit operator decision;
self-consistent hashes do not prove account access, prices, controls or billing.

```sh
node scripts/replay-operator.ts preflight "$CONFIG" "$CONFIG_DIGEST"
make reproduce CONFIG="$CONFIG" CONFIG_DIGEST="$CONFIG_DIGEST" RUN="$RUN"
node scripts/replay-operator.ts status "$CONFIG" "$CONFIG_DIGEST"
node scripts/replay-operator.ts cancel "$CONFIG" "$CONFIG_DIGEST"
node scripts/replay-operator.ts recover "$CONFIG" "$CONFIG_DIGEST"
```

`RUN` is optional with a private config; when supplied it must match. Preflight
checks current source/config, exact bundle bytes, fixture pins, approved budget
and accepted proof windows. It reads credential metadata only and creates no
reservation or session. Missing or uninitialized ledgers fail closed. It never
provisions a new allowance. No paid replay is implied by a bare
`make reproduce RUN=<live-id>`; that route requires the private config.

Start claims the replay UUID once, derives an immutable aggregate envelope and
reserves the conservative cost of two complete sandbox batches. Each new paid
request rechecks configuration/source, approval and the existing reservation.
Guest timeout and CPU quota bound aggregate CPU, including verified per-operation
overhead. The overall wall limit cancels execution; a separate bounded cleanup
can continue to stop existing operations. Successful cancellation requests alone
do not establish remote termination or billing completeness.

Operation intentions/IDs and known CPU observations are checkpointed to the
session. Raw batches are exclusive files named `<reportFile>.batch-1.json` and
`<reportFile>.batch-2.json`; the final report references their byte digests and
contains the fresh verdict, progress, envelope and unresolved reservation.
Provider charges remain `null` until independently reconciled through the
[accounting operator](accounting-operator.md). CPU values are observed lower
bounds if an operation did not return complete measurements.

Status reads existing session metadata; cancellation records a durable request.
Recover only marks a dead owner's session interrupted and never grants another
start, resumes execution or claims remote cleanup. These commands may open the
existing private SQLite store for current WAL visibility. They never read
credential contents or dispatch providers. Repeating start returns the existing
claim instead of spending again. Interrupted runs retain known handles and holds.

A report remains `competitionReady: false` and does not authenticate the original
bundle. Reproduced checks, a completed experiment, human review and external
billing are separate evidence. No live results have been manufactured by the
synthetic tests.
