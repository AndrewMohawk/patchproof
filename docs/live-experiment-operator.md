# Private live experiment operator

The private operator connects the calibrated live executor, project ledger, protected adjudicator and phase accounting journal. It is implemented and tested using invented HTTP responses and accounting receipts. **No real provider run, calibration result or competition evidence exists.** The checked-in runtime remains mock, the project ceiling remains $25, and final evaluation and hosting allocations remain $0.

`scripts/live-experiment-operator.ts` accepts explicit private session and runtime config files outside the repository. The session uses `ExperimentSessionConfigSchema`; the runtime uses `LiveExperimentOperatorConfigSchema`. Both files must be owned, private regular files without links. Use one existing project ledger across smoke and experiment sessions. A missing or mistyped ledger is rejected rather than creating another spending allowance.

The runtime config binds the exact model/tokenizer, account, sandbox controls, CPU envelope, prices, calibrated policy acceptance, independently accepted proof digests, source digest and private paths. It names a tokenizer artifact, separate credential files, evaluator workspace, trace directory and phase journal. Credential files contain `{ "token": "..." }`, remain outside the repository, and are read only by the guarded adapter after the dispatcher has granted one existing reservation. Do not put credential values in command arguments, logs or chat. Preflight checks credential file metadata, without parsing token values.

`liveExperimentOperatorConfigDigest` computes the runtime config digest; `liveExperimentFactoryDigest` computes the session's factory binding. `experimentSessionConfigDigest` computes the session digest. These exported helpers parse their strict schemas before hashing. The model lock is `digestJson(buildLiveExperimentModelLock(...))`, the policy is `hashJson(buildLiveExperimentPolicy(settings))`, and the transport digest is `hashJson({modelLockDigest,policyDigest,adjudicationBounds})`. For experiments, the source binding is `digestJson(buildOperationalLock(projectRoot).sources)`. The older smoke operator uses the whole operational lock; do not interchange those digests.

The session must pin an independently accepted readiness receipt with real integration and calibration evidence, not self-declared mock results. The runtime acceptance must match the policy, model, source, sandbox-control and CPU-proof digests. Current budget token/CPU limits must be configured and every planned episode must fit them. The entire 72/270 grid and episode reservations must fit the approved stage allocation. A different protocol requires prospective revision before viewing final results; this command does not shrink or silently skip the frozen grid.

```sh
node scripts/live-experiment-operator.ts preflight SESSION SESSION_DIGEST RUNTIME RUNTIME_DIGEST
node scripts/live-experiment-operator.ts run-one SESSION SESSION_DIGEST RUNTIME RUNTIME_DIGEST EPISODE_ID
node scripts/live-experiment-operator.ts status SESSION SESSION_DIGEST RUNTIME RUNTIME_DIGEST
node scripts/live-experiment-operator.ts cancel SESSION SESSION_DIGEST RUNTIME RUNTIME_DIGEST EPISODE_ID
node scripts/live-experiment-operator.ts recover SESSION SESSION_DIGEST RUNTIME RUNTIME_DIGEST

make pilot CONFIG=SESSION CONFIG_DIGEST=SESSION_DIGEST RUNTIME=RUNTIME RUNTIME_DIGEST=RUNTIME_DIGEST
make evaluate CONFIG=SESSION CONFIG_DIGEST=SESSION_DIGEST RUNTIME=RUNTIME RUNTIME_DIGEST=RUNTIME_DIGEST
```

The Make targets check the plan kind before dispatch. Without `CONFIG`, they retain their explicit blocked default. `run-all` is also available for an explicitly selected session. No command resumes or retries an attempted episode. Cancellation and recovery do not require current credentials or the original execution-budget digest; a changed budget still blocks new work. Recovery marks dead-owner attempts interrupted, retains unknown billing and cannot steal a living process's work.

Runtime and adjudication each wait for a separate reviewed [phase accounting receipt](phase-accounting-operator.md) within the remaining deadline. There is no invented billing endpoint. An operator or verified collector must populate the journal from authoritative evidence in time. Actual USD and CPU, exact operation inventory, cleanup and retention completeness are all required. An observer timeout cannot be repaired by reopening an episode; late evidence is preserved for separate whole-episode reconciliation.

The protected adjudicator receives the selected files only after durable selection. It uses one bounded sandbox batch, checks all-case CPU and quoted cost ceilings before paid work, and reserves accounting/cleanup time. It never returns sealed cases or per-check feedback to repair. Raw check evidence stays under the external evaluator's `artifacts/episodes/` directory, including a separate `.raw-checks.json` saved before forwarding final accounting. Public aggregate exports contain metadata rather than these sealed records.

On cancellation, the session drains its owned execution, observation and raw adjudication promises and the live executor's internal adapter work before closing the ledger or phase journal. Cleanup may finish after a terminal dispatcher result. Such late raw evidence cannot rewrite that result or release its hold automatically. Use the separate whole-episode accounting importer only after all work and cleanup are stopped; its scope includes both phases exactly once.

Preflight is not proof of account access, future service availability, affordability at actual rates or source execution. Provider defaults/seeds are recorded honestly; a seed is not sent as an unsupported determinism setting. Publishing, public access, entry, and real-provider verification remain separate gates.
