# Narrated recording workflow

The video records the deployed public PatchProof UI. Saved evidence is pinned by
bundle digest before capture and checked byte for byte afterward. The browser
only makes allowed GET requests; an unrelated public run does not invalidate the
shown immutable records. No application responses, results, or UI copy are
substituted during recording.

Speech uses the local Chatterbox service and its existing generic
`ivr_female_02_prompt.wav` reference. It is identified as synthetic narration in
the video. The live service was checked on 2026-09-28: Turbo, CPU, mono 24 kHz WAV,
400-character request limit. No service settings were changed. The first 9.16s
sample generated in 14.0s; local small-int8 transcription matched its content
except for recognizing the brand as “Patchfrupe.” Narration should spell the brand
“Patch Proof” to make its pronunciation clearer.

Source interfaces were read from the existing `homelab-tts` and `homelab-stt`
SkillHub bundles, then checked against `/health`, `/api/info`, `/api/references`,
and `/api/health` on the live services. The current STT models differ from the old
SkillHub prose; `small-int8` is available and is selected explicitly.

## Manifest

Create a reviewed JSON manifest with `sourceCommit` (40-character deployed
commit), `assetPaths`, `evidence` (`id` and `digest` for each actual saved run),
and `scenes`. Each scene has:

- `id`: unique lowercase letters, digits, and hyphens.
- `title`: short chapter title.
- `annotation`: at most two 87-character lines after word wrapping.
- `narration`: up to 400 characters of spoken explanation.
- `actions`: browser actions used to show the corresponding real page.

Supported actions are `goto` with a hash; `click`, `wait`, or `scroll` with a
selector or an exact role and name; `top`; `contains` with an expected text;
`select` for an existing dropdown option; bounded `scroll-by`; and `press` for
PageDown, Home, or End. `download` takes an evidence run ID and link target.
There is no arbitrary script action. Network routing blocks write requests even
if a mistaken click tries to start a run.

```sh
export PATCHPROOF_PRIVATE_ROOT="${PATCHPROOF_PRIVATE_ROOT:-$HOME/.config/patchproof/demo-20260927}"
python3 research/product-v3/verification/narrate.py manifest.json \
  "$PATCHPROOF_PRIVATE_ROOT/product-v3-01" --transcribe
node research/product-v3/verification/capture-video.mjs manifest.json \
  "$PATCHPROOF_PRIVATE_ROOT/product-v3-01"
python3 research/product-v3/verification/assemble-video.py \
  "$PATCHPROOF_PRIVATE_ROOT/product-v3-01"
```

Review every transcription before capture. Speech files are generated first, so
the browser holds each scene for its actual narration duration plus a short
reading pause. Final assembly adds a 200px chapter/caption strip below the
original 1440×1000 browser video and aligns each audio segment to the recorded
scene start. It trims only the initial browser loading interval, so the video
starts with the first usable screen. The receipt records that trim; all presented
scenes retain their original timing, with no scene cuts or speed changes. The
output has H.264 video, AAC audio, and must be shorter than three
minutes. Media and private receipts stay outside the repository; scripts and
sanitized receipts may be committed.

`narrate.py` can resume generated segments if the input and audio digests match.
Capture and final production are exclusive outputs: use a fresh private directory
for another take and retain the previous take and its receipt. `capture-report`
records requests, shown evidence custody, source asset hashes, browser version,
screenshots, and timestamps. `video-production` records output hash, media
properties, editing disclosures, narration transcript, and the exact command.

## Completed recording

The completed video is **149.76 seconds** with 11 narrated chapters. It records
public release `c6b2b421a9faa3049391997ce93082f68ecf37af` and shows both four-stage
repair walkthroughs, the starting-code/goal workspace, the How it works page,
GitHub-style changes, and an actual evidence download.

- Accepted pagination run: `4b031998-ae91-4316-aacd-607cfff91f72`; starting checks
  16/22, accepted proposal 22/22. The displayed case stops repeating record B and
  returns only C with no next page.
- Configuration run without an accepted repair:
  `9d3cd90e-94e2-4787-b294-5caa577b40e1`; retained attempt 17/22, five functional
  failures. A later attempt exhausted the run allowance before verification
  completed. The narration and annotations distinguish those failures from its
  22 unavailable results and final execution-error status.
- Capture: 19 browser requests, all allowed GETs, no errors, no new paid calls.
  Both evidence bundles and all five source assets remained byte-identical.
- Media: H.264 1440×1200, AAC mono 24 kHz, 8,374,601 bytes. SHA-256
  `4c6db3f173bf9935ba7ba9e2eb35a5aedbddd6e9310aeb00e39eafadceafd75c`.
- Editing: only 1.269 seconds of initial browser loading removed. No presented
  scene cuts or playback-speed changes. Actual diff scrolling exposes the third
  success hunk; actual JSON-pane scrolling exposes the failed change paths.
- Audio: all 11 decoded AAC segments match their separately transcribed source
  WAVs at their recorded start times; correlations 0.999795–0.999960, best offset
  0ms for each, and zero clipped samples. Two ambiguous phrases were retaken
  before assembly; original takes remain preserved privately.
- Visual: all 11 final frames were inspected. The source and goal, expected and
  observed results, all three successful diff hunks, failure distinction, and
  readable chapter annotations are present.

Private artifacts are in
`$PATCHPROOF_PRIVATE_ROOT/product-v3-01/`.
The final file is `patchproof-product-v3.mp4`; its receipts are
`capture-report.json`, `narration-index.json`, `video-production.json`, and
`audio-video-verification.json`. The reviewed manifest is
[demo-manifest.json](demo-manifest.json); the sanitized summary is
[narrated-production-summary.json](final-video/narrated-production-summary.json).
Publication and public-player checks are a separate coordinator step.

## Executed validation

- Chatterbox sample: real POST succeeded; 9.16s PCM16 mono WAV, 24 kHz.
- STT sample: real POST succeeded with `small-int8`; brand pronunciation noted.
- `python3 -m py_compile .../narrate.py .../assemble-video.py`: exit 0.
- `node --check .../capture-video.mjs`: exit 0.
- Final capture, assembly, and decoded-audio/timing verification: exit 0 for each.
  `verify-narrated-video.py` also exports a review frame for every chapter.
