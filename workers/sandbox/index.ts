import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { FunctionCaseSchema, PRODUCT_CONTRACT_VERSION, ProductContractVersionSchema } from '../../packages/contracts/src/product.ts';
import { JsonDataSchema, jsonRecord, jsonShape, cloneJsonData, assertLegacyJsonDomain, JsonDataError } from '../../packages/contracts/src/json-data.ts';
import type { ProductContractVersion, CheckRunner, CheckResult, FunctionCase, SandboxCheckResult } from '../../packages/contracts/src/product.ts';
import { MockRepairProvider } from '../repair/index.ts';
import { PYTHON_DRIVER, GUEST_DEADLINE_LAUNCHER } from './driver.ts';
import { runDocker } from './process.ts';
import { reconcileContainers } from './reconcile.ts';
import { cleanupOwnedContainer, inspectOwnedContainer } from './local-cleanup.ts';
import type { ProcessRunner } from './process.ts';

export const LOCAL_IMAGE_ID = 'sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51';
export const LOCAL_IMAGE_REPO_DIGEST = 'python@sha256:79e7a9b9ff1cbceff819f856fb374477792a5967759d94df266de7b7b4120e6f';
const observationSchema = jsonShape(z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('return'), value: JsonDataSchema, argsAfter: z.array(JsonDataSchema), kwargsAfter: jsonRecord(JsonDataSchema) }),
  z.strictObject({ kind: z.literal('exception'), exception: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), argsAfter: z.array(JsonDataSchema), kwargsAfter: jsonRecord(JsonDataSchema) }),
  z.strictObject({ kind: z.literal('driver_error') }),
]));

export interface LocalRuntimeStatus { available: boolean; image: string | null; reason: string | null; }
export function errorChecks(cases: FunctionCase[], reason: string): CheckResult[] {
  return cases.map(c => ({ id: c.id, requirementId: c.requirementId, status: 'error', message: reason,
    actual: null, expected: c.expectedException ? { exception: c.expectedException } : c.expected,
    durationMs: 0, log: `NOT VERIFIED: ${reason}` }));
}

/** Compares observed return/exception/arguments in the trusted host controller. */
export function evaluateObservation(c: FunctionCase, stdout: string, durationMs: number, contractVersion: ProductContractVersion = PRODUCT_CONTRACT_VERSION): CheckResult {
  let observed: z.infer<typeof observationSchema>;
  try {
    ProductContractVersionSchema.parse(contractVersion);
    const value = cloneJsonData(JSON.parse(stdout));
    if (contractVersion !== '2.2') assertLegacyJsonDomain(value);
    observed = observationSchema.parse(value);
  } catch (error) {
    return { ...errorChecks([c], error instanceof JsonDataError && error.code === 'unsupported_legacy_json_key' ? error.code : 'invalid_candidate_output')[0]!, durationMs };
  }
  if (observed.kind === 'driver_error') return { ...errorChecks([c], 'candidate_import_or_serialization_error')[0]!, durationMs };
  const outcome = c.expectedException !== undefined ? observed.kind === 'exception' && observed.exception === c.expectedException :
    observed.kind === 'return' && isDeepStrictEqual(observed.value, c.expected);
  const argsUnchanged = isDeepStrictEqual(observed.argsAfter, c.args) && isDeepStrictEqual(observed.kwargsAfter, c.kwargs);
  const pass = outcome && (!c.assertArgsUnchanged || argsUnchanged);
  const actual = observed.kind === 'return' ? observed.value : { exception: observed.exception };
  return { id: c.id, requirementId: c.requirementId, status: pass ? 'pass' : 'fail',
    message: pass ? 'Observed outcome matches the declared check.' : !outcome ? 'Observed outcome differs from the declared check.' : 'Candidate mutated invocation arguments.',
    actual: c.assertArgsUnchanged ? { outcome: actual, argsAfter: observed.argsAfter, kwargsAfter: observed.kwargsAfter } : actual,
    expected: c.assertArgsUnchanged ? { outcome: c.expectedException ? { exception: c.expectedException } : c.expected, argsAfter: c.args, kwargsAfter: c.kwargs } :
      c.expectedException ? { exception: c.expectedException } : c.expected,
    durationMs, log: JSON.stringify({ comparisonPerformedBy: 'host_controller', kind: observed.kind, outcomeMatches: outcome, argsUnchanged, observed }),
  };
}

export class DockerCheckRunner implements CheckRunner {
  readonly #image: string;
  readonly #process: ProcessRunner;
  constructor(options: { image?: string; process?: ProcessRunner } = {}) {
    this.#image = options.image ?? LOCAL_IMAGE_ID;
    this.#process = options.process ?? runDocker;
  }
  async status(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<LocalRuntimeStatus> {
    if (!/^sha256:[a-f0-9]{64}$/.test(this.#image)) return { available: false, image: null, reason: 'immutable_image_required' };
    const inspected = await this.#process(['image', 'inspect', this.#image, '--format', '{{json .}}'], options);
    if (inspected.error || inspected.code !== 0) return { available: false, image: null, reason: inspected.error ?? 'local_python_image_unavailable' };
    try {
      const image = JSON.parse(inspected.stdout) as { Id: string; Os: string; Architecture: string };
      if (image.Id !== this.#image || image.Os !== 'linux' || image.Architecture !== (process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : process.arch)) {
        return { available: false, image: null, reason: 'local_image_platform_mismatch' };
      }
    } catch { return { available: false, image: null, reason: 'invalid_image_inspection' }; }
    return { available: true, image: this.#image, reason: null };
  }

  async reconcile(runIds: string[]) {
    return reconcileContainers(this.#process, runIds);
  }

  async run(input: Parameters<CheckRunner['run']>[0], signal: AbortSignal): Promise<SandboxCheckResult> {
    const unavailable = (reason: string): SandboxCheckResult => ({ checks: errorChecks(input.cases, reason), isolation: 'unavailable',
      operationIds: [], cpuSeconds: null, measuredCostUsd: null, infrastructureError: reason });
    if (signal.aborted) return unavailable('cancelled');
    const contractVersion = ProductContractVersionSchema.safeParse(input.contractVersion ?? PRODUCT_CONTRACT_VERSION);
    if (!contractVersion.success) return unavailable('unsupported_product_contract_version');
    const cases = z.array(FunctionCaseSchema).safeParse(input.cases);
    if (!cases.success) return unavailable('invalid_candidate_input');
    input = { ...input, cases: cases.data };
    try { if (contractVersion.data !== '2.2') assertLegacyJsonDomain(cloneJsonData(input.cases)); }
    catch { return unavailable('unsupported_legacy_json_key'); }
    if (input.ownerRunId !== undefined && !z.uuid().safeParse(input.ownerRunId).success) return unavailable('invalid_owner_run_id');
    const paths = Object.keys(input.files);
    if (!paths.length || paths.length > 32 || paths.some(path => !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.py$/.test(path)) ||
        !paths.includes(input.entrypoint) || Object.values(input.files).reduce((n, source) => n + Buffer.byteLength(source), 0) > 262_144 ||
        !Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds <= 0 || input.timeoutSeconds > 900 ||
        input.cases.some(c => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(c.function))) return unavailable('invalid_candidate_input');
    const deadline = performance.now() + input.timeoutSeconds * 1000;
    const guestDeadline = Date.now() + input.timeoutSeconds * 1000;
    const remainingMs = () => Math.max(0, deadline - performance.now());
    const status = await this.status({ timeoutMs: Math.max(1, remainingMs()), signal });
    if (!status.available) return unavailable(status.reason!);
    const directory = await mkdtemp(join(tmpdir(), 'patchproof-candidate-'));
    const checks: CheckResult[] = [], operationIds: string[] = [];
    let infrastructureError: string | null = null;
    try {
      await chmod(directory, 0o755);
      for (const [path, source] of Object.entries(input.files)) {
        // Every segment was validated above. Only our fresh workspace is made
        // readable to the non-root guest; service umask must stay unchanged.
        let parent = directory;
        for (const segment of path.split('/').slice(0, -1)) {
          parent = join(parent, segment);
          await mkdir(parent, { recursive: true, mode: 0o755 });
          await chmod(parent, 0o755);
        }
        const destination = join(directory, path);
        await writeFile(destination, source, { mode: 0o444, flag: 'wx' });
        await chmod(destination, 0o444);
      }
      for (const c of input.cases) {
        if (signal.aborted || remainingMs() <= 0) {
          infrastructureError = signal.aborted ? 'cancelled' : 'timeout';
          checks.push(...errorChecks(input.cases.slice(checks.length), infrastructureError));
          break;
        }
        const name = `patchproof-check-${randomUUID()}`;
        const operationId = `docker:${name}`;
        operationIds.push(operationId);
        const started = Date.now();
        // Persist the handle before Docker can create anything. Failed journaling forbids spawn.
        try { input.onOperation?.(operationId); }
        catch {
          infrastructureError = 'operation_journal_error';
          checks.push(...errorChecks(input.cases.slice(checks.length), infrastructureError));
          break;
        }
        if (signal.aborted || remainingMs() <= 0) {
          infrastructureError = signal.aborted ? 'cancelled' : 'timeout';
          checks.push(...errorChecks(input.cases.slice(checks.length), infrastructureError));
          break;
        }
        let acknowledged = false, containerId: string | null = null;
        let cleanup: Awaited<ReturnType<typeof cleanupOwnedContainer>> | undefined;
        try {
          // Creation is a separate, non-executing step. Never retry an uncertain create.
          const created = await this.#process(['create', '--rm', '--init', '--pull', 'never', '--name', name,
            '--label', 'org.patchproof.owned=true', '--label', `org.patchproof.operation=${name}`,
            ...(input.ownerRunId ? ['--label', `org.patchproof.run-id=${input.ownerRunId}`] : []),
            '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--memory', '128m', '--memory-swap', '128m',
            '--cpus', '0.5', '--ulimit', 'cpu=5:5', '--ulimit', 'nofile=64:64', '--user', '65534:65534',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=bind,src=${directory},dst=/candidate,readonly`,
            '--workdir', '/candidate', '--log-driver', 'none', '--entrypoint', '/usr/local/bin/python', '-i',
            this.#image, '-I', '-B', '-c', GUEST_DEADLINE_LAUNCHER, String(guestDeadline), String(Math.max(0.001, remainingMs() / 1000)),
            PYTHON_DRIVER, `/candidate/${input.entrypoint}`], {
              timeoutMs: Math.max(1, Math.min(10_000, remainingMs())), signal,
            });
          const id = created.stdout.trim();
          acknowledged = !created.error && created.code === 0 && /^[a-f0-9]{64}$/.test(id);
          if (acknowledged) containerId = id;
          if (!acknowledged) {
            infrastructureError = created.error ?? (created.code === 0 ? 'docker_create_unconfirmed' : 'docker_setup_error');
            checks.push({ ...errorChecks([c], infrastructureError)[0]!, durationMs: Date.now() - started });
          } else if (signal.aborted || remainingMs() <= 0) {
            infrastructureError = signal.aborted ? 'cancelled' : 'timeout';
            checks.push({ ...errorChecks([c], infrastructureError)[0]!, durationMs: Date.now() - started });
          } else {
            const owned = await inspectOwnedContainer(this.#process, { name, image: this.#image, id,
              ...(input.ownerRunId ? { ownerRunId: input.ownerRunId } : {}) }, Math.max(1, remainingMs()), signal);
            // This check is after inspection as well: ownership I/O may consume the allowance.
            if (signal.aborted || remainingMs() <= 0 || owned.state !== 'present') {
              infrastructureError = signal.aborted ? 'cancelled' : remainingMs() <= 0 ? 'timeout' : 'container_ownership_unconfirmed';
              checks.push({ ...errorChecks([c], infrastructureError)[0]!, durationMs: Date.now() - started });
            } else {
              const result = await this.#process(['start', '--attach', '--interactive', id], {
                stdin: JSON.stringify({ function: c.function, args: c.args, kwargs: c.kwargs }),
                timeoutMs: Math.max(1, remainingMs()), signal,
              });
              if (result.error || result.code !== 0) {
                const reason = result.error ?? (result.code === 125 ? 'docker_setup_error' : 'candidate_process_error');
                checks.push({ ...errorChecks([c], reason)[0]!, durationMs: Date.now() - started });
                if (['docker_unavailable', 'docker_setup_error', 'timeout', 'cancelled'].includes(reason) || reason.startsWith('parent_death_launcher_')) infrastructureError = reason;
              } else checks.push(evaluateObservation(c, result.stdout, Date.now() - started, contractVersion.data));
            }
          }
        } catch {
          infrastructureError = 'docker_setup_error';
          checks.push({ ...errorChecks([c], infrastructureError)[0]!, durationMs: Date.now() - started });
        } finally {
          // Absence is final only after an acknowledged/observed create. A delayed
          // unacknowledged create can leave an inert object, but it can never be started here.
          cleanup = await cleanupOwnedContainer(this.#process, { name, image: this.#image,
            ...(containerId ? { id: containerId } : {}), ...(input.ownerRunId ? { ownerRunId: input.ownerRunId } : {}) }, acknowledged);
          if (!cleanup.confirmed) infrastructureError = 'container_cleanup_unconfirmed';
        }
        const recorded = checks.at(-1)!;
        recorded.log = JSON.stringify({ observationLog: recorded.log, dockerLifecycle: {
          operationId, createAcknowledged: acknowledged, containerId: cleanup.id ?? containerId,
          cleanupConfirmed: cleanup.confirmed, cleanupReason: cleanup.reason, cleanupInspectionFailure: cleanup.inspectionFailure ?? null,
        } });
        // Never overlap a new case with an operation whose termination is uncertain.
        if (infrastructureError) {
          checks.push(...errorChecks(input.cases.slice(checks.length), infrastructureError));
          break;
        }
      }
    } catch { return { ...unavailable('local_workspace_error'), operationIds }; }
    finally { await rm(directory, { recursive: true, force: true }); }
    return { checks, isolation: 'local_container', operationIds, cpuSeconds: null, measuredCostUsd: 0, infrastructureError };
  }
}

export async function createLocalRuntime() {
  const checks = new DockerCheckRunner();
  return { provider: new MockRepairProvider(), checks, status: await checks.status() };
}

export { NebiusSandboxTransport, NebiusSandboxCheckRunner } from './nebius.ts';
