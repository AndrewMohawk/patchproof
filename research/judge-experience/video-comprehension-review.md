# Cold video comprehension review

Reviewed 2026-09-28. This is a rendered-frame inspection by an agent, not a human viewing study or a runtime verification. No project brief, repository source, README, PRD, earlier review, recording script, or caption source was read. The production completion marker existed before inspection; its contents were not used.

Artifact: `/home/andrewmohawk/.config/patchproof/demo-20260927/judge-experience-01/patchproof-judge-demo.mp4`.

SHA-256: `fe8b13daae03dc0b882f3827a313dc4bd92a9adeca4dca7bf70886567286f4d9`.

**Comprehension decision: PASS.** A first-time reviewer can explain the purpose, concrete bug, system action, output, and human next step from this video. No correction is required to meet that comprehension criterion. This does not certify the system's execution or evidence integrity. The observations below are evidence-demonstration and presentation improvements, with the unopened evidence path the most substantial limitation.

The video is 127.32 seconds, 1440 × 1180, 25 fps, with no audio stream. Inspection used full-size frames throughout the opening and later scenes, plus one-frame-per-second sequence sheets spanning the video. Exact full-size timestamps inspected include 0, 29, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, and 126 seconds. Additional opening samples were extracted at five-second intervals. Sequence sheets were used to inspect scene changes, not to judge small-text readability.

## What the video communicates on its own

| Question | Cold reading from visible video | Confidence / boundary |
| --- | --- | --- |
| Who is it for? | Developers reviewing AI-generated changes; the caption casts the viewer as a Python library maintainer. | Clear in the opening. The currently available experience uses curated Python examples; that limit is stated explicitly only near the end. |
| What is broken? | A list helper retains a second `elm` when another item separates the duplicates. Required output retains first occurrences in order without changing the caller's list. | Clear before 30 seconds. The original, wrong, and required output cards make this concrete. |
| What is the viewer doing? | Asking for a fix, inspecting its patch and check results, then deciding whether to use it. | Clear as an explanation. The video itself reviews saved repairs and does not show initiating a new model run. |
| What does the system produce? | A proposed patch, results grouped by requirements, and a downloadable record containing the change, requirements, observations, and run details. | Patch and result summaries are visible; the downloadable record's contents and replay are described but not opened. |
| Why beyond generated code? | Checks are outside the files the model can edit, a separate runner tests the proposal, and the model's explanation does not determine acceptance. Results stay attached to the patch for human review. | The differentiating idea is clear. Independence, provenance, and reproducibility remain claims within the recording rather than independently demonstrated properties. |
| What result is trustworthy? | The recording reports this saved list proposal passing the nine listed checks after the original passed five. It also reports a separate worksheet proposal passing only 11 of 13 and being rejected. | Trust is appropriately limited to listed cases. The video does not establish all-input correctness, live-provider behavior now, or a benchmark advantage. |

At 30 seconds I can explain the audience, bug, workflow, and proposed condition change. I have not yet seen a check result; the passing summary appears around 51 seconds. The opening succeeds at comprehension, but it takes roughly two-fifths of the video to reach the first validation result.

## Concrete observations

1. **The strongest scene is the failure case, around 74–95 seconds.** It labels this as a separate worksheet task, shows the required `null` versus the patch's `9`, says 11 of 13 checks passed, and refuses to call the repair complete. It also acknowledges later execution errors. This conveys the practical reason for checking a model's output more convincingly than a green success badge alone.

2. **The evidence path is promised more than demonstrated.** Around 96–112 seconds, the run-review screen stays on the Patch tab. Checks, Activity, Run details, and Download evidence are visible, but the one-second scene sequence does not show an opened exact check, the downloaded artifact, or a replay. For a product centered on reviewer evidence, spend part of this segment opening one expected-versus-observed check and the evidence contents. This review cannot validate the reported counts by watching the video.

3. **The “full patch” shot is visually incomplete.** At 100 and 110 seconds, the added portion of the diff extends below the displayed viewport. The visible part does not include the new membership condition already explained in the earlier focused snippet. The claim that the full patch is available is not inherently misleading, but the recording does not let a viewer inspect it fully. A short scroll or a tighter crop would make this scene useful.

4. **“Live model” is ambiguous during saved-result playback.** It remains in the upper-right corner while the scene and persistent footer explicitly say saved real repairs and no new model calls. The repeated saved-run disclosure is strong and prevents an overall claim of live generation, but a skimming viewer could read the status as a currently executing model. A provider-ready label or a saved-run label would remove the ambiguity.

5. **The first 29 seconds are almost entirely one unchanged page.** Captions develop the story, but the screen spends a long time repeating the same small list example before the patch appears. The patch page then remains until about 51 seconds. This is readable but slow; an earlier transition to the patch and first check result would communicate the complete value sooner. Frame sampling supports this observation about scene duration; it is not a measured human attention result.

6. **Captions are readable at native resolution.** They have large white text on a dark background, generally two lines, and ample reading time. I found no clipped caption text. The page's code, provenance line, and result metadata are much smaller. Because the 1440 × 1180 video is taller than a conventional landscape recording, fitting it into a small landscape player will shrink those details further. I did not test an actual embedded/mobile player, so readability there is unverified.

7. **The benchmark caveat is honest, but “standard repair” is unexplained.** At 110 seconds a caption says the standard repair also passed and that these runs do not establish an advantage. That avoids overclaiming. No visible comparison is opened, however, and the term is introduced without explaining its procedure. A judge cannot assess equal resources or the additional benefit over that approach from this video. Keep the caveat; do not present this scene as a comparative evaluation.

8. **Current scope arrives late.** The task picker around 113 seconds shows 20 curated examples; the final caption says the public demo does not accept the viewer's repository. State that limitation earlier so the broad developer-facing opening does not imply a general repository repair product.

9. **Acceptance wording could be clearer.** The passing scene correctly says the viewer still decides and nothing is merged automatically. The failure scene says the patch was “not approved” or “not accepted,” without naming whether that is an automated check gate or a human action. “Did not pass the check gate” would preserve the distinction.

The video is a comprehensible saved-run walkthrough with unusually clear limits on passing checks and benchmark claims. It is weaker as a demonstration that the advertised evidence can actually be inspected and replayed. The highest-value revision is to replace some static narration with one opened check record and the evidence artifact, while retaining the failure example and the existing scope disclosures.

## Inspection evidence

- Commands: `ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of json <video>`; `ffmpeg` full-frame extraction at the timestamps above; `ffmpeg` one-frame-per-second sequence sheets; `view_image` on those rendered PNGs. All extraction/probe commands exited 0.
- Temporary visual artifacts: `/tmp/patchproof-video-review/at-*.png`, `opening-*.png`, and `sheet-*.png`. These are review aids, not product verification artifacts.
- Runtime tests, model calls, downloaded-evidence verification, and a human viewing study: **NOT RUN**, outside this cold video review.
- Changed file: this review only. No implementation or recording changes were made.

## Bounded addendum: revised evidence sequence

Reviewed 2026-09-28. This addendum concerns only the revised evidence scenes in `/home/andrewmohawk/.config/patchproof/demo-20260927/judge-experience-03/patchproof-judge-demo.mp4` (135.20 seconds). The independently calculated SHA-256 is `aafc632bf58033aa73d386d3f8045fbb24752fed95526517f5e2c43acff08eeb`. The completion marker existed before inspection. No script, caption source, application source, or other review was read.

**The main evidence-shot concern is resolved for video comprehension.** Newly extracted rendered frames show both the complete patch and a concrete opened check record:

- At **89 seconds**, the diff includes the full original and added function through `return result`. The added `if value not in result` condition is visible. This resolves the cropped-patch observation.
- At **99 seconds**, the Checks tab has `R01 · u-v-order` expanded. Its expected output is `["elm","ash","birch"]`; the displayed observations match. The visible `argsAfter` retains the original `["elm","ash","elm","birch"]`, supporting the caption's explanation about leaving the input unchanged. Repeated observations and their pass status are visible. The viewer can now connect a specific requirement to recorded expected and observed values instead of seeing only a summary count.
- At **110, 113, and 115 seconds**, the Download evidence control and download explanation are visible. These inspected frames do **not** show a completion notification, an opened exported file, or replay. I do not claim that the video demonstrates exported-file contents, a completed download, replay, or independent verification of the recorded execution.

The original comprehension PASS stands. No additional correction is required for the revised evidence sequence. This is still rendered-frame inspection, not a human viewing study or a full re-review; changes to the opening and other scenes were outside this addendum's scope.

Verification: `sha256sum`, `ffprobe`, and exact-timestamp `ffmpeg` extraction at 89, 99, 110, 113, and 115 seconds all exited 0; frames were inspected with `view_image`. Review images are under `/tmp/patchproof-video-review/revision03/`. Only this review file was changed. Runtime and export-content checks: **NOT RUN**, outside scope.
