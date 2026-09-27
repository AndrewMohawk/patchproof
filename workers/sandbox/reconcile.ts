import { z } from 'zod';
import type { ProcessRunner } from './process.ts';

interface ReconcileResult { remainingOperationIds: string[]; error: string | null; }
const containerSchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/),
  Name: z.string().regex(/^\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
  Config: z.object({ Labels: z.record(z.string(), z.string()) }),
});
const missingContainer = (stderr: string) => /No such (container|object)/i.test(stderr);

/** Caller must first prove the owning coordinator is dead and hold its exclusive lease. */
export async function reconcileContainers(process: ProcessRunner, runIds: string[]): Promise<ReconcileResult> {
  if (!z.array(z.uuid()).safeParse(runIds).success) return { remainingOperationIds: [], error: 'invalid_recovery_run_ids' };
  const remaining = new Set<string>();
  const errors = new Set<string>();
  for (const runId of new Set(runIds)) {
    const list = async (): Promise<string[] | null> => {
      const result = await process(['ps', '-a', '-q', '--no-trunc', '--filter', 'label=org.patchproof.owned=true',
        '--filter', `label=org.patchproof.run-id=${runId}`], { timeoutMs: 5000 });
      if (result.error || result.code !== 0) { errors.add('container_recovery_list_failed'); return null; }
      const ids = result.stdout.trim() ? result.stdout.trim().split(/\s+/) : [];
      if (ids.some(id => !/^[a-f0-9]{64}$/.test(id))) { errors.add('container_recovery_invalid_listing'); return null; }
      return [...new Set(ids)];
    };
    const ids = await list();
    if (ids === null) continue;
    const names = new Map<string, string>();
    for (const id of ids) {
      const inspected = await process(['container', 'inspect', id, '--format', '{{json .}}'], { timeoutMs: 5000 });
      if (inspected.error || inspected.code !== 0) {
        if (!inspected.error && missingContainer(inspected.stderr)) continue;
        remaining.add(`docker:${id}`);
        errors.add('container_recovery_inspection_failed');
        continue;
      }
      let container: z.infer<typeof containerSchema>;
      try { container = containerSchema.parse(JSON.parse(inspected.stdout)); }
      catch { remaining.add(`docker:${id}`); errors.add('container_recovery_invalid_inspection'); continue; }
      // Independently confirm exact ownership; never trust the listing filter alone.
      if (container.Id !== id || container.Config.Labels['org.patchproof.owned'] !== 'true' ||
          container.Config.Labels['org.patchproof.run-id'] !== runId) {
        remaining.add(`docker:${id}`);
        errors.add('container_recovery_ownership_mismatch');
        continue;
      }
      const operationId = `docker:${container.Name.slice(1)}`;
      names.set(id, operationId);
      remaining.add(operationId);
      const removed = await process(['rm', '-f', id], { timeoutMs: 5000 });
      if (removed.error || (removed.code !== 0 && !missingContainer(removed.stderr))) errors.add('container_recovery_removal_failed');
    }
    const after = await list();
    if (after === null) {
      for (const id of ids) remaining.add(names.get(id) ?? `docker:${id}`);
      continue;
    }
    for (const id of ids) {
      if (!after.includes(id)) { remaining.delete(`docker:${id}`); remaining.delete(names.get(id) ?? `docker:${id}`); }
    }
    for (const id of after) remaining.add(names.get(id) ?? `docker:${id}`);
    if (after.length) errors.add('container_recovery_incomplete');
  }
  return { remainingOperationIds: [...remaining], error: errors.size ? [...errors].join(';') : null };
}
