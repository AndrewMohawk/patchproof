# Prospective eight-task model probe

The PRD requires a development-only model-selection probe before the pilot. The
offline planner and analyzer are implemented. Authenticated account discovery now
lists four NVIDIA models, and one Nano marker call confirms inference access; see
the [access receipt](../research/verification/20260927-account-access/README.md).
The eight-task repair probe and model selection are **NOT RUN**. Neither the
access control nor synthetic unit tests establish repair quality or a selection.

The frozen procedure uses the first two task IDs in lexical order from each of
four five-task development repositories. Every verified candidate gets the same
eight tasks, original source/policy, baseline variant, exactly one allowed model
call, token/CPU/wall/dollar ceilings and no final oracle feedback. Wall time is at
most 120 seconds per episode. Choose the quality threshold before observations:
`minimumCorrectTasks` is an explicit integer from 1 through 8, not a threshold
chosen by the analyzer. No threshold has yet been accepted for the live project.

The model list must come from verified account discovery and official model and
license sources. Each entry binds a model lock, account proof, tokenizer digest,
model card/license URLs and proof validity interval. An empty list is a permitted
draft and cannot recommend a model. The prospective plan digest covers the
selected grid, procedure, proof references and all limits.

These private commands only read/write metadata:

```sh
node scripts/model-probe.ts plan /PRIVATE/probe-input.json /PRIVATE/probe-plan.json
node scripts/model-probe.ts analyze /PRIVATE/probe-plan.json /PRIVATE/probe-rows.json /PRIVATE/probe-trust.json /PRIVATE/probe-report.json
```

Replace `/PRIVATE` with an operator-owned directory outside this repository;
directory mode is 0700 and JSON file mode 0600. Inputs must be ordinary files,
without symlinks or hardlinks. Outputs are exclusively created and cannot replace
earlier reports. Rejection returns exit 2 with a redacted reason. A valid blocked
analysis also returns exit 2, preserving its report. No command calls a provider,
runs a candidate, modifies a runtime lock or reserves funds.

The input shape is `ProbePlanInputSchema` in
[`model-probe.ts`](../workers/evaluator/model-probe.ts). Use all 20 development
task metadata rows from the accepted manifest. Each model entry and the policy
must refer to independently accepted inputs; a digest or `executionAuthorized:
false` plan cannot authorize spending. The existing private smoke operator still
requires its own current account, controls, tokenizer, budget and runtime proofs.
The smoke phase allocation and remaining project ledger apply even when a draft
probe reservation fits the overall $25 ceiling. An unaffordable probe remains
blocked; do not silently reduce its task grid after observing results.

For each planned episode, retain one `ProbeResultSchema` observation, including
setup failure, unsuccessful repair and unresolved verification. The baseline
procedure is bound in each row. Record actual provider request/operation IDs,
full start-to-finish elapsed time, aggregate tokens/CPU/cost including setup and
retries, finalized bundle and independent adjudication references. Completed
correctness observations need an inference request, a candidate bundle and an
independent adjudication. The operator must review provider origin and accounting
before accepting the row digest. This offline analyzer cannot authenticate those
claims. The trust file contains the accepted `planDigest`,
`acceptedResultDigests` and `acceptedModelProofDigests`.

Analysis keeps eight tasks per model as the denominator and includes the measured
cost of failed episodes. A recommendation requires every planned row, current
accepted model proofs, accepted actual observations, complete billing, measured
CPU, matched allowances, sufficient correct tasks and zero false approvals for
the selected model. Any missing or untrusted observation suppresses selection
globally, since dropping an incomplete candidate cannot establish which model is
cheapest. Rank suitable models by total measured USD, then correct-task count,
then total elapsed time and finally model ID. Failed candidates remain in the
report. The result is a descriptive development recommendation, never evidence
of general superiority or competition readiness.

After access is available, freeze the real candidate list, threshold, policy and
affordable allocation before running this probe. Use the existing guarded smoke
execution and protected adjudication paths; bind and review their actual output
before analysis. Updating `runtime-lock.json` remains a separate explicit local
configuration action based on those accepted observations.
