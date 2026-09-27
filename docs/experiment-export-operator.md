# Private aggregate export command

```sh
node scripts/experiment-export-cli.ts export CONFIG.json CONFIG_DIGEST
node scripts/experiment-export-cli.ts verify CONFIG.json CONFIG_DIGEST MANIFEST_DIGEST
```

The command captures existing dispatcher metadata or verifies an already exported
bundle. It never runs a candidate, calls an adjudicator, reads sealed checks, obtains
credentials, dispatches work or reconciles billing. Verification does not open the
dispatcher database or require the original source checkout.

The absolute, private external `CONFIG.json` follows
`ExperimentExportOperatorConfigSchema`. It contains `schemaVersion: "1.0"`,
`kind: "patchproof-experiment-export-operator"`, the absolute existing
`dispatcherDatabase`, a new absolute output `directory`, and `bindings` with exact
`sourceDigest`, `planDigest` and `transportDigest`. Its `sourceBinding` is either
`current-operational-lock` or `expected-historical-lock`. The former checks
`digestJson(buildOperationalLock(projectRoot).sources)` at export time: the source
map digest, not the digest of the entire operational lock. The latter records the operator's
expected historical digest. Neither establishes that an earlier dispatcher actually
executed that source; every output declares `sourceExecutionVerified: false`.

`readiness` is explicit `null` when unavailable. Otherwise it contains the absolute
private receipt `path` and an independently accepted `acceptedDigest`, computed with
`liveReadinessReceiptDigest`. The schema, binding and gate checks still apply; a
receipt cannot relabel synthetic data as a live experiment. Do not copy a digest from
unverified input and call it reviewed evidence.

`CONFIG_DIGEST` is `operatorJsonDigest(ExperimentExportOperatorConfigSchema.parse(value))`,
so it identifies parsed, schema-ordered JSON rather than file formatting. A verifier
also requires the previously recorded exact `MANIFEST_DIGEST`. Retain that digest
separately from the bundle. Hash verification detects changes, not forgery by a
trusted operator. Inputs and databases use owned private paths outside the project,
with no symlink ancestors or hard links; immutable outputs remain private.

The export retains every planned identity, including missing results, cancelled
episodes and known usage lower bounds with unknown final totals. It includes no
candidate files or sealed definitions. Separate accounting receipts do not modify
these historical results. Synthetic exports are clearly labeled and cannot enter
the live analyzer. Exit 0 means export or integrity verification succeeded, not that
the experiment is complete, scored, authenticated or competition-ready. Exit 2
means input, binding or integrity checks failed. Existing output directories are
never overwritten.

The compact CLI response provides the manifest digest, execution mode, planned and
terminal counts, and completion status. Inspect the exact artifacts privately for
full metadata and any eligible analysis. Raw input, private paths, operation handles
and exception stacks are omitted from command output.
