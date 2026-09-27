# Private experiment sessions

`workers/evaluator/experiment-session.ts` supplies the trusted operator boundary around the existing dispatcher. It preserves the frozen plan and its deterministic episode identities; it does not define a new experiment protocol. `scripts/experiment-session-cli.ts` parses private operator commands and emits compact, sanitized output. The standalone CLI deliberately installs no runtime factory or ledger. Root/runtime integration must supply those dependencies explicitly before run commands can work.

```sh
node scripts/experiment-session-cli.ts preflight CONFIG.json CONFIG_DIGEST
node scripts/experiment-session-cli.ts status CONFIG.json CONFIG_DIGEST
node scripts/experiment-session-cli.ts run-one CONFIG.json CONFIG_DIGEST EPISODE_ID
node scripts/experiment-session-cli.ts run-all CONFIG.json CONFIG_DIGEST
node scripts/experiment-session-cli.ts cancel CONFIG.json CONFIG_DIGEST EPISODE_ID
node scripts/experiment-session-cli.ts recover CONFIG.json CONFIG_DIGEST
```

`ExperimentSessionConfigSchema` requires a UUID `sessionId`, private external `dispatcherDatabase` and `planPath`, plan/source/model/policy/transport digests, execution mode, prospective adjudication bounds or explicit null, a factory digest, and a pinned readiness-file reference or explicit null. `maxNewSpendUsd` defaults to **zero**. Synthetic sessions require zero new spending and no live readiness receipt. The approved project ceiling is still enforced by the existing ledger; a session cannot apply credits, sync approval, reset a hold or expand a stage allowance.

`CONFIG_DIGEST` is `experimentSessionConfigDigest(parsedConfig)`, using the same parsed JSON convention as other private operators. The caller must supply it independently. The plan file must match `hashJson(validatePlan(plan))`; model/policy fields and the transport hash must match that plan. Inputs and database sidecars must be owned private regular files with no symlink ancestors or hard links, outside the project tree. Keep the config and frozen external plan with the journal for all control commands. Secrets and provider credential paths are not part of this schema.

The source digest is `digestJson(buildOperationalLock(projectRoot).sources)`. Preflight and run commands check the present source; status, cancellation and recovery do not need to rebuild that lock. A trusted integration may inject `currentSourceDigest()` in place of the default local calculation, but must preserve the same meaning. Source/hash equality is not provider authenticity or proof of historical execution; output keeps those claims false.

## API and factory boundary

```ts
await runExperimentSession({
  command: 'run-one', configPath, expectedConfigDigest, projectRoot, episodeId,
}, {
  factory, ledger, currentGates, signal,
});
```

`ExperimentSessionFactory` declares `factoryDigest`, `sourceDigest`, `transportDigest`, and `create(context)`. Creation returns `{ transport: DispatcherTransport, close? }`. Both creation and close must be local preparation/teardown with **no billable side effects**. Provider requests and remote cleanup belong inside the bounded execution/adjudication callbacks and their accounting deadline, before a finalized result is returned. The session does not resolve credentials or install/discover a factory. It never closes a caller-owned ledger.

The factory context contains only session/mode/source/plan/transport identities, an array of public execution inputs, the injected ledger and `reservationForExecution`. It contains no full plan, oracle field, private plan path, sealed checks or adjudication result. The public projection is the dispatcher's `ExecutionInput` without its `checkpoint` callback. Each runtime invocation must strip `checkpoint` before asking for its reservation projection.

`createReservationProjection(plan)` validates the complete public input against the frozen plan, including deterministic dispatch ID, seed, limits and fixture/model/policy bindings. It returns `{ reservationFingerprint, stage, amountMicros, dispatchId, publicInputDigest }`. The fingerprint is the existing dispatcher's `hashJson({ planDigest, episode })`; it is opaque to the runtime. `publicInputDigest` uses canonical `digestJson(parsedPublicInput)`. The callback exposes no oracle field or content. It neither reserves money nor grants execution.

Preflight performs local binding and gate checks without constructing a runtime, dispatcher or session database. Live runs need explicit positive session authority, the independently accepted bound readiness receipt, a current strict gates callback, a current ledger connection with no pending billing/freeze, and a matching injected factory. Initial gates use the full experiment allocation; after the dispatcher's preflight marker exists, current gates use the same per-episode remaining allowance as the existing dispatcher. The dispatcher remains the only reservation/dispatch grant path and preserves its known-cost/CPU adjudication checks.

## Durable commands and interruption

The operator journal is `dispatcherDatabase + '.session.sqlite'`. It binds the UUID and exact config digest, records metadata initialization, and journals each mutating command as started/completed/failed. Existing dispatcher state without a matching operator journal is rejected. A changed config cannot silently attach to an initialized session. Once initialization is recorded, a missing dispatcher DB is a state-loss error, not permission to recreate it.

Initialization first persists the session binding, creates the dispatcher with control callbacks that always reject execution, verifies an uncommitted grid is entirely pending, and records initialization before constructing the runtime. An interrupted initialization may be completed by a later explicit run when its binding and pending state are intact. Malformed or incomplete journal metadata fails closed for operator review; it is not automatically discarded. Preserve both databases and their SQLite-consistent backups. Privileged rollback or editing of both databases is outside these consistency controls.

Status reads the existing metadata projection without constructing a dispatcher or runtime. Before initialization it reports the full planned identity list, zero terminal episodes, and `initialized: false`; this is a plan, not a fabricated run. A terminal run-one or completed run-all returns recorded state without creating a factory or spending again. Concurrent commands still rely on the dispatcher's atomic single claim; `executionPerformed` records whether this invocation actually entered its executor callback.

Run-all is an explicit operator action over the fixed grid. There is no startup resume or automatic retry. Setup failures before dispatch are journaled while the planned episodes remain pending; no terminal result is invented. A later explicit command may attempt still-pending work. Once a dispatcher episode becomes terminal, configuration changes or repeated commands cannot retry it under the same identity.

Cancellation and recovery instantiate only control callbacks, never the runtime factory. Live control commands require the existing injected ledger so holds remain intact. Cancellation durably requests an active owner to abort, or terminalizes an undispatched episode. Recovery uses the dispatcher's existing same-host dead-PID check; it cannot steal a live/PID-reused owner. It terminalizes interrupted work without resuming execution, rerunning adjudication or proving remote cleanup. Retained operation handles and unknown charges still require trusted external cleanup/accounting. Unknown billing blocks later live factories and grants until reconciliation is explicit.

CLI SIGINT/SIGTERM triggers an abort signal for the current invocation. An aborted run-all retains terminal cancellation rows for the remaining grid. Error responses contain controlled codes only: no private filenames, episode strings, provider text or stacks. A run-command error reports `executionPerformed: null`, because an error after dispatch cannot honestly claim nothing ran; inspect durable status. Successful runs return whether this invocation entered an executor, not whether its result was correct. Local teardown failure is recorded as failed and cannot make a terminal episode dispatchable again.

## Verification limits

Tests use invented plans, metadata and transports that return no candidate. They cover complete 72/270 synthetic grids, status/preflight without construction, exact public reservation projection, zero/default and current gates, the existing live ledger branch with invented zero charges, unknown-billing holds, cancellation, conservative recovery, terminal/concurrent idempotence, state-loss refusal and CLI error sanitization. No provider, candidate or sealed-corpus execution occurs. The concrete factory, authoritative phase accounting, remote cleanup, access and pricing remain separate integration responsibilities.

Author verification: `node --test tests/experiment-session.test.ts` passed 17/17 controls and `npm run typecheck` exited 0. The [test log](../research/verification/runtime-followup/experiment-session-tests.log), [typecheck log](../research/verification/runtime-followup/experiment-session-typecheck.log), and [verification receipt](../research/verification/runtime-followup/experiment-session-verification.json) bind the source snapshot. That original receipt records the pre-review author snapshot. The subsequent [independent review](../research/verification/runtime-followup/experiment-session-independent-review.json) reproduced and verified fixes for mutable command input and SQLite sidecar path collisions. The [followup receipt](../research/verification/runtime-followup/experiment-session-followup-verification.json) records all 28 final controls passing; none of these controls establishes provider integration or observed paid execution.

The command snapshots caller request fields before asynchronous factory creation, so an external mutation cannot change the audited episode. Config, plan and readiness inputs cannot alias either dispatcher/session database or its WAL, SHM or rollback-journal paths; this check precedes database construction and preserves the input bytes.
