# PatchProof — agent-ready competition PRD

**Target:** Nebius × NVIDIA Global AI Hackathon, Coding and Agentic Engineering track  
**Version:** 0.1 • **Research date:** September 25, 2026, America/Los_Angeles  
**Decision:** CONDITIONAL GO for a bounded baseline experiment; full-build decision follows measured results.  
**Deliverable status:** Research and specification only. No implementation, benchmark, account setup, registration, deployment or submission has been performed.  
**Working title:** PatchProof. Naming/trademark availability has not been checked.

## 0. Decision in one page

Build a narrowly scoped software-maintenance agent that returns a patch **and a replayable record of why that patch satisfies the maintainer’s requirements**. Its differentiator is not generating code, running tests, branching agents or claiming to “prove correctness.” It is a coherent workflow connecting explicit requirements, independently controlled checks, repair attempts, cost and reviewer evidence.

**Proposed demo:** A maintainer requests a behavioral fix while preserving the existing API and exception behavior. A candidate passes the issue’s normal tests but violates a stated compatibility requirement. PatchProof displays that failure, uses the feedback to repair the candidate, and exports the final diff alongside reproducible evidence. Nothing is automatically merged.

**Competitive hypothesis, not a result:** Under the same model and total inference budget, constraint-aware repair plus controlled exploration can deliver more independently accepted patches than a strong ordinary repair loop, while making the evidence faster for a human to review. A visually polished evidence view turns that measurable difference into a legible product demonstration.

Proceed only after the pilot supports that hypothesis. A clean negative result is a reason to simplify or stop the competition investment, not to conceal the baseline. The project should remain useful for the lab even without a prize.

### Why this event, rather than the largest advertised prize?

My assessment is that this is a bounded product-engineering attempt aligned with Andrew’s experience in review, agent infrastructure and operational evidence. It does not require assuming that a newly designed reasoning system will immediately reach a major research leaderboard. This is an assessment of tractability, **not** a numerical estimate of winning.

## 1. Event grounding and entry boundaries

### Verified event facts

The event is listed as online. Submission closes **October 30, 2026, 10:00 a.m. PDT**, also 10:00 a.m. America/Los_Angeles. Overall cash awards are $20,000, $10,000 and $6,000; this track awards one Jetson Orin Nano. This is primarily a **cash-prize opportunity**, not a DGX/H200 giveaway. A qualifying product uses Nebius and an NVIDIA open-source model. The submission includes a working product, public licensed source, description, demonstration and platform feedback. [S01]

### Rule digest — recheck the linked source before entry

Rules permit eligible adults, teams and organizations; New York is not listed as excluded. Sponsor/judge conflicts and other restrictions still apply. No entry payment is required. Existing projects need significant new work; third-party licenses and ownership matter. Software entry and cash fulfillment are remote; IRL city awards are excluded from this plan. The four judging criteria are equally weighted, with implementation first in tie-breaking. Public YouTube video: keep below three minutes. Judges need free project access through **December 15, 2026**. One project cannot collect both an overall and track award. AI-assisted development is not explicitly resolved by a dedicated clause in the inspected rules. Noncash shipping details are less explicit than cash delivery. [S02]

**Owner-review blockers:** Confirm personal eligibility, rights to contributed code, use of development agents, and any conflicting affiliations before entry. Do not interpret this PRD as legal/work-authorization clearance. No employer code, confidential research, private customer data or pre-existing private project is assumed available. No maximum team size was established; plan for Andrew with a small development-agent pool, not fictitious human teammates.

**Scope restriction:** Submit software only. Do not add uncommon physical hardware or seek an IRL award. Confirm remote shipment before relying on the Jetson as the reason to enter. The cash route is the verified remote target.

## 2. Competitive research: what is known and what is not

The event page displayed 11,971 participants, but its gallery was not published. That is a registration count, **not** the number of submitted teams, serious competitors or eligible projects. No current entrant architecture can honestly be inferred from it. No sufficiently comparable official past-winner implementation was verified in this research; past winners are not used as evidence for the strategy. [S03]

These are **existing-solution comparisons**, not claims that these projects have entered this hackathon:

| Existing work | Verified capability | Consequence for our design | Reuse decision |
|---|---|---|---|
| mini-SWE-agent | A small coding-agent loop, v2 migration notice, multiple environments; repository identifies MIT licensing. [S04] | A shell-based agent already exists. Use a strong simple loop as the baseline rather than handicapping the comparison. | Preferred baseline. Pin exact commit and preserve notices before incorporating code. |
| OpenHands Software Agent SDK | Python/TypeScript/REST interfaces and ephemeral agent workspaces; this SDK’s license is MIT. [S05][S06] | Workspace isolation and an agent SDK are not original contributions. Building an entire substitute platform would waste effort. | Adjacent comparator; optional adapter after MVP. Do not adopt its full product stack by default. |
| Aider | Automatically runs linting/testing and can attempt fixes after failures. [S07] | “An agent that runs tests” is inadequate differentiation. | Behavior comparator; benchmark only after checking its current license/configuration and reproducing setup. |
| SWE-Gate | Separates functional success from review-constraint compliance. Authors report 221 constraint failures among 644 functionally successful repairs. [S08] | The underlying problem has published evidence, but is not novel. Our opportunity is an effective, usable repair-and-evidence workflow. | Research basis. Its repository offers evaluation assets, but this review did not establish redistribution permission. Keep it optional. [S09] |
| Nebius Sandboxes | Provider documents beta branching/checkpoints, OCI support and execution metrics. [S11] | Branching is already a platform feature. Use it meaningfully rather than presenting it as our invention. | Sponsor runtime, subject to access, price and integration preflight. |

**Unverified:** No comparison above was executed. Provider isolation claims were not independently tested. Repository recency, stars and headline benchmark results are not evidence that our chosen models or hardware will reproduce those results.

### Strategies considered

| Strategy | Assessment | Decision |
|---|---|---|
| General coding-agent dashboard | Too much existing functionality to replicate; difficult to show a narrow, measured improvement. | Reject as the core entry. |
| Private general-purpose assistant | Broad integrations and uncertain user-value validation would consume the available effort. | Defer, not inherently a bad product. |
| Constraint-aware maintenance with reviewer evidence | Bounded failure mode; straightforward matched-model experiment; naturally supports an understandable live demonstration. | Select, conditional on pilot. |

**Novelty boundary:** Claim a specific implementation, evaluation and user experience. Do not claim the first constraint-aware agent, the first sandboxed repair system, guaranteed correctness, absence of competitors, or a verified advantage before measurement.

## 3. User, problem and product contract

**Initial user:** A maintainer evaluating agent-produced changes to a small library or service. The user wants the behavior fixed without silently breaking compatible callers or established conventions.

**Job:** “Given this known maintenance task and these acceptance requirements, show me a reviewable change and trustworthy evidence about which requirements were tested.”

**MVP inputs:** A curated repository snapshot, task statement, explicit acceptance requirements, public development tests, edit allowlist, and resource budget. Public demo accepts only curated task IDs, not arbitrary URLs, repositories, shell commands or uploads.

**MVP outputs:** A patch, requirements-to-checks table, candidate history, independent evaluation outcome, measured runtime/token accounting, and a downloadable replay bundle. Status is one of `verified_for_declared_checks`, `needs_review`, `failed`, or `infrastructure_error`. Never display an unqualified “safe,” “secure,” or “proved correct” badge.

### Required user flow

1. Select a fixture task and inspect its requirements.
2. See an estimated resource allowance; actual execution stays disabled without authorized resources.
3. Run a repair attempt and observe events, not simulated progress.
4. Inspect why a candidate was accepted or rejected.
5. Compare the final patch with its baseline under the same budget.
6. Export evidence and leave merge approval to a human.

### MVP and non-goals

**Must have:** One Python maintenance workflow, one verified NVIDIA model, one sponsor sandbox adapter, deterministic orchestration, fixed acceptance checks, one baseline, a small honest evaluation suite, artifact export and a polished three-screen interface.

**Stretch only after gates:** A second NVIDIA model for cost-sensitive routing, additional language support, optional OpenHands adapter, richer trace navigation. Each addition must preserve the matched-budget comparison.

**Explicitly out:** General autonomous coding platform, vulnerability discovery/exploitation, scanning external targets, automatic GitHub writes, autonomous merges, personal-data ingestion, distributed training, multi-tenant production service, custom foundation-model training and extra sponsor integrations merely to collect a bonus.

## 4. Judging-to-evidence map

The criterion names come from the event overview. The feature mapping and success gates below are our design choices, not organizer scoring promises. [S01]

| Criterion | Concrete evidence we will build | Failure to avoid |
|---|---|---|
| Technological implementation | Actual NVIDIA inference calls, real sandbox branch/replay, independently evaluated diffs, trace IDs and robust cancellation. | Decorative sponsor logo, fake execution, or a workflow that only works in a screenshot. |
| Design | Select task → inspect constraints → review patch/evidence, with readable failures and one-click export. | A raw terminal log masquerading as a product. |
| Potential impact | Matched-budget correct-patch yield plus timed reviewer tasks on both successes and failures. | Invented users, testimonials or unsupported time-saved claims. |
| Quality of idea | Clearly illustrate the difference between passing visible tests and meeting the stated maintenance contract. | Pretending ordinary testing or existing research is new. |

The demo should make the failure mode understandable in its first 30 seconds. A simple before/after story is preferable to a long architecture explanation.

## 5. Architecture and integration choices

```text
Browser: task picker / run comparison / evidence detail
    ↓ typed API + server-sent events
Coordinator: policy, budgets, run state, event journal
    ├── NVIDIA model adapter → Nebius Token Factory
    ├── sandbox adapter → candidate workspaces on Nebius
    ├── acceptance-check runner → fresh, independently controlled workspace
    └── artifact store → hashes, diff, checks, cost ledger, replay manifest

Separate evaluation process → sealed final-test tasks and oracle checks
```

### Implementation preference

Use a TypeScript workspace for web UI, API contracts and coordinator. A small Python worker handles the baseline and sponsor sandbox SDK if that is the shortest tested integration. This is a monorepo, not a requirement to force every dependency into one language. Prefer SQLite plus a content-addressed local artifact directory for the single-user prototype; no Redis/Kubernetes dependency for MVP.

```text
apps/web/                 three-screen UI
apps/api/                 typed endpoints, event stream, artifact download
packages/contracts/       schemas shared by API and UI
packages/orchestrator/    state machine, budgets, selection policy
workers/repair/           baseline and model/sandbox integration
workers/evaluator/        independent final-test runner
fixtures/development/     visible practice tasks and tests
fixtures/calibration/     threshold-setting tasks
private-eval/             separate checkout; never mounted into repair worker
scripts/                  doctor, evaluate, reproduce, export, verify
research/                 source ledger, decisions, exact dependency snapshots
```

### Model and runtime selection

Nebius documents the inference base URL `https://api.tokenfactory.nebius.com/v1/`. Its official guides describe Contree integration and research environments. [S10][S12] These are integration starting points, not evidence that Andrew has credentials, credits, the sandbox entitlement or a specific model available.

Before implementation depends on a model, the integration agent must create `runtime-lock.json`: exact accessible NVIDIA model identifier, endpoint, context/tool-output behavior, license/model-card links, SDK versions, image digest, architecture, actual billing unit/rates and verification timestamp. Candidate family: NVIDIA Nemotron, chosen from the account’s current supported catalog. Do not invent an API model string or assume a marketing family name is an endpoint ID.

Use one model for all primary comparisons. The selection probe uses eight development tasks and records correctness, latency and cost. Choose the cheapest verified candidate that supports the task, not automatically the newest model. No paid probe without authorized spend or confirmed usable credits.

Local DGX Spark use is optional for development orchestration and offline experiments. No local model-speed claim is made. Verify architecture and container support; do not treat an x86 image as natively runnable on the Spark. The sponsor-backed competition run must remain a real supported execution path.

### Internal interfaces to implement

These are our proposed interfaces, not claimed SDK signatures:

```typescript
type TerminalStatus =
  | "verified_for_declared_checks" | "needs_review"
  | "failed" | "infrastructure_error";

interface RunSpec {
  taskId: string;
  repoDigest: string;
  policyDigest: string;
  variant: "baseline" | "checks_only" | "patchproof";
  inferenceCallLimit: number;
  inputTokenLimit: number;
  outputTokenLimit: number;
  wallTimeLimitSeconds: number;
  sandboxCpuSecondsLimit: number;
  maxApprovedSpendUsd: number;
  seed: number;
}

interface EvidenceManifest {
  runId: string;
  sourceDigest: string;
  patchDigest: string | null;
  modelLockDigest: string;
  policyDigest: string;
  checks: Array<{id: string; status: "pass" | "fail" | "error";
    logDigest: string; requirementId: string}>;
  terminalStatus: TerminalStatus;
  replayCommand: string;
  measuredCostUsd: number | null;
  costIsEstimate: boolean;
}
```

API contract: `GET /tasks`, `POST /runs`, `GET /runs/:id`, `GET /runs/:id/events`, `POST /runs/:id/cancel`, `GET /runs/:id/evidence`. `POST /runs` accepts only known task IDs and an idempotency key. Return a typed authorization/budget error rather than silently using an alternative provider. Artifact download is read-only.

### State machine and test independence

`queued → preflight → baseline_capture → repair → check → export → terminal`.

A run may branch only within one fixed total budget. At most three candidate branches, with early exit when appropriate; the baseline receives the same total inference allowance. A separate runner applies each diff to a clean snapshot and runs frozen acceptance checks. Patch workers cannot rewrite the policy, tests, evaluator, baseline outputs or manifest publisher. Checks unavailable or flaky produce `needs_review`, not a pass.

There are two different layers: runtime checks derived from the explicit maintenance contract, and sealed evaluation tests used only to measure generalization. The runtime never receives sealed-test feedback. “Independent” means separated artifacts and permissions; it does not mean infallible or mathematically independent model reasoning.

## 6. Functional requirements and acceptance tests

| ID | Requirement | Acceptance test |
|---|---|---|
| F01 | Immutable task snapshot and policy | Changing a snapshot or policy after run creation causes a digest mismatch and blocked execution. |
| F02 | Real sponsor integration | An authorized smoke run records actual model ID and sandbox operation IDs; mock mode remains visibly labeled and cannot export a competition-ready status. |
| F03 | Matched resource budgets | Coordinator accounts for every branch and retry; all variants stop at the same approved aggregate cap. |
| F04 | Constrained editing | Attempts to change evaluator paths, dependency policy or protected tests fail; violations are recorded. |
| F05 | Independently evaluated patch | Fresh workspace reproduces declared test results from exported diff; copied or fabricated logs cannot change the verdict. |
| F06 | Requirements coverage | Every executable check points to a requirement; untested requirements remain visibly unverified. |
| F07 | Candidate explanation | UI shows a rejected candidate and its actual failing check without inventing hidden model reasoning. |
| F08 | Cancellation and restart | Cancel reaches all live jobs, journals partial work and reconciles final cost; no orphan loops after restart. |
| F09 | Honest error states | Rate-limit, timeout, missing key, setup error and flaky test remain distinguishable from code failure. |
| F10 | Evidence export | Download includes diff, policy hash, image/model lock, commands, log hashes, cost ledger and reproducible verdict summary. |
| F11 | Review workflow | Reviewer can inspect and export but cannot accidentally merge or publish to another repository. |
| F12 | Controlled public demo | Only curated publishable tasks; no arbitrary user code/URL ingestion, no secrets in browser, output or exported logs. |

**Security posture:** Use isolated execution for agent-edited code. Keep model credentials in the control plane, not candidate workspaces. Deny public runtime access to the homelab, cloud metadata and internal network. Use capability-limited file access, fixed resource quotas, redaction and short-lived jobs. Verify provider controls rather than assuming containers or an SDK prove isolation. A public endpoint’s processing location is not fixed; submit only data we can publish. [S16]

## 7. Evaluation protocol and continuation gates

All numbers here are proposed experiment settings and goals. **No scores have been measured.** Do not change gates after seeing held-out results without labeling a new exploratory experiment.

### Dataset design

Create 60 small, owned maintenance tasks across 12 independently authored fixture repositories, five tasks per repository. Separate by repository: 20 development tasks, 10 calibration tasks, 30 sealed final-test tasks. Include compatibility, serialization semantics, ordering, numerical edge cases and error behavior; avoid security exploitation scenarios. Have a separate author/reviewer validate the oracle and task intent. A language model’s answer alone is not the ground truth.

Use repository-disjoint splits to reduce leakage between similar tasks. The agent fixing tasks receives their requirements and ordinary development tests, not gold patches, sealed checks or filenames revealing the solution. Keep sealed materials in a different workspace with no agent/network access during runs. Publish the evaluation suite with results after freezing the experiment; disclose that public exposure affects future contamination claims.

SWE-Gate is an optional external validation source only after its code/data/repository rights are verified. Do not copy it into a public entry simply because it is downloadable. Owned fixtures make the MVP independent of that unresolved license question.

### Baselines and ablations

- **B0 — ordinary repair:** pinned mini-SWE-agent or equivalent minimal loop, same model, all stated requirements and visible tests, fixed total budget.
- **B1 — checks only:** B0 plus the same frozen runtime acceptance checks and feedback, without candidate branching or evidence-selection policy.
- **P — PatchProof:** same model, instructions, total tokens/calls and time allowance; frozen checks plus controlled branches and full evidence workflow.

A fair comparison does not hide requirements from B0, give P extra oracle feedback or let P spend three times as much because it has three branches. Report each budget dimension separately; matched token budgets need not imply matched wall time or provider cost.

Pilot: 12 development tasks × 2 variants (B0/P) × 3 repetitions = 72 episodes. Final: 30 sealed tasks × 3 variants × 3 repetitions = 270 episodes. Limit each episode to 24 inference calls and 15 minutes by default; calibrate token/output caps once on development data. Avoid claiming determinism merely because a seed is supplied.

### Metrics

1. **Independent correct-patch yield:** fraction passing sealed functional and contract checks, including failed runs in the denominator.
2. **False approvals:** runtime-approved patches that fail sealed checks; show numerator and denominator, not only a percentage.
3. **Coverage and abstention:** how many tasks remain unverified, and why. Rejecting everything is not success.
4. **Cost and elapsed time per independently correct patch:** include setup, failed runs and retries; disclose incomplete billing data.
5. **Reviewer task time and accuracy:** randomized patch-review tasks, blinded labels where possible. Small samples are preliminary usability evidence, not enterprise ROI.

Analyze differences with paired, repository-clustered resampling. Do not treat three repeated runs of one task as three independent tasks. Report uncertainty, individual failures and excluded infrastructure-invalid cases with a preregistered exclusion reason. Genuine setup failures remain an operational metric even when excluded from a semantic-correctness calculation.

### Gates

| Gate | Proposed continuation condition | Stop/simplify condition |
|---|---|---|
| G0: access and rights | Confirm an authorized model/sandbox path, ownership, eligibility questions and an explicit resource allowance. | No account entitlement, unresolved prohibited reuse or unapproved spending. Continue only local no-cost design/testing. |
| G1: integration | Two curated tasks replay end to end; actual sponsor traces and budget/cancel controls work. | Need to fake sponsor calls or results; adapter cannot enforce separation. |
| G2: pilot | P repairs at least two additional tasks compared with B0 when results are aggregated by task, without increasing false approvals or exceeding matched budgets. | No meaningful signal: improve task/check quality or narrow scope before building polish. The pilot is not statistical proof. |
| G3: final evidence | Target ≥10 percentage-point correct-patch improvement over the strongest baseline; report intervals and task counts. No inflated claim if uncertainty spans no benefit. | P is indistinguishable from B1: simplify to the checks-only workflow and describe the result honestly; do not claim branching helps. |
| G4: presentation | Three reproducible successful runs plus an honest failure/abstention case; reviewers understand the evidence view without coaching. | Only a scripted happy path works; do not call it a robust agent. |

Strict invariant: zero observed successful evaluator/test tampering in the controlled negative tests. This is a release gate for the prototype, not proof of resistance to every attacker or environment.

## 8. Resource plan and calendar

**Planning assumptions:** One experienced owner with development agents; existing local compute; no new hardware purchase; no training run required. Proposed implementation effort is 45–70 engineering-hours plus 6–10 owner-review hours. These are scope estimates, not elapsed-time promises or guaranteed agent throughput.

The pilot permits up to 1,728 model calls; the final experiment up to 6,480, before calibration and demonstration. At the 15-minute episode cap, the pilot is at most 18 episode-hours and the final at most 67.5 episode-hours. CPU allocation, setup and inference waiting affect actual billed compute. Required local training GPU-hours: zero. Provider GPU-hours cannot be inferred from token billing.

**Default authorized new spend is $0.** A suggested planning envelope, subject to approval, is $50 for the pilot, $150 for wider evaluation and $100 for demo hosting/operations through judging. Those figures are proposed ceilings, not verified prices or a claim that all runs fit them. Price the actual model and sandbox before estimating affordability.

Use:
`cost = input_tokens × input_rate + output_tokens × output_rate + sandbox_billing + hosting/storage/network`.

Normalize rate units explicitly. Log prepaid credits separately from cash cost. Never assume credits are granted, redeemable on the needed service, or valid through judging. The pilot must measure cost per episode and project remaining spend before G2 authorizes expansion. If funds are insufficient, reduce scope/sample size prospectively and weaken the claim accordingly; do not silently omit expensive failures.

### Proposed calendar (Pacific time)

| Window | Output |
|---|---|
| Sep 26–28 | Eligibility/access/license preflight; baseline and two working fixtures; G0/G1. |
| Sep 29–Oct 2 | Frozen pilot, comparison and G2 decision. |
| Oct 3–10 | Repair/check workflow, controlled branching, evidence export and UI. |
| Oct 11–17 | Calibrate on development data; freeze evaluation protocol and versions. |
| Oct 18–22 | Sealed evaluation and reviewer exercises; honest G3 decision. |
| Oct 23–26 | Polish, failures, replay reliability and demonstration recording. |
| Oct 27 | Proposed feature freeze; new work only for critical defects. |
| Oct 28–29 | Independent clean install, rule recheck, artifact audit and owner submission review. |
| Oct 30 | Official submission deadline shown in §1; submit with margin, not in the final minute. |
| After submission | Operate the frozen demo through the judging-access date in §1; budget and ownership remain assigned. |

These dates are an implementation plan, not scheduled actions created by this package. Replan explicitly when starting later; reduce stretch scope before cutting the final validation window.

## 9. Agent work breakdown

`tasks.json` provides the machine-readable task graph. Four logical roles are enough: coordinator, runtime engineer, evaluation engineer and product/UI engineer. These are parallel work roles, not extra human entrants. The evaluator must not expose sealed data to the repair agent.

- T01: official-rule/access/license preflight and source snapshots.
- T02: contracts, repository skeleton and mock-only test harness.
- T03: fixture authoring, oracle validation and sealed split.
- T04: real Nebius model/sandbox adapter and resource controls.
- T05: matched-model baseline runner.
- T06: acceptance checks and protected evaluator boundary.
- T07: bounded candidate branching and patch selection.
- T08: evidence journal, reproducibility and export.
- T09: pilot and continuation decision.
- T10: task/comparison/evidence UI.
- T11: sealed evaluation and ablations.
- T12: end-to-end reliability, cancellation and public-demo controls.
- T13: submission assets and timed demonstration.
- T14: independent audit and owner handoff.

Do not parallelize before shared schemas and task policies are frozen. One integrator owns interface changes. Agents submit changes with tests and evidence; a dependent task stays blocked until acceptance checks pass. No task is “done” because code was generated.

## 10. Demonstration and submission

### Proposed 170-second demo

**0–20s:** State the user’s maintenance request and the compatibility requirement. Show the task and real starting tests.

**20–50s:** Show a recorded genuine candidate that fixes the obvious symptom but fails one declared contract check. Identify it as a recorded run if not live.

**50–100s:** Run or replay the repair progression. Show actual model/sandbox trace references, unchanged acceptance policy and bounded resource use. A replay is evidence of a prior run, not a fabricated live inference.

**100–135s:** Inspect the final diff, coverage table and replay bundle. Show at least one unverified requirement or meaningful limitation where relevant.

**135–155s:** Display the actual matched-budget evaluation with denominators and error bars/intervals. A missing experiment means this section is omitted, not replaced by a target score.

**155–170s:** Explain the narrow user benefit and remaining limitations; point to the working software and source.

### Owner-approved submission packet

Prepare a short problem statement, architecture summary, originality/reuse statement, license notices, clean setup steps, actual experiment report, source ledger and runtime lock. Produce public-ready assets and a testing guide from real output. Include a brief platform-feedback note grounded in observed integration behavior, not invented complaints or praise.

A human checks the official submission fields, agrees to terms, supplies accounts/keys, handles identity paperwork, approves any publishing, and performs submission. This PRD does not authorize those actions. Agent-assisted development must be accurately disclosed when requested. No fabricated team members or attribution.

## 11. Risks and explicit unknowns

| Risk | Mitigation / stop rule |
|---|---|
| Existing entrants may already solve the same problem | Recheck the public gallery when available; compare actual capabilities and revise the claim. Current competitor visibility is incomplete. |
| Only the tests improve, not the agent | B1 isolates that effect. Simplify rather than falsely credit branching or multiple agents. |
| Benchmark contamination or self-serving tasks | Repository-disjoint sealed set, independent oracle review, published manifest, transparent fixture limitations. |
| Missing license for external evaluation assets | Do not vendor; use owned fixtures until rights are established. |
| Account/model/sandbox availability | G0 smoke-test and pin; no automatic paid fallback. |
| Test tampering or fabricated evidence | Independent evaluator, immutable manifest, fresh replay and negative tests. |
| Demo infrastructure cost after submission | Explicit owner and operating allowance; maintain access, not just a one-day recording. |
| Too much UI/platform work | Keep exactly three screens and one core task family until the pilot passes. |
| Prize attractiveness distorted by headline pool | Treat the cash award as uncertain; the small track device alone does not justify a major research investment. |
| “Verified” interpreted as a universal guarantee | Qualify every outcome by the declared checks and show coverage limitations. |

## 12. Definition of ready and done

**Ready for a pilot:** G0/G1 passed, baseline version pinned, fixture oracle reviewed, authorized budget recorded and tests reproducible. **Ready for substantial build:** G2 passed with a written decision. **Ready for submission:** release tests pass; results are real and reproducible; unresolved eligibility/publishing blockers are closed by the owner; demo and documentation match the shipped version; ongoing access is funded/assigned.

A negative feasibility result is a valid deliverable. A prize cannot be promised. The objective is to replace “this sounds like a winning idea” with a tested reason to invest further.

## Primary sources

All sources below were inspected on September 25, 2026 (Pacific). The specification, target thresholds, architecture and budget ceilings are original proposals, not facts attributed to these sources. No runtime/API/benchmark result is claimed.

- **S01 — [Nebius × NVIDIA event overview](https://nebiusglobalaihackathon.devpost.com/).** Official event: current deadline, prizes, track, required product and submission assets.
- **S02 — [Nebius × NVIDIA official rules](https://nebiusglobalaihackathon.devpost.com/rules).** Official rules: eligibility, permitted reuse, scoring, delivery, availability through judging. Recheck before entry.
- **S03 — [Current event project gallery](https://nebiusglobalaihackathon.devpost.com/project-gallery).** Gallery explicitly unpublished when inspected; actual entrant projects could not be compared.
- **S04 — [mini-SWE-agent repository](https://github.com/SWE-agent/mini-swe-agent).** Minimal coding-agent baseline, v2 notice, pluggable environments, MIT license indication. Not executed in this research.
- **S05 — [OpenHands Software Agent SDK](https://github.com/OpenHands/software-agent-sdk).** Adjacent coding-agent infrastructure with Python, TypeScript and REST interfaces and ephemeral workspaces.
- **S06 — [OpenHands SDK license](https://github.com/OpenHands/software-agent-sdk/blob/main/LICENSE).** MIT license for this SDK specifically; not a blanket licensing statement about every OpenHands product.
- **S07 — [Aider linting/testing documentation](https://aider.chat/docs/usage/lint-test.html).** Existing automatic lint/test/fix behavior; establishes that running tests is not novel.
- **S08 — [SWE-Gate paper, September 3, 2026](https://arxiv.org/html/2609.04167v1).** Primary research on functional versus review-constraint correctness. Authors’ results, not reproduced here.
- **S09 — [SWE-Gate replication repository](https://github.com/DeepSoftwareAnalytics/SWE-Gate).** Released evaluation assets; redistribution license not established in this review. Do not vendor until checked.
- **S10 — [Nebius Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart).** Documented inference base URL and authentication. Account access/model availability not tested.
- **S11 — [Nebius Sandboxes overview](https://docs.tokenfactory.nebius.com/sandboxes/overview).** Beta sandbox service, branching/checkpoints, OCI images, metrics, async operations. Provider claims, not independent isolation testing.
- **S12 — [Nebius Sandboxes for SWE agents](https://docs.tokenfactory.nebius.com/sandboxes/swe-agents).** Documented Contree integration and available research environment catalog.
- **S16 — [Nebius public serverless endpoint documentation](https://docs.tokenfactory.nebius.com/public-serverless).** Public endpoints have no fixed processing-region guarantee. Use only publishable fixture data.

[S01]: https://nebiusglobalaihackathon.devpost.com/ "Nebius × NVIDIA event overview"
[S02]: https://nebiusglobalaihackathon.devpost.com/rules "Nebius × NVIDIA official rules"
[S03]: https://nebiusglobalaihackathon.devpost.com/project-gallery "Current event project gallery"
[S04]: https://github.com/SWE-agent/mini-swe-agent "mini-SWE-agent repository"
[S05]: https://github.com/OpenHands/software-agent-sdk "OpenHands Software Agent SDK"
[S06]: https://github.com/OpenHands/software-agent-sdk/blob/main/LICENSE "OpenHands SDK license"
[S07]: https://aider.chat/docs/usage/lint-test.html "Aider linting/testing documentation"
[S08]: https://arxiv.org/html/2609.04167v1 "SWE-Gate paper, September 3, 2026"
[S09]: https://github.com/DeepSoftwareAnalytics/SWE-Gate "SWE-Gate replication repository"
[S10]: https://docs.tokenfactory.nebius.com/quickstart "Nebius Token Factory quickstart"
[S11]: https://docs.tokenfactory.nebius.com/sandboxes/overview "Nebius Sandboxes overview"
[S12]: https://docs.tokenfactory.nebius.com/sandboxes/swe-agents "Nebius Sandboxes for SWE agents"
[S13]: https://arcprize.org/competitions/2026 "ARC Prize 2026 official overview"
[S14]: https://arxiv.org/abs/2607.15439 "ARC-AGI-3 world-model ablation study"
[S15]: https://arxiv.org/abs/2512.24156 "ARC-AGI-3 graph-exploration paper"
[S16]: https://docs.tokenfactory.nebius.com/public-serverless "Nebius public serverless endpoint documentation"
