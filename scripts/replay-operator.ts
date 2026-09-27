import { closeSync, constants, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { SmokeOperatorSessions } from '../packages/orchestrator/src/smoke-operator-sessions.ts';
import { createTrustedReplay, ReplayLimitsSchema, TrustedReplayError } from '../packages/orchestrator/src/trusted-replay.ts';
import type { ReplayProgress } from '../packages/orchestrator/src/trusted-replay.ts';
import { SmokeCpuProofSchema } from '../packages/orchestrator/src/trusted-smoke.ts';
import { SandboxVerificationSchema } from '../workers/sandbox/nebius.ts';
import { BudgetSchema } from './config.ts';
import { assertPrivateOperatorPath, operatorJsonDigest, readPrivateOperatorJson } from './operator-files.ts';
import { readPrivateEvidenceBytes, verifyCuratedProductEvidence } from './evidence-operator.ts';

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/), path = z.string().min(1);
export const ReplayOperatorConfigSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), kind: z.literal('patchproof-live-replay'), executionAuthorized: z.literal(true),
  replayId: z.uuid(), runId: z.uuid(), bundleFile: path, bundleDigest: digest,
  fixture: z.strictObject({ taskId: z.string().min(1), fixtureDigest: digest, sourceDigest: digest, policyDigest: digest }),
  sourceDigest: digest, limits: ReplayLimitsSchema, ledgerFile: path, budgetDigest: digest,
  sessionFile: path, reportFile: path, sandboxCredentialFile: path,
  verification: SandboxVerificationSchema, cpuProof: SmokeCpuProofSchema,
  acceptedProofDigests: z.array(digest).min(2).max(20),
});
function fail(code: string): never { throw new TrustedReplayError(`replay_${code}`); }
const safe = (error: unknown) => error instanceof TrustedReplayError ? error.code :
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' &&
  /^(?:operator_|budget_|evidence_)[a-z_]+$/.test(error.code) ? error.code : 'replay_operator_unavailable';
function writePrivate(filename: string, value: unknown, projectRoot: string) {
  assertPrivateOperatorPath(filename, projectRoot, { allowMissing: true });
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const descriptor = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  const parent = openSync(dirname(filename), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(parent); } finally { closeSync(parent); }
  return { path: filename, digest: digestBytes(bytes) };
}

/** Private operator only. No inference or evaluation oracle; testing hooks cannot be loaded from JSON. */
export function createReplayOperator(options: { projectRoot: string;
  testing?: { scope: 'synthetic-test'; sourceDigest: () => string; fetch: typeof globalThis.fetch } }) {
  const projectRoot = resolve(options.projectRoot), testing = options.testing;
  if (testing && testing.scope !== 'synthetic-test') fail('test_scope_invalid');
  const scope = testing ? 'synthetic-test' as const : 'live' as const;
  const currentSource = testing?.sourceDigest ?? (() => digestJson(buildOperationalLock(projectRoot)));
  const load = (filename: string, acceptedDigest: string) => {
    const config = ReplayOperatorConfigSchema.parse(readPrivateOperatorJson(filename, { projectRoot }));
    const configDigest = digestJson(config);
    if (digest.parse(acceptedDigest) !== configDigest) fail('config_digest_mismatch');
    const batchFiles = [1, 2].map(index => config.reportFile + `.batch-${index}.json`);
    const databases = [config.ledgerFile, config.sessionFile];
    const paths = [filename, config.bundleFile, config.sandboxCredentialFile, config.reportFile, ...batchFiles,
      ...databases.flatMap(item => [item, item + '-wal', item + '-shm', item + '-journal'])];
    if (new Set(paths.map(item => resolve(item))).size !== paths.length) fail('path_collision');
    for (const item of paths) assertPrivateOperatorPath(item, projectRoot, { allowMissing: true });
    return { filename, config, configDigest, batchFiles };
  };
  const prepare = async (loaded: ReturnType<typeof load>, saveProgress: (value: ReplayProgress) => void,
    saveBatch: (value: unknown) => void) => {
    const { config, filename, configDigest } = loaded;
    // Existing approved ledger is mandatory. A typo must never initialize another allowance.
    assertPrivateOperatorPath(config.ledgerFile, projectRoot, { database: true });
    assertPrivateOperatorPath(config.sandboxCredentialFile, projectRoot);
    for (const item of [config.reportFile, ...loaded.batchFiles]) {
      if (assertPrivateOperatorPath(item, projectRoot, { allowMissing: true })) fail('output_exists');
    }
    const bytes = readPrivateEvidenceBytes(config.bundleFile, { projectRoot });
    const bundle = await verifyCuratedProductEvidence({ projectRoot, bytes, runId: config.runId,
      bundleDigest: config.bundleDigest, fixture: config.fixture });
    const budget = BudgetSchema.parse(JSON.parse(readFileSync(join(projectRoot, 'budget.json'), 'utf8')));
    if (operatorJsonDigest(budget) !== config.budgetDigest) fail('budget_binding_changed');
    for (const key of ['wallTimeLimitSeconds', 'sandboxCpuSecondsLimit'] as const) {
      if (budget.episodeLimits[key] === null || config.limits[key] > budget.episodeLimits[key]) fail('episode_allowance_exceeded');
    }
    if (config.limits.maxApprovedSpendUsd > budget.stages.smoke) fail('episode_allowance_exceeded');
    const bundleBytesDigest = digestBytes(bytes);
    const validate = () => {
      if (digestJson(ReplayOperatorConfigSchema.parse(readPrivateOperatorJson(filename, { projectRoot }))) !== configDigest) fail('config_changed');
      if (operatorJsonDigest(BudgetSchema.parse(JSON.parse(readFileSync(join(projectRoot, 'budget.json'), 'utf8')))) !== config.budgetDigest) fail('budget_binding_changed');
      if (digestBytes(readPrivateEvidenceBytes(config.bundleFile, { projectRoot })) !== bundleBytesDigest) fail('bundle_changed');
      return currentSource();
    };
    const ledger = new BudgetLedger({ filename: config.ledgerFile, budget, existingOnly: true });
    try {
      const replay = createTrustedReplay({ replayId: config.replayId, bundle, sourceDigest: config.sourceDigest,
        limits: config.limits, ledger, verification: config.verification, cpuProof: config.cpuProof,
        acceptedProofDigests: config.acceptedProofDigests, verifyCurrent: validate, saveProgress, saveRawBatch: saveBatch,
        sandbox: { authorized: true, expectedProjectId: config.verification.projectId, fetch: testing?.fetch ?? globalThis.fetch,
          credential: async () => {
            const credential = z.strictObject({ token: z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/) })
              .parse(readPrivateOperatorJson(config.sandboxCredentialFile, { projectRoot, maximumBytes: 32768 }));
            return { token: credential.token, projectId: config.verification.projectId };
          } } });
      return { replay, ledger };
    } catch (error) { ledger.close(); throw error; }
  };
  function sessionCommand(command: 'status' | 'cancel' | 'recover', filename: string, acceptedDigest: string) {
    const { config, configDigest } = load(filename, acceptedDigest);
    if (!assertPrivateOperatorPath(config.sessionFile, projectRoot, { allowMissing: true, database: true })) {
      if (command !== 'status') fail('session_not_started');
      return { command, status: 'not-started', replayId: config.replayId, commandProviderCalls: 0 };
    }
    const sessions = new SmokeOperatorSessions({ filename: config.sessionFile });
    try {
      const existing = sessions.status(config.replayId);
      if (existing && (existing.configDigest !== configDigest || existing.scope !== scope)) fail('session_binding_mismatch');
      const session = command === 'cancel' ? sessions.requestCancel(config.replayId) :
        command === 'recover' ? sessions.markInterrupted(config.replayId) : existing;
      return { command, session, commandProviderCalls: 0,
        note: 'Session metadata only. No execution resume, remote cleanup or billing reconciliation is implied.' };
    } finally { sessions.close(); }
  }
  return {
    async preflight(filename: string, acceptedDigest: string) {
      const loaded = load(filename, acceptedDigest), prepared = await prepare(loaded, () => {}, () => {});
      try { return { command: 'preflight', scope, status: 'ready-for-explicit-start', replayId: loaded.config.replayId,
        runId: loaded.config.runId, configDigest: loaded.configDigest, envelope: prepared.replay.envelope,
        credentialsRead: 0, providerCalls: 0, reservationCreated: false, competitionReady: false }; }
      finally { prepared.ledger.close(); }
    },
    status: (filename: string, acceptedDigest: string) => sessionCommand('status', filename, acceptedDigest),
    cancel: (filename: string, acceptedDigest: string) => sessionCommand('cancel', filename, acceptedDigest),
    recover: (filename: string, acceptedDigest: string) => sessionCommand('recover', filename, acceptedDigest),
    async start(filename: string, acceptedDigest: string, signal: AbortSignal) {
      const loaded = load(filename, acceptedDigest), { config, configDigest } = loaded;
      signal.throwIfAborted();
      const sessions = new SmokeOperatorSessions({ filename: config.sessionFile });
      let prepared: Awaited<ReturnType<typeof prepare>> | null = null, timer: ReturnType<typeof setInterval> | undefined;
      const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
      const batches: Array<{ path: string; digest: string }> = [];
      let claim: ReturnType<SmokeOperatorSessions['claimStart']>;
      try { claim = sessions.claimStart({ episodeId: config.replayId, configDigest, scope }); }
      catch (error) { sessions.close(); throw error; }
      try {
        if (!claim.granted) return { command: 'start', scope: claim.session.scope, reused: true, session: claim.session, commandProviderCalls: 0 };
        prepared = await prepare(loaded, progress => sessions.update(claim.token!, { ...progress, batches }), value => {
          const target = loaded.batchFiles[batches.length];
          if (!target) fail('batch_file_limit');
          batches.push(writePrivate(target, { scope, replayId: config.replayId, rawBatch: value }, projectRoot));
        });
        if (sessions.status(config.replayId)?.cancelRequested) controller.abort();
        combined.throwIfAborted();
        timer = setInterval(() => {
          try { if (sessions.status(config.replayId)?.cancelRequested) controller.abort(); }
          catch { controller.abort(); }
        }, 100);
        let result: unknown = null, errorCode: string | null = null;
        try { result = await prepared.replay.start(combined); }
        catch (error) { errorCode = combined.aborted ? 'replay_cancelled' : safe(error); controller.abort(); }
        await prepared.replay.settled();
        clearInterval(timer); timer = undefined;
        const progress = prepared.replay.snapshot(), reservation = prepared.ledger.get(prepared.replay.reservationId);
        const report = writePrivate(config.reportFile, { schemaVersion: '1.0', kind: 'patchproof-live-replay-report',
          scope, competitionReady: false, authenticityEstablished: false, configDigest, sourceDigest: config.sourceDigest,
          replayId: config.replayId, originalRunId: config.runId, bundleDigest: config.bundleDigest,
          verificationDigest: digestJson(config.verification), cpuProofDigest: digestJson(config.cpuProof),
          envelope: prepared.replay.envelope, progress, result, errorCode, batches, reservation }, projectRoot);
        const resultStatus = result && typeof result === 'object' && 'status' in result ? String(result.status) : null;
        return { command: 'start', scope, reused: false, status: errorCode ? 'blocked' : resultStatus, session: sessions.finish(claim.token!,
          { ...progress, status: errorCode ? 'blocked' : resultStatus, errorCode, report, batches, billing: 'unreconciled', competitionReady: false }) };
      } catch (error) {
        controller.abort(); await prepared?.replay.settled();
        if (claim.granted) sessions.finish(claim.token!, { ...prepared?.replay.snapshot(), status: 'blocked',
          reason: safe(error), batches, billing: 'unreconciled', competitionReady: false });
        throw error;
      } finally { if (timer) clearInterval(timer); prepared?.ledger.close(); sessions.close(); }
    },
  };
}

export async function replayOperatorMain(args: string[]) {
  const [command, filename, acceptedDigest, expectedRun, ...extra] = args;
  if (!filename || !acceptedDigest || extra.length || !['preflight', 'start', 'status', 'cancel', 'recover'].includes(command ?? '')) fail('usage');
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  if (expectedRun && ReplayOperatorConfigSchema.parse(readPrivateOperatorJson(filename, { projectRoot })).runId !== expectedRun) fail('run_binding_mismatch');
  const operator = createReplayOperator({ projectRoot });
  const controller = new AbortController(), abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    return command === 'preflight' ? await operator.preflight(filename, acceptedDigest) :
      command === 'start' ? await operator.start(filename, acceptedDigest, controller.signal) :
      command === 'status' ? operator.status(filename, acceptedDigest) :
      command === 'cancel' ? operator.cancel(filename, acceptedDigest) : operator.recover(filename, acceptedDigest);
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await replayOperatorMain(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if ('status' in result && ['blocked', 'mismatch_or_infrastructure_error'].includes(String(result.status))) process.exitCode = 2;
  }
  catch (error) { console.log(JSON.stringify({ command: 'replay-operator', status: 'blocked', error: { code: safe(error) } })); process.exitCode = 2; }
}
