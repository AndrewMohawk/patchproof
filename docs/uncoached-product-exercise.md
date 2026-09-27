# Uncoached product exercise — prospective protocol

**Status: prepared; human exercise NOT RUN.** This protocol supports the T10 requirement that task selection through evidence export works without coaching, and the G4 requirement that reviewers understand the evidence. It produces a bounded observation of the three-screen product, not a model benchmark or a population-level usability claim. The separate [packet study](reviewer-study.md) tests judgments under different evidence presentations; its answers and timings cannot substitute for this exercise.

Use the accompanying [blank observation sheet](uncoached-product-observation.json). It is an unfilled template, not a result. Fill copies only in a private operator directory outside the source repository. Use pseudonyms and record consent before observing people; do not collect names, email addresses, provider credentials or unrelated screen content. No participant has been recruited or authenticated by these documents.

## Freeze before the first participant

Record the source commit, application URL and capability mode, relevant public task IDs, exact reviewed bundle/run digests when available, protocol version, task order, maximum time, recruitment/experience criteria, number of planned participants and operator. Keep the same conditions for all participants within a reported group. The proposed default time limit is ten minutes per task, measured from presenting the goal to submission or timeout; freeze any change before collecting results.

Use only authorized public-curated tasks and artifacts. Include an accepted candidate and a rejected, failed or insufficient-evidence case; do not choose only successful product output. The current local scripted example is acceptable for testing product comprehension if its mock status is explicit. It does not establish sponsor use or model quality. Actual live-recorded artifacts require their own verified provenance and operator approval.

Prepare an independent private scoring key from the reviewed artifact and explicit requirements. Record the key digest and reviewer's pseudonym before the exercise. The key identifies the designated task, relevant candidate/check evidence, supported conclusions, actual operating mode, matched-context status and expected export identity. Do not place answer values, implementation details, baseline outcomes or button instructions in the participant goal. Neither a model opinion nor the product's own success badge alone is an answer key.

Choose and record exactly one interface condition:

- **Active local mock:** the participant may launch the curated local workflow. Confirm the local runtime works before recruitment. Any check execution stays within the existing authorized local limits; this protocol grants no provider spending.
- **Read-only recorded archive:** load the explicit reviewed archive beforehand. The participant reviews and exports existing evidence; creation and cancellation must remain unavailable. Record whether its bundles are mock or live. Do not count this as a test of launching an active live run.

Do not change the interface, key, task, allowance or time limit in response to participant difficulty. A necessary correction creates a new protocol version and a separately reported cohort, with the original attempts retained. Confirm the participant can use the input method and read the page; record accessibility accommodations prospectively without teaching the navigation.

## Participant goal card

Give only this goal, the neutral maintenance request and the application entry URL. Do not give the coached reviewer walkthrough, button locations, expected outcome or a demonstration beforehand.

> Use this application to assess the proposed maintenance change for the request supplied to you. Find the relevant task and enough evidence to decide which change, if any, you would send for human merge review. Explain one requirement that the evidence supports and one rejection, failure or reason further review is needed. Compare the available approaches and say whether their context and allowances support a fair comparison. Identify what kind of execution or recorded evidence you are viewing, and save the evidence you would attach to your review. You may decide that the available evidence is insufficient. Tell the observer when you are finished or wish to stop.

For an active local mock session, add: “You may start the available curated local run if needed.” For a read-only archive, add: “This session contains previously recorded evidence.” These establish the permitted task; they do not disclose the answer or navigation.

The observer may repeat the goal verbatim and answer logistics questions. If asked for navigation or interpretation help, first remind the participant that they may stop or record uncertainty. Any substantive hint, pointing, demonstration or answer correction is coaching: record its exact substance and time. Continuing afterward may yield useful assisted observations, but must not be scored as unassisted success. Do not intervene silently to rescue a run or create the expected export.

## Predetermined observations and scoring

Record start, finish/stop, technical interruptions and assistance using the observer's clock; retain elapsed wall time including waiting for checks. This is not eye-tracking, active interaction time or the packet collector's directly recorded timing. Optional browser/video evidence needs prior participant consent and must remain private. Existing browser automation is a software check, not a participant observation.

For each assigned task, score each criterion `pass`, `fail`, `not_observed` or `not_applicable`, with an artifact reference or short neutral note. `Not_applicable` is allowed only for the capability-dependent launch criterion; freeze its applicability beforehand.

| Criterion | Observable success |
| --- | --- |
| Relevant task and contract | Selects the designated task and uses its explicit requirements in the review. |
| Appropriate execution behavior | In active local mock mode, starts the permitted curated workflow if no assigned run exists. In an archive, identifies that it is recorded/read-only and does not expect a launch action. |
| Acceptance and failure interpretation | Explains the supported requirement and a rejection/failure/insufficiency using actual expected/observed check evidence; distinguishes the selected patch from earlier candidates. |
| Comparison | Finds the available approaches and correctly interprets the displayed match or mismatch of inputs and resource limits. Missing comparisons remain insufficient, not assumed equivalent. |
| Mode and claim boundary | Correctly distinguishes mock, recorded live and active execution for the assigned mode; does not infer overall correctness, real inference from mock output, or measured cost/CPU where values are unknown. |
| Evidence export | Saves the assigned run's evidence and can associate it with the visible run; the observer checks run ID and bundle digest afterward without changing the participant's response. |

An **unassisted completion** requires all applicable criteria to pass before the frozen time limit, no substantive assistance, and the intended evidence export. Record assisted completion, timeout, voluntary stop and technical failure separately. A launch/backend/export failure is a failed product attempt for the primary all-planned denominator; it is not silently excluded. An unobserved criterion is not a pass. A participant who correctly identifies insufficient evidence can satisfy the interpretation criterion when that is the frozen key; uncertainty is not inherently failure.

Retain every planned participant/task assignment, including no-shows, declined participation, missing responses and failed opens. Report counts as well as rates: planned, started, unassisted completed, assisted, timed out, stopped and technical failures. These categories must be defined so a single attempt is not counted twice in the primary completion numerator. Preserve the original observations when issuing a corrected report.

## Reporting boundary

Report the exact interface mode and source/artifact bindings, recruitment and familiarity limits, accommodations, task order, missingness and assistance. Give unassisted completions over **all planned assignments**, and optionally a separately labeled started-only denominator. Report observed times with their completed/failed/assisted counts; never insert zero for absent times or present completed-only time as a general speed benefit. Do not combine archive review time with active execution time or packet-study time.

This small exercise can identify concrete usability failures and record whether these participants completed these tasks without coaching. A single participant or convenient sample does not establish generalized usability, measured time savings or superiority. No statistical power, inferential threshold or actual human outcome is supplied here. Publication, participant recruitment, remote hosting, paid execution and any sponsor-backed claim remain separately authorized activities.
