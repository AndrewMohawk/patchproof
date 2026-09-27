import { readFile } from 'node:fs/promises';
import { createMockServer } from './server.ts';

const runtimeLock = JSON.parse(await readFile(new URL('../../../runtime-lock.json', import.meta.url), 'utf8'));
const rawPort = process.env.PATCHPROOF_PORT ?? '43171';
if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) > 65535 || Number(rawPort) < 1024) {
  throw new Error('PATCHPROOF_PORT must be an unprivileged port (1024–65535).');
}
const port = Number(rawPort);
const { server, coordinator } = createMockServer(runtimeLock);
server.on('error', error => {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(code === 'EADDRINUSE' ? 'PatchProof port is occupied; set PATCHPROOF_PORT to a free unprivileged port.' : 'PatchProof could not start its loopback listener.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`PatchProof MOCK contract inspector: http://127.0.0.1:${port}`);
  console.log('No inference, sandbox execution or patch verification. State is memory-only.');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.closeAllConnections();
    server.close(() => { void coordinator.settled().then(() => process.exit(0)); });
  });
}
