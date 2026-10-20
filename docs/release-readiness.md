# Release readiness

**Checked:** October 20, 2026 (UTC)
**Disposition:** Reviewed isolated recovery deployed; curated generation admission is ready as of October 20, 19:55 UTC.
The reviewed exact-case [closed-dispatch recovery](closed-dispatch-recovery.md) retains all holds and unknown settlement. The exact approved container image and protected startup check passed. This integration excludes the Humanize feature. One exact-case coverage event was applied with all $3.60 held and unknown settlement preserved. See the [restoration receipt](../research/verification/20261020-isolated-recovery/production-restoration-receipt.json). Hourly catalog verification does not replace the account-fee review due before October 21 at 18:34 UTC; future access remains bounded and fail-closed.
See the [current repair receipt](../research/verification/20261016-demo-repair/README.md)
for current timing, pricing, supervised repairs, accounting and rollout gates.
The historical October 13 sections below are retained as dated context; they
do not describe the October 16 test environment or current pricing receipt.

## Prior release review evidence (October 13)

- The repository is private. Root package metadata previously said
  `UNLICENSED`; this proposed change adds MIT for first-party software and
  documentation. Fixture CC0 and dependency licenses remain separate.
- September 28 receipts document real Token Factory inference with the NVIDIA
  Super model and local-container checks. The accepted pagination result is
  22/22, with fresh same-host replay. [Evidence index](../research/product-v3/README.md).
- The 149.76-second recording is hosted at the app's
  [demo page](https://patchproof.andrewmohawk.xyz/demo/). A YouTube publication is
  not verified.
- October 13 read-only app inspection reported new repairs paused for a pricing
  refresh. [The source](../packages/orchestrator/src/live-local.ts) sets the prior
  pricing validity to October 1. This change does not extend it or start any run.
- The 700-test result belongs to the dated September 28
  [receipt](../research/product-v3/verification/test-results/final-suite-receipt.json),
  not this revision.

## Publication gates

- [ ] Review all reachable Git history and the intended release tree for secrets,
  personal data, and material not intended for public release. A prior staged
  scan is not a full-history audit. Any finding needs a specific remediation
  decision before publication.
- [ ] Confirm first-party provenance and preserve all third-party licenses and
  notices. Review media, fonts, screenshots, and synthetic narration/reference
  audio separately. The existing hosted recording is not proof of rights.
- [ ] Verify the exact public source commit, complete setup instructions, and
  independently reproducible build. Do not publish a partial source snapshot.
- [ ] Publish the authorized existing demo only after its media review, then
  record and verify its public YouTube URL and playback.

These are review gates for the already approved source/demo preparation; none is
marked complete by adding a license file.

## Working demo and track fit

- [ ] Verify current pricing and the existing approved allowance, then restore
  execution through the separately authorized engineering workflow. Preserve
  unresolved reservations; token estimates do not settle provider invoices.
- [ ] Resolve selected-track fit: the general platform definition accepts a
  runtime Token Factory inference call, but coding-track prose describes writing,
  running, and testing code in Token Factory. Confirm that interpretation before
  treating hosted Sandboxes as mandatory. Local Docker checks are not evidence
  of Nebius-hosted execution.
- [ ] For any planned Sandbox integration, verify account entitlement, actual
  execution controls, cancellation, accounting units, and retention behavior.
  Existing adapters and synthetic tests do not establish those facts. Unknown
  provider behavior remains unknown; do not invent compliance.
- [ ] Verify the app and setup against the final source and record any failed or
  unavailable checks. Assign and fund ongoing judge access within owner approval.

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules), read on
October 13, list October 30, 2026 at 10 a.m. Pacific as the submission deadline
and require free judge access through the judging period ending December 15.
They also require an eligible entrant and permission for third-party material.
Final entry and acceptance of terms are separate owner-controlled actions.

## Project evidence goals, not invented event requirements

The original plan also calls for a calibrated pilot, sealed matched comparison,
human review exercises, independent-machine replay, and authoritative billing
reconciliation. Those are unfinished project goals. Do not label them explicit
event requirements or claim their outcomes. Keep the submission's claims within
the real development evidence while track fit and working-demo requirements are
resolved.

## Historical October 13 documentation-only verification

Only license text, package license metadata, and documentation are changed.
Local validation must check JSON consistency, unchanged dependency metadata and
fixture terms, and repository-relative links against the exact reviewed tree.

Full application tests, type checking, browser execution, container replay,
provider requests, and full-history secret/rights review are **NOT RUN** for this
preparation change. The fallback workspace contains selected source documents,
has Node 24 rather than the project's pinned Node 25.5.0, and has no installed
project dependencies or Docker. A documentation consistency pass is not a
substitute for release verification.
