# PatchProof — submission draft for review

**Updated:** October 13, 2026 (UTC)  
**Status:** Evidence-linked draft. Not submitted; publication and working-demo gates remain open.

## Short description

PatchProof helps maintainers review AI-generated Python changes against explicit
requirements. It pairs a proposed patch with protected executable checks,
requirement coverage, retained failures, and downloadable evidence. A human
decides whether to use the change; nothing is merged automatically.

## Problem and workflow

A patch can look plausible while missing an edge case or compatibility rule.
PatchProof makes the maintenance contract visible before generation, then shows
what was actually checked and what remains unresolved.

The implemented interface offers ten original synthetic maintenance tasks,
including cursor pagination, configuration overlays, inventory, and cache expiry.
Each task exposes its starting source, five requirements, and selectable
input/output examples. Saved walkthroughs show the bug, AI patch, check results,
and review decision. The interface includes contextual diffs and evidence export.

## What is demonstrated

The September development deployment used
`nvidia/nemotron-3-super-120b-a12b` through **Nebius Token Factory**.
Declared checks ran in isolated **local Docker containers**, under independent
control from the repair agent. These local checks are not Nebius-hosted Sandbox
execution.

The accepted pagination example began with 16 of 22 declared checks passing.
One real model proposal passed all 22 repeated checks; a fresh **same-host**
replay reproduced that result without another model call. The configuration
example retains a proposal with 17 of 22 checks passing and a later verification
timeout. It is shown as a failed repair, not a completed fix.

The [product v3 record](../research/product-v3/README.md) links run IDs, model
usage, immutable evidence digests, retained unsuccessful attempts, and
[replay evidence](../research/product-v3/verification/final-replay/receipt.json).
These examples demonstrate a review workflow, not general repair accuracy,
guaranteed correctness, a branching advantage, or production security.

## Implementation and evidence

The TypeScript application connects a model adapter, durable coordinator,
protected checker, and evidence export. The shared per-run allowance bounds
model calls, output tokens, time, and reserved spending. Tokens and token-rate
estimates are recorded separately from authoritative billing, which remains
unreconciled. Historical reservations stay held.

The repository records **700/700 tests passing on September 28 at source
`c6b2b421a9faa3049391997ce93082f68ecf37af`** in the
[full-suite receipt](../research/product-v3/verification/test-results/final-suite-receipt.json).
That is a historical result, not a test run for this documentation revision.
The matched-budget pilot, sealed evaluation, independent-machine reproduction,
and human reviewer study are not complete. No improvement percentage or
time-saved claim is supported.

## Demo and release status

- App: <https://patchproof.andrewmohawk.xyz/>
- Existing hosted recording: <https://patchproof.andrewmohawk.xyz/demo/>
- Source candidate: <https://github.com/AndrewMohawk/patchproof>, still private at
  this preparation snapshot.
- YouTube URL: pending publication and verification; no URL is invented here.

The existing recording is **149.76 seconds**, with disclosed synthetic narration,
a transcript, and real saved success/failure examples. Its
[publication receipt](../research/product-v3/verification/final-video/video-publication.json)
and [playback receipt](../research/product-v3/verification/final-video/video-receipt.json)
are dated September 28. Playback and hashes do not establish media rights.

An October 13 read-only inspection found new repairs paused for a pricing
refresh. The source's prior price-verification window ended October 1. Saved
examples and video alone do not establish a currently working generation path.

The [event rules](https://nebiusglobalaihackathon.devpost.com/rules), checked
October 13, require a working project, public licensed source, and a publicly
visible YouTube demo; their video guidance asks for less than three minutes. The
[Coding and Agentic Engineering track](https://nebiusglobalaihackathon.devpost.com/)
describes writing, running, and testing code in Token Factory, while the general
platform definition accepts a runtime inference API call. The rules do not name
Sandboxes as a separate requirement. Confirm how the selected-track description
applies to local-container checking before claiming fit or treating a hosted
Sandbox migration as mandatory. See [release readiness](release-readiness.md).

## Originality and licensing

The workflow and original synthetic fixtures were developed with AI assistance;
[fixture provenance](../research/corpus-v2/README.md) documents that process.
Automated testing and constraint-aware repair are not claimed as new ideas.
The B0 baseline is a native repair loop, not mini-SWE-agent.

The owner selected [MIT](../LICENSE) for original application code and
documentation. [Fixture CC0 terms](../fixtures/LICENSE-CC0.txt) and
[third-party notices](../THIRD_PARTY_NOTICES.md) remain in force separately.
Public release still requires a full-history secret review and a rights review
covering code, dependencies, screenshots, fonts, and narration/reference audio.
Selecting MIT does not supply missing third-party rights.

## Platform feedback draft

Token Factory supplied the model catalog and real inference responses used by
the recorded repairs. The evidence records request identity and reported usage,
which makes the observed result inspectable. The selected model and exact
account-discovery receipt are linked in the product v3 record.

Planned integration work includes verified Token Factory code execution and
provider-specific accounting and retention controls; this is not a statement
that hosted Sandboxes are an explicit event requirement. Local Docker observations
must not be presented as Nebius Sandbox measurements. These development
observations do not establish platform-wide latency, reliability, or isolation.
