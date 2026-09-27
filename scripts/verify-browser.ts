import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../apps/api/src/application.ts';

const root = new URL('../', import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'patchproof-browser-'));
const app = await createApplication(root, directory);
const startedAt = new Date().toISOString();
let observerPassed = false;
try {
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback listener.');
  const result = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('apps/web/verify-browser.ts', root)), `http://127.0.0.1:${address.port}`],
    { cwd: fileURLToPath(root), timeout: 160_000, maxBuffer: 2_000_000 });
  observerPassed = true;
  process.stdout.write(result.stdout);
} finally {
  let exportsPreserved = false;
  try {
    // An observer failure must not discard unfinished or unsuccessful actual runs.
    await app.coordinator.settled();
    await mkdir(new URL('artifacts/', root), { recursive: true });
    const ids: string[] = [];
    for (const run of app.coordinator.list()) {
      const bundle = await app.coordinator.evidence(run.id);
      await writeFile(new URL(`artifacts/${run.id}.json`, root), JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      ids.push(run.id);
    }
    await mkdir(new URL('.local/verification/', root), { recursive: true });
    await writeFile(new URL(`.local/verification/browser-attempt-${startedAt.replace(/[:.]/g, '-')}.json`, root),
      JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), observerPassed, exportedRunIds: ids, mode: 'mock' }, null, 2) + '\n', { flag: 'wx' });
    exportsPreserved = true;
  } finally {
    app.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
    await app.close();
    if (exportsPreserved) await rm(directory, { recursive: true, force: true });
    else process.stderr.write(`Evidence preservation failed; run journal retained at ${directory}\n`);
  }
}
