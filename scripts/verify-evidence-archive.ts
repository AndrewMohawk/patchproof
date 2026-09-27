import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createEvidenceArchive } from '../apps/api/src/evidence-archive.ts';
import { createProductServer } from '../apps/api/src/product-server.ts';
import type { Coordinator } from '../packages/orchestrator/src/coordinator.ts';
import { publicTask } from '../packages/orchestrator/src/fixtures.ts';
import { prepareArchiveFixture, syntheticArchiveBundle } from '../tests/helpers/archive-fixture.ts';

const fixture = await prepareArchiveFixture([syntheticArchiveBundle('live'), syntheticArchiveBundle('mock', '2.0', 'baseline')]);
const app = await createEvidenceArchive(fixture);
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const address = app.server.address(); assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const close = async () => { app.server.closeAllConnections(); await new Promise<void>(done => app.server.close(() => done())); await fixture.close(); };
if (process.argv.includes('--serve')) {
  console.log(JSON.stringify({ base, scope: 'synthetic archive only; no execution', runIds: fixture.bundles.map(bundle => bundle.run.id) }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close().then(() => process.exit(0)); });
} else {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors: string[] = [], mutationRequests: string[] = [], eventRequests: string[] = [], checks: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.method() !== 'GET') mutationRequests.push(request.method()); if (new URL(request.url()).pathname.endsWith('/events')) eventRequests.push(request.url()); });
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByText('Recorded evidence · Read only', { exact: true }).first().waitFor();
    assert.match(await page.title(), /PatchProof/);
    assert.equal(await page.getByRole('button', { name: /^(Run|Compare all three|Cancel run)/ }).count(), 0);
    assert.equal(await page.locator('#compare-run').isHidden(), true);
    assert.equal(await page.locator('#compare-run').isDisabled(), true); checks.push('archive task controls are read only');
    const task = page.getByRole('button', { name: /Synthetic archive example/ }); await task.focus(); await page.keyboard.press('Enter');
    assert.match(await page.locator('#task-detail').innerText(), /Preserve the declared value/); checks.push('keyboard task selection');
    await page.getByRole('link', { name: 'Review recorded evidence →' }).click();
    await page.locator('#evidence').getByText('RECORDED LIVE · READ ONLY', { exact: true }).waitFor();
    assert.match(await page.locator('.run-summary').innerText(), /Checks failed/);
    assert.match(await page.locator('.reproduce-command').innerText(), /CONFIG=<private-replay.json> CONFIG_DIGEST=<digest>/);
    assert.match(await page.locator('#evidence').innerText(), /Synthetic archive verification fixture/);
    assert.match(await page.locator('#evidence').innerText(), /Not measured/); checks.push('recorded live provenance, unknown usage and private replay label');
    assert.match(await page.locator('.diff').innerText(), /<img src=x/);
    assert.equal(await page.locator('.diff img').count(), 0);
    assert.equal(await page.evaluate(() => (globalThis as Record<string, unknown>).archiveInjected), undefined); checks.push('patch markup rendered literally');
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download evidence ↓' }).click();
    const downloaded = await downloadPromise, path = await downloaded.path(); assert.ok(path);
    assert.deepEqual(await readFile(path), fixture.bytes[0]); checks.push('exact archived bytes download');
    await page.screenshot({ path: '/tmp/patchproof-evidence-archive-desktop.png', fullPage: true });
    await page.locator('#evidence-run').selectOption(fixture.bundles[1]!.run.id);
    await page.locator('#evidence').getByText('RECORDED MOCK · READ ONLY', { exact: true }).waitFor(); checks.push('historical recorded mock display');
    await page.getByRole('link', { name: '02 Compare', exact: true }).click();
    assert.match(await page.locator('#comparison').innerText(), /No recorded run for this approach/);
    assert.equal(await page.getByRole('button', { name: /^Run/ }).count(), 0); checks.push('comparison preserves missing approaches without launch controls');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/#evidence/${fixture.bundles[0]!.run.id}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#evidence').getByText('RECORDED LIVE · READ ONLY', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: '/tmp/patchproof-evidence-archive-mobile.png', fullPage: true }); checks.push('mobile evidence without horizontal page overflow');
    await page.reload(); await page.locator('#evidence').getByText('RECORDED LIVE · READ ONLY', { exact: true }).waitFor(); checks.push('recorded route survives reload');
    assert.deepEqual(errors, []); assert.deepEqual(mutationRequests, []); assert.deepEqual(eventRequests, []); checks.push('no archive browser errors, mutation requests or active event streams');
    // Separate synthetic HTTP fixture exercises the existing mock UI capability path without a runtime.
    const mockBundle = fixture.bundles[1]!, requests: unknown[] = [];
    const mockServer = createProductServer({ tasks: () => [{ ...publicTask(mockBundle.fixture), mockSupported: true }], list: () => [],
      create: (request: unknown) => { requests.push(request); return { reused: false, run: mockBundle.run }; },
      get: () => mockBundle.run, evidence: async () => mockBundle,
    } as unknown as Coordinator, { approvedSpendUsd: 25, localRuntime: { available: true, image: null, reason: null } });
    mockServer.listen(0, '127.0.0.1'); await once(mockServer, 'listening');
    const mockAddress = mockServer.address(); assert.ok(mockAddress && typeof mockAddress !== 'string');
    const mockPage = await browser.newPage();
    try {
      await mockPage.goto(`http://127.0.0.1:${mockAddress.port}`, { waitUntil: 'domcontentloaded' });
      await mockPage.getByText('Mock model · Local checks', { exact: true }).first().waitFor();
      const launch = mockPage.getByRole('button', { name: 'Run PatchProof →' });
      assert.equal(await launch.isEnabled(), true); await launch.click();
      await mockPage.locator('#evidence').getByText('MOCK MODEL · LOCAL CHECKS', { exact: true }).waitFor();
      assert.equal(requests.length, 1); assert.equal((requests[0] as { mode: string }).mode, 'mock');
      checks.push('existing mock surface still enables only its mock launch flow');
    } finally { await mockPage.close(); mockServer.closeAllConnections(); await new Promise<void>(done => mockServer.close(() => done())); }
    const receipt = { kind: 'evidence-archive-browser-verification', scope: 'invented unit bundles only', status: 'passed', checks,
      mode: 'archive', recordedModesTested: ['live', 'mock'], realProviderEvidence: false, providerCalls: 0, candidateExecutions: 0,
      screenshots: ['/tmp/patchproof-evidence-archive-desktop.png', '/tmp/patchproof-evidence-archive-mobile.png'] };
    await mkdir(new URL('../.local/verification/', import.meta.url), { recursive: true, mode: 0o700 });
    await writeFile(new URL('../.local/verification/evidence-archive-browser.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  } finally { await browser.close(); await close(); }
}
