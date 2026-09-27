# Explicit live release protocol binding — author verification

Tested source: `b3a649c27b838ea328408a170cc7061cfbf33588`, based on
`259882c753a9a9bc6ff9f435ca44394aee4c34c4`. The source/test hashes, exact commands,
exit codes, log hashes and capture time are recorded in `verification.json`.
This is an author verification record, not an independently accepted release
receipt. All account/calibration metadata and live-shaped bundles used by these
tests are invented synthetic inputs. No provider, credential, paid resource,
sealed corpus, publication or actual participant observation was used.

The default release resolver continues to select the local operational behavior
with `liveProtocolFrozen:false`. An explicit public metadata document can select
the separately accepted live experiment policy. The CLI reader, release audit
and packet builder use the same resolver. Frozen receipt bindings alone cannot
select it. Actual release gates still require the existing exact bindings,
trusted receipt ingestion, actual execution/human scope and gate assertions;
synthetic receipts do not satisfy them.

## Explicit input and producer compatibility

The existing repository-relative `make release-check INPUT=...` and
`make release-packet INPUT=...` input accepts an optional field:

```json
{
  "liveProtocol": {
    "path": "research/accepted-live-protocol.json",
    "digest": "sha256:<exact document file byte hash>",
    "acceptedProofDigest": "sha256:<accepted calibration proof digest>"
  }
}
```

The remaining `receiptPaths`, `trustedReceiptDigests` and `bundles` fields are
unchanged. `acceptedProofDigest` is an explicit trusted-ingestion assertion,
separate from arbitrary release receipt content. Neither this digest nor a hash
of a receipt authenticates calibration, account access, measurements or humans.
The schema is exported as `ReleaseLiveProtocolSchema` from
`scripts/release-protocol.ts`; construct its public projection from already
accepted private runtime metadata, not by copying a private operator config:

- `schemaVersion:"1.0"`, `scope:"accepted-live-experiment-release"`.
- `operationalLockDigest`: canonical `digestJson(buildOperationalLock(root))`.
- `runtime`: exact current `RuntimeSchema` snapshot.
- `settings`: accepted `LiveExperimentSettingsSchema` settings.
- `modelLock`: exact `buildLiveExperimentModelLock` result.
- `acceptance`: accepted `LiveExperimentAcceptanceSchema` proof. Its digest is
  `digestJson(acceptance)` and must match the separately accepted input digest.

The release binding's source digest remains `digestJson(operational.sources)`.
Its runtime digest remains `digestJson(runtime)`. The explicit release protocol
digest is `digestJson(entire public protocol document)`. Internally, the
acceptance policy uses the executor's existing `hashJson(buildLiveExperimentPolicy(settings))`
convention, not a substituted serialization. The resolver checks current source,
whole operational lock, runtime, model/rates, calibration policy, proof windows,
control metadata and the accounting/cleanup reserve. It does not establish the
truth of the referenced account/calibration claims.

The actual smoke producer already exports a flattened `trusted-smoke-only`
runtime lock containing the whole operational-lock digest and model/control
proof pins. Matching live smoke bundles are classified
`sourceBinding:"compatible_presentation"`, `executionScope:"trusted-smoke-only"`.
They retain their own three-proposal policy; they do not become 24-call
experiment executions. Old, mock or mismatched bundles remain historical or
unbound. Pilot and sealed results remain separate receipt evidence, produced by
the experiment trace/aggregate path rather than fabricated ProductEvidence.

Packet schema `1.1` copies the exact selected `live-protocol.json` only after an
accepted scan receipt covers its source bytes. Its verifier rechecks protocol
bindings at capture time and recomputes per-bundle scope. Existing schema `1.0`
packets retain their old manifest/digest shape; no fields are defaulted into
historical preimages. Packet verification remains consistency-only and reports
`authenticityVerified:false` and `publicationAuthorized:false`.

## Prospective order and limitations

Freeze operational source files, `runtime-lock.json`, `budget.json` and
`owner-decisions.json` before accepting calibration and capturing the smoke and
experiment evidence intended for the same release. These files are part of the
source map. Obtain the actual account/model/tokenizer/control observations,
accept their exact source/policy/model bindings, then capture the corresponding
runs and exact receipts. Keep this public projection in a metadata/artifact path
outside the operational source roots to avoid a self-referential source hash.
Any later bound source/runtime/budget/owner change makes prior evidence
historical for the new release; this implementation does not relax or silently
rewrite those bindings. Per-run operation records belong in evidence, not a
post-hoc mutation of the frozen source snapshot.

The projection is a strict metadata input, not an automatic producer or an
account-verification mechanism. Actual account access, calibrated proofs,
accepted pilot/sealed/reviewer receipts, public release approvals and a real
complete presentation set remain unavailable/not established by this work.
All real release gates remain blocked in the default checkout.

Default `make reproduce RUN=...` now refuses a live bundle with
`live_replay_configuration_required` before constructing any local Docker
checker. Private configured replay is a separate operator path. Existing
version 2.1 evidence `commands.json` bytes were not changed. Export output uses
the verified bundle's actual mode.

## Executed controls

- Fifteen focused tests cover default local binding, explicit live selection,
  stale/untrusted/changed source/runtime/model/policy rejection, CLI/audit parity,
  synthetic and wrong-scope receipt rejection, current smoke classification,
  scanned public proof bytes, historical packet behavior, tamper controls and
  live replay refusal without a Docker-capable PATH.
- Typecheck and frozen-contract checks pass.
- Default `release-check` exits `2`, reports zero paid calls and retains current
  missing real evidence/authorization blockers.
- Full integrated suite and actual live-provider execution: **NOT RUN** here.
  The coordinator owns integrated verification; no account is being assumed.
