import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FunctionCaseSchema } from '../packages/contracts/src/product.ts';
import { DockerCheckRunner, createLocalRuntime, LOCAL_IMAGE_ID, evaluateObservation, NebiusSandboxTransport, NebiusSandboxCheckRunner } from '../workers/sandbox/index.ts';
import { runDocker, PARENT_DEATH_LAUNCHER } from '../workers/sandbox/process.ts';
import type { ProcessRunner } from '../workers/sandbox/process.ts';
import { GUEST_DEADLINE_LAUNCHER } from '../workers/sandbox/driver.ts';

const check = (extra: Record<string, unknown> = {}) => FunctionCaseSchema.parse({ id: 'case-one', requirementId: 'R01', function: 'unique', args: [[3, 1, 3]], expected: [3, 1], ...extra });
const signal = () => new AbortController().signal;
const good = 'def unique(values):\n    if values is None:\n        raise TypeError("values")\n    result=[]\n    for value in values:\n        if value not in result: result.append(value)\n    return result\n';

test('trusted launcher kills an execed harmless child when its parent dies and reaps test processes', async () => {
  // This fixed supervisor is a subreaper so this test leaves no orphan or zombie.
  // It never reads or executes fixture/candidate source on the host.
  const supervisor = String.raw`
import ctypes, json, os, signal, subprocess, sys, time
libc = ctypes.CDLL(None, use_errno=True)
assert libc.prctl(36, 1, 0, 0, 0) == 0
read_fd, write_fd = os.pipe()
owner = os.fork()
if owner == 0:
    os.close(read_fd)
    child = subprocess.Popen(["/usr/bin/python3", "-I", "-S", "-c", sys.argv[1], str(os.getpid()), "/usr/bin/sleep", "30"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.write(write_fd, str(child.pid).encode())
    os.close(write_fd)
    time.sleep(30)
    os._exit(2)
os.close(write_fd)
child = int(os.read(read_fd, 32))
os.close(read_fd)
owner_reaped = child_reaped = False
try:
    deadline = time.monotonic() + 5
    while os.readlink("/proc/" + str(child) + "/exe") != "/usr/bin/sleep":
        assert time.monotonic() < deadline, "launcher did not exec sleep"
        time.sleep(0.01)
    os.kill(owner, signal.SIGKILL)
    os.waitpid(owner, 0)
    owner_reaped = True
    while True:
        pid, status = os.waitpid(child, os.WNOHANG)
        if pid:
            child_reaped = True
            assert os.WIFSIGNALED(status) and os.WTERMSIG(status) == signal.SIGKILL, status
            print(json.dumps({"childSignal": os.WTERMSIG(status), "ownerReaped": True, "childReaped": True}))
            break
        assert time.monotonic() < deadline, "execed child survived parent termination"
        time.sleep(0.01)
finally:
    for pid, reaped in ((owner, owner_reaped), (child, child_reaped)):
        if not reaped:
            try: os.kill(pid, signal.SIGKILL)
            except ProcessLookupError: pass
            try: os.waitpid(pid, 0)
            except ChildProcessError: pass
`;
  const result = await promisify(execFile)('/usr/bin/python3', ['-I', '-S', '-c', supervisor, PARENT_DEATH_LAUNCHER], { timeout: 10_000 });
  assert.deepEqual(JSON.parse(result.stdout), { childSignal: 9, ownerReaped: true, childReaped: true });
  assert.equal(result.stderr, '');
});

test('trusted launcher refuses exec when the original parent has changed', async () => {
  await assert.rejects(promisify(execFile)('/usr/bin/python3', ['-I', '-S', '-c', PARENT_DEATH_LAUNCHER, '1', '/usr/bin/printf', 'must-not-execute']),
    (error: unknown) => {
      const result = error as { code: number; stdout: string; stderr: string };
      assert.equal(result.code, 124);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim(), 'patchproof_launcher_unavailable');
      return true;
    });
});

test('host comparison rejects wrong returns and mutated arguments even with correct return', () => {
  const c = check({ assertArgsUnchanged: true });
  assert.equal(evaluateObservation(c, JSON.stringify({ kind: 'return', value: [3, 1], argsAfter: [[1, 3]], kwargsAfter: {} }), 1).status, 'fail');
  assert.equal(evaluateObservation(c, 'PASS', 1).status, 'error');
  assert.equal(evaluateObservation(c, JSON.stringify({ kind: 'return', value: [3, 1], argsAfter: c.args, kwargsAfter: {} }), 1).status, 'pass');
});

test('Docker invocation exposes inputs only and enforces declared local containment flags', async () => {
  const calls: string[][] = [];
  const ownerRunId = randomUUID();
  const announced: string[] = [];
  const id = 'a'.repeat(64); let name = '', removed = false;
  const fake: ProcessRunner = async (args, options) => {
    calls.push(args);
    if (args[0] === 'image') return { code: 0, error: null, stderr: '', stdout: JSON.stringify({ Id: LOCAL_IMAGE_ID, Architecture: process.arch === 'arm64' ? 'arm64' : 'amd64', Os: 'linux' }) };
    if (args[0] === 'create') {
      name = args[args.indexOf('--name') + 1]!;
      assert.deepEqual(announced, [`docker:${name}`], 'Operation must be persisted before creation.');
      assert.equal(options?.stdin, undefined, 'Creation must not receive the invocation.');
      return { code: 0, error: null, stderr: '', stdout: id };
    }
    if (args[0] === 'container') return removed ? { code: 1, error: null, stdout: '', stderr: 'No such container' } :
      { code: 0, error: null, stderr: '', stdout: JSON.stringify({ Id: id, Name: '/' + name, Image: LOCAL_IMAGE_ID, Config: { Labels: {
        'org.patchproof.owned': 'true', 'org.patchproof.operation': name, 'org.patchproof.run-id': ownerRunId,
      } } }) };
    if (args[0] === 'rm') { assert.deepEqual(args, ['rm', '-f', id]); removed = true; return { code: 0, error: null, stderr: '', stdout: '' }; }
    assert.deepEqual(args, ['start', '--attach', '--interactive', id]);
    const sent = JSON.parse(options!.stdin!);
    assert.deepEqual(Object.keys(sent).sort(), ['args', 'function', 'kwargs']);
    assert.ok(!options!.stdin!.includes('expected'));
    assert.ok(!args.some(value => value.includes('SENTINEL-ORACLE')));
    return { code: 0, error: null, stderr: '', stdout: JSON.stringify({ kind: 'return', value: [3, 1], argsAfter: sent.args, kwargsAfter: sent.kwargs }) };
  };
  const result = await new DockerCheckRunner({ process: fake }).run({ files: { 'solution.py': good }, entrypoint: 'solution.py', cases: [check()], timeoutSeconds: 10,
    ownerRunId, onOperation: id => announced.push(id) }, signal());
  assert.equal(result.checks[0]!.status, 'pass');
  assert.deepEqual(result.operationIds, announced);
  const command = calls.find(c => c[0] === 'create')!;
  assert.ok(command.includes(`org.patchproof.run-id=${ownerRunId}`));
  for (const [flag, value] of [['--network', 'none'], ['--cap-drop', 'ALL'], ['--security-opt', 'no-new-privileges'], ['--cpus', '0.5'], ['--pids-limit', '32'], ['--user', '65534:65534'], ['--pull', 'never']]) {
    assert.equal(command[command.indexOf(flag!) + 1], value);
  }
  assert.ok(command.includes('--read-only'));
  assert.ok(command.includes('--init'), 'Init must own PID 1 so the container timer can SIGKILL Python.');
  assert.equal(command[command.indexOf('--entrypoint') + 1], '/usr/local/bin/python');
  assert.equal(command[command.indexOf('-c') + 1], GUEST_DEADLINE_LAUNCHER);
  assert.ok(Number(command[command.indexOf(GUEST_DEADLINE_LAUNCHER) + 2]) <= 10);
  assert.equal(command.filter(arg => arg === '--mount').length, 1);
  assert.ok(command[command.indexOf('--mount') + 1]!.endsWith(',dst=/candidate,readonly'));
  assert.ok(calls.some(c => c[0] === 'rm'));
});

test('invalid owner IDs and failed operation journaling cannot start containers', async () => {
  const calls: string[][] = [];
  const runner = new DockerCheckRunner({ process: async args => {
    calls.push(args);
    return { code: 0, error: null, stderr: '', stdout: JSON.stringify({ Id: LOCAL_IMAGE_ID, Architecture: process.arch === 'arm64' ? 'arm64' : 'amd64', Os: 'linux' }) };
  } });
  const input = { files: { 'solution.py': good }, entrypoint: 'solution.py', cases: [check()], timeoutSeconds: 10 };
  assert.equal((await runner.run({ ...input, ownerRunId: 'not-a-uuid' }, signal())).infrastructureError, 'invalid_owner_run_id');
  assert.equal(calls.length, 0);
  const result = await runner.run({ ...input, ownerRunId: randomUUID(), onOperation: () => { throw new Error('journal unavailable'); } }, signal());
  assert.equal(result.infrastructureError, 'operation_journal_error');
  assert.equal(result.checks[0]!.status, 'error');
  assert.equal(result.operationIds.length, 1);
  assert.ok(calls.every(args => args[0] === 'image'));
});

test('recovery validates exact run ownership and fails closed on mismatched or unavailable state', async () => {
  const ownerRunId = randomUUID();
  const id = 'a'.repeat(64);
  const calls: string[][] = [];
  const runner = new DockerCheckRunner({ process: async args => {
    calls.push(args);
    if (args[0] === 'ps') {
      assert.ok(args.includes(`label=org.patchproof.run-id=${ownerRunId}`));
      assert.ok(args.includes('label=org.patchproof.owned=true'));
      return { code: 0, error: null, stderr: '', stdout: `${id}\n` };
    }
    assert.equal(args[0], 'container');
    return { code: 0, error: null, stderr: '', stdout: JSON.stringify({ Id: id, Name: '/other-check', Config: { Labels: {
      'org.patchproof.owned': 'true', 'org.patchproof.run-id': randomUUID(),
    } } }) };
  } });
  assert.equal((await runner.reconcile(['invalid'])).error, 'invalid_recovery_run_ids');
  assert.deepEqual(await runner.reconcile([]), { remainingOperationIds: [], error: null });
  assert.equal(calls.length, 0);
  const result = await runner.reconcile([ownerRunId, ownerRunId]);
  assert.match(result.error!, /ownership_mismatch/);
  assert.deepEqual(result.remainingOperationIds, [`docker:${id}`]);
  assert.equal(calls.filter(args => args[0] === 'ps').length, 2, 'Duplicate run IDs must be reconciled only once.');
  assert.ok(calls.every(args => args[0] !== 'rm'));
  const unavailable = await new DockerCheckRunner({ process: async () => ({ code: null, error: 'docker_unavailable', stdout: '', stderr: '' }) }).reconcile([ownerRunId]);
  assert.equal(unavailable.error, 'container_recovery_list_failed');
});

test('recovery preserves remaining handles when removal or verification fails', async () => {
  const ownerRunId = randomUUID(), id = 'b'.repeat(64);
  for (const verifyUnavailable of [false, true]) {
    let listings = 0;
    const runner = new DockerCheckRunner({ process: async args => {
      if (args[0] === 'ps') {
        if (++listings === 2 && verifyUnavailable) return { code: null, error: 'docker_unavailable', stdout: '', stderr: '' };
        return { code: 0, error: null, stdout: id, stderr: '' };
      }
      if (args[0] === 'container') return { code: 0, error: null, stderr: '', stdout: JSON.stringify({ Id: id, Name: '/known-check', Config: {
        Labels: { 'org.patchproof.owned': 'true', 'org.patchproof.run-id': ownerRunId },
      } }) };
      assert.deepEqual(args, ['rm', '-f', id]);
      return { code: 1, error: null, stdout: '', stderr: 'synthetic removal failure' };
    } });
    const result = await runner.reconcile([ownerRunId]);
    assert.deepEqual(result.remainingOperationIds, ['docker:known-check']);
    assert.match(result.error!, /removal_failed/);
    assert.match(result.error!, verifyUnavailable ? /list_failed/ : /incomplete/);
  }
});

test('real restart recovery removes only the specified sleeping run and confirms absence', async () => {
  const runId = randomUUID(), unrelatedRunId = randomUUID();
  const name = `patchproof-recovery-${randomUUID()}`, unrelatedName = `patchproof-recovery-${randomUUID()}`;
  try {
    for (const [containerName, owner] of [[name, runId], [unrelatedName, unrelatedRunId]]) {
      const started = await runDocker(['run', '-d', '--rm', '--pull', 'never', '--name', containerName!,
        '--label', 'org.patchproof.owned=true', '--label', `org.patchproof.run-id=${owner}`,
        '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '32', '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.5',
        '--ulimit', 'cpu=5:5', '--user', '65534:65534', '--log-driver', 'none',
        '--entrypoint', '/usr/local/bin/python', LOCAL_IMAGE_ID, '-I', '-B', '-c', 'import time; time.sleep(30)']);
      assert.equal(started.code, 0, started.error ?? started.stderr);
    }
    const result = await new DockerCheckRunner().reconcile([runId]);
    assert.deepEqual(result, { remainingOperationIds: [], error: null });
    const removed = await runDocker(['container', 'inspect', name]);
    assert.notEqual(removed.code, 0);
    assert.match(removed.stderr, /No such (object|container)/);
    const unrelated = await runDocker(['container', 'inspect', unrelatedName, '--format', '{{.State.Running}}']);
    assert.equal(unrelated.code, 0, unrelated.stderr);
    assert.equal(unrelated.stdout.trim(), 'true', 'Another run must remain running.');
  } finally {
    for (const containerName of [name, unrelatedName]) {
      const removed = await runDocker(['rm', '-f', containerName]);
      assert.ok(removed.code === 0 || /No such (object|container)/.test(removed.stderr), removed.error ?? removed.stderr);
    }
  }
});

test('unavailable Docker and pre-cancellation produce check errors with no execution', async () => {
  const runner = new DockerCheckRunner({ process: async () => ({ code: null, error: 'docker_unavailable', stdout: '', stderr: '' }) });
  const result = await runner.run({ files: { 'solution.py': good }, entrypoint: 'solution.py', cases: [check()], timeoutSeconds: 1 }, signal());
  assert.equal(result.isolation, 'unavailable');
  assert.equal(result.checks[0]!.status, 'error');
  assert.equal(result.operationIds.length, 0);
});

test('unconfirmed cleanup stops the batch before another container can overlap it', async () => {
  let launches = 0, name = ''; const id = 'c'.repeat(64);
  const runner = new DockerCheckRunner({ process: async args => {
    if (args[0] === 'image') return { code: 0, error: null, stderr: '', stdout: JSON.stringify({ Id: LOCAL_IMAGE_ID, Architecture: process.arch === 'arm64' ? 'arm64' : 'amd64', Os: 'linux' }) };
    if (args[0] === 'create') { name = args[args.indexOf('--name') + 1]!; return { code: 0, error: null, stderr: '', stdout: id }; }
    if (args[0] === 'start') {
      launches++;
      // Output saturation kills the client; the container may still be executing.
      return { code: null, error: 'output_limit', stdout: '', stderr: '' };
    }
    assert.equal(args[0], 'container');
    return launches ? { code: 1, error: null, stdout: '', stderr: 'synthetic inspection failure' } :
      { code: 0, error: null, stderr: '', stdout: JSON.stringify({ Id: id, Name: '/' + name, Image: LOCAL_IMAGE_ID,
        Config: { Labels: { 'org.patchproof.owned': 'true', 'org.patchproof.operation': name } } }) };
  } });
  const result = await runner.run({ files: { 'solution.py': good }, entrypoint: 'solution.py', timeoutSeconds: 10,
    cases: [check(), check({ id: 'case-two' })] }, signal());
  assert.equal(launches, 1);
  assert.equal(result.operationIds.length, 1);
  assert.equal(result.infrastructureError, 'container_cleanup_unconfirmed');
  assert.deepEqual(result.checks.map(row => row.status), ['error', 'error']);
  assert.equal(result.checks[1]!.message, 'container_cleanup_unconfirmed');
});

test('real local pinned Python container independently observes return, exception and input mutation', async () => {
  const runtime = await createLocalRuntime();
  assert.equal(runtime.status.available, true, runtime.status.reason ?? 'Local Python image required for this integration test.');
  const result = await runtime.checks.run({ files: { 'solution.py': good }, entrypoint: 'solution.py', timeoutSeconds: 15,
    cases: [check({ assertArgsUnchanged: true }), check({ id: 'none', args: [null], expected: undefined, expectedException: 'TypeError' })] }, signal());
  assert.equal(result.infrastructureError, null);
  assert.deepEqual(result.checks.map(c => c.status), ['pass', 'pass']);
  const mutated = await runtime.checks.run({ files: { 'solution.py': 'def unique(values):\n    values[:] = [3, 1]\n    return values\n' }, entrypoint: 'solution.py', timeoutSeconds: 10, cases: [check({ assertArgsUnchanged: true })] }, signal());
  assert.equal(mutated.checks[0]!.status, 'fail');
});

test('local cancellation removes its running container and records non-passing checks', async () => {
  const controller = new AbortController();
  let name = '';
  const runner = new DockerCheckRunner({ process: async (args, options) => {
    if (args[0] === 'create') name = args[args.indexOf('--name') + 1]!;
    if (args[0] === 'start') setTimeout(() => controller.abort(), 700);
    return runDocker(args, options);
  } });
  const result = await runner.run({ files: { 'solution.py': 'import time\ndef unique(values):\n    time.sleep(20)\n    return values\n' }, entrypoint: 'solution.py', cases: [check()], timeoutSeconds: 10 }, controller.signal);
  assert.equal(result.checks[0]!.status, 'error');
  assert.equal(result.infrastructureError, 'cancelled');
  const inspect = await runDocker(['container', 'inspect', name]);
  assert.notEqual(inspect.code, 0);
  assert.match(inspect.stderr, /No such (object|container)/);
});

test('in-container wall limit kills sleeping candidate before the longer host process timeout', async () => {
  let commandResult: Awaited<ReturnType<ProcessRunner>> | undefined;
  let name = '';
  const runner = new DockerCheckRunner({ process: async (args, options) => {
    if (args[0] === 'create') {
      name = args[args.indexOf('--name') + 1]!;
      // A far-future wall clock cannot grant more than this validated duration cap.
      const changed = [...args], position = changed.indexOf(GUEST_DEADLINE_LAUNCHER);
      changed[position + 1] = String(Date.now() + 60_000); changed[position + 2] = '1';
      return runDocker(changed, options);
    }
    if (args[0] !== 'start') return runDocker(args, options);
    // Deliberately leave the host watchdog longer to isolate the container timer.
    commandResult = await runDocker(args, { ...options, timeoutMs: 10_000 });
    return commandResult;
  } });
  const started = Date.now();
  const result = await runner.run({ files: { 'solution.py': 'import time\ndef unique(values):\n    time.sleep(20)\n    return values\n' },
    entrypoint: 'solution.py', cases: [check()], timeoutSeconds: 10 }, signal());
  assert.ok(Date.now() - started < 8000);
  assert.equal(commandResult?.error, null, 'Host watchdog must not cause termination.');
  assert.equal(commandResult?.code, 137, 'BusyBox SIGKILL must terminate the container command.');
  assert.equal(result.checks[0]!.status, 'error');
  const inspect = await runDocker(['container', 'inspect', name]);
  assert.notEqual(inspect.code, 0);
  assert.match(inspect.stderr, /No such (object|container)/);
});

test('Nebius fake transport maps verified methods and never includes oracle fields', async () => {
  const id = '12345678-9abc-4aba-aeda-0123456789ab';
  const calls: { url: string; method: string; body: unknown }[] = [];
  const transport = new NebiusSandboxTransport({ authorized: true, credential: async () => ({ token: 'SYNTHETIC', projectId: 'synthetic-project' }),
    fetch: async (url, init) => {
      assert.equal(new Headers(init?.headers).get('Project'), 'synthetic-project');
      calls.push({ url: String(url), method: init!.method!, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (init?.method === 'POST') return Response.json({ uuid: id }, { status: 201 });
      if (init?.method === 'DELETE') return new Response(null, { status: 202 });
      return Response.json({ uuid: id, kind: 'instance', status: 'SUCCESS', metadata: {}, consumed_cpu: 0.1 });
    } });
  assert.equal(await transport.spawnInvocation({ imageUuid: id, files: { '/candidate/solution.py': { uuid: id, uid: 65534, gid: 65534, mode: '0444' } }, entrypoint: '/candidate/solution.py',
    invocation: { function: 'unique', args: [[1]], kwargs: {} }, timeoutSeconds: 10 }, signal()), id);
  assert.equal((await transport.getOperation(id, signal())).status, 'SUCCESS');
  await transport.cancel(id, signal());
  assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'DELETE']);
  assert.ok(calls.every(c => c.url.startsWith('https://api.tokenfactory.nebius.com/sandboxes/v1/')));
  const request = calls[0]!.body as { networking: { enabled: boolean }; shell: boolean; stdin: { value: string } };
  assert.equal(request.networking.enabled, false);
  assert.equal(request.shell, false);
  assert.deepEqual(JSON.parse(Buffer.from(request.stdin.value, 'base64').toString()), { function: 'unique', args: [[1]], kwargs: {} });
  const unavailable = await new NebiusSandboxCheckRunner().run({ files: { 'solution.py': good }, entrypoint: 'solution.py', cases: [check()], timeoutSeconds: 10 }, signal());
  assert.match(unavailable.infrastructureError!, /controls_unverified/);
  assert.equal(unavailable.checks[0]!.status, 'error');
});
