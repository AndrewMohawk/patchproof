import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { SmokeOperatorSessions, SmokeOperatorSessionError } from '../packages/orchestrator/src/smoke-operator-sessions.ts';
import { digestBytes } from '../packages/contracts/src/digest.ts';

const BINDING = digestBytes('synthetic session configuration');
const MODULE = new URL('../packages/orchestrator/src/smoke-operator-sessions.ts', import.meta.url).href;
const run = promisify(execFile);
const code = (expected: string) => (error: unknown) => error instanceof SmokeOperatorSessionError && error.code === expected;
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-session-state-')), filename = join(directory, 'sessions.db');
  const store = new SmokeOperatorSessions({ filename });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const input = { episodeId: randomUUID(), configDigest: BINDING, scope: 'synthetic-test' as const };
  return { directory, filename, store, input };
}

test('one start token owns copied summaries through running and terminal state', t => {
  const { store, input } = setup(t), claim = store.claimStart(input);
  assert.equal(claim.granted, true); if (!claim.granted) return;
  assert.equal(claim.session.phase, 'starting'); assert.equal(claim.session.ownerPid, process.pid);
  assert.equal(claim.session.ownerAlive, true); assert.equal(claim.session.summary, null);
  const summary = { label: 'synthetic status', count: 1 };
  const updated = store.update(claim.token, summary); summary.count = 2;
  assert.equal(updated.phase, 'running'); assert.deepEqual(updated.summary, { label: 'synthetic status', count: 1 });
  updated.summary = 'edited return';
  assert.deepEqual(store.status(input.episodeId)!.summary, { label: 'synthetic status', count: 1 });
  assert.equal(JSON.stringify(store.status(input.episodeId)).includes(claim.token), false);
  assert.equal(store.finish(claim.token, { result: 'synthetic-complete' }).phase, 'terminal');
  assert.throws(() => store.update(claim.token, null), code('not_owner'));
  assert.throws(() => store.finish(claim.token, null), code('not_owner'));
  assert.equal(store.markInterrupted(input.episodeId).phase, 'terminal');
});

test('repeat and reopened starts never regrant ownership, including UUID case aliases', t => {
  const { store, filename, input } = setup(t), claim = store.claimStart(input);
  if (!claim.granted) throw new Error('missing initial claim');
  const other = new SmokeOperatorSessions({ filename }); t.after(() => other.close());
  for (const instance of [store, other]) {
    const repeated = instance.claimStart({ ...input, episodeId: input.episodeId.toUpperCase() });
    assert.equal(repeated.granted, false); assert.equal(repeated.token, null);
  }
  assert.throws(() => other.update(claim.token, null), code('not_owner'));
  store.close();
  assert.throws(() => other.finish(claim.token, null), code('not_owner'));
  assert.equal(other.claimStart(input).granted, false);
});

test('changed configuration and live/synthetic identity cannot reuse an episode', t => {
  const { store, input } = setup(t); store.claimStart(input);
  assert.throws(() => store.claimStart({ ...input, configDigest: digestBytes('changed') }), code('binding_conflict'));
  assert.throws(() => store.claimStart({ ...input, scope: 'live' }), code('binding_conflict'));
  assert.equal(store.status(input.episodeId)!.scope, 'synthetic-test');
});

test('cancellation persists across instances and cannot be cleared by owner progress', t => {
  const { store, filename, input } = setup(t), claim = store.claimStart(input);
  if (!claim.granted) throw new Error('missing initial claim');
  const other = new SmokeOperatorSessions({ filename }); t.after(() => other.close());
  assert.equal(other.requestCancel(input.episodeId).cancelRequested, true);
  assert.equal(store.update(claim.token, { cleanup: 'pending' }).cancelRequested, true);
  assert.equal(store.finish(claim.token, { cleanup: 'observed' }).cancelRequested, true);
  assert.equal(other.requestCancel(input.episodeId).phase, 'terminal');
  assert.equal(other.status(input.episodeId)!.cancelRequested, true);
});

test('living owner cannot be interrupted or taken over', t => {
  const { store, input } = setup(t); store.claimStart(input);
  assert.throws(() => store.markInterrupted(input.episodeId), code('owner_still_alive'));
  assert.equal(store.status(input.episodeId)!.phase, 'starting');
  assert.equal(store.claimStart(input).granted, false);
});

test('child-process exit preserves unfinished state and marking interruption grants no retry', async t => {
  const { store, filename, input } = setup(t);
  const script = `import {SmokeOperatorSessions} from ${JSON.stringify(MODULE)};
    const s=new SmokeOperatorSessions({filename:process.env.SESSION_TEST_PATH});
    const c=s.claimStart(JSON.parse(process.env.SESSION_TEST_INPUT));
    if(!c.granted) process.exit(2); s.update(c.token,{synthetic:'partial'}); process.exit(0);`;
  await run(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, SESSION_TEST_PATH: filename, SESSION_TEST_INPUT: JSON.stringify(input) } });
  const before = store.status(input.episodeId)!;
  assert.equal(before.ownerAlive, false); assert.equal(before.phase, 'running');
  assert.deepEqual(before.summary, { synthetic: 'partial' });
  store.requestCancel(input.episodeId);
  const after = store.markInterrupted(input.episodeId);
  assert.equal(after.phase, 'interrupted'); assert.equal(after.cancelRequested, true);
  assert.deepEqual(after.summary, before.summary);
  assert.equal(store.markInterrupted(input.episodeId).phase, 'interrupted');
  assert.equal(store.claimStart(input).granted, false);
});

test('multiple processes racing one durable identity receive exactly one ownership grant', async t => {
  const { store, filename, input } = setup(t);
  const script = `import {SmokeOperatorSessions} from ${JSON.stringify(MODULE)};
    const s=new SmokeOperatorSessions({filename:process.env.SESSION_TEST_PATH});
    console.log(JSON.stringify({granted:s.claimStart(JSON.parse(process.env.SESSION_TEST_INPUT)).granted})); s.close();`;
  const results = await Promise.all(Array.from({ length: 4 }, () => run(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, SESSION_TEST_PATH: filename, SESSION_TEST_INPUT: JSON.stringify(input) }
  })));
  assert.equal(results.map(result => JSON.parse(result.stdout) as { granted: boolean }).filter(result => result.granted).length, 1);
  assert.equal(store.claimStart(input).granted, false);
});

test('a separate process cancellation is observed by the live owner', async t => {
  const { store, filename, input } = setup(t), claim = store.claimStart(input);
  if (!claim.granted) throw new Error('missing initial claim');
  const script = `import {SmokeOperatorSessions} from ${JSON.stringify(MODULE)};
    const s=new SmokeOperatorSessions({filename:process.env.SESSION_TEST_PATH}); s.requestCancel(process.env.SESSION_TEST_ID); s.close();`;
  await run(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, SESSION_TEST_PATH: filename, SESSION_TEST_ID: input.episodeId } });
  assert.equal(store.status(input.episodeId)!.cancelRequested, true);
  assert.equal(store.finish(claim.token, null).cancelRequested, true);
});

test('input validation rejects invalid identifiers, unknown claim fields and non-JSON summaries', t => {
  const { store, input } = setup(t);
  assert.throws(() => store.claimStart({ ...input, episodeId: '../escape' }));
  assert.throws(() => store.claimStart({ ...input, configDigest: 'bad' }));
  assert.throws(() => store.claimStart({ ...input, extra: true } as typeof input));
  const claim = store.claimStart(input); if (!claim.granted) throw new Error('missing initial claim');
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  let getterCalled = false;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { getterCalled = true; return 'forbidden'; } });
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), () => null, cycle, getter, Array(1), { value: undefined }, { [Symbol('x')]: 1 }]) {
    assert.throws(() => store.update(claim.token, value), code('invalid_summary'));
  }
  assert.equal(getterCalled, false);
  assert.throws(() => store.update(claim.token, 'a'.repeat(70_000)), code('summary_too_large'));
  assert.equal(store.status(input.episodeId)!.phase, 'starting');
});

test('unknown identity operations do not create a session', t => {
  const { store, input } = setup(t);
  assert.equal(store.status(input.episodeId), null);
  assert.throws(() => store.requestCancel(input.episodeId), code('missing_session'));
  assert.throws(() => store.markInterrupted(input.episodeId), code('missing_session'));
  assert.throws(() => store.update('unknown-token', null), code('not_owner'));
  assert.equal(store.status(input.episodeId), null);
});

test('database and sidecars are private; existing nonprivate or linked paths reject', t => {
  const { store, directory, filename, input } = setup(t); store.claimStart(input);
  for (const suffix of ['', '-wal', '-shm']) assert.equal(statSync(filename + suffix).mode & 0o077, 0);
  const link = join(directory, 'alias.db'); symlinkSync(filename, link);
  assert.throws(() => new SmokeOperatorSessions({ filename: link }), code('invalid_file'));
  rmSync(link); linkSync(filename, link);
  assert.throws(() => new SmokeOperatorSessions({ filename: link }), code('invalid_file'));
  assert.throws(() => store.status(input.episodeId), code('invalid_file')); rmSync(link);
  chmodSync(filename, 0o644);
  assert.throws(() => new SmokeOperatorSessions({ filename }), code('invalid_file'));
  chmodSync(filename, 0o600);
  const exposed = join(directory, 'exposed.db'); writeFileSync(exposed, '', { mode: 0o600 });
  symlinkSync(filename, exposed + '-wal');
  assert.throws(() => new SmokeOperatorSessions({ filename: exposed }), code('invalid_file'));
});

test('relative, traversal, absent or nonprivate parents and symlink ancestors reject', t => {
  const { directory } = setup(t);
  for (const filename of ['relative.db', directory + '/../traversal.db', join(directory, 'missing', 'session.db')]) {
    assert.throws(() => new SmokeOperatorSessions({ filename }));
  }
  const exposed = join(directory, 'exposed'); mkdirSync(exposed, { mode: 0o755 });
  assert.throws(() => new SmokeOperatorSessions({ filename: join(exposed, 'session.db') }), code('nonprivate_directory'));
  const alias = join(directory, 'alias'); symlinkSync(directory, alias);
  assert.throws(() => new SmokeOperatorSessions({ filename: join(alias, 'session.db') }), code('invalid_path'));
});

test('unrelated SQLite database is rejected without changing its application or journal mode', t => {
  const { directory } = setup(t), filename = join(directory, 'other.db');
  writeFileSync(filename, '', { mode: 0o600 });
  const db = new DatabaseSync(filename); db.exec('CREATE TABLE unrelated(value TEXT);'); db.close();
  const before = readFileSync(filename);
  assert.throws(() => new SmokeOperatorSessions({ filename }), code('wrong_database'));
  assert.deepEqual(readFileSync(filename), before);
});

test('unsupported newer store schema is never silently downgraded', t => {
  const { store, filename } = setup(t); store.close();
  const db = new DatabaseSync(filename); db.exec('PRAGMA user_version=2;'); db.close();
  assert.throws(() => new SmokeOperatorSessions({ filename }), code('unsupported_schema'));
  const reader = new DatabaseSync(filename, { readOnly: true });
  assert.equal(reader.prepare('PRAGMA user_version').get()!.user_version, 2); reader.close();
});

test('database replacement and closed stores cannot continue using stale ownership', t => {
  const { store, filename, input } = setup(t), claim = store.claimStart(input);
  if (!claim.granted) throw new Error('missing initial claim');
  renameSync(filename, filename + '.old'); writeFileSync(filename, '', { mode: 0o600 });
  assert.throws(() => store.update(claim.token, null), code('database_replaced'));
  store.close(); assert.throws(() => store.status(input.episodeId), code('store_closed'));
});
