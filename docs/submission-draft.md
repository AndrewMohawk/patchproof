# PatchProof — private submission draft

**Status: local prototype only. Not submitted or ready for submission.**

## Description supported by current evidence

PatchProof helps a maintainer review a proposed Python change against the
requirements that ordinary tests can miss. It records a rejected candidate,
executes independently controlled checks, shows requirement coverage and exports
the final patch with inputs, runtime locks, observations and a replay command.
Nothing is merged automatically.

The local demonstration repairs stable de-duplication while preserving order,
input data and the empty-input behavior. Three policies use the same initial
source and configured allowance: visible-test feedback, acceptance-check feedback,
and bounded candidates against the original source. The current repair responses
are scripted; the displayed check failures and fresh-container replay are real.
The [current verification record](../research/verification/20260927-completion-audit/README.md)
binds the current browser screenshots and three successful fresh replays to
`06c584c`. All three policies passed their declared checks in that demonstration;
it does not establish a PatchProof advantage.

The current v2 first candidate passes only 2/5 visible and 1/4 acceptance checks;
it demonstrates rejection and repair, not a visible-tests-pass/contract-fail
contrast. That contrast is preserved in the
[historical v1 PatchProof bundle](../research/verification/20260927-merged-ui-docker/evidence/e2310d8f-1fd5-45ba-addf-6268e0a06a0f.json):
its first candidate passes 3/3 visible checks but only 2/3 acceptance checks.
The [source-bound receipt](../research/verification/20260927-merged-ui-docker/verification.json)
records that scripted-model, real-local-check example at `92a2baf`. Demonstrating
the same contrast with genuine provider output remains pending.

This demonstrates the workflow, not learned repair performance, sponsor
integration, branching advantage, production security or general correctness.
The 60-task suite is original synthetic data. The fixed 72/270 experiment tools
have not run a scored model episode. No headline improvement percentage is claimed.

## Architecture and originality/reuse

The three-screen loopback app calls a durable coordinator that records shared
allowances, candidate history and actual check events in SQLite. Scripted proposals
are checked in fresh local containers; expected values stay in the trusted checker.
Immutable exports bind source, policy, observations and replay instructions. The
local app cannot dispatch paid work; separately configured private operators
retain their account and evidence gates. See the [implementation overview](../README.md#implementation-and-evidence)
and [runtime guide](../workers/sandbox/README.md).

The workflow and synthetic fixtures were developed with AI assistance; the
[corpus provenance](../research/corpus-v2/README.md) discloses the authoring process.
Automated testing and constraint checking are not claimed as new ideas. The B0
baseline is a native repair loop, not mini-SWE-agent. No mini-SWE-agent, OpenHands,
Aider or SWE-Gate code/data is vendored; third-party packages and their licenses
are listed in [the notices](../THIRD_PARTY_NOTICES.md). The [build decisions](../decisions.md)
and [source ledger](../sources.json) record the project scope and prior work.
Application licensing remains an owner decision; dependency notices do not grant
a license to publish this application.

## Required additions before public submission

- Real Token Factory NVIDIA model and Sandboxes integration with actual IDs,
  pinned dependencies and reconciled costs.
- Completed pilot and justified go/simplify/stop decision; sealed comparison and
  ablation results with failures and uncertainty preserved.
- Three genuine reproducible successful runs and an honest failure/abstention,
  uncoached reviewer evidence, and independent clean-environment replay.
- Owner-selected application license, authorized public source/video and a working
  funded demo through the judging window.
- Final rules review, release audit and owner-controlled entry/terms/submission.

## Draft 165-second recording plan

| Time | What to show | Evidence constraint |
|---|---|---|
| 0–20s | Task and explicit requirements | Curated task, visible mode, exact recorded source. |
| 20–45s | Ordinary candidate and visible-test results | Show its actual verdict, logs and policy; no invented model reasoning. |
| 45–75s | Independent check rejects requirement violation | Actual expected/observed values and requirement mapping. |
| 75–105s | Repair and comparison | Same task/lock/allowance; label recorded versus active run. |
| 105–135s | Export and fresh replay | Exact bundle digest and successful command output. |
| 135–150s | Failure or abstention | Show unresolved coverage instead of a false pass. |
| 150–165s | Limits and measured evaluation | Use real report if available; otherwise explicitly state not run. |

A local rehearsal must keep the mock banner visible. No sponsor-backed or public
video has been recorded. A scripted rehearsal cannot satisfy the real demo gate.

A 91-second private local rehearsal now exists under
`.local/rehearsal/2026-09-27T09-11-44-046Z/`, with WebM, a captioned MP4, SRT
captions and a manifest tied to the actual displayed runs. It shows scripted
proposals and real local checks; it does not present sponsor or benchmark results.
Its hashes and browser/replay verification are in the runtime-completion receipt.
The preferred caption rendering is `local-rehearsal-captioned-v2.mp4`; its source
archive and separately recorded hashes are identified by `rehearsal-custody.json`.
This preserves the earlier corpus and executable source. The video filename's
`v2` means its caption revision, not the independently authored v2 corpus. It is
historical rehearsal evidence, not a recording of the current catalogue.

A recorded **28.24-second private v2 walkthrough** observes the three completed
`c335031` runs; it does not depict the newer `06c584c` handoff. Its captions identify
recorded-run observation, scripted proposals and no measured advantage. The raw capture, original captions and
captioned MP4 remain local under `.local/rehearsal/20260927-corpus-v2-recorded-runs/`;
[the custody record](../research/verification/20260927-corpus-v2-integration/rehearsal-custody-v2.json)
binds exact files, duration, source and run identities. This walkthrough created
zero new runs and was not published. Sponsor-backed final recording remains open.

## Platform feedback draft

Public documentation identifies the inference endpoint and sandbox operation
lifecycle, but account model availability, pricing and deployment controls still
need verification. The inspected SDK integration guide described a mini-SWE-agent
constructor incompatibility, so this build uses internal adapters and tested HTTP
mappings instead of assuming SDK compatibility. Exact inspected URLs and dates
are recorded in the runtime guide and source ledger.

This is documentation feedback only. We have not measured Nebius latency,
reliability, isolation, developer experience with real accounts or billing.
Add first-hand results after the authorized smoke. Do not present local Docker
behavior as a Nebius platform result.
