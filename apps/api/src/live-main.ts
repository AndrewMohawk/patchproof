import { lstat, chmod, unlink } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createLiveApplication } from './live-application.ts';

async function main() {
  if (process.argv.length !== 3) throw new Error('explicit_private_config_required');
  const app = await createLiveApplication(new URL('../../../', import.meta.url), process.argv[2]!);
  const socket = app.config.socketFile;
  try {
    const stat = await lstat(socket).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat) {
      if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error('socket_owner_mismatch');
      const active = await new Promise<boolean>((resolve, reject) => {
        const client = createConnection(socket);
        client.setTimeout(1000, () => { client.destroy(); reject(new Error('socket_probe_timeout')); });
        client.once('connect', () => { client.destroy(); resolve(true); });
        client.once('error', error => { client.destroy(); if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve(false); else reject(error); });
      });
      if (active) throw new Error('socket_already_active');
      await unlink(socket);
    }
    await new Promise<void>((resolve, reject) => { app.server.once('error', reject); app.server.listen(socket, () => resolve()); });
    await chmod(socket, 0o660);
    process.stdout.write('PatchProof live: Token Factory inference and isolated local checks; private Unix socket ready.\n');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; app.server.close(); await app.close(); app.server.closeAllConnections(); };
    process.once('SIGTERM', () => { void close().then(() => process.exit(0)); });
    process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
  } catch (error) { app.server.close(); await app.close(); throw error; }
}
main().catch(() => { process.stderr.write('PatchProof live startup failed; inspect the pinned configuration and runtime gates.\n'); process.exitCode = 1; });
