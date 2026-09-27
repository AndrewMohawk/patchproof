# Provisional public-preview product integration review

This review used only the explicitly authorized 30-task public preview, pinned by manifest digest `sha256:6d46f5a9bcc7f418e5284f1c622a405cc81887f55d6c03241149bd2d81bc3138`. The preview remained provisional while the separate all-60 validation continued. No private evaluation parent or sibling paths were read. No candidate, Python fixture, Docker, provider, inference or replay execution occurred.

The metadata loader admitted all 30 tasks: 20 development, 10 calibration, six repositories. All entrypoints exist in their flat, single-file snapshots and fit current path/size constraints. Exactly `stable-unique-01` remains supported by the scripted mock. Source review found no required proposal or wording adjustment. Its new visible checks expose the first proposal's order and nested-value failures; this can change the baseline outcome. An actual comparison must report observed verdicts, without assuming B0 fails or PatchProof has an advantage.

The GET-only rendering pass used actual app assets from queued commit `0b605f26453409e474587270fdf9292a7ec4aaf3` (which includes browser-verifier commit `8503e811fbf5f9f8b82a3c3561d11fcfcc01fbb7`). It checked all 30 exact titles, descriptions and requirement texts; only the demo's launch/comparison controls were enabled. Keyboard selection, desktop and 390px mobile rendering passed with no horizontal overflow. There were five GET requests, zero mutations and zero browser console/page errors. Both screenshots were visually inspected. This inert HTTP fixture instantiated no application coordinator or execution factory.

The initial MCP new-tab request failed because its shared browser profile was already in use. `browser-mcp-attempt.json` preserves that original failure. No shared browser was changed. One isolated local Playwright process then passed. The task-owned browser and loopback metadata server were closed afterward.

Stable-unique declares five visible and four public acceptance cases. Under the current repeat-observations-v1 protocol, each complete original/candidate batch runs those nine cases twice in fresh per-case containers and combines them into nine result rows: 18 operations if complete. Both repetitions share the same batch allowance, at most 30 seconds and bounded by remaining aggregate episode time. Original plus two candidates would require 54 operations per approach; original plus the maximum three candidates would require 72. These are source-derived layouts, not executed counts. The 120-second episode, three-call and token limits remain unchanged. Local CPU is unmeasured, so its configured allowance is not a verified cumulative limit.

The reused demo ID has new title, requirements, source and policy. The separately verified `0b605f` historical-context fix must accompany the handoff so older runs retain their saved task context. This review did not repeat the historical-context regression or assert that old evidence changed.

Executed in `/tmp/patchproof-public-preview-review`, a separate worktree at `0b605f`:

| Command/action | Result |
| --- | --- |
| `node .local/public-preview-review/inspect.mjs` | Exit 0; manifest and 30 raw hashes, loader/schema/projection pass |
| MCP `browser_tabs({action:"new"})` | Preserved profile-in-use error; fallback used |
| `node .local/public-preview-review/render-server.mjs` | Ephemeral loopback metadata only; owned server later exited 0 |
| `node .local/public-preview-review/browser.mjs` | Exit 0; all 30 task render/control checks pass |
| `node .local/public-preview-review/finalize.mjs` | Exit 0; all preview hashes unchanged after review |
| Typecheck / full suite / runtime integration | NOT RUN: no product code edits; runtime integration remains deferred until corpus freeze |

`review.json` binds the source and artifact hashes. The `.mjs` files here are exact snapshots of the scratch helpers. They ran from `.local/public-preview-review/`, and their relative imports assume that location; to reproduce this metadata-only check, copy this directory there in the pinned checkout. `inspect.mjs` also requires the exact authorized preview path to remain available. The stored `catalogue.json` contains only public task metadata. The metadata server rejects every non-GET request regardless of the UI capability flags being tested.

No product code, fixture, limit or requirement was changed. This receipt is suitable for product integration planning; it is not final-corpus, provider, performance, differentiation or competition-readiness evidence.
