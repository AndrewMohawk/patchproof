# Local release review — 2026-09-27

This review covers the local product against PRD F01–F12. It does not approve a
competition release, public deployment, paid execution or benchmark claim.
The available product uses a scripted repair provider and real local container
checks. Sponsor integration remains blocked. No sealed evaluator files or sibling
evaluation workspace were accessed during this review.

The review began on base commit `251b62f18623bc5b8b3a5dd10d0dabd1e6112d2b` with
the implementation in the working tree. The coordinator is responsible for the
tested implementation commit. The explicit product contract is now **2.1**;
historical **2.0** exports retain their original verification and replay rules.

## Requirement results

“Passed” below means the stated local behavior has evidence. “Partial” identifies
a material limit against the full PRD. Stored browser/replay reports are
distinguished from commands executed by this reviewer.

| ID | Result | Specific evidence and remaining boundary |
|---|---|---|
| F01 — Immutable snapshot and policy | **Passed for 2.1 local inputs** | `fixtures.ts` hashes source separately and all remaining fixture metadata in the 2.1 policy, including description, identity, requirements, checks and edit policy. Coordinator snapshots inputs; evidence verification checks those bindings. `orchestrator.test.ts` rejects changed description/title/repository/provenance/split even after the outer bundle hash is recomputed. Explicit version relabelling and unknown versions fail. Historical 2.0 policy hashes did not bind description/metadata; that limitation remains explicit, and cross-version comparison is rejected. |
| F02 — Real sponsor integration | **NOT RUN / blocked** | Coordinator rejects live mode; CLI smoke/pilot/evaluate remain gate reports. `NebiusRepairProvider` has fake-transport tests; `NebiusSandboxCheckRunner` refuses unverified controls. `doctor` reports no account-verified model/rates, sandbox entitlement/image/billing or reconciled provider operations. A $25 owner ceiling does not enable execution. API, UI and exports retain mock labels and `competitionReady: false`. |
| F03 — Matched resource budgets | **Partial** | All local variants receive the same declared limits. Coordinator counts proposals/usage, caps attempts, applies a 120-second aggregate watchdog, and passes check batches only their remaining wall allowance. Containers use 0.5 CPU; uncertain cleanup stops another case from starting. Stored comparison bundles match source/policy/runtime/limits, but provider calls/tokens/cost are zero scripted counters. Actual CPU is **null**, not measured. This is not a matched paid-model or measured-CPU experiment. |
| F04 — Constrained editing | **Passed for curated local source** | `validatePaths()` restricts Python paths and the frozen allowlist. Provider tests reject protected edits; orchestrator regression preserves an unchanged protected helper while replaying the allowed diff. Candidate mounts contain only source, readonly. No evaluator definitions, expected values or credentials enter that mount. This is a benign maintenance-fixture boundary, not a general hostile-code guarantee. |
| F05 — Independent executable checks and replay | **Passed for declared local checks** | `DockerCheckRunner` uses fresh containers and an immutable generic driver; host code compares observations with expected results. Runtime tests reject wrong returns, input mutation and plain `PASS` output. `applyPatch()` reconstructs changed/added files and missing final newlines. Stored real CLI replay reports six checks reproduced from an exported diff. New regression replays both explicit 2.0 and 2.1 bundles. Driver and candidate share a Python process; sophisticated tampering resistance is not established. |
| F06 — Requirements coverage | **Passed locally** | Fixture loading rejects unknown requirement mappings and duplicate check IDs. Coordinator derives coverage from selected-candidate results; absent/error checks stay unverified. Unsupported-task regression preserves original check failures but produces no selected patch and only unverified coverage. UI displays requirement IDs, check IDs and unverified states. |
| F07 — Candidate explanation | **Passed in stored browser evidence** | Actual local demonstration records a rejected scripted candidate and a corrected candidate. UI shows the diff, requirement failure, observed/expected values and recorded log. The stored browser report exercises candidate selection and log expansion. Summaries are explicitly scripted descriptions; no hidden model reasoning or model-success claim is presented. Final 2.1 browser validation is a coordinator-owned follow-up, not claimed as rerun here. |
| F08 — Cancellation and restart | **Partial** | Tests cover cancellation cleanup, exact-run reconciliation that preserves another running container, durable pre-spawn handles, failed journaling, parent-death SIGKILL and independent in-container wall timeout. Recovery now handles changed runtime/contract bindings without inventing evidence, and cleanup exceptions do not abort startup. No atomic cleanup guarantee exists for a Docker create already accepted by the daemon; delayed work may require repeated scoped reconciliation. Its execution timer begins after startup, excluding daemon queue latency. Live-provider cancellation and final billing reconciliation are **NOT RUN**. |
| F09 — Honest error states | **Partial** | Fake transport tests distinguish rate limits and pre-dispatch authorization/budget failures; worker tests cover unavailable Docker, cancellation, invalid observations and cleanup uncertainty. Partial failed checks/operation IDs survive export. Unsupported scripted tasks terminate `needs_review` with zero actual provider cost. Missing-key/transport classifiers exist, but real-provider behavior is unverified. There is no demonstrated flaky-check classifier or repeated-flake protocol. |
| F10 — Evidence export | **Passed for local bundles** | Evidence includes source, task policy, runtime lock, selected diff, replay command, coverage, events, log hashes and cost ledger. Current product HTTP test exports a durable cancellation; abstention test reopens its journal and content-addressed bundle. All four existing 2.0 exports verified unchanged after migration. Hash integrity is not external authenticity or a signature; CLI replay explicitly reports `authenticityVerified: false`. Power-loss durability is **NOT RUN**. |
| F11 — Review workflow | **Passed locally** | Browser report covers inspect, comparison, evidence download and addressed-run reload. Product API exposes task/run/check/evidence operations; UI has no merge or repository-publish action. Repository publication performed separately by an operator is outside this product review. |
| F12 — Controlled public demo | **Partial: local boundary passed** | Listener binds loopback. Product HTTP test rejects arbitrary/live requests; strict curated task requests and shared host/origin guards remain in force. UI has no code, URL or file upload fields; dynamic text uses `textContent`. Containers disable network and receive no secrets. Only the one scripted fixture is enabled for mock repair; other public tasks abstain if called through the API. Public deployment, remote authentication and a real-credential leak test are **NOT RUN**. |

## Executed and inspected evidence

| Command or artifact | Result and scope |
|---|---|
| `node --test tests/runtime*.test.ts` | Exit 0, **20 passed**, no skips, earlier in this review session after the worker cleanup fix. Includes real pinned-container behavior, scoped cleanup, lifecycle and abstention checks. |
| `node --test tests/orchestrator.test.ts tests/evidence-version.test.ts tests/product-api.test.ts` | Exit 0, **11 passed**, no skips, after the 2.1 migration and recovery fixes. Includes explicit legacy replay, metadata tampering, version mismatch, HTTP rejection and cancellation export. |
| `npm run typecheck && npm run check:contracts` | Exit 0 after migration; contract 1.0 and product 2.1 source locks match. |
| `node scripts/product-cli.ts doctor` | Exit 0; local pinned image available, 30 public fixtures, $25 owner ceiling, zero verified credits, real integration **NOT RUN**. |
| `node scripts/product-cli.ts smoke` | Expected exit 2; `blocked`, zero paid calls and zero experiment episodes. This was a gate check, not sponsor smoke. |
| Explicit `verifyEvidence()` over existing `artifacts/*.json` 2.0 exports | Exit 0; all four historical product exports verified without changing bytes, digests or version labels. |
| `.local/verification/product-browser.json` | Inspected stored report dated `2026-09-27T08:20:27.442Z`, Chromium `145.0.7632.6`, status passed. Uses three actual 2.0 local runs, desktop/mobile layouts, download, reload, keyboard focus and same-origin checks. Browser was **NOT RUN by this reviewer**. |
| `.local/verification/product-replay.json` | Inspected stored real local replay: run `35a60dcc-3c9c-4550-b896-359a2a9d4eef`, six reproduced checks, no infrastructure error, mock mode, authenticity not verified. Fresh post-migration real replay is a coordinator-owned check. |

The three stored browser exports independently verified during review were:

| Variant | Run | Recorded outcome |
|---|---|---|
| baseline | `7e89c6fd-20aa-4812-8aa1-2deadde5232a` | failed |
| checks_only | `d422cfd2-1eaa-49b7-b5ea-b0b64042d293` | verified for declared checks |
| patchproof | `dd40a478-a406-4192-b8ad-bdaea21dad13` | verified for declared checks |

All three record CPU consumption as `null`, provider cost as zero, and mock mode.
Their different outcomes demonstrate the scripted UI workflow, not a model
advantage. The full suite was not rerun by this reviewer after migration; the
coordinator owns comprehensive verification and the final 2.1 browser run.

## Material corrections made during review

- An interrupted run with a changed runtime lock previously tried to publish its
  old digest against the new lock, causing startup failure. Recovery now preserves
  original bindings, ends the run as `needs_review`, clears the current evidence
  reference and leaves historical content-addressed artifacts unchanged. An
  incompatible contract/fixture receives the same conservative treatment.
- Cleanup/recovery exceptions now produce a per-run infrastructure state rather
  than aborting all startup. Failed publication never advertises an approval.
- The old policy digest omitted model-visible task descriptions. New version 2.1
  binds all fixture metadata; frozen 2.0 verification remains explicitly selected
  by version. There is no silent fallback between digest formulas.
- A worker could previously continue after unconfirmed cleanup. It now stops the
  batch before another candidate container can overlap an unresolved operation.

No provider calls, paid spending, source publication or evaluator access occurred
as part of this review. Remaining live integration, measured resource accounting,
flakiness handling and public-release limits are substantive, not documentation
substitutes for completed work.

## Coordinator follow-up after this review

Commit `f482bd7` contains the integrated implementation. Final `make test` exited
0 with 71 passed and no skips; actual product2.1 browser checks passed in both
temporary and persistent state. Fresh-container replay passed for all three
2.1 policy records and a historical2.0 export. The staged redacted secret scan
passed. A fresh source archive on the same host installed its exact lock offline
and reproduced the selected bundle without the original run database. See
`research/verification/20260927T082926Z-local-product/` and
`research/verification/20260927T0836Z-clean-checkout/`. These are coordinator-run
checks; they do not replace the independent-machine/live-provider gates above.
