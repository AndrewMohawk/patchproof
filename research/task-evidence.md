# Task evidence — local preparation

## Scope and references

- `4bf1335`: original seven-file non-ZIP package read; all six entries in
  `SHA256SUMS.txt` validated before task-state edits. ZIP excluded.
- `811ef1a`: T01 official-source recheck, private repository and owner decisions,
  exact $25 aggregate approval, unknown provider fields preserved.
- Mock implementation reference: the commit containing this record and
  `research/contracts-v1-lock.json`; later validation records identify its SHA.
- Changed implementation paths: `packages/contracts/`, `packages/mock/`,
  `apps/api/`, `apps/web/`, `scripts/`, `tests/`, workspace/Make configuration and
  exact npm lockfile. `tasks.json` records dependency blocks, not completed gates.

## Executed verification

| Command/check | Exit/result | Evidence |
|---|---|---|
| `sha256sum -c SHA256SUMS.txt` before tracker edits | 0, six passed | Original commit `4bf1335`. |
| Official event/rules/gallery and provider documentation retrieval | Public docs fetched; SDK/SWE-agent pages timed out | `research/constraints.md`, `research/sources.json`. |
| `npm ci --ignore-scripts --no-audit --no-fund` | See final validation record | Exact `package-lock.json`; no lifecycle scripts. |
| `make test` | 0, 17 tests passed before final freeze | Type checks, HTTP/SSE, budgets, idempotency, mock labels, integrity, cancellation and protected local export paths. |
| `npm run test:browser` | 0 | `.local/verification/browser.json`, browser download in `artifacts/`; screenshots `/tmp/patchproof-contract-{desktop,mobile}.png`. |
| Browser-downloaded bundle → `make reproduce RUN=<id> DIGEST=<digest>` | 0, integrity only | No inference/check execution or authenticated provenance claimed. |
| `make doctor` | 0, diagnostics complete with G0 blocked | Unknown entitlement/model/rates listed; this exit is not gate approval. |
| `make smoke`, `make pilot`, `make evaluate`, `make release-check` | Direct CLI exit 2 tested; gate-report-only | Zero provider calls and zero experiment episodes. |

Final command logs and exit codes are retained in `research/verification/`.
Generated mock IDs/digests are not benchmark results. No token, performance or
provider-cost measurements exist beyond zero calls in this mock implementation.

## Found and corrected during review/testing

- Throwing event subscribers interrupted completion: isolated listener failures
  and added explicit mock-error finalization.
- Individually valid fields admitted contradictory evidence: added task/spec,
  event/run, requirement/coverage and terminal-state cross-validation.
- Sparse arrays collided in canonical digests: non-JSON sparse values rejected.
- Browser exports initially required an unavailable CLI reference: now supports
  downloaded-file verification and reports the actual integrity basis.
- Export writes could overwrite files or follow symlinks: exclusive immutable
  writes, no-follow file opens and checked directory components. A failing test
  caught trailing-slash directory checks; fixed and regression passed.
- First Host-header test used `fetch`, which normalized that header: changed to
  the raw HTTP client and confirmed server-side rejection.
- First browser check found a missing favicon and mobile overflow in the digest
  instructions: fixed; automated browser rerun reports no errors/overflow.
- Default port 4317 was occupied: no existing service was touched; moved the
  default to loopback 43171 and added a clear bind-error message.

## External interfaces and remaining work

Node 25.5.0 / npm 11.8.0; Zod 4.1.12; TypeScript 5.9.3; Node types 25.5.0;
Playwright 1.58.2 / observed Chromium 145.0.7632.6. See exact package integrity
values in the lockfile and licenses in `THIRD_PARTY_NOTICES.md`.

Nebius SDK/model/image/endpoint account verification: **NOT RUN**, awaiting
project access. Provider docs are unversioned; exact inspected URLs and failures
are in the source ledger. Real smoke, baseline, pilot, sealed evaluation,
protected evaluator execution, cost reconciliation and production release
checks: **NOT RUN** because their dependencies remain blocked. T03/T04 were not
started; no sealed authoring or candidate agent workspace exists yet.
