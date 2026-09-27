# AGENTS.md — PatchProof build instructions

Read `nebius-patchproof-PRD.md`, then `tasks.json`. This is a proposed build package, not evidence that the product already exists. All tasks begin `planned`. Do not invent existing code, benchmark results, access credentials or a deployed demo.

## Objective

Deliver a small maintenance agent whose patch decisions are supported by independent executable checks and reproducible reviewer evidence. Compete through demonstrated correctness and usability, not invented novelty or hidden benchmark leakage.

## First execution sequence

1. Complete T01: recheck current rules and obtain owner decisions for eligibility, rights and externally billed resources. Reading public sources and local preparation are permitted; spending, publishing and entry are not implied.
2. Freeze shared contracts in T02. Create `decisions.md`, `runtime-lock.json`, and `budget.json`, recording unknown fields honestly.
3. Start T03 and T04 in parallel only after their dependency gates. The evaluation author works in a separate workspace from repair agents.
4. Run a tiny real integration after account/resource authorization. Preserve operation IDs and real costs. Without access, stop at labeled mocks and emit a blocker report.
5. Implement baseline before product differentiation. Run T09 before polishing the full interface or increasing the experiment budget.

## Build roles

- **Coordinator:** Own dependencies, requirement changes, budgets and go/no-go decisions. Merge only tested changes.
- **Runtime engineer:** Own sandbox/model adapters, protected editing, cancellation, error classification and evidence capture.
- **Evaluation engineer:** Own oracle quality, splits, matched comparisons and analysis. Never share sealed checks, gold patches or final-set feedback with the repair agent.
- **Product engineer:** Own a usable task picker, comparison and evidence view; build against fixtures until the pilot justifies integration.

## Non-negotiable execution rules

- New paid spending defaults to zero. Owner-approved resource ceilings are explicit machine-readable configuration, not inferred from this document’s planning envelope. Credits must be verified for service, amount and expiry.
- Never register, accept terms, submit, expose a public service, send messages, publish source/video, push to third-party repos or auto-merge without separate owner authorization.
- Work only on this project and authorized benign maintenance fixtures. Do not repurpose the harness for third-party intrusion, exploit generation or public-target vulnerability discovery.
- Credentials remain outside agent workspaces and logs. No secrets from home directories, private repos, cloud metadata or the homelab network.
- A public demo accepts curated task IDs only. Do not implement arbitrary remote-code execution as an unauthenticated feature.
- Pin dependencies and preserve licenses. Treat downloadable code/data without an established license as blocked for copying/redistribution.
- Protect all evaluator files, check definitions, policy and report-publishing code from the candidate repair agent.
- Do not give the proposed system more total tokens, calls, oracle feedback or retries than its baseline. Record all setup failures and unsuccessful runs.
- Do not invent model IDs or sandbox SDK methods. Discover them from the official documentation/account; wrap them behind the internal interfaces in the PRD.
- Mock mode is explicitly marked at API, UI and export layers. It cannot produce “competition-ready” evidence.
- Report externally observed actions and results, not hidden model chain-of-thought. A concise decision summary is sufficient.
- If you change the evaluation protocol after looking at final results, label the new run exploratory and preserve the original report.

## Evidence required with each task

Commit/reference, changed files, executed test command, exit code, artifact paths, remaining failures and exact source/version of external interfaces. For unrun tests say `NOT RUN` with a reason. Record blocked dependencies and never silently skip them.

## Release commands to implement

These commands are target interfaces, not commands claimed to work in the current package:

```sh
make doctor                 # no paid calls; reports architecture/dependencies/entitlements
make test                   # deterministic unit/contract tests, mock provider
make smoke                  # explicit authorized real-provider smoke run
make pilot                  # fixed pilot; refuses unapproved budget
make evaluate               # sealed experiment; protected evaluator workspace
make reproduce RUN=<id>     # verify exported evidence against immutable inputs
make export RUN=<id>        # patch + manifests + logs + coverage + costs
make release-check          # no secrets, honest demo, provenance and docs
```

If an implementation is partial, say precisely which gate failed. Do not substitute a polished video for a running system. If the measurements do not support differentiation, recommend a smaller check-only product or a competition pass, with evidence.
