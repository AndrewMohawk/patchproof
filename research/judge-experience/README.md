# Judge experience correction

The owner found that neither the redesigned interface nor its recording explained what the visitor was doing. The earlier reviewers approved navigation and presentation without establishing comprehension. A new reviewer entered the public experience without the PRD, source, or prior reviews and independently reached the same conclusion. See [the first-visit review](first-visit-review.md).

The default page now starts with a concrete maintenance problem: a duplicate `elm` remains in a list. It identifies the developer's role, shows the input, wrong output and required output, then guides the visitor through the actual AI patch, the independently controlled check results, and the human decision. A separate worksheet repair shows why eleven of thirteen passing checks still do not make an approved patch. **Try a repair** opens the real curated task workspace and explains what Generate patch produces.

The story reads two pinned original live evidence bundles. Displayed values come from their case definitions and observed results, including the original five-of-nine and patched nine-of-nine checks. The wrapper holding unchanged-argument observations is not mistaken for the function's return value. Missing, mismatched or mock records produce an unavailable explanation, never substitute results. Saved real results and live generation remain distinct. See [the evidence map](story-evidence.md).

The fresh reviewer could answer all six comprehension questions from rendered content: audience, problem, requested action, action output, value beyond generated code, and the bounded result worth trusting. This is a qualitative agent review, not a human study or a promise that every judge will understand. The review also identified ambiguous code/check wording; both phrases were corrected. Source isolation and independent replay are outside that browser-only review. See [the comprehension report](updated-comprehension-review.md).

The visual reviewer inspected all four scenes at 1440px, 390px and 320px. The first mobile viewport contains the purpose, actual input/output contrast and next action. Scene navigation resets the scroll and focuses the new heading. Python indentation is preserved, failed results are styled as failures, and the primary mobile action remains reachable. See [the visual review](visual-review.md).

## Implementation and validation

Source commits: `5f4a10c85c6c1cd6254c71504ab056f4c43e7337` and the two final copy corrections in `e15b625cce5a105c590113b6ba50eb62b5a74eb0`. The latter is the deployed immutable checkout, operational digest `sha256:6007740887175b6a2d9937f1aec065d55be467bdd54cbd5a2dd4d5f27b664e44`. The actual model runs retain their original source and evidence identities.

Changed files include the new `apps/web/walkthrough.js`, the app shell/style/controller, exact static asset routes in the three servers, and existing recorder/browser asset allowlists and entry routes. The new tests verify that the projection does not relabel mock or unrelated data, and that the default page explains the saved walkthrough without creating a run. Backend repair, billing, evaluator, and historical evidence behavior are unchanged.

- `npm run typecheck`: exit 0.
- `node --test --test-concurrency=4 tests/*.test.ts`: exit 0, 684/684 passed.
- `npm run test:browser`: exit 0; three mock-inference runs with actual local Docker checks, evidence download, task selection and mobile interaction. These are test artifacts, not the public demonstration.
- `node --test tests/walkthrough.test.ts` after the final two wording corrections: exit 0, 3/3 passed.
- Node 25.5.0, Playwright 1.58.2, Chromium 145.0.7632.6; exact dependencies remain in `package-lock.json`.

Receipts and test logs are in [verification](verification/). Public and lab health, Cloudflare routing, container health and Gatus were checked after deployment. A preview timeout during the frontend rollout is retained in the review rather than omitted. No new paid model request was used for this work; the approved $25 ceiling remains unchanged and the durable ledger was retained.

The [public browser verification](verification/public-browser-receipt.json) passed on release `e15b625`: all four asset hashes matched the deployed source; all twelve story scenes and thirty total layouts worked at desktop and mobile widths. The actual input/output values, source indentation, check totals, failure distinction and scene navigation were verified, along with the existing twenty-task workspace and seven saved runs. Two evidence downloads matched their original bytes. There were no browser errors, overflow or attempted writes.

## Recording

The replacement recording is **135.20 seconds**, H.264 at 1440×1180. It follows eight actual browser scenes: the bug, proposed patch, check results and decision, separate failed repair, full source diff, opened check record, evidence download, and curated live workspace. The first thirty seconds explain the maintainer's role, the repeated `elm`, required behavior, and what PatchProof produces. The captions explain cause and effect. The video has no cuts, speed changes or audio; a 180px caption strip sits below the original 1440×1000 browser capture.

The capture used only allowed GET requests and verified both pinned evidence bundles and the actual download. All eight scenes completed. Its original observer then failed the global-history assertion because a separate live run appeared during filming. The original failed report is preserved unmodified. A [separate custody audit](verification/capture-custody-audit.json), reproducible with `verify-capture-custody.mjs`, verified that every original run remained identical, both displayed records matched their pinned bundles, and the recorder made no write requests. No attribution is inferred for the additional live run. No responses or results were substituted. The SHA-256 is `aafc632bf58033aa73d386d3f8045fbb24752fed95526517f5e2c43acff08eeb`; the MP4 is 4,667,867 bytes. Raw footage and the preceding published recording remain private. See the [capture report](verification/report.json), [production receipt](verification/video-production.json), and [publication receipt](verification/final-video/video-publication.json).

Public player: <https://patchproof.andrewmohawk.xyz/demo/>. Versioned MP4: <https://patchproof.andrewmohawk.xyz/demo/patchproof-real-demo.mp4?v=judge-e15b625-evidence>. The player now introduces the specific repair story and links both the guided walkthrough and live workspace. Its narrow deployment changes are recorded in isolated homelab commits `19bee8891`, `93637f5cb` and `3fca7bab4`; canonical files match. No unrelated homelab changes or image publication occurred.

The [cold video review](video-comprehension-review.md) passed comprehension without a project brief. It identified the cropped diff and unopened check record; its addendum confirms that the final recording resolves both. This is agent inspection of rendered frames, not a human viewing study. It does not claim that exported file contents or replay were shown.

Final public playback verification exited 0 with [all ten checks passing](verification/final-video/video-receipt.json): downloaded bytes match the installed recording, Cloudflare serves the correct byte range, and desktop/mobile browsers play and seek the exact new version without errors or overflow. The [final deployment receipt](verification/final/deployment-receipt.json) records healthy public/lab routes, the expected private runtime, a healthy frontend and successful Gatus monitoring. The capture custody verifier and final render each exited 0; the original observer's exit 1 remains preserved and is not relabeled as a successful capture assertion.

[Presenter notes](presenter-notes.md) support the live demonstration; [recorded captions](recorded-captions.md) reproduce the on-screen explanation and actual timing. These supporting documents are optional: the page itself must explain the user's task.

A subsequent video revision opens an exact check instead of only describing the evidence. Its first capture observer stopped because the same check ID appeared in the selected patch and the collapsed before-repair section. That failed observer attempt is preserved in `verification/failed-evidence-capture/` (exit 1); no model run or source result failed. The selector was narrowed to the selected candidate’s task-check group and confirmed against the public page before recapture.

The wider competition gates remain open: no new evaluation result, general correctness guarantee, comparative advantage, Nebius-hosted Sandbox entitlement, public source release or competition submission is implied by this interface correction.
