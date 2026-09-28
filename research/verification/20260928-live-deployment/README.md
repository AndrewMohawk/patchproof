# Real public deployment — September 28, 2026 UTC

The application is live at https://patchproof.andrewmohawk.xyz/ and the captioned
95.12-second recording is playable at https://patchproof.andrewmohawk.xyz/demo/.
The recording combines actual live execution with a later GET-only walkthrough
of the same completed run. Waiting is explicitly omitted; all original recordings,
failed captures and real run outcomes remain preserved.

## Deployed implementation

- Release: `3d0ce9d33b2169efec6290d7a478d4002a480a58`.
- Operational source: `sha256:f002c913955f022acbd371e37a170126ddb0d935c9203fdf573d014b4101d71b`.
- Runtime lock: `sha256:d122f93095fbbfe47c1d4bfab9f3ac8a5c2323d7d84781e37f51deb7d4ecdbed`.
- Model: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, real Nebius Token Factory inference.
- Checks: real fresh local Docker containers, frozen public-development requirements,
  two observations per check. This is not Nebius-hosted Sandbox execution.
- Public inputs: 20 curated development task IDs, three bounded approaches, one
  active run. No repository URL, arbitrary source/upload, shell or merge endpoint.
- State and credential remain outside the release and candidate workspaces.

The final source change supplies bounded visible-case failure diagnostics equally
to all approaches. The earlier two-arm sequence remains separate. There has been
no scored or sealed experiment and no measured superiority claim.

## Actual final executions

| Run | Task / approach | Observed result | Model calls | Usage-priced estimate |
|---|---|---|---:|---:|
| `d11aa1fc-61ee-4b42-a89e-df6b385e4f1d` | stable-unique-01 / ordinary repair | Candidate 1 failed four checks; candidate 2 passed all nine | 2 | $0.00020172 |
| `9943a027-4d6c-4f4b-94bb-d1ed4664b2f1` | stable-unique-01 / checks-only | Candidate 1 passed all nine | 1 | $0.00012066 |
| `08087e0a-f5d9-4c55-b4b6-7666bc8e016c` | stable-unique-01 / PatchProof | Candidate 1 passed all nine | 1 | $0.00010692 |
| `5b356c42-8848-4e78-bce7-94800f63eebf` | v2-r03-t02 / PatchProof through Cloudflare | Failed: selected candidate 1 retained two failed checks; later candidates had syntax errors | 3 | $0.00089034 |

The first three runs have identical task, policy, model/runtime and aggregate
limits. Their selected candidates each cover all three requirements. Independent
review checked every one of the 116 source pins and retained 126 repeated
observations with recorded confirmed cleanup. The secondary task is separate and
failed honestly; its 104 observations include candidate import errors, with
metadata-only syntax parsing confirming invalid model-generated Python.

All four selected patches were replayed from public downloaded bundles using
`make reproduce RUN=<id>` in the exact deployed checkout. All commands exited 0:
the three passing results reproduced, and the secondary task reproduced its
11 passing and two failing checks. Reproduction of a failure is not approval.
These were fresh containers on the same host, not independent clean-machine tests.
No replay made an inference call. See [replay receipt](final-replays/receipt.json).

## Verification and custody

| Executed verification | Result / receipt |
|---|---|
| `make test` at the final source | Exit 0; 676 passed, zero failures/skips; `final-release-tests.log` |
| Actual startup container check under service umask 0077 | Passed before serving requests, no provider call; `final-runtime-startup.json` |
| Public/lab routes, forced Cloudflare routing, Gatus and isolation | Passed; `final-deployment/release-3d0ce9d-under-load/deployment-receipt.json` |
| One different-task UI launch through Cloudflare | Exactly one POST, HTTP 201, Cloudflare header and actual public peer verified; `cloudflare-secondary-task/attempt-01/report.json` |
| Independent three-arm and secondary audits | `independent-runtime/3d0ce9d-three-arm-audit.json` and `3d0ce9d-secondary-failure-audit.json` |
| Desktop/mobile application observations | `read-only-browser/` and `read-only-walkthrough/capture-receipt.json`; no page errors or horizontal overflow |
| Raw live and GET-only screen recordings | Exact source/video hashes, scene timings and original observer failures retained in their receipts |
| Captioned MP4 installation | `public-video/publication-receipt.json`, exact edit intervals/command in `public-video/edit-manifest.json` |
| Actual public video playback, seek, download and Cloudflare range | 10/10 checks, zero errors; `final-deployment/video-receipt.json` |
| `make doctor` / `make release-check` | Exit 0 / expected exit 2; `final-gate-commands.json` |

MP4 SHA256: `c3acffaa8cc3d84af794efdd86f798ccb3abe4572c5fb370ee62a298a9921864`.
Format: H.264/yuv420p, 1440×1120, 95.12 seconds, 6,406,420 bytes. Captions are
burned into a separate lower band. Public download bytes match the installed file;
Cloudflare returns correct HTTP 206 byte ranges. Chromium desktop and mobile
actually played and sought the video. No source/video was uploaded to YouTube or
published as a public source repository.

## Preserved failures and limits

The first deployed run `1ddd6b8b-98ce-45aa-bc11-d9947f41cd4c` returned `needs_review`
when strict service permissions prevented candidate imports. The fix uses explicit
modes inside fresh workspaces plus an actual startup checker control. Its model
usage, failed observations and old source lock remain intact. Release `7467626`
then ran an incomplete two-arm development sequence: baseline failed, checks-only
passed and replayed. No third arm or superiority claim is invented for that source.

Observer failures are separately retained: an early GET timeout, an expired CDP
interception, and a terminal DOM-scroll race. None caused an automatic paid retry.
The final PatchProof live capture and separate GET-only walkthrough both completed
cleanly. The edited recording preserves actual outcomes; it does not relabel any
mock or failed repair as a real success.

The sole ledger records $0.80 held across seven repair runs and the original access
marker, within the $25 approved ceiling and $5 smoke allocation. The aggregate
usage-priced estimate is $0.00196992. Authoritative invoice charges are unknown;
full holds remain, and no credits are assumed. See `final-budget-observation.json`.

New paid work pauses when the current pricing verification expires on October 1,
2026, pending a fresh verified review. Competition-period availability is still a
release gate. Sponsor-Sandbox project/entitlement, billing reconciliation, scored
pilot/final evaluation, uncoached human acceptance, public-source licensing and
entry/publication decisions remain open. The broader release check therefore
correctly exits 2. The public live app and recording are complete and verified.
