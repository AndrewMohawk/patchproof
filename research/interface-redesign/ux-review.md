# PatchProof UX review

Reviewed 2026-09-28 against the deployed GET-only interface at https://patchproof.andrewmohawk.xyz/ and `apps/web/{index.html,app.js,style.css}`. No runs were started and no credentials or sealed evaluator files were accessed. Playwright MCP reported its shared browser busy, so review used the documented isolated local Playwright fallback. Browser console/page errors: none.

## What the current interface asks of a first-time visitor

The page asks visitors to understand the experiment before they can use the product. Tasks, Compare, and Evidence are equally prominent. The landing slogan explains no task. A 20-item list and full contract precede a panel with model name, project ceiling, token allowance, CPU allowance, billing caveats, and only then the action.

Measured at 390 × 844, selected task details begin at y=743 and the primary Run PatchProof action begins at y=1813. The initial screen offers no action or saved example. On desktop 1440 × 1000, the primary action is also below the first viewport. Screenshots are `/tmp/patchproof-ux-before-desktop.png`, `/tmp/patchproof-ux-before-mobile.png`, and `/tmp/patchproof-ux-before-evidence.png`.

The evidence route opens the most recent run, a real worksheet repair failure. It shows `Candidate 1 · rejected · selected` and an unqualified model summary claiming the change satisfies a requirement that immediately fails. A whole-file diff dominates the screen, followed by individual check IDs, repeat observations, event IDs, full digests, accounting, and reproduction instructions. The information is valuable but its order makes the reviewer work too hard to answer three questions: what changed, did the required behavior work, and what still failed?

## Agreed direction after discussion

Discussed directly with `/root/ui_visual_review` and `/root/ux_copy_review`. The following decisions reflect the resolved tradeoffs, not three independent wish lists:

- Use **Examples** and **Runs** as primary destinations; a comparison is a secondary tool for a selected example. Runs includes active work, so History is less precise.
- Use a compact searchable, grouped list on desktop and a compact task picker on mobile. Selecting a task must not leave a mobile visitor above hundreds of pixels of unrelated list content.
- Present a concrete short title, one-sentence problem, and a small input/expected-output example, followed immediately by **Generate patch** and **View latest run**. Generate patch describes the operation without promising it will fix the task.
- A saved-result link must pick the latest run for that task regardless of success, and show its outcome. A suggestion to pick only the latest success was rejected because it subtly cherry-picks the first impression.
- Keep exact immutable task requirements available under **Full requirements**. Short descriptions are presentation metadata, not modifications to the contract. Bind curated display metadata to the known source/policy or fall back to the original task text when the snapshot changes.
- Show an outcome and exact recorded counts before result navigation. Use **Patch**, **Checks**, **Activity**, and **Run details** to avoid one long audit document. The default is Patch after a successful run, Checks after failure or execution error.
- A failure must remain understandable above the tabs: what behavior failed, what was expected, and what occurred. Tabs cannot hide the main reason a patch is unsuitable.
- Label generated explanatory text **Model summary**. Executed checks have a separate status; a model's confident statement is not a verified result.
- Replace the run dropdown with an actual run list: task, time, approach, outcome, duration. All prior failures remain accessible.
- Keep runtime/model identity, raw digests, limits, accounting, repeated observations and logs available through deliberate disclosure. Show only short run cost/limit information by the action and once in Run details. Live/mock/archive differences must remain explicit.

## Suggested first-use flow

1. Open Examples. A selected example immediately explains the bug and shows Generate patch plus its latest saved result if one exists.
2. Change examples by search or compact picker. Full requirements remain one deliberate action away. A visitor can inspect a real result without paying or waiting.
3. Generate patch. The action disables while pending, then the run view opens. Progress uses observed phases and the same run ID throughout reconnects. Show Stop only to the creating browser.
4. Review the outcome. Successful recorded checks lead to the patch; a failure leads to the failed behavior. A run with no patch says that clearly. No automatic merge or implied whole-program correctness.
5. Inspect all checks, alternate attempts, activity, run details, or download the original evidence bundle. Comparison is available here without competing with this path.

## Acceptance scenarios

1. **First action is visible.** At 1440 × 900 and 390 × 844, the selected example title, short problem, Generate patch button, and saved-result link if available appear without scrolling. At 320px width nothing requires horizontal page scrolling.
2. **Chooser scales.** All 20 examples are reachable. A desktop keyword search has a visible count and a useful empty state. Choosing another example updates the detail and action target together. Mobile selection stays close to the selected task rather than burying it below a list.
3. **Zero-cost exploration is real.** View latest run navigates to the latest actual run for the selected task. A task whose latest run failed opens that failure. Navigation and tab actions perform no POST requests.
4. **Honest outcome.** A saved successful run shows counts derived from its recorded candidate checks, not guessed from requirement count. A failed run shows at least one failed requirement and its observed/expected values before raw logs. An infrastructure failure says checks could not complete, never that a patch passed.
5. **Generated explanations are attributed.** The worksheet failure's model summary remains labeled as generated and cannot visually override the failed-check result.
6. **Progressive disclosure retains evidence.** Exact saved requirements, every candidate patch/result, original checks, execution events, measured/estimated/unknown accounting, all provenance IDs, and evidence download remain reachable. Collapsing them changes presentation only.
7. **Live safety behavior survives.** The primary action creates exactly one curated run; double clicking does not create extra runs. Reconnecting watches the original run. Only the originating browser sees cancellation. Paused allowance/pricing state has a visible reason and disabled action.
8. **Saved identity survives.** Opening an old run displays that run's saved task and model/check runtime, even if the current catalog or source changes. No current short description replaces a mismatched historical contract.
9. **Comparison remains honest.** All three approaches remain available through the secondary comparison view, with matching-input status, visible failed runs, equal-limit information, and no unsupported winner label.
10. **Keyboard and mobile.** Picker/search, main action, run rows, tab controls, disclosure controls and download can be operated by keyboard. Focus is visible and survives updates. Status changes use an accessible live region; long diffs scroll inside their region rather than widening the page.

## Scope and evidence limits

This is an interface review, not a usability study with recruited users. No performance superiority, user satisfaction score, or new repair result was inferred. Existing public state supplied the failures and task examples. Browser review found a functioning interface with no runtime errors; the requested redesign addresses hierarchy, terminology, readability, and first-use friction.
