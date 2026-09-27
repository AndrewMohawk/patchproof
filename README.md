# PatchProof

A maintenance-agent build in progress: patches linked to independently controlled
checks and reproducible reviewer evidence. Read [the PRD](nebius-patchproof-PRD.md)
and [the task graph](tasks.json) for the full acceptance criteria.

**Current state: local mock contract harness; G0 blocked on provider access.**
No repair agent, model benchmark, provider entitlement, paid run, deployment or
competition entry has been completed. The owner approved **$25 total** ($5 smoke,
$20 pilot); spending so far is **$0**. See [decisions](decisions.md),
[owner approvals](owner-decisions.json) and [budget](budget.json).

Repository creation and ongoing commits are authorized by the project owner.
The repository starts private; event entry, public publication and paid resources
remain separate decisions. Do not place credentials or sealed evaluation data
in this repository.

## Run the local preparation

Use Node **25.5.0** and npm **11.8.0**, as pinned by `.node-version` and
`package.json`. All dependencies are locked; lifecycle install scripts are disabled.

```sh
npm ci
make doctor
make test
make dev
```

Open `http://127.0.0.1:43171`. Set `PATCHPROOF_PORT` if the port is occupied.
The server binds only to loopback. The small page is a contract inspector, not
the planned three-screen product. Select the non-executable fixture, create a
mock record, inspect real handler events, then download its explicitly labeled
mock evidence. Every requirement remains unverified. No user code executes.

Browser check (requires the pinned Playwright Chromium browser):

```sh
npx playwright install chromium
npm run test:browser
```

Only the schema fixture exists. It is not one of the required 60 evaluation
tasks. All three variant names are accepted for contract testing; none implements
the eventual repair policy. This harness does not measure baseline performance.

## Command status

| Command | Implemented behavior now |
|---|---|
| `make doctor` | Local config/runtime diagnostics, explicit gate blockers; no provider calls. |
| `make test` | Type checking and deterministic mock/contract/HTTP/file-integrity tests. |
| `npm run test:browser` | Browser task-to-download flow, mobile layout and integrity check. |
| `make smoke` | Reports G0/T04 blockers and exits 2; real adapter not implemented. |
| `make pilot` | Reports blocked; zero of 72 episodes executed. |
| `make evaluate` | Reports blocked; zero of 270 episodes executed. |
| `make export RUN=<id>` | Exports a CLI-created mock record; immutable files, no patch. |
| `make reproduce RUN=<id>` | Checks mock bundle integrity; **does not execute tests or reproduce a patch verdict**. |
| `make release-check` | Reports missing release dependencies and exits 2; not a completed release audit. |

To exercise CLI mock export:

```sh
npm run mock-run
# Use the run ID printed by that command:
make export RUN=<id>
make reproduce RUN=<id>
```

For a browser download, save it as `artifacts/<id>.json`, then run the reproduce
command shown on the page. The optional `DIGEST=sha256:...` compares against the
digest shown before downloading. Without an original local record or a supplied
digest, the check only confirms internal consistency. Digests alone do not prove
authenticity, and mocks cannot become competition evidence.

## Current boundaries and next gate

- Original planning package is preserved in commit `4bf1335`. `tasks.json` is a
  living tracker; the original `SHA256SUMS.txt` applies to the initial package.
- Owner eligibility, contribution rights and AI-assisted development confirmed.
- Provider credentials must be provisioned outside this checkout and candidate
  workspaces. No keys are read from home directories or inferred from homelab services.
- Account entitlements, exact NVIDIA model, rates, SDK/image and runtime controls
  remain unknown in [runtime-lock.json](runtime-lock.json).
- T03/T04 have not started; T02's local preparation does not bypass T01/G0.
- Mock HTTP runs live in memory. Restart loses them. Downloads and CLI mock
  records persist locally in ignored directories. Production restart/cost
  reconciliation and evaluator isolation have not been implemented.
- Full UI work follows the real pilot gate. Publishing, license selection,
  hosting and submission remain owner decisions. The private code is currently
  `UNLICENSED`; this is not yet a public-source submission package.

See [task evidence](research/task-evidence.md) and
[the current blocker report](research/blockers.md) for verification and remaining work.
