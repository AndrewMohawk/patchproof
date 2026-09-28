// Bounded operator control, not a repair, model-selection probe or benchmark.
// Run only against the explicitly supplied private directory and existing project ledger.
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BudgetLedger } from '../../../packages/orchestrator/src/budget-ledger.ts';
import { assertPrivateOperatorPath, readPrivateOperatorJson } from '../../../scripts/operator-files.ts';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const hash = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const modelId = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B';
const reservationId = 'token-factory-access-20260927-01';
const endpoint = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const request = {
  model: modelId,
  messages: [{ role: 'user', content: 'Return exactly PATCHPROOF_OK.' }],
  max_tokens: 32, max_completion_tokens: 32, n: 1, stream: false, store: false,
  chat_template_kwargs: { enable_thinking: false },
};
const rates = { inputUsdPerMillionTokens: 0.06, outputUsdPerMillionTokens: 0.24 };
const contextLimit = 262144;
const plan = {
  kind: 'model_access_validation_only', endpoint, request, rates,
  inputTokenCeilingForReservation: contextLimit,
  outputTokenCeilingForReservation: contextLimit,
  conservativeCostCeilingUsd: contextLimit * (0.06 + 0.24) / 1_000_000,
  reservationUsd: 0.10, stage: 'smoke', retries: 0,
  actualBillingPolicy: 'Unknown until authoritative reconciliation; retain full reservation.',
};

function safeUsage(value) {
  if (!value || !['prompt_tokens', 'completion_tokens', 'total_tokens'].every(key =>
    Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
  return { prompt_tokens: value.prompt_tokens, completion_tokens: value.completion_tokens, total_tokens: value.total_tokens };
}
function safeId(value, token) {
  return typeof value === 'string' && !value.includes(token) && /^[A-Za-z0-9_.:/-]{1,200}$/.test(value) ? value : null;
}
function createDurableJson(path, value) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

async function main() {
  const [mode, directory] = process.argv.slice(2);
  if (!['--preflight', '--execute'].includes(mode) || !directory || resolve(directory) !== directory || process.argv.length !== 4) {
    throw Error('usage: node model-access-check.mjs --preflight|--execute /ABSOLUTE/PRIVATE/DIRECTORY');
  }
  const paths = Object.fromEntries(['token-factory.json', 'models-discovery.json', 'project-budget.sqlite',
    'model-access-intent.json', 'model-access-result.json'].map(name => [name, join(directory, name)]));
  for (const [name, path] of Object.entries(paths)) {
    assertPrivateOperatorPath(path, root, { allowMissing: name.includes('intent') || name.includes('result'), database: name.endsWith('.sqlite') });
  }
  const catalog = readPrivateOperatorJson(paths['models-discovery.json'], { projectRoot: root });
  const age = Date.now() - Date.parse(catalog.finishedAt);
  if (catalog.httpStatus !== 200 || !Number.isFinite(age) || age < 0 || age > 86400000 ||
      catalog.responseByteDigest !== 'sha256:b1ac7092a111be6648ca0b4842c78dfc84344ba8a2ccea72941cad2036b90ab8' ||
      digest(catalog.body) !== 'sha256:c16895379285d668083f2374979e6e121908ccd8395a2ee869b66b77f257afaa') {
    throw Error('catalog_not_current_or_integrity_failure');
  }
  const rows = catalog.body.data.filter(row => row.id === modelId);
  if (rows.length !== 1 || rows[0].context_length !== contextLimit ||
      rows[0].pricing.prompt !== '0.00000006' || rows[0].pricing.completion !== '0.00000024' ||
      Number(rows[0].pricing.request) !== 0) throw Error('catalog_model_or_rates_changed');
  const credential = readPrivateOperatorJson(paths['token-factory.json'], { projectRoot: root, maximumBytes: 16384 });
  if (Object.keys(credential).join() !== 'token' || typeof credential.token !== 'string' ||
      !credential.token || /[\r\n]/.test(credential.token)) throw Error('credential_schema');
  const ledger = new BudgetLedger({ filename: paths['project-budget.sqlite'],
    budget: JSON.parse(readFileSync(join(root, 'budget.json'), 'utf8')), existingOnly: true });
  try {
    if (mode === '--preflight') {
      console.log(JSON.stringify({ readyForSingleAccessCheck: true, plan, ledger: ledger.snapshot(), networkCalls: 0 }));
      return;
    }
    const intent = { schemaVersion: '1.0', reservationId, plan, preparedAt: new Date().toISOString(),
      scriptDigest: hash(readFileSync(fileURLToPath(import.meta.url))),
      catalogResponseDigest: catalog.responseByteDigest, budgetApprovalDigest: ledger.snapshot().approvalDigest };
    // Exclusive intent creation and ledger dispatch prevent a second request on rerun.
    createDurableJson(paths['model-access-intent.json'], intent);
    ledger.reserve({ id: reservationId, episodeId: reservationId, stage: 'smoke', amountMicros: 100000n, fingerprint: digest(intent) });
    if (!ledger.markAttempted(reservationId).dispatchGranted) throw Error('already_attempted');
    const result = { schemaVersion: '1.0', kind: plan.kind, reservationId, intentDigest: digest(intent),
      startedAt: new Date().toISOString(), inferenceCallsAttempted: 1, sandboxExecutions: 0,
      actualCostUsd: null, billingReconciled: false, reservationHeldUsd: 0.10 };
    try {
      const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { Authorization: 'Bearer ' + credential.token, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      result.httpStatus = response.status;
      result.providerRequestId = safeId(response.headers.get('x-request-id'), credential.token);
      const reader = response.body?.getReader();
      if (!reader) throw Error('missing_response_body');
      const chunks = []; let bytes = 0;
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.length;
        if (bytes > 262144) { await reader.cancel(); throw Error('response_too_large'); }
        chunks.push(Buffer.from(next.value));
      }
      const body = Buffer.concat(chunks).toString('utf8');
      if (body.includes(credential.token)) throw Error('secret_echo_refused');
      result.responseByteDigest = hash(body); result.responseBytes = bytes;
      const parsed = JSON.parse(body);
      result.completionId = safeId(parsed.id, credential.token); result.usage = safeUsage(parsed.usage);
      result.exactModelReturned = parsed.model === modelId;
      result.finishReason = ['stop', 'length', 'content_filter', 'tool_calls'].includes(parsed.choices?.[0]?.finish_reason) ? parsed.choices[0].finish_reason : null;
      result.markerMatched = parsed.choices?.[0]?.message?.content?.trim() === 'PATCHPROOF_OK';
      result.reasoningReturned = Boolean(parsed.choices?.[0]?.message?.reasoning_content || parsed.choices?.[0]?.message?.reasoning);
      // Retain only observable control output; no reasoning text or provider error body in evidence.
      if (result.usage) {
        result.usagePricedEstimateUsd = (result.usage.prompt_tokens * 0.06 + result.usage.completion_tokens * 0.24) / 1_000_000;
        result.usageWithinReservationBounds = result.usage.prompt_tokens <= contextLimit && result.usage.completion_tokens <= contextLimit;
        result.requestedOutputCapObserved = result.usage.completion_tokens <= request.max_tokens;
      }
      result.accessCheckPassed = response.ok && result.exactModelReturned && result.markerMatched &&
        result.finishReason === 'stop' && result.usageWithinReservationBounds === true && result.requestedOutputCapObserved === true;
    } catch (error) {
      result.accessCheckPassed = false;
      result.failure = error?.name === 'TimeoutError' ? 'request_timeout' : 'transport_or_response_validation_failed';
    }
    result.finishedAt = new Date().toISOString();
    createDurableJson(paths['model-access-result.json'], result);
    ledger.reconcile({ id: reservationId, actualCostMicros: null, complete: false, evidenceDigest: digest(result) });
    console.log(JSON.stringify({ result, ledger: ledger.snapshot() }));
    if (!result.accessCheckPassed) process.exitCode = 2;
  } finally { ledger.close(); }
}
main().catch(() => { console.error('Account check stopped; inspect private intent/ledger. No automatic retry.'); process.exitCode = 2; });
