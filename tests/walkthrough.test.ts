import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Deliberately invented parser/browser inputs. Known public identifiers exercise
// selection rules; these objects are not verified run or model evidence.
const { projectStory, storyRecords } = await import(new URL('../apps/web/walkthrough.js', import.meta.url).href);
function projectionInput(kind: 'success' | 'failure' = 'success'): any {
  const record = storyRecords[kind];
  const definition = { id: record.checkId, requirementId: 'R01', function: 'transpose', args: [[[1, null], [2, 3]], 'extra input'], kwargs: { fill: 9 },
    expected: [[1, 2], [null, 3]], assertArgsUnchanged: true };
  const observation = { id: record.checkId, requirementId: 'R01', status: 'fail', message: 'Synthetic mismatch.', actual: {
    outcome: [[1, 2], [9, 3]], argsAfter: structuredClone(definition.args), kwargsAfter: { fill: 9 } },
    expected: { outcome: [[1, 2], [null, 3]], argsAfter: structuredClone(definition.args), kwargsAfter: { fill: 9 } } };
  const after: any = structuredClone(observation);
  if (kind === 'success') { after.status = 'pass'; after.actual.outcome = structuredClone(definition.expected); }
  const source = 'def transpose(rows, extra, fill=0):\n    return rows\n';
  const proposal = 'def transpose(rows, extra, fill=0):\n    return list(rows)\n';
  const candidate = { id: 2, accepted: kind === 'success', summary: 'Synthetic model summary.', files: { 'example.py': proposal },
    diff: 'diff --git a/example.py b/example.py\n--- a/example.py\n+++ b/example.py\n@@ -1,2 +1,2 @@\n def transpose(rows, extra, fill=0):\n-    return rows\n+    return list(rows)\n',
    visibleChecks: [after], acceptanceChecks: [], rejectionReason: kind === 'success' ? null : 'declared_checks_not_satisfied' };
  return { mode: 'live', bundleDigest: record.digest,
    runtimeLock: { execution: { modelProvider: 'nebius-token-factory', checkBackend: 'local_container' } },
    fixture: { id: record.taskId, title: 'Synthetic parser fixture', description: 'Synthetic task description.', entrypoint: 'example.py', files: { 'example.py': source },
      requirements: [{ id: 'R01', text: 'Preserve the declared cells and arguments.' }], visibleCases: [definition], acceptanceCases: [] },
    run: { id: record.id, taskId: record.taskId, phase: 'terminal', mode: 'live', selectedCandidateId: 2,
      terminalStatus: kind === 'success' ? 'verified_for_declared_checks' : 'failed', reason: kind === 'success' ? 'declared_local_checks_passed' : 'declared_checks_not_satisfied',
      usage: { inferenceCalls: 3, elapsedMs: 34000 }, baselineChecks: { visible: [structuredClone(observation)], acceptance: [] },
      candidates: [{ ...structuredClone(candidate), id: 1, accepted: false, files: { 'example.py': 'earlier proposal' }, visibleChecks: [structuredClone(observation)] }, candidate,
        ...(kind === 'failure' ? [{ ...structuredClone(candidate), id: 3, visibleChecks: [{ ...structuredClone(observation), status: 'error', actual: null }] }] : [])] } };
}

test('walkthrough retains every argument, source, diff, requirement and attempt while separating mutation observations', () => {
  const input = projectionInput('failure'); const result = projectStory(input); assert.ok(result);
  assert.deepEqual(result.input, [[1, null], [2, 3]]);
  assert.deepEqual(result.args, [[[1, null], [2, 3]], 'extra input']);
  assert.deepEqual(result.kwargs, { fill: 9 });
  assert.deepEqual(result.expected, [[1, 2], [null, 3]]);
  assert.deepEqual(result.before, [[1, 2], [9, 3]]); assert.deepEqual(result.after, [[1, 2], [9, 3]]);
  assert.equal(result.candidateId, 2); assert.equal(result.afterSource, input.run.candidates[1].files['example.py']);
  assert.equal(result.diff, input.run.candidates[1].diff); assert.equal(result.requirements.length, 1);
  assert.equal(result.attempts.length, 3); assert.equal(result.attempts[2].checks[0].status, 'error');
  assert.notDeepEqual(result.after, input.run.candidates[1].visibleChecks[0].actual);
  input.fixture.visibleCases[0].args[0][0][0] = 77;
  input.run.candidates[1].visibleChecks[0].actual.outcome[0][0] = 88;
  assert.deepEqual(result.input, [[1, null], [2, 3]], 'Display data is detached from mutable transport.');
  assert.deepEqual(result.after, [[1, 2], [9, 3]]);
});

test('walkthrough never substitutes a mock, mismatched identity, incomplete observation or wrong outcome', () => {
  const mutations = [
    (input: any) => { input.mode = 'mock'; }, (input: any) => { input.run.mode = 'mock'; },
    (input: any) => { input.bundleDigest = 'sha256:' + '0'.repeat(64); },
    (input: any) => { input.run.id = 'unrelated'; }, (input: any) => { input.run.taskId = 'unrelated'; },
    (input: any) => { input.fixture.id = 'other-task'; }, (input: any) => { input.run.phase = 'repair'; },
    (input: any) => { input.run.selectedCandidateId = 99; }, (input: any) => { input.fixture.visibleCases[0].id = 'other-case'; },
    (input: any) => { input.run.baselineChecks.visible[0].status = 'error'; },
    (input: any) => { input.run.candidates[1].visibleChecks[0].status = 'error'; },
    (input: any) => { input.run.candidates[1].visibleChecks[0].actual = null; },
    (input: any) => { input.run.candidates[1].visibleChecks[0].actual = { argsAfter: [] }; },
    (input: any) => { input.fixture.files = {}; }, (input: any) => { input.run.candidates[1].files = {}; },
    (input: any) => { input.run.candidates[1].accepted = false; },
    (input: any) => { input.run.terminalStatus = 'failed'; },
  ];
  for (const mutate of mutations) { const input = projectionInput(); mutate(input); assert.equal(projectStory(input), null, String(mutate)); }
  assert.equal(projectStory(null), null); assert.equal(projectStory({}), null);
  const failure = projectionInput('failure'); failure.run.candidates[1].accepted = true; failure.run.terminalStatus = 'verified_for_declared_checks';
  assert.equal(projectStory(failure), null, 'A passed run cannot become a failed example by presentation metadata.');
});

test('observed null and an object named outcome are returned data when the check does not wrap arguments', () => {
  const input = projectionInput('failure');
  input.run.candidates[1].visibleChecks[0].actual.outcome = null;
  assert.equal(projectStory(input).after, null);
  input.run.candidates[1].visibleChecks[0].actual = null;
  assert.equal(projectStory(input), null, 'A missing mutation wrapper is unavailable.');
  input.fixture.visibleCases[0].assertArgsUnchanged = false;
  assert.equal(projectStory(input).after, null, 'An unwrapped recorded null is a legitimate return.');
  input.run.candidates[1].visibleChecks[0].actual = { outcome: 'actual object key', extra: true };
  assert.deepEqual(projectStory(input).after, { outcome: 'actual object key', extra: true });
});

test('a public development acceptance case can anchor the same complete story', () => {
  const input = projectionInput('failure');
  input.fixture.acceptanceCases = input.fixture.visibleCases; input.fixture.visibleCases = [];
  input.run.baselineChecks.acceptance = input.run.baselineChecks.visible; input.run.baselineChecks.visible = [];
  input.run.candidates[1].acceptanceChecks = input.run.candidates[1].visibleChecks; input.run.candidates[1].visibleChecks = [];
  const result = projectStory(input); assert.ok(result); assert.equal(result.definition.id, storyRecords.failure.checkId);
  assert.deepEqual(result.args, [[[1, null], [2, 3]], 'extra input']);
});

test('both recorded outcomes have complete four-stage walkthroughs, actual diffs and mobile-readable history', async t => {
  const assets = new Map<string, Buffer>();
  for (const name of ['walkthrough.js', 'diff-view.js', 'style.css']) assets.set('/' + name, await readFile(new URL('../apps/web/' + name, import.meta.url)));
  const server = createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main><div id="story"></div></main></body></html>'); return; }
    if (assets.has(req.url!)) { res.setHeader('Content-Type', req.url!.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(assets.get(req.url!)); return; }
    res.statusCode = 404; res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.evaluate(async inputs => {
    const path = '/walkthrough.js'; const api = await import(path);
    (window as any).renderStage = (stage: string) => {
      const state = { ready: true, runs: new Map(inputs.map((input: any) => [input.run.id, input.run])),
        contexts: new Map(inputs.map((input: any) => [input.run.id, { status: 'ready', story: api.projectStory(input) }])) };
      api.renderStory(document.getElementById('story'), state, stage);
    };
  }, [projectionInput('success'), projectionInput('failure')]);
  for (const prefix of ['', 'failed-']) {
    for (const stage of ['bug', 'patch', 'checks', 'decision']) {
      await page.evaluate(value => (window as any).renderStage(value), prefix + stage);
      assert.equal(await page.locator('#story').getAttribute('data-state'), 'ready');
      assert.equal(await page.locator('.story-step').count(), 4);
      assert.equal(await page.locator('.story-step[aria-current="step"]').getAttribute('href'), `#story/${prefix}${stage}`);
      if (stage === 'bug') { assert.match(await page.locator('.story-values').innerText(), /extra input/); assert.match(await page.locator('.story-source').first().innerText(), /def transpose/); }
      if (stage === 'patch') { assert.equal(await page.locator('.github-diff').count(), 1); assert.match(await page.locator('.github-diff').innerText(), /return list\(rows\)/); }
      if (stage === 'checks') { assert.match(await page.locator('.story-requirements').innerText(), /R01/); await page.getByText('Exact check input and observations', { exact: true }).click(); assert.match(await page.locator('.check-log').innerText(), /argsAfter/); }
      if (stage === 'decision') { assert.equal(await page.locator('.story-attempts tbody tr').count(), prefix ? 3 : 2); assert.equal(await page.getByRole('link', { name: 'Download this run’s evidence' }).count(), 1); }
    }
  }
  await page.evaluate(() => (window as any).renderStage('failure'));
  assert.equal(await page.locator('.story-step[aria-current="step"]').getAttribute('href'), '#story/failed-bug');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const stage of ['failed-bug', 'failed-patch', 'failed-checks', 'failed-decision']) {
      await page.evaluate(value => (window as any).renderStage(value), stage);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${stage} fits ${width}px.`);
      const active = await page.locator('.story-step[aria-current="step"]').boundingBox();
      const navigation = await page.locator('.story-steps').boundingBox();
      assert.ok(active && navigation && active.x >= navigation.x - 1 && active.x + active.width <= navigation.x + navigation.width + 1, 'The selected mobile step label is fully visible.');
    }
  }
  await page.evaluate(() => (window as any).renderStage('failed-decision'));
  assert.match(await page.locator('.story-attempts').innerText(), /1 error/);
  assert.match(await page.locator('.story-verdict').innerText(), /No candidate was accepted/);
  assert.deepEqual(errors, []);
});
