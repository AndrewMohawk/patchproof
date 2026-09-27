import { spawn } from 'node:child_process';

export interface ProcessResult { code: number | null; stdout: string; stderr: string; error: string | null; }
export type ProcessRunner = (args: string[], options?: { stdin?: string; timeoutMs?: number; signal?: AbortSignal }) => Promise<ProcessResult>;

// Trusted, fixed host code only. Candidate source is never interpolated or executed here.
// Linux man-pages 6.19: PR_SET_PDEATHSIG survives ordinary exec, but not privileged exec.
export const PARENT_DEATH_LAUNCHER = String.raw`
import ctypes, errno, os, signal, stat, sys
try:
    if sys.platform != "linux" or len(sys.argv) < 3:
        raise RuntimeError()
    parent = int(sys.argv[1])
    if parent <= 1 or os.getppid() != parent:
        raise RuntimeError()
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.restype = ctypes.c_int
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise RuntimeError()
    # Covers parent death before the kernel signal was installed.
    if os.getppid() != parent:
        raise RuntimeError()
    executable = sys.argv[2]
    mode = os.stat(executable).st_mode
    if not executable.startswith("/") or not stat.S_ISREG(mode) or mode & (stat.S_ISUID | stat.S_ISGID):
        raise RuntimeError()
    try:
        if os.getxattr(executable, "security.capability"):
            raise RuntimeError()
    except OSError as error:
        if error.errno not in (errno.ENODATA, errno.ENOTSUP):
            raise
    os.execv(executable, sys.argv[2:])
except BaseException:
    os.write(2, b"patchproof_launcher_unavailable\n")
    os._exit(124)
`;

/** A fixed host launcher execs Docker; candidate Python only runs inside containers. */
export const runDocker: ProcessRunner = async (args, options = {}) => {
  if (options.signal?.aborted) return { code: null, stdout: '', stderr: '', error: 'cancelled' };
  if (process.platform !== 'linux') return { code: null, stdout: '', stderr: '', error: 'parent_death_launcher_unsupported_platform' };
  return new Promise(resolve => {
    const child = spawn('/usr/bin/python3', ['-I', '-S', '-c', PARENT_DEATH_LAUNCHER, String(process.pid), '/usr/bin/docker', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: { PATH: '/usr/bin:/bin', DOCKER_HOST: 'unix:///var/run/docker.sock' } });
    let stdout = '', stderr = '', error: string | null = null;
    let size = 0;
    const stop = (reason: string) => { error = reason; child.kill('SIGKILL'); };
    const timeout = setTimeout(() => stop('timeout'), options.timeoutMs ?? 10_000);
    const aborted = () => stop('cancelled');
    options.signal?.addEventListener('abort', aborted, { once: true });
    if (options.signal?.aborted) aborted();
    const collect = (chunk: Buffer, output: boolean) => {
      size += chunk.length;
      if (size > 131_072) { stop('output_limit'); return; }
      if (output) stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (data: Buffer) => collect(data, true));
    child.stderr.on('data', (data: Buffer) => collect(data, false));
    child.stdin.on('error', () => {});
    child.on('error', () => { error = 'parent_death_launcher_unavailable'; });
    child.on('close', code => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', aborted);
      if (!error && code === 124 && stderr.trim() === 'patchproof_launcher_unavailable') error = 'parent_death_launcher_unavailable';
      resolve({ code, stdout, stderr, error });
    });
    child.stdin.end(options.stdin ?? '');
  });
};
