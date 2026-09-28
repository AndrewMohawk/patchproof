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
selector or an exact role and name; `top`; `contains` with an expected text; and
`download` with an evidence run ID and link target. There is no arbitrary script
action. Network routing blocks write requests even if a mistaken click tries to
start a run.

```sh
python3 research/product-v3/verification/narrate.py manifest.json \
  /home/andrewmohawk/.config/patchproof/demo-20260927/product-v3-01 --transcribe
node research/product-v3/verification/capture-video.mjs manifest.json \
  /home/andrewmohawk/.config/patchproof/demo-20260927/product-v3-01
python3 research/product-v3/verification/assemble-video.py \
  /home/andrewmohawk/.config/patchproof/demo-20260927/product-v3-01
```

Review every transcription before capture. Speech files are generated first, so
the browser holds each scene for its actual narration duration plus a short
reading pause. Final assembly adds a 200px chapter/caption strip below the
original 1440×1000 browser video and aligns each audio segment to the recorded
scene start. It preserves the complete browser capture with no cuts or speed
changes. The output has H.264 video, AAC audio, and must be shorter than three
minutes. Media and private receipts stay outside the repository; scripts and
sanitized receipts may be committed.

`narrate.py` can resume generated segments if the input and audio digests match.
Capture and final production are exclusive outputs: use a fresh private directory
for another take and retain the previous take and its receipt. `capture-report`
records requests, shown evidence custody, source asset hashes, browser version,
screenshots, and timestamps. `video-production` records output hash, media
properties, editing disclosures, narration transcript, and the exact command.

## Initial validation

- Chatterbox sample: real POST succeeded; 9.16s PCM16 mono WAV, 24 kHz.
- STT sample: real POST succeeded with `small-int8`; brand pronunciation noted.
- `python3 -m py_compile .../narrate.py .../assemble-video.py`: exit 0.
- `node --check .../capture-video.mjs`: exit 0.
- Final capture and assembly: NOT RUN until revised deployed UI and actual run
  evidence are pinned. This document describes tooling, not a completed video.
