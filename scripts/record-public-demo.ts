import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';
import { ProductRunRequestSchema, type ProductRun } from '../packages/contracts/src/product.ts';
import { TaskIdSchema, VariantSchema } from '../packages/contracts/src/index.ts';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { verifyEvidence } from '../packages/orchestrator/src/evidence.ts';

// This command starts ONE potentially billed live run through the real UI.
// It never retries creation, cancels runs, supplies responses, or edits application code.
const usage = 'node scripts/record-public-demo.ts https://patchproof.andrewmohawk.xyz TASK_ID baseline|checks_only|patchproof /absolute/new-private-output-directory';
const origin = 'https://patchproof.andrewmohawk.xyz';
const root = fileURLToPath(new URL('../', import.meta.url));
const runPath = /^\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/(?:events|evidence))?$/;
const readPaths = new Set(['/', '/app.js', '/style.css', '/favicon.ico', '/healthz', '/tasks', '/runs']);
const variantNames = { baseline: 'Ordinary repair', checks_only: 'Checks only', patchproof: 'PatchProof' };
const signature = (run: ProductRun) => digestJson({ taskId: run.taskId, schemaVersion: run.schemaVersion,
  sourceDigest: run.sourceDigest, policyDigest: run.policyDigest, runtimeLockDigest: run.runtimeLockDigest, mode: run.mode, limits: run.limits });
const timestamp = (ms: number) => new Date(Math.max(0, Math.round(ms))).toISOString().slice(11, 23).replace('.', ',');
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function main() {
  if (process.argv[2] === '--help' && process.argv.length === 3) { console.log(usage); return; }
  assert.equal(process.argv.length, 6, usage);
  assert.equal(process.argv[2], origin, 'Only the explicit approved public origin is supported.');
  const taskId = TaskIdSchema.parse(process.argv[3]), variant = VariantSchema.parse(process.argv[4]);
  const output = process.argv[5]!;
  assert.ok(isAbsolute(output) && resolve(output) === output, 'Output must be an absolute normalized path.');
  assert.equal(await realpath(dirname(output)), dirname(output), 'Output parent must exist without symlinks.');
  await mkdir(output, { mode: 0o700 }); // EEXIST is intentional: never overwrite a previous attempt.
  await chmod(output, 0o700);
  const save = (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const startedAt = new Date().toISOString(), start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  const failures: Array<{ stage: string; message: string; atMs: number }> = [];
  const captions: Array<{ atMs: number; text: string }> = [];
  const observedRequests: Array<{ atMs: number; method: string; url: string; allowed: boolean }> = [];
  const pageErrors: string[] = [], consoleErrors: string[] = [];
  const evidenceSummaries: unknown[] = [];
  let journal = Promise.resolve(), journalFailure: string | null = null;
  const note = (value: unknown) => {
    journal = journal.then(() => appendFile(join(output, 'observations.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 }))
      .catch(error => { journalFailure = message(error); });
  };
  const failure = (stage: string, error: unknown) => {
    const value = { stage, message: message(error), atMs: elapsed() }; failures.push(value); note({ type: 'failure', ...value });
  };
  let videoStartedAtMs = 0, closing = false;
  const caption = (text: string) => captions.push({ atMs: Math.max(0, elapsed() - videoStartedAtMs), text });
  let browser: Browser | undefined, context: BrowserContext | undefined, page: Page | undefined;
  let video: ReturnType<Page['video']> = null, videoPath: string | null = null, browserVersion: string | null = null;
  let allowedPosts = 0, postAtMs: number | null = null, createdRun: ProductRun | null = null;
  let latestRun: ProductRun | null = null, evidenceSaved = false, observerComplete = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const source = { recorderDigest: digestBytes(await readFile(fileURLToPath(import.meta.url))),
    recorderCheckoutCommit: await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root }).then(result => result.stdout.trim()).catch(() => null),
    nodeVersion: process.version, deployedSourceCommit: null };
  await save('attempt.json', { startedAt, origin, taskId, variant, source, potentiallyBilled: true,
    maximumCreateRequests: 1, terminalObservationLimitSeconds: 300, responseSubstitution: false, competitionReady: false });

  const inspectUrl = (value: string) => {
    const url = new URL(value);
    return { url, safe: url.origin === origin && !url.username && !url.password && !url.search,
      label: ['http:', 'https:'].includes(url.protocol) ? url.origin + url.pathname : url.protocol };
  };
  const readApi = async (path: string, timeoutMs = 30_000): Promise<{ value: unknown; text: string; digest: string | null }> => {
    assert.ok(readPaths.has(path) || runPath.test(path), 'GET path is not approved.');
    assert.ok(page && !page.isClosed(), 'Recording page is unavailable.');
    const result = await page.evaluate(async ({ path, timeoutMs }) => {
      const response = await fetch(path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      return { status: response.status, text: await response.text(), digest: response.headers.get('x-patchproof-digest') };
    }, { path, timeoutMs });
    note({ type: 'api_read', path, atMs: elapsed(), ...result });
    assert.equal(result.status, 200, `GET ${path} returned ${result.status}.`);
    return { value: JSON.parse(result.text), text: result.text, digest: result.digest };
  };
  const preserveEvidence = async (run: ProductRun, bytes: Buffer, expectedDigest?: string) => {
    const name = `evidence-${run.id}.json`;
    await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
    if (run.id === createdRun?.id) evidenceSaved = true;
    const bundle = verifyEvidence(JSON.parse(bytes.toString('utf8')), expectedDigest);
    assert.equal(bundle.mode, 'live'); assert.equal(bundle.run.id, run.id);
    assert.equal(digestJson(bundle.run), digestJson(run), 'Downloaded evidence differs from the observed terminal run.');
    const runtime = bundle.runtimeLock as { sourceDigest?: unknown; execution?: unknown };
    evidenceSummaries.push({ runId: run.id, variant: run.variant, terminalStatus: run.terminalStatus,
      runDigest: digestJson(run), bundleDigest: bundle.bundleDigest, sourceDigest: run.sourceDigest,
      policyDigest: run.policyDigest, runtimeLockDigest: run.runtimeLockDigest, operationalSourceDigest: runtime.sourceDigest ?? null,
      execution: runtime.execution ?? null, usage: run.usage, integrityVerified: true, authenticityVerified: false,
      providerRequestIds: run.candidates.map(candidate => candidate.providerRequestId).filter(Boolean),
      sandboxOperationIds: [...new Set([...run.sandboxOperationIds, ...run.candidates.flatMap(candidate => candidate.sandboxOperationIds)])], file: name });
    return bundle;
  };

  try {
    const rawDirectory = join(output, 'raw-video'); await mkdir(rawDirectory, { mode: 0o700 });
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], downloadsPath: output });
    browserVersion = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true,
      serviceWorkers: 'block', recordVideo: { dir: rawDirectory, size: { width: 1440, height: 1000 } } });
    context.setDefaultTimeout(30_000); context.setDefaultNavigationTimeout(30_000);
    await context.route('**/*', async route => {
      try {
        const request = route.request(), inspected = inspectUrl(request.url()), method = request.method();
        let allowed = inspected.safe && method === 'GET' && (readPaths.has(inspected.url.pathname) || runPath.test(inspected.url.pathname));
        if (inspected.safe && method === 'POST' && inspected.url.pathname === '/runs' && allowedPosts === 0) {
          const parsed = ProductRunRequestSchema.safeParse(request.postDataJSON());
          if (parsed.success && parsed.data.taskId === taskId && parsed.data.variant === variant && parsed.data.mode === 'live') {
            allowedPosts++; postAtMs = elapsed();
            await save('creation-request.json', { atMs: postAtMs, request: parsed.data }); allowed = true;
          }
        }
        const record = { atMs: elapsed(), method, url: inspected.label, allowed };
        observedRequests.push(record); note({ type: 'request', ...record });
        if (!allowed) { failure('network_guard', `Blocked ${method} ${inspected.label}`); await route.abort('blockedbyclient'); return; }
        await route.continue();
      } catch (error) { failure('request_interception', error); await route.abort('blockedbyclient').catch(() => {}); }
    });
    await context.routeWebSocket('**/*', socket => { failure('network_guard', 'WebSocket blocked.'); socket.close(); });
    page = await context.newPage(); video = page.video(); videoStartedAtMs = elapsed();
    context.on('page', extra => { if (extra !== page) { failure('network_guard', 'Additional page blocked.'); void extra.close().catch(() => {}); } });
    page.on('pageerror', error => { pageErrors.push(error.message); note({ type: 'page_error', atMs: elapsed(), message: error.message }); });
    page.on('console', entry => { if (entry.type() === 'error') { consoleErrors.push(entry.text()); note({ type: 'console_error', atMs: elapsed(), message: entry.text() }); } });
    page.on('requestfailed', request => note({ type: 'request_failed', atMs: elapsed(), method: request.method(),
      url: inspectUrl(request.url()).label, failure: request.failure()?.errorText ?? null }));
    page.on('response', response => note({ type: 'response', atMs: elapsed(), method: response.request().method(),
      url: inspectUrl(response.url()).label, status: response.status() }));
    // Chromium pauses redirects before following them, including redirects that
    // browser route interception may not visit again. All accepted bytes remain real.
    const cdp = await context.newCDPSession(page);
    cdp.on('Fetch.requestPaused', event => {
      void (async () => {
        if (event.responseStatusCode && event.responseStatusCode >= 300 && event.responseStatusCode < 400) {
          failure('network_guard', `Redirect ${event.responseStatusCode} blocked.`);
          await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
        } else await cdp.send(event.responseStatusCode ? 'Fetch.continueResponse' : 'Fetch.continueRequest', { requestId: event.requestId });
      })().catch(error => {
        if (!closing) { failure('redirect_guard', error); void context?.close().catch(() => {}); }
      });
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
    watchdog = setTimeout(() => { failure('watchdog', 'Recorder exceeded its 420-second overall limit.'); void context?.close().catch(() => {}); }, 420_000);
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const catalogueRead = await readApi('/tasks'), historyRead = await readApi('/runs');
    await save('catalogue-before.json', catalogueRead.value); await save('history-before.json', historyRead.value);
    const catalogue = catalogueRead.value as { mode: string; realExecutionEnabled: boolean; runtimeLockDigest: string;
      tasks: Array<{ id: string; title: string; sourceDigest: string; policyDigest: string; executionSupported: boolean }> };
    const previous = (historyRead.value as { runs: ProductRun[] }).runs;
    assert.equal(catalogue.mode, 'live'); assert.equal(catalogue.realExecutionEnabled, true, 'Live creation is paused.');
    const task = catalogue.tasks.find(item => item.id === taskId);
    assert.ok(task?.executionSupported, 'The explicit curated task is unavailable.');
    await page.locator(`.task-card[data-task-id="${taskId}"]`).click();
    assert.equal(await page.locator('#task-detail h2').innerText(), task.title);
    caption(`Live public app. Task: ${task.title}. This recording starts one ${variantNames[variant]} run.`);
    await page.screenshot({ path: join(output, '01-task.png'), fullPage: true });
    await page.waitForTimeout(1500);
    if (variant !== 'patchproof') {
      await page.locator('[data-nav="compare"]').click(); await page.locator('#compare-task').selectOption(taskId);
    }
    const control = variant === 'patchproof' ? page.getByRole('button', { name: 'Run PatchProof →', exact: true }) :
      page.locator('.variant-card').filter({ has: page.getByRole('heading', { name: variantNames[variant], exact: true }) })
        .getByRole('button', { name: 'Run this approach →', exact: true });
    assert.equal(await control.count(), 1, 'The real UI has no single-run button for this variant; no request was submitted.');
    assert.equal(await control.isEnabled(), true, 'The real UI does not currently allow this run.');
    const [creation] = await Promise.all([page.waitForResponse(response => response.url() === `${origin}/runs` && response.request().method() === 'POST', { timeout: 30_000 }), control.click()]);
    const creationText = await creation.text(); await writeFile(join(output, 'creation-response.json'), creationText, { flag: 'wx', mode: 0o600 });
    const parsedRun = JSON.parse(creationText) as ProductRun;
    if (z.uuid().safeParse(parsedRun.id).success) { createdRun = parsedRun; latestRun = parsedRun; }
    assert.equal(creation.status(), 201, 'Creation did not return a new run; no retry will be sent.');
    assert.ok(createdRun); assert.equal(createdRun.taskId, taskId); assert.equal(createdRun.variant, variant); assert.equal(createdRun.mode, 'live');
    assert.equal(createdRun.sourceDigest, task.sourceDigest); assert.equal(createdRun.policyDigest, task.policyDigest);
    assert.equal(createdRun.runtimeLockDigest, catalogue.runtimeLockDigest);
    await save('created-run.json', createdRun);
    caption(`Run ${createdRun.id}. Progress comes from actual coordinator events; no response or outcome is substituted.`);
    const deadline = postAtMs! + 300_000;
    while (latestRun?.phase !== 'terminal' && elapsed() < deadline) {
      const remaining = deadline - elapsed();
      const observed = await readApi(`/runs/${createdRun.id}`, Math.max(1, Math.min(30_000, remaining)));
      latestRun = observed.value as ProductRun;
      assert.equal(latestRun.id, createdRun.id);
      if (latestRun.phase !== 'terminal') await page.waitForTimeout(Math.min(1500, Math.max(1, deadline - elapsed())));
    }
    assert.equal(latestRun?.phase, 'terminal', 'Terminal state was not observed within 300 seconds; the server retains its own execution deadline.');
    const run = latestRun!; await save('terminal-run.json', run);
    await page.locator('.run-summary[data-context-state="ready"]').waitFor({ timeout: 30_000 });
    caption(`Recorded outcome: ${run.terminalStatus}. ${run.candidates.length} candidates; ${run.usage.inferenceCalls} model operations. No benchmark advantage is inferred.`);
    await page.screenshot({ path: join(output, '02-terminal.png'), fullPage: true });
    for (const candidate of run.candidates) {
      await page.getByRole('button', { name: new RegExp(`^Candidate ${candidate.id} ·`) }).click();
      const patch = page.locator('.diff').first();
      if (await patch.count()) await patch.scrollIntoViewIfNeeded();
      caption(`Candidate ${candidate.id}: ${candidate.accepted ? 'passed declared checks' : candidate.rejectionReason ?? 'not accepted'}.`);
      await page.screenshot({ path: join(output, `candidate-${candidate.id}-patch.png`), fullPage: false });
      const logs = page.getByText(/^Observed result and log ·/).first();
      if (await logs.count()) { await logs.click(); await logs.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(output, `candidate-${candidate.id}-log.png`), fullPage: false }); }
      await page.waitForTimeout(1500);
    }
    await page.getByRole('heading', { name: 'Execution journal', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, '03-journal.png'), fullPage: false });
    await page.getByRole('heading', { name: 'Resource accounting', exact: true }).scrollIntoViewIfNeeded();
    caption(`Provider cost: ${run.usage.measuredCostUsd === null ? 'unmeasured' : `${run.usage.measuredCostUsd} USD${run.usage.costIsEstimate ? ', estimated' : ', recorded'}`}. Sandbox CPU: ${run.usage.sandboxCpuSeconds === null ? 'unmeasured' : `${run.usage.sandboxCpuSeconds} seconds`}.`);
    await page.screenshot({ path: join(output, '04-accounting.png'), fullPage: false }); await page.waitForTimeout(2000);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download evidence ↓', exact: true }).click()]);
    assert.equal(download.suggestedFilename(), `${run.id}.json`);
    const downloadPath = await download.path(); assert.ok(downloadPath, await download.failure() ?? 'Evidence download unavailable.');
    await preserveEvidence(run, await readFile(downloadPath));
    const matching = Object.keys(variantNames).filter(key => key !== variant).map(key => previous
      .filter(item => item.variant === key && item.phase === 'terminal' && signature(item) === signature(run))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]).filter((item): item is ProductRun => Boolean(item));
    for (const item of matching) {
      const exported = await readApi(`/runs/${item.id}/evidence`);
      await preserveEvidence(item, Buffer.from(exported.text), exported.digest ?? undefined);
    }
    await save('comparison.json', { createdRunId: run.id, matchingExistingRunIds: matching.map(item => item.id),
      missingVariants: Object.keys(variantNames).filter(key => key !== variant && !matching.some(item => item.variant === key)),
      criterion: 'Same task, schema, mode, source, policy, runtime lock and every resource limit.', benchmarkClaim: false });
    await page.locator('[data-nav="compare"]').click(); await page.locator('#compare-task').selectOption(taskId);
    caption(`${matching.length + 1} recorded approach${matching.length ? 'es' : ''} match these inputs and limits. Missing approaches remain explicit. No additional run is started.`);
    await page.screenshot({ path: join(output, '05-comparison.png'), fullPage: true }); await page.waitForTimeout(2500);
    assert.equal(allowedPosts, 1); observerComplete = true;
  } catch (error) { failure('recording', error); }
  finally {
    if (watchdog) clearTimeout(watchdog);
    if (page && !page.isClosed()) {
      try {
        // A lost creation response can still leave an addressed real run in the UI.
        if (!createdRun && allowedPosts === 1) {
          const id = new URL(page.url()).hash.match(/^#evidence\/([0-9a-f-]{36})$/)?.[1];
          if (id && z.uuid().safeParse(id).success) { const observed = await readApi(`/runs/${id}`); createdRun = observed.value as ProductRun; latestRun = createdRun; }
        }
        if (createdRun && !evidenceSaved) {
          const observed = await readApi(`/runs/${createdRun.id}`); latestRun = observed.value as ProductRun;
          if (latestRun.phase === 'terminal') { const exported = await readApi(`/runs/${createdRun.id}/evidence`); await preserveEvidence(latestRun, Buffer.from(exported.text), exported.digest ?? undefined); }
        }
      } catch (error) { failure('final_evidence_preservation', error); }
      try { await page.screenshot({ path: join(output, 'final-state.png'), fullPage: true }); }
      catch (error) { failure('final_screenshot', error); }
    }
    closing = true;
    try { await context?.close(); } catch (error) { failure('context_close', error); }
    if (video) { try { videoPath = await video.path(); await chmod(videoPath, 0o600); } catch (error) { failure('video_preservation', error); } }
    try { await browser?.close(); } catch (error) { failure('browser_close', error); }
    await journal;
    if (journalFailure) failures.push({ stage: 'observation_journal', message: journalFailure, atMs: elapsed() });
    const durationMs = elapsed(), videoDurationObservedMs = Math.max(0, durationMs - videoStartedAtMs);
    const srt = captions.map((item, index) => `${index + 1}\n${timestamp(item.atMs)} --> ${timestamp(Math.min(item.atMs + 8000, captions[index + 1]?.atMs ?? videoDurationObservedMs))}\n${item.text}\n`).join('\n');
    await writeFile(join(output, 'captions.srt'), srt, { flag: 'wx', mode: 0o600 });
    const status = observerComplete && failures.length === 0 && pageErrors.length === 0 && consoleErrors.length === 0 ? 'captured' : 'failed';
    await save('recording-report.json', { status, startedAt, finishedAt: new Date().toISOString(), origin, taskId, variant,
      source, browserVersion, durationMs, videoDurationObservedMs, videoPath, rawVideoUnedited: true, captionsUseObservedFacts: true,
      derivativeVideoPrepared: false, maximumSubmissionVideoSeconds: 179, allowedCreateRequests: allowedPosts,
      runId: createdRun?.id ?? null, latestRun, mayStillBeRunning: allowedPosts > 0 && latestRun?.phase !== 'terminal',
      evidence: evidenceSummaries, failures, pageErrors, consoleErrors, observedRequests,
      competitionReady: false, modelPerformanceClaim: false, replayExecuted: false });
    console.log(JSON.stringify({ status, outputDirectory: output, runId: createdRun?.id ?? null,
      terminalStatus: latestRun?.terminalStatus ?? null, allowedCreateRequests: allowedPosts, videoPath }));
    if (status !== 'captured') process.exitCode = 1;
  }
}

main().catch(error => { console.error(message(error)); process.exitCode = 1; });
