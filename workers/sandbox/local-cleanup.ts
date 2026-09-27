import { z } from 'zod';
import type { ProcessRunner } from './process.ts';

export interface OwnedContainer {
  name: string; image: string; ownerRunId?: string; id?: string;
}
export interface OwnedInspection {
  state: 'present' | 'missing' | 'error'; id: string | null; reason: string | null;
}
const container = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/), Name: z.string(), Image: z.string(),
  Config: z.object({ Labels: z.record(z.string(), z.string()) }),
});
const missing = (stderr: string) => /No such (container|object)/i.test(stderr);

/** Inspect the exact handle and independently establish ownership before any removal/start. */
export async function inspectOwnedContainer(process: ProcessRunner, expected: OwnedContainer, timeoutMs: number, signal?: AbortSignal): Promise<OwnedInspection> {
  const result = await process(['container', 'inspect', expected.id ?? expected.name, '--format', '{{json .}}'],
    { timeoutMs: Math.max(1, timeoutMs), ...(signal ? { signal } : {}) });
  if (!result.error && result.code !== 0 && missing(result.stderr)) return { state: 'missing', id: null, reason: null };
  if (result.error || result.code !== 0) return { state: 'error', id: null, reason: 'inspection_failed' };
  const parsed = (() => { try { return container.safeParse(JSON.parse(result.stdout)); } catch { return null; } })();
  if (!parsed?.success) return { state: 'error', id: null, reason: 'invalid_inspection' };
  const value = parsed.data, labels = value.Config.Labels;
  if (expected.id !== undefined && value.Id !== expected.id || value.Name !== '/' + expected.name || value.Image !== expected.image ||
      labels['org.patchproof.owned'] !== 'true' || labels['org.patchproof.operation'] !== expected.name ||
      labels['org.patchproof.run-id'] !== expected.ownerRunId) return { state: 'error', id: null, reason: 'ownership_mismatch' };
  return { state: 'present', id: value.Id, reason: null };
}

/** Absence alone is insufficient when create was never acknowledged. No original abort signal is used. */
export async function cleanupOwnedContainer(process: ProcessRunner, original: OwnedContainer, acknowledged: boolean,
  options: { timeoutMs?: number; pollMs?: number } = {}): Promise<{ confirmed: boolean; id: string | null; reason: string | null }> {
  const deadline = performance.now() + (options.timeoutMs ?? 5000), pollMs = options.pollMs ?? 100;
  const expected = { ...original }; let observed = acknowledged, lastReason = 'create_unacknowledged';
  while (performance.now() < deadline) {
    let inspected: OwnedInspection;
    try { inspected = await inspectOwnedContainer(process, expected, Math.min(1000, deadline - performance.now())); }
    catch { inspected = { state: 'error', id: null, reason: 'inspection_failed' }; }
    if (inspected.state === 'error') return { confirmed: false, id: expected.id ?? null, reason: inspected.reason };
    if (inspected.state === 'missing' && observed) return { confirmed: true, id: expected.id ?? null, reason: null };
    if (inspected.state === 'present') {
      observed = true; expected.id = inspected.id!;
      if (performance.now() >= deadline) break;
      // The name may later be reused; removal always addresses the verified immutable ID.
      try {
        const removed = await process(['rm', '-f', expected.id], { timeoutMs: Math.max(1, Math.min(1000, deadline - performance.now())) });
        lastReason = removed.error || removed.code !== 0 && !missing(removed.stderr) ? 'removal_failed' : 'verification_pending';
      } catch { lastReason = 'removal_failed'; }
    }
    const remaining = deadline - performance.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, remaining)));
  }
  return { confirmed: false, id: expected.id ?? null, reason: lastReason };
}
