# Merged UI: actual local regression

Source `92a2baf7a6c5282fb376090e40985cb1f1fac21a` passed the actual browser workflow with a scripted mock model and real local Docker checks. The three exported bundles each have a successful fresh replay. The baseline's first replay timed out and remains recorded as a failed attempt; its one unchanged retry passed.

Only the public `stable-unique-01` fixture was executed. No provider calls, account access, paid spend, sealed evaluation or public deployment occurred. These observations demonstrate the workflow and declared checks, not model performance or competition readiness.

| Command / observation | Result |
| --- | --- |
| `node scripts/verify-browser.ts` | Exit 0; first attempt; 14 rendered checks; six screenshots |
| `node scripts/product-cli.ts reproduce 32443ba1-bd6a-4f8a-82ac-188e001f5cac` | First attempt exit 2, timeout at 31.027 s; unchanged retry exit 0 at 20.511 s |
| `node scripts/product-cli.ts reproduce 75bcd0f3-a817-4f42-98bb-9fe7d5a667d4` | Exit 0, reproduced, 21.622 s |
| `node scripts/product-cli.ts reproduce e2310d8f-1fd5-45ba-addf-6268e0a06a0f` | Exit 0, reproduced, 20.220 s |
| Bundle integrity and current operational-lock checks | Three pass; executable source unchanged |
| Exact recorded operation cleanup, owned process/listener | 144 operations report confirmed cleanup; none of those container names remain; PID 1864504 absent and port 33697 closed |

The browser comparison retained the expected scripted outcomes: baseline `failed`, checks-only and PatchProof `verified_for_declared_checks`. It exercised task requirements, unsupported-task disabling, streamed progress, matched limits, rejected and accepted candidates, readable logs/diff, download, reload, keyboard focus and all three views at 390 px width. All six screenshots were visually inspected. No browser responses were intercepted.

The helper used a dedicated temporary state directory and ephemeral loopback port, exported all runs, then closed its own app and removed its state. The existing service on 43171 was not signaled or replaced. The helper's original browser report is unchanged; its `/tmp` screenshot references have durable copies in `screenshots/`. Exact exported public bundles are in `evidence/`; the CLI replay consumed identical bytes from this checkout's ignored `artifacts/` directory.

The first baseline replay completed eleven observations before its final observation hit the existing 30-second checker allowance. All reported cleanup was confirmed. Root reported an overlapping full test suite, but contention was not measured and is only a possible explanation. The single retry waited for that suite to finish and changed no command, source, bundle or allowance. The first-attempt replay batch therefore retains exit 1 and two successes out of three; the later baseline success does not erase the failure.

`verification.json` is the concise receipt. `source-and-environment.json` pins source files and tool versions; `evidence-integrity.json` records run/bundle identities and all 96 original operation IDs. The two cleanup receipts additionally preserve all replay lifecycle identities. `SHA256SUMS` binds every file in this evidence directory except itself. Logs, original exports, timings and the failed first attempt are retained. The pinned local image was `sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51`; CPU accounting remains unmeasured/null.

The preferred shared Playwright MCP browser was already occupied. The existing helper used its own pinned local Chromium process; no other browser was stopped. No full suite was rerun in this review, and no implementation or fixture changes were made.
