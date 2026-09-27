import test from 'node:test';
import assert from 'node:assert/strict';
import { MockRepairProvider, NebiusRepairProvider, RepairError, SCRIPTED_BAD } from '../workers/repair/index.ts';
import type { NebiusRepairOptions } from '../workers/repair/index.ts';
import type { RepairInput } from '../packages/contracts/src/product.ts';

const input = (): RepairInput => ({ taskId: 'stable-unique-01', description: 'Stable unique values.', requirements: [{ id: 'R01', text: 'Preserve order.' }],
  files: { 'solution.py': 'def unique(values):\n    return values\n' }, editAllowlist: ['solution.py'], visibleCases: [], feedback: [], attempt: 0,
  remaining: { inferenceCallLimit: 3, inputTokenLimit: 24000, outputTokenLimit: 6000, wallTimeLimitSeconds: 120,
    sandboxCpuSecondsLimit: 60, maxApprovedSpendUsd: 0 } });
const signal = () => new AbortController().signal;
const fakeOptions = (fetch: typeof globalThis.fetch): NebiusRepairOptions => ({ modelId: 'nvidia/test-only-fixture', accountVerifiedAt: '2026-09-27T00:00:00Z',
  inputUsdPerMillionTokens: 0.06, outputUsdPerMillionTokens: 0.24, authorized: true,
  credential: async () => 'SYNTHETIC-TEST-TOKEN', countInputTokens: () => 100, fetch });
const completion = (files: Record<string, string> = { 'solution.py': 'def unique(values):\n    return []\n' }) => Response.json({ id: 'fake-request-001', model: 'nvidia/test-only-fixture',
  choices: [{ message: { content: JSON.stringify({ files, summary: 'Synthetic transport test.' }) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 20 } });

test('scripted mock is task bounded and uses the same attempt/feedback rule for every caller', async () => {
  const provider = new MockRepairProvider();
  const first = await provider.propose(input(), signal());
  assert.equal(first.files['solution.py'], SCRIPTED_BAD);
  assert.match(first.summary, /SCRIPTED MOCK/);
  assert.equal(first.usage.inferenceCalls, 0);
  const next = { ...input(), attempt: 1, files: first.files, feedback: [{ requirementId: 'R01', status: 'fail', message: 'Order differs.' }] };
  const second = await provider.propose(next, signal());
  assert.notEqual(second.files['solution.py'], SCRIPTED_BAD);
  assert.deepEqual((await provider.propose({ ...next, files: input().files }, signal())).files, second.files);
  assert.equal((await provider.propose({ ...next, feedback: [] }, signal())).files['solution.py'], SCRIPTED_BAD);
  await assert.rejects(provider.propose({ ...input(), taskId: 'other-task' }, signal()), (e: unknown) => e instanceof RepairError && e.code === 'mock_task_unavailable');
});

test('Nebius adapter refuses authorization/budget failure before credential access or fetch', async () => {
  let calls = 0;
  const options = fakeOptions(async () => { calls++; return completion(); });
  options.credential = async () => { calls++; return 'SYNTHETIC'; };
  const provider = new NebiusRepairProvider(options);
  await assert.rejects(provider.propose(input(), signal()), (e: unknown) => e instanceof RepairError && e.code === 'budget_exhausted');
  assert.equal(calls, 0);
  options.authorized = false;
  await assert.rejects(provider.propose({ ...input(), remaining: { ...input().remaining, maxApprovedSpendUsd: 1 } }, signal()), /authorization/i);
  assert.equal(calls, 0);
});

test('fake completion transport verifies endpoint, limits and retains provider usage without inventing measured cost', async () => {
  let body: Record<string, unknown> = {};
  const options = fakeOptions(async (url, init) => {
    assert.equal(url, 'https://api.tokenfactory.nebius.com/v1/chat/completions');
    assert.equal(init?.redirect, 'error');
    body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, 6000);
    assert.ok(!String(init?.body).includes('SYNTHETIC-TEST-TOKEN'));
    return completion();
  });
  const provider = new NebiusRepairProvider(options);
  const proposal = await provider.propose({ ...input(), remaining: { ...input().remaining, maxApprovedSpendUsd: 1 } }, signal());
  assert.equal(proposal.providerRequestId, 'fake-request-001');
  assert.equal(proposal.usage.inputTokens, 100);
  assert.equal(proposal.usage.measuredCostUsd, null);
});

test('fake transport protected edits and provider failures are typed and retain attempted calls', async () => {
  const proposed = { ...input(), remaining: { ...input().remaining, maxApprovedSpendUsd: 1 } };
  await assert.rejects(new NebiusRepairProvider(fakeOptions(async () => completion({ 'evaluator.py': 'x' }))).propose(proposed, signal()),
    (e: unknown) => e instanceof RepairError && e.code === 'protected_path' && e.usage.inferenceCalls === 1);
  await assert.rejects(new NebiusRepairProvider(fakeOptions(async () => new Response('SENSITIVE PROVIDER BODY', { status: 429 }))).propose(proposed, signal()),
    (e: unknown) => e instanceof RepairError && e.code === 'rate_limit' && !e.message.includes('SENSITIVE') && e.usage.inferenceCalls === 1);
});

test('cancelled proposal sends nothing', async () => {
  const controller = new AbortController(); controller.abort();
  let called = false;
  const provider = new NebiusRepairProvider(fakeOptions(async () => { called = true; return completion(); }));
  await assert.rejects(provider.propose(input(), controller.signal), /cancelled/i);
  assert.equal(called, false);
});
