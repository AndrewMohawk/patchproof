# Local v2 product verification

Source `c3350314c3029c956d641c371120786fd6526ca5` passed **585 tests**, type checking,
contract locks, the actual desktop/mobile browser comparison, and all three
fresh-container patch replays. The [machine-readable receipt](integration-receipt.json)
binds commands, exit codes, run identities, evidence digests and limitations.
The app remains at `http://127.0.0.1:43171`, using that pinned source.

| Policy | Run | Observed result | Fresh replay |
|---|---|---|---|
| Baseline | `3cb4b6cd-6bdb-4b0b-878a-ad19a45c0e6b` | Passes declared checks | Exit 0 |
| Checks only | `6b859d93-e4de-41a4-b816-38dc1cce1a29` | Passes declared checks | Exit 0 |
| PatchProof | `a009cb6f-88d9-4621-8e89-ed208e6528b4` | Passes declared checks | Exit 0 |

Each run retained two candidates, a rejected first candidate, nine declared checks
repeated twice, and 54 container operations. Each selected-patch replay used 18
fresh container operations. All recorded cleanup was confirmed; the final project
container listing was empty. CPU usage remains unmeasured. The demonstration used
scripted proposals, zero inference calls and **$0 provider spending**. All three
policies passed; these observations do not establish a performance advantage.

The [browser report](browser-after-timing-report.json) covers task selection,
unsupported-task handling, candidate details, evidence download, addressed-run
reload, mobile views, keyboard focus and zero console errors. Six actual
[screenshots](screenshots.json) are retained. Separate MCP checks verified saved
historical 2.0/2.1 requirements and current 2.2 context. All 17 pre-handoff evidence
files remain byte-identical, including the three original v2 failures.

The first browser attempt at `3cc45df` failed: each original batch exhausted its
shared 30-second allowance before any proposal. A publication race also caused an
evidence request to return 409. Those [exports](preserved-first-attempt-bundles.json),
[diagnosis](browser-timeout-diagnosis.json), logs and console record are preserved.
The prospective fix records a 60-second local mock batch cap and bounds waiting
for terminal evidence publication at five seconds. All arms still have the same
120-second total episode allowance, at most three proposals, and two observations
sharing each batch deadline. Historical absent-policy and live replay retain their
30-second behavior; trusted-smoke limits remain separately authoritative. No fixtures, checks, repeat counts or sealed protocol changed.
This retry is new local workflow verification, not replacement benchmark data.

`bundles/` retains exact exported JSON for all three successful runs and all three
first-attempt failures. To replay a successful run, use the recorded executable
source/configuration and pinned image, copy its bundle to `artifacts/<run-id>.json`,
then run `make reproduce RUN=<run-id>`. The [replay logs](v2-replay-results.json)
record actual invocations and exits. Hashes establish integrity, not authenticated
provenance. These replays use fresh containers on the same host; they do not
satisfy independent-machine verification.

The first full integrated test attempt also retained one stale-fixture lookup
failure; the catalog-based correction passed all 573 tests before the timing and
publication changes brought the count to 585. A test-only TypeScript annotation
failure is retained in the timing review. Original logs are kept verbatim,
including trailing blank lines. No paid integration, scored model experiment,
human exercise, public deployment or competition submission occurred.

A [28.24-second private walkthrough](rehearsal-custody-v2.json) observes these
completed runs with readable captions. It created zero new runs. The raw video,
original captions and caption derivative are preserved locally; the video was
not published or committed. An actual comparison frame was visually reviewed.
The prior 91-second v1 rehearsal remains preserved separately.
