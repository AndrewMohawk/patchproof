import assert from 'node:assert/strict';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { verifyEvidence } from '../../../packages/orchestrator/src/evidence.ts';

const [taskId, directory, resumeId] = process.argv.slice(2);
assert.match(taskId ?? '', /^v3-[a-z]+(?:-[a-z]+)*$/);
assert.match(directory ?? '', /^\/home\/andrewmohawk\/\.config\/patchproof\/demo-20260927\/product-v3-live-[a-z0-9-]+$/);
await mkdir(directory, { mode: 0o700 });
const save = (name, value) => writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const origin = 'https://patchproof.andrewmohawk.xyz';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage(); const errors = [], posts = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() !== 'GET') posts.push({ method: request.method(), url: request.url() }); });
const startedAt = new Date().toISOString(); let runId;
try {
  const meta = await (await context.request.get(origin + '/tasks')).json();
  assert.equal(meta.mode, 'live'); assert.equal(meta.execution.modelProvider, 'nebius-token-factory');
  assert.equal(meta.execution.checkBackend, 'local_container'); assert.equal(meta.limits.maxApprovedSpendUsd, .25);
  assert.equal(meta.execution.modelId, 'nvidia/nemotron-3-super-120b-a12b');
  assert.equal(meta.maxApprovedSpendUsd, 25); if (!resumeId) assert.equal(meta.availability.enabled, true);
  assert.ok(meta.tasks.some(task => task.id === taskId));
  await save('request-intent.json', { startedAt, taskId, variant: 'patchproof', mode: 'live', maximumRunCostUsd: resumeId ? 0 : .25, ownerApprovedProjectCeilingUsd: 25, limits: meta.limits, resumeId });
  let run;
  if (resumeId) {
    assert.match(resumeId, /^[a-f0-9-]{36}$/);
    run = await (await context.request.get(origin + '/runs/' + resumeId)).json();
    assert.equal(run.id, resumeId); assert.equal(run.taskId, taskId); assert.equal(run.mode, 'live');
    await page.goto(origin + '/#evidence/' + resumeId, { waitUntil: 'domcontentloaded' });
  } else {
  await page.goto(origin + '/#tasks', { waitUntil: 'domcontentloaded' });
  await page.locator(`.task-card[data-task-id="${taskId}"]`).click();
  await page.screenshot({ path: join(directory, 'starting-code.png'), fullPage: true });
  const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === origin + '/runs');
  await page.getByRole('button', { name: 'Generate patch', exact: true }).click();
  const created = await response; assert.equal(created.status(), 201);
  run = await created.json();
  }
  runId = run.id;
  await save('created.json', run); console.log(JSON.stringify({ created: runId, taskId }));
  assert.ok(meta.limits.wallTimeLimitSeconds <= 900);
  const observations = [], end = Date.now() + (meta.limits.wallTimeLimitSeconds + 40) * 1000; let phase;
  while (run.phase !== 'terminal') {
    assert.ok(Date.now() < end, 'Public run observation deadline exceeded. Do not infer cancellation.');
    if (run.phase !== phase) { phase = run.phase; const observation = { at: new Date().toISOString(), phase, candidates: run.candidates.length }; observations.push(observation); console.log(JSON.stringify(observation)); }
    await page.waitForTimeout(2000);
    run = await (await context.request.get(origin + '/runs/' + runId)).json();
  }
  const responseEvidence = await context.request.get(origin + '/runs/' + runId + '/evidence');
  assert.equal(responseEvidence.status(), 200);
  const bytes = await responseEvidence.body(), bundle = verifyEvidence(JSON.parse(bytes.toString()));
  await writeFile(join(directory, 'evidence.json'), bytes, { flag: 'wx', mode: 0o600 });
  await page.goto(origin + '/#evidence/' + runId, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Run review', exact: true }).waitFor();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(directory, 'terminal.png'), fullPage: true });
  const summarize = checks => ({ pass: checks.filter(c => c.status === 'pass').length, fail: checks.filter(c => c.status === 'fail').length, error: checks.filter(c => c.status === 'error').length });
  const receipt = { status: 'observed', startedAt, finishedAt: new Date().toISOString(), taskId, runId, terminalStatus: run.terminalStatus, reason: run.reason,
    bundleDigest: bundle.bundleDigest, baseline: summarize([...run.baselineChecks.visible, ...run.baselineChecks.acceptance]),
    attempts: run.candidates.map(c => ({ id: c.id, accepted: c.accepted, ...summarize([...c.visibleChecks, ...c.acceptanceChecks]) })), usage: run.usage, observations, errors, posts };
  assert.equal(posts.length, resumeId ? 0 : 1); assert.deepEqual(errors, []);
  await save('receipt.json', receipt); console.log(JSON.stringify(receipt));
} catch (error) {
  await save('observer-failure.json', { startedAt, taskId, runId, message: error.message, errors, posts }); throw error;
} finally {
  await context.close(); await browser.close();
  for (const name of ['starting-code.png', 'terminal.png']) await chmod(join(directory, name), 0o600).catch(() => {});
}
