# Public deployment: read-only browser check

Passed on 2026-09-28 against `https://patchproof.andrewmohawk.xyz`, source `88f6de2ef1e94a8d18676316994115560766358c`. The deployed HTML, JavaScript and CSS hashes match that checkout. [Receipt](receipt.json) and [complete browser report](attempt-01/report.json) retain the command, source/runtime pins, observations and screenshot hashes.

The isolated Chromium browser passed 15 checks at 1440, 390 and 320 pixels. It rendered all 20 curated tasks, selected different reading/worksheet task IDs, displayed the real Nemotron model with local Docker checks and the $0.10 per-run limit, and retained keyboard focus without horizontal overflow. New-run controls were enabled during this pass; they were never clicked. The earlier health/history read occurred while a coordinator-owned run was active and availability was correctly paused.

The actual public run `1ddd6b8b-98ce-45aa-bc11-d9947f41cd4c` finished **Needs review**, with no selected patch. Its evidence is visible on desktop and mobile. It records three inference calls, a **$0.00027324 estimate**, and unmeasured sandbox CPU. This is evidence of the deployed review workflow, not a claim that this repair passed or that provider billing was reconciled. The original public evidence bytes are retained in [observed-evidence.json](attempt-01/observed-evidence.json), bundle `sha256:90899d407976880a7a5516a734561e1060682ceb39d74ca3b5a13e085f512011`.

- [Desktop task picker](attempt-01/desktop-1440-tasks.png)
- [390 px reading task](attempt-01/mobile-390-chapter-task.png)
- [320 px worksheet task](attempt-01/mobile-320-worksheet-task.png)
- [Desktop comparison](attempt-01/desktop-1440-comparison.png)
- [Desktop evidence](attempt-01/desktop-1440-evidence.png)
- [390 px evidence](attempt-01/mobile-390-evidence.png)
- [320 px evidence](attempt-01/mobile-320-evidence.png)

All browser traffic was same-origin GET. There were zero console, page, network or HTTP errors and zero attempted writes. Finite browser responses were forwarded from the real site with redirects disabled; no responses were invented. The observer did not start/cancel/replay any run, access credentials or private evaluation data, or call a provider. Its own browser was closed; deployed services were unchanged. The video link was inspected, but this pass did not request or verify the video. No event stream was active during this terminal-run observation.

Executed once, exit 0:

```sh
node research/verification/20260928-live-deployment/read-only-browser/verify-read-only.mjs attempt-01
```

The [original command output](attempt-01.log), snapshots and screenshots remain unchanged. No failed browser attempt occurred in this verification.
