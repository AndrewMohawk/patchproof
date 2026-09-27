import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createEvidenceArchive, EvidenceArchiveError } from '../apps/api/src/evidence-archive.ts';

export async function evidenceArchiveMain(args: string[], projectRoot = fileURLToPath(new URL('../', import.meta.url))) {
  const [configFile, expectedConfigDigest, rawPort = '43173', ...extra] = args;
  if (!configFile || !expectedConfigDigest || extra.length || !/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535) {
    throw new EvidenceArchiveError('archive_usage');
  }
  const app = await createEvidenceArchive({ projectRoot, configFile, expectedConfigDigest });
  await new Promise<void>((done, reject) => {
    app.server.once('error', reject);
    app.server.listen(Number(rawPort), '127.0.0.1', () => { app.server.off('error', reject); done(); });
  });
  const close = () => { app.server.closeAllConnections(); app.server.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  console.log(JSON.stringify({ mode: 'archive', readOnly: true, url: `http://127.0.0.1:${rawPort}`, ...app.manifest,
    executionPerformed: false, authenticityVerified: false }));
  return app;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  evidenceArchiveMain(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify({ mode: 'archive', executionPerformed: false,
      error: { code: error instanceof EvidenceArchiveError ? error.code : 'archive_unavailable' } }));
    process.exitCode = 2;
  });
}
