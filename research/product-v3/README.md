# Code, goals, complete examples, and narrated review

The owner requested an interface that explains the maintenance task before asking
for a repair, equally complete successful and failed examples, harder tasks,
contextual diffs, and a narrated demonstration on the public FQDN.

The public [task workspace](https://patchproof.andrewmohawk.xyz/#tasks) now shows
the exact original files, function navigation, five selectable public examples,
required behavior, and the action that starts real inference. The
[How it works page](https://patchproof.andrewmohawk.xyz/#how-it-works) explains the
complete workflow, protected checks, recorded outcomes, review, export and replay.
Both saved stories have four stages: bug and goal, proposed patch, check results,
and a review decision. Their display is bound to original real-run evidence.

The repository contains ten development tasks. The current deployed picker
exposes two: configuration overlays and cursor pagination. The ten-task picker
described in historical review receipts is not the current public configuration.
Each has 60–79 lines, five to six functions, five requirements and 22 declared
checks. Complexity comes from interacting behavior: for example, pagination
combines revision resolution, tombstones, ordering, exclusive cursors, and
last-page metadata. These are original curated examples, not a new benchmark.
See the [corpus description](../../fixtures/V3-DEVELOPMENT.md),
[frozen manifest](../../fixtures/v3-development-manifest.json), and
[independent fixture review](fixture-review.md). All ten original implementations
were executed in isolated containers: 159 checks passed, 61 failed, none errored.
Reference validation has a separately recorded final configuration timeout; it
is not represented as a complete isolated pass.

The GitHub-style diff shows file headers, change totals, original and proposed
line numbers, red deletions, green additions and unchanged context. New evidence
uses contextual unified patches. Historical bundles retain their exact bytes;
display normalization recognizes unchanged lines in earlier whole-file patches.
Both old and new canonical formats remain verifiable.

## Real development observations

| Run | Model and result | Interpretation |
|---|---|---|
| `9d3cd90e-94e2-4787-b294-5caa577b40e1` | Nano, configuration overlays; first proposal 17/22, later verification timeout | Complete failed story: five functional failures remain in the retained proposal; the later attempt has 22 unavailable results. Final status is execution error, not acceptance. |
| `da14a99c-68ad-4229-9f07-8c2e023bfbeb` | Nano, pagination; first proposal 16/22, later protected-path rejection | The first response described a fix without changing the failing logic. The second response was rejected outside its edit allowlist. Both requests are preserved. |
| `d5cbe221-1220-4f55-8e79-36eccfab5b17` | Super with reasoning disabled, pagination; all three proposals 21/22 | All proposals missed the written rule that equal revisions use the last input row. Final status is failed; nothing was accepted. |
| `4b031998-ae91-4316-aacd-607cfff91f72` | Super with provider-default reasoning settings, pagination; original 16/22, one accepted proposal 22/22 | The complete successful story: latest revisions and equal-revision order, deletion filtering, exclusive cursor, and final-page metadata. All repeated declared checks passed. |

The first browser observer expected HTTP 202 when successful run creation returns
201. This observation failure did not cancel or recreate the configuration run.
Its original request receipt and the subsequent read-only recovery are preserved
separately. Future creation observes 201; there was exactly one creation request.

Model/runtime release `ffc56425cc9c3137838641556077ce34b598f388` uses the account-verified
`nvidia/nemotron-3-super-120b-a12b` model and a 600-second aggregate deadline.
All approaches retain three calls and 12,000 total output tokens. The conservative
exposure is $0.2467296, covered by a $0.25 hold within the existing $5 smoke
allocation and $25 overall ceiling. Prior holds remain intact; estimated token
cost is not an invoice. [Discovery](model-discovery.json) and
[rollout](verification/rollout-ffc56425cc9c.json) bind the selected interface,
rates, immutable source and public health. These new observations are unmatched
to the historical Nano examples; no repair-advantage claim is made. This release
removes the reasoning-disable override and asks the model to check every clause
of the written requirements, without changing any resource allowance. Provider
default behavior is requested; hidden reasoning is never retained or displayed.

The public walkthrough release is `c6b2b421a9faa3049391997ce93082f68ecf37af`;
its [rollout receipt](verification/rollout-c6b2b421a9fa.json) binds the final story
assets. The accepted pagination evidence digest is
`sha256:c38760acc78dc0b70289020eabc43a4600b43a3c351f66eb691bb47fd1fb6476`.
The model run took 192.740 seconds, with one request, 3,840 reported input tokens
and 2,591 reported completion tokens. Its token-rate estimate is $0.0034839;
the ledger retains the full $0.25 hold pending authoritative billing. Its original
source release remains separate from the later presentation release.

[Fresh replay](verification/final-replay/receipt.json) passed all 22 checks in
83.37 seconds under the exact original source release, using no model calls.
This is fresh same-host reproduction, not an independent-machine test. The final
narrated recording is published below. The [final public review](public-review/final-review.md)
passed 24 story scenes, 93 layout checks and two byte-identical browser downloads
at desktop 1440px and mobile 390/320px, with no browser errors or writes. An
author reference repair was never used as a substitute for the real model run.

## Published narrated demo

[Watch the 2 minute 30 second demo](https://patchproof.andrewmohawk.xyz/demo/).
Eleven chapters explain task selection, the workflow, both complete real repair
examples and evidence download. The page provides the narration transcript and
direct links to follow both examples. Local Chatterbox supplied a generic voice;
the recording identifies it as synthetic narration.

The final video is 149.76 seconds, H.264/AAC, 1440×1200, 8,374,601 bytes, with
SHA-256 `4c6db3f173bf9935ba7ba9e2eb35a5aedbddd6e9310aeb00e39eafadceafd75c`.
The browser capture used only real GET requests against the public deployment.
Both evidence bundles and all five source assets stayed byte-identical before
and after recording. No application responses or outcomes were substituted.
Only 1.269 seconds of initial loading were trimmed; there are no scene cuts or
speed changes. All eleven speech segments matched their individually transcribed
source audio after AAC decoding, with zero timing offset and no clipped samples.

- [Production and audio verification](verification/final-video/narrated-production-summary.json)
- [Publication receipt](verification/final-video/video-publication.json)
- [Public playback receipt](verification/final-video/video-receipt.json): 14/14
  checks passed, including actual desktop/mobile unmuted playback, decoded audio,
  seeking, no overflow/errors, exact full download and Cloudflare HTTP 206 ranges.
- [Frontend deployment and monitoring](verification/final-video/frontend-deployment.json):
  healthy scoped frontend, public HTML/CSS byte identity, no host port bindings,
  and successful Gatus observations. Prior video bytes remain private for rollback.

The video illustrates recorded development outcomes. It creates no inference,
does not replace the working live task flow, and is not a benchmark comparison.

## Verification record

Final release `c6b2b421a9faa3049391997ce93082f68ecf37af` passed **700/700 tests**
in one 150-second full-suite run, with no failures or skips. Typecheck and
contract-lock checks also passed; logs and hashed receipts are in
[verification/test-results](verification/test-results/). The
[final runtime snapshot](verification/final-runtime.json) records 12 public runs,
no active runs, 13 further quarter-dollar runs available within the smoke allocation,
and $1.60 retained across 13 unresolved reservations. No invoice cost is claimed.

Earlier validation is preserved below.

- `node --test --test-concurrency=4 tests/*.test.ts`: exit 0, 695/695 passed for
  the initial v3 code. [The earlier failed run and passing rerun](verification/test-results/)
  remain preserved. Later revisions receive their own checks.
- `node --test --test-concurrency=2 tests/runtime-repair.test.ts tests/repair-feedback.test.ts tests/live-product-ui.test.ts tests/walkthrough.test.ts`:
  exit 0, 33/33 passed after mobile and shared prompt changes.
- `node --test tests/live-local-runtime.test.ts`: exit 0, 17/17 passed, including
  the full Super token envelope, conservative ledger rounding, preserved holds,
  shared limits and refusal when the smoke allocation is exhausted.
- `node --test tests/live-local-runtime.test.ts tests/runtime-repair.test.ts`: exit 0,
  27/27 passed for provider-default reasoning configuration, unchanged allowances,
  and rejection/accounting of truncated responses.
- `npm run typecheck`: exit 0 after the model/API changes.
- `node scripts/verify-v3-corpus.ts`: exit 0; ten frozen fixtures and 220 checks.
- `gitleaks git --staged --redact --no-banner --exit-code 1`: exit 0 before the
  model/runtime release.
- [Public UI review](public-review/review.md) and [task control receipt](ux/public-briefing-receipt.json):
  actual FQDN, all ten source files and 50 examples, desktop and mobile, no writes.
- [Recording tools and speech service verification](verification/VIDEO.md): local
  Chatterbox speech with a generic supplied voice, synthetic narration disclosed.

All inference uses Nebius Token Factory. All checks here use isolated local
Docker containers. Nebius-hosted Sandboxes, scored experiments, public-source
licensing and competition entry remain separate unresolved gates.
