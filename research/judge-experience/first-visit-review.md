# First-visit comprehension review

Reviewed on 2026-09-28 using only the rendered public landing page at <https://patchproof.andrewmohawk.xyz/> and the public demo page at <https://patchproof.andrewmohawk.xyz/demo/>, including frames within the first 30 seconds of its video. Desktop viewport: 1440 × 1000. I did not read source code, the PRD, prior reviews, or other agents' findings. No model run was started. The isolated browser allowed GET/HEAD requests and blocked other methods.

## Immediate impression

The landing page is a usable-looking Python example picker, but it assumes I already understand PatchProof. I can identify the next action before I can explain why I should take it. The video improves comprehension substantially: it shows a patch with check results, expected-versus-observed output, and an unsuccessful repair whose patch was not approved. I leave with a plausible understanding of a checked-patch review tool, not a clear explanation of its intended customer or the independence of its checking process.

## Six first-visit questions

| Question | What I can say from the first screen | What the first 30 seconds add | Remaining uncertainty |
| --- | --- | --- | --- |
| Who is this for? | Probably a developer comfortable with Python maintenance tasks. This is an inference from the examples and “Generate patch,” not an explicit audience statement. | The diff, checks, and run-review view reinforce a developer/reviewer audience. | Is the user a maintainer reviewing AI changes, an engineer generating fixes, or someone evaluating repair models? Nothing seen settles that. |
| What problem does it solve? | It proposes fixes for selected, already-described Python defects. The chosen example explains a concrete duplicate-handling bug clearly. | It also helps inspect whether a proposed patch meets listed checks, and it records failures. | The product-level problem is unstated: why existing AI coding or test tools are insufficient, and what review effort PatchProof removes. |
| What am I being asked to do? | Choose one of 20 examples, then press “Generate patch.” “Latest result” and “Compare approaches” are secondary choices. | The recording asks me to inspect saved results and their checks. It explicitly says it does not start new inference. | Am I meant to experience generation, review existing evidence, or judge a comparison first? The landing page favors generation, while the demo follows saved results. |
| What will clicking the primary action produce? | I expect a proposed code change for the selected example, with a stated $0.10 maximum, up to 300 seconds, and review before applying. | The demonstrated result is a run review with a diff, check statuses, attempts, and an evidence-download action. | The recording does not show the primary action being executed. I cannot verify the actual new-run behavior. The landing screen does not tell me whether checking happens automatically, whether generation can end without an approved patch, or who bears the displayed cost. |
| Why is it different/useful compared with a model returning code? | That is not explained on the first screen. “Compare approaches” suggests a distinction without naming it. | A reviewer can see executable-check results, expected and observed values, and a failed repair that was withheld. This is more informative than a code response alone. | I cannot tell who authored the checks, whether the repair model can change or see them, or how the checks are independent of the generated patch. No demonstrated improvement over an ordinary model-plus-tests workflow appears within the viewed opening. |
| What result can I actually trust? | Only the stated intended behavior and limits; there is no result on the landing screen. | The UI reports that one saved patch passed nine listed checks. Another saved repair failed two checks and produced no approved patch. This is appropriately narrower than claiming general correctness. | I have seen rendered claims and recorded detail, not independently reproduced evidence. Passing listed checks does not establish correctness for untested inputs, completeness of the requirements, production readiness, or that my own repository is supported. |

## Observations that shaped those answers

- The main page begins with “Examples,” “Python examples,” and a selected task. There is no introductory product sentence, audience statement, or description of the overall workflow in the first viewport.
- The selected example's defect description is understandable: separated duplicates should be removed while preserving first occurrences. The broader product purpose has to be inferred from that example.
- The run identifier “owned-v2-r01” appears above the task and beside examples without explanation. It does not help me understand the product as a first visitor.
- The first video scene says to choose a Python maintenance example and labels the recording as saved real runs. Around 10 seconds, it shows “All listed checks passed” and nine passing checks, with a caption describing Nebius Token Factory and isolated local Docker containers.
- Around 20 seconds, the video shows expected-versus-observed values and an observation log. The caption says full requirements and checks before repair remain available. This supports inspection, but does not itself explain check independence or requirement coverage.
- Around 25–30 seconds, the video displays “Checks failed,” “Some checks failed. No patch was approved,” eleven passed checks, two failures, and later attempts labeled “Check error.” The caption explicitly says the unsuccessful patch remains visible and is not approved. This is the strongest trust-building moment in the opening because failure is visible and consequential.
- The landing page's “Live model” status and the recording's saved-run disclaimer can coexist, but the distinction requires reading. Watching the demo is clearly different from verifying a new live run.
- On the paused embedded player, native controls obscure the bottom caption strip. I inspected the same frames with the native control overlay hidden to read those captions. The comprehension findings above include those captions.

## Boundaries of this review

I did not expand the landing-page disclosures, inspect an evidence download, open a comparison, click “Generate patch,” or view beyond 30 seconds. Those areas may contain answers, but they did not answer the first-visit questions within the assigned surface. I offer no implementation or design prescription in this initial report.

Rendered capture references: `/tmp/patchproof-judge-first-screen.png`, `/tmp/patchproof-judge-demo-page.png`, and `/tmp/patchproof-judge-video-clear-{3,10,20,25}.png`. Browser inspection completed successfully; it is a comprehension review, not an execution or correctness test.
