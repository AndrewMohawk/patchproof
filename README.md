# PatchProof

A local maintenance workflow that checks candidate patches against independently
controlled requirements and exports a patch with replayable evidence.

**Working local product; real Nebius integration and competition evaluation are
not complete.** The three-screen app uses scripted model responses and executes
real Python checks in isolated local containers. Every active local run identifies
mock mode. A separate read-only archive labels recorded live and mock evidence
without enabling execution. It makes no claim about model performance.

New evidence uses product contract **2.2**, which preserves ordinary JSON mapping
keys throughout checking and export. Supported historical 2.0/2.1 bundles retain
their original bytes and interpretation; see [JSON compatibility](docs/json-contract-compatibility.md).

The owner approved **$25 total**: $5 allocated to smoke and $20 to a pilot.
Actual provider spending is **$0**. Account access is deferred at the owner's
request while the local build proceeds. See [decisions](decisions.md),
[budget](budget.json) and [remaining gates](research/blockers.md).

## Run

Requirements: Linux, Node **25.5.0**, npm **11.8.0**, Git, `/usr/bin/python3`
and a local Docker daemon accessible to the operator. Candidate code executes
only in containers. Exact dependencies and licenses are recorded in the npm
lockfile and [third-party notices](THIRD_PARTY_NOTICES.md).

```sh
npm ci --ignore-scripts --no-audit --no-fund
make doctor
make test
make dev
```

Open **http://127.0.0.1:43171**. Select **Retain first occurrences throughout a list**
(`stable-unique-01`), compare the three
policies, inspect a rejected candidate's actual check output, and download its
evidence. The scripted example supports this one task. Another 29 public tasks
are inspectable and clearly require a connected model to launch.

`make doctor` makes no paid calls. If the pinned local checker image is absent,
it reports the blocker; there is no automatic image pull or provider fallback.
The required image and local controls are in [the runtime guide](workers/sandbox/README.md).
This Linux/amd64 build has not been verified on another platform.

On a new Linux/amd64 machine, provision that exact image explicitly before
starting the checker:

```sh
docker pull --platform linux/amd64 python@sha256:79e7a9b9ff1cbceff819f856fb374477792a5967759d94df266de7b7b4120e6f
```

The API binds to loopback, accepts curated task IDs, and has no upload, arbitrary
command, remote URL, merge or publishing route. Set `PATCHPROOF_PORT` to choose
another loopback port. Do not expose this local prototype as a public service.

## Commands

| Command | Current behavior |
|---|---|
| `make doctor` | Reports local runtime, fixtures, approval and provider blockers; no paid calls. |
| `make test` | Type checks, contract locks, unit/HTTP/evaluation tests and real local container lifecycle tests. |
| `npm run test:browser` | Starts an isolated local app, runs all three policies, checks desktop/mobile flow and exports evidence. Requires installed Playwright Chromium. |
| `npm run record:rehearsal` | Performs that flow and records a local mock rehearsal, captions and a run-bound claims manifest under `.local/rehearsal/`. Nothing is published. |
| `npm run run -- stable-unique-01 patchproof` | Runs the same local coordinator from the CLI; stop `make dev` first because one process owns its state. |
| `make export RUN=<id>` | Exports local mock evidence. With private `CONFIG` and `CONFIG_DIGEST`, verifies and exports exact completed smoke evidence. |
| `make reproduce RUN=<id>` | Replays local mock evidence in fresh pinned containers. Recorded live evidence requires private `CONFIG` and `CONFIG_DIGEST` plus a new approved replay reservation. |
| `make smoke` | Exits 2 without configuration. `make smoke CONFIG=<absolute-private-json>` invokes the guarded operator; verified account, tokenizer, control and budget inputs are required. |
| `make pilot` / `make evaluate` | Exit 2 without configuration. Explicit private session/runtime configs invoke the guarded experiment operator; see its guide below. No live experiment has run. |
| `make release-check` | Audits local contract/dependency pins, public fixtures and release prerequisites; exits 2 while the real release gates remain open. |
| `make release-packet INPUT=<relative-json>` | Builds a private immutable packet from explicitly selected, scanned exports; receipt requirements are in the release guide. |
| `make verify-packet PACKET=<path> DIGEST=<sha256>` | Verifies a local packet's exact file set, checksums and embedded evidence. |

Install the pinned browser if needed with `npx playwright install chromium`.
For a browser download, save the bundle as `artifacts/<run-id>.json` before using
`make reproduce`. Self-consistent hashes establish integrity, not authenticated
provenance. A replayed mock-model run remains mock and cannot become competition
ready. The original v1 contract-only scaffold is retained for historical tests;
`npm run mock-run` produces that older non-executable format, not product evidence.

## Implementation and evidence

![Local task picker with explicit mock mode](docs/screenshots/tasks.png)

See the [reviewer walkthrough](docs/reviewer-guide.md) and recorded
[comparison](docs/screenshots/comparison.png) / [evidence](docs/screenshots/evidence.png) screens.

- SQLite journal, coordinator ownership lease, cancellation, scoped restart
  reconciliation and content-addressed evidence persist locally in `.local/product/`.
- B0 receives visible feedback; B1 receives declared acceptance feedback; P can
  propose up to three candidates against the original snapshot. All policies use
  one shared allowance per episode. No sealed final checks enter the repair loop.
- Each declared check now runs twice under the same batch deadline. Both
  observations appear in evidence; disagreement produces `needs_review`.
  B0/B1 retain the latest candidate; P selects the best declared-check result,
  with the earliest candidate winning a tie.
- New exports bind the executable source and configuration. Replay requires the
  recorded checkout; a running app refuses new runs after those files change.
  Historical exports keep their original explicitly versioned replay behavior.
- The current v2 suite has 60 original synthetic tasks from 12 fresh AI author
  contexts, independently reviewed and validated, split 20/10/30 by repository.
  [Provenance and preparation history](research/corpus-v2/README.md) preserve the
  two infrastructure failures and reviewed reruns. Public development/calibration files are here;
  gold and sealed checks stay in the separate evaluator workspace. These are
  synthetic examples, not a representative sample of real repositories.
- Exact CPU consumption is unknown and displayed as such. The runner limits CPU
  rate and wall time; it does not supply a measured cumulative CPU counter.
- Fresh local replay is implemented. Independent clean-machine replay, sponsor
  traces, reconciled billing, the 72-episode pilot and 270-episode final are pending.

See [task evidence](research/task-evidence.md), [evaluation](docs/evaluation.md),
[operations](docs/operations.md), and [the submission draft](docs/submission-draft.md).
The [budget ledger](docs/budget-ledger.md), [reviewer study](docs/reviewer-study.md)
and [release evidence guide](docs/release-evidence.md) describe the new tools.
The [trusted dispatcher](docs/experiment-dispatcher.md) preserves full experiment
accounting. The [guarded live executor](docs/live-experiment-runtime.md) and
[private experiment operator](docs/live-experiment-operator.md) connect the existing
adapters, ledger, final adjudication and independently accepted phase receipts.
This path is tested with fake transports; actual account and calibration evidence is absent.
The [synthetic experiment executor](docs/experiment-executor.md) tests up to 24
revisions across three branches using the same loop as the product. It rejects
live providers. [Accounting receipts](docs/accounting-reconciliation.md) support
trusted reconciliation and crash recovery. The [private accounting command](docs/accounting-operator.md)
imports separately reviewed receipts and recovers interrupted imports; actual
provider billing verification remains pending. The separate
[phase accounting operator](docs/phase-accounting-operator.md) records cumulative
runtime/adjudication observations without releasing holds or granting execution.
The [aggregate exporter](docs/experiment-export.md) and its
[private command](docs/experiment-export-operator.md) retain every planned episode
and verify immutable metadata bundles. Synthetic exports remain unscored; source
hashes do not establish which code a past dispatcher actually executed.
The [trusted smoke factory](docs/trusted-smoke.md) connects the provider adapters
and budget ledger for an explicitly configured integration run of at most three
proposals. The [private smoke operator](docs/trusted-smoke-operator.md) adds preflight,
durable single-attempt sessions, cancellation and status. Its tests use fake
transports; account verification, calibrated ceilings and actual smoke runs remain pending.
The [private evidence operator](docs/private-evidence.md) verifies and exports
completed smoke bundles. The [read-only archive](docs/evidence-archive.md) displays
selected recorded live/mock bundles without enabling a provider. The
[guarded replay operator](docs/replay-operator.md) repeats a selected live patch's
checks under a separate reservation; its provider tests are synthetic.
The [completion audit](docs/completion-audit.md) distinguishes implemented tools
from the remaining provider, billing, calibration and human evidence.
The original planning package remains in commit `4bf1335`; its `SHA256SUMS.txt`
refers to that original package. `tasks.json` is a living acceptance tracker.

The GitHub repository is private. Application licensing, public source/video,
public demo operation and event entry remain owner decisions. No entry,
publication, deployment or automatic merge has occurred.
