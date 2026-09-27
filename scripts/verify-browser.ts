import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createMockServer } from '../apps/api/src/server.ts';
import { verifyBundle } from '../packages/mock/src/bundle.ts';
import { writeBundle } from '../packages/mock/src/store.ts';

const root = new URL('../', import.meta.url);
const lock = JSON.parse(await readFile(new URL('runtime-lock.json', root), 'utf8'));
const { server } = createMockServer(lock);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(await page.title(), 'PatchProof — mock contract inspector');
  assert.match(await page.locator('.notice').innerText(), /MOCK.*Not competition-ready/);
  await page.getByRole('button', { name: 'Create mock record', exact: true }).click();
  await page.getByRole('link', { name: 'Download mock evidence' }).waitFor();
  assert.equal(await page.locator('#status').innerText(), 'MOCK · needs_review · $0 spent');
  assert.equal(await page.locator('#events li').count(), 4);
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('link', { name: 'Download mock evidence' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bundle = verifyBundle(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  assert.equal(download.suggestedFilename(), `${bundle.run.id}.json`);
  await writeBundle(root, 'artifacts/', bundle);
  const { stdout } = await promisify(execFile)(process.execPath,
    [new URL('scripts/cli.ts', root).pathname, 'reproduce', bundle.run.id, bundle.bundleDigest]);
  const replay = JSON.parse(stdout);
  assert.equal(replay.integrityBasis, 'provided_digest');
  assert.equal(replay.executionPerformed, false);
  assert.equal(replay.authenticityVerified, false);
  const desktopScreenshot = '/tmp/patchproof-contract-desktop.png';
  const mobileScreenshot = '/tmp/patchproof-contract-mobile.png';
  await page.screenshot({ path: desktopScreenshot, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'Mobile page must not require horizontal scrolling.');
  assert.ok(await page.getByRole('link', { name: 'Download mock evidence' }).isVisible());
  await page.screenshot({ path: mobileScreenshot, fullPage: true });
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(base + '/')), 'Browser requests must remain on this loopback app.');
  const report = {
    testedAt: new Date().toISOString(), mode: 'mock', competitionReady: false,
    status: 'passed', browserVersion: browser.version(), runId: bundle.run.id,
    checks: ['task selection', 'mock labels', 'handler events', 'download', 'CLI integrity verification',
      'mobile layout', 'no browser errors', 'only loopback requests'],
    artifact: `artifacts/${bundle.run.id}.json`, bundleDigest: bundle.bundleDigest,
    screenshots: [desktopScreenshot, mobileScreenshot], replay,
  };
  await mkdir(new URL('.local/verification/', root), { recursive: true });
  await writeFile(new URL('.local/verification/browser.json', root), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
