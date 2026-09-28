# Runtime and patch compatibility review

Reviewed 2026-09-28 at commit `759986520789ac1a664c791c88d2a89d7a556de6`, including the patch/evidence/diff changes from `b66372310a77132387ce7d0a9004523ea4d9648d`. The scoped source files were unchanged from this commit during review.

**Result: no material blocker found within this bounded review.** This is a source and local replay review, not approval of a benchmark claim or proof that a live repair succeeds.

## Findings

- Contextual patches preserve line order, original/proposed line numbers, CRLF, Unicode, empty files, and final-newline changes. Both the LCS path and bounded-memory fallback replayed to the exact proposed files. Separated hunk boundaries were exercised across gaps of 0–14 lines.
- Evidence compatibility accepts only the exact frozen legacy representation or current contextual representation derived from the bound original/proposed sources. Source omissions, edits outside the allowlist, diff/source mismatches, and artifact/bundle digest mismatches remain rejected. Stored and downloaded patch bytes are not rewritten. Replay validates the bundle before applying its recorded patch.
- The display matcher promotes lines to context only when text and final-newline state agree. Independent assertions checked every displayed line against its original/proposed source position and each hunk's declared counts. Rendering uses DOM text content for source, paths, and headings. The new static asset has an explicit allowlist entry and is covered by the operational source lock.
- The API binds the new discovery digest and requires the exact Super model, FP4 quantization, 262144-token context, and catalog rate strings. Its runtime lock records the upstream card separately from the unverified hosted weights/tokenizer revision. Deployment preparation binds source and pricing digests together.
- The shared reservation is 250000 micro-USD. Three full-context input allowances plus 12000 output tokens cost at most an estimated $0.2467296 at the recorded $0.30/$0.90 per million rates; per-request integer rounding remains below the hold. Availability, reservation, and accounting use the shared values. Unknown invoiced charges retain the full reservation; the existing overall $25 and $5 smoke ceilings remain in force.
- The stronger repair instruction preserves the allowlist and evaluator boundary. It requests actual source changes and preservation of unrelated code, comments, and license notices. No new model tool access or transport retries were introduced.

## Validation executed in this review

| Check | Result |
| --- | --- |
| `node --test tests/patch-diff.test.ts` | Exit 0; 6 passed, 0 failed; includes 40 varied replay cases and legacy/current evidence verification |
| Independent `node --input-type=module` assertion probe | Exit 0; 22 benign scenarios, 44 legacy/current Git replays, 6903 displayed source rows validated |
| Scoped `git diff --quiet 7599865 -- ...` | Exit 0; reviewed runtime, patch, evidence, API, provider, and diff files match the commit |

The independent probe receipt is `/tmp/patchproof-v3-diff-review-receipt.json`, timestamp `2026-09-28T05:44:04.281Z`. It exercises empty source, insertion/deletion, missing final newline, repeated lines, Unicode/CRLF, hunk separation, and the 1500-line fallback. Review output changed only this Markdown file; no application, fixture, deployment, or configuration changes were made.

## Limits

Docker checks, paid inference, the complete test suite, browser/video review, and fresh replay of historical public bundles were **NOT RUN** here because the real trial was active and those checks were outside this bounded task. The coordinator separately reported 695 full tests, 33 UI/provider tests, and 17 live-runtime tests passing; those counts were not independently rerun in this review. An existing eight-bundle historical compatibility receipt was inspected at `verification/history-compat.json`.

Very large replacement blocks deliberately fall back to a lossless nonminimal diff, so identical interior lines can remain displayed as replacements beyond the LCS size cap. This does not affect the reviewed curated fixtures. Requested thinking-disable behavior is recorded, but this review does not independently establish hosted-model reasoning behavior, hosted weights identity, sponsor Sandboxes access, or final invoiced cost.

The reviewer previously implemented the Super constants/accounting changes in `live-local.ts` and their focused tests; that subset is a self-review. The patch generator, diff presentation, evidence compatibility, API binding, and deployment-helper review were separate from their implementation. No author reference source, gold patch, sealed evaluation material, credentials, or private operator configuration was accessed for this review.
