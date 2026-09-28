# Failure, history and cost copy notes

Independent follow-up for the implementation author; no operational source changed. Observed data comes from the actual public run history captured on 2026-09-28.

## Diagnose from results, not check names

`CheckResult` has `status`, `message`, `actual`, `expected`, and a diagnostic `log`. A name such as `u-v-mutation` does not establish that an input was mutated. In actual failed run `bb948175-27cb-412a-9fb7-ba64b46dd3d6`, that check failed because the function raised `TypeError` instead of returning a list; its input was unchanged.

| Established observation | User-facing sentence |
|---|---|
| `status: error` | **This check did not produce a result.** |
| `status: fail`, return value differs | **The returned value differs from the expected result.** |
| Actual exception, expected return | **Raised TypeError instead of returning a value.** |
| Actual return, expected exception | **Returned a value instead of raising TypeError.** |
| Expected and actual exceptions differ | **Raised ValueError; expected TypeError.** |
| Return/exception agrees, arguments differ | **The function changed its input.** |
| Return/exception and arguments differ | **The result differs, and the function changed its input.** |
| Repeated observations disagree | **Repeated checks returned different results.** |
| `status: pass` | **Passed**; do not repeat a sentence below every passing row. |

These sentences require structured evidence. The UI must not guess based on IDs, model summaries or underscored messages.

Important shape trap: a function can legitimately return a JSON dictionary containing `outcome`, `exception`, `argsAfter` or `kwargsAfter`. Unwrap the assertion envelope only when the matching saved case says `assertArgsUnchanged: true`. Identify return versus exception only from validated recorded observation kind or the saved case plus unambiguous wrapper metadata. Merely finding an `exception` key is insufficient. If the UI does not have that evidence, use **Expected result** / **Actual result** and the exact JSON.

Error results with `actual: null` mean no observed result; they do not establish that the function returned `null`. Run `1ddd6b8b-98ce-45aa-bc11-d9947f41cd4c` is the concrete regression case. Its log records `candidate_import_or_serialization_error`, which supports **The checker could not load the code or read its result.** The UI alone does not prove the later-discovered permission root cause, so do not invent “permission denied” from this error category.

For `5b356c42-8848-4e78-bce7-94800f63eebf`, check `v-r01-null-is-data` supports:

- **Expected return:** `[[1,2],[null,3]]`
- **Actual return:** `[[1,2],[9,3]]`
- **Input:** `[[1,null],[2,3]]`, `fill=9`

Only show **Input** from the bound saved case, not from `argsAfter`, which is post-execution state. A concise domain-specific sentence such as “The patch replaced an existing null cell with 9” is correct for this observed case, but not an inference to apply indiscriminately to all transpose checks.

## Candidates and run outcomes

- A selected candidate in a failed run is **Kept for review**, not an accepted patch.
- A selected candidate in a successful run is **Final patch** with the scoped check result beside it.
- A previous failed candidate in a successful run can still say **Attempt 1 · checks failed**. The page-level run result and selected attempt result should be visually distinct.
- A model summary is **Model's change summary**, preferably collapsed. Do not present it as the explanation of why checks passed.
- Show **No patch generated** when there is no candidate; **No source changes** when a candidate exists with an empty diff. Those are different states.
- Cancellation: **Run cancelled. Completed results are still available.** Time limit: **Time limit reached. Some checks may be incomplete.** Do not imply nothing happened or nothing was charged.

## History and context

Use **Latest run** for the selected example regardless of outcome. Include failed, cancelled and incomplete entries in the Runs page. Label stored results by date and time, not time alone.

Saved requirements must come from the bundle tied to that run. Copy for a missing or mismatched bundle: **Saved requirements could not be loaded. Reload run details.** Do not show current requirements in their place. Keep the run's old model and execution backend, rather than relabeling history with today's environment.

Comparison context:

- Match established: **Same task, model and limits.** Full digests remain in details.
- Incomplete group: **Run all three methods to compare their results.**
- Mismatch: **These runs used different inputs or limits.** Offer a new comparison if allowed.
- Once per comparison: **These examples do not establish that one method performs better.** No need to repeat this sentence on every card.

## Cost and allowance

Before starting: **Up to $0.10 per run** (use the actual API limit), and for three runs show the actual total upper bound. Separate the total from the displayed price of one run.

After completion:

- Label estimated cost **Estimated model cost**; preserve enough decimals to avoid a false $0.00.
- For live billing pending, **Final charge not available** is clearer than “unreconciled.” Do not say “free.”
- Label missing CPU **Not measured**, not 0.
- Display **Model calls**, **Input tokens** and **Output tokens** in Run details.
- Full allowance details explain pending reservations once: **The spending limit includes amounts reserved for charges that have not arrived.** Only render that if it reflects the actual backend policy.
- When paused, show the reason next to the disabled action and leave history accessible. A pricing review pause is not “out of credits”; an active-run pause is not a budget failure.

These recommendations were sent to the root implementer. Rendered review of the replacement interface remains pending.
