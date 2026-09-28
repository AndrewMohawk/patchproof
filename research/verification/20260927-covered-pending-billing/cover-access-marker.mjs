// One-time coordinator accounting action. No credential, provider, candidate or billing API.
import assert from 'node:assert/strict';
import { constants, openSync, closeSync, fsyncSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BudgetLedger, PendingInferenceCoverageSchema } from '../../../packages/orchestrator/src/budget-ledger.ts';
import { digestBytes, digestJson } from '../../../packages/contracts/src/digest.ts';
import { assertPrivateOperatorPath, readPrivateOperatorJson } from '../../../scripts/operator-files.ts';

const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = dirname(fileURLToPath(import.meta.url));
const privateRoot = '/home/andrewmohawk/.config/patchproof/operator-20260927';
const ledgerPath = join(privateRoot, 'project-budget.sqlite');
const reservationId = 'token-factory-access-20260927-01';
const legacyDigest = value => digestBytes(JSON.stringify(value));
const pins = {
  'model-access-intent.json': 'sha256:4719689a6fd3e252974f6f0b0154daa9b29466b2566c87e914cb48bba294b815',
  'model-access-result.json': 'sha256:dfdb3998a33d7d0bde1afbb9d8122e1fc469754ddb46dec3309adbb26b4b1043',
  'models-discovery.json': 'sha256:4366eb181afe70885417fe628f3e5e843cba8fceb5bd247afe03f79042335de1',
  'ledger-designation.json': 'sha256:fc0c110f145d48301bd9cc9bdd211d7ef2cdb8328f73b8dffd901a0aac24f522',
};
const scriptDigest = 'sha256:b8843112a807eb134dd7a5c708c90c261e8a61e5631c670662ad3d271bb811e5';
const ledgerSourceDigest = 'sha256:ea7df88dc7e39152ab606ed5b523a52c32439a9674e089899db25bc30dd5eb91';
const readPublic = name => JSON.parse(readFileSync(join(projectRoot, name), 'utf8'));
const encode = value => JSON.stringify(value, null, 2) + '\n';
function createDurable(name, value, acceptIdentical = false) {
  const filename = join(output, name), bytes = encode(value);
  if (acceptIdentical && existsSync(filename)) { assert.equal(readFileSync(filename, 'utf8'), bytes); return; }
  const fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(output, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
let attemptedCoverage = false;
async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  assert.ok(['--preflight', '--execute'].includes(mode) && extra.length === 0);
  assert.equal(digestBytes(readFileSync(join(projectRoot, 'packages/orchestrator/src/budget-ledger.ts'))), ledgerSourceDigest);
  assert.equal(digestBytes(readFileSync(join(projectRoot, 'research/verification/20260927-account-access/model-access-check.mjs'))), scriptDigest);
  const inputs = {};
  for (const [name, pin] of Object.entries(pins)) {
    const filename = join(privateRoot, name);
    assertPrivateOperatorPath(filename, projectRoot);
    const parsed = readPrivateOperatorJson(filename, { projectRoot });
    assert.equal(digestBytes(readFileSync(filename)), pin);
    inputs[name] = parsed;
  }
  assertPrivateOperatorPath(ledgerPath, projectRoot, { database: true });
  const intent = inputs['model-access-intent.json'], result = inputs['model-access-result.json'];
  const catalog = inputs['models-discovery.json'], designation = inputs['ledger-designation.json'];
  const publicResult = readPublic('research/verification/20260927-account-access/access-check-execution.json');
  const official = readPublic('research/verification/20260927-account-access/official-sources.json');
  assert.deepEqual(result, publicResult.result);
  const request = { model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', messages: [{ role: 'user', content: 'Return exactly PATCHPROOF_OK.' }],
    max_tokens: 32, max_completion_tokens: 32, n: 1, stream: false, store: false, chat_template_kwargs: { enable_thinking: false } };
  assert.deepEqual(intent.plan, { kind: 'model_access_validation_only', endpoint: 'https://api.tokenfactory.nebius.com/v1/chat/completions', request,
    rates: { inputUsdPerMillionTokens: 0.06, outputUsdPerMillionTokens: 0.24 }, inputTokenCeilingForReservation: 262144,
    outputTokenCeilingForReservation: 262144, conservativeCostCeilingUsd: 0.0786432, reservationUsd: 0.1, stage: 'smoke', retries: 0,
    actualBillingPolicy: 'Unknown until authoritative reconciliation; retain full reservation.' });
  assert.equal(intent.scriptDigest, scriptDigest); assert.equal(intent.reservationId, reservationId);
  assert.equal(result.intentDigest, legacyDigest(intent)); assert.equal(result.reservationId, reservationId);
  assert.equal(catalog.httpStatus, 200); assert.equal(catalog.paidInferenceCalls, 0); assert.equal(catalog.sandboxExecutions, 0);
  assert.equal(catalog.responseByteDigest, 'sha256:b1ac7092a111be6648ca0b4842c78dfc84344ba8a2ccea72941cad2036b90ab8');
  assert.equal(legacyDigest(catalog.body), 'sha256:c16895379285d668083f2374979e6e121908ccd8395a2ee869b66b77f257afaa');
  assert.equal(intent.catalogResponseDigest, catalog.responseByteDigest);
  const [model, ...duplicates] = catalog.body.data.filter(row => row.id === request.model);
  assert.ok(model && duplicates.length === 0); assert.equal(model.context_length, 262144);
  assert.deepEqual(model.pricing, { prompt: '0.00000006', completion: '0.00000024', image: '0', price_per_video_second: '0', request: '0', price_per_minute: '0' });
  assert.deepEqual(official.verifiedRatesUsdPerMillion.nano, { input: 0.06, output: 0.24 });
  assert.ok(Date.parse(catalog.finishedAt) <= Date.parse(intent.preparedAt));
  assert.ok(Date.parse(intent.preparedAt) <= Date.parse(result.startedAt) && Date.parse(result.startedAt) <= Date.parse(result.finishedAt) && Date.parse(result.finishedAt) <= Date.now());
  for (const key of ['accessCheckPassed', 'exactModelReturned', 'markerMatched', 'usageWithinReservationBounds', 'requestedOutputCapObserved']) assert.equal(result[key], true);
  assert.equal(result.httpStatus, 200); assert.equal(result.finishReason, 'stop'); assert.equal(result.reasoningReturned, false);
  assert.equal(result.inferenceCallsAttempted, 1); assert.equal(result.sandboxExecutions, 0); assert.ok(!Object.hasOwn(result, 'failure'));
  assert.equal(result.actualCostUsd, null); assert.equal(result.billingReconciled, false); assert.equal(result.reservationHeldUsd, 0.1);
  assert.deepEqual(result.usage, { prompt_tokens: 24, completion_tokens: 6, total_tokens: 30 });
  assert.equal(result.usagePricedEstimateUsd, 0.00000288);
  assert.match(result.responseByteDigest, /^sha256:[a-f0-9]{64}$/); assert.equal(result.responseBytes, 734);
  assert.ok(typeof result.providerRequestId === 'string' && result.providerRequestId.length > 0);
  assert.ok(typeof result.completionId === 'string' && result.completionId.length > 0);
  assert.equal(designation.role, 'sole_authoritative_ledger_for_real_patchproof_provider_spending'); assert.equal(designation.filename, ledgerPath);
  const budget = readPublic('budget.json'); assert.equal(legacyDigest(budget), intent.budgetApprovalDigest);
  assert.equal(designation.budgetApprovalDigest, intent.budgetApprovalDigest);
  const open = policy => new BudgetLedger({ filename: ledgerPath, budget, existingOnly: true, pendingBillingPolicy: policy });
  const ledger = open('allow-covered-inference');
  try {
    const before = ledger.snapshot(), reservation = ledger.get(reservationId), events = ledger.events();
    assert.equal(before.approvalDigest, intent.budgetApprovalDigest); assert.equal(before.reservationCount, 1);
    assert.equal(before.approvedMicros, '25000000'); assert.equal(before.stages.smoke.approvedMicros, '5000000'); assert.equal(before.stages.pilot.approvedMicros, '20000000');
    assert.equal(before.heldMicros, '100000'); assert.equal(before.chargedMicros, '0'); assert.equal(before.committedMicros, '100000');
    assert.equal(before.pendingBillingCount, 1); assert.equal(before.coveredPendingBillingCount, 0); assert.deepEqual(before.freezeReasons, ['billing_pending']);
    assert.equal(reservation.episodeId, reservationId); assert.equal(reservation.fingerprint, legacyDigest(intent)); assert.equal(reservation.stage, 'smoke');
    assert.equal(reservation.evidenceDigest, legacyDigest(result)); assert.equal(reservation.actualCostMicros, null); assert.equal(reservation.reconciliationComplete, false);
    assert.equal(reservation.reservedMicros, '100000'); assert.equal(reservation.heldMicros, '100000'); assert.equal(reservation.state, 'attempted');
    assert.ok(Date.parse(reservation.attemptedAt) <= Date.parse(result.startedAt));
    assert.deepEqual(events.map(event => event.kind), ['approval_initialized', 'reserved', 'dispatch_attempted', 'billing_incomplete']);
    assert.equal(events[3].details.evidenceDigest, legacyDigest(result)); assert.equal(events[3].details.actualCostMicros, null);
    const pricingEvidence = { catalogReceiptByteDigest: pins['models-discovery.json'], catalogResponseByteDigest: catalog.responseByteDigest,
      parsedCatalogBodyDigest: legacyDigest(catalog.body), modelId: model.id, contextLimit: model.context_length, observedCatalogPricing: model.pricing,
      officialSourceReceiptByteDigest: digestBytes(readFileSync(join(projectRoot, 'research/verification/20260927-account-access/official-sources.json'))),
      inputUsdPerMillionTokens: 0.06, outputUsdPerMillionTokens: 0.24, units: 'Catalog per-token units match retained official per-million rates; not an invoice.' };
    const closureEvidence = { kind: 'reviewed-closed-access-marker-response', intentByteDigest: pins['model-access-intent.json'],
      resultByteDigest: pins['model-access-result.json'], executedScriptDigest: scriptDigest,
      publicResultByteDigest: digestBytes(readFileSync(join(projectRoot, 'research/verification/20260927-account-access/access-check-execution.json'))),
      request, responseByteDigest: result.responseByteDigest, usage: result.usage, startedAt: result.startedAt, finishedAt: result.finishedAt,
      httpStatus: result.httpStatus, finishReason: result.finishReason, inferenceRequests: 1, retries: 0, otherBillableOperations: 0,
      providerRequestId: result.providerRequestId, completionId: result.completionId,
      evidenceBoundary: 'The reviewed script completed the bounded HTTP body read and recorded success. Raw provider response was not retained; this proof uses the exact unchanged trusted operator receipt, not independent provider authentication.' };
    const proof = PendingInferenceCoverageSchema.parse({ schemaVersion: '1.0', kind: 'closed-token-factory-inference-v1',
      reservationId, episodeId: reservationId, reservationFingerprint: reservation.fingerprint, stage: 'smoke', reservedMicros: '100000',
      evidenceDigest: reservation.evidenceDigest, sourceDigest: scriptDigest, pricingEvidenceDigest: digestJson(pricingEvidence),
      closureEvidenceDigest: digestJson(closureEvidence), closedAt: result.finishedAt, endpoint: intent.plan.endpoint, modelId: request.model,
      inputMicrosPerMillionTokens: '60000', outputMicrosPerMillionTokens: '240000', requestFeeMicros: '0',
      dispatchClosed: true, inventoryComplete: true, otherBillableOperations: 0,
      requests: [{ intentId: reservationId + ':request-1', requestDigest: digestJson(request), responseDigest: result.responseByteDigest,
        usageDigest: digestJson(result.usage), inputTokenCeiling: 262144, outputTokenCeiling: 262144, observedInputTokens: 24, observedOutputTokens: 6 }] });
    const evidence = { schemaVersion: '1.0', kind: 'access-marker-coverage-evidence', inputByteDigests: pins, pricingEvidence, closureEvidence,
      actualCostUsd: null, authoritativeBillingReconciled: false, heldMicros: '100000', secretsRead: false, providerCalls: 0 };
    createDurable('access-marker-coverage-evidence.json', evidence, true);
    createDurable('access-marker-coverage-proof.json', proof, true);
    const preparation = { schemaVersion: '1.0', status: 'passed', scope: 'Existing access marker only; conservative held exposure, not bill reconciliation',
      scriptDigest: digestBytes(readFileSync(fileURLToPath(import.meta.url))), ledgerSourceDigest, proofDigest: legacyDigest(proof),
      proofByteDigest: digestBytes(encode(proof)), before, reservation, inputByteDigests: pins,
      maximumCostMicros: '78644', heldMicros: '100000', actualCostMicros: null, providerCalls: 0, newReservations: 0, secretsRead: false };
    if (mode === '--preflight') { createDurable('access-marker-coverage-preflight.json', preparation); console.log(JSON.stringify(preparation)); return; }
    const prior = JSON.parse(readFileSync(join(output, 'access-marker-coverage-preflight.json'), 'utf8'));
    assert.deepEqual(prior, preparation);
    createDurable('access-marker-coverage-execution-intent.json', { ...preparation, startedAt: new Date().toISOString(), automaticRetry: false });
    attemptedCoverage = true;
    const covered = ledger.coverPendingInference(proof);
    assert.equal(covered.created, true); assert.equal(covered.maximumCostMicros, '78644'); assert.equal(covered.proofDigest, legacyDigest(proof));
    assert.deepEqual(ledger.get(reservationId), reservation);
    const after = ledger.snapshot(), afterEvents = ledger.events();
    assert.equal(afterEvents.length, events.length + 1); assert.deepEqual(afterEvents.slice(0, events.length), events);
    assert.equal(afterEvents.at(-1).kind, 'closed_inference_exposure_covered'); assert.deepEqual(afterEvents.at(-1).details.proof, proof);
    assert.equal(after.frozen, false); assert.equal(after.pendingBillingCount, 1); assert.equal(after.coveredPendingBillingCount, 1); assert.equal(after.blockingPendingBillingCount, 0);
    assert.equal(after.heldMicros, '100000'); assert.equal(after.chargedMicros, '0'); assert.equal(after.committedMicros, '100000'); assert.equal(after.availableMicros, '24900000');
    assert.deepEqual(after.stages, before.stages);
    const strict = open('block-all'), reopened = open('allow-covered-inference');
    let strictSnapshot, reopenedSnapshot;
    try {
      strictSnapshot = strict.snapshot(); reopenedSnapshot = reopened.snapshot();
      assert.deepEqual(strictSnapshot.freezeReasons, ['billing_pending']); assert.equal(strictSnapshot.blockingPendingBillingCount, 1);
      assert.equal(strictSnapshot.frozen, true); assert.deepEqual(reopenedSnapshot, after);
    } finally { strict.close(); reopened.close(); }
    const receipt = { ...preparation, kind: 'access-marker-covered-pending-execution', exitCode: 0, finishedAt: new Date().toISOString(),
      ledgerMutation: 'One immutable closed_inference_exposure_covered event; reservation and approval unchanged.',
      coverage: covered, before, afterOptedIn: after, afterDefault: strictSnapshot, afterReopenOptedIn: reopenedSnapshot,
      coverageEventSequence: afterEvents.at(-1).sequence, actualCostMicros: null, fullReservationRetained: true,
      paidCalls: 0, newDispatches: 0, newReservations: 0, billingReconciliations: 0,
      limitations: ['Trusted operator response/closure observation, not independent provider authentication.', 'Usage-priced estimate is not billed cost.', 'Covered pending exposure is visible only to explicitly opted-in connections; defaults remain blocked.'] };
    createDurable('access-marker-coverage-execution.json', receipt);
    console.log(JSON.stringify(receipt));
  } finally { ledger.close(); }
}
main().catch(() => { console.error(JSON.stringify({ status: 'failed', code: 'marker_coverage_validation_failed', attemptedCoverage, automaticRetry: false, paidCalls: 0 })); process.exitCode = 2; });
