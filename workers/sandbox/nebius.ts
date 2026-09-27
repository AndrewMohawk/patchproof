import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PYTHON_DRIVER } from './driver.ts';
import { SANDBOX_DOCUMENTATION, SandboxTransportError, operationSchema, withAbort } from './nebius-types.ts';
import type { SandboxOperation } from './nebius-types.ts';

export { SANDBOX_DOCUMENTATION, SandboxTransportError, SandboxVerificationSchema } from './nebius-types.ts';
export type { SandboxOperation, SandboxVerification } from './nebius-types.ts';
export { NebiusSandboxCheckRunner } from './nebius-runner.ts';
export type { NebiusSandboxRunnerOptions } from './nebius-runner.ts';

export interface SandboxTransportOptions {
  fetch: typeof globalThis.fetch;
  credential: () => Promise<{ token: string; projectId: string }>;
  authorized: boolean;
  expectedProjectId?: string;
  requestTimeoutMs?: number;
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new SandboxTransportError('sandbox_invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > 1_048_576) throw new SandboxTransportError('sandbox_response_limit');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof SandboxTransportError) throw error;
    throw new SandboxTransportError('sandbox_invalid_response');
  } finally { reader.releaseLock(); }
}

/** Documented API mapping. No ambient credentials, SDK guessing or undocumented isolation flags. */
export class NebiusSandboxTransport {
  readonly #options: SandboxTransportOptions;
  readonly #timeoutMs: number;
  constructor(options: SandboxTransportOptions) {
    this.#options = options;
    this.#timeoutMs = options.requestTimeoutMs ?? 10_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 30_000) throw new Error('invalid_sandbox_request_timeout');
  }
  get expectedProjectId() { return this.#options.expectedProjectId; }

  async #json(result: { response: Response; signal: AbortSignal }, caller: AbortSignal) {
    try { return await boundedJson(result.response, result.signal); }
    catch (error) {
      if (caller.aborted) throw new SandboxTransportError('cancelled');
      if (result.signal.aborted) throw new SandboxTransportError('sandbox_request_timeout');
      throw error;
    }
  }

  async #request(path: string, method: string, body: string | Uint8Array | undefined, signal: AbortSignal, binary = false) {
    if (!this.#options.authorized) throw new SandboxTransportError('sandbox_authorization_required');
    if (signal.aborted) throw new SandboxTransportError('cancelled');
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]);
    try {
      const { token, projectId } = await withAbort(this.#options.credential(), bounded);
      if (!token || !projectId || /[\r\n]/.test(token + projectId)) throw new SandboxTransportError('sandbox_missing_credentials');
      if (this.#options.expectedProjectId !== undefined && projectId !== this.#options.expectedProjectId) throw new SandboxTransportError('sandbox_project_mismatch');
      if (bounded.aborted) throw new SandboxTransportError('cancelled');
      const response = await withAbort(this.#options.fetch(`${SANDBOX_DOCUMENTATION.base}${path}`, {
        method, signal: bounded, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Project: projectId, 'Content-Type': binary ? 'application/octet-stream' : 'application/json' },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : Buffer.from(body) }),
      }), bounded);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new SandboxTransportError(`sandbox_http_${response.status}`);
      }
      return { response, signal: bounded };
    } catch (error) {
      if (signal.aborted) throw new SandboxTransportError('cancelled');
      if (bounded.aborted) throw new SandboxTransportError('sandbox_request_timeout');
      if (error instanceof SandboxTransportError) throw error;
      throw new SandboxTransportError('sandbox_transport_error');
    }
  }

  async uploadSource(source: string, signal: AbortSignal): Promise<string> {
    const bytes = Buffer.from(source, 'utf8');
    if (bytes.byteLength > 262_144) throw new SandboxTransportError('sandbox_source_limit');
    const result = await this.#request('/files', 'POST', bytes, signal, true);
    const raw = await this.#json(result, signal);
    const identity = z.object({ uuid: z.uuid() }).safeParse(raw);
    const handles = identity.success ? [`nebius:file:${identity.data.uuid}`] : [];
    if (result.response.status !== 201) throw new SandboxTransportError('sandbox_unexpected_upload_status', handles);
    const parsed = z.object({ uuid: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(-1) }).safeParse(raw);
    if (!parsed.success) throw new SandboxTransportError('sandbox_invalid_upload_response', handles);
    const file = parsed.data;
    if (file.sha256 !== createHash('sha256').update(bytes).digest('hex') || (file.size !== -1 && file.size !== bytes.byteLength)) throw new SandboxTransportError('sandbox_upload_integrity_mismatch', handles);
    return file.uuid;
  }

  async spawnInvocation(input: {
    imageUuid: string; files: Record<string, { uuid: string; uid: number; gid: number; mode: string }>;
    entrypoint: string; invocation: { function: string; args: unknown[]; kwargs: Record<string, unknown> };
    timeoutSeconds: number;
  }, signal: AbortSignal): Promise<string> {
    if (!z.uuid().safeParse(input.imageUuid).success || !/^\/candidate\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.py$/.test(input.entrypoint) ||
        !Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 900 || !Object.hasOwn(input.files, input.entrypoint) ||
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(input.invocation.function)) throw new SandboxTransportError('invalid_sandbox_request');
    for (const [path, file] of Object.entries(input.files)) {
      if (!/^\/candidate\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.py$/.test(path) || file.mode !== '0444' || file.uid !== 65534 || file.gid !== 65534 ||
          !z.uuid().safeParse(file.uuid).success) throw new SandboxTransportError('invalid_sandbox_file_reference');
    }
    const result = await this.#request('/instances', 'POST', JSON.stringify({
      image: input.imageUuid, command: '/usr/local/bin/python', args: ['-I', '-B', '-c', PYTHON_DRIVER, input.entrypoint],
      shell: false, env: {}, preserve_env: false, uid: 65534, gid: 65534,
      cwd: '/candidate', networking: { enabled: false }, disposable: true,
      resources_limits: { max_layer_bytes: 16_777_216 }, timeout: input.timeoutSeconds, truncate_output_at: 131_072,
      stdin: { value: Buffer.from(JSON.stringify(input.invocation)).toString('base64'), encoding: 'base64', close: true },
      files: input.files,
    }), signal);
    const record = z.object({ uuid: z.uuid() }).safeParse(await this.#json(result, signal));
    if (!record.success) throw new SandboxTransportError('sandbox_invalid_spawn_response');
    if (result.response.status !== 201) throw new SandboxTransportError('sandbox_unexpected_spawn_status', [`nebius:operation:${record.data.uuid}`]);
    // Never follow an untrusted Location response header with authorization.
    return record.data.uuid;
  }

  async getOperation(id: string, signal: AbortSignal): Promise<SandboxOperation> {
    if (!z.uuid().safeParse(id).success) throw new SandboxTransportError('invalid_sandbox_operation');
    const result = await this.#request(`/operations/${id}`, 'GET', undefined, signal);
    if (result.response.status !== 200) {
      void result.response.body?.cancel().catch(() => {});
      throw new SandboxTransportError('sandbox_unexpected_operation_status');
    }
    const parsed = operationSchema.safeParse(await this.#json(result, signal));
    if (!parsed.success || parsed.data.uuid !== id) throw new SandboxTransportError('sandbox_invalid_operation_response');
    const retry = result.response.headers.get('Retry-After');
    return { ...parsed.data, retryAfterMs: retry !== null && /^\d+$/.test(retry) ? Math.min(2000, Number(retry) * 1000) : null };
  }

  async cancel(id: string, signal: AbortSignal): Promise<void> {
    if (!z.uuid().safeParse(id).success) throw new SandboxTransportError('invalid_sandbox_operation');
    const result = await this.#request(`/operations/${id}`, 'DELETE', undefined, signal);
    void result.response.body?.cancel().catch(() => {});
    if (result.response.status !== 202) throw new SandboxTransportError('sandbox_cancellation_unconfirmed');
  }
}
