import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BudgetLedger, BudgetLedgerError } from '../packages/orchestrator/src/budget-ledger.ts';

const budget = () => ({ schemaVersion: '1.0', currency: 'USD', maxApprovedSpendUsd: 1,
  ownerApproval: { approvedBy: 'SYNTHETIC METADATA ONLY', approvedAt: '2026-09-27T00:00:00.000Z', expiresAt: null, reference: 'unit-only' },
  verifiedCredits: [], stages: { smoke: 1, pilot: 0, evaluate: 0, hosting: 0 },
  episodeLimits: { inferenceCallLimit: 3, inputTokenLimit: 1000, outputTokenLimit: 1000, wallTimeLimitSeconds: 20, sandboxCpuSecondsLimit: 10, candidateBranchLimit: 3 },
  note: 'No external authorization or real billing.' });
const code = (name: string) => (error: unknown) => error instanceof BudgetLedgerError && error.code === name;

test('existing-only missing paths, empty files and unrelated databases never initialize an allowance', t => {
  const root = mkdtempSync(join(tmpdir(), 'patchproof-existing-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const missing = join(root, 'missing', 'budget.sqlite');
  assert.throws(() => new BudgetLedger({ filename: missing, budget: budget(), existingOnly: true }));
  assert.equal(existsSync(join(root, 'missing')), false);
  for (const name of ['empty', 'unrelated']) {
    const filename = join(root, name + '.sqlite');
    if (name === 'empty') writeFileSync(filename, '', { mode: 0o600 });
    else { const db = new DatabaseSync(filename); db.exec('CREATE TABLE unrelated(value TEXT)'); db.close(); chmodSync(filename, 0o600); }
    const before = readFileSync(filename);
    assert.throws(() => new BudgetLedger({ filename, budget: budget(), existingOnly: true }), code('existing_ledger_invalid'));
    assert.deepEqual(readFileSync(filename), before);
    for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(filename + suffix), false);
  }
});

test('existing-only reads the current durable approval and reservation inventory through a live WAL without initialization', t => {
  const root = mkdtempSync(join(tmpdir(), 'patchproof-existing-ledger-wal-')), filename = join(root, 'budget.sqlite'), initial = budget();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const writer = new BudgetLedger({ filename, budget: initial });
  try {
    const next = { ...initial, note: 'SYNTHETIC updated approved metadata' }; writer.syncApproval(next, { expectedRevision: 1 });
    writer.reserve({ id: 'invented', episodeId: 'invented-episode', stage: 'smoke', amountMicros: 1000, fingerprint: 'sha256:' + 'a'.repeat(64) });
    assert.ok(statSync(filename + '-wal').size > 0);
    const before = writer.snapshot(), events = writer.events();
    assert.throws(() => new BudgetLedger({ filename, budget: initial, existingOnly: true }), code('approval_mismatch'));
    const reader = new BudgetLedger({ filename, budget: next, existingOnly: true });
    try { assert.deepEqual(reader.snapshot(), before); assert.deepEqual(reader.events(), events); }
    finally { reader.close(); }
    assert.deepEqual(writer.snapshot(), before); assert.deepEqual(writer.events(), events);
  } finally { writer.close(); }
});

test('existing-only refuses missing tables, absent approval and changed schema without repairing or migrating them', t => {
  const root = mkdtempSync(join(tmpdir(), 'patchproof-existing-ledger-schema-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, sql, expected] of [
    ['old', 'DROP TABLE budget_accounting_receipts', 'existing_ledger_invalid'],
    ['approval', 'DELETE FROM budget_meta', 'ledger_corrupt'],
    ['trigger', 'CREATE TRIGGER unexpected AFTER INSERT ON budget_events BEGIN SELECT 1; END', 'existing_ledger_invalid'],
  ] as const) {
    const filename = join(root, name + '.sqlite'), initialized = new BudgetLedger({ filename, budget: budget() }); initialized.close();
    const db = new DatabaseSync(filename); db.exec(sql); db.close(); const before = readFileSync(filename);
    assert.throws(() => new BudgetLedger({ filename, budget: budget(), existingOnly: true }), code(expected));
    assert.deepEqual(readFileSync(filename), before);
  }
});

test('existing-only refuses permissive modes and filesystem aliases without chmod or following links', t => {
  const root = mkdtempSync(join(tmpdir(), 'patchproof-existing-ledger-path-')), filename = join(root, 'budget.sqlite');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initialized = new BudgetLedger({ filename, budget: budget() }); initialized.close();
  chmodSync(filename, 0o644);
  assert.throws(() => new BudgetLedger({ filename, budget: budget(), existingOnly: true }), code('invalid_path'));
  assert.equal(statSync(filename).mode & 0o777, 0o644); chmodSync(filename, 0o600);
  const alias = join(root, 'alias.sqlite'); symlinkSync(filename, alias);
  assert.throws(() => new BudgetLedger({ filename: alias, budget: budget(), existingOnly: true }), code('invalid_path'));
  rmSync(alias); linkSync(filename, alias);
  assert.throws(() => new BudgetLedger({ filename, budget: budget(), existingOnly: true }), code('invalid_path'));
  rmSync(alias); writeFileSync(filename + '-journal', '', { mode: 0o644 });
  assert.throws(() => new BudgetLedger({ filename, budget: budget(), existingOnly: true }), code('invalid_path'));
  assert.equal(statSync(filename + '-journal').mode & 0o777, 0o644);
});
