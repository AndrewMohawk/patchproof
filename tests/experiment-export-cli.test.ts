import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ExperimentDispatcher } from '../workers/evaluator/dispatcher.ts';
import { hashJson, planExperiment } from '../workers/evaluator/protocol.ts';
import { ExperimentExportOperatorConfigSchema, runExperimentExportOperator } from '../scripts/experiment-export-cli.ts';
import { operatorJsonDigest } from '../scripts/operator-files.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';

const H = 'sha256:' + 'a'.repeat(64), J = 'sha256:' + 'b'.repeat(64);
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'patchproof-export-cli-')), projectRoot = join(directory, 'project');
  mkdirSync(projectRoot, { mode: 0o700 });
  t.after(() => { const bundle = join(directory, 'bundle'); if (existsSync(bundle)) chmodSync(bundle, 0o700);
    rmSync(directory, { recursive: true, force: true }); });
  const tasks = Array.from({ length: 4 }, (_, repo) => Array.from({ length: 5 }, (_, index) => ({
    id: `invented-${repo}-${index}`, repoId: `invented-${repo}`, split: 'development' as const, fixtureDigest: H, oracleDigest: J,
  }))).flat();
  const plan = planExperiment({ kind: 'pilot', tasks,
    limits: { inferenceCallLimit: 24, inputTokenLimit: 1000, outputTokenLimit: 1000, wallTimeLimitSeconds: 900,
      sandboxCpuSecondsLimit: 900, maxApprovedSpendUsd: 0 }, sourceManifestDigest: H, modelLockDigest: null,
    policyDigest: J, approvedExperimentBudgetUsd: 0, estimatedExperimentCostUsd: null });
  const filename = join(directory, 'dispatch.sqlite');
  new ExperimentDispatcher({ filename, plan, transport: { executionMode: 'synthetic', modelLockDigest: null, policyDigest: J,
    async execute() { throw new Error('Export must never execute.'); }, async adjudicate() { throw new Error('Export must never adjudicate.'); } } }).close();
  const db = new DatabaseSync(filename, { readOnly: true });
  const transportDigest = String(db.prepare('SELECT transport_digest FROM experiment WHERE id=1').get()!.transport_digest); db.close();
  const config = ExperimentExportOperatorConfigSchema.parse({ schemaVersion: '1.0', kind: 'patchproof-experiment-export-operator',
    dispatcherDatabase: filename, directory: join(directory, 'bundle'), bindings: { sourceDigest: H, planDigest: hashJson(plan), transportDigest },
    sourceBinding: 'expected-historical-lock', readiness: null });
  const path = join(directory, 'config.json');
  const save = () => writeFileSync(path, JSON.stringify(config), { mode: 0o600 }); save();
  const args = () => ['export', path, operatorJsonDigest(config)];
  return { directory, projectRoot, config, path, save, args };
}

test('export command preserves a wholly pending synthetic grid without invoking execution', t => {
  const s = setup(t), result = runExperimentExportOperator(s.args(), s.projectRoot);
  assert.equal(result.exitCode, 0); assert.equal(result.output.status, 'exported');
  assert.ok('plannedEpisodes' in result.output); assert.equal(result.output.plannedEpisodes, 72);
  assert.equal(result.output.terminalEpisodes, 0); assert.equal(result.output.complete, false);
  assert.equal(result.output.executionPerformed, false); assert.equal(result.output.sourceExecutionVerified, false);
  assert.equal(result.output.providerCalls, 0); assert.equal(result.output.executionMode, 'synthetic');
  const summary = JSON.parse(readFileSync(join(s.config.directory, 'summary.json'), 'utf8'));
  assert.equal(summary.pendingEpisodes, 72); assert.equal(summary.unknownCostEpisodeIds.length, 72);
  assert.equal(JSON.parse(readFileSync(join(s.config.directory, 'analysis.json'), 'utf8')).reason, 'synthetic-excluded');
});

test('actual verification CLI uses the pinned manifest without opening the old database', t => {
  const s = setup(t), exported = runExperimentExportOperator(s.args(), s.projectRoot);
  assert.equal(exported.exitCode, 0); assert.ok('manifestDigest' in exported.output);
  rmSync(s.config.dispatcherDatabase);
  const cli = new URL('../scripts/experiment-export-cli.ts', import.meta.url);
  const child = spawnSync(process.execPath, [cli.pathname, 'verify', s.path, operatorJsonDigest(s.config), exported.output.manifestDigest!], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).integrityVerified, true);
  assert.equal(child.stdout.includes(s.directory), false);
  const wrong = runExperimentExportOperator(['verify', s.path, operatorJsonDigest(s.config), J], s.projectRoot);
  assert.equal(wrong.exitCode, 2);
});

test('operator config binding and current-checkout failures leave no partial export', t => {
  const s = setup(t), args = s.args(); args[2] = J;
  assert.equal(runExperimentExportOperator(args, s.projectRoot).exitCode, 2);
  assert.equal(existsSync(s.config.directory), false);
  s.config.bindings.planDigest = J; s.save();
  assert.equal(runExperimentExportOperator(s.args(), s.projectRoot).exitCode, 2);
  assert.equal(existsSync(s.config.directory), false);
  s.config.sourceBinding = 'current-operational-lock'; s.save();
  assert.equal(runExperimentExportOperator(s.args(), s.projectRoot).exitCode, 2);
  assert.equal(existsSync(s.config.directory), false);
});

test('operator refuses overwrite and unapproved live readiness on synthetic captures', t => {
  const s = setup(t), result = runExperimentExportOperator(s.args(), s.projectRoot);
  assert.equal(result.exitCode, 0);
  assert.equal(runExperimentExportOperator(s.args(), s.projectRoot).exitCode, 2);
  s.config.directory = join(s.directory, 'second');
  s.config.readiness = { path: join(s.directory, 'invented-readiness.json'), acceptedDigest: H }; s.save();
  writeFileSync(s.config.readiness.path, JSON.stringify({ privateSentinel: 'must-not-print' }), { mode: 0o600 });
  const rejected = runExperimentExportOperator(s.args(), s.projectRoot);
  assert.equal(rejected.exitCode, 2); assert.equal(JSON.stringify(rejected).includes('must-not-print'), false);
  assert.equal(existsSync(s.config.directory), false);
});

test('current-source binding uses the source-map digest, and rejects a whole-lock digest', t => {
  const s = setup(t);
  for (const directory of ['packages', 'workers', 'apps', 'scripts']) mkdirSync(join(s.projectRoot, directory));
  for (const file of ['Makefile', 'tsconfig.json', 'package.json', 'package-lock.json', 'runtime-lock.json', 'budget.json', 'owner-decisions.json']) {
    writeFileSync(join(s.projectRoot, file), '{}\n');
  }
  mkdirSync(join(s.projectRoot, 'research/product-v3'), { recursive: true });
  writeFileSync(join(s.projectRoot, 'research/product-v3/model-discovery.json'), '{"scope":"synthetic-test-only"}\n');
  const lock = buildOperationalLock(s.projectRoot);
  s.config.sourceBinding = 'current-operational-lock'; s.config.bindings.sourceDigest = digestJson(lock); s.save();
  assert.equal(runExperimentExportOperator(s.args(), s.projectRoot).exitCode, 2);
  assert.equal(existsSync(s.config.directory), false);
  s.config.bindings.sourceDigest = digestJson(lock.sources); s.save();
  assert.equal(runExperimentExportOperator(s.args(), s.projectRoot).exitCode, 0);
});
