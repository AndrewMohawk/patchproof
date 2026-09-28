# Independent rendered copy review

## First implementation review: changes required

Reviewed 2026-09-28 at `http://127.0.0.1:43179`, a GET-only preview of redesigned assets using the unchanged public API. A separate Playwright context blocked all non-GET and other-origin requests. No run was created. The first review observed zero page errors and zero blocked attempts. Local preview is review evidence, not public deployment evidence.

Actual views: desktop home, successful result, failed result, incomplete checks, run history, comparison, failure Patch and Run details tabs; 390px home, failed result and history. Captured text and measurements are `copy-after-text.json`; screenshots are `/tmp/patchproof-copy-after-*.png`.

### Changes that now meet the brief

- The slogan hero, decorative workflow and marketing footer have been removed.
- Examples and Runs now lead to useful actions. The primary action is consistently Generate patch on the example view.
- Failed results open Checks; successful results open Patch. Raw activity and runtime details have separate tabs.
- All actual unsuccessful runs remain in history. Failed selected attempts say Kept for review instead of the contradictory rejected/selected pair.
- Model-written summaries are collapsed and attributed; they no longer masquerade as measured outcomes.
- Actual local-container runs have local replay instructions, without the false implication that model inference must be repeated.
- The successful result is explicitly scoped to listed checks. Real/mocked run identity remains visible.

### Blocking observations sent to implementers

1. **Literal `false` on the home page.** A conditional passed directly to `replaceChildren` was rendered as user-facing text below the cost line.
2. **Failed checks overflow mobile.** At 390px, expected/actual JSON extends the document horizontally. The rest of the page becomes difficult to read at the actual viewport scale. Wrap values or confine their scrolling to a labeled region.
3. **Comparison opens the wrong task from a saved run.** In a clean context, opening transpose failure `5b356c42-8848-4e78-bce7-94800f63eebf` then clicking Compare approaches selects `stable-unique-01`, not `v2-r03-t02`. Bind this link to the reviewed run’s task.
4. **The short description can omit the actual problem.** The selected transpose example shows generic JSON/type/library boilerplate because its first 280 characters are used. The defect is at the end of the original description. All five worksheet examples share this problem. Hand-authored, source-bound display copy is supplied in `task-copy-proposal.json` for all 20 tasks.
5. **Legacy research language remains in comparison and error states.** B0/B1/P labels, “Checks only,” “frozen acceptance checks,” “bounded candidates,” and raw “declared requirements unverified” remain in visible product copy. Replace with the agreed plain method and outcome descriptions.

Cost copy is accurate enough to avoid a false free/zero claim, but the primary label should be Estimated model cost when `costIsEstimate` is true. Generic Provider cost with a suffix is harder to scan. The implementation owner is changing this.

## Approval state

**NOT APPROVED YET.** Above findings require a fresh rendered check. This report does not certify the public deployment, paid execution, or a new video. A final review section will record resolved findings and any remaining limitations.

## Re-review: approved for deployment

A fresh isolated browser pass against the same GET-only preview verified the revised implementation. All 14 explicit checks passed; the captured text, viewport results and hashes of `app.js`, `index.html` and `style.css` are in `copy-final-browser.json`. Screenshots are `/tmp/patchproof-copy-final-*.png`.

The five blocking findings are resolved:

1. The home page no longer renders `false`.
2. Failed-result values stay within the document at both 390px and 320px. Home, result details and history also have no horizontal document overflow.
3. Compare approaches from the saved transpose run now selects that transpose task.
4. The first example and transpose example show the concrete defect. All 20 concise summaries are explicitly matched to their source and policy hashes; the original statement and full requirements remain available.
5. Comparison now uses Standard repair / Repair with extra checks / PatchProof with concrete descriptions. Incomplete checks say “Checks could not finish. This patch has not been verified.” Estimated model cost is named in its label.

The latest-result action opens the actual failed transpose run rather than a chosen success. All seven stored runs remain in history. The successful result shows nine actual checks passed and the patch; the failed result shows eleven passed, two failed and zero errors; the incomplete result shows zero passed, zero failed and nine errors. Those counts come from the displayed attempt, not the three requirements. The failed attempt is kept for review, the successful selection is the final patch, and the model summary remains clearly attributed. Local replay instructions state that model inference is not repeated.

The interface now reads as a maintenance tool rather than a project pitch. I approve the reviewed copy and information hierarchy for deployment. This approval is based on actual rendered success, failure, incomplete, comparison, example and history views, including 390px and 320px widths, not a source-only string search.

Minor remaining refinements are not release blockers: method cards repeat “estimate” after an already explicit Estimated model cost label; passing check rows can be more compact; exact corpus task titles are still technical but the new adjacent summaries explain them plainly. These do not restore the removed slogans or misrepresent results.

Boundary: this reviewer performed no paid POST, created no run and tested no cloud credentials. There were zero browser page errors or blocked non-GET attempts. Paused, mock and unavailable-context behavior is covered by the separate UI regression work, not claimed as a newly observed live state here. The coordinator must still verify that the approved assets are actually served at the public FQDN.
