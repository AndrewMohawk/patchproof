# Trusted aggregate experiment export

`workers/evaluator/experiment-export.ts` captures the dispatcher's metadata and produces an offline-verifiable aggregate bundle. It does not instantiate a dispatcher, call an executor, adjudicate a candidate, load a corpus, contact a provider or reconcile billing. The operator CLI is a separate caller. The current implementation was verified with invented metadata only; no real experiment or provider-billing result is supplied by these tests.

The module exports `captureExperimentSnapshot`, `validateExperimentCapture`, `exportExperiment`, `verifyExperimentExport`, `LiveReadinessReceiptSchema` and `liveReadinessReceiptDigest`. The capture and export APIs always require independently supplied `ExportBindings`: `sourceDigest`, `planDigest` and `transportDigest`. The plan digest uses the existing `protocol.hashJson(validatePlan(plan))` convention. The transport digest must match the dispatcher's persisted transport binding, which hashes its model/policy digests and prospective adjudication bounds. The source digest should come from `digestJson(buildOperationalLock(projectRoot).sources)` or an explicitly verified historical lock.

The source label is either `current-operational-lock` or `expected-historical-lock`. It records the caller's provenance choice. The dispatcher database does **not** currently record that source digest, so source equality cannot establish which checkout executed an earlier episode. Both the manifest and summary therefore fix `sourceExecutionVerified: false`. An expected historical lock never claims that the present checkout matches it. `authenticityVerified` also remains false: schema checks and hashes establish consistency and integrity, not provider authenticity or authority to score a real experiment.

```ts
const capture = captureExperimentSnapshot({
  dispatcherDatabase: privateDispatcherPath,
  expected: independentlyVerifiedBindings,
  sourceBinding: 'expected-historical-lock',
});
const exported = exportExperiment({
  directory: newPrivateExportDirectory,
  projectRoot,
  capture,
  expected: independentlyVerifiedBindings,
});
const checked = verifyExperimentExport({
  directory: exported.directory,
  expected: independentlyVerifiedBindings,
  expectedManifestDigest: exported.manifestDigest,
});
```

## Capture and retained accounting

Capture opens SQLite read-only, enables `query_only`, and reads metadata in one transaction. It selects the frozen plan, mode and transport binding; each episode's position, identity, state, cancellation flag, operation IDs, observed usage and terminal result; and only the existence of an `executor_started` event. It never selects `execution_json`, selected source, private event details, check definitions or logs. Paths and credentials are not copied into artifacts.

Validation requires the complete original 72- or 270-episode grid in its original order. Deterministic dispatch IDs must match their planned identities. A terminal entry must have a reason and result; a nonterminal entry must have neither. Results must match the plan, variant, runtime bindings and mode. Only correct/incorrect outcomes may claim sealed checks. Final known usage cannot decrease below a captured checkpoint. Integer counters and aggregate totals must remain within safe numeric limits.

Every planned identity survives export, including pending, active, cancelled, failed setup and incomplete-billing entries. `progress.json` retains observed checkpoints and operation handles. `results.json` contains exactly the existing terminal result rows; it never invents missing rows. The summary records the full planned denominator, missing-result IDs, cancellation IDs, failures and observed usage lower bounds. If a failure has a known earlier CPU/cost observation but an unknown final total, the observation contributes to the separate lower bound while the final result stays `null` and is explicitly listed as unknown. Pending and active episodes also remain incomplete.

The bundle does not read or replace the separate budget ledger or accounting receipt journal. `ledgerReconciliationIncluded: false` prevents its checkpoint totals from being mistaken for reconciled project spending. Operation IDs are references, not proof of cleanup, complete inventory or final charges. Keep the bundle under trusted evaluator access; metadata can identify experiments even when it contains no task/check content.

## Analysis gate

Synthetic exports are labeled `SYNTHETIC — NOT A SCORED EXPERIMENT`, keep `benchmarkExecuted: false`, and never call the live analyzer. They cannot carry a live-readiness receipt. The existing live result schema continues to reject synthetic rows.

For live metadata, export may optionally receive `liveReadinessReceipt` and `acceptedReadinessReceiptDigest`. The receipt has this strict shape:

```ts
{
  schemaVersion: '1.0',
  kind: 'experiment-preflight-readiness',
  bindings: { sourceDigest, planDigest, transportDigest },
  observedAt, // ISO timestamp no later than capture
  gates,      // existing strict ExecutionGatesSchema
}
```

Its digest is computed with `liveReadinessReceiptDigest`; the caller must obtain the accepted digest through trusted independent ingestion, not simply trust a hash supplied inside a bundle. Export and verification require this explicit digest whenever a receipt is present. The module validates all existing readiness booleans, finite budget fields, model/price projection and plan allocation through `assertExecutionReady`.

The existing `analyzeExperiment` runs only for live rows, a recorded executor start, and a bound accepted receipt whose gates pass. Missing or unsatisfied readiness leaves an explicit `not-analyzed` record; malformed or mismatched receipts reject. Partial live results retain the analyzer's full planned denominator. Unknown measurements and cap violations retain its suppressed-comparison behavior. This gate validates receipt structure and declarations; it cannot itself authenticate account access, pricing, provider billing, runtime controls, or historical execution. A report's numerical availability is not a release/competition authorization.

## Files, immutability and verification

The exact bundle consists of `manifest.json` plus `plan.json`, `progress.json`, `results.json`, `summary.json`, `analysis.json` and `readiness.json`. Readiness is JSON `null` when absent. The manifest lists each artifact's fixed filename, exact byte length and SHA-256 digest. It is written last. The exporter accepts no arbitrary file list and copies no candidate artifacts.

Output requires a new normalized absolute directory outside the supplied project tree, with a private owned existing parent. Existing directories are never reused, including empty ones. Files are exclusively created, fsynced, and made mode 0400; the final directory is mode 0500. The exporter fsyncs the output directory and its parent. These are local filesystem durability measures, not exhaustive hardware-failure proof. A failed partial directory is preserved and cannot be reused by export; choose a new path after inspecting the failure. A privileged owner can still change permissions or edit files, which is why verification and external digest pins matter.

Input DBs, sidecars, artifact files and parent paths reject symlinks; files must be private, owned, regular, and have one link. Metadata has explicit limits: 128 MiB per DB/sidecar, 1 MiB plan text, 256 KiB operation list per episode, 16 KiB result text, 4 KiB checkpoint text, 16 MiB per JSON artifact/capture, and 32 MiB total artifact bytes. These checks limit trusted metadata ingestion and do not make the module an arbitrary database-upload endpoint. The operator must also keep evaluator directories outside candidate mounts and access; Unix ownership alone cannot establish that broader isolation.

Offline verification opens only the bundle. It checks the exact artifact list, sizes, hashes, strict metadata schemas, external source/plan/transport bindings and optional externally pinned manifest digest. It reconstructs the capture and recomputes results, summary and permitted analysis. Added files, missing files, traversal names, contradictory rows, altered bytes, and rehashed but inconsistent summaries fail. Pin the manifest digest before handing a bundle to another party: a party able to rewrite every artifact and the manifest can create a different internally consistent bundle. Hash integrity is not authenticity.

`node --test tests/experiment-export.test.ts tests/experiment-export-independent.test.ts` passed 21 tests, including eight separately authored independent controls; `npm run typecheck` also passed. The [combined test log](../research/verification/runtime-followup/experiment-export-tests.log) records the run, and the [independent review receipt](../research/verification/runtime-followup/experiment-export-independent-review.json) binds source hashes and distinguishes source findings from executed controls. The tests include metadata-only 72/270 grids, partial/unknown accounting, strict mode/readiness gates, a consistent SQLite snapshot during a concurrent metadata update, a database projection that deliberately contains unreadable excluded artifact text, and filesystem/tamper controls. No candidate or sealed-corpus execution is part of this verification.
