# Deployed mobile fixes and failed configuration story

Reviewed the public FQDN on 2026-09-28 at 05:43 UTC, coordinator release `759986520789ac1a664c791c88d2a89d7a556de6`. The browser review was GET-only and blocked other methods. The live pagination repair `d5cbe221-1220-4f55-8e79-36eccfab5b17` was already checking; no work was created or cancelled by this review.

## Result

No release-blocking UI issue was found. The two earlier mobile findings are fixed in the deployed application.

- All 24 story/viewport combinations passed at 1440×1000, 390×844, and 320×844. The selected step was completely visible at every stage of both stories. On the failed decision page, the active label ends at 373.8px in the 390px viewport and 303.6px in the 320px viewport, within the respective step bars.
- On both mobile sizes, the disabled Generate patch control is visible at y763–807. The adjoining message says “A live repair is running” and the View progress link is visible at y814.8–830.8. Clicking it opened the actual running repair. The same API availability reason is present beneath the task introduction. At 320px that longer notice needs scrolling, while the fixed action area supplies the reason immediately.
- The new failed story is bound to configuration run `9d3cd90e-94e2-4787-b294-5caa577b40e1` and bundle `sha256:cda1b49674a48b45d7a4fc66c99a1ffb24ca33db8a2337b289521e6c7b2189fd`. All four stages show the configuration scenario. The full starting source and the required/observed example values match its downloaded evidence.
- Attempt 1 remains the retained proposal: 17 of 22 checks passed and five failed. Attempt 2 records 22 errors and timeout. The decision page explicitly says the five-minute allowance expired before verification completed, calls those results unavailable, and identifies the final Execution error. It does not present timeout as 22 behavioral failures or acceptance.
- The configuration diff includes its file header, 43 additions / 32 deletions, original/proposed gutters, and unchanged context. Code stays inside its local scroll area at narrow widths. The changed report value `service` versus required `service.timeout` is clear in the exact-output cards.
- Story navigation restores the top of the page and focuses its new heading at all three widths. No document overflow, console/page errors, or attempted write requests occurred.
- The public task metadata reports `nvidia/nemotron-3-super-120b-a12b`, real Token Factory inference and local-container checks, three calls, 12,000 output tokens, 600 seconds, and a $0.25 reservation. The failed saved configuration story correctly retains its original Nano model and shorter runtime.

## Visual review

I inspected actual desktop and mobile screenshots of task selection, the configuration bug, diff, exact check results, and final decision. The hierarchy makes the proposed change and the human decision clear. Mobile intentionally shows part of neighboring steps to indicate horizontal navigation; the current step is no longer clipped. Long JSON and code require scrolling, but do not widen the page.

A minor touch-target improvement remains possible: View progress is an inline link about 16px high. It is readable, visible, and functional, so this is not a blocker. The large disabled action immediately above it clearly communicates that a second repair cannot start.

The success story is still the earlier list repair. This review makes no claim that the new Super trial completed successfully, that its replacement success story is published, or that a new video exists.

## Evidence

- `mobile-fixes.mjs`: executed verifier; exit 0.
- `mobile-fixes.json`: passed receipt with deployed asset hashes, exact API limits, screenshot paths, story observations, and navigation measurements.
- `/tmp/patchproof-v3-mobile-fixes/`: viewport and full-page screenshots; large PNGs remain outside the repository.
- `mobile-fixes-initial.json`: preserved first diagnostic pass. It stopped on an overly strict assertion that the whole duplicate introduction notice fit above the mobile action bar. Screenshot inspection confirmed the fixed action message and progress link were visible. The final check measures the required fixed message and records the introduction notice bounds separately.
