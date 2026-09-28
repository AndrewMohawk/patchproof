import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Run after the real recording is installed. This verifier only issues GETs.
const out = path.dirname(fileURLToPath(import.meta.url));
const origin = 'https://patchproof.andrewmohawk.xyz';
const source = '/mnt/raid1-sata-16tb/homelab_data/patchproof/media/patchproof-real-demo.mp4';
const report = { checkedAt: new Date().toISOString(), paidRequests: 0, errors: [], checks: [] };
const check = (name, passed, detail) => {
  report.checks.push({ name, passed, detail });
  if (!passed) report.errors.push(name);
};
const local = await readFile(source);
report.sha256 = createHash('sha256').update(local).digest('hex');
report.bytes = local.byteLength;
report.mode = (await stat(source)).mode & 0o777;
report.ffprobe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', source], { encoding: 'utf8' }));
check('recording_under_three_minutes', Number(report.ffprobe.format.duration) < 180, report.ffprobe.format.duration);
check('media_readable_by_frontend', (report.mode & 0o004) !== 0, report.mode.toString(8));
const downloaded = '/tmp/patchproof-judge-final-video-check.mp4';
const curl = JSON.parse(execFileSync('curl', ['--max-time', '60', '--silent', '--show-error',
  '--output', downloaded, '--write-out', '%{json}', `${origin}/demo/patchproof-real-demo.mp4?v=judge-e15b625-evidence`], { encoding: 'utf8' }));
const remote = await readFile(downloaded);
report.publicDownload = { status: curl.http_code, bytes: remote.byteLength, seconds: curl.time_total,
  sha256: createHash('sha256').update(remote).digest('hex'), tlsVerificationResult: curl.ssl_verify_result };
check('public_download_matches_installed_file', curl.http_code === 200 && report.publicDownload.sha256 === report.sha256, report.publicDownload);
const edge = execFileSync('dig', ['+short', 'A', 'patchproof.andrewmohawk.xyz', '@1.1.1.1'], { encoding: 'utf8' }).trim().split('\n').find(x => /^\d+\.\d+\.\d+\.\d+$/.test(x));
const rangeHeader = path.join(out, 'cloudflare-video-range.headers');
const rangeBody = path.join(out, 'cloudflare-video-range.body');
const range = JSON.parse(execFileSync('curl', ['--max-time', '30', '--silent', '--show-error',
  '--resolve', `patchproof.andrewmohawk.xyz:443:${edge}`, '--header', 'Range: bytes=0-1023',
  '--dump-header', rangeHeader, '--output', rangeBody, '--write-out', '%{json}',
  `${origin}/demo/patchproof-real-demo.mp4?v=judge-e15b625-evidence`], { encoding: 'utf8' }));
const ranged = await readFile(rangeBody);
const rangedHeaders = await readFile(rangeHeader, 'utf8');
report.cloudflareRange = { status: range.http_code, remoteIp: range.remote_ip,
  bytes: ranged.byteLength, seconds: range.time_total, tlsVerificationResult: range.ssl_verify_result };
check('cloudflare_range_playback', range.http_code === 206 && ranged.equals(local.subarray(0, 1024))
  && /server: cloudflare/i.test(rangedHeaders) && /content-range: bytes 0-1023\//i.test(rangedHeaders), report.cloudflareRange);

report.browserCloudflareIp = edge;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', `--host-resolver-rules=MAP patchproof.andrewmohawk.xyz ${edge}`] });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.method() !== 'GET' || new URL(request.url()).origin !== origin) {
        errors.push(`Blocked unexpected ${request.method()} request`);
        await route.abort();
      } else await route.continue();
    });
    await page.goto(`${origin}/demo/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('video').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 30000 });
    await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 1, null, { timeout: 30000 });
    const metadata = await page.locator('video').evaluate(video => ({
      duration: video.duration, currentTime: video.currentTime, paused: video.paused,
      readyState: video.readyState, width: video.videoWidth, height: video.videoHeight,
      error: video.error?.message || null, controls: video.controls, currentSrc: video.currentSrc,
    }));
    check(`browser_${viewport.width}_playing`, !metadata.paused && metadata.currentTime >= 1
      && Math.abs(metadata.duration - Number(report.ffprobe.format.duration)) < 0.1 && metadata.width > 0 && !metadata.error
      && metadata.currentSrc === `${origin}/demo/patchproof-real-demo.mp4?v=judge-e15b625-evidence`, metadata);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(`browser_${viewport.width}_no_overflow`, !overflow, { overflow });
    await page.locator('video').evaluate(video => { video.pause(); video.currentTime = Math.min(10, video.duration / 2); });
    await page.waitForFunction(() => !document.querySelector('video')?.seeking, null, { timeout: 30000 });
    const screenshot = `/tmp/patchproof-real-video-${viewport.width}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await copyFile(screenshot, path.join(out, `public-video-${viewport.width}.png`));
    check(`browser_${viewport.width}_no_errors`, errors.length === 0, errors);
    await context.close();
  }
} catch (error) { report.errors.push(error.message); }
finally {
  await browser.close();
  await writeFile(path.join(out, 'video-receipt.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ receipt: path.join(out, 'video-receipt.json'), checks: report.checks, errors: report.errors }, null, 2));
process.exitCode = report.errors.length ? 1 : 0;
