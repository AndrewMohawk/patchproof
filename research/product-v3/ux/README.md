# Repair briefing and How it works — implementation evidence

The repair chooser now displays the exact public source files beside public input/output goals. A file tab identifies edit permission; a function selector jumps to the called function. Expected examples are explicitly labeled as goals, not observations. Python values preserve strings, None and booleans correctly. Mobile keeps the Generate patch control and its cost label visible. The full original requirements remain accessible.

The new `/#how-it-works` page explains task selection, model generation, fixed checks, retries and retained attempts, outcome meanings, review tabs, evidence downloads/replay, matched comparisons, and the current runtime. Navigation is available at desktop and mobile widths.

Changed implementation: `apps/web/app.js`, `apps/web/index.html`, `apps/web/style.css`. Tests: `tests/live-product-ui.test.ts`. The coordinator owns the separate diff component and API source projection.

Validation:

- `node --test tests/live-product-ui.test.ts`: exit 0, 12 tests passed. The fixtures in this test are invented UI transport metadata, not model performance evidence.
- `npm run typecheck`: exit 0.
- `node --test --test-name-pattern='repair briefing' tests/live-product-ui.test.ts`: exit 0 after final labels and function navigation.
- `node research/product-v3/ux/verify-briefing.mjs <loopback-preview> /tmp/patchproof-briefing-v3`: exit 0. Six v3 public tasks present during this preview had source compared line-for-line against their API projections, and their example counts checked. No model calls or writes. Read-only local preview used mock labels and disabled execution. This is not deployment proof.
- Desktop 1440px and mobile 390px/320px task and guide views: no document overflow or JavaScript errors. Screenshots: `/tmp/patchproof-briefing-v3/briefing-{1440,390,320}.png`, `/tmp/patchproof-briefing-v3/how-it-works-{1440,390,320}.png`. Receipt: `preview-receipt.json`.

The first full UI test run caught a mobile action below the viewport and a missing action name in the intro. Both were corrected, and the suite passed. Initial isolated testing also caught the new diff asset missing from the synthetic HTTP fixture; its route and existing 404 handler were fixed.

Browser: pinned Playwright 1.58.2 with Chromium. No new external dependency. The read-only verification script can be rerun on the authorized public FQDN after deployment; its output reports the actual mode and catalogue count observed then.
