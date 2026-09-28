import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DockerCheckRunner } from '../workers/sandbox/index.ts';
import { runDocker } from '../workers/sandbox/process.ts';
import type { ProcessRunner } from '../workers/sandbox/process.ts';
import { FunctionCaseSchema } from '../packages/contracts/src/product.ts';

const constantCase = FunctionCaseSchema.parse({ id: 'constant', requirementId: 'R01', function: 'constant', args: [], expected: 17 });

test('real Docker reads nested owned sources under service umask 0077 and removes its workspace and container', async t => {
  // Node's test runner isolates this file in its own process; the prior umask is
  // restored even if the actual container control fails. No provider is used.
  const priorUmask = process.umask(0o077);
  const ownerRunId = randomUUID();
  let workspace = '';
  const modes: Record<string, number> = {};
  const files = {
    'nested/deep/solution.py': 'def constant():\n    return 17\n',
    'nested/sibling.py': '# Benign unused source; permissions also need to be portable.\n',
    'support.py': '# Benign root source.\n',
  };
  const observe: ProcessRunner = async (args, options) => {
    if (args[0] === 'create') {
      const mount = args[args.indexOf('--mount') + 1]!;
      const match = /^type=bind,src=(.+),dst=\/candidate,readonly$/.exec(mount);
      assert.ok(match);
      workspace = match[1]!;
      for (const path of ['', 'nested', 'nested/deep', ...Object.keys(files)]) {
        const info = await lstat(join(workspace, path));
        assert.equal(info.isSymbolicLink(), false);
        modes[path || '.'] = info.mode & 0o777;
      }
    }
    return runDocker(args, options);
  };
  try {
    const result = await new DockerCheckRunner({ process: observe }).run({ files,
      entrypoint: 'nested/deep/solution.py', cases: [constantCase], timeoutSeconds: 30, ownerRunId,
    }, new AbortController().signal);
    t.diagnostic(JSON.stringify({ ownerRunId, result, modes }));
    assert.equal(result.isolation, 'local_container');
    assert.equal(result.infrastructureError, null);
    assert.equal(result.operationIds.length, 1);
    const lifecycle = JSON.parse(result.checks[0]!.log).dockerLifecycle;
    assert.equal(lifecycle.createAcknowledged, true);
    assert.equal(lifecycle.cleanupConfirmed, true);
    await assert.rejects(lstat(workspace), { code: 'ENOENT' });
    const remaining = await runDocker(['ps', '-aq', '--filter', `label=org.patchproof.run-id=${ownerRunId}`]);
    assert.equal(remaining.code, 0, remaining.error ?? remaining.stderr);
    assert.equal(remaining.stdout.trim(), '');
    assert.equal(result.checks[0]!.status, 'pass', result.checks[0]!.message);
    assert.equal(result.checks[0]!.actual, 17);
    assert.deepEqual(modes, { '.': 0o755, nested: 0o755, 'nested/deep': 0o755,
      'nested/deep/solution.py': 0o444, 'nested/sibling.py': 0o444, 'support.py': 0o444 });
    assert.equal(process.umask(), 0o077, 'Runner must not change the caller umask.');
  } finally {
    process.umask(priorUmask);
  }
});

test('invalid paths stop before any Docker or workspace activity', async () => {
  let calls = 0;
  const runner = new DockerCheckRunner({ process: async () => { calls++; throw new Error('Must not call Docker.'); } });
  for (const path of ['../outside.py', '/outside.py', 'nested/../../outside.py', 'nested//source.py']) {
    const result = await runner.run({ files: { [path]: 'def constant():\n    return 17\n' }, entrypoint: path,
      cases: [constantCase], timeoutSeconds: 30 }, new AbortController().signal);
    assert.equal(result.infrastructureError, 'invalid_candidate_input');
    assert.deepEqual(result.operationIds, []);
  }
  assert.equal(calls, 0);
});
