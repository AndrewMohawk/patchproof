# Public real-inference demo

The public application uses NVIDIA Nemotron Nano on Nebius Token Factory to generate maintenance patches. Declared checks run twice in fresh local Docker containers; the model cannot edit the checks. The host controller accepts only curated development task IDs. No arbitrary repositories, shell commands, uploads, or automatic merges are exposed.

Execution is separate from the historical scripted mock and the still-unverified Nebius Sandboxes integration. It is an unscored development demonstration, not evidence of a measured advantage or a completed Coding and Agentic Engineering entry. Baseline, checks-only, and PatchProof receive the same three-call, 6,000-output-token, 300-second allowance. Each model request is capped at 2,000 completion tokens with thinking disabled and no transport retry. The current timing policy shares up to 120 seconds per batch across both repetitions, within the unchanged 300-second aggregate deadline. Historical 60-second batches remain replayable under their original policy.

The public app is intended for `https://patchproof.andrewmohawk.xyz/`; the recording is served at `/demo/`. Deployment and actual-run receipts identify the tested source revision. Historical mock recordings remain separate.

## Spending and accounting

The existing owner approval remains $25 total, including a $5 smoke allocation. The sole designated ledger is opened in existing-only mode. Every demo run reserves $0.10; the maximum inference exposure is $0.048627, conservatively counting the entire 262,144-token model context for each of three requests. This is a cost bound, not a tokenizer calibration claim. Rates are the verified account catalog's $0.06/$0.24 per million input/output tokens, with no per-request fee.

Successful closed request inventories can permit another run while retaining the full prior hold. Unknown invoice costs remain null. Usage-priced numbers displayed by the application are explicitly estimates. Transport ambiguity, missing receipts, changed approvals, overrun, or unavailable funds blocks further spending. A run that never dispatches inference is recorded as zero cost. Prices require a fresh review by October 1, 2026; the runtime pauses new work when that verification window ends.

## Hosting and reproducibility

A task-owned systemd user unit runs the trusted controller from a pinned source checkout. A hardened nginx container exposes only fixed API routes and the recording, and proxies to a private Unix socket. The frontend has no Docker socket, provider credential, or published host port. Candidate containers run without networking, capabilities, or writable source and cannot access the credential, ledger, controller, or evaluator workspace. Public cancellation is restricted to the browser session that created the run.

The provider credential and operator configuration remain outside the source checkout. Never put a key in shell arguments, a browser response, an exported bundle, or a video. Request receipts contain digests, model/request identifiers, bounds, and usage; hidden reasoning is not retained.

Each downloadable bundle includes frozen source, patch, requirements, repeated observations, model IDs, event history, and the runtime lock. Replay uses the exact deployed source and pinned Docker image and makes no inference calls. A reproduced declared check is not a proof of general correctness. Sealed final evaluation and sponsor-Sandbox integration remain separate release gates.
