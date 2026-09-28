# Task evidence — implementation and observed operation

## Scope and source references

- `4bf1335`: initial seven non-ZIP package files; all six original checksums
  verified before edits. ZIP excluded.
- `811ef1a`: official-source recheck, private repository, owner confirmations and
  exact $25 aggregate approval.
- `251b62f`: initial 17-test contract-only mock scaffold. Its logs in
  `research/verification/20260927T074603Z-local-preparation/` are historical.
- Product implementation: current contract in `research/contracts-v2.2-lock.json`,
  exact historical 2.1 snapshots under `research/contracts-history/2.1/`, and the
  source-bound verification records below. They retain actual commands, exit
  codes, bundles and run IDs.

The owner authorized local development before provider access and subsequently
authorized the real Token Factory/local-Docker public application. Actual repair
requests and public deployment are now observed; the dated real-deployment record
below preserves their outcomes and failures. `tasks.json` keeps sponsor Sandbox,
calibrated experiment, human acceptance and final release gates separate. Earlier
dated sections retain the claims and limits of their own snapshots; no benchmark
result or competition entry is claimed.

## Implemented paths and verification

| Scope | Changed paths | Executed checks and evidence |
|---|---|---|
| T01/T02 | `owner-decisions.json`, `budget.json`, `runtime-lock.json`, contracts, workspace | Config validation, exact $25 ceiling, v1/v2 digest locks, TypeScript checks. Unknown account fields stay null. |
| T03 | `fixtures/`, `workers/evaluator/`, separate evaluator workspace | All 60 independently authored v2 tasks passed separate review and fresh contract 2.2 gold/start/repeat validation; all 100 controls passed. Immutable public integration, provenance, two preserved infrastructure failures and final cleanup audit are under `corpus-v2/`. V1 history remains preserved. No gold or final vectors in this checkout. |
| T04 | `workers/repair/`, `workers/sandbox/` | Fake transport controls plus actual Token Factory model requests and pinned local Docker checks. Real Nebius Sandboxes entitlement/execution and authoritative billing remain unverified. |
| T05–T07 | `packages/orchestrator/` | Equal-limit scripted controls and actual baseline/checks-only development observations, with failures retained. Three-arm live results and any subsequent diagnostic revision must bind their own source; no benchmark advantage is inferred. Final feedback remains inaccessible to the repair loop. |
| T08 | journal, lease, evidence and patch modules | Durable reopen/idempotency, failed publication, partial infrastructure logs, interrupted-runtime drift, immutable bundle and fresh patch replay. |
| T09/T11 | evaluator planner/adjudicator/analyzer, `research/evaluation/` | Fixed 72/270 plans, protected one-use final adjudication tests, matched budgets/denominators and clustered inference tests. Scored experiments NOT RUN. |
| T10 | `apps/web/`, product API | Actual public FQDN task/progress/evidence rendering at desktop/mobile widths, plus local export/reload, keyboard and HTTP cancellation/denial/SSE controls. Uncoached human acceptance is still unobserved. |
| T12–T14 | operations, submission draft, local release review, release audit | Public real-model/local-Docker rollout and a 95.12-second hosted real-run walkthrough are verified; original recording attempts and failures remain retained. Broader competition gates and earlier mock footage remain separate. |

`make test` runs type checking, locked-contract checks and the full suite, including
real local container tests. The final local-product validation records its actual
count/exit rather than inferring success from implementation. `npm run
test:browser` creates three actual local runs against an isolated state directory.
The validator preserves all three exported bundles and freshly replays each.
It additionally executes/export-checks the unsupported-task abstention. Its
replay returns exit2 because there is no selected patch; that is expected.

## Findings corrected and preserved

- Mock-handler listener errors and contradictory evidence were fixed in v1;
  its failed attempts and original logs remain in the initial validation record.
- The first full browser observer ended before its jobs completed. It was fixed
  to wait for actual terminal UI states and resumed those exact run IDs; no
  replacement result was substituted for an unfinished job. Earlier records
  remain in local verification history.
- A wide real diff overflowed the mobile grid; width constraints were corrected
  and all three mobile views rechecked.
- Independent oracle review found finite-example gaps, ambiguous requirement
  mappings and discrepancies between descriptions/checks. Original manifests
  and detailed revisions remain with the evaluator; root artifacts expose only
  aggregate evidence. Corrections precede all scored model experiments.
- The stable-unique nonmutation check also asserted order on an unsorted input,
  falsely attributing the scripted sorting defect to nonmutation. Its separate
  mutation case now isolates that clause with an otherwise unambiguous return.
- Unconfirmed container cleanup previously allowed the next case to start;
  the batch now stops with errors. A negative regression proves no second launch.
- Restart with changed runtime inputs could republish incompatible evidence;
  recovery now preserves original digests, abstains, clears stale export binding
  and allows startup. Cleanup/publication failures are recorded per run.
- CPU usage remains unknown. UI and runtime guide no longer describe its
  configured allowance as a verified cumulative usage counter.
- Product 2.1 binds task metadata as well as source/check policy. Product 2.0 uses
  its explicit legacy formula for historical replay; no silent digest fallback.

## External interfaces and limits

Node25.5.0, npm11.8.0, TypeScript5.9.3, Zod4.1.12, Node types25.5.0,
Playwright1.58.2; observed Chromium145.0.7632.6. Exact package integrity and
license metadata are locked. Local Python image/control details are in
`workers/sandbox/README.md`. Public provider URLs and retrieval statuses are in
`research/sources.json`; unversioned docs are not account verification.

Nebius Sandboxes smoke, authoritative cost reconciliation, real 72/270 episodes,
independent clean-machine replay, uncoached reviewer timing/accuracy and final
submission remain **NOT RUN**, for the specific gates in `research/blockers.md`.
Public demo availability is observed, but judging-period operation is not proven
by a point-in-time health check. Application licensing, final source publication
and entry decisions remain open.

## Final local validation record

`research/verification/20260927T082926Z-local-product/` records a complete
exit0 validation pass: 66 tests at that snapshot, actual three-policy browser
execution, fresh replay of all three verdicts, and a durable unsupported-task
abstention. Real commands correctly exit2 with explicit blockers. A subsequent
fixture-receipt consistency regression is recorded separately. Historical 2.0
evidence also replays through the explicit legacy verifier (exit0).

The staged secret scan initially flagged a synthetic test idempotency string
(`generic-api-key`, tests/orchestrator.test.ts); it was not a credential. The
fixture was renamed to an unambiguous test label, its targeted tests reran, and
the redacted staged scan passed without adding an allowlist.

Final integrated `make test`: **exit0, 71 passed, zero failures/skips** in
`tests-final.log`. Independent protocol review additionally passed26 synthetic
checks. A missing-field/NaN budget gate defect was corrected with strict runtime
validation; draft plans were rebound and originals preserved before any model
episode. The persistent app browser check also passed after the accessibility
CSS adjustment, and its screenshots and selected bundle are retained.

## Committed implementation and clean checkout

Implementation commit: `f482bd7edf49155db1dc392c29fe772eef413a90`, pushed to
the private repository. `research/verification/20260927T0836Z-clean-checkout/`
records a fresh archive of that commit: offline exact-lock install, contract
checks, doctor and selected patch replay all exited 0. The checkout had no prior
run database or artifacts; the selected committed bundle was copied explicitly.
The same host Docker image/npm cache were shared, so this is not independent
clean-machine verification. Release-check correctly exited 2.

## Runtime completion follow-up

Based on `b3ee8ea9d4b9dcdd4a8666481197748c48707a77`, the runtime follow-up
adds durable aggregate USD reservations, two observations per declared check,
explicit B0/B1/P proposal and selection policies, source-bound local operational
locks, a conditionally enabled Nebius lifecycle adapter and trusted reviewer-study
planning/recording tools. Changed source/test paths and exact digests are recorded
in `research/verification/20260927-runtime-completion/tests-receipt.json`.

Executed `make test`: **exit 0, 134 passed, zero failures/skips**. This includes
local container execution, concurrency/restart budget tests and synthetic provider
and study inputs. Independent budget/study review receipts are under
`research/verification/runtime-followup/`. Nebius interface sources and exact
OpenAPI retrieval digests are in `research/nebius-sandbox-sources.json`.

No real provider calls, costs, experiment rows or human answers were produced.
The durable ledger and evaluator tools still need dispatcher/factory integration;
the operational lock is explicitly local and unscored, not a frozen live protocol.
Browser verification of repeated observations follows separately. The completion
audit preserves the earlier gaps and will be supplemented with concrete receipts.

## Reviewer, release and browser follow-up

`research/verification/20260927-runtime-completion/workflows-receipt.json`
records **150 passing tests**, the actual browser/rehearsal command, three fresh
container replays (including the failing baseline), exact bundle scans and local
video/caption hashes. All execution/scan commands exited 0; release-check correctly
exited 2 for missing external evidence. The source-bound selected bundles and
per-command logs are retained beside that receipt. No run was replaced after an
observer failure; this browser attempt passed on its original runs.

The separate reviewer collector passed synthetic rendered browser checks, including
inert patch text, keyboard input, mobile layout and a timer preserved across reload.
Neutral receipts under `runtime-followup/` contain no participant tokens, responses
or sealed material. This is not a human study. Release receipts and packet tooling
are tested against missing/stale/tampered/synthetic evidence; actual provider,
study, independent-machine and deployment gates remain unfulfilled.

One initial release receipt test supplied a duplicate trusted digest list and
failed schema validation before reaching its intended duplicate-receipt check.
The fixture was corrected to isolate that condition, with duplicate-trust rejection
retained separately. Its failed log is preserved; the 150-test pass includes the fix.

Implementation/reference commit: `15f39c7191dedf85a4f18395807ab300c37e7fb1`,
pushed to the private repository. In a detached checkout of that commit, exact
selected bundle scans were ingested and a real local packet was built and verified.
Packet build, structural verification and `sha256sum --check SHA256SUMS` exited 0;
the release audit with the genuine scan receipt still exited 2 for missing external
gates. `packet-receipt.json` and `packet-manifest.json` preserve the source reference,
packet digest and honest mock/failure scope. Every selected bundle matched the
recorded source and runtime. This was same-host verification, not independent custody.

The exact source tar remains beside the private rehearsal. `rehearsal-custody.json`
identifies the preferred captioned v2 video and reviewed frame; the first oversized
caption rendering was retained rather than silently replaced. No asset was published.

## Durable experiment dispatch

`workers/evaluator/dispatcher.ts` now accounts for the existing 72/270 grids with
durable episode identities, finalized selections, separate one-use adjudication,
failure/cancellation/restart rows and budget holds. Remaining CPU/USD/time bounds
are passed prospectively to the adjudicator. Synthetic records cannot enter the
live scored analyzer. Author and independent checks resolved verdict consistency,
private-state paths, retained callbacks, usage regressions, timeout classification
and changed transport bindings.

Executed `node --test tests/evaluation-dispatcher.test.ts
tests/dispatcher-independent.test.ts tests/evaluation-boundary.test.ts`: **exit 0,
38 passed**. Typecheck also exited 0. Exact source hashes, commands and limitations
are in `runtime-followup/dispatcher-verification.json` and
`dispatcher-independent-review.json`. These tests execute invented callbacks,
including controlled process death; they do not execute candidate code or a
provider, access sealed fixtures or produce scored model results. The calibrated
live executor, account attestations and CLI wiring remain separate work.

## Trusted smoke integration and local regression

The trusted three-proposal smoke factory now connects the model adapter, sponsor
sandbox lifecycle, repeated checks, source/account gates and durable budget ledger.
One reservation covers the whole episode; unknown charges stay held after failure,
cancellation or restart. The public app remains mock. Exact source hashes and
focused synthetic commands are in `runtime-followup/trusted-smoke-verification.json`.

Integrated `make test`: **exit 0, 203 passed, zero failures/skips**. The actual pinned
Chromium browser flow passed all three variants; their selected patches reproduced
in fresh containers, including the baseline failure. All browser/replay commands
exited 0. `make doctor` exited 0; smoke, pilot, evaluate and release-check each
correctly exited 2 for their remaining gates. Logs, unchanged exports, screenshot
observations and source bindings are in
`research/verification/20260927-smoke-integration/integration-receipt.json`.

No live provider calls, measured provider charges, experiment scores or human
responses were produced. A private operator entry point, 24-call experiment loop,
calibrated live binding and authoritative billing/cleanup handoff remain open.
The local factory is not that experiment executor.

The earlier dispatcher commit's staged whitespace check reported one trailing blank
line in its verbatim npm output log; source whitespace and secret checks passed.
Raw command logs are preserved, and source whitespace checks exclude `.log` files.

## Safe experiment failure reasons and pinned local app

Commit `69b6f65` adds a finite trusted runtime failure class. Rate limits, missing
credentials, setup failures and flaky checks retain distinct reasons; raw exception
text cannot become a report field. Invalid/protected/flaky candidate outcomes stay
unverified, and only the four frozen infrastructure reasons may be excluded from
the secondary denominator. All rows stay in the primary denominator. Typecheck
and the 40 dispatcher/boundary/independent tests exited 0; the receipt is
`runtime-followup/dispatcher-failures-verification.json`. No provider ran.

The loopback app now uses the pinned, tested `d575f24` checkout with all
eight historical terminal runs preserved. Exact-lock offline install and a real
Chromium page render passed; 30 tasks, explicit mock labels and no console/page
errors were observed. The source checkout is insulated from ongoing main-branch
work. `20260927-smoke-integration/running-app-handoff.json` records the session and
source binding. This is still a same-host local product, not a public deployment.

## Integrated experiment and accounting plumbing

Commits `c604b11` and `93fa291` add the shared repair kernel, synthetic 24-revision
executor, separate immutable trace format, and trusted cumulative accounting
receipt import/recovery. The executor rejects live providers; accounting receipts
check consistency and require independently accepted evidence. They do not obtain
or authenticate provider observations. The independent accounting receipt preserves
five historical findings and their bounded fixes, including expired-write recovery
and stale-history/concurrent-revision controls.

On exact executable source `93fa2919ee8ada80c67e28fac3a939b892e66c3a`, `make test`
exited 0 with **272 passed, zero failures/skips**. The pinned Chromium browser flow
passed all three product policies after the shared-loop refactor. All three selected
patches, including the failing baseline, reproduced in fresh containers with exit 0.
`make doctor` exited 0; smoke, pilot, evaluate and release-check retained exit 2 for
their unresolved gates. Command logs, immutable bundles, screenshots, source hashes
and same-host app handoff are in
`research/verification/20260927-experiment-plumbing/integration-receipt.json`.

The loopback app is pinned to that tested checkout and preserves all eight prior
terminal runs. No provider call, paid charge, live experiment, human response or
public release occurred. A calibrated live factory/session, operator commands,
authoritative billing/cleanup ingestion and aggregate export integration still
require work; account access alone does not supply those components.

## Private accounting operator

The explicit `import` and `recover-expired` commands now connect reviewed metadata
to the durable accounting importer. Inputs require private external paths and a
separately supplied context digest; the command refuses missing/empty ledgers and
missing reservations before journal initialization. It never reserves, grants a
dispatch, changes approval, obtains credentials or reopens an episode. Eight new
controls include actual CLI subprocess output, unknown holds and expired prepared
recovery. The combined accounting/ledger suite passed **66 tests**, and typecheck
exited 0. Source hashes, commands, exit codes and logs are in
`verification/20260927-operator-integration/accounting-operator-receipt.json`.

Changed source: `scripts/accounting-cli.ts`, `scripts/operator-files.ts`; documentation
and focused tests accompany them. The exact external runtime remains Node 25.5.0
and pinned Zod 4.1.12; no new provider interface or dependency was introduced.
Provider billing authenticity and automatic runtime ingestion remain unverified.
All inputs in these checks are invented metadata; paid calls and actual spend are 0.

## Immutable experiment metadata and operator export

Commit `82810cc` adds read-only dispatcher metadata capture and immutable aggregate
export/verification. It preserves all 72/270 planned identities, partial usage,
unknown final totals and failed/cancelled rows. Synthetic exports never enter the
live analyzer. The separate CLI pins its private input configuration and the exact
export manifest; verification needs neither the dispatcher database nor old source.
All output continues to state that authenticity and past source execution are not
established by hashes. No candidate contents or sealed definitions are copied.

The author and independent export suite passed 21 tests. Five CLI controls, including
an actual subprocess, bring the combined command to **26 passed**; typecheck exited 0.
Independent review caught an entire-lock versus source-map digest mismatch in the
CLI; it was fixed before integration, with both positive and negative controls.
Commands, exit codes, source hashes, review scope and logs are in
`verification/20260927-operator-integration/experiment-export-cli-receipt.json`.
The underlying independent review preserves its two resolved findings in
`verification/runtime-followup/experiment-export-independent-review.json`.

Five additional independent accounting CLI controls also pass in the root checkout,
covering expired approval, historical receipt CPU with newer current charges, missing
reservations, fresh-journal reset and file collisions. Their receipt is
`verification/runtime-followup/accounting-cli-independent-review.json`. Existing
ledger/importer limits and pinned Node/Zod interfaces are unchanged. No provider
call, real bill, benchmark result or new spending is represented by these tests.

## Integrated private operator handoff

Commits `713bdf3` and `abfa450` add the private smoke operator and explicit configured
`make smoke` route. Preflight, single-attempt sessions, status, cancellation and a
pinned local tokenizer engine are implemented. The default command still stops on
missing provider/account proofs and unconfigured token/CPU ceilings. Reviewed
accounting and aggregate-export commands are separate from execution.

On exact executable source `abfa450d645480c5d2cec5ad7776d36079de5532`, `make test`
exited 0 with **339 tests passed, no failures/skips**, including typecheck and frozen
contract locks. The initial rendered browser attempt exited 1: roughly 19 seconds
of first-case startup consumed the unchanged original-check deadline, and all
three runs ended in infrastructure errors before any proposal. All three failed
bundles are preserved. Two late-created containers were identified by exact failed
run UUIDs and reconciled; no owned container remained. A one-case diagnostic then
passed in 1.332 seconds. The underlying host startup-latency cause is unconfirmed.

An unchanged second browser attempt passed all 14 checks, with zero console/page
errors and desktop/mobile screenshots. All three new policy bundles reproduced
in fresh pinned containers with exit 0, including the failing baseline. No source,
check, timeout or allowance was increased to obtain the retry. `make doctor`
exited 0; default smoke/pilot/evaluate/release-check exited their expected 2.
Commands, exit codes, source and artifact hashes, failures, cleanup, fresh replays
and screenshots are in
`verification/20260927-operator-integration/integration-receipt.json`.

The loopback app at `http://127.0.0.1:43171` now runs that tested detached checkout.
All eight saved terminal runs were preserved, with no active jobs interrupted.
A rendered Evidence-navigation probe passed; its initial button-versus-link test
selector mistake was corrected without an app change and is disclosed in the
handoff receipt. The runtime remains same-host and explicitly mock.

The new external dependency is exactly `@huggingface/tokenizers@0.2.0`, Apache-2.0,
with package integrity and official source references preserved in
`verification/20260927-smoke-operator/receipt.json` and the third-party notices.
No provider calls, paid charges, real experiment scores or human observations were
created. Live experiment factory/dispatch and authoritative provider accounting/
cleanup ingestion remain unfinished; verified access, calibration, real smoke,
experiments and release approvals remain acceptance gates.

## Recorded evidence and release integration

Executable source `4e0116dacc9cf16d1e701b07ae875232e8b952c4` passes `make test`
with **537/537 tests**, typecheck and frozen contract checks. Private smoke
inspection/export now verifies exact terminal journal and curated-input bindings;
the archive shows recorded live/mock modes without execution routes. The new
private check-only replay reserves once against an existing approved ledger,
retains unknown billing and raw operation evidence, and supports cancellation
without automatic restart. Release inputs can select an explicitly accepted live
protocol while preserving smoke presentation scope and historical packet formats.

Independent review fixed literal public-fixture path interpretation, a mutable
replay envelope and accidental initialization of an empty ledger during preflight.
Original failures and bounded review receipts are retained. Provider/operator
tests use invented unit inputs and fake HTTP; they are not sponsor observations.

The actual local browser flow on source `92a2baf` passed 14 checks, including
desktop/mobile comparison and downloads. All three bundles reproduced in fresh
containers. Baseline's first replay timed out under the unchanged 30-second
allowance; one unchanged retry passed. Both attempts remain recorded. The source
used for that flow has identical app/checker/coordinator files to `4e0116d`.
The current loopback app is pinned to `4e0116d`, preserves 14 historical terminal
runs, and was rendered again via Playwright MCP without launching new work.

See `verification/20260927-trusted-replay/receipt.json` and
`verification/20260927-merged-ui-docker/verification.json` for commands, exit codes,
source/artifact digests, exact limitations and cleanup. `make doctor` exits 0;
unconfigured smoke/pilot/evaluate/release-check correctly exit 2. No actual
provider spending, experiment result, human study or public release was created.

## 2026-09-27 — final local completion audit, source 06c584c

Current local status supersedes the prior dated handoff above. The committed
coordinator and release-binding fixes pass 622 tests, typecheck and contract
locks. Three new actual browser comparison runs and their fresh container replays
pass at `06c584c23ac1b620a14ba5e3c68fbdb02199a164`. A fourth curated task abstains
with no mock proposal; replay correctly exits 2 with no selected patch. All 246
unique local operations record cleanup, the final owned-container query is empty,
and all 20 prior export files remain byte-identical. There are 24 terminal runs.

The exact four exports passed a real bounded secret scan. The local packet builds
and verifies with all four source bindings current; checksums pass. `release-check`
correctly exits 2 for open external gates. `make doctor` exits 0. The pinned
loopback application uses this tested source; documentation/evidence commits do
not change its 110 operational files. No provider call or spending occurred.

See [the audit record](verification/20260927-completion-audit/README.md), its
machine-readable integration receipt, commands, original red/green logs, byte
hashes, cleanup records and retained screenshots. Source fixes are committed as
`06c584c`; this section and the actual integration artifacts accompany the next
handoff commit. Real provider access/calibration/billing, matched experiments,
uncoached human review, independent-machine replay and owner release decisions
remain unverified. These are local mock workflow observations, not comparative
model results or competition-ready evidence.


## 2026-09-27 — actual account access and demo preparation

The owner supplied Token Factory access and emphasized both the interactive demo
and a video. Authenticated catalog discovery returned 25 models/four NVIDIA IDs.
Sandbox introspection returned HTTP 400 with `Missing "Project" header`, preserved
as a blocker; project ID/entitlement was requested. A separate bounded Nano marker
control succeeded with 24 input/6 output tokens, exact model and expected marker.
This is inference-access evidence, not a repair episode, selection or benchmark.

The $25 ceiling remains. One existing-only private project ledger reserved $0.10
before dispatch; the usage-priced estimate is $0.00000288, authoritative billing
remains null, and the reservation stays held. No sponsor sandbox or automatic
retry occurred. The credential is outside source/candidate workspaces and logs.
The source-reviewed one-off script, original setup failure, successful no-network
preflight, operation IDs, API versions, command results and remaining gates are
in [the access record](verification/20260927-account-access/README.md).


## 2026-09-27 — interactive archive and captioned walkthrough

Recorder source `4574e74` passes `make test`: 628 tests, type checking and contract
locks. Independent source review corrected redirect handling, transient run/history
pinning and late browser diagnostics. Focused synthetic controls and their earlier
inconclusive attempts are preserved without claiming provider activity.

The actual first capture passed from the committed source. The four-run archive
at loopback port 43173 preserves three declared-check passes and the unsupported-task
abstention. A separate single-run capture produced a 42.84-second H264 MP4 with
readable captions, original WebM/SRT, exact evidence download and file custody.
It shows saved `06c584c` scripted-model/local-check evidence, not the separate real
Token Factory marker call. Recording created zero runs and made zero provider
calls. The coordinator viewed original screenshots and sampled decoded MP4 frames;
this is automated/AI review, not a human usability study. See the
[actual custody record](verification/20260927-archive-recorder/actual-walkthrough-custody.json)
and the recorder verification folder for commands, exit codes, hashes and limits.

## 2026-09-28 — actual public model/local-Docker development observations

The owner-authorized public application at
`https://patchproof.andrewmohawk.xyz` uses
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` through Nebius Token Factory and isolated
**local Docker checks**, not Nebius Sandboxes. It exposes 20 curated development
task IDs, a $0.10 per-run ceiling under the $25 project approval, and availability
gates for new runs. Source `7467626bc77b78ffe4698efc09898471b3ab72f1` passed
664 tests, typechecking and contract checks. See the
[deployment receipt](verification/20260928-live-deployment/final-deployment/deployment-receipt.json),
[original test log](verification/20260928-live-deployment/corrected-release-tests.log)
and [restrictive-umask startup control](verification/20260928-live-deployment/corrected-startup.json).

The first release `88f6de2` run `1ddd6b8b-98ce-45aa-bc11-d9947f41cd4c`
ended `needs_review` after three real model calls. The service umask removed guest
read permission from generated checker inputs; all checks errored. Its original
bundle, recording attempt and $0.00027324 estimate remain preserved in the
[failure record](verification/20260928-live-deployment/first-real-run-failure.json).
Candidate 3 was selected as retained evidence, but no patch was accepted.
Selection must not be described as approval.

The corrected release then produced these real development observations:

| Approach and run | Observed result | Calls / estimated provider USD | Recorded local operations |
|---|---|---|---|
| Baseline `bb948175-27cb-412a-9fb7-ba64b46dd3d6` | `failed`; no accepted patch; selected candidate 3 remains evidence | 3 / $0.00024468 | 72 repeated check operations; all cleanup recorded confirmed |
| Checks only `97808518-b836-41a9-961e-8e5f466dc032` | `verified_for_declared_checks`; first candidate passes all 9 checks | 1 / $0.00012948 | 36 repeated check operations; all cleanup recorded confirmed |

Independent GET-only artifact review verified each bundle against the observed
terminal record, all 116 release source pins, request/operation inventories and
token-rate estimates: [baseline audit](verification/20260928-live-deployment/independent-runtime/bb948175-27cb-412a-9fb7-ba64b46dd3d6-1790558716857/audit.json)
and [checks-only audit](verification/20260928-live-deployment/independent-runtime/97808518-b836-41a9-961e-8e5f466dc032-1790558844772/audit.json).
This checks recorded consistency; it does not independently authenticate billing
or turn the observations into a benchmark. Authoritative charges and sandbox CPU
remain unknown. Original and candidate failures are retained in the denominator.

The corrected public UI passed 15 GET-only browser checks at 1440, 390 and 320 px,
including actual starting-check progress, disabled new-run controls while busy,
no cancellation for an unowned run and zero browser errors. Its
[progress receipt](verification/20260928-live-deployment/read-only-browser/corrected-progress-receipt.json)
does not claim a terminal outcome. Individual approach reruns preserve prior
evidence/history; the [synthetic browser controls](verification/20260928-live-deployment/rerun-control/receipt.json)
passed without provider calls.

The checks-only run passed even though its recorder later failed on an expired
Chromium interception ID. The raw recording/report remain preserved. A narrow
guard correction tolerates only that exact nonredirect continuation error while
still refusing every redirect; [five focused controls](verification/20260928-live-deployment/recorder-interception/receipt.json)
and typechecking pass, with independent source review. No paid run was retried to
hide that observer failure.

Visible-check retry diagnostics were subsequently identified for improvement.
These two runs remain development history; they are not a complete three-arm
comparison or evidence of superiority. The fresh matched exploratory runs and
real-run video are recorded in the next source-bound section. The earlier
42.84-second mock video stays separately labeled. No scored pilot/evaluation,
human study, Nebius Sandboxes result, independent-machine reproduction or final
submission is established by this deployment.

## 2026-09-28 — current matched development demonstration, source 3d0ce9d

The current operational release is
`3d0ce9d33b2169efec6290d7a478d4002a480a58`, operational source
`sha256:f002c913955f022acbd371e37a170126ddb0d935c9203fdf573d014b4101d71b`,
runtime lock `sha256:d122f93095fbbfe47c1d4bfab9f3ac8a5c2323d7d84781e37f51deb7d4ecdbed`.
It passed **676 tests**, typechecking and locked-contract checks in the
[final release log](verification/20260928-live-deployment/final-release-tests.log).
The [deployment-under-load receipt](verification/20260928-live-deployment/final-deployment/release-3d0ce9d-under-load/deployment-receipt.json)
binds the public route to this release.

After improving shared visible-check diagnostics, the coordinator ran a fresh
three-arm development sequence. This protocol change and its preceding runs are
retained; the sequence is explicitly exploratory, not a scored experiment.

| Approach | Run | Accepted candidate / declared checks | Calls | Elapsed | Estimated provider USD |
|---|---|---|---|---|---|
| Baseline | `d11aa1fc-61ee-4b42-a89e-df6b385e4f1d` | Candidate 2 / 9 of 9 | 2 | 135.216 s | $0.00020172 |
| Checks only | `9943a027-4d6c-4f4b-94bb-d1ed4664b2f1` | Candidate 1 / 9 of 9 | 1 | 73.122 s | $0.00012066 |
| PatchProof | `08087e0a-f5d9-4c55-b4b6-7666bc8e016c` | Candidate 1 / 9 of 9 | 1 | 73.933 s | $0.00010692 |

All three share the same fixture, model, source, policy, runtime lock and aggregate
allowances. Baseline's first candidate retained the original behavior and failed
four checks; that rejection remains visible. There is no invented rejected
PatchProof candidate: its first candidate passed. The
[independent three-arm audit](verification/20260928-live-deployment/independent-runtime/3d0ce9d-three-arm-audit.json)
verified 42 per-run assertions, 116 source pins per bundle and 126 unique recorded
local-check operations with cleanup confirmed. One episode per approach does not
establish superiority or a performance estimate.

A separate worksheet task, `v2-r03-t02`, also ran through the public app:
`5b356c42-8848-4e78-bce7-94800f63eebf` **failed**. Selected candidate 1 passed
11 of 13 checks and was not accepted; later candidates had syntax errors. Its
three model calls, 104 recorded local-check operations and $0.00089034 estimate
remain visible in the [secondary failure audit](verification/20260928-live-deployment/independent-runtime/3d0ce9d-secondary-failure-audit.json).
This unsuccessful task is separate from the three-arm sequence, not omitted.

The coordinator's [fresh same-host replays](verification/20260928-live-deployment/final-replays/receipt.json)
all exited 0 without new inference. The three accepted patches reproduced 9/9
passing checks; the worksheet patch reproduced its two failures. Successful
reproduction means agreement with saved outcomes, not repair approval.

Current coordinator accounting records seven actual repair runs plus the earlier
marker call, a $0.00196992 aggregate token-rate **estimate**, and $0.80 retained
in reservations. Authoritative billed charges remain unknown; the $25 owner
ceiling is unchanged. These figures are not independently reconciled invoice
amounts, and unmeasured sandbox CPU stays unknown.

The completed baseline passed [17 public GET-only desktop/mobile checks](verification/20260928-live-deployment/read-only-browser/attempt-03-final-baseline/report.json).
A [72.120-second GET-only walkthrough](verification/20260928-live-deployment/read-only-walkthrough/README.md)
then captured the actual comparison, PatchProof diff/check logs, baseline rejection,
costs and evidence export with eight readable scenes. Its 24 browser requests were
all GETs, no application response or DOM was substituted, and there were zero
browser/guard errors or locator retries. Separate 390/320 px terminal PatchProof
views had no horizontal overflow. Raw footage, captions, source/run/bundle/video
digests and scene timing are preserved. The coordinator also retained actual
creation/progress recordings and their failed observer attempts.

The final **95.120-second H264 video** is published at
[the demo player](https://patchproof.andrewmohawk.xyz/demo/) with a
[direct MP4 download](https://patchproof.andrewmohawk.xyz/demo/patchproof-real-demo.mp4).
It combines actual PatchProof creation/progress with the GET-only evidence
walkthrough of that same run. Waiting omissions are labeled, playback speed is
unchanged, and no outcome is substituted. The
[publication receipt](verification/20260928-live-deployment/public-video/publication-receipt.json)
binds source `3d0ce9d`, primary run `08087e0a-f5d9-4c55-b4b6-7666bc8e016c`
and video SHA-256 `c3acffaa8cc3d84af794efdd86f798ccb3abe4572c5fb370ee62a298a9921864`.
The separate [public playback receipt](verification/20260928-live-deployment/final-deployment/video-receipt.json)
passes 10/10 checks: HTTP 200 download hash equality, Cloudflare HTTP 206 range
support, and actual desktop 1440/mobile 390 playback without errors or overflow.

Prior mock footage is not reused as real-provider proof. Nebius Sandboxes
entitlement/execution, authoritative billing, calibrated model selection and
72/270 experiments, uncoached human exercises, independent-host replay and final
licensing/entry gates remain open.
