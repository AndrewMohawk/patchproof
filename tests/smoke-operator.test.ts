import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digestBytes } from '../packages/contracts/src/digest.ts';
import type { ProductRun } from '../packages/contracts/src/product.ts';
import { createTrustedSmokeEpisode } from '../packages/orchestrator/src/trusted-smoke.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { createSmokeOperator, SmokeOperatorConfigSchema, smokeRunSummary } from '../scripts/smoke-operator.ts';
import type { SmokeOperatorTesting } from '../scripts/smoke-operator.ts';
import { operatorData, privateJson } from './helpers/smoke-operator-data.ts';

// Every account fact, task and execution below is synthetic. Hooks cannot be selected by CLI JSON.
function setup(t: TestContext, settings: { wait?: boolean; readCredentials?: boolean; reject?: boolean } = {}) {
  const s = operatorData(); t.after(() => rmSync(s.directory, { recursive: true, force: true }));
  const observed = { constructors: 0, starts: 0, credentials: [] as string[], aborted: false, source: s.sourceDigest };
  const testing: SmokeOperatorTesting = { scope: 'synthetic-test', sourceDigest: () => observed.source, buildRuntime: input => {
    observed.constructors++;
    // Real constructor validates source/account/control/envelope/ledger gates, but is never started.
    const validated = createTrustedSmokeEpisode(input);
    let result: Record<string, unknown> = { phase: 'starting', usage: { measuredCostUsd: null }, sandboxOperationIds: [] };
    let resolve!: (value: Record<string, unknown>) => void, reject!: (error: Error) => void;
    const done = new Promise<Record<string, unknown>>((yes, no) => { resolve = yes; reject = no; });
    return { envelope: validated.envelope, snapshot: () => result, settled: () => done, close: () => validated.close(), start: signal => {
      observed.starts++;
      result = { phase: 'running', usage: { measuredCostUsd: null }, sandboxOperationIds: ['synthetic:upload-intent:known-unit'], modelRequestIntentIds: ['synthetic-request'] };
      void (async () => {
        try {
          input.verifySourceDigest();
          if (settings.readCredentials) {
            observed.credentials.push(await input.model.credential()); observed.credentials.push((await input.sandbox.credential()).token);
          }
          if (settings.reject) throw new Error('SECRET-RAW-TRANSPORT-ERROR');
          if (settings.wait && !signal.aborted) await new Promise<void>(finish => signal.addEventListener('abort', () => finish(), { once: true }));
          observed.aborted = signal.aborted;
          result = { ...result, phase: 'terminal', terminalStatus: signal.aborted ? 'needs_review' : 'synthetic_completed', billing: 'unreconciled', actualExecution: false };
          resolve(result);
        } catch (error) { reject(error as Error); }
      })();
    } };
  } };
  return { ...s, observed, testing, operator: createSmokeOperator({ projectRoot: s.projectRoot, testing }) };
}

test('preflight validates fixed runtime gates but reads no credential contents, makes no calls and reserves nothing', async t => {
  const s = setup(t);
  writeFileSync(s.config.modelCredentialFile, 'deliberately invalid credential JSON'); writeFileSync(s.config.sandboxCredentialFile, 'also invalid');
  const result = await s.operator.preflight(s.filename);
  assert.equal(result.scope, 'no-execution'); assert.equal(result.providerCalls, 0); assert.equal(result.credentialsRead, 0);
  assert.equal(result.reservationCreated, false); assert.equal(s.observed.starts, 0); assert.deepEqual(s.observed.credentials, []);
  const ledger = new BudgetLedger({ filename: s.config.ledgerFile, budget: s.budget }); t.after(() => ledger.close());
  assert.equal(ledger.snapshot().reservationCount, 0); assert.equal(s.operator.status(s.filename).status, 'not-started');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('explicit synthetic start reads credentials only after claim and repeated identity never starts again', async t => {
  const s = setup(t, { readCredentials: true });
  const first = await s.operator.start(s.filename, new AbortController().signal);
  assert.equal(first.scope, 'synthetic-test'); assert.equal(first.session.phase, 'terminal'); assert.equal(first.reused, false);
  assert.equal(s.observed.credentials.length, 2); assert.equal(s.observed.starts, 1);
  const second = await createSmokeOperator({ projectRoot: s.projectRoot, testing: s.testing }).start(s.filename, new AbortController().signal);
  assert.equal(second.reused, true); assert.equal(s.observed.starts, 1); assert.equal(s.observed.constructors, 1);
  assert.equal(JSON.stringify(first).includes('UNIT-ONLY-MODEL-SECRET'), false);
  const other = { ...s.config, variant: 'baseline' }; privateJson(s.filename, other);
  await assert.rejects(s.operator.start(s.filename, new AbortController().signal), /binding_conflict/);
  assert.equal(s.observed.starts, 1);
});

test('another operator can durably request cancellation and read handles after credential and tokenizer removal', async t => {
  const s = setup(t, { wait: true }), pending = s.operator.start(s.filename, new AbortController().signal);
  while (!s.observed.starts) await new Promise(resolve => setTimeout(resolve, 5));
  rmSync(s.config.modelCredentialFile); rmSync(s.config.sandboxCredentialFile); rmSync(s.config.tokenizerArtifactFile);
  const other = createSmokeOperator({ projectRoot: s.projectRoot, testing: s.testing });
  const status = other.status(s.filename); assert.equal(status.session!.scope, 'synthetic-test');
  assert.equal(status.cleanup, 'remote-cleanup-not-established'); assert.equal(status.commandProviderCalls, 0);
  assert.equal(other.cancel(s.filename).session.cancelRequested, true);
  const result = await pending;
  assert.equal(s.observed.aborted, true); assert.equal(result.session.phase, 'terminal');
  assert.ok(JSON.stringify(result).includes('synthetic:upload-intent:known-unit')); assert.equal(s.observed.starts, 1);
});

test('abort signal is forwarded and pre-aborted start never claims an identity', async t => {
  const s = setup(t, { wait: true }), controller = new AbortController(); controller.abort();
  await assert.rejects(s.operator.start(s.filename, controller.signal)); assert.equal(s.operator.status(s.filename).status, 'not-started');
  const active = new AbortController(), pending = s.operator.start(s.filename, active.signal);
  while (!s.observed.starts) await new Promise(resolve => setTimeout(resolve, 5));
  active.abort(); const result = await pending;
  assert.equal(result.session.phase, 'terminal'); assert.equal(s.observed.aborted, true);
});

test('source gate denial remains terminal one-attempt identity without credentials or dispatch', async t => {
  const s = setup(t); s.observed.source = digestBytes('changed-source');
  await assert.rejects(s.operator.start(s.filename, new AbortController().signal), /source_changed/);
  assert.equal(s.observed.starts, 0); assert.deepEqual(s.observed.credentials, []);
  const status = s.operator.status(s.filename); assert.equal(status.session!.phase, 'terminal');
  assert.ok(JSON.stringify(status).includes('smoke_source_changed'));
  s.observed.source = s.sourceDigest;
  const retry = await s.operator.start(s.filename, new AbortController().signal);
  assert.equal(retry.reused, true); assert.equal(s.observed.starts, 0);
});

test('failed runtime retains known handles and unknown billing while sanitizing raw error details', async t => {
  const s = setup(t, { reject: true });
  await assert.rejects(s.operator.start(s.filename, new AbortController().signal));
  const status = s.operator.status(s.filename), encoded = JSON.stringify(status);
  assert.ok(encoded.includes('synthetic:upload-intent:known-unit')); assert.ok(encoded.includes('synthetic-request'));
  assert.ok(encoded.includes('unreconciled')); assert.ok(encoded.includes('smoke_operator_unavailable')); assert.equal(encoded.includes('SECRET-RAW'), false);
  assert.equal(status.session!.phase, 'terminal');
});

test('runtime proof expiry and unresolved project episode ceilings fail preflight without reading credentials', async t => {
  const s = setup(t);
  s.config.modelProof.validUntil = new Date(Date.now() - 1).toISOString(); privateJson(s.filename, s.config);
  await assert.rejects(s.operator.preflight(s.filename), /verification_window/); assert.equal(s.observed.starts, 0);
  const budget = { ...s.budget, episodeLimits: { ...s.budget.episodeLimits, inputTokenLimit: null } };
  privateJson(join(s.projectRoot, 'budget.json'), budget);
  // Binding mismatch is checked before an unconfigured ceiling, both deny dispatch.
  await assert.rejects(s.operator.preflight(s.filename), /budget_binding_changed/);
  assert.deepEqual(s.observed.credentials, []);
});

test('operator refuses inline keys, in-project references, symlinks and nonprivate configuration', async t => {
  const s = setup(t);
  assert.throws(() => SmokeOperatorConfigSchema.parse({ ...s.config, token: 'INLINE-SECRET' }));
  privateJson(s.filename, { ...s.config, modelCredentialFile: join(s.projectRoot, 'key.json') });
  await assert.rejects(s.operator.preflight(s.filename), /operator_path_inside_project/);
  privateJson(s.filename, s.config); chmodSync(s.filename, 0o644);
  await assert.rejects(s.operator.preflight(s.filename), /operator_file_not_private/); chmodSync(s.filename, 0o600);
  rmSync(s.config.modelCredentialFile); symlinkSync(s.config.sandboxCredentialFile, s.config.modelCredentialFile);
  await assert.rejects(s.operator.preflight(s.filename), /operator_file_not_private/);
  assert.equal(s.observed.starts, 0);
});

test('metadata projection preserves failed response and sandbox intents without candidate or log contents', () => {
  const run = { id: 'unit', phase: 'terminal', terminalStatus: 'needs_review', reason: 'unit', usage: { measuredCostUsd: null },
    sandboxOperationIds: ['nebius:upload-intent:unit', 'nebius:request-intent:unit'],
    candidates: [{ providerRequestId: 'response-success', summary: 'do not project' }],
    events: [{ message: 'Nebius model request_intent: unit-request. Billing remains unreconciled.' },
      { message: 'Failed inference response ID: response-failed. Billing remains unreconciled.' }, { message: 'unrelated SECRET log' }] } as unknown as ProductRun;
  const result = smokeRunSummary(run);
  assert.deepEqual(result.modelResponseIds, ['response-success', 'response-failed']); assert.deepEqual(result.modelRequestIntentIds, ['unit-request']);
  assert.equal(result.sandboxOperationIds.length, 2); assert.equal(JSON.stringify(result).includes('SECRET'), false);
  run.sandboxOperationIds = Array.from({ length: 800 }, (_, index) => `nebius:instance-intent:${index}`);
  const large = smokeRunSummary(run);
  assert.equal(large.sandboxOperationCount, 800); assert.equal(large.sandboxOperationIds.length, 192); assert.equal(large.sandboxOperationIdsTruncated, true);
  assert.equal(large.completeOperationJournal, 'runs.sqlite');
});

test('production CLI without explicit configuration remains blocked with safe JSON and no discovery', () => {
  try { execFileSync(process.execPath, ['scripts/smoke-operator.ts', 'preflight'], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); assert.fail('must refuse'); }
  catch (error) {
    const result = error as { status: number; stdout: string }; assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, 'smoke_usage');
  }
});
