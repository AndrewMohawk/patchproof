import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { z } from 'zod';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { verifyEvidence } from '../packages/orchestrator/src/evidence.ts';
import { assertPrivateOperatorPath } from './operator-files.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const digest = (bytes: Uint8Array) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Meta = z.object({ mode: z.literal('archive'), readOnly: z.literal(true), realExecutionEnabled: z.literal(false),
  competitionReady: z.literal(false), archiveDigest: Digest, integrityVerified: z.literal(true), authenticityVerified: z.literal(false),
  capabilities: z.strictObject({ createRuns: z.literal(false), cancelRuns: z.literal(false), replay: z.literal(false), streamEvents: z.literal(false) }),
  bundles: z.array(z.strictObject({ runId: z.uuid(), bundleDigest: Digest })).min(1).max(30) });
const Selection = z.array(z.uuid()).min(1).max(6);
export class ArchiveRecordingError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new ArchiveRecordingError(code); }

export function archiveBase(value: string): string {
  // An explicit literal loopback origin only: no credentials, DNS, path, query or fragment.
  if (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/?$/.test(value)) fail('recording_origin_invalid');
  const url = new URL(value);
  if (!url.port || Number(url.port) < 1024 || Number(url.port) > 65535) fail('recording_origin_invalid');
  return url.origin;
}
export function recordingRequestAllowed(base: string, ids: readonly string[], method: string, value: string): boolean {
  try {
    const url = new URL(value);
    if (method !== 'GET' || url.origin !== base || url.username || url.password || url.search) return false;
    return ['/', '/app.js', '/style.css', '/favicon.ico', '/tasks', '/runs'].includes(url.pathname) ||
      ids.some(id => url.pathname === `/runs/${id}` || url.pathname === `/runs/${id}/evidence`);
  } catch { return false; }
}
async function getResponse(base: string, path: string, maximum = 4_194_304) {
  // Never let Chromium follow a response Location. Forward only bounded, pinned GET bytes.
  const response = await fetch(base + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (response.status !== 200 && !(path === '/favicon.ico' && response.status === 204)) fail('recording_read_failed');
  const chunks: Uint8Array[] = []; let length = 0;
  if (response.body) for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maximum) fail('recording_read_too_large');
    chunks.push(chunk);
  }
  const headers: Record<string, string> = {};
  for (const name of ['content-type', 'content-disposition', 'content-security-policy', 'x-content-type-options',
    'cache-control', 'referrer-policy', 'x-patchproof-digest']) {
    const value = response.headers.get(name); if (value !== null) headers[name] = value;
  }
  return { bytes: Buffer.concat(chunks), status: response.status, headers };
}
const getBytes = async (base: string, path: string, maximum?: number) => (await getResponse(base, path, maximum)).bytes;

/** Read-only preflight. An exact archive selection prevents unrelated records entering the video. */
export async function inspectRecordingArchive(baseValue: string, expectedArchiveDigest: string, idsValue: unknown) {
  const base = archiveBase(baseValue), ids = Selection.parse(idsValue);
  Digest.parse(expectedArchiveDigest);
  if (new Set(ids).size !== ids.length) fail('recording_duplicate_run');
  const metaBytes = await getBytes(base, '/tasks'), meta = Meta.parse(JSON.parse(metaBytes.toString('utf8')));
  if (meta.archiveDigest !== expectedArchiveDigest) fail('recording_archive_changed');
  if (meta.bundles.length !== ids.length || new Set(meta.bundles.map(row => row.runId)).size !== ids.length ||
      meta.bundles.some(row => !ids.includes(row.runId))) fail('recording_selection_mismatch');
  const historyBytes = await getBytes(base, '/runs', 16_777_216);
  const responsePins: Record<string, string> = { '/tasks': digest(metaBytes), '/runs': digest(historyBytes), '/favicon.ico': digest(Buffer.alloc(0)) };
  const history = JSON.parse(historyBytes.toString('utf8')) as { runs?: unknown[] };
  if (!Array.isArray(history.runs) || history.runs.length !== ids.length) fail('recording_history_mismatch');
  const records = [];
  for (const id of ids) {
    const pin = meta.bundles.find(row => row.runId === id)!;
    const bytes = await getBytes(base, `/runs/${id}/evidence`);
    const bundle = verifyEvidence(JSON.parse(bytes.toString('utf8')), pin.bundleDigest);
    const runBytes = await getBytes(base, `/runs/${id}`);
    const run = JSON.parse(runBytes.toString('utf8'));
    responsePins[`/runs/${id}`] = digest(runBytes); responsePins[`/runs/${id}/evidence`] = digest(bytes);
    const matchingHistory = history.runs.filter(row => (row as { id?: unknown })?.id === id);
    if (bundle.run.id !== id || bundle.run.phase !== 'terminal' || bundle.competitionReady !== false ||
        digestJson(run) !== digestJson(bundle.run) || matchingHistory.length !== 1 || digestJson(matchingHistory[0]) !== digestJson(bundle.run)) {
      fail('recording_run_mismatch');
    }
    records.push({ bundle, bytes, byteDigest: digest(bytes) });
  }
  const assets: Record<string, string> = {};
  for (const path of ['/', '/app.js', '/style.css']) assets[path] = digest(await getBytes(base, path));
  Object.assign(responsePins, assets);
  return { base, ids, meta, metaByteDigest: digest(metaBytes), records, assets, responsePins };
}

const outcomes = { verified_for_declared_checks: 'Passes declared checks', needs_review: 'Needs review', failed: 'Checks failed', infrastructure_error: 'Execution error' };
export function playbackCaption(run: ReturnType<typeof verifyEvidence>['run'], synthetic: boolean): string {
  const cost = run.usage.measuredCostUsd === null ? 'unmeasured provider cost' : `${run.usage.measuredCostUsd} USD${run.usage.costIsEstimate ? ' estimated' : ' recorded'} provider cost`;
  return `${synthetic ? 'SYNTHETIC VERIFICATION INPUT. ' : ''}Recorded ${run.mode} · ${run.variant}: ${run.terminalStatus}. ${cost}; sandbox CPU ${run.usage.sandboxCpuSeconds === null ? 'unmeasured' : `${run.usage.sandboxCpuSeconds} seconds`}. No inference or checks run during playback.`;
}
export function captionDwellMs(text: string, synthetic = false): number {
  return synthetic ? 1800 : Math.max(3000, Math.ceil(text.trim().split(/\s+/).filter(Boolean).length / 3.5 * 1000));
}
const timestamp = (ms: number) => new Date(Math.max(0, Math.round(ms))).toISOString().slice(11, 23).replace('.', ',');

/** A new private output directory is the only intended write target. No execution runtime is imported or created. */
export async function recordEvidenceArchive(input: { base: string; archiveDigest: string; runIds: string[]; outputDirectory: string; synthetic?: boolean }) {
  const options = structuredClone(input);
  const snapshot = await inspectRecordingArchive(options.base, options.archiveDigest, options.runIds);
  assertPrivateOperatorPath(options.outputDirectory, projectRoot, { allowMissing: true });
  await mkdir(options.outputDirectory, { mode: 0o700 });
  const output = options.outputDirectory, startedAt = new Date().toISOString();
  const captures: Array<{ startMs: number; text: string }> = [], violations: string[] = [], errors: string[] = [];
  const requests: Array<{ method: string; path: string }> = [];
  const observedAssets: Record<string, string> = {}, requestChecks: Promise<void>[] = [];
  const responsePins = snapshot.responsePins;
  const source = { recorderDigest: digest(await readFile(fileURLToPath(import.meta.url))), servedAssets: snapshot.assets,
    gitCommit: await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: projectRoot }).then(r => r.stdout.trim()).catch(() => null) };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: Awaited<ReturnType<NonNullable<typeof browser>['newContext']>> | undefined;
  let video: ReturnType<Awaited<ReturnType<NonNullable<typeof context>['newPage']>>['video']> = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let start = performance.now(), durationMs = 0, encodedDurationSeconds: number | null = null, failure: string | null = null;
  let version: string | null = null;
  const caption = (text: string) => captures.push({ startMs: Math.round(performance.now() - start), text });
  const pause = async () => { await new Promise(done => setTimeout(done, captionDwellMs(captures.at(-1)?.text ?? '', options.synthetic === true))); };
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], downloadsPath: output });
    version = browser.version();
    context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true,
      serviceWorkers: 'block', recordVideo: { dir: output, size: { width: 1440, height: 1100 } } });
    context.setDefaultTimeout(8000); context.setDefaultNavigationTimeout(8000);
    await context.route('**/*', route => {
      const check = (async () => {
        const request = route.request();
        if (!recordingRequestAllowed(snapshot.base, snapshot.ids, request.method(), request.url())) {
          violations.push('blocked_request'); await route.abort('blockedbyclient'); return;
        }
        const path = new URL(request.url()).pathname;
        requests.push({ method: 'GET', path });
        const response = await getResponse(snapshot.base, path, path === '/runs' ? 16_777_216 : undefined);
        const actual = digest(response.bytes);
        if (actual !== responsePins[path]) { violations.push('response_bytes_changed'); await route.abort('blockedbyclient'); return; }
        if (path in snapshot.assets) observedAssets[path] = actual;
        await route.fulfill({ status: response.status, headers: response.headers, body: response.bytes });
      })().catch(async () => { violations.push('request_unavailable'); await route.abort('blockedbyclient').catch(() => {}); });
      requestChecks.push(check); return check;
    });
    await context.routeWebSocket('**/*', socket => { violations.push('blocked_websocket'); socket.close(); });
    const page = await context.newPage(); video = page.video(); start = performance.now();
    context.on('page', extra => { if (extra !== page) { violations.push('blocked_extra_page'); void extra.close().catch(() => {}); } });
    page.on('pageerror', () => errors.push('page_error'));
    page.on('console', message => { if (message.type() === 'error') errors.push('console_error'); });
    watchdog = setTimeout(() => { failure = 'recording_deadline'; void context?.close().catch(() => {}); }, 150_000);
    await page.goto(snapshot.base, { waitUntil: 'domcontentloaded' });
    await page.getByText('Recorded evidence · Read only', { exact: true }).first().waitFor();
    assert.equal(await page.title(), 'PatchProof — review the evidence');
    assert.equal(await page.locator('#compare-run').isHidden(), true);
    assert.equal(await page.getByRole('button', { name: /^(Run|Compare all three|Cancel run)/ }).count(), 0);
    caption(`${options.synthetic ? 'SYNTHETIC VERIFICATION INPUTS. ' : ''}Review a saved run in the interactive evidence archive. This playback starts no inference or checks. Recorded model mode stays visible.`);
    await pause();
    for (const [index, record] of snapshot.records.entries()) {
      const { run, fixture } = record.bundle;
      await page.locator('[data-nav="tasks"]').click();
      assert.match(fixture.id, /^[A-Za-z0-9_-]+$/);
      await page.locator(`.task-card[data-task-id="${fixture.id}"]`).click();
      assert.equal(await page.locator('#task-detail h2').innerText(), fixture.title);
      caption(`Recorded task: ${fixture.title}. Start with the requirements saved with this run.`);
      await page.locator('#task-detail').scrollIntoViewIfNeeded(); await pause();
      await page.goto(`${snapshot.base}/#evidence/${run.id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.run-summary[data-context-state="ready"]').waitFor();
      await page.locator('#evidence').getByText(`RECORDED ${run.mode.toUpperCase()} · READ ONLY`, { exact: true }).waitFor();
      assert.equal(await page.locator('.run-summary .outcome').innerText(), outcomes[run.terminalStatus!]);
      caption(`${options.synthetic ? 'SYNTHETIC INPUT. ' : ''}Recorded ${run.mode} run: ${outcomes[run.terminalStatus!]}. Review the declared checks and candidate history.`);
      await page.screenshot({ path: join(output, `run-${index + 1}-overview.png`), fullPage: false }); await pause();
      const rejected = run.candidates.find(candidate => candidate.rejectionReason && !candidate.accepted);
      if (rejected) {
        await page.getByRole('button', { name: new RegExp(`^Candidate ${rejected.id} ·`) }).click();
        const log = page.getByText(/^Observed result and log ·/).first();
        if (await log.count()) {
          await log.click(); await log.scrollIntoViewIfNeeded();
          assert.equal(await page.locator('.check-log').first().isVisible(), true);
        }
        const statuses = [...rejected.visibleChecks, ...rejected.acceptanceChecks].filter(check => check.status !== 'pass');
        caption(`Recorded candidate ${rejected.id} was rejected. ${statuses.length} declared check results did not pass. Compare expected and observed values to understand why.`);
        await page.screenshot({ path: join(output, `run-${index + 1}-rejection.png`), fullPage: false }); await pause();
      }
      if (run.selectedCandidateId !== null) {
        await page.getByRole('button', { name: new RegExp(`^Candidate ${run.selectedCandidateId} ·`) }).click();
        const patch = page.locator('.diff').first();
        if (await patch.count()) await patch.scrollIntoViewIfNeeded();
        caption(`Final recorded selection: candidate ${run.selectedCandidateId}. Verdict: ${run.terminalStatus}. Inspect its patch against the original source.`);
        await pause();
      } else { caption('This recorded run has no selected patch. Its failure or abstention remains visible.'); await pause(); }
      await page.getByRole('heading', { name: 'Resource accounting', exact: true }).scrollIntoViewIfNeeded();
      caption(playbackCaption(run, options.synthetic === true));
      await page.screenshot({ path: join(output, `run-${index + 1}-accounting.png`), fullPage: false }); await pause();
      await page.getByRole('heading', { name: 'Reproducibility', exact: true }).scrollIntoViewIfNeeded();
      caption('Download the original evidence bundle. Its run, source, policy and runtime pins preserve what was checked and selected.');
      await pause();
      const pending = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Download evidence ↓', exact: true }).click();
      const download = await pending;
      assert.equal(download.suggestedFilename(), `${run.id}.json`);
      const downloaded = await download.path(); assert.ok(downloaded);
      assert.deepEqual(await readFile(downloaded), record.bytes);
      await download.saveAs(join(output, `evidence-${index + 1}.json`));
      await download.delete();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.run-summary[data-context-state="ready"]').waitFor();
    }
    if (snapshot.ids.length > 1) {
      await page.locator('[data-nav="compare"]').click();
      caption('Only supplied recorded approaches are compared. Missing arms and mismatched inputs remain explicit; these records alone do not establish a benchmark advantage.');
      await pause(); await page.screenshot({ path: join(output, 'comparison.png'), fullPage: false });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${snapshot.base}/#evidence/${snapshot.ids[0]}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.run-summary[data-context-state="ready"]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement !== document.body));
    caption('The same saved evidence works on a narrow screen. This recorded walkthrough performs no new inference and is not a human usability study.');
    await pause(); await page.screenshot({ path: join(output, 'mobile.png'), fullPage: false });
    // Stop all browser producers before checking diagnostics or reading the final snapshot.
    await context.close();
    await Promise.all(requestChecks);
    const after = await inspectRecordingArchive(snapshot.base, options.archiveDigest, snapshot.ids);
    assert.deepEqual(after.responsePins, snapshot.responsePins);

  } catch (error) {
    failure ??= error instanceof ArchiveRecordingError ? error.code : 'recording_verification_failed';
  } finally {
    if (watchdog) clearTimeout(watchdog);
    durationMs = Math.round(performance.now() - start);
    await context?.close().catch(() => { failure ??= 'recording_close_failed'; });
    if (video) await video.saveAs(join(output, 'recorded-evidence.webm')).catch(() => { failure ??= 'recording_video_failed'; });
    await browser?.close().catch(() => { failure ??= 'recording_close_failed'; });
    await Promise.all(requestChecks);
    // No active browser remains to register a late request, error or response check.
    if (violations.length || errors.length) failure ??= 'recording_boundary_failed';
    if (digestJson(observedAssets) !== digestJson(snapshot.assets)) failure ??= 'recording_assets_unverified';
  }
  try {
    const probe = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(output, 'recorded-evidence.webm')], { timeout: 10000 });
    encodedDurationSeconds = Number(JSON.parse(probe.stdout).format.duration);
    if (!Number.isFinite(encodedDurationSeconds) || encodedDurationSeconds <= 0 || encodedDurationSeconds > 170 || durationMs > 170_000) fail('recording_duration_invalid');
  } catch { failure ??= 'recording_duration_unverified'; }
  const srt = captures.map((row, index) => `${index + 1}\n${timestamp(row.startMs)} --> ${timestamp(captures[index + 1]?.startMs ?? durationMs)}\n${row.text}\n`).join('\n');
  await writeFile(join(output, 'captions.srt'), srt, { flag: 'wx', mode: 0o600 });
  const files: Record<string, string> = {};
  for (const name of await readdir(output)) { const path = join(output, name); await chmod(path, 0o600); files[name] = digest(await readFile(path)); }
  const receipt = { schemaVersion: '1.0', kind: 'recorded-evidence-walkthrough', status: failure ? 'failed' : 'passed', failure,
    scope: options.synthetic ? 'synthetic_archive_verification' : 'recorded_archive_observation', startedAt, source, browserVersion: version,
    archiveDigest: options.archiveDigest, responsePins, requestTransport: 'bounded-no-redirect-GET-forwarder-exact-pinned-bytes', durationMs, encodedDurationSeconds, maximumSeconds: 170,
    captionPacing: options.synthetic ? 'synthetic-test-1800ms' : '3.5words-per-second-minimum3seconds', authenticityVerified: false,
    executionPerformed: false, newRunsCreated: 0, providerCallsDuringPlayback: 0, publicationPerformed: false,
    runs: snapshot.records.map(({ bundle, byteDigest }) => ({ runId: bundle.run.id, bundleDigest: bundle.bundleDigest, byteDigest,
      mode: bundle.run.mode, taskId: bundle.run.taskId, variant: bundle.run.variant, status: bundle.run.terminalStatus,
      sourceDigest: bundle.run.sourceDigest, policyDigest: bundle.run.policyDigest, runtimeLockDigest: bundle.run.runtimeLockDigest,
      selectedCandidateId: bundle.run.selectedCandidateId, recordedUsage: bundle.run.usage })),
    files, requests, observedAssets, violations, errors, captions: captures };
  await writeFile(join(output, 'recording-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, archiveDigest, ids, outputDirectory, scope, ...extra] = process.argv.slice(2);
  try {
    if (!base || !archiveDigest || !ids || !outputDirectory || extra.length || (scope !== undefined && scope !== '--synthetic')) fail('recording_usage');
    const result = await recordEvidenceArchive({ base, archiveDigest, runIds: ids.split(','), outputDirectory, synthetic: scope === '--synthetic' });
    console.log(JSON.stringify({ status: result.status, failure: result.failure, scope: result.scope, durationMs: result.durationMs,
      archiveDigest: result.archiveDigest, runIds: result.runs.map(run => run.runId), executionPerformed: false, publicationPerformed: false }));
    if (result.status !== 'passed') process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', error: { code: error instanceof ArchiveRecordingError ? error.code : 'recording_input_invalid' }, executionPerformed: false }));
    process.exitCode = 2;
  }
}
