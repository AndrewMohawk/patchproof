# Private evidence inspection and export

The private operator reads a completed smoke run's journal and checks its exact
bundle against the currently curated development/calibration fixture. It makes
no model calls and executes no candidate. Hashes establish integrity and binding,
not the authenticity of a provider observation.

Close the smoke writer before inspection. The journal must be checkpointed:
nonempty SQLite WAL or rollback journals are refused without modification.
Inputs must be explicit absolute paths outside this repository, with owned 0600
files and private 0700 parent directories. Links, oversized files and database
sidecar/output collisions are rejected. No credentials belong in this config.

Create an operator configuration with this shape, replacing every placeholder:

```json
{
  "schemaVersion": "1.0",
  "kind": "product-evidence-operator",
  "stateDirectory": "/absolute/private/smoke-state",
  "runId": "RECORDED-RUN-UUID",
  "bundleDigest": "sha256:RECORDED-BUNDLE-DIGEST",
  "fixture": {
    "taskId": "CURATED-TASK-ID",
    "fixtureDigest": "sha256:FIXTURE-DIGEST",
    "sourceDigest": "sha256:SOURCE-DIGEST",
    "policyDigest": "sha256:POLICY-DIGEST"
  },
  "outputFile": "/absolute/private/selected-bundle.json"
}
```

`outputFile` may be null for inspection. Configuration acceptance uses
`privateEvidenceConfigDigest(config)` from `scripts/evidence-operator.ts`:
schema-ordered JSON hashed by `operatorJsonDigest`, not a raw-file hash. Obtain
the run/fixture pins from the selected recorded input and independently review
them before accepting the config. Do not invent these values.

```sh
node scripts/evidence-operator.ts inspect "$CONFIG" "$CONFIG_DIGEST"
make export CONFIG="$CONFIG" CONFIG_DIGEST="$CONFIG_DIGEST" RUN="$RUN"
```

`RUN` is optional when using a private configuration; if supplied, it must match.
Export creates one new 0600 file containing the exact verified JSON bytes,
syncs the file and parent directory, and refuses overwrites. Inspection checks
the terminal journal document, its published digest, the bundle and current
public fixture pins. It never reads the sealed evaluator tree. JSON printed to
the terminal contains only metadata, not candidate files or private event logs.

An exported bundle can be passed to the [read-only archive](evidence-archive.md)
or [guarded replay operator](replay-operator.md) without the original journal.
Those paths recheck the curated fixture pins. Archive viewing/export do not
establish fresh execution or reconciled billing. Local mock exports continue to
work with `make export RUN=<id>` and retain their mock label.

These are filesystem hygiene and bounded read checks, not isolation from another
process running as the same Unix user. Keep the operator directory and selected
inputs under trusted ownership throughout the operation.
