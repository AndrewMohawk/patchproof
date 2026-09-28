# Independent public interface verification

Passed against **https://patchproof.andrewmohawk.xyz/** on 2026-09-28, 03:13:54–03:14:05 UTC, after the coordinator deployed release `b32499432acd3a2b6b8f04658554b2e2984b4bdc`.

Executed:

```sh
node research/interface-redesign/verification/verify-public-ui.mjs b32499432acd3a2b6b8f04658554b2e2984b4bdc
```

Exit code: **0**. No paid calls or write requests were made. The browser permitted GET requests to the public origin only; zero blocked requests were observed.

The public HTML, JavaScript, and stylesheet were checked byte for byte against the redesigned source before browser interaction. The browser then verified the actual 20 examples and seven saved runs at 1440×900, 390×844, and 320×844.

- Generate patch was visible without scrolling for all 20 mobile examples. The lowest action bottom was 541.1px on the 844px-high 390px screen and 554.7px on the 320px screen.
- Desktop search returned five worksheet examples, selection worked, and clearing the search restored all 20.
- Runs showed the same seven records as the real API, including unsuccessful runs.
- Saved successful runs opened Patch; saved failed runs opened Checks. Every result tab, keyboard ArrowRight navigation, and visible 3px focus styling worked.
- Example selection carried into comparison from both successful and failed run views.
- All 18 recorded layouts had document width equal to viewport width. Long JSON results and diffs stayed inside their own display region.
- The two evidence files downloaded through the UI matched the direct public downloads byte for byte and retained the correct live run IDs.
- No page or console errors were observed.

The inspected success was `08087e0a-f5d9-4c55-b4b6-7666bc8e016c`; the failure was `5b356c42-8848-4e78-bce7-94800f63eebf`. These were existing records. This interface verification did not start another repair or claim a new model result.

Evidence: [machine-readable receipt](public-browser-receipt.json) and [public screenshots](public-screenshots/).
