# Existing real-run walkthrough

First capture passed with exit 0: **72.120 seconds**, VP8, 1440×1000. This is a
GET-only walkthrough of completed real Token Factory/local-Docker evidence from
release `3d0ce9d33b2169efec6290d7a478d4002a480a58`. It did not create a run,
cancel/replay work, substitute responses or modify the page DOM.

[Capture receipt](capture-receipt.json), [scene timestamps](scenes.json),
[captions](captions.srt), [original command output](capture-01.log), and
[observer source](record-existing.mjs) preserve the exact inputs and observations.
The raw video remains private at:

`/home/andrewmohawk/.config/patchproof/demo-20260927/live-final-read-only-01/raw-video/43c213dd8b7c816320ff7ed421233501.webm`

Its SHA-256 is `024db3063c1e4da8b4ff5cbb5c8f2b18586c30e045bbb657a47ef02eb28ada88`.
The private directory retains exact downloaded evidence bytes, the original
scene data and screenshots. Scene times use the observed monotonic clock since
the recording page was created. The last scene ends at 72.643 seconds on that
clock; the encoded video ends at 72.120 seconds. A derivative must clamp that cue
to the encoded duration and retain its own edit/custody record.

The displayed runs have identical fixture, source, policy, runtime and allowances:

| Approach | Run | Actual outcome | Model calls |
|---|---|---|---|
| Baseline | `d11aa1fc-61ee-4b42-a89e-df6b385e4f1d` | First candidate rejected; second passes all 9 declared checks | 2 |
| Checks only | `9943a027-4d6c-4f4b-94bb-d1ed4664b2f1` | First candidate passes all 9 declared checks | 1 |
| PatchProof | `08087e0a-f5d9-4c55-b4b6-7666bc8e016c` | First candidate passes all 9 declared checks | 1 |

All three passed; no performance advantage is established by one development
episode per approach. Cost values remain explicitly estimated, and authoritative
billing and CPU consumption remain unknown. Earlier unsuccessful runs remain in
history. [The independent audit](../independent-runtime/3d0ce9d-three-arm-audit.json)
provides separate recorded-artifact consistency checks.

The capture used eight scenes with approximately eight seconds of reading time
each, including the [matched comparison](screenshots/02-comparison.png),
[selected PatchProof diff](screenshots/04-selected-diff.png),
[acceptance log](screenshots/05-acceptance-evidence.png),
[baseline rejection](screenshots/06-baseline-rejection.png), accounting and an
exact evidence download. These are actual UI views. The baseline scene is
explicitly labeled; it does not invent a rejected PatchProof candidate.

After video closure, the same completed PatchProof run passed separate
[390 px](screenshots/mobile-390-terminal.png) and
[320 px](screenshots/mobile-320-terminal.png) terminal checks with no horizontal
overflow. There were 24 same-origin browser GETs, zero blocked actions, zero
console/page/HTTP/guard errors and zero locator retries. Both owned browser
contexts were closed. Selected run projections were unchanged on the final GET.
The video was not hosted by this observer; final editing/public playback are
recorded separately by the coordinator/deployment agent. The resulting
[95.12-second public video](https://patchproof.andrewmohawk.xyz/demo/) combines
actual live creation/progress with this walkthrough; see the
[publication receipt](../public-video/publication-receipt.json) and
[10/10 playback verification](../final-deployment/video-receipt.json).
