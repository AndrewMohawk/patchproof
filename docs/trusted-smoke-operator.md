# Private trusted smoke operator

`make smoke CONFIG=<absolute-private-json>` runs the same explicit `start` command
described below. Without `CONFIG`, `make smoke` reports the current provider blockers
and exits 2. Preflight remains a separate no-provider-call command.

The local operator wires the existing trusted smoke factory to an explicit private
configuration and durable session. It supports `preflight`, `start`, `status` and
`cancel`. The browser remains mock and `make smoke` remains blocked by default.
No real sponsor request was made during implementation or testing. Current checked-in
budget token/CPU ceilings and account records are still incomplete, so live preflight
is blocked until those existing gates have real configuration.

Run these commands from the verified source checkout, after
`npm ci --ignore-scripts --no-audit --no-fund`:

```sh
node scripts/smoke-operator.ts preflight /absolute/private/smoke.json
node scripts/smoke-operator.ts start /absolute/private/smoke.json
node scripts/smoke-operator.ts status /absolute/private/smoke.json
node scripts/smoke-operator.ts cancel /absolute/private/smoke.json
```

Only `start` can dispatch provider work. It requires `executionAuthorized: true` and
all factory/source/account/resource/ledger gates; it is not a request to discover
credentials or manufacture account evidence. No example account, model ID, rates,
image UUID or credentials are supplied here. No live command was run for this change.

## Private files and configuration

Prepare a directory outside the project with mode `0700`; every configuration,
tokenizer and credential file must be owned, regular, mode `0600` or stricter and
have one hard link. Paths must be canonical absolute paths with no symlink ancestor.
Database sidecars receive the same checks. The account operator supplies these files
through a private local channel, never through chat, repository files or command-line
key arguments. The credential files contain exactly one JSON field, `token`; the
sandbox project ID comes from the verified account record. Environment credentials,
`.env` discovery, home-directory searching and remote tokenizer downloads are absent.

The exact configuration schema is `SmokeOperatorConfigSchema` in
`scripts/smoke-operator.ts`. It requires the episode UUID, curated public task ID,
variant and fixed episode limits; private state directory, project ledger path,
budget digest, tokenizer/credential file references; pinned model access/rates;
and the existing model, source, CPU and sandbox verification records. Unknown
fields are rejected. Only development/calibration task files are loaded; final
fixtures are not available to this command.

All configurations and sessions for this project must point to the **same fixed
project budget ledger**. A new directory, configuration, checkout or SQLite file
is not a new $25 allowance. The operator is trusted control-plane code, not a
same-UID sandbox: it cannot discover and merge arbitrary alternate ledger files.
The owner must preserve and designate the authoritative ledger across processes.

The digests have distinct definitions:

- `budgetDigest` is `operatorJsonDigest(BudgetSchema.parse(budgetJson))`: SHA-256
  of the schema-ordered `JSON.stringify` value, matching the ledger approval binding.
- `sourceProof.digest` is `digestJson(buildOperationalLock(projectRoot))`, recomputed
  before dispatch and new work. Changes to source, dependencies or bound configuration
  invalidate it. The aggregate experiment exporter separately names the hash of
  `lock.sources` its `sourceDigest`; do not substitute that narrower digest here.
  This local lock does not claim a frozen live experiment protocol.
- `sourceProof.fixtureDigest` is `digestJson` of the parsed public `FixtureSchema`
  value, including schema defaults, as required by the smoke factory. This differs
  from the experiment dispatcher's raw fixture-file byte digest.
- `modelProof.tokenizerDigest` is `digestJson` of the parsed full
  `SmokeTokenizerArtifactSchema` value; formatting the JSON differently is harmless.
  It binds tokenizer data, recipe, account vectors and verification record together.

A hash checks binding and staleness; it does not authenticate the truth of an
account/control attestation. Account setup must independently establish the model
card, license, exact access, context, request charging, tokenizer behavior, sandbox
isolation/retention/cancellation/billing controls and CPU overhead assumptions.
The schema does not turn reference strings or booleans into that evidence.

## Local tokenizer artifact

`packages/orchestrator/src/smoke-tokenizer.ts` defines the strict artifact. It embeds
JSON tokenizer data and configuration for the pinned `@huggingface/tokenizers@0.2.0`
engine, an explicit system/user framing recipe, special-token choice, conservative
margin and at least two account-verified count vectors. It supplies all role/content
text to the counter; unknown roles or non-string content are rejected. The current
repair adapter sends only system and user text. Complex, conditional or unsupported
chat templates remain blocked; do not approximate them with the simple recipe.

The official [Hugging Face source](https://github.com/huggingface/tokenizers.js)
documents local `Tokenizer` construction and encoding from the two tokenizer JSON
objects, and describes JavaScript/Rust regex differences. The
[package manifest](https://raw.githubusercontent.com/huggingface/tokenizers.js/main/package.json)
identifies version 0.2.0 and Apache-2.0. Both sources were read on 2026-09-27;
no publication date was established. The exact package is integrity-pinned in the
lockfile; its installed license is preserved. Model/tokenizer data have their own
license/source requirements and are not downloaded by this implementation.

Passing supplied vectors establishes only that this engine/recipe reproduces those
vectors. Account evidence must also establish conservative counting across the
admitted prompt content, including chat framing, Unicode and special tokens, and
that the output cap covers every billed output/reasoning token. The implementation
makes no universal tokenizer-equivalence claim. Unverified compatibility or an
unsupported account template is a blocker, even if a toy test passes.

Tokenization runs in a fixed trusted Node subprocess with no inherited environment,
no add-ons, a 256 MiB JavaScript heap setting, a five-second deadline and bounded
output. It receives tokenizer JSON and message text only, imports no account-supplied
executable and executes no candidate source. The heap setting is not a whole-process
RSS cap. Synchronous tokenization can delay host cancellation handling by up to its
five-second timeout; cancellation is not claimed to be instantaneous.

## Lifecycle and evidence

Preflight reads configuration, public tasks, tokenizer data and verification records.
It checks credential **file metadata only**, never token contents and never network.
It may initialize the private runs database, evidence directory and approved ledger.
It creates no session claim, budget reservation or dispatch grant. The response
states `scope: no-execution` and zero provider calls by this command.

Start durably claims the episode UUID and exact configuration digest before preparing
runtime state. The claim is issued once across processes. Failed preflight after
claim, cancellation, crash and terminal completion never make that identity retryable.
Calling start again returns the existing session; changing its configuration/scope
is a binding conflict. The trusted factory separately owns the one aggregate budget
reservation/dispatch grant. No second grant or auto fallback is introduced here.

SIGINT/SIGTERM and a separate `cancel` command signal the active owner. A durable
cancel bit is polled every 100 ms while the event loop is available. Known remote
cleanup remains the existing adapter's bounded responsibility. Cancellation is not
proof of terminal remote state, upload deletion, no charge or reconciled billing.
An interrupted owner's session is not resumed or taken over. PID liveness is a
conservative observation; PID reuse/permission uncertainty never authorizes retry.

Status and cancellation need the private configuration/session database, but remain
usable when credentials/tokenizer files have been removed or expired. Status reports
the recorded config binding, owner liveness, phase, safe reason, known usage and
operation handles. `commandProviderCalls: 0` describes the status/cancel/reuse command,
not the historical episode. Session status never returns claim tokens or secrets.

The run journal durably retains model request intents, successful/failed response IDs,
sandbox upload/instance intents and known UUIDs. The session projection includes model
request/response IDs and up to 192 sandbox handles plus the complete count and an explicit truncation
flag; `stateDirectory/runs.sqlite` retains the complete operation journal. Unconfirmed
intents remain visible and are never represented as established cleanup. Exported
run evidence resides in `stateDirectory/evidence`; session metadata alone is not a
complete replay bundle. Partial failure snapshots retain handles and unknown billing.

Actual USD stays unknown until separate validated accounting evidence is imported.
The aggregate hold remains in the project ledger after success, failure, cancellation
or restart; estimates are never relabeled as measured cost. See
[the accounting operator](accounting-operator.md) and
[the trusted factory limits](trusted-smoke.md). This three-proposal smoke is not the
24-call/900-second experiment executor or a calibrated matched experiment.

## Validation scope

`node --test tests/smoke-operator.test.ts tests/smoke-tokenizer.test.ts tests/smoke-operator-sessions.test.ts`
uses invented account records, a small original vocabulary, private temporary files,
a fake lifecycle and real local SQLite/process concurrency. The in-memory injection
seam is labeled `synthetic-test`; configuration cannot enable it. Synthetic execution
cannot call the supplied provider transports, which explicitly refuse network calls.
The real factory constructor is exercised without starting it; existing trusted-smoke
transport tests separately cover its provider/cancellation/accounting logic.

Live account/tokenizer verification, provider execution/cancellation, billing and
24-round experiment execution: **NOT RUN**, because account access and independently
verified control records remain unavailable. Test receipts are recorded under
`research/verification/20260927-smoke-operator/`.
