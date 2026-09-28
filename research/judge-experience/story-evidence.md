# Judge walkthrough: one repair a maintainer can understand

The PRD requires the failure mode to be clear within the first 30 seconds (§4, line 101). The first screen must show a bug, the intended behavior, and the visitor's role. A task catalog, an unlabeled patch, or a video of tab switching cannot do that.

Read-only evidence was fetched from the actual public API on 2026-09-28. All three bundles passed `verifyEvidence`. [story-evidence.json](story-evidence.json) preserves exact fixture cases, observed/expected values, counts, coverage, identities and patch text without process logs. No new provider request, replay, private credential access, or sealed evaluation access occurred. Bundle integrity is verified; this inspection does not independently authenticate provider billing.

## The chosen story

**A maintainer needs a list helper to remove every duplicate while preserving its existing behavior.** PatchProof proposes a change, runs separately controlled checks against it, and gives the maintainer the patch and observed results. The maintainer still decides whether to use the change.

Default directly to the first scene. Do not add a marketing landing page or require a paid run to understand the product. Discussed with the visual reviewer: three main scenes, followed by a clearly separate failed-repair example. Existing workbench remains under Try a repair.

### Scene 1: The bug

Exact suggested copy:

> PatchProof helps maintainers review AI-written fixes.
>
> **Remove the duplicate without changing the input.**
>
> You are reviewing a Python helper that should keep the first copy of each list item, in order. It currently misses duplicates separated by other items.
>
> This is a saved repair from a real model run. Viewing it starts no new work.

Show these values as a concrete labeled example, using the `u-v-order` observation in saved PatchProof run `08087e0a-f5d9-4c55-b4b6-7666bc8e016c`:

| Label | Exact value |
|---|---|
| Input | `["elm", "ash", "elm", "birch"]` |
| Original output — still contains a duplicate | `["elm", "ash", "elm", "birch"]` |
| Required output | `["elm", "ash", "birch"]` |

Small preservation note: **The caller's original list must stay unchanged. Passing `None` must still raise `TypeError`.**

Primary action: **See the proposed patch**. Secondary action: **Try a new repair**. The visitor should know that the first action reads saved evidence and the second enters the interactive workbench.

### Scene 2: The proposed fix

Exact suggested copy:

> **Check all retained items, not just the previous one.**
>
> The original code only compared an item with the last retained item. The model changed that condition to check whether the item had appeared anywhere in the result.

Use this excerpt from the actual original and proposed source, labeled **Relevant change — full patch available**:

```diff
- if not result or value != result[-1]:
+ if value not in result:
```

This is an explanatory excerpt, not the full diff. The saved PatchProof patch also removes the source comment and changes the final newline; retain access to the complete patch instead of claiming it changed only one line.

> The model could change `solution.py`. It could not change the checks. A separate runner tested the proposed code against the saved requirements.

Primary action: **See what the checks found**. Secondary action: **Open the full patch**.

### Scene 3: Review the result

Exact suggested copy:

> **The proposed patch passed all 9 listed checks.**
>
> The original code passed 5 of 9. The proposed code removed the repeated `elm`, left the input unchanged in the recorded cases, and still raised `TypeError` for `None`.
>
> Each listed check ran twice. These results cover the listed cases; they do not guarantee every possible behavior.

Show outcomes, not opaque case IDs, as the main table:

| Behavior | Original code | Proposed patch | Source |
|---|---|---|---|
| Remove a duplicate separated by another item | Returned the second `elm` | Returned `["elm","ash","birch"]` | `u-v-order` |
| Leave the caller's nested input unchanged | Passed | Passed | `u-v-mutation` and `u-a-mutation`, exact `argsAfter` values |
| Reject `None` with `TypeError` | Passed | Passed | `u-v-none` and `u-a-none`, exact exception observations |

> **Your next step:** review the full patch, download the evidence, then decide whether to apply the change. PatchProof has not merged anything.

Actions: **Review the full result**, **Download evidence**, **See a repair that failed**. Keep Try a new repair available. Operational details belong here or in run details: NVIDIA Nemotron through Nebius Token Factory; checks ran in local containers. This saved run used one model request and took 73.933 seconds. Its $0.00010692 model-cost figure is an estimate, not a reconciled invoice.

### Failure example: the patch still changes a real cell

Separate title: **When the patch does not meet the requirement**. Never present this as a later stage of the successful list run.

> This different task transposes a worksheet: rows become columns. An explicit `null` cell must stay `null`. The fill value is only for cells that do not exist.
>
> The proposed patch still replaces a real `null` cell with `9`, so it is not accepted.

From saved run `5b356c42-8848-4e78-bce7-94800f63eebf`, selected attempt 1, case `v-r01-null-is-data`:

| Label | Exact value |
|---|---|
| Input rows | `[[1,null],[2,3]]` |
| Fill value | `9` |
| Expected output | `[[1,2],[null,3]]` |
| Recorded patch output | `[[1,2],[9,3]]` |

Selected attempt 1: **11 passed, 2 failed, 0 errors**; requirements: **2 passed, 1 failed**. The full run made three attempts; attempts 2 and 3 each recorded **13 check errors**, not 13 ordinary assertion failures. Say **No accepted patch**. Do not say that all three attempts produced the same wrong worksheet, or that the later errors prove a returned null value. Their `actual: null` means no verified result was available.

Next action: **Inspect the failed checks**. Human decision copy: **Do not apply this patch as a completed fix. The failing behavior is still present.**

## Evidence map and claim boundaries

| Claim / scene | Saved source |
|---|---|
| List bug, input and expected output | `08087…/evidence` → `fixture.visibleCases[id=u-v-order]` |
| Original wrong list output | same bundle → `run.baselineChecks.visible[id=u-v-order].actual.outcome` |
| Patched list output | same bundle → `run.candidates[id=1].visibleChecks[id=u-v-order].actual.outcome` |
| Input unchanged | compare that case's `actual.argsAfter` with `expected.argsAfter`; use mutation cases for nested input examples |
| TypeError retained | `u-v-none` / `u-a-none` actual and expected are `{ "exception": "TypeError" }`, with no outcome wrapper |
| Original 5/9, proposed 9/9 | count visible plus acceptance check statuses; **do not confuse 9 checks with 3 requirements** |
| Each check ran twice | every relevant check's parsed `log.observations.length` is exactly 2; counts above are combined check cases, not 18 distinct requirements |
| Protected check boundary | bundle `fixture.editAllowlist=["solution.py"]`; `workers/repair/index.ts:201` rejects paths outside that list; coordinator provides cases to sandbox runner; host controller evaluates outcomes in `workers/sandbox/index.ts:54` |
| Worksheet failure | `5b356…/evidence` → attempt 1 `visibleChecks[id=v-r01-null-is-data]`; read `.actual.outcome`, not the check's name |
| Requirement coverage | list result 3/3 pass; worksheet selected result 2/3 pass, from `run.coverage` |

Public evidence links and exact digests:

- [Accepted PatchProof list repair](https://patchproof.andrewmohawk.xyz/runs/08087e0a-f5d9-4c55-b4b6-7666bc8e016c/evidence): `sha256:c2ba45e30a1526e446d5a47c7d194c65523cec18e902335f5dfa672b868bff08`.
- [Standard list repair](https://patchproof.andrewmohawk.xyz/runs/d11aa1fc-61ee-4b42-a89e-df6b385e4f1d/evidence): `sha256:618efef5736b49cdd541d33cb84ba4ab8f0f79dea38bb8e4af5c32d0c178a10e`.
- [Failed worksheet repair](https://patchproof.andrewmohawk.xyz/runs/5b356c42-8848-4e78-bce7-94800f63eebf/evidence): `sha256:5a9c00d2629636f2963c63efa49ef0236876b98ac3ba7a670b684abd32e12ff8`.

The standard list repair also succeeds: attempt 1 passes 5/9, attempt 2 passes 9/9. Its source, policy, runtime lock and limits match the accepted PatchProof run. The PatchProof run succeeds on its only attempt. This pair is an example, not a benchmark or proof of superiority. The PRD's proposed story of a patch passing every visible check while failing an additional compatibility check is **not present in these runs**. Do not narrate that hypothetical as something this demo observed.

## Video sequence

Use the same screens and sentences as the walkthrough, with narration or readable captions explaining cause and effect:

- 0–25s: maintainer role; list input, repeated `elm`, required output, unchanged-input requirement.
- 25–50s: actual condition before/after; model edits code while checks remain outside its control.
- 50–85s: actual 5/9 → 9/9 result; inspect one passing output and the unchanged input.
- 85–115s: separate worksheet example; highlight `null` becoming `9`; no accepted patch.
- 115–135s: full patch/evidence download; maintainer decides whether to apply; Try a new repair starts the interactive path.

Do not show long waits, scroll through digests, or narrate tab names as the product's story. Recorded evidence remains labeled throughout. The judge should be able to explain the input, bug, requirement, agent's role, check's role, and next human action after one viewing.
