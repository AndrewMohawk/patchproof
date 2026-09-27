import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { BudgetSchema, readiness, readConfiguration } from '../scripts/config.ts';

const root = new URL('../', import.meta.url);
const exec = promisify(execFile);

test('checked-in $25 total budget requires approval and rejects excess stage allocations', async () => {
  const config = await readConfiguration(root);
  assert.equal(config.budget.maxApprovedSpendUsd, 25);
  assert.ok(config.budget.ownerApproval);
  assert.ok(readiness(config).length > 0);
  assert.equal(BudgetSchema.safeParse({ ...config.budget, ownerApproval: null }).success, false);
  assert.equal(BudgetSchema.safeParse({ ...config.budget, stages: { ...config.budget.stages, pilot: 26 } }).success, false);
  assert.equal(BudgetSchema.safeParse({ ...config.budget, maxApprovedSpendUsd: -1 }).success, false);
});

test('doctor performs local diagnostics; real-provider/release commands fail closed', async () => {
  const script = new URL('scripts/cli.ts', root).pathname;
  const doctor = await exec(process.execPath, [script, 'doctor']);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.paidCalls, 0);
  assert.equal(report.gates.G0, 'blocked');
  for (const command of ['smoke', 'pilot', 'evaluate', 'release-check']) {
    try {
      await exec(process.execPath, [script, command]);
      assert.fail(`${command} must not report success`);
    } catch (error) {
      const failure = error as { code: number; stdout: string };
      assert.equal(failure.code, 2);
      const result = JSON.parse(failure.stdout);
      assert.equal(result.status, 'blocked');
      assert.equal(result.implementation, 'gate_report_only');
      assert.equal(result.experimentEpisodesExecuted, 0);
    }
  }
});

test('artifact commands reject arbitrary paths before reading files', async () => {
  const script = new URL('scripts/cli.ts', root).pathname;
  await assert.rejects(exec(process.execPath, [script, 'export', '../../outside']), error => {
    const failure = error as { code: number; stdout: string };
    assert.equal(failure.code, 2);
    assert.equal(JSON.parse(failure.stdout).error.code, 'invalid_request');
    return true;
  });
});
