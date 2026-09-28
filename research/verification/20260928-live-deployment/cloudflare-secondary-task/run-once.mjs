import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ProductRunRequestSchema } from '../../../../packages/contracts/src/product.ts';
import { digestBytes, digestJson } from '../../../../packages/contracts/src/digest.ts';
import { verifyEvidence } from '../../../../packages/orchestrator/src/evidence.ts';
import { guardRecordedResponse } from '../../../../scripts/record-public-demo.ts';

// This command performs exactly one potentially billed UI action. Preparation
// and syntax checking do not authorize running it. Root must explicitly signal.
const usage = 'node research/verification/20260928-live-deployment/cloudflare-secondary-task/run-once.mjs --execute-approved NEW_ATTEMPT_LABEL';
const origin = 'https://patchproof.andrewmohawk.xyz';
const host = new URL(origin).hostname;
const edgeIp = '104.21.44.59'; // Public DNS verified 2026-09-28; revalidated before execution.
const taskId = 'v2-r03-t02', variant = 'patchproof';
const root = path.dirname(fileURLToPath(import.meta.url));
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const runPath = new RegExp(`^/runs/${uuid}(?:/(?:events|evidence))?$`);
const reads = new Set(['/', '/app.js', '/style.css', '/favicon.ico', '/healthz', '/tasks', '/runs']);

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') { console.log(usage); return; }
  assert.equal(process.argv.length, 4, usage);
  assert.equal(process.argv[2], '--execute-approved', usage);
  assert.match(process.argv[3], /^[a-z0-9][a-z0-9-]{0,60}$/);
  const output = path.join(root, process.argv[3]);
  await mkdir(output, { mode: 0o700 }); // Never overwrite an earlier attempt.
  const save = (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const began = performance.now();
  const report = { startedAt: new Date().toISOString(), origin, edgeIp, taskId, variant,
    taskScope: 'curated public development fixture', competitionReady: false, benchmarkClaim: false,
    realResponsesOnly: true, maximumCreateRequests: 1, terminalWaitSeconds: 300,
    allowedCreateRequests: 0, creationAtMs: null, runId: null, terminalStatus: null,
    requests: [], responses: [], failures: [], pageErrors: [], consoleErrors: [], evidence: null };
  const elapsed = () => Math.round(performance.now() - began);
  const failure = (stage, error) => report.failures.push({ stage, atMs: elapsed(), message: error instanceof Error ? error.message : String(error) });
  let browser, context, page, closing = false, watchdog;
  let currentRun = null;
  const pending = new Set();
  const track = promise => { pending.add(promise); void promise.finally(() => pending.delete(promise)).catch(() => {}); };
  const responseIdentity = async response => {
    const headers = await response.allHeaders();
    return { url: response.url(), method: response.request().method(), status: response.status(),
      server: headers.server ?? null, cfRay: headers['cf-ray'] ?? null,
      cfCacheStatus: headers['cf-cache-status'] ?? null, peer: await response.serverAddr().catch(() => null) };
  };
  const isEdge = identity => identity.server?.toLowerCase() === 'cloudflare'
    && typeof identity.cfRay === 'string' && identity.peer?.ipAddress === edgeIp;
  const get = async (pathname, timeout = 30000) => {
    assert.ok(reads.has(pathname) || runPath.test(pathname));
    const result = await page.evaluate(async ({ pathname, timeout }) => {
      const response = await fetch(pathname, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeout) });
      return { status: response.status, body: await response.text(), digest: response.headers.get('x-patchproof-digest') };
    }, { pathname, timeout });
    assert.equal(result.status, 200, `GET ${pathname} failed with ${result.status}`);
    return { ...result, value: JSON.parse(result.body) };
  };
  try {
    report.publicDns = execFileSync('dig', ['+short', 'A', host, '@1.1.1.1'], { encoding: 'utf8', timeout: 15000 }).trim().split('\n');
    assert.ok(report.publicDns.includes(edgeIp), 'Pinned Cloudflare IP is no longer in current public DNS. No run submitted.');
    report.scriptSha256 = digestBytes(await readFile(fileURLToPath(import.meta.url)));
    await save('attempt.json', { ...report, requests: undefined, responses: undefined });
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--no-proxy-server', '--disable-quic',
      `--host-resolver-rules=MAP ${host} ${edgeIp}`] });
    report.browserVersion = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    context.setDefaultTimeout(30000);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const safe = url.origin === origin && !url.username && !url.password && !url.search;
      let allowed = safe && request.method() === 'GET' && (reads.has(url.pathname) || runPath.test(url.pathname));
      if (safe && request.method() === 'POST' && url.pathname === '/runs' && report.allowedCreateRequests === 0) {
        const parsed = ProductRunRequestSchema.safeParse(request.postDataJSON());
        if (parsed.success && parsed.data.taskId === taskId && parsed.data.variant === variant && parsed.data.mode === 'live') {
          report.allowedCreateRequests++;
          report.creationAtMs = elapsed();
          await save('creation-request.json', parsed.data);
          allowed = true;
        }
      }
      report.requests.push({ atMs: elapsed(), method: request.method(), url: url.origin + url.pathname, allowed });
      if (!allowed) { failure('network_guard', `Blocked ${request.method()} ${url.origin}${url.pathname}`); await route.abort(); }
      else await route.continue();
    });
    await context.routeWebSocket('**/*', socket => { failure('network_guard', 'WebSocket blocked'); socket.close(); });
    page = await context.newPage();
    context.on('page', extra => { if (extra !== page) { failure('network_guard', 'Additional page blocked'); void extra.close(); } });
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push(event.text()); });
    page.on('response', response => track(responseIdentity(response).then(identity => {
      report.responses.push({ atMs: elapsed(), ...identity });
    }).catch(error => failure('response_metadata', error))));
    const cdp = await context.newCDPSession(page);
    cdp.on('Fetch.requestPaused', event => track(guardRecordedResponse(event, (method, parameters) => cdp.send(method, parameters),
      status => failure('redirect_guard', `Redirect ${status} blocked`)).catch(error => {
        if (!closing) { failure('redirect_guard', error); void context.close(); }
      })));
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
    watchdog = setTimeout(() => { failure('watchdog', 'Overall 390-second browser deadline exceeded'); void context.close(); }, 390000);
    const navigation = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    assert.ok(navigation);
    report.initialNavigation = await responseIdentity(navigation);
    assert.equal(navigation.status(), 200);
    assert.ok(isEdge(report.initialNavigation), 'Browser is not observing the pinned Cloudflare peer; no run submitted.');
    const catalog = (await get('/tasks')).value;
    const history = (await get('/runs')).value;
    await save('catalogue-before.json', catalog);
    await save('history-before.json', history);
    assert.equal(catalog.mode, 'live');
    assert.equal(catalog.realExecutionEnabled, true, 'Live creation is paused; no run submitted.');
    const task = catalog.tasks.find(task => task.id === taskId);
    assert.equal(task?.split, 'development');
    assert.equal(task?.executionSupported, true);
    await page.locator(`.task-card[data-task-id="${taskId}"]`).click();
    assert.equal(await page.locator('#task-detail h2').innerText(), task.title);
    await page.screenshot({ path: path.join(output, '01-selected-task.png'), fullPage: true });
    const control = page.getByRole('button', { name: 'Run PatchProof →', exact: true });
    assert.equal(await control.count(), 1);
    assert.equal(await control.isEnabled(), true);
    const [creation] = await Promise.all([page.waitForResponse(response => response.url() === `${origin}/runs`
      && response.request().method() === 'POST', { timeout: 30000 }), control.click()]);
    report.creationResponse = await responseIdentity(creation);
    const created = await creation.text();
    await writeFile(path.join(output, 'creation-response.json'), created, { flag: 'wx', mode: 0o600 });
    const parsed = JSON.parse(created);
    if (typeof parsed.id === 'string' && new RegExp(`^${uuid}$`).test(parsed.id)) { currentRun = parsed; report.runId = parsed.id; }
    assert.equal(creation.status(), 201, 'No new run response; this command will never retry creation.');
    assert.ok(isEdge(report.creationResponse), 'Creation did not retain Cloudflare edge provenance.');
    assert.equal(currentRun.taskId, taskId);
    assert.equal(currentRun.variant, variant);
    assert.equal(currentRun.mode, 'live');
    assert.equal(currentRun.runtimeLockDigest, catalog.runtimeLockDigest);
    assert.equal(currentRun.sourceDigest, task.sourceDigest);
    assert.equal(currentRun.policyDigest, task.policyDigest);
    await page.screenshot({ path: path.join(output, '02-created.png'), fullPage: true });
    const deadline = report.creationAtMs + 300000;
    while (currentRun.phase !== 'terminal' && elapsed() < deadline) {
      const remaining = Math.max(1, deadline - elapsed());
      currentRun = (await get(`/runs/${report.runId}`, Math.min(30000, remaining))).value;
      assert.equal(currentRun.id, report.runId);
      if (currentRun.phase !== 'terminal') await page.waitForTimeout(Math.min(1500, Math.max(1, deadline - elapsed())));
    }
    assert.equal(currentRun.phase, 'terminal', 'No terminal observation within 300 seconds. No retry or cancellation sent.');
    report.terminalStatus = currentRun.terminalStatus;
    await save('terminal-run.json', currentRun);
    const exported = await get(`/runs/${report.runId}/evidence`);
    await writeFile(path.join(output, 'evidence.json'), exported.body, { flag: 'wx', mode: 0o600 });
    const evidence = verifyEvidence(exported.value, exported.digest ?? undefined);
    assert.equal(evidence.mode, 'live');
    assert.equal(digestJson(evidence.run), digestJson(currentRun));
    report.evidence = { bundleDigest: evidence.bundleDigest, runtimeLockDigest: currentRun.runtimeLockDigest,
      operationalSourceDigest: evidence.runtimeLock.sourceDigest, usage: currentRun.usage,
      providerRequestIds: currentRun.candidates.map(candidate => candidate.providerRequestId).filter(Boolean),
      operationIds: [...new Set([...currentRun.sandboxOperationIds, ...currentRun.candidates.flatMap(candidate => candidate.sandboxOperationIds)])],
      digestVerified: true, replayExecuted: false };
    await page.locator('.run-summary[data-context-state="ready"]').waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(output, '03-terminal-evidence.png'), fullPage: true });
    await save('history-after.json', (await get('/runs')).value);
    assert.equal(report.allowedCreateRequests, 1);
    assert.equal(currentRun.terminalStatus, 'verified_for_declared_checks', 'Real run did not satisfy every declared check; retain the observed failure.');
  } catch (error) { failure('browser_smoke', error); }
  finally {
    if (watchdog) clearTimeout(watchdog);
    if (page && !page.isClosed()) {
      try { await page.screenshot({ path: path.join(output, 'final-state.png'), fullPage: true }); }
      catch (error) { failure('final_screenshot', error); }
    }
    closing = true;
    await context?.close().catch(error => failure('context_close', error));
    await browser?.close().catch(error => failure('browser_close', error));
    await Promise.allSettled([...pending]);
    report.finishedAt = new Date().toISOString();
    report.elapsedMs = elapsed();
    report.mayStillBeRunning = report.allowedCreateRequests > 0 && currentRun?.phase !== 'terminal';
    report.status = report.failures.length || report.pageErrors.length || report.consoleErrors.length ? 'failed' : 'passed';
    await save('report.json', report);
    console.log(JSON.stringify({ output, status: report.status, runId: report.runId,
      terminalStatus: report.terminalStatus, allowedCreateRequests: report.allowedCreateRequests,
      creationResponse: report.creationResponse ?? null, failures: report.failures }, null, 2));
    if (report.status !== 'passed') process.exitCode = 1;
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
