# Interface redesign: visual and interaction review

Reviewed the live public interface on 2026-09-28 using GET-only browser access and the current `apps/web/index.html`, `app.js`, and `style.css`. No paid runs were started. The Playwright MCP profile was occupied; isolated local Playwright provided screenshots and interaction inspection.

## Observed problems

- At 1440px width, the initial task action sits below 1080px. The hero, slogan, decorative `{✓}`, repeated mode explanation, full requirements, and infrastructure allowance all precede the action.
- The first 360px are presentation copy rather than the actual tool. The numbered navigation and three-step footer make routine controls read like an AI-generated landing page.
- Every example is a tall padded card. Technical titles compete with repeated availability labels. There is no search, category grouping, or concise way to reach one of twenty examples.
- The result page is a long document of separate rounded panels. The selected patch, failed checks, candidate choice, requirements, journal, accounting, and provenance compete rather than form a review sequence.
- The run select contains long title + approach + recorded mode + timestamp labels. A person cannot quickly compare recent outcomes, and failed setup attempts look as visually important as the patch currently being reviewed.
- The current failed result describes a candidate as both `rejected` and `selected`. It is technically possible to preserve a failed candidate for review, but this wording makes the tool appear contradictory.
- The stylesheet relies heavily on 10–12px text, low-contrast pale green surfaces, repeated outlined badges, and small all-cap captions. This is readable only with unnecessary effort, especially on mobile.

## Visual system

Build a compact, neutral maintenance workbench. The interface should resemble a practical source review tool, with clear alignment, readable code, and a small number of meaningful colors.

- White primary canvas; very light cool-gray rail/header surfaces; near-black body text; slate secondary text. One saturated blue accent for actions, links, and focus. Reserve green, red, and amber for observed check outcomes and warning states.
- System sans-serif for controls and prose; system monospace for filenames, diff lines, concise counts, and identifiers. No remote font dependency.
- Body copy 15px with 1.5 line height; labels 13px minimum; main page title 26px; selected task title 24px. Code 13px desktop and at least 12px on small screens. Avoid marketing-scale headings.
- Header 64px desktop, with plain PatchProof wordmark, two clear destinations (`Examples`, `Runs`), and a secondary `Watch demo` link. No numbered navigation, logo check badge, slogan, or decorative illustration.
- Use rules and aligned rows instead of nested cards. Small 5–6px radii on controls only; do not wrap every concept in a pale panel. Dense enough to keep the task and action visible, but not terminal-sized text.
- Restrained focus style: 3px visible blue outline, 2px offset. Keep 44px interactive targets, semantic headings, keyboard access, visible active states, and reduced-motion handling.

## Example selection

Desktop: 280–300px rail on the left, task workspace taking the rest of the page. The rail has a labeled search input and grouped example rows. Each row shows a plain title and optional short group name; highlight selection with one colored edge or background, not a checkbox badge. The user-selected example must survive view changes.

Workspace: task title, concise task description, a single obvious `Generate patch` action, and `View latest result` when a recorded run exists. Show the latest result's actual status; do not choose a successful run silently. A small line beside the action gives the $0.10 maximum and live/model mode. Put full requirements below the action and model, token, CPU, project ceiling, runtime identity, and execution limits in one expandable details area. The exact requirement text stays accessible and unchanged.

Mobile: replace the tall permanent list with a compact selected-example control that opens the searchable list, or a native select plus search disclosure. The selected task, primary action, and latest result should appear within the first screen. Opening the chooser must not lose selection or result context.

## Run review

Result heading: task title, run time, mode, and exact scoped status. Show selected-candidate pass/fail/unverified counts immediately. If there is a failure, show the first failing behavior and expected versus observed values above all tabs. This prevents a code tab from concealing the reason a patch cannot be accepted.

Then use four clear views:

1. **Patch:** selected candidate switcher, model proposal labeled as a proposal, filename, and readable diff. Show all attempts through a compact selector and label the retained failed patch `Kept for review` rather than contradictorily `rejected · selected`.
2. **Checks:** requirements and their result rows, with failed/unverified rows first. Raw logs are disclosures inside the relevant check, not a wall of primary copy. Starting-source checks remain accessible here.
3. **Activity:** chronological observed events, with concise human labels and raw IDs in details. Preserve every event; do not present internal phase names as the normal interface language.
4. **Run details:** recorded model/backend, usage and estimated cost, run limits, source/policy/runtime identifiers, and replay command. Preserve unknown values as unknown.

Success defaults to Patch. Failure may default to Checks, but the visible summary remains sufficient to understand the outcome either way. The Download report action is in the run header. Comparison is a secondary link from a task or run and retains honest equality/mismatch details. It should use aligned approach rows/table, not three pricing-plan-style cards.

## Run history

`Runs` opens a real history list/table: task, approach, outcome, start time, duration, and a review action. On mobile each becomes a compact stacked row. Allow task/status filtering and show failures, cancellations, errors, and mocks explicitly. Selecting a row opens its stable result URL. Do not replace the history with a long select menu.

## Reviewer discussion and resolved choices

- The flow reviewer proposed Examples/Runs primary navigation, with comparisons subordinate to actual repair review. The visual review agrees; experimental arms are not the first decision a new user should make.
- The copy reviewer proposed `Generate patch` rather than a branded `Run PatchProof →`. Agreed: state the action and omit ornamental arrows.
- I initially suggested a successful saved example as the introduction. The flow reviewer correctly challenged the selection bias. Resolved: offer the most recent recorded result for the selected task with its real status, including failures.
- Tabs reduce scrolling, but the flow reviewer noted the risk of hiding failed checks. Resolved: a permanent result summary gives exact check counts and a concrete failed behavior before the tab area; failed runs can initially select Checks.
- The copy reviewer warned against exposing the raw model summary as a factual diagnosis. Resolved: label it as the model proposal, while observed check outcomes determine the result status.

## Acceptance evidence to collect

- Desktop 1440×900: selected example, action, latest result, and useful task context fit before vertical scrolling; no oversized hero or repeated protocol panels.
- Mobile 390px and 320px: no horizontal document overflow, all controls fit, example selection does not push the action down a long list, and code scrolls inside its own region.
- Keyboard: example search/selection, primary action, run history, tabs, disclosures, and download link have visible focus and sensible order.
- Render successful, failed, in-progress, unavailable, mock, and archive states with honest distinct labels. A failed retained candidate must not read like an accepted repair.
- Review actual public FQDN after deployment, including saved live evidence and video link. Tests alone do not establish a friendly interface.

Review artifacts before redesign: `/tmp/patchproof-before-desktop.png` and `/tmp/patchproof-before-evidence.png`. These are local inspection captures, not new product demo evidence.
