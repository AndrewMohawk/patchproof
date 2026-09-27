# Reviewer study tooling

`workers/evaluator/reviewer-study.ts` prepares and scores a prospective review exercise. It does not recruit participants, invent answers, run inference or establish a usability result. Unit tests use synthetic records only. Keep the private plan, input, response journal and report in a trusted evaluator directory outside the source repository; use pseudonymous participant IDs, not names or email addresses. Do not use sealed final-set material in reviewer packets.

## Frozen design

Version 1 requires an even number of participants and an even number of distinct review items, at least two of each. Each participant sees every item once, half as a patch with requirements and half with the same content plus executable-check observations. Across participants, each item appears equally often in both conditions. A recorded seed randomizes participant/item assignment and each participant's presentation order. This avoids showing a participant the same patch twice; it does not eliminate fatigue or learning effects.

Prepare item content from curated, publishable artifacts. Record the source artifact digest, `sourceVisibility: "public_curated"`, neutral task statement, explicit requirements, full diff and optional source context. Observations contain only a requirement ID, check description, expected value and observed value. Do not paste a whole product export into the content: it contains variant, verdict and provenance labels that could reveal the answer or treatment. The curator must review wording and set `packetWordingReviewedForLabels: true`.

For each item, the private key records one answer (`accept`, `reject` or `needs_review`), its rationale and its independently justified source. A model's opinion is not a sufficient answer key. Include successful, incorrect and incomplete-evidence cases; choose them prospectively rather than selecting only easy product successes. Define `needs_review` cases by an explicit insufficiency in the supplied evidence, not by disagreement with a hidden preference. Have a separate trusted reviewer check the answer key before a human study.

The private plan binds these items, answer key, assignments, time limit and protocol to a digest. It is never a reviewer packet. The projection omits the answer, condition, outcome, model/variant labels, original run identity and source artifact digest. It releases exactly one assignment after an `opened` event. Evidence visibility still reveals the interface treatment, and source text may contain clues; this is label blinding, not guaranteed participant blinding. The curator's wording attestation is not an automated semantic guarantee.

## Input and commands

The plan input is a JSON object with these fields:

- `studyId`, `participantIds`, `randomizationSeed`, and optional `createdAt` and `maxAssignmentMs` (default 600,000).
- `recordingMode`: `synthetic` for tool development, `human` only when actual people will provide responses.
- `sourceMode`: `local_mock` for the current scripted proposal artifacts or `live_recorded` for genuine recorded inference artifacts. This label does not change how answers are scored.
- `items`: the `StudyItemSchema` records described above. `content` contains `taskStatement`, `requirements`, `patch`, and optional `sourceContext`; `observations` contains the neutral observation rows; private `answer`, `answerRationale`, and `answerSource` supply the trusted key.

The synthetic builders in `tests/reviewer-study.test.ts` demonstrate the full schema without creating a human result. Prepare your own reviewed inputs in the private evaluator directory. All new JSON outputs use exclusive creation and mode 0600; an existing output is not overwritten.

```sh
node workers/evaluator/reviewer-study.ts plan INPUT.json PRIVATE-PLAN.json
node workers/evaluator/reviewer-study.ts open PRIVATE-PLAN.json EVENTS.jsonl p01 PACKET-01.json
```

The trusted recorder opens the next assignment in the frozen order and emits a single neutral packet. Deliver/render only that packet for the participant. Start the recorder when the participant is ready; record submission immediately from their actual action. Do not preview later assignments or share the private plan. Packet content is plain text/data; a viewer must not execute patch content or interpret it as HTML.

A participant chooses one of the allowed answers. The trusted collector writes an action JSON containing only the following fields, substituting the assignment ID from the packet and a fresh event ID:

```json
{
  "id": "unique-response-event",
  "participantId": "p01",
  "assignmentId": "assignment-id-from-packet",
  "kind": "submitted",
  "answer": "needs_review"
}
```

This example is a schema illustration, not an observed participant response. Record an actual supplied response with:

```sh
node workers/evaluator/reviewer-study.ts event PRIVATE-PLAN.json EVENTS.jsonl ACTION.json
node workers/evaluator/reviewer-study.ts open PRIVATE-PLAN.json EVENTS.jsonl p01 PACKET-02.json
node workers/evaluator/reviewer-study.ts report PRIVATE-PLAN.json EVENTS.jsonl PRIVATE-REPORT.json
```

A skipped action uses `kind: "skipped"` and `reason: "declined"`, `"timeout"` or `"technical_issue"` instead of an answer. Open the assignment first. A timeout cannot be recorded before its frozen time limit; a late answer cannot become a completed timed response. A skip remains missing for primary accuracy. No response is also a valid observed absence: the report retains it rather than inventing an answer.

If delivery needs to be retried after opening, `packet PRIVATE-PLAN.json EVENTS.jsonl p01 NEW-PACKET.json` reissues the current packet without resetting the timer. Do not erase a delayed or failed opening. Use a technical-issue skip when delivery/recording problems invalidate the exercise and report that attrition.

## Separate local review surface

The dedicated browser surface is `workers/evaluator/reviewer-server.ts`, with isolated assets in `workers/evaluator/reviewer-web/`. It does not change the product app or expose its runs. The operator supplies a previously reviewed private plan and journal using absolute paths outside the source repository. Their directory must be operator-owned and private (mode 0700); existing files must be owned regular files with no group/other access, normally mode 0600. Symlink files and in-repository state are rejected.

```sh
node workers/evaluator/reviewer-server.ts /absolute/private/study/plan.json /absolute/private/study/events.jsonl 43172
```

The server binds only `127.0.0.1`, default port 43172. It prints one private assignment link per pseudonymous participant. Give each participant only their assigned link. The token identifies an assignment, not an authenticated person; possession and actual human participation still need the operator's study procedure. Links are not provider credentials and never authorize candidate execution.

The link carries its token in the fragment, which the page removes immediately and retains only in that tab's session storage for reload. Authenticated requests can see only the participant's current neutral packet. There is no answer-key, report, arbitrary-file, arbitrary-code or public-listener API. Patch/source/observation content is rendered as plain text, with external scripts, frames and remote requests disallowed. Do not proxy or expose this loopback collector as a public study service.

Participants choose **Open next task**, then **Accept**, **Reject**, **Needs review**, or an explicit skip. The trusted server records opening and response times directly from those actions. It never trusts a browser-supplied duration. A reload returns the same assignment and original deadline; it does not start another event or permit a revised answer. Request retries are idempotent, while conflicting responses reject. Expiry disables submission and offers a timeout skip; leaving the page simply leaves an unfinished assignment in the report. No automatic human answer is generated.

The display countdown is advisory; the server enforces the deadline. Server wall time still includes request/response latency and interruptions and does not establish visual attention. This dedicated review surface supports the packet exercise; it is not an uncoached usability test of the separate three-screen product app.

Only one server may own a journal at a time. A `.server-lock` file records that ownership. Graceful Ctrl-C releases it after requests finish. After a crash, preserve the journal and inspect the recorded process before manually removing a stale lock. Do not run the CLI recorder against the same journal while the server owns it. Journal events and timing survive restart, but access tokens rotate; the operator must issue fresh participant links. Changing the private plan bytes while the server is running stops API access rather than silently changing an ongoing study.

Generate the private report with the earlier CLI after collection. Do not publish participant tokens, response journals or the answer-bearing plan. No recruitment, participant acquisition, remote hosting or human identity verification is implemented by this local collector.

## Recorder and metrics

The trusted process timestamps opening and submission. Actions cannot supply elapsed time or correctness. The append-only JSONL journal has a digest chain and records all events under the frozen plan. Duplicate event IDs, repeated openings/submissions, changed plans, backward clock movement, out-of-order assignments and incorrect participant/assignment identities reject. A filesystem lock serializes writers; a crash can leave a lock or partial final line. These block further writes until an operator preserves and investigates the artifact. Never delete a partial row or reset a timer merely to obtain a cleaner result. Hash consistency does not authenticate the recorder or the human participant.

Elapsed time is submission timestamp minus opening timestamp. It includes packet delivery, recorder overhead and interruptions; it is not browser attention time. An operator-mediated CLI study also includes collection delay. Keep that method identical across conditions, or integrate the trusted recorder directly with the chosen review surface before measuring usability. The separate browser collector above records its own review actions directly; the main product UI remains uninstrumented.

Reports provide planned/submitted/missing/skipped counts, accuracy with **all planned assignments** in the denominator, a separately labeled completed-only accuracy, completed/correct response times and paired participant summaries. Missing times are `null`, never zero. The comparative mean-time difference is suppressed until every planned response has been submitted, since completed-only times can select for easier tasks. Per-condition descriptive times remain visible with their denominators. Report accuracy and time together; a faster but less accurate condition is not automatically an improvement.

The report labels zero responses `planned_no_responses`; synthetic journals remain `synthetic_only`. Human journals are labeled `recorded_responses_declared_human`, with authenticity explicitly unverified. A local-mock study measures review behavior around scripted proposals with actual local checks, not model performance, sponsor integration or product-wide correctness. It cannot satisfy an uncoached full-product study merely because packets were reviewed.

No sample-size power calculation, p-value or population-level interval is implemented. Two participants/items meet only the balanced-format minimum. Real statistical power depends on between-participant/task variation, expected effect, missingness and accuracy/time tradeoffs. Before an inferential study, choose the primary outcome and power target prospectively and account for both participant and task dependence; do not treat every answer as an independent person. Current reports support bounded descriptive review exercises only.

## Verification

`node --test tests/reviewer-study.test.ts` exercises assignment balance and reproducibility, private-key projection, ordered events, clock/timeout controls, retained missing denominators, synthetic labels, durable journal failure handling and the complete local CLI flow. No participant recruitment or real human data is part of these tests.

The local HTTP tests are `node --test tests/reviewer-server.test.ts tests/reviewer-study.test.ts`. They cover private path/mode checks, scoped token/host/origin restrictions, one-packet projection, restart/reload timing, duplicate responses, timeout/skip behavior and changed/corrupt state.

Run the rendered check with `node workers/evaluator/verify-reviewer-browser.ts`. It creates only synthetic plans/events in a private temporary directory outside the repository, removes them afterward and writes a neutral receipt to `.local/verification/reviewer-browser.json`. Desktop, mobile and timeout screenshots are saved under `/tmp/patchproof-reviewer-*.png`. The check exercises real browser controls, both packet presentations, fragment removal, keyboard interaction, reload timing, literal markup rendering and explicit timeout skips. The receipt retains neither access tokens nor response records. This test is not a human study.
