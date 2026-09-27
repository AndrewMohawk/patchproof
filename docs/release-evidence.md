# Local release evidence and packets

The release tools inspect content and recorded observations. They do not call a
provider, run a study, publish, deploy or enter the event. A packet is local
preparation even when its selected bundles reproduce. `competitionReady`,
`publicationAuthorized` and `authenticityVerified` remain false in the packet.

## Commands

Prepare a repository-relative JSON input with exactly these fields:

```json
{
  "receiptPaths": [],
  "trustedReceiptDigests": [],
  "bundles": [
    { "path": "artifacts/<run-uuid>.json", "bundleDigest": "sha256:<64-hex>" }
  ]
}
```

The placeholders above are documentation, not valid receipts or runnable IDs.
Select at least two actual exported bundles: a successful declared-check result
and a failure/abstention. The builder only accepts explicit `artifacts/<UUID>.json`
selections; it does not collect an arbitrary directory or copy secret files.

```sh
make release-check INPUT=research/release-input.json
make release-packet INPUT=research/release-input.json
make verify-packet PACKET=artifacts/release-packets/<packet-hex> DIGEST=sha256:<packet-hex>
```

`release-check` without `INPUT` still reports current local prerequisites and
missing receipt gates. Missing or incomplete evidence returns a blocked report.
The CLI recomputes the current source/runtime/protocol bindings and obtains the
source commit and working-tree state from Git. No command above authorizes
publication, hosting, registration or submission.

## Receipt boundary

`scripts/release-receipts.ts` exports `ReleaseReceiptSchema`,
`buildReleaseBindings`, `RELEASE_GATES` and `validateReleaseReceipts`. A receipt
records an observation window, outcome, specific gate assertions, artifact
references and their byte digests. All receipts bind the exact operational source
manifest, runtime configuration, protocol behavior and complete selected bundle
digest set. Changed bindings, expired/future timestamps, malformed data, duplicate
identities, contradictory outcomes and changed/missing artifacts fail closed.
One explicit receipt per gate avoids silently preferring a success over a failure.

Scope fields distinguish actual observations from synthetic plumbing,
local execution from live service execution, human observations from simulated
answers, and a separate machine from the same host. Synthetic receipts never
fulfill actual gates, even if their hashes appear in the trusted-ingestion list.
Live experiment/study gates require a live runtime and frozen live protocol;
the current `local-unscored-development` operational lock cannot fulfill them.

`trustedReceiptDigests` names receipts accepted by the trusted evidence-ingestion
process. Directly captured local commands and output bytes can support local
receipts. External provider, independent-machine, deployment and human claims
require the corresponding independently reviewed evidence. This is an ingestion
boundary, not a request for an extra owner approval of already authorized local
work. Do not put a digest on this list merely because a JSON object labels itself
`actual`. Hashes establish consistency, not authenticity or the truth of claims.
An accepted command record does not cause that command to execute.

Publication/entry decisions remain the separate owner configuration checked by
`auditRelease`. Receipt completion is not permission to take those actions.
The audit's optional third argument is:

```ts
{ bindings, receipts, trustedReceiptDigests, liveProtocol?: ReleaseLiveSelection, now?: Date }
```

It recomputes the current bindings and reads the referenced repository files
itself. It does not accept a stale caller binding as current. Relative file reads
reject traversal, symlinks, nonregular files and oversized input.

## Explicit live protocol selection

The default audit uses the local, unfrozen operational protocol. After actual
calibration and trusted verification, an optional input `liveProtocol` reference
can select a public metadata projection:
`{ path, digest, acceptedProofDigest }`. `digest` binds the exact file bytes;
`acceptedProofDigest` separately identifies the reviewed acceptance record.
The exact schema is `ReleaseLiveProtocolSchema` in `scripts/release-protocol.ts`.
It binds current executable sources, the whole operational lock, runtime/model
settings, accepted calibration and policy. Missing input stays unfrozen;
malformed, stale or mismatched input fails.

Settle source, runtime, budget and owner decisions **before** accepting the live
protocol and recording presentation runs. Those files are part of the source
binding; changing them later intentionally invalidates the old binding. The
packet does not authenticate a self-declared acceptance or substitute a digest
for actual account/calibration observations. See the
[source-bound verification and freeze-order guide](../research/verification/20260927-release-live-protocol/README.md).

A selected live document produces packet format 1.1 and is copied only after
its exact bytes are covered by an accepted scan receipt. Existing packet 1.0
verification remains unchanged. Matching three-proposal smoke bundles are
classified `compatible_presentation` with `executionScope: trusted-smoke-only`;
they do not establish execution of the separate 24-call experiment policy.
Actual experiment receipts and every other release gate are still required.
Historical or mismatched evidence keeps a blocked packet status.

## Scan and packet contents

A `release_secrets` receipt must have actual/local scope, successful recorded
scanner commands and output artifacts, the gate assertions listed in
`RELEASE_GATES.release_secrets`, and `scannedArtifacts` entries covering the exact
selected bundle paths and byte digests. A directly captured scan can be ingested
locally; it does not require a synthetic provider or human receipt. Scan the
approved public-fixture exports, record and review the scope/findings, and only
then pass their receipt digest to the builder. Changing even whitespace in an
export after scanning invalidates that receipt. A scan is bounded evidence, not
a guarantee that every possible secret format has been detected.

`buildReleasePacket` verifies each selected evidence bundle, verifies scan
coverage, and copies only those bundle bytes. It adds a manifest, checksums,
notices, setup instructions and per-run verification/replay commands. It does not
copy arbitrary files, raw receipt text, scanner programs, credentials or whole
workspaces. The manifest keeps success/failure, mock/live, run identity, bundle
digest, byte digest and source/runtime binding visible. Historical or unbound
bundles remain useful references but force the packet's evidence status to
`blocked`; they require their original source checkout for replay.

Files are created exclusively in a new content-addressed directory and then made
read-only. Existing packets are never overwritten. A filesystem owner can still
change permissions or bytes: this is detectable content immutability, not WORM
storage, a signature or independent custody. `verifyReleasePacket` requires a
separately supplied expected packet digest, validates the exact file set and
checksums, and revalidates every embedded bundle. It performs no candidate
execution. A checksum stored beside an artifact cannot authenticate itself.

The source commit is a discoverability reference supplied by the caller; the
source-manifest digest is authoritative. A dirty checkout requires preserving
the exact working-tree source snapshot separately. The packet is not a source
archive and includes neither npm dependencies nor the execution image. Its setup
instructions use `npm ci --ignore-scripts --no-audit --no-fund`, `make doctor`,
`make test` and `npm run check:contracts`, but the builder does not claim to have
run them. A complete presentation set additionally requires at least three live
successful runs plus an honest failure/abstention, all with current bindings.

## Verification and remaining work

Focused validation on 2026-09-27:

```sh
node --test tests/release-receipts.test.ts tests/release-packet.test.ts tests/operational-lock.test.ts
npm run typecheck
git diff --check
```

All commands exited 0; 10 tests passed. Receipt tests use explicitly synthetic
provider/study inputs and never promote them to actual gates. Packet tests run a
real, deliberately narrow canary scan over synthetic temporary bundles to test
the local scan-ingestion path. That receipt is only a unit-test observation,
not a scan of this release, sponsor evidence or human data. Test packets stay in
temporary directories and are removed. No actual project release receipts were
authored by these tests.

Still separate: actual sponsor smoke/billing, pilot/final results, human study,
independent-machine replay, current rules and license review, hosted availability,
and owner publication/entry decisions. The source `06c584c` integration captured
an actual scan of four exact public-fixture exports: three successful local runs
and one honest unsupported-task abstention. The [integration receipt](../research/verification/20260927-completion-audit/integration-receipt.json)
binds the source checkout, scan, [packet manifest](../research/verification/20260927-completion-audit/packet-manifest.json)
and command exits. Packet `sha256:00accae07a81904edf6c7305b90e0b128c7e02eb506cd7cdf60a0d2a031d2f95`
was built locally; packet verification and file checksums exited 0, and all four
bundles have current source bindings. Its evidence status remains `blocked`,
`release-check` exited 2 for missing external gates, and publication was not
authorized. This is an actual local handoff packet, not sponsor or release approval.
