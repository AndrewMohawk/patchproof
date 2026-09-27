# Historical run context

Terminal runs now display the task statement saved in their evidence, bound to the exact recorded run. A current catalogue entry with the same task ID cannot replace that title or requirement text. Coverage counts use recorded rows. Missing or mismatched saved context remains explicit, with a GET-only retry; current-running context requires matching source and policy pins.

The actual Chromium metadata regression passed all 10 controls. It served the real app assets against invented old/new bundles sharing one task ID, with different titles and requirement counts. It covered pending/error/mismatched context, exact historical downloads, comparison labels, mobile/reload behavior and active-policy bindings. All 47 requests were GET; no SSE, mutations, browser script errors, containers, candidate execution or external provider calls occurred in the passing attempt. A missing-evidence negative control intentionally produced one HTTP 404 console message.

The first attempt exposed an initialization race: an addressed active run could load before capability metadata, opening two event-stream GETs despite streaming being disabled. The original output and source hashes are preserved in `browser-first-failure.json`; `metadata-ready-guard.patch` records the exact corrective source transition. The final pass and source-bound report are retained separately. Typecheck, JavaScript syntax check and diff checks passed.

`desktop.png` and `mobile.png` were visually inspected. They show the archived title, archived requirement text and recorded denominator. The independent reviewer reported no source blocker; its source-only scope and optional unexecuted cases are listed in `review.json`. Actual historical API preflight and final rendered handoff are coordinator-owned evidence, separate from this synthetic browser proof.

To rerun this bounded check when the host is available:

```sh
node scripts/verify-historical-context.ts
```

The command starts only a temporary loopback metadata server and one browser, then closes both. It does not load a runtime factory or any evaluation corpus.
