# Updated rendered comprehension review

Reviewed on 2026-09-28 at <http://127.0.0.1:43179/>. I entered without a hash and followed the main actions through the bug, proposed patch, decision, failed repair, and failed-check detail. I also followed the successful run's patch/check detail, expanded its requirements and checks before repair, inspected run details, and opened the curated task workspace. The review used rendered content only; no source, PRD, or other reviews were consulted. An isolated Playwright browser allowed GET/HEAD only. No new repair was requested.

## Judgment

I can now explain the product without an external guide: a developer asks a model for a small maintenance fix, PatchProof checks the proposed code against requirements the model cannot edit, and the developer receives the patch and its recorded results to review. The walkthrough makes that explanation concrete with one successful repair and a separate failed repair. This conclusion comes from the content and the linked result detail, not merely from working navigation.

## The six questions

| Question | Answer supported by the rendered page | Content that establishes it | What still needs care |
| --- | --- | --- | --- |
| Who is this for? | Developers reviewing AI-generated code changes. | The first paragraph explicitly says “For developers reviewing AI-generated changes.” The example asks me to imagine maintaining a Python library. | The available experience is curated Python examples. The page does not establish that I can connect or submit my own repository. |
| What problem does it solve? | It helps decide whether a proposed AI fix actually satisfies the specified behavior before using it. | “Check an AI code fix before you use it,” the duplicated `elm` input/output example, and the stated constraints to preserve the caller's list and error behavior. | This is a narrow demonstrated maintenance workflow, not evidence of general-purpose repository repair. The copy mostly maintains that boundary. |
| What am I being asked to do? | First inspect a saved example, follow its patch and check results, and decide what further review it warrants. A separate route lets me try generating a repair. | The primary “See the AI patch” action leads to “See the check results,” then “See a repair that failed,” then “Inspect the failed checks.” “Try a new repair” is distinct. | No external narration is needed to follow this path. The walkthrough remains primarily an explanation; the actual review decision occurs when I inspect a result and decide whether to use the change elsewhere. |
| What will the primary action produce? | On first entry it opens a saved patch, without a new model call. In the repair workspace, “Generate patch” asks the live model for a repair and checks it against requirements. | The final inspected walkthrough says “Saved real repair · No new model calls.” The workspace introduction explicitly describes generation followed by checking and says nothing is merged. | I did not execute generation. Its live behavior, payment ownership, and enforcement of the $0.10/300-second limits remain outside this review. |
| Why is this useful beyond a model returning code? | It provides a proposed change, specified requirements, executed-check results, expected-versus-observed values, failure history, and a record for review or replay. The checker, rather than the model's explanation, determines the reported result. | The patch scene explains that checks are stored outside editable files. “What you get beyond generated code” states the output. Linked detail exposes checks, original failures, requirements, and run records. | The page now explains the intended difference. It does not establish that the system outperforms an ordinary model-plus-tests workflow, and explicitly says these examples do not establish a benchmark advantage. |
| What result can I actually trust? | The displayed saved record reports a change from five of nine passing checks to nine of nine. A separate repair still fails two of thirteen checks and is not approved. Those are bounded results against listed checks, not a correctness guarantee. | The decision scene gives before/after counts and coverage categories. The linked “Checks before repair” shows four original failures. The failed-check detail visibly shows expected `null` becoming observed `9`, with later attempts labeled check errors. | I have inspected displayed evidence, not independently replayed it. The page itself says passing examples does not guarantee every possible input and that applying the change remains my decision. |

## Evidence and claims

The successful walkthrough's arithmetic matches the linked rendered detail: five checks for duplicate/order behavior, two for unchanged input, and two for the existing invalid-input error. The detail identifies the three requirements and the checks attached to them. Before repair, four checks fail; after repair, all nine are shown as passing. The failure story also matches the linked detail: eleven passes, two failures, and later execution-error attempts. “Inspect the failed checks” opens the checks view directly, so the promised explanation is immediately present.

The real-run attribution has visible supporting records: a model identifier, provider request ID, Docker operation IDs, source/policy/runtime digests, and elapsed/cost information appear in run details. Costs are explicitly estimates; CPU and other unknowns are not presented as measured. These records strengthen the provenance story without letting a browser-only review independently authenticate the provider or execution environment.

Two meaningful claims remain claims rather than proofs available from the rendered walkthrough alone:

- **The model cannot rewrite the checks.** The text explains the boundary clearly. Check output and a failed repair are consistent with it, but neither demonstrates the editing restrictions themselves. I would describe this as the stated architecture, not a protection I independently verified here.
- **The downloadable record supports replay.** Run details give a replay command and say inference is not rerun. However, they require the source checkout recorded by the run; the reviewed path does not establish how a first-time public visitor obtains that checkout and environment. I did not download or replay the bundle.

I saw no claim of superior benchmark performance, guaranteed correctness, automatic merging, or fully measured total cost. The explicit limits are useful and visible rather than buried exclusively in detailed records.

## Remaining comprehension friction

- The phrase “The model checks all retained items” briefly sounds as if the model is performing verification. The following explanation and code make clear that the *proposed function* checks membership in the accumulated result. This is a local wording ambiguity, not a failure of the overall story.
- “Invalid input” in the brief success summary is broader than the detailed requirement actually shown: passing `None` raises `TypeError`. Reading the full requirement resolves the scope; the brief label alone could suggest more validation coverage.
- “Not approved” is understandable as a failed PatchProof result because the page also says the user decides and nothing is merged. I do not infer repository approval or a human review decision from it.
- The task workspace still displays internal labels such as `owned-v2-r01`, and the $0.10 maximum does not explain who is billed. Neither prevents understanding the saved walkthrough, but both can matter when deciding to start a new run.
- The exact checks are more technical than the walkthrough: identifiers and JSON are appropriate evidence, but the step-by-step story is what makes them interpretable to a first-time viewer. The main path no longer depends on a separate guide or presenter.

## Inspection notes and boundaries

An early preview rendered both Python excerpts without indentation. After reporting that observation, I revisited the rendered patch scene and confirmed indentation was preserved. It is not an outstanding finding in the final inspected version.

A later fresh page load displayed “Could not load the workspace. signal timed out” alongside “Loading the recorded example…”. The coordinator identified an overlapping frontend rollout. I preserve this as a rollout-time availability observation; the complete comprehension path above had already loaded and been inspected successfully.

The new explanatory video was not ready for this review and was not assessed. A separate first-30-seconds video review remains pending. I did not inspect source, execute replay, start a paid operation, or validate backend isolation.

Capture references include `/tmp/patchproof-judge-updated-first-screen.png`, `/tmp/patchproof-judge-updated-patch-final.png`, `/tmp/patchproof-judge-updated-decision.png`, `/tmp/patchproof-judge-updated-failure.png`, and `/tmp/patchproof-judge-updated-failed-detail.png`.
