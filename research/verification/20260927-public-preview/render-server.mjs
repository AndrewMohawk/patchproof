import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Read-only metadata surface. No execution modules or factories are imported.
const tasks = JSON.parse(await readFile(new URL('./catalogue.json', import.meta.url), 'utf8'));
const entries = await Promise.all([
  ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'],
].map(async ([path, file, type]) => [path, { bytes: await readFile(new URL(`../../apps/web/${file}`, import.meta.url)), type }]));
const assets = new Map(entries);
const requests = [];
const server = createServer((req, res) => {
  requests.push({ method: req.method, path: req.url });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.method !== 'GET') { req.resume(); json({ error: { message: 'Metadata-only surface; execution unavailable.' } }, 405); return; }
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const asset = assets.get(path);
  if (asset) { res.writeHead(200, { 'Content-Type': asset.type }); res.end(asset.bytes); return; }
  if (path === '/tasks') {
    json({ mode: 'mock', tasks, competitionReady: false, maxApprovedSpendUsd: 25, realExecutionEnabled: false,
      capabilities: { createRuns: true, cancelRuns: false, streamEvents: false, replay: false },
      limits: { inferenceCallLimit: 3, inputTokenLimit: 24000, outputTokenLimit: 6000, wallTimeLimitSeconds: 120, sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 0 } }); return;
  }
  if (path === '/runs') { json({ runs: [] }); return; }
  json({ error: { message: 'Not found in metadata-only surface.' } }, 404);
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const address = server.address();
const info = { base: `http://127.0.0.1:${address.port}`, pid: process.pid, clientCommit: '0b605f26453409e474587270fdf9292a7ec4aaf3',
  appDigest: `sha256:${createHash('sha256').update(assets.get('/app.js').bytes).digest('hex')}` };
await writeFile(new URL('./server.json', import.meta.url), JSON.stringify(info, null, 2) + '\n');
console.log(JSON.stringify(info));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await writeFile(new URL('./requests.json', import.meta.url), JSON.stringify(requests, null, 2) + '\n');
  server.close(); server.closeAllConnections();
});
