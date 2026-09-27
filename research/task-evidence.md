# Task evidence — local product

## Scope and source references

- `4bf1335`: initial seven non-ZIP package files; all six original checksums
  verified before edits. ZIP excluded.
- `811ef1a`: official-source recheck, private repository, owner confirmations and
  exact $25 aggregate approval.
- `251b62f`: initial 17-test contract-only mock scaffold. Its logs in
  `research/verification/20260927T074603Z-local-preparation/` are historical.
- Product implementation: source commit containing this record, exact contracts
  in `research/contracts-v2-lock.json`, and the later local-product verification
  record. That record includes actual commands, exit codes, bundles and run IDs.

The owner explicitly authorized full local development before provider access.
Original real-provider/experiment/release gates remain unpassed. `tasks.json`
separates completed local implementation from blocked external acceptance.
No paid provider call, benchmark result, public deployment or entry is claimed.

## Implemented paths and verification

| Scope | Changed paths | Executed checks and evidence |
|---|---|---|
| T01/T02 | `owner-decisions.json`, `budget.json`, `runtime-lock.json`, contracts, workspace | Config validation, exact $25 ceiling, v1/v2 digest locks, TypeScript checks. Unknown account fields stay null. |
| T03 | `fixtures/`, `workers/evaluator/`, separate evaluator workspace | Full 60 gold/start/repeat validation, targeted revalidation after independent review, aggregate artifacts and preserved revisions. No gold or final vectors in this checkout. |
| T04 | `workers/repair/`, `workers/sandbox/` | Fake HTTP transports plus actual pinned Docker checks, cancellation, parent death, wall deadlines and exact run-owned cleanup. Real Nebius calls NOT RUN. |
| T05–T07 | `packages/orchestrator/` | Same limits, protected paths, policy variants, actual rejected/accepted candidates; scripted model only. Final feedback inaccessible to repair loop. |
| T08 | journal, lease, evidence and patch modules | Durable reopen/idempotency, failed publication, partial infrastructure logs, interrupted-runtime drift, immutable bundle and fresh patch replay. |
| T09/T11 | evaluator planner/adjudicator/analyzer, `research/evaluation/` | Fixed 72/270 plans, protected one-use final adjudication tests, matched budgets/denominators and clustered inference tests. Scored experiments NOT RUN. |
| T10 | `apps/web/`, product API | Actual browser task/comparison/evidence flow, real container observations, export/reload, desktop/mobile and keyboard; HTTP cancellation/denial/SSE tests. |
| T12–T14 | operations, submission draft, local release review, release audit | Local lifecycle/evidence checks, explicit NOT RUN provider/release items; no public rollout or recording. |

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

Sponsor smoke/cost reconciliation, real 72/270 episodes, independent clean-machine
replay, uncoached reviewer timing/accuracy, public demo availability and final
submission: **NOT RUN**, for the specific gates in `research/blockers.md`.
Application license and owner publication/entry decisions remain open.

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
