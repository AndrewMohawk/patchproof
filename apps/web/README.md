# PatchProof web interface

The API serves these dependency-free static files on its loopback listener. Start the application from the repository root with `npm run dev`, then open the printed URL.

The three views are hash-addressable:

- `#tasks`: curated maintenance tasks, requirements, approved project ceiling and actual per-run limits.
- `#compare`: ordinary repair, checks-only and PatchProof runs. A matched-context label requires equal source, policy, runtime lock, mode and every resource limit.
- `#evidence/<run-id>`: persisted run state, candidate decisions, source diff, check outputs, requirement coverage, accounting and downloadable evidence.

The current interface creates only mock-model runs for tasks marked `mockSupported` by the API. Other curated tasks display their requirements, say they require a connected model, and have disabled launch controls. Runtime checks use the configured local container checker. Scripted proposals are labeled in the header, allowance, comparison, accounting and exported backend record; they do not establish model quality or sponsor integration. Terminal views say “Recorded run.” Active views display actual coordinator events and fall back to polling the same run when an event stream disconnects.

All dynamic text is assigned through DOM `textContent`. There are no external fonts, CDNs, inline scripts, arbitrary code inputs, repository URL inputs, uploads, merge actions or publishing controls.

## Browser verification

Run against an actual application listener, with its local checker available:

```sh
node apps/web/verify-browser.ts http://127.0.0.1:43171
```

This command starts one comparison (three local mock-model runs), checks real recorded container results and downloads the evidence bundle. It exercises the task selection, comparison, candidate rejection and repair, diff/log inspection, export, addressed-run reload, all three mobile layouts and keyboard focus. It checks browser errors and same-origin traffic, and saves the report to `.local/verification/product-browser.json` plus screenshots under `/tmp/patchproof-*.png`.

If an observer fails while its runs are still executing, pass their three IDs as the optional second argument after the URL, separated by commas. This resumes observation of those exact records without launching replacements. The report identifies resumed observation explicitly.

The browser test does not establish sponsor access, paid inference, benchmark superiority, fresh evidence replay or a public deployment. Those require their own runtime and evaluation checks. It intentionally fails if the demonstration task cannot produce a recorded rejection followed by an accepted candidate, or if the container checker returns an infrastructure error.
