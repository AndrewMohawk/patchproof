# Independent copy review

Reviewer role: product copy and AI-slop critic. Reviewed the current source, PRD, tasks, live `/tasks` and `/runs`, and rendered public pages on 2026-09-28. Browser requests were GET-only; no run was started. The Playwright MCP profile was occupied, so the skill's isolated local Playwright fallback was used. No console or page error was observed. Browser text is saved in `copy-before-text.json`; screenshots are `/tmp/patchproof-copy-before-home.png` and `/tmp/patchproof-copy-before-failure.png`.

## Verdict on the current interface

The interface reads like a project proposal rather than a tool. Its slogans do not explain the task, its default view exposes implementation vocabulary, and its cautions repeat until the useful qualification becomes background noise. The first action appears below a large title, a full task contract and a resource specification. On the actual failed result, an AI-written candidate summary says it satisfies R01 immediately above executable results showing that R01 failed. That is an accuracy problem as well as a tone problem.

This requires a new information hierarchy and task flow. Changing colors, rounding, fonts or the hero wording alone does not satisfy the redesign request.

## Discussion with the two UX/UI reviewers

- All three reviewers agreed to remove the slogan hero, decorative step numbers, process strip, oversized check symbol and promotional footer.
- We converged on **Examples** and **Runs** as the main navigation. Comparison belongs inside a task or saved run, not as a competing first action.
- We challenged the original suggestion to show only the latest successful result. The selected example should link to its latest run regardless of outcome, with its status visible. Failed history remains available.
- We considered “Fix this example,” “Run repair” and “Generate patch.” **Generate patch** is the agreed primary action: it names the output without promising that every attempt will fix the task.
- We agreed that **Patch / Checks / Activity / Run details** makes result navigation more usable than simultaneously displaying every log, digest and resource counter.
- We agreed that concise display summaries can help, but the exact task statement and requirements must remain accessible and bound to the actual fixture/run. A rewritten summary is not the acceptance contract.

## Exact replacement copy

| Current | Recommended | Reason |
|---|---|---|
| “A patch is the beginning. The evidence makes it reviewable.” | **Example tasks** | A workspace title, not a slogan. |
| “Choose a maintenance task. Follow the repair. See exactly which requirements the checks support.” | **Choose a Python task to generate and check a patch.** | One useful sentence. |
| “Owned Python fixtures with explicit maintenance requirements.” | **Small Python examples with known requirements.** | “Owned” and “fixtures” answer internal governance questions. |
| “Your next review starts here” | **Loading examples…** or **Choose an example** | State what is happening or needed. |
| “Run PatchProof →” | **Generate patch** | Concrete, does not imply automatic application or guaranteed repair. |
| “Compare all three” | **Compare methods** | Secondary action; explain three methods inside the comparison view. |
| “Review recorded evidence →” | **View latest run** with visible outcome | Avoids cherry-picking success and vague “evidence.” |
| “Requirements to preserve” | **Full requirements** | All requirements include target behavior and compatibility, not only preserved behavior. |
| “EVIDENCE ARCHIVE” | **Saved runs · read only** | Recognizable behavior, less internal vocabulary. |
| “MOCK MODEL · LOCAL CHECKS” | **Scripted model · local checks** | Keep unmistakable mock identity, with a nearby **Demo data** label; never call it a real model run. |
| “RECORDED LIVE · LOCAL DOCKER CHECKS” | **Real model run · local checks** | Factual source distinction; exact service and image live in Run details. |
| “Passes declared checks” | **All listed checks passed** | Human wording with scope built in. Can instead show **9 of 9 checks passed** if this is the actual check count. |
| “Needs review” | **Checks incomplete** when that is the reason | Every patch needs review; distinguish missing evidence from a normal successful review state. |
| “Checks failed” | **Some checks failed** | Follow immediately with number and failing behavior. |
| “Execution error” | **Run could not finish** | Show actionable cause; do not turn an infrastructure fault into a failed requirement. |
| “The selected candidate satisfies all declared local checks.” | **This patch passed the listed checks. Review the changes before applying it.** | Scoped, direct, stated once. |
| “Candidate history” | **Attempts** | Standard product language. |
| “Candidate 1 · rejected · selected” | **Attempt 1 · kept for review** and **Checks failed** | Selection on failure is not acceptance. |
| “Candidate 1 · passed · selected” | **Attempt 1 · final patch** and **Checks passed** | Clear relation between attempt and final choice. |
| “Requirement coverage” | **Requirements** | Outcomes belong directly beside requirement text. |
| “Independent runtime acceptance checks” | **Requirement checks** | Independence details belong in Run details. |
| “Visible checks” | **Development tests** | Keep the technical distinction understandable; explain it once if needed. |
| “Observed result and log” | **Expected and actual result** | Opens concrete evidence. Raw diagnostic log is a further detail. |
| “Execution journal” | **Activity** | Event times plus meaningful stage names; request IDs are details. |
| “Resource accounting” | **Usage and cost** | Familiar terms. |
| “Provider cost $0.000132 (estimate)” | **Estimated model cost $0.000132** | Put uncertainty in the label, not an easy-to-miss suffix. Keep precision; never round a small positive amount to zero. |
| “Not measured” for billed cost | **Final charge not available** | Separates missing invoice from measured token estimate. |
| “Approved provider spend” | **Spending limit** | Direct label, exact same limit. |
| “Sandbox CPU / limit” | **CPU time / limit** | Runtime details identify local Docker or Nebius correctly. |
| “Reproducibility” | **Run details** with **Replay instructions** | Navigation need, not a quality claim. |
| “Immutable inputs and trace references.” | Remove | The detailed fields already carry this information. |
| “Download evidence ↓” | **Download results** | Supporting detail **JSON with patch, checks and run details**. |
| “Retry saved task context” | **Reload run details** | Names the user's object. |
| “Your evidence starts with a run.” | **No runs yet** | Familiar empty state. |
| “Curated tasks only. Every change remains yours to review. Nothing is merged automatically.” | **Patches are not applied automatically.** | Example-only scope should already be evident in the selection view. |
| “Decisions backed by executable checks.” | Remove | Footer slogan adds no task value. |
| “Declared checks are evidence, not a correctness guarantee.” | Use the scoped result sentence once near the status | Repetition is not stronger honesty. |

## Concrete task presentation

For `stable-unique-01`, a concise display title can be **Remove repeated list items** and a summary can be **Keep the first copy of each item, even when duplicates are separated.** A tiny hand-authored example can show `[1, 2, 1] → [1, 2]`, clearly labeled **Expected behavior**. Do not label this illustration as the model's actual result. “Full requirements” retains the complete Python equality, input mutation and error behavior contract.

The current corpus title and requirement text are exact inputs. Display summaries must not silently replace or weaken those inputs. Saved runs must continue showing their saved requirements rather than a newer catalogue revision.

## Success and failure need different first screens

Success: task title, scoped pass count, actual final patch, and download. Checks are one click away. No “safe,” “proved correct,” “production-ready,” “winning,” “best,” or generalized performance claim.

Failed checks: failed count, a plain explanation of the failed behavior, expected/actual values, then the retained patch. Show that the patch is kept for review, not accepted. On run `5b356c42-8848-4e78-bce7-94800f63eebf`, do not repeat the model's claim that None handling was fixed as if the checks established it.

Incomplete checks: say what was not checked and why. Do not use green styling merely because some checks passed. The previous container permission failure must remain visibly distinct from a candidate that ran successfully and failed a behavioral check.

Raw `candidate.summary` is model-authored and can be wrong. Either omit it from the default result or label it **Model's change summary**. Computed result summaries must come from observed checks.

## Technical copy accuracy to repair

The current live-run reproducibility panel always says replay requires an approved private provider configuration and may cause provider charges. Actual local-container evidence is replayable without model inference. Render instructions from the recorded backend/scope; never apply sponsor-sandbox instructions to the real local Docker demo.

Comparison must explain each method in plain language without changing their implementation. “Checks only” is especially misleading: it still generates patches. Suggested labels are **Basic repair**, **Repair with requirement checks**, and **PatchProof**. Exact variant IDs belong in Run details. Method comparison may say the task/model/limits match only after recorded signatures match. A few runs cannot justify a performance claim.

## Anti-slop acceptance rubric for the implemented build

1. On a fresh desktop and phone view, a visitor can identify the example, understand what is wrong, and find the primary action without reading a manifesto or resource ledger.
2. No promotional hero, vague slogan, decorative numbered workflow, duplicate section introduction, faux certainty, or repetitive qualification remains.
3. Navigation labels name user objects and actions. One primary action is consistent across all views.
4. A saved successful result and a saved failed result can each be opened in one obvious interaction from the relevant example or run list.
5. Outcome, requirements/check counts and patch selection mean the same thing. A requirement count is not called a check count. Failure is never called accepted because a candidate was selected.
6. Model-authored text is visibly attributed or removed from the result summary. Observed failure is not contradicted by a model assertion presented as fact.
7. Exact requirements, all failed history, raw check observations and download remain accessible after decluttering. Empty and unavailable states give a useful next step.
8. Real model, mock model, local checks and recorded-only modes remain distinguishable. Live and mock data are never silently compared as equivalent.
9. Spend limits are visible before an action. Estimated cost and missing final charges are explicit without dominating the main workflow.
10. Copy reviewed in the rendered deployed build, including mobile, long task text, successful/failed/incomplete checks, comparison mismatch and paused runs. Source search alone is not signoff.

Post-implementation signoff: **NOT RUN**. This document is critique and acceptance criteria, not approval of an implementation.
