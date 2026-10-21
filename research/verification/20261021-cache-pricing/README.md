# October 21 cache-price compatibility repair

The authenticated provider catalog changed only `pricing.input_cache_read` from null to `0.00000006`; reverting that one field in memory reproduced the prior accepted model digest. Ordinary input/output prices remain $0.30/$0.90 per million. The account price table independently lists cached input at $0.06/M effective October 20.

The narrow policy v2 accepts null or exactly that reviewed cache price, and still reserves every input token at the full ordinary rate. No ledger, inference, receipt-settlement, isolation or runtime-limit code changed. Source and policy digests require genuine new catalog verification.

## Validation

Command: `node --test --test-concurrency=1 tests/renewable-pricing.test.ts tests/live-pricing-evidence.test.ts tests/live-local-runtime.test.ts tests/budget-covered-inference.test.ts tests/closed-dispatch-recovery.test.ts tests/operational-lock.test.ts tests/docker-strict-umask.test.ts tests/docker-lifecycle-independent.test.ts tests/runtime-docker-cleanup.test.ts tests/runtime-sandbox.test.ts`.

Initial result: 121/128 passed, seven real-container failures because the pinned image was absent from both default and explicit production daemon contexts. Retained raw log: `initial-tests.log`. All non-container regressions passed. `npm run typecheck` exited 0.

Restored the exact previously approved official `python@sha256:79e7a9b9ff1cbceff819f856fb374477792a5967759d94df266de7b7b4120e6f`; observed image ID `sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51`. All layers already existed. Retained daemon events did not explain the missing image reference; no prune configuration or unrelated workload was changed.

Reran all four affected container files with the same serial test command: 36/36 passed, zero skipped/cancelled. See `protected-restored-tests.log`. No assertions or deadlines changed.

Self-review found no broader catalog relaxation: missing/unexpected/malformed cache prices, ordinary-price or fee increases, changed model ID/context/quantization, duplicate target entries and new pricing keys remain rejected. No cache discount enters the bound ($0.2467296 raw, $0.246732 rounded, $0.25 reserved).

Actual account-fee review completed October 21 at 16:17:45.204 UTC using existing authenticated browser access and the official published tax policy. Billing was active; model prices match; applicable additional fees/tax remain zero. Private attestation expires October 22 at 16:17:45.204 UTC (full-run cutoff 16:07:45.204). No billing PII is retained in this repository. Historical costs remain unknown, with all $3.60 held; available cap capacity $21.40 (85 reservation slots). No paid inference was performed.

Deployment and post-change results are recorded in a separate restoration receipt after execution. The generic competition/research audit remains blocked and is not an operational acceptance claim.
