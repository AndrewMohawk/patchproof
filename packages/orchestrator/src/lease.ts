import { open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function acquireCoordinatorLease(directory: string): Promise<() => Promise<void>> {
  const path = join(directory, 'coordinator.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); } finally { await handle.close(); }
      return async () => {
        const current = JSON.parse(await readFile(path, 'utf8'));
        if (current.token === token) await unlink(path);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error;
      const owner = JSON.parse(await readFile(path, 'utf8')) as { pid?: number };
      if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0) throw new Error('Invalid coordinator lease; inspect task state.');
      try { process.kill(owner.pid!, 0); }
      catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { await unlink(path); continue; }
        throw probe;
      }
      throw new Error('A PatchProof coordinator is already running for this state directory.');
    }
  }
  throw new Error('Could not acquire coordinator lease.');
}
