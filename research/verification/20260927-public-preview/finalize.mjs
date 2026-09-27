import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const preview = '/home/andrewmohawk/patchproof-evaluation-v2/public-preview-20260927T142827Z-565123ca-8953-4c77-abb4-0b8b9121ab5d';
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const manifestBytes = await readFile(join(preview, 'preview-manifest.json'));
assert.equal(digest(manifestBytes), 'sha256:6d46f5a9bcc7f418e5284f1c622a405cc81887f55d6c03241149bd2d81bc3138');
const manifest = JSON.parse(manifestBytes);
for (const row of manifest.fixtureFiles) {
  assert.match(row.path, /^fixtures\/(development|calibration)\/[a-z0-9-]+\.json$/);
  assert.equal(digest(await readFile(join(preview, row.path))), row.digest);
}
const metadata = JSON.parse(await readFile(new URL('./metadata-report.json', import.meta.url)));
const browser = JSON.parse(await readFile(new URL('./browser-report.json', import.meta.url)));
const requests = JSON.parse(await readFile(new URL('./requests.json', import.meta.url)));
assert.equal(requests.length, 5); assert.ok(requests.every(r => r.method === 'GET'));
const sourcePaths = ['apps/web/app.js', 'apps/web/verify-browser.ts', 'apps/api/src/application.ts', 'packages/orchestrator/src/fixtures.ts',
  'packages/orchestrator/src/coordinator.ts', 'packages/orchestrator/src/repeated-checks.ts', 'workers/repair/index.ts', 'workers/sandbox/index.ts'];
const sourceDigests = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, digest(await readFile(new URL('../../' + path, import.meta.url)))])));
const artifactNames = ['inspect.mjs','metadata-report.json','metadata.log','catalogue.json','render-server.mjs','server.json','browser.mjs',
  'browser-report.json','browser.log','browser-mcp-attempt.json','requests.json','desktop.png','mobile.png'];
const artifactDigests = Object.fromEntries(await Promise.all(artifactNames.map(async path => [path, digest(await readFile(new URL('./' + path, import.meta.url)))])));
const report = {
  kind: 'public-preview-product-integration-review', reviewedAt: new Date().toISOString(),
  status: 'No blocking integration mismatch found in bounded public metadata/source/render review',
  preview: { directory: preview, manifestDigest: digest(manifestBytes), provisional: true,
    sourceCommit: manifest.sourceCommit, byteRecheckAfterReview: 'all 30 fixture hashes and manifest unchanged' },
  reviewCommit: metadata.clientCommit, sourceDigests, counts: metadata.counts,
  findings: [
    { id: 'catalogue-layout', result: 'compatible', evidence: 'All 30 fixtures admitted by current FixtureSchema/loadFixtures/publicTask. Single flat Python entrypoints exist and are editable; source sizes and names fit current limits.' },
    { id: 'mock-scope', result: 'compatible', evidence: 'Exactly stable-unique-01 is mock-supported, entrypoint/edit path solution.py and function unique remain compatible. Other 29 tasks require connected model; browser verified disabled launch and comparison controls.' },
    { id: 'scripted-correction', result: 'no required change inferred', evidence: 'Source-only: Python list membership preserves first equality-class representative and order, handles recursive JSON equality and numeric bool equality, does not mutate input/nested values, and None raises TypeError. No candidate executed; this is not a passing-run claim.' },
    { id: 'baseline-outcome', result: 'observe actual verdict', evidence: 'Source-only: sorted(set(values)) conflicts with visible first-order and nested-unhashable checks, so baseline can receive visible failure feedback. Sorting is not the sole possible rejection. No fixed B0 failure or product advantage is justified; queued 8503 verifier observes actual outcomes.' },
    { id: 'historical-context', result: 'queued fix required on handoff', evidence: 'Task ID stable-unique-01 is reused with a new title/requirements/source/policy. Queued 0b605 binds terminal context to saved evidence rather than the current catalogue. This browser pass used that commit; historical-context regression is separately recorded in that commit.' },
    { id: 'mock-wording', result: 'no change required', evidence: 'Current summaries accurately identify scripted sorted deduplication and subsequent first-occurrence/input-preservation correction. Existing mock/local-check labels and $0 provider-spend wording remain visible. Do not weaken fixture requirements or manufacture a baseline disadvantage.' },
  ],
  stableUniqueExpectedBatchLayout: {
    proof: 'source-only; actual counts and timing NOT RUN', visibleCases: 5, publicAcceptanceCases: 4, uniqueRowsPerBatch: 9,
    repetitions: 2, freshPerCaseOperationsIfBatchCompletes: 18,
    passOrder: ['visible cases then acceptance cases, first invocation', 'same immutable cases again, second invocation'],
    batchWallSeconds: 'min(30, remaining aggregate episode seconds), shared across both repetitions',
    batches: 'One original-source batch, then one batch per proposed candidate, maximum three candidates',
    conditionalTwoCandidateOperationsPerApproach: 54, maximumCompletedThreeCandidateOperationsPerApproach: 72,
    limitsUnchanged: { wallTimeLimitSeconds: 120, inferenceCallLimit: 3, inputTokenLimit: 24000, outputTokenLimit: 6000, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 0 },
    cpuBoundary: 'Local CPU remains unmeasured; configured allowance is not verified cumulative usage.',
    refs: ['apps/api/src/application.ts:23', 'packages/orchestrator/src/repeated-checks.ts:5', 'packages/orchestrator/src/coordinator.ts:152', 'packages/orchestrator/src/coordinator.ts:183', 'workers/sandbox/index.ts:113']
  },
  verification: {
    metadata: { command: 'node .local/public-preview-review/inspect.mjs', exitCode: 0 },
    browser: { command: 'node .local/public-preview-review/browser.mjs', exitCode: 0, browserVersion: browser.browserVersion, checkedTasks: browser.checkedTasks.length,
      requestCount: requests.length, mutations: 0, errors: [], screenshotsVisuallyInspected: ['desktop.png','mobile.png'] },
    initialBrowserTool: 'MCP new-tab failed due to an already-used shared profile; exact error retained. Shared browser was not changed; isolated local Playwright fallback passed.',
    cleanup: 'Task-owned metadata server exited 0 after SIGTERM; task-owned Chromium closed in finally.',
  },
  notRun: ['Candidate/Python execution', 'Docker', 'Providers/model inference', 'Replay', 'Actual application coordinator', 'All-60 corpus validation', 'Typecheck: no source change made in this review'],
  boundaries: { previewWrites: 0, mainEdits: 0, productSourceEdits: 0, privateEvaluationParentOrSiblingReads: false, paidSpendUsd: 0, receiptCommit: 'Prepared separately after review at parent request' },
  artifactDigests,
};
await writeFile(new URL('./review.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, manifestDigest: report.preview.manifestDigest, counts: report.counts, reviewDigest: digest(Buffer.from(JSON.stringify(report, null, 2) + '\n')) }, null, 2));
