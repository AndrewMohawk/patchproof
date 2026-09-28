// Read-only public metadata observer. Never creates/cancels/replays a run.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyEvidence } from '../../../../packages/orchestrator/src/evidence.ts';
import { digestBytes, digestJson } from '../../../../packages/contracts/src/digest.ts';

const [runId, releaseCommit, sourceDigest] = process.argv.slice(2);
if (!/^[a-f0-9-]{36}$/.test(runId ?? '') || !/^[a-f0-9]{40}$/.test(releaseCommit ?? '') ||
    !/^sha256:[a-f0-9]{64}$/.test(sourceDigest ?? '')) throw new Error('Exact run ID, release commit, runtime source digest required.');
const directory = new URL(`./${runId}-${Date.now()}/`, import.meta.url);
await mkdir(directory, { recursive: false });
const report = { recordedAt: new Date().toISOString(), runId, releaseCommit, expectedRuntimeSourceDigest: sourceDigest,
  observer: 'AI metadata review; GET-only; no provider, candidate, replay, credentials or private billing access',
  captures: [], assertions: {}, limitations: ['Hash consistency is not independent provider authentication.',
    'Recorded request IDs, token usage and cleanup are not independently authenticated external billing or lifecycle events.',
    'Same-host artifact inspection is not independent-host reproduction, human review or benchmark evidence.'] };
const save = async (name, data) => writeFile(new URL(name, directory), data, { flag: 'wx' });
const get = async (name, path) => {
  const response = await fetch('https://patchproof.andrewmohawk.xyz' + path, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) });
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > 5_000_000) throw new Error('Response size limit.'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks); await save(name, bytes);
  report.captures.push({ name, path, status: response.status, bytes: length, digest: digestBytes(bytes), contentType: response.headers.get('content-type') });
  if (response.status !== 200) throw new Error(`GET ${path} returned ${response.status}; original body retained.`);
  return JSON.parse(bytes.toString('utf8'));
};
const check = (name, value) => { report.assertions[name] = Boolean(value); };
const counts = rows => rows.reduce((out, row) => { out[row.status] = (out[row.status] ?? 0) + 1; return out; }, {});
try {
  const run = await get('run.json', `/runs/${runId}`);
  if (run.phase !== 'terminal') throw new Error('Run is not terminal; captured progress only.');
  const bundle = verifyEvidence(await get('evidence.json', `/runs/${runId}/evidence`));
  const lock = bundle.runtimeLock;
  check('evidenceVerifierPassed', true);
  check('runExactlyMatchesEvidence', digestJson(run) === digestJson(bundle.run));
  check('liveUnscoredLocalDockerScope', bundle.mode === 'live' && bundle.competitionReady === false &&
    lock.execution.checkBackend === 'local_container' && lock.scope === 'public-curated-development-demo' && lock.sponsorSandboxesVerified === false);
  check('sourceDigestMatchesCompleteLock', lock.sourceDigest === sourceDigest && digestJson(lock.operationalLock) === sourceDigest);
  const pins = Object.entries(lock.operationalLock.sources);
  const mismatches = [];
  for (const [path, digest] of pins) {
    if (!/^[a-zA-Z0-9_.\/-]+$/.test(path) || path.split('/').includes('..') || path.startsWith('/')) throw new Error('Invalid source pin path.');
    const bytes = execFileSync('git', ['show', `${releaseCommit}:${path}`], { maxBuffer: 5_000_000 });
    if (digestBytes(bytes) !== digest) mismatches.push(path);
  }
  check('allSourcePinsMatchExactRelease', mismatches.length === 0);
  const ids = run.candidates.map(c => c.providerRequestId);
  check('distinctProviderResponseIds', ids.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) && new Set(ids).size === ids.length);
  check('modelIdsMatchRuntime', run.candidates.every(c => c.modelId === lock.model.id) && lock.model.id === lock.execution.modelId);
  const sum = run.candidates.reduce((out, c) => ({ calls: out.calls + c.usage.inferenceCalls, input: out.input + c.usage.inputTokens, output: out.output + c.usage.outputTokens }), { calls: 0, input: 0, output: 0 });
  check('candidateUsageSumsMatchAggregate', sum.calls === run.usage.inferenceCalls && sum.input === run.usage.inputTokens && sum.output === run.usage.outputTokens);
  const estimate = (sum.input * lock.pricing.inputUsdPerMillionTokens + sum.output * lock.pricing.outputUsdPerMillionTokens) / 1_000_000 + sum.calls * lock.pricing.requestFeeUsd;
  check('usagePricedEstimateHonest', run.usage.costIsEstimate === true && Math.abs(run.usage.measuredCostUsd - estimate) < 1e-12 && run.candidates.every(c => c.usage.measuredCostUsd === null));
  check('sameBoundedAllowance', digestJson(run.limits) === digestJson(lock.limits) && run.limits.inferenceCallLimit === 3 && run.limits.outputTokenLimit === 6000 && run.limits.wallTimeLimitSeconds === 300 && run.limits.maxApprovedSpendUsd === 0.1);
  const revisions = [{ id: 'original', rows: [...run.baselineChecks.visible, ...run.baselineChecks.acceptance] }, ...run.candidates.map(c => ({ id: c.id, rows: [...c.visibleChecks, ...c.acceptanceChecks] }))];
  const observations = [], lifecycles = [];
  for (const revision of revisions) for (const row of revision.rows) {
    const repeated = JSON.parse(row.log);
    if (repeated.protocol !== lock.checkProtocol.id || !Array.isArray(repeated.observations)) throw new Error('Repeated observation protocol missing.');
    for (const observation of repeated.observations) {
      observations.push(observation);
      const detail = JSON.parse(observation.log);
      if (detail.dockerLifecycle) lifecycles.push(detail.dockerLifecycle);
    }
  }
  const declared = bundle.fixture.visibleCases.length + bundle.fixture.acceptanceCases.length;
  const lifecycleIds = lifecycles.map(l => l.operationId);
  check('completeRepeatedObservations', observations.length === declared * revisions.length * lock.checkProtocol.repetitions);
  check('lifecycleInventoryExactAndUnique', new Set(lifecycleIds).size === lifecycleIds.length && digestJson([...lifecycleIds].sort()) === digestJson([...run.sandboxOperationIds].sort()));
  check('allRecordedCleanupConfirmed', lifecycles.length === observations.length && lifecycles.every(l => l.createAcknowledged && l.cleanupConfirmed));
  const selected = run.candidates.find(c => c.id === run.selectedCandidateId);
  check('verifiedStatusSupported', run.terminalStatus !== 'verified_for_declared_checks' || (selected?.accepted && run.coverage.every(c => c.status === 'pass')));
  report.summary = { bundleDigest: bundle.bundleDigest, sourcePins: pins.length, mismatches, taskId: run.taskId, variant: run.variant,
    terminalStatus: run.terminalStatus, reason: run.reason, selectedCandidateId: run.selectedCandidateId, candidateCount: run.candidates.length,
    providerResponseIds: ids, usage: run.usage, calculatedEstimateUsd: estimate, authoritativeBilledCostUsd: null,
    declaredChecksPerRevision: declared, repeatedObservations: observations.length, observedStatuses: counts(observations),
    revisions: revisions.map(r => ({ id: r.id, statusCounts: counts(r.rows),
      visibleStatusCounts: counts(r.rows.filter(row => bundle.fixture.visibleCases.some(c => c.id === row.id))),
      acceptanceStatusCounts: counts(r.rows.filter(row => bundle.fixture.acceptanceCases.some(c => c.id === row.id))),
      failedOrUnavailableChecks: r.rows.filter(row => row.status !== 'pass').map(row => ({ id: row.id, status: row.status,
        message: row.message, actual: row.actual, expected: row.expected })) })), lifecycles: lifecycles.length,
    coverage: run.coverage, timingPolicy: lock.liveLocalCheckTimingPolicy, checkProtocol: lock.checkProtocol };
  report.status = Object.values(report.assertions).every(Boolean) ? 'consistent_recorded_evidence' : 'mismatch_requires_review';
  process.exitCode = report.status === 'consistent_recorded_evidence' ? 0 : 1;
} catch (error) { report.status = 'incomplete_or_invalid'; report.error = String(error); process.exitCode = 1; }
report.collectorDigest = digestBytes(await readFile(fileURLToPath(import.meta.url)));
await save('audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ directory: fileURLToPath(directory), status: report.status, error: report.error, assertions: report.assertions }));
