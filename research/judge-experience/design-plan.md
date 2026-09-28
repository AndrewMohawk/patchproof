# Judge-facing experience: visual plan

The previous redesign made the review controls easier to operate but did not teach a first-time visitor what PatchProof does or why a maintainer would use it. A judge should not have to infer the product from an example catalogue, an experimental comparison, or a sequence of unexplained tabs.

## Default experience

The homepage opens directly on a saved real repair, with a clear purpose sentence and the first concrete behavior example already visible. There is no separate marketing landing page or start gate. The existing workbench becomes **Try a repair**; Runs remains available to inspect every recorded outcome.

The introduction identifies the audience, action, and decision: a developer asks an AI model to fix a bug; checks the model cannot edit test the result; the developer reviews the change before using it. The first action is **See the AI patch**. Viewing the walkthrough uses existing records and never starts a paid run.

## One primary story

The saved PatchProof run `08087e0a-f5d9-4c55-b4b6-7666bc8e016c` provides a complete, simple story:

1. **The bug.** `unique(["elm", "ash", "elm", "birch"])` incorrectly keeps the second `elm`. The expected output is `["elm", "ash", "birch"]`. Show the actual input, observed original output, and expected output together; explain that order and input contents must be preserved.
2. **AI patch.** Show the relevant source condition before and after the actual selected patch, with access to the full diff. Explain that the model proposes the code change while the check definitions remain protected. Primary next action: **See the check results**.
3. **Your decision.** The original code passed 5 of 9 checks; the patch passed all 9 listed checks. Explain what those checks cover: duplicate handling, unchanged input, and the required exception for `None`. The maintainer can inspect the full evidence, download it, or try another repair. The result supports review; it does not authorize a merge or guarantee all possible behavior.

This run used one candidate. Do not invent a rejected candidate, self-correction story, or advantage over the baseline. The standard repair also eventually passed this example.

An optional fourth scene, **Failed repair**, shows a separate worksheet task where an explicit null cell was incorrectly replaced with padding. It must be labeled as a different recorded run and cannot be presented as an earlier stage of the successful list repair. Its purpose is to show that an unsuccessful model response stays unsuccessful rather than receiving a reassuring badge.

## Visual structure

Use one coherent case area rather than a row of feature cards. The purpose introduction is compact; the concrete example is visually dominant. A simple, accessible step navigation shows The bug, AI patch, Your decision, and the optional Failed repair. Each scene has one obvious next action, and navigation remains freely available rather than forcing a wizard.

The bug scene aligns input and observed/expected output. Labels carry meaning without relying on red/green alone. Short monospace values remain readable and wrap within the viewport. The duplicate can be highlighted, but the page must explain why it is wrong in ordinary words.

The patch scene presents before/after code excerpts with clear labels, not a decorative terminal. A short note ties the changed condition to the behavior a maintainer requested. Technical execution IDs and billing detail remain behind the full evidence link.

The decision scene puts the actual check result and what the developer should do next together. Passing and failing outcomes get different language and clear controls. An infrastructure failure must never appear as a normal failed assertion or successful verification.

On mobile, the navigation gets its own full-width row. Value comparisons stack into concise rows, source blocks scroll internally, and the next action remains prominent. Avoid oversized slogan typography, repeating badges, animated progress, or generic three-feature cards.

## Discussion with flow reviewer

We agreed that three primary scenes are sufficient: bug, proposed fix, review result. A separate failure example is an optional epilogue, not a fabricated continuation. We also agreed that the saved repair should appear immediately rather than asking the judge to choose among twenty technical fixture titles or click a generic Start button.

The flow reviewer independently confirmed the exact 5/9 to 9/9 result and noted that the baseline also succeeds. The story therefore explains the product workflow and evidence boundary without claiming a measured comparative advantage.

## Video

Record a narrated walk through this single case. Begin with the maintainer's problem, identify the duplicate in the actual observed output, show what the model changed, then explain the actual checks and the human decision. End on the usable public product and Try a repair. If the failed worksheet scene is included, explicitly introduce it as a second example. Do not turn the recording into a tour of eight panels or show a spinner as if playback starts a new run.

## Acceptance

A fresh judge should be able to answer within 30 seconds: Who uses this? What is broken in the example? What does PatchProof do? What do I click next? After the walkthrough, they should also know who controls the checks, what happened in the actual run, and why a human still reviews the patch. Browser success and absence of overflow remain necessary technical checks, but are not evidence that these comprehension goals were met.
