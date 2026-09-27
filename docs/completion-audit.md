# Completion audit — local implementation versus external proof

Reviewed 2026-09-27 against source commit `b3ee8ea9d4b9dcdd4a8666481197748c48707a77` and the working tree at review time. This is a bounded, independent evaluator review of the original PRD, task deliverables and public repository. It is not a release approval, task-status change, provider test or scored experiment. No sealed task contents or gold sources were used in this audit.

The local product is implemented, with recorded browser and fresh-container replay evidence. Provider credentials alone would not finish the original package: several orchestration and study components still need code. Parallel work may supersede the observations below; each item needs its own linked test receipt before closure.

| Priority / requirement | Current implementation evidence | Work that can be completed without provider access | Completion proof |
|---|---|---|---|
| P0 — T09/T11 experiment dispatch | `workers/evaluator/cli.ts:9` implements only plan/analyze. `scripts/product-cli.ts:43` unconditionally blocks smoke/pilot/evaluate. `workers/evaluator/adjudicate.ts:11` is a separate callable boundary; no dispatcher joins it to episode execution and analysis. | Add a trusted dispatcher with injected repair/check transports, frozen plan validation, one durable identity per planned episode, finalized selection, one-shot adjudication, cancellation/restart handling and `EpisodeResultSchema` export. Never expose sealed callbacks or records to the repair interface. Use the project budget ledger before any paid dispatch. | Deterministic synthetic transport tests for the full 72/270 grids, setup failure, cancellation, crash recovery, duplicate dispatch and unknown billing. Every planned episode remains accounted for; no paid transport is called when a gate fails. Synthetic plumbing results must not enter the live scored analyzer as observations. |
| P0 — T05/T07 and frozen operational protocol | `research/contracts-v2-lock.json` freezes product schema files but explicitly leaves the live protocol unfrozen. `workers/evaluator/cli.ts:20` binds only `protocol.ts` as policy. The model prompt, generation options, retry/selection policy, checker implementation and code release are not collectively bound. `RepairInput` in `packages/contracts/src/product.ts:31` has no experiment seed/generation configuration. | Add an operational lock covering executable/prompt/checker digests, image, request parameters and supported seed behavior, candidate/branch/stop/tie-break policy, feedback projection, stable-check repeats and budget charging. Bind plans, calls, selected artifacts and result rows to it. Freeze only after development calibration; no invented provider-supported options. | Changing any frozen component invalidates dispatch/replay. Tests demonstrate equal allowances and the intended B0/B1/P information and selection differences. A supplied seed is never presented as deterministic inference proof. |
| P0 — operational B1/P distinction | `packages/orchestrator/src/coordinator.ts:180` supplies progressive candidate files and acceptance feedback to both B1 and P. At `:194`, P resets the merge base, but all 30 public fixtures use one fully replaced `solution.py`; for the same proposal stream this does not distinguish their search behavior. Parent IDs differ. Selection at `:217` also uses acceptance-check scores for every variant, including B0. | Define and test variant-specific proposal and selection behavior prospectively. Root is correcting P input to the immutable original; B1 should retain progressive input. Decide explicitly whether B0 selection can inspect acceptance results or uses visible checks only. Preserve separate post-selection acceptance reporting. Three candidate branches and 24 allowed calls also need an explicit operational relationship. | A capture-provider regression observes different intended P/B1 inputs on the second proposal and equal total limits. A baseline regression verifies that unavailable acceptance feedback cannot affect its repair/selection decision. This establishes behavior, not advantage. |
| P1 — T11/G4 reviewer exercises | `docs/reviewer-guide.md` is a walkthrough, and the browser script is an automated developer test. No assignment generator, private answer key, timing events, response capture or study report exists at the audited commit. | Build frozen randomized/counterbalanced assignments, neutral reviewer packets, a private condition/answer key, immutable start/submit records and scoring that retains missing assignments. Use public authorized artifacts or synthetic unit inputs. Reviewer recruitment and actual answers remain separate. | Synthetic tests cover deterministic assignment, missing/duplicate responses, invalid order/timestamps, answer-key separation and denominator retention. Real human data is needed before reporting usability time or accuracy. Assigned to the independent evaluator after this audit. |
| P1 — F09 stable-check behavior | The audited coordinator runs one check batch per candidate; preparation repeats gold checks, which does not establish runtime handling of unstable candidate checks. `docs/local-release-review.md:30` records this limitation. | Freeze a bounded repeat policy; retain both observations, detect disagreement and produce `needs_review`. Charge repeats equally to all variants and include them in replay. Root is implementing this separately. | Deterministic changing-runner regression rejects mixed pass/fail or missing observations; stable outcomes and exhausted repeat budgets remain distinct. Repeat counts and costs must survive export/replay. |
| P2 — T12/T14 evidence-driven release checks | `scripts/release-audit.ts:24`–`:35` hard-codes hosted access and experiment/replay gates as blocked/not-run; `scripts/product-cli.ts:41` always returns exit 2. This is honest today but cannot consume future completion evidence. | Define receipt schemas bound to source/runtime/protocol/bundle digests; validate local prerequisites and recorded external evidence separately. Add an immutable local release-packet builder containing setup instructions, notices, checksums, selected success/failure artifacts and verification commands. Keep publishing/entry as owner actions. | Missing, stale, malformed or mismatched receipts fail closed. A synthetic receipt test proves aggregation without inventing real provider or human evidence. The real release passes only with actual receipts and owner decisions. |
| P2 — T13 release assets | `docs/submission-draft.md:36` has a 165-second storyboard; screenshots and a setup guide exist. There is no recorded rehearsal, caption/transcript artifact or source-to-claims manifest. | Produce a clearly labeled local rehearsal from actual current app actions, readable captions, and an asset manifest binding the shown commit/run/bundle IDs. Prepare the final packet template with empty fields for unavailable results. This can remain local/private. | Check recording duration, visible mock labeling, readability and claim-to-artifact links. A mock rehearsal never satisfies sponsor-backed G4 proof. |

## Proof that remains externally blocked

- **G0/G1:** verified account/model/sandbox access, actual supported generation behavior, isolation controls, two sponsor-backed tasks, cancellation and reconciled billing. Fake transports and local Docker do not establish these.
- **G2/G3:** affordable prospective allocation, frozen calibrated protocol, live 72/270 grids or an explicitly revised smaller protocol, retained failed episodes and measured comparisons. The project ceiling is $25; final evaluation/hosting allocations are currently zero.
- **G4 and impact:** genuine successful/failure run set and uncoached human review. Tooling and synthetic answers are not participant results.
- **T12/T14:** independent-machine replay and verified judged-demo availability with an assigned operator/funding. The clean archived checkout receipt shares this host's Docker image/npm cache and says so.
- **T13/T14:** application license, publication/entry decisions, current rule review and release authorization. Those are owner decisions rather than missing credentials.

The original PRD requested independently authored repositories. Current documentation correctly describes one synthetic authoring process and logical repository-disjoint groups. Independent oracle review improves validity but does not create independent repository authorship. Record that scope deviation explicitly and keep claims narrow rather than calling the dataset representative.

## Audit evidence and limits

Read-only source inspections used `rg`, `rg --files`, numbered source views and JSON metadata inspection. `git rev-parse HEAD` returned the commit above. A public-fixture metadata check counted 30 files, all with one source file and the allowlist `solution.py`. Existing verification receipts were inspected, including the same-host clean checkout receipt; their commands were not rerun for this audit. **Tests: NOT RUN for this source/documentation audit.** No provider calls, spending, human responses or experiment rows were created. The separate independent protocol review already records 26 synthetic algorithm checks; that is narrower than an end-to-end experiment dispatcher test.

## Coordinator follow-up (not the original independent review)

Commits `8ca9f0e` and `15f39c7` implement and verify variant-specific inputs/selection,
two-observation runtime checks, source/configuration-bound local locks, a durable USD
ledger, prospective reviewer tools with a separate rendered collector, and release
receipt/packet tooling. The source-bound browser flow, all three fresh patch replays,
150 tests, synthetic reviewer browser exercise and scan-gated local packet checks
passed. A private 91-second mock rehearsal, captions and exact source archive were
captured. See the linked task evidence and `20260927-runtime-completion` receipts.

These close the identified local checker, reviewer-surface, packet and rehearsal
implementation gaps within their documented limits. They do not close live protocol
calibration, bounded provider factory/dispatcher integration, real experiments,
actual human review, independent-machine replay or public release requirements.
The operational lock deliberately states that it is local and unscored.

## Further coordinator follow-up

The durable dispatcher now passes 38 author/independent/boundary tests. The trusted
smoke factory subsequently joined the provider adapters, repeated checks and durable
spending reservation; the full suite passes 203 tests, and the actual local browser
flow plus all three fresh patch replays passed. Receipts are under
`research/verification/20260927-smoke-integration/`. These are local and synthetic
provider observations, not actual account or scored evidence.

A remaining accounting boundary is explicit: provider adapters retain unknown USD,
while the dispatcher requires complete runtime billing and measured CPU before
paid final adjudication. A trusted reconciliation handoff and calibrated executor
are still required. Access alone does not close those implementation gaps, and a
terminal episode must never silently reopen when later billing arrives.

## Synthetic executor and accounting integration

The shared product loop now also backs a synthetic-only 24-revision executor with
up to three progressive branches and a separate immutable trace. Trusted accounting
receipts preserve cumulative amounts and operation history, retain uncertain holds,
and recover interrupted imports while fencing stale writers. Independent controls
cover their metadata/accounting boundary; neither tool establishes actual billing.

The integrated source at `93fa291` passes 272 tests, the real local browser flow and
all three fresh patch replays. See
`research/verification/20260927-experiment-plumbing/integration-receipt.json`.
Remaining implementation is the calibrated live factory/session, trusted operator
commands, authoritative evidence ingestion and aggregate export wiring. The earlier
external proof gates remain open. No final benchmark result has been observed.

## Private operators and aggregate export

The private smoke entry point now supports preflight, durable single-attempt
sessions, status and cancellation. It pins a bounded tokenizer engine and requires
verified artifact/account/control inputs. Separate accounting commands import
reviewed receipts and recover expired prepared writes. Aggregate export/verification
retains every planned identity without copying candidate or sealed contents.
Its manifest explicitly does not authenticate historical source execution.

Integrated source `abfa450` passes **339 tests**, typecheck and frozen contract locks.
The operator-level tests include actual metadata CLI subprocesses, synthetic session
lifecycle and independent accounting/export controls. The source-digest mismatch
found during CLI review was fixed before integration. These are implementation
checks, not live provider or participant results.

Remaining local integration is the calibrated live 24-revision experiment factory
and dispatch entry point, plus authoritative billing/cleanup ingestion. Current
account and tokenizer proofs are absent and live episode token/CPU ceilings are
unconfigured. Real smoke, calibration, experiment, human-review and release proof
gates remain open. The original audit paragraphs above are preserved as historical
observations; this follow-up supersedes their operator/export implementation gaps.

## Live experiment composition

The guarded 24-call/48-batch live factory and private session command are now wired
to the existing adapters, protected selected-candidate adjudication, a fixed project
ledger and separate runtime/adjudication receipt intake. Configured `make pilot`
and `make evaluate` enforce the corresponding plan kind. Default invocations
remain blocked. Phase receipts cannot release funds or reopen a terminal episode.
The composed fake-provider test requires two separately accepted receipts, records
their combined charge once and retains the final aggregate. These are invented
observations, not actual calibration, billing or model results.

Independent controls exposed decimal rounding, mutable-request, SQLite sidecar
collision and cleanup-drain issues; fixes and original failing controls are preserved
in the verification receipts. Cancellation/recovery can use the existing durable
ledger policy even after execution configuration changes. Raw late check evidence
stays in the protected evaluator workspace, while terminal history stays immutable.

This closes the earlier local factory/session/dispatch wiring gap. Provider access,
authoritative costs and cleanup evidence, verified calibration/protocol acceptance,
real smoke and experiments, human review, independent-machine replay and release
decisions remain required. The $25 approval does not establish experiment affordability.
Final-evaluation and hosting allocations are still zero.

Integrated source `7736490` passes **448 tests**, typecheck and frozen contract
checks. The exact commands and limitations are recorded in
`research/verification/20260927-live-operator-integration/integration-receipt.json`.
One inactive project-owned container was found after testing and removed by its
exact inspected identity; the previously documented Docker late-create cleanup
race remains an operational limitation. The local browser app still serves its
previously verified `abfa450` checkout; this operator-only update does not claim a
new browser or independent-machine replay.
