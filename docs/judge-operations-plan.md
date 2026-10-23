# Judge operations plan

The live path remains restricted to curated tasks, one active run, three model
calls, a 786,432-token input ceiling, 12,000 output tokens, ten minutes wall
time, and a $1 reservation per run. `budget.json` caps the project at $50. These
limits do not release historical holds or infer any unknown actual cost.

Before admission, the runtime verifies the operational source lock, the budget
approval window, local-container readiness and cleanup, and current renewable
pricing. Pricing state is bound to the source digest, budget digest, approval
expiry, account-fee evidence, model identity, context, quantization, and rates.
Unsupported fees, stale evidence, malformed prices, or a conservative maximum
cost above the reservation block the run.

The pricing service performs authenticated read-only catalog checks. It makes no
inference call, does not renew account-fee evidence, and writes only the private
operator state file. The hourly timer merely refreshes catalog evidence before
expiry; it grants no spending authority.

Local checks use a bounded two-lane scheduler. Candidate and baseline observers
share the original check deadline. Coordinator observations and provider
receipts are retained before candidate-output parsing, so malformed output cannot
erase charge or execution evidence. Cleanup uncertainty remains a terminal
error.

For a source integration, run:

```sh
npm run typecheck
node --test --test-concurrency=1 tests/*.test.ts
node scripts/verify-private-integration-artifacts.ts \
  /absolute/private/pricing-evidence.json \
  /absolute/private/repair-evidence.json
```

The first two commands are portable. The final command is mandatory for an
operator release review but requires private artifacts that must not be added to
Git. Any code-only integration has a different operational source digest from a
deployment that included historical receipts; update no production binding
without a separate, quiescent deployment review.
