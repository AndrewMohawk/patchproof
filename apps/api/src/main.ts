import { createApplication } from './application.ts';

const rawPort = process.env.PATCHPROOF_PORT ?? '43171';
if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) > 65535 || Number(rawPort) < 1024) {
  throw new Error('PATCHPROOF_PORT must be an unprivileged port (1024–65535).');
}
const port = Number(rawPort);
const { server, close } = await createApplication(new URL('../../../', import.meta.url));
server.on('error', error => {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(code === 'EADDRINUSE' ? 'PatchProof port is occupied; set PATCHPROOF_PORT to a free unprivileged port.' : 'PatchProof could not start its loopback listener.');
  process.exitCode = 1;
  void close();
});
server.listen(port, '127.0.0.1', () => {
  console.log(`PatchProof: http://127.0.0.1:${port}`);
  console.log('Mock model with real isolated local checks. No paid provider calls.');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.closeAllConnections();
    server.close(() => { void close().then(() => process.exit(0)); });
  });
}
