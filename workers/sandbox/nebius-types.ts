import { z } from 'zod';

export const SANDBOX_DOCUMENTATION = {
  inspectedAt: '2026-09-27', openApiVersion: '1.0.0',
  serviceBase: 'https://api.tokenfactory.nebius.com/sandboxes',
  base: 'https://api.tokenfactory.nebius.com/sandboxes/v1',
  upload: 'https://docs.tokenfactory.nebius.com/api-reference/sandboxes/files/upload-a-file-to-the-server-the-body-must-be-a-file-content',
  spawn: 'https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance',
  status: 'https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/get-an-operation-status',
  cancel: 'https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation',
  auth: 'https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/configuration',
} as const;

/** Codes and handles only: never include provider bodies, credentials or thrown transport messages. */
export class SandboxTransportError extends Error {
  readonly code: string;
  readonly handles: string[];
  constructor(code: string, handles: string[] = []) {
    super(code); this.code = code; this.handles = handles;
  }
}

const streamSchema = z.object({
  value: z.string().max(262_144), encoding: z.enum(['ascii', 'base64']), truncated: z.boolean().optional(),
});
const instanceResultSchema = z.object({
  state: z.object({
    exit_code: z.number().int().nullable().optional(), signal: z.number().int().nullable().optional(),
    timed_out: z.boolean().optional(), stopped: z.boolean().optional(),
  }),
  stdout: streamSchema, stderr: streamSchema,
  resources: z.object({ cost: z.number().finite().nonnegative().nullable().optional() }).optional(),
});
export const operationSchema = z.object({
  uuid: z.uuid(), kind: z.enum(['instance', 'image_import']),
  status: z.enum(['PENDING', 'ASSIGNED', 'EXECUTING', 'SUCCESS', 'FAILED', 'CANCELLED']),
  consumed_cpu: z.number().finite().nonnegative().nullable().optional(),
  image_uuid: z.uuid().nullable().optional(),
  metadata: z.object({ image: z.uuid().optional(), result: instanceResultSchema.nullable().optional() }),
});
export type SandboxOperation = z.infer<typeof operationSchema> & { retryAfterMs: number | null };
export const terminalOperation = (operation: SandboxOperation) => ['SUCCESS', 'FAILED', 'CANCELLED'].includes(operation.status);

const proof = z.strictObject({
  verifiedAt: z.iso.datetime(), evidenceRefs: z.array(z.string().min(1).max(300)).min(1).max(20),
});
/** Trusted control-plane record, never accepted from a public task request. References are not self-verifying. */
export const SandboxVerificationSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), validUntil: z.iso.datetime(),
  projectId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(200),
  imageUuid: z.uuid(), immutableImageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  account: proof, image: proof,
  equivalentControls: z.strictObject({
    isolation: proof, filesystemProtection: proof,
    resourceCaps: proof.extend({ memoryBytes: z.number().int().positive(), pids: z.number().int().positive(), cpuQuota: z.number().finite().positive() }),
    networkDisabled: proof, cancellation: proof, uploadRetention: proof,
  }),
  // This must cover the whole batch, including uploads, cancellation and retained files.
  billing: proof.extend({ conservativeBatchChargeCeilingUsd: z.number().finite().positive() }),
  limits: z.strictObject({ maxCases: z.number().int().min(1).max(100), maxSourceBytes: z.number().int().min(1).max(262_144), maxTimeoutSeconds: z.number().int().min(1).max(900) }),
});
export type SandboxVerification = z.infer<typeof SandboxVerificationSchema>;

export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SandboxTransportError('cancelled'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort)).catch(() => {});
  });
}
export function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new SandboxTransportError('cancelled'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new SandboxTransportError('cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
export function decodeStream(stream: z.infer<typeof streamSchema>): string {
  if (stream.truncated !== false) throw new SandboxTransportError('sandbox_output_completeness_unverified');
  if (stream.encoding === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(stream.value)) throw new SandboxTransportError('sandbox_invalid_output');
  const bytes = Buffer.from(stream.value, stream.encoding === 'base64' ? 'base64' : 'utf8');
  if (bytes.byteLength > 131_072) throw new SandboxTransportError('sandbox_output_limit');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new SandboxTransportError('sandbox_invalid_output'); }
}
