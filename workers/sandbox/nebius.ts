import { z } from 'zod';
import type { CheckRunner, FunctionCase, SandboxCheckResult } from '../../packages/contracts/src/product.ts';
import { PYTHON_DRIVER } from './driver.ts';

export const SANDBOX_DOCUMENTATION = {
  inspectedAt: '2026-09-27',
  base: 'https://api.tokenfactory.nebius.com/sandboxes',
  spawn: 'https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance',
  status: 'https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/get-an-operation-status',
  cancel: 'https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation',
  auth: 'https://docs.tokenfactory.nebius.com/api-reference/sandboxes/images/list-publicly-available-images',
} as const;

const operationSchema = z.object({
  uuid: z.uuid(), kind: z.enum(['instance', 'image_import']),
  status: z.enum(['PENDING', 'ASSIGNED', 'EXECUTING', 'SUCCESS', 'FAILED', 'CANCELLED']),
  consumed_cpu: z.number().nonnegative().nullable().optional(), metadata: z.record(z.string(), z.unknown()),
});
export interface SandboxTransportOptions {
  fetch: typeof globalThis.fetch;
  credential: () => Promise<{ token: string; projectId: string }>;
  authorized: boolean;
}

/** Low-level documented mapping only. It is not a verified CheckRunner. */
export class NebiusSandboxTransport {
  readonly #options: SandboxTransportOptions;
  constructor(options: SandboxTransportOptions) { this.#options = options; }
  async #request(path: string, method: string, body: unknown | undefined, signal: AbortSignal) {
    if (!this.#options.authorized) throw new Error('sandbox_authorization_required');
    if (signal.aborted) throw new Error('cancelled');
    const { token, projectId } = await this.#options.credential();
    if (!token || !projectId || /[\r\n]/.test(token + projectId)) throw new Error('sandbox_missing_credentials');
    let response: Response;
    try {
      response = await this.#options.fetch(`${SANDBOX_DOCUMENTATION.base}${path}`, {
        method, signal, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Project: projectId, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error(signal.aborted ? 'cancelled' : 'sandbox_transport_error'); }
    if (!response.ok) throw new Error(`sandbox_http_${response.status}`);
    return response;
  }
  async spawnInvocation(input: {
    imageUuid: string; files: Record<string, { uuid: string; uid: number; gid: number; mode: string }>;
    entrypoint: string; invocation: { function: string; args: unknown[]; kwargs: Record<string, unknown> };
    timeoutSeconds: number;
  }, signal: AbortSignal): Promise<string> {
    z.uuid().parse(input.imageUuid);
    if (!/^\/candidate\/[a-zA-Z0-9_/-]+\.py$/.test(input.entrypoint) || !Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 900) throw new Error('invalid_sandbox_request');
    for (const [path, file] of Object.entries(input.files)) {
      if (!/^\/candidate\/[a-zA-Z0-9_/-]+\.py$/.test(path) || file.mode !== '0444' || file.uid !== 65534 || file.gid !== 65534) throw new Error('invalid_sandbox_file_reference');
      z.uuid().parse(file.uuid);
    }
    const response = await this.#request('/instances', 'POST', {
      image: input.imageUuid, command: '/usr/local/bin/python', args: ['-I', '-B', '-c', PYTHON_DRIVER, input.entrypoint],
      shell: false, env: {}, preserve_env: false, uid: 65534, gid: 65534,
      cwd: '/candidate', networking: { enabled: false }, disposable: true,
      resources_limits: { max_layer_bytes: 16_777_216 }, timeout: input.timeoutSeconds, truncate_output_at: 131_072,
      stdin: { value: Buffer.from(JSON.stringify(input.invocation)).toString('base64'), encoding: 'base64', close: true },
      files: input.files,
    }, signal);
    const record = z.object({ uuid: z.uuid() }).parse(await response.json());
    // Never follow an untrusted Location response header with authorization.
    return record.uuid;
  }
  async getOperation(id: string, signal: AbortSignal) {
    z.uuid().parse(id);
    const response = await this.#request(`/operations/${id}`, 'GET', undefined, signal);
    return operationSchema.parse(await response.json());
  }
  async cancel(id: string, signal: AbortSignal): Promise<void> {
    z.uuid().parse(id);
    await this.#request(`/operations/${id}`, 'DELETE', undefined, signal);
  }
}

/** Fail closed: public API mapping alone does not verify the required isolation controls. */
export class NebiusSandboxCheckRunner implements CheckRunner {
  async run(input: { files: Record<string, string>; entrypoint: string; cases: FunctionCase[]; timeoutSeconds: number }, signal: AbortSignal): Promise<SandboxCheckResult> {
    const reason = signal.aborted ? 'cancelled' : 'sandbox_controls_unverified: account entitlement, immutable image, read-only rootfs, memory/pids/CPU caps, cancellation and billing require verified integration';
    return { checks: input.cases.map(c => ({ id: c.id, requirementId: c.requirementId, status: 'error', message: reason,
      actual: null, expected: c.expectedException ? { exception: c.expectedException } : c.expected, durationMs: 0, log: `NOT RUN: ${reason}` })),
      isolation: 'unavailable', operationIds: [], cpuSeconds: null, measuredCostUsd: null, infrastructureError: reason };
  }
}
