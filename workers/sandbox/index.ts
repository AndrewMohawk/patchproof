import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { CheckRunner, CheckResult, FunctionCase, SandboxCheckResult } from '../../packages/contracts/src/product.ts';
import { MockRepairProvider } from '../repair/index.ts';
import { PYTHON_DRIVER } from './driver.ts';
import { runDocker } from './process.ts';
import { reconcileContainers } from './reconcile.ts';
import type { ProcessRunner } from './process.ts';

export const LOCAL_IMAGE_ID = 'sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51';
export const LOCAL_IMAGE_REPO_DIGEST = 'python@sha256:79e7a9b9ff1cbceff819f856fb374477792a5967759d94df266de7b7b4120e6f';
const observationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('return'), value: z.json(), argsAfter: z.array(z.json()), kwargsAfter: z.record(z.string(), z.json()) }),
  z.strictObject({ kind: z.literal('exception'), exception: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), argsAfter: z.array(z.json()), kwargsAfter: z.record(z.string(), z.json()) }),
  z.strictObject({ kind: z.literal('driver_error') }),
]);

export interface LocalRuntimeStatus { available: boolean; image: string | null; reason: string | null; }
export function errorChecks(cases: FunctionCase[], reason: string): CheckResult[] {
  return cases.map(c => ({ id: c.id, requirementId: c.requirementId, status: 'error', message: reason,
    actual: null, expected: c.expectedException ? { exception: c.expectedException } : c.expected,
    durationMs: 0, log: `NOT VERIFIED: ${reason}` }));
}

/** Compares observed return/exception/arguments in the trusted host controller. */
export function evaluateObservation(c: FunctionCase, stdout: string, durationMs: number): CheckResult {
  let observed: z.infer<typeof observationSchema>;
  try { observed = observationSchema.parse(JSON.parse(stdout)); }
  catch { return { ...errorChecks([c], 'invalid_candidate_output')[0]!, durationMs }; }
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
  async status(): Promise<LocalRuntimeStatus> {
    if (!/^sha256:[a-f0-9]{64}$/.test(this.#image)) return { available: false, image: null, reason: 'immutable_image_required' };
    const inspected = await this.#process(['image', 'inspect', this.#image, '--format', '{{json .}}']);
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
    if (input.ownerRunId !== undefined && !z.uuid().safeParse(input.ownerRunId).success) return unavailable('invalid_owner_run_id');
    const paths = Object.keys(input.files);
    if (!paths.length || paths.length > 32 || paths.some(path => !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.py$/.test(path)) ||
        !paths.includes(input.entrypoint) || Object.values(input.files).reduce((n, source) => n + Buffer.byteLength(source), 0) > 262_144 ||
        !Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds <= 0 || input.timeoutSeconds > 900 ||
        input.cases.some(c => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(c.function))) return unavailable('invalid_candidate_input');
    const status = await this.status();
    if (!status.available) return unavailable(status.reason!);
    const deadline = Date.now() + input.timeoutSeconds * 1000;
    const directory = await mkdtemp(join(tmpdir(), 'patchproof-candidate-'));
    const checks: CheckResult[] = [], operationIds: string[] = [];
    let infrastructureError: string | null = null;
    try {
      await chmod(directory, 0o755);
      for (const [path, source] of Object.entries(input.files)) {
        await mkdir(dirname(join(directory, path)), { recursive: true, mode: 0o755 });
        await writeFile(join(directory, path), source, { mode: 0o444, flag: 'wx' });
      }
      for (const c of input.cases) {
        if (signal.aborted || Date.now() >= deadline) {
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
        try {
          const result = await this.#process(['run', '--rm', '--init', '--pull', 'never', '--name', name,
            '--label', 'org.patchproof.owned=true',
            ...(input.ownerRunId ? ['--label', `org.patchproof.run-id=${input.ownerRunId}`] : []),
            '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--memory', '128m', '--memory-swap', '128m',
            '--cpus', '0.5', '--ulimit', 'cpu=5:5', '--ulimit', 'nofile=64:64', '--user', '65534:65534',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=bind,src=${directory},dst=/candidate,readonly`,
            '--workdir', '/candidate', '--log-driver', 'none', '--entrypoint', '/bin/busybox', '-i',
            this.#image, 'timeout', '-s', 'KILL', String(Math.max(0.001, (deadline - Date.now()) / 1000)),
            '/usr/local/bin/python', '-I', '-B', '-c', PYTHON_DRIVER, `/candidate/${input.entrypoint}`], {
              stdin: JSON.stringify({ function: c.function, args: c.args, kwargs: c.kwargs }),
              timeoutMs: Math.max(1, deadline - Date.now()), signal,
            });
          if (result.error || result.code !== 0) {
            const reason = result.error ?? (result.code === 125 ? 'docker_setup_error' : 'candidate_process_error');
            checks.push({ ...errorChecks([c], reason)[0]!, durationMs: Date.now() - started });
            if (['docker_unavailable', 'docker_setup_error', 'timeout', 'cancelled'].includes(reason) || reason.startsWith('parent_death_launcher_')) infrastructureError = reason;
          } else checks.push(evaluateObservation(c, result.stdout, Date.now() - started));
        } finally {
          // Independent of the cancelled signal: killing the CLI is not container cleanup.
          const cleanup = await this.#process(['rm', '-f', name], { timeoutMs: 5000 });
          if (cleanup.error || (cleanup.code !== 0 && !/No such (container|object)/i.test(cleanup.stderr))) infrastructureError = 'container_cleanup_unconfirmed';
        }
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
