# Guided experience visual review

Reviewed the implemented story with actual saved public evidence through the local GET-only preview. No generation request was made. This review supersedes the earlier conclusion that a usable workbench was sufficient for a first-time judge: the new acceptance question is whether the product's purpose, concrete example, and next action are visible together.

## First screen

At 1440×900, 390×844, and 320×844, the first screen identifies developers reviewing AI changes, says that PatchProof proposes code and runs checks the model cannot edit, and leaves the use decision to the person. It immediately shows the actual duplicate-list input, wrong original output, required output, and the next action, **See the AI patch**.

The mobile comparison is fully above the persistent navigation bar: the required-output row ends at 750px on the 390px viewport and 741px on the 320px viewport; the bar begins at 774px. The 44px primary action sits at 787–831px. The page says these are saved real results and viewing makes no new model calls.

The existing workbench remains secondary under **Try a repair**, with an explanation of what Generate patch does. Its action is still visible without scrolling on mobile.

## Fixes made after observing the actual story

- The initial mobile next action was around 989px down the first scene and 1236px down the patch scene. The mobile walkthrough now has a persistent primary-action bar; secondary links stay with the content. End padding keeps the footer and final content reachable.
- A long repeated provider caption, redundant success kicker, and repeated introductory paragraph made the example too distant from the purpose. The caption and lead were shortened, and mobile scenes after the first retain the purpose heading without repeating the entire paragraph.
- The source renderer used semantic `pre` elements directly. Their code is now locally scrollable, preserving Python indentation without expanding the 320px document.
- The requirement-result rows now align the behavior and its observed check count.
- The failed worksheet example initially inherited a green verdict style. The renderer now marks it `bad`; the displayed result is red and explicitly says no patch was approved.
- Moving to the next scene initially preserved a scrolled position, skipping its explanation. The coordinator fixed navigation to reset scroll and focus the new heading. The final check waited for the actual new step before measuring: scroll was zero and focus was on the heading at all three viewport sizes.

## Result

All four scenes were inspected at all three viewport sizes. There was no document overflow and no page error. The patch, decision, and separate failed-example scenes preserve the causal sequence and distinguish the human decision from a model-generated explanation. The successful repair is not presented as having rejected an earlier candidate, and the failed worksheet repair is explicitly a separate example.

This is a visual and interaction review, not a substitute for the independent blind judge's comprehension review. It also does not establish that the new release is publicly deployed; public verification remains a separate gate.

## Evidence

- [First desktop viewport](screenshots/first-viewport-1440.png)
- [First 390px viewport](screenshots/first-viewport-390.png)
- [First 320px viewport](screenshots/first-viewport-320.png)
- [Desktop decision scene](screenshots/final-1440-decision.png)
- [320px proposed patch](screenshots/final-320-patch.png)
- [Measured layout and navigation](screenshots/final-metrics.json)

The earlier `before-*` artifacts preserve the defects identified during the review. No unresolved material visual issue remained in the final inspected preview.
