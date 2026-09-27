# Evaluation protocol and offline tools

The frozen v2 suite, protocol planner, sealed adjudication boundary and statistical analysis are implemented. Local T03 preparation is complete: 12 separately authored repositories and all 60 tasks passed fresh contract 2.2 reviewer runtime validation. The integrated product suite at `c335031` passes all 585 tests; the actual v2 browser comparison and all three fresh-container patch replays pass. All three scripted policies pass their declared checks, which establishes workflow behavior rather than an advantage. See the [integration record](../research/verification/20260927-corpus-v2-integration/README.md). No inference experiment or reviewer-time study has been performed. The $25 owner ceiling is shared by the whole project; draft plans allocate $0 until actual provider access, prices and projected costs have been verified. Planning never spends money.

## Fixed experiment grids

The prerequisite [eight-task model probe](model-probe.md) has a separate offline
planner/analyzer with one fixed baseline procedure across candidate models. Its
catalog and real observations remain unavailable. The original v1 corpus and its
plans are preserved. Twelve fresh AI contexts independently authored the v2
repositories; separate static review, fresh contract 2.2 runtime validation and
the immutable corpus freeze are complete. The 30 public fixtures and aggregate
provenance are integrated into this checkout; gold and final definitions remain external.
The author contexts share a model and host, so this is procedural authoring
separation, not independent human authorship or a representative upstream sample.

The pilot selects the first three task IDs in lexical order from each of four development repositories: 12 tasks × baseline/PatchProof × three repetitions = 72 episodes. The final grid includes every final task: 30 tasks × baseline/checks-only/PatchProof × three repetitions = 270 episodes. Selection is based only on the frozen task manifest, before result access.

All arms receive identical task statements, requirements, model lock, source, token caps, inference-call caps, wall-time caps, CPU caps and dollar reservations. The v1 proposal fixes 24 calls and 900 wall seconds. Draft input/output limits are 64,000/16,000 tokens and require development-only calibration before freezing. Branches and retries share the episode allowance. The ordinary baseline receives visible-test feedback; checks-only and PatchProof receive the same independently controlled runtime acceptance feedback. This information difference is the declared B0/B1 ablation. The maximum feedback-round allowance is identical, and final oracle feedback is always zero during repair.

The model is not declared deterministic because a seed exists. Repetitions measure variability; they are never treated as independent tasks.

The current offline [v2 pilot draft](../research/evaluation/pilot-plan-v2-draft.json)
and [v2 final draft](../research/evaluation/final-plan-v2-draft.json) bind the new
manifest. Their [generation receipt](../research/evaluation/corpus-v2-draft-generation.json)
records `executionAuthorized: false`, unknown model/prices and no provider calls.
The v1 plans remain byte-identical historical artifacts. No model-probe plan has
been accepted: its catalog, suitability threshold and calibration inputs remain
unavailable. Draft generation is not a live protocol freeze or permission to execute.

Create offline draft plans with explicit new output paths:

```sh
node workers/evaluator/cli.ts plan pilot /tmp/patchproof-pilot-plan.json
node workers/evaluator/cli.ts plan final /tmp/patchproof-final-plan.json
```

`planExperiment()` refuses crossed splits, incomplete five-task repositories and aggregate budget reservations that exceed the experiment allocation. `assertExecutionReady()` additionally requires verified account/model/sandbox access, real integration, independent oracle review, an approved price projection, remaining funds and a frozen protocol. A $25 project ceiling does not imply that either grid is affordable. Reduce a grid only prospectively under a new protocol and weaken the associated claims.

## Protected evaluation workspace

The current frozen evaluation workspace is
`/home/andrewmohawk/patchproof-evaluation-v2/frozen-v2`. Authors received their own
job and shared schemas in fresh contexts, without sibling definitions or prior
repair results. An evaluator who is not an author owns review, gold, sealed checks
and runtime preparation. The [freeze receipt](../research/corpus-v2/freeze-publication-receipt.json)
binds the accepted manifest and public staging bytes. Corpus acceptance does not
authorize experiment dispatch. The original `patchproof-evaluation` workspace,
v1 plans and evidence remain preserved history.

These workspaces are never mounted into a candidate container. Local authoring
agents share an OS identity, so context separation is procedural; runtime
isolation is the container mount boundary. Production evaluation must run under
a separate trusted evaluator account/workspace.

`adjudicateSelectedCandidate()` accepts an explicit absolute external workspace, frozen fixture and oracle digests, and a finalized candidate digest. It compares the selected source with the task edit policy and independently reruns the visible, frozen acceptance and sealed checks, so passing a few sealed examples cannot excuse a known public regression. It sends only candidate source plus one function invocation to a fresh check container. Sealed expected values remain in the trusted checker. The function returns only aggregate adjudication and an artifact digest; detailed sealed check values/logs remain outside this repository. An exclusively created episode reservation prevents a second candidate from querying the same episode oracle. The repair loop has no evaluator callback.

The [v2 preparation tools](../research/corpus-v2/tools/README.md) document the
source-pinned intake, structural checks, independent review, runtime validation
and final freeze. They retain exact source snapshots and observed tool versions.
The earlier `workers/evaluator/validate-fixtures.ts` command reproduces neither
the v2 authorship process nor its full provenance review. Do not run it as a
substitute or overwrite accepted receipts with a new attempt.

Static review covers 60 tasks, 180 requirements and 1,582 authored case definitions:
262 visible, 644 acceptance and 676 sealed. All 51 findings were resolved across
12 correction revisions. The runtime preparation additionally checks 75 authored
negative controls, 13 reviewer semantic probes and 12 reviewer mutation or
error-preservation controls. The [public reviewer summary](../fixtures/independent-review-summary.json)
records all 60 accepted tasks with passing gold, a rejected faulty start and stable
repeated gold observations. The 12 accepted repository preparations have no
infrastructure failures; two unsuccessful fresh preparation attempts remain in
history and are counted separately. Earlier contract 2.1 attempts are preserved
and do not substitute for fresh 2.2 input and observation checks. These are fixture
checks, not scored model episodes.

The JSON invocation boundary tests representable values and argument snapshots.
It does not establish returned-object alias identity, arbitrary Python objects,
unbounded numeric behavior or universal correctness. One sealed invocation
repeats a public invocation and is not new held-out coverage. Exact source-map
comparisons found no starting or gold duplicates across repositories; forty gold
map pairs are identical within their own repositories. That textual audit does
not prove semantic or statistical independence. Gold and sealed content remain
outside the repair checkout. Human scope review remains open.

## Episode accounting and analysis

Keep one `EpisodeResultSchema` row for every planned episode, including unsuccessful repair, timeout, cancellation, setup failure and unresolved verification. Usage includes setup and retries. Rows require live execution mode and bind to the plan, model, policy and artifact hashes; mock rows cannot enter the scored analyzer. Do not replace unsuccessful rows or reallocate their unused calls to another arm.

The primary correct-patch denominator contains all planned episodes, including infrastructure failures. A secondary semantic view may exclude only preregistered provider-unavailable, rate-limit, sandbox-setup or provider-timeout failures; the report always retains those failures operationally. False approvals show the count of runtime-approved incorrect patches, the independently adjudicated approved denominator and unresolved approvals separately. Missing billing produces an incomplete-cost label and suppresses cost per correct patch.

```sh
node workers/evaluator/cli.ts analyze PLAN.json EPISODES.json NEW-REPORT.json
```

The analyzer rejects duplicate/unplanned rows and runtime drift, records budget violations, and suppresses comparison intervals for incomplete or unmatched experiments. It bootstraps **repository clusters**, keeping all task/repetition pairs and arms together, with 10,000 fixed-seed resamples and percentile 95% intervals. It reports both baseline comparisons. Four pilot or six final clusters produce coarse uncertainty; synthetic-family similarity limits external validity.

G2 counts a task as repaired when at least two of three repetitions are independently correct. It requires two additional majority-correct tasks over B0, no increase in observed false approvals, no unresolved approvals and matched budgets. G3 reports the proposed ten-percentage-point target over the strongest observed baseline and both comparison intervals. Overlap with no benefit against checks-only recommends a smaller checks-only product. These are prospective decision rules, not results.

Post-result protocol changes are classified `exploratory` by `classifyProtocolChange()`. Preserve the original report and immutable inputs. Do not quietly change exclusions, caps, task selection, oracle cases or gates after viewing final outcomes.

## Remaining evidence

Live provider evaluation, owner-reviewed oracle quality, calibrated live-protocol freeze, observed costs, blinded reviewer timing/accuracy, and independent clean-machine replay are not established by the offline tools. The v2 corpus freeze is complete; the final corpus remains sealed and is intentionally absent from a normal public source clone. Publication of the suite requires an explicit owner-controlled release after the experiment; future uses must disclose public exposure.
