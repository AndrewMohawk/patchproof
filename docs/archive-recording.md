# Record an existing evidence archive

The recorder observes the existing interactive archive. It creates no run,
candidate, cancellation or replay. A recorded-live label describes the supplied
record; it does not mean inference is happening during playback or establish
provider authenticity. Keep the original local mock rehearsals separate.

First close the private smoke writer and obtain a verified terminal export using
the [evidence operator](private-evidence.md). Prepare the [archive configuration](evidence-archive.md)
with the exact reviewed run IDs and bundle digests. Its public fixture must still
match the current catalogue. Raw provider responses, experiment traces and sealed
evaluator artifacts are not product evidence and cannot enter this viewer.

Use the source checkout that admits the recorded public fixture. Preserve the
recorded execution checkout separately for replay. Viewing snapshots the archive
assets; recording additionally binds their actual served bytes and the recorder
file digest. The Git commit is a discoverability reference, not proof that an
uncommitted recorder belongs to that commit.

## Interactive presentation

Keep configuration and bundles in private operator-owned directories outside the
repository. Start the existing viewer with the independently checked canonical
configuration digest:

```sh
node scripts/evidence-archive.ts "$ARCHIVE_CONFIG" "$ARCHIVE_CONFIG_DIGEST" 43173
```

The startup JSON returns `archiveDigest`, which pins the configured run set.
Open `http://127.0.0.1:43173/#evidence/<run-id>`. The task, comparison and evidence
views support keyboard interaction, candidate selection, log expansion and exact
evidence download. Missing approaches remain missing; one run is sufficient to
review evidence, but cannot establish a matched three-policy comparison. All
creation, cancellation, event-stream and replay capabilities stay disabled.

This is a loopback interactive demo. Making it accessible from another device or
the public internet requires a separately authorized deployment; do not alter its
binding or route guards for recording.

## Capture command

Requires the installed Playwright Chromium, Node version from the root README and
`ffprobe` for actual encoded-duration verification. Create a private parent
directory outside the repository; the output directory itself must not exist.
The archive must contain **exactly** the one to six run IDs supplied for capture,
with no extra records that could enter the recording through the run picker.

```sh
node scripts/record-evidence-archive.ts \
  http://127.0.0.1:43173 "$ARCHIVE_DIGEST" \
  "$RUN_IDS_COMMA_SEPARATED" /absolute/private/recordings/new-capture
```

Use `--synthetic` as the final argument when verifying invented fixtures. It
marks the receipt and captions; omitting it never authenticates a provider run.
The ordinary `npm run record:rehearsal` command is still a **mock execution**
helper and must not be used to produce real-provider footage.

The recorder checks the exact archive digest, terminal run projections and bundle
integrity before opening Chromium. It refuses active workspaces, mutation/event
routes, non-GET requests, cross-origin traffic, all HTTP redirects,
unselected runs and changed response bytes. A bounded GET forwarder obtains each response without following redirects, verifies the preflight byte pin (including run history and individual run projections), and supplies those exact original bytes to Chromium. It preserves response policy/download headers rather than inventing evidence. Browser activity stops and all request checks drain before final diagnostics are accepted. It downloads the exact original
bundle, without normalizing or rewriting its commands. Rendering, media files and
browser temporary files are local; no runtime factory or credential file is used.

The walkthrough shows each task's requirements, actual verdict, rejected candidate
when present, final selection or abstention, resource accounting, provenance and
download. Comparison appears only when multiple records were supplied, and keeps
missing/mismatched arms explicit. It finishes with a mobile evidence view. It
neither manufactures a rejected candidate nor requires a successful outcome.
Unknown cost/CPU values stay unknown and estimated costs retain their label.
Normal capture waits at least three seconds per scene, extending each caption to
about 3.5 words per second. `--synthetic` uses short test-only waits. For a readable
short demonstration, keep a multi-run interactive archive available and record a
separate one-run archive containing the primary example. Do not accelerate a long
multi-run recording merely to fit the time limit.

Outputs are a private WebM, SRT captions, screenshots, exact downloaded evidence
and `recording-receipt.json`. The receipt includes archive/run/bundle/source pins,
recorded usage, actual browser requests, file hashes and encoded video duration.
Captions say that viewing performs no new inference or checks. Retain them with
the original video; an optional captioned derivative needs its own file digest
and rendering-command record. Do not relabel historical footage or synthetic
verification clips as a sponsor run.

The target is at most 170 seconds. A 150-second capture watchdog and measured
WebM duration enforce that bound; missing duration metadata or a longer result
fails verification. Failed recordings and diagnostic receipts are retained in
their new directory and must not be silently replaced. Exit 0 means the playback
checks passed, not that provider activity or competition readiness was verified.

## Local verification

```sh
node --test tests/archive-recorder.test.ts
node scripts/verify-archive-recorder.ts
npm run typecheck
```

The browser verifier uses only invented product-evidence metadata. It covers a
single mock abstention, a mixed recorded-live-label/mock set with rejected and
accepted selections, literal rendering and exact downloads. A separate synthetic
page attempts a POST, a cross-origin fetch and a same-origin resource redirect to a local sink; the recorder must block them before
the fixture servers observe any unintended write or destination contact. A run-history response changed after preflight must be rejected before delivery; the test leaves it changed rather than demonstrating a change-and-restore race. Its clips are software-test artifacts, not
provider evidence or human observations. No Docker, model or sandbox job runs.
