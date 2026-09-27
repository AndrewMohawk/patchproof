# Local completion audit and final integration

The local build at source `06c584c23ac1b620a14ba5e3c68fbdb02199a164` passes
622 tests and the actual browser/container integration below. Three scripted
policies pass the same declared checks; each selected patch reproduces in fresh
containers. A fourth curated task honestly abstains because no mock proposal is
available. Provider calls and spend remain zero against the owner's $25 ceiling.
This is local workflow proof, not a model benchmark or competition readiness.

The machine-readable [integration receipt](integration-receipt.json) binds the
observations, commands and retained files. The application serves only
`127.0.0.1:43171` from `/tmp/patchproof-handoff-audit`, a detached checkout at that
commit, using the existing project journal. All 110 operational files match the
[tested source manifest](precommit-verification.json). The prior 20 exported
records remain byte-identical; the journal now contains 24 terminal runs and no
active run. The [backup receipt](handoff-backup.json) identifies the state copy
made before switching the application.

## Fixes verified by this audit

- `packages/orchestrator/src/coordinator.ts` now reports uncovered requirements
  as `needs_review` and abstains before dispatch when no checks exist. It also
  finishes compatible interrupted terminal evidence publication on restart
  without rerunning candidates. Incompatible inputs remain blocked. Recovery
  tests use controlled journal/store windows, not a claimed real process crash.
- `scripts/release-protocol.ts` recognizes the strictly validated, recorded local
  mock timing policy when comparing source/runtime bindings. Changed sources,
  runtime, protocol or invalid timing metadata still fail that comparison.
- Four focused test files cover the cases above. `docs/submission-draft.md`
  distinguishes the current visible-and-acceptance rejection from the historical
  visible-pass/contract-fail example; no fixture or mock stream was changed to
  manufacture a policy advantage.

The red test logs are retained beside the successful logs. Earlier failed v2
container attempts and the prospective timing fix remain in the
[previous integration record](../20260927-corpus-v2-integration/README.md).
Historical exports and their interpretation were not rewritten.

## Actual local observations

| Selection | Run ID | Result | Fresh replay |
| --- | --- | --- | --- |
| B0 baseline | `d521c096-5442-4dd6-897b-fd3965a95ed4` | Passes declared checks | Exit 0; 9 checks, 18 operations |
| B1 checks only | `52bca833-3f06-41e9-a578-26c930df734e` | Passes declared checks | Exit 0; 9 checks, 18 operations |
| P PatchProof | `a4ac4fb2-f8a0-44e2-a419-63e2acc2fd8c` | Passes declared checks | Exit 0; 9 checks, 18 operations |
| Unsupported scripted task | `88017a40-ba4c-4cd5-aead-a64465af7f90` | `needs_review / mock_task_unavailable` | Expected exit 2; `no_selected_patch`, no execution |

The comparison used actual UI actions; [the browser report](browser-report.json)
records task selection, matching allowances, rejection and repair, downloaded
evidence identity, reload, desktop/mobile views, keyboard focus, same-origin
traffic and zero console errors. Six [screenshots](screenshots.json) are retained.
Additional MCP observations checked saved historical 2.0/2.1 task context and the
new [abstention view](abstention-browser-mcp.json), each with zero console errors.

The three comparison runs each recorded two candidates and 54 isolated check
operations. Their elapsed times were 103.6, 101.9 and 101.3 seconds within the
same 120-second allowance. The unsupported public task recorded 30 initial-check
operations, no candidate and no selected patch. All **246 unique operations**
across these four runs and three executed replays record confirmed cleanup;
the final owned-container query was empty. Exact operation IDs are preserved in
[operation-cleanup.json](operation-cleanup.json). CPU consumption remains
unmeasured, and same-host container replay is not independent-machine validation.

Commands and actual exits:

| Command | Exit | Evidence |
| --- | --- | --- |
| `make doctor` | 0 | [Current dependency/runtime diagnostics](doctor.log); real integration remains NOT RUN |
| `make test` | 0 | [622 passing tests](make-test.log), including typecheck and contract locks |
| `node /tmp/patchproof-handoff-audit/apps/web/verify-browser.ts http://127.0.0.1:43171` | 0 | [Browser log](browser.log) and report |
| `make export RUN=<each selected UUID>` | 0 for all four | `export-*.log`, exact copies in `bundles/` |
| `make reproduce RUN=<each comparison UUID>` in the pinned checkout | 0 for all three | [Exact commands and times](reproduce-commands.json), `reproduce-*.log` |
| `make reproduce RUN=88017a40-ba4c-4cd5-aead-a64465af7f90` | 2, expected | [Abstention replay](abstention-replay.json) |
| `node research/verification/20260927-completion-audit/capture-release-scan.mjs` | 0 | [Exact scanner scope and binary digest](scan-observation.json), four scan logs |
| `make release-packet INPUT=research/verification/20260927-completion-audit/release-input.json` | 0 | [Packet command](release-packet.log) |
| `make verify-packet PACKET=<recorded path> DIGEST=<recorded digest>` | 0 | [Verification log](verify-packet.log) |
| `sha256sum --check SHA256SUMS` inside the packet | 0 | [Checksums](packet-checksums.log) |
| `make release-check INPUT=research/verification/20260927-completion-audit/release-input.json` | 2, expected | [Open external gates](release-check-final.log) |

The [release command receipt](release-commands.json) contains complete arguments.
These commands did not invoke a provider, send messages, publish or submit.

The final [independent artifact review](independent-review.json) found no material
mismatch in 404 metadata checks and independently ran static packet verification
with exit 0. It reconciled the source hashes, four exported bundles, replay
outcomes, scan coverage and 246 recorded operation lifecycles. This was same-host
AI review, with prior implementation participation disclosed; it did not repeat
candidate execution, inspect private state or establish human independence.

The separate final staged source/evidence scan initially flagged two copies of
the locally generated request deduplication ID. The original evidence bytes and
[redacted findings](staged-scan-redacted-findings.json) are retained. A
[reviewed exception](staged-scan-review.json) names only those two file/rule/line
fingerprints; the rescan exited 0. No scanner rule or repository-wide default was
disabled. The earlier exact four-bundle scan required no exceptions.

## Local packet and remaining gates

The packet is at
`artifacts/release-packets/00accae07a81904edf6c7305b90e0b128c7e02eb506cd7cdf60a0d2a031d2f95`.
Its expected digest is
`sha256:00accae07a81904edf6c7305b90e0b128c7e02eb506cd7cdf60a0d2a031d2f95`.
The retained [manifest](packet-manifest.json) records all four source bindings
as current and the operational tree as clean at capture. Its explicit secret
scan covers the exact exported bytes; the scan receipt expires at its recorded
time and does not guarantee detection of every possible secret format. The
scanner's build does not report a usable version number, so its actual version
output and binary SHA-256 are recorded without inventing a version.

The packet remains `local_preparation`, with `evidenceStatus: blocked` and
`competitionReady`, `publicationAuthorized`, and `authenticityVerified` all
false. Hash verification establishes consistency, not authenticity. Model/account
availability, verified rates and controls, real smoke/cancellation/billing,
calibration, pilot/final experiments, uncoached human review, independent-machine
replay, license review and publication/hosting/entry decisions remain open.
They were **NOT RUN** here because provider access and the corresponding external
observations or owner release decisions are deferred. See the
[current blocker report](../../blockers.md).

Dependency versions and observed Node, npm, browser and Python runtimes are
recorded in the source/runtime manifests and exports. No provider SDK/interface was changed
or newly asserted by this audit. The existing c335031 walkthrough video retains
its original source binding; it is not presented as a recording of these new runs.
