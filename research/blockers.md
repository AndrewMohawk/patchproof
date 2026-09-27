# Remaining gates — 2026-09-27

The local product is implemented and tested under the owner's instruction to
build before provider access. **Real Nebius integration is the first remaining
external gate.** It is not a missing spending approval: $25 total is approved;
actual spending is $0. The private repository and ongoing pushes are authorized.

## Provider integration (T01/T04, G0/G1)

Access has been deliberately deferred. When supplied through an approved file or
provisioner outside the repository, candidate workspaces and logs, the next work is:

1. Verify project entitlements, NVIDIA model ID/license/card, rates and any credits
   with service, amount and expiry. Do not infer account availability from public docs.
2. Pin sandbox API/image/architecture and verify supported filesystem, network,
   memory, PID, CPU, cancellation and billing controls. Public HTTP mappings alone
   do not establish these properties.
3. Finish the live sandbox checker and coordinator execution path. They currently
   refuse execution even if configuration fields are filled in.
4. Reserve costs prospectively within the $5 smoke and $25 aggregate caps, run two
   curated real cases, retain real operation IDs and reconcile actual charges.

## Other remaining acceptance evidence

| Task/gate | Implemented locally | Still required |
|---|---|---|
| T02 | Typed contracts, version locks, tests, workspace | Live provider contract verification. |
| T03 | 60 authored synthetic tasks; separate evaluator; gold/start/repeat validation and independent review | Scored-experiment protocol freeze and production evaluator account separation. |
| T05–T08 | Three bounded policies, protected checks, durable journal, export and fresh local replay | Live matched usage, sponsor cancellation and billing reconciliation. |
| T09/G2 | Fixed 72-episode planner and analysis | Real pilot, affordable price projection and written continuation decision. |
| T10 | Task/comparison/evidence views; real local checks and browser flow | Live-provider state validation and uncoached reviewer exercise. |
| T11/G3 | Fixed 270-episode planner, sealed adjudication and clustered analysis | Authorized final budget, real final runs, ablations and reviewer study. |
| T12 | Local lifecycle tests and operations runbook | Public deployment authorization, hardened operator boundary and funded judge access. |
| T13/G4 | Setup guide, honest draft/storyboard/platform feedback | Sponsor-backed runs, final recording and public licensed source. |
| T14 | Local evidence/review and private source history | Independent clean-machine replay, final rules/license/secret audit and owner release decisions. |

The $25 ceiling is not evidence that either experiment is affordable. Final
experimentation and hosting currently have zero allocation. Any reduced grid
requires a prospective revised protocol and narrower claims.

Application license, public source/video, public demo operator and service budget
through the required judging period remain owner decisions. No terms were
accepted and no registration, publication or submission has occurred. Missing
access is not a measured negative result for the product hypothesis.
