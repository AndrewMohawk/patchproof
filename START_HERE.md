# Start here — PatchProof

**Release-preparation snapshot:** October 13, 2026 (UTC)  
**Status:** Implemented development demo; public-source release and competition submission are not complete.

Start with [README.md](README.md) for the product, setup instructions, and commands.
The implemented application uses NVIDIA Nemotron through Nebius Token Factory,
with declared checks in local Docker containers. The [product v3 record](research/product-v3/README.md)
links the September 28 real-run, replay, public-interface, and 149.76-second
recording receipts. These are historical observations, not fresh test results.

The public app and saved recording have been hosted. An October 13 read-only
inspection found new repairs paused because the pricing verification expired;
saved demonstrations do not establish current execution availability. See
[release readiness](docs/release-readiness.md) for the remaining checks.

## Where to go

- [AGENTS.md](AGENTS.md): operational boundaries and required evidence.
- [tasks.json](tasks.json): acceptance tracker; several integration, evaluation,
  and release gates remain blocked.
- [Submission draft](docs/submission-draft.md): evidence-linked description for
  review, not a submitted entry.
- [Release readiness](docs/release-readiness.md): publication, availability, and
  track-fit gates, separate from the project's research goals.
- [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md): MIT for
  first-party software/documentation, existing CC0 fixture terms, and third-party
  scope. Selecting a license does not complete the rights review.

## Historical planning package

[nebius-patchproof-PRD.md](nebius-patchproof-PRD.md),
[ARC-feasibility-note.md](ARC-feasibility-note.md), and [sources.json](sources.json)
preserve the original September 25 plan and dated research. Statements in that
plan about a product not yet existing describe that earlier state.
`SHA256SUMS.txt` belongs to the original package at commit `4bf1335`; it is not
a checksum manifest for this evolving checkout.

No new spending, provider execution, deployment, publication, merge, or event
entry is authorized by this document. Follow the owner's explicit instructions
and the existing resource gates.
