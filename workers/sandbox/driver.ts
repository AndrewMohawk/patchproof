// This generic driver receives invocation inputs only. Expected values, check
// IDs, requirement IDs and evaluator definitions remain in the host controller.
// Runs only inside the pinned container. A delayed start cannot receive a fresh
// relative allowance; the cap also prevents a backward wall-clock jump extending it.
export const GUEST_DEADLINE_LAUNCHER = String.raw`
import math, os, sys, time
try:
    deadline_ms, cap_seconds = float(sys.argv[1]), float(sys.argv[2])
    if not math.isfinite(deadline_ms) or not math.isfinite(cap_seconds) or not 0 < cap_seconds <= 900:
        os._exit(124)
    remaining = min(cap_seconds, (deadline_ms - time.time() * 1000) / 1000)
    if remaining <= 0:
        os._exit(124)
    os.execv('/bin/busybox', ['/bin/busybox', 'timeout', '-s', 'KILL', format(remaining, '.6f'),
        '/usr/local/bin/python', '-I', '-B', '-c', sys.argv[3], sys.argv[4]])
except BaseException:
    os._exit(124)
`;

export const PYTHON_DRIVER = String.raw`
import sys, os, json, importlib.util, copy, contextlib, io
loads, dumps, deepcopy = json.loads, json.dumps, copy.deepcopy
write = os.write
request = loads(sys.stdin.read())
args, kwargs = request['args'], request['kwargs']
original_args, original_kwargs = deepcopy(args), deepcopy(kwargs)
entrypoint = sys.argv[1]
sys.path.insert(0, '/candidate')
out = {'kind': 'driver_error'}
try:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec = importlib.util.spec_from_file_location('patchproof_candidate', entrypoint)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        function = getattr(module, request['function'])
        try:
            value = function(*args, **kwargs)
            out = {'kind': 'return', 'value': value}
        except BaseException as exc:
            out = {'kind': 'exception', 'exception': type(exc).__name__}
    out['argsAfter'], out['kwargsAfter'] = args, kwargs
    write(1, (dumps(out, allow_nan=False, separators=(',', ':')) + '\n').encode('utf-8'))
except BaseException:
    write(1, b'{"kind":"driver_error"}\n')
`;
