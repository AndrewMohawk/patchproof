// This generic driver receives invocation inputs only. Expected values, check
// IDs, requirement IDs and evaluator definitions remain in the host controller.
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
