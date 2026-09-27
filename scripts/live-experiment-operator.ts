import { DatabaseSync } from 'node:sqlite';
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { DigestSchema, TaskIdSchema } from '../packages/contracts/src/index.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { ExperimentTraceStore } from '../packages/orchestrator/src/experiment-trace-store.ts';
import { PhaseAccountingStore, createPhaseAccountingObserver } from '../packages/orchestrator/src/phase-accounting.ts';
import { createLiveExperimentExecutor } from '../packages/orchestrator/src/live-experiment.ts';
import { buildLiveExperimentModelLock, buildLiveExperimentPolicy, LiveExperimentAcceptanceSchema, LiveExperimentSettingsSchema } from '../packages/orchestrator/src/live-experiment-policy.ts';
import { SmokeCpuProofSchema, SmokeModelProofSchema } from '../packages/orchestrator/src/trusted-smoke.ts';
import { prepareSmokeTokenizer } from '../packages/orchestrator/src/smoke-tokenizer.ts';
import { SandboxVerificationSchema } from '../workers/sandbox/nebius.ts';
import { createNebiusAdjudicationChecks } from '../workers/evaluator/nebius-adjudication.ts';
import { createAccountedAdjudicator } from '../workers/evaluator/adjudication-accounting.ts';
import type { AdjudicationAccountingCheckpoint } from '../workers/evaluator/adjudication-accounting.ts';
import { adjudicateSelectedCandidate } from '../workers/evaluator/adjudicate.ts';
import { AdjudicationSchema } from '../workers/evaluator/dispatcher.ts';
import { ExperimentSessionConfigSchema } from '../workers/evaluator/experiment-session.ts';
import type { ExperimentSessionDependencies } from '../workers/evaluator/experiment-session.ts';
import { LiveReadinessReceiptSchema, liveReadinessReceiptDigest } from '../workers/evaluator/experiment-export.ts';
import { hashJson, validatePlan } from '../workers/evaluator/protocol.ts';
import { runExperimentSessionOperator } from './experiment-session-cli.ts';
import { BudgetSchema } from './config.ts';
import { assertPrivateOperatorPath, operatorJsonDigest, OperatorFileError, readPrivateOperatorJson } from './operator-files.ts';

export const LiveExperimentOperatorConfigSchema = z.strictObject({ schemaVersion: z.literal('1.0'),
  kind: z.literal('patchproof-live-experiment-operator'), executionAuthorized: z.literal(true),
  ledgerPath: z.string().min(1), budgetDigest: DigestSchema, phaseJournalPath: z.string().min(1), traceDirectory: z.string().min(1),
  evaluatorWorkspace: z.string().min(1), tokenizerArtifactFile: z.string().min(1), modelCredentialFile: z.string().min(1), sandboxCredentialFile: z.string().min(1),
  model: z.strictObject({ modelId: z.string().min(1), accountVerifiedAt: z.iso.datetime(),
    inputUsdPerMillionTokens: z.number().finite().nonnegative(), outputUsdPerMillionTokens: z.number().finite().nonnegative() }),
  modelProof: SmokeModelProofSchema, sandboxVerification: SandboxVerificationSchema, cpuProof: SmokeCpuProofSchema,
  settings: LiveExperimentSettingsSchema, acceptance: LiveExperimentAcceptanceSchema, acceptedProofDigests: z.array(DigestSchema).min(1).max(100),
});
export const liveExperimentOperatorConfigDigest = (raw: unknown) => digestJson(LiveExperimentOperatorConfigSchema.parse(raw));
export const liveExperimentFactoryDigest = (raw: unknown) => digestJson({ kind: 'private-nebius-experiment-factory-v1', configDigest: liveExperimentOperatorConfigDigest(raw) });
const fail = (code: string): never => { throw new OperatorFileError(code); };
const label = { kind: 'private-live-experiment-operator', competitionReady: false, authenticityVerified: false } as const;

function fixtureBytes(path: string, projectRoot: string): Uint8Array {
  assertPrivateOperatorPath(path, projectRoot);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd), limit = 1_048_576;
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || stat.size > limit) fail('live_operator_fixture_invalid');
    const buffer = Buffer.alloc(limit + 1); let length = 0;
    while (length <= limit) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
    if (length > limit) fail('live_operator_fixture_oversized'); return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}

export interface LiveOperatorTestHooks {
  scope: 'invented-unit-test'; fetch: typeof globalThis.fetch; currentSourceDigest: () => string;
}

/** Explicit private paths only; preflight never reads a credential or reserves spending. */
export async function prepareLiveExperimentOperator(options: {
  projectRoot: string; runtimeConfigPath: string; expectedRuntimeConfigDigest: string;
  sessionConfigPath: string; command: string; signal?: AbortSignal; testing?: LiveOperatorTestHooks;
}) {
  const { projectRoot, runtimeConfigPath } = options;
  if (options.testing && options.testing.scope !== 'invented-unit-test') fail('live_operator_test_scope');
  const read = (path: string, maximumBytes?: number) => readPrivateOperatorJson(path, { projectRoot, ...(maximumBytes ? { maximumBytes } : {}) });
  const config = LiveExperimentOperatorConfigSchema.parse(read(runtimeConfigPath));
  const runtimeDigest = liveExperimentOperatorConfigDigest(config);
  if (runtimeDigest !== DigestSchema.parse(options.expectedRuntimeConfigDigest)) fail('live_operator_config_digest');
  const session = ExperimentSessionConfigSchema.parse(read(options.sessionConfigPath));
  if (session.executionMode !== 'live') fail('live_operator_mode');
  const privatePaths = [runtimeConfigPath, options.sessionConfigPath, config.ledgerPath, config.phaseJournalPath, config.modelCredentialFile,
    config.sandboxCredentialFile, config.tokenizerArtifactFile, session.dispatcherDatabase, session.dispatcherDatabase + '.session.sqlite', session.planPath,
    ...(session.readiness ? [session.readiness.path] : [])];
  if (new Set(privatePaths).size !== privatePaths.length || privatePaths.some((path, i) => privatePaths.some((other, j) =>
    i !== j && ['-wal', '-shm', '-journal'].some(suffix => path === other + suffix)))) fail('live_operator_path_collision');
  // Read-only inspection must not depend on credentials, a ledger connection or a runtime.
  if (options.command === 'status') return { dependencies: {} as ExperimentSessionDependencies, close() {} };
  const controlOnly = options.command === 'cancel' || options.command === 'recover';
  assertPrivateOperatorPath(config.ledgerPath, projectRoot, { database: true });
  const existing = new DatabaseSync(config.ledgerPath, { readOnly: true });
  let storedBudget: unknown;
  try {
    const row = existing.prepare('SELECT approval_json FROM budget_meta WHERE id=1 AND schema_version=1').get();
    if (!row || typeof row.approval_json !== 'string' || row.approval_json.length > 2_097_152) fail('live_operator_existing_ledger_required');
    storedBudget = JSON.parse(row!.approval_json as string);
  }
  finally { existing.close(); }
  // Control-only connections use the durable policy already in this ledger and cannot dispatch.
  const budget = BudgetSchema.parse(controlOnly ? storedBudget : JSON.parse(readFileSync(join(projectRoot, 'budget.json'), 'utf8')));
  const ledger = new BudgetLedger({ filename: config.ledgerPath, budget });
  let phaseStore: PhaseAccountingStore | undefined;
  const close = () => { phaseStore?.close(); ledger.close(); };
  try {
    if (controlOnly) return { dependencies: { ledger }, close };
    if (operatorJsonDigest(budget) !== config.budgetDigest) fail('live_operator_budget_binding');
    for (const path of [config.tokenizerArtifactFile, config.modelCredentialFile, config.sandboxCredentialFile]) assertPrivateOperatorPath(path, projectRoot);
    assertPrivateOperatorPath(config.phaseJournalPath, projectRoot, { allowMissing: true, database: true });
    assertPrivateOperatorPath(join(config.traceDirectory, 'path-check'), projectRoot, { allowMissing: true });
    assertPrivateOperatorPath(join(config.evaluatorWorkspace, 'path-check'), projectRoot, { allowMissing: true });
    const currentSource = options.testing?.currentSourceDigest ?? (() => digestJson(buildOperationalLock(projectRoot).sources));
    const tokenizer = prepareSmokeTokenizer(read(config.tokenizerArtifactFile, 20_971_520), config.model.modelId, config.modelProof.tokenizerDigest);
    const sourceDigest = config.acceptance.sourceDigest;
    const validate = () => {
      if (liveExperimentOperatorConfigDigest(read(runtimeConfigPath)) !== runtimeDigest || currentSource() !== sourceDigest) fail('live_operator_source_or_config_changed');
      if (digestJson(read(config.tokenizerArtifactFile, 20_971_520)) !== tokenizer.digest) fail('live_operator_tokenizer_changed');
      tokenizer.verifyCurrent(); return sourceDigest;
    };
    validate();
    const modelLockDigest = digestJson(buildLiveExperimentModelLock({ proof: config.modelProof, ...config.model }));
    const policyDigest = hashJson(buildLiveExperimentPolicy(config.settings));
    const transportDigest = hashJson({ modelLockDigest, policyDigest, adjudicationBounds: config.settings.adjudicationBounds });
    if (session.sourceDigest !== sourceDigest || session.modelLockDigest !== modelLockDigest || session.policyDigest !== policyDigest || session.transportDigest !== transportDigest ||
        session.factoryDigest !== liveExperimentFactoryDigest(config) || config.acceptance.policyDigest !== policyDigest || config.acceptance.modelLockDigest !== modelLockDigest ||
        config.acceptance.sandboxVerificationDigest !== digestJson(config.sandboxVerification) || config.acceptance.cpuProofDigest !== digestJson(config.cpuProof) ||
        !config.acceptedProofDigests.includes(digestJson(config.acceptance))) fail('live_operator_runtime_binding');
    if (!session.readiness) fail('live_operator_readiness_required');
    const plan = validatePlan(read(session.planPath)), stage = plan.kind === 'pilot' ? 'pilot' : 'evaluate';
    if (hashJson(plan) !== session.planDigest || plan.approvedExperimentBudgetUsd > budget.stages[stage]) fail('live_operator_plan_budget');
    for (const episode of plan.episodes) for (const key of ['inferenceCallLimit', 'inputTokenLimit', 'outputTokenLimit', 'wallTimeLimitSeconds', 'sandboxCpuSecondsLimit'] as const) {
      const limit = budget.episodeLimits[key]; if (limit === null || episode.limits[key] > limit) fail('live_operator_episode_ceiling');
    }
    const now = Date.now(), end = now + 910_000;
    if (config.settings.adjudicationReserve.wallSeconds < config.settings.accountingTimeoutSeconds + config.settings.cleanupTimeoutSeconds + 1) fail('live_operator_adjudication_reserve');
    if ([config.acceptance, config.modelProof, config.sandboxVerification].some(proof => Date.parse(proof.validUntil) <= end) ||
        Date.parse(config.model.accountVerifiedAt) > now || [config.acceptance, config.modelProof, config.cpuProof, config.sandboxVerification.account,
          config.sandboxVerification.image, config.sandboxVerification.billing, ...Object.values(config.sandboxVerification.equivalentControls)].some(proof => Date.parse(proof.verifiedAt) > now)) fail('live_operator_proof_window');
    const currentGates = () => {
      validate();
      const receipt = LiveReadinessReceiptSchema.parse(read(session.readiness!.path));
      if (liveReadinessReceiptDigest(receipt) !== session.readiness!.acceptedDigest || receipt.bindings.sourceDigest !== sourceDigest ||
          receipt.bindings.planDigest !== session.planDigest || receipt.bindings.transportDigest !== transportDigest || Date.parse(receipt.observedAt) > Date.now()) fail('live_operator_readiness_changed');
      const snapshot = ledger.snapshot();
      return { ...receipt.gates, approvedRemainingSpendUsd: Math.min(receipt.gates.approvedRemainingSpendUsd,
        Number(snapshot.availableMicros) / 1_000_000, Number(snapshot.stages[stage].availableMicros) / 1_000_000) };
    };
    currentGates();
    const credential = (path: string) => async () => z.strictObject({ token: z.string().min(1).max(16_384).regex(/^[\x21-\x7e]+$/) }).parse(read(path, 32_768)).token;
    const fetch = options.testing?.fetch ?? globalThis.fetch;
    const sandbox = { authorized: true, expectedProjectId: config.sandboxVerification.projectId, fetch,
      credential: async () => ({ token: await credential(config.sandboxCredentialFile)(), projectId: config.sandboxVerification.projectId }) };
    const dependencies: ExperimentSessionDependencies = { ledger, currentGates, currentSourceDigest: currentSource,
      ...(options.signal ? { signal: options.signal } : {}), factory: { factoryDigest: liveExperimentFactoryDigest(config), sourceDigest, transportDigest,
        create: context => {
          validate();
          if (context.ledger !== ledger || context.executionMode !== 'live' || context.sourceDigest !== sourceDigest || context.transportDigest !== transportDigest || context.planDigest !== session.planDigest) fail('live_operator_context_binding');
          for (const episode of context.publicEpisodes) for (const key of ['inferenceCallLimit', 'inputTokenLimit', 'outputTokenLimit', 'wallTimeLimitSeconds', 'sandboxCpuSecondsLimit'] as const) {
            const limit = budget.episodeLimits[key]; if (limit === null || episode.limits[key] > limit) fail('live_operator_episode_ceiling');
          }
          phaseStore = new PhaseAccountingStore({ filename: config.phaseJournalPath });
          const pending = new Set<Promise<unknown>>();
          const track = <T>(promise: Promise<T>) => { pending.add(promise); promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise; };
          const phaseObserver = createPhaseAccountingObserver(phaseStore);
          const observer: typeof phaseObserver = (request, signal) => track(phaseObserver(request, signal));
          const traceStore = new ExperimentTraceStore(join(config.traceDirectory, 'runtime'));
          const adjudicationTrace = new ExperimentTraceStore(join(config.traceDirectory, 'adjudication'));
          const publicByDispatch = new Map(context.publicEpisodes.map(input => [input.dispatchId, input]));
          const selected = new Map<string, string | null>(), claimed = new Set<string>();
          const lastCheckpoints = new Map<string, AdjudicationAccountingCheckpoint>();
          const executor = createLiveExperimentExecutor({ settings: config.settings, acceptance: config.acceptance, acceptedProofDigests: config.acceptedProofDigests,
            planDigest: context.planDigest, traceStore, ledger, model: { ...config.model, authorized: true, fetch, credential: credential(config.modelCredentialFile) },
            modelProof: config.modelProof, tokenizer, sandbox, sandboxVerification: config.sandboxVerification, cpuProof: config.cpuProof,
            verifySourceDigest: validate, reservationForExecution: context.reservationForExecution, accountingObserver: observer,
            loadFixtureBytes: async (id, signal) => {
              signal.throwIfAborted(); TaskIdSchema.parse(id); const path = join(config.evaluatorWorkspace, 'fixtures', `${id}.json`);
              // Only the source/declaration fixture is read here. Sealed values stay in the protected adjudicator.
              return fixtureBytes(path, projectRoot);
            } });
          const adjudicate = createAccountedAdjudicator({ sourceDigest, executionMode: 'live', publicEpisodes: context.publicEpisodes,
            reservationForExecution: context.reservationForExecution, observer,
            saveCheckpoint: checkpoint => {
              const id = checkpoint.binding.dispatchId;
              if (!claimed.has(id)) { adjudicationTrace.claim(id, digestJson(checkpoint.binding)); claimed.add(id); }
              adjudicationTrace.append(id, checkpoint); lastCheckpoints.set(id, structuredClone(checkpoint));
            },
            adjudicate: (input, signal) => track((async () => {
              validate(); const publicInput = publicByDispatch.get(input.episodeId);
              if (!publicInput || !selected.has(input.episodeId) || selected.get(input.episodeId) !== input.selectedCandidateDigest) fail('live_operator_selection_not_recorded');
              selected.delete(input.episodeId);
              const checks = createNebiusAdjudicationChecks({ input, reservation: context.reservationForExecution(publicInput), ledger, sourceDigest,
                verifySourceDigest: validate, sandbox, sandboxVerification: config.sandboxVerification, cpuProof: config.cpuProof,
                accountingTimeoutSeconds: config.settings.accountingTimeoutSeconds, cleanupTimeoutSeconds: config.settings.cleanupTimeoutSeconds,
                saveRawResult: result => {
                  const path = join(config.evaluatorWorkspace, 'artifacts', 'episodes', `${input.episodeId}.raw-checks.json`);
                  assertPrivateOperatorPath(path, projectRoot, { allowMissing: true });
                  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
                  try { writeFileSync(fd, JSON.stringify({ kind: 'protected-adjudication-checks', dispatchId: input.episodeId,
                    selectedCandidateDigest: input.selectedCandidateDigest, result }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
                  const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
                  try { fsyncSync(parent); } finally { closeSync(parent); }
                } });
              return AdjudicationSchema.parse(await adjudicateSelectedCandidate({ ...input, projectRoot, workspace: config.evaluatorWorkspace, signal, checks }));
            })()) });
          return { close: async () => {
            // Dispatcher deadlines can win a race while owned transport cleanup still runs.
            // Keep the ledger and observation journal open until those bounded operations settle.
            while (pending.size) await Promise.allSettled([...pending]);
            await executor.settled();
          }, transport: { ...executor, execute: (input, signal) => track((async () => {
            const result = await executor.execute(input, signal); selected.set(input.dispatchId, result.selectedCandidate?.digest ?? null); return result;
          })()), adjudicate: (input, signal) => track((async () => {
            try {
              const result = await adjudicate(input, signal); signal.throwIfAborted(); validate();
              if (ledger.get(input.episodeId).state !== 'attempted') fail('live_operator_attempt_closed');
              adjudicationTrace.finalize(input.episodeId, { state: 'settled', phaseCheckpoint: lastCheckpoints.get(input.episodeId) ?? null,
                accountingArtifactsDigest: result.artifactsDigest, evaluationUsage: result.evaluationUsage });
              return result;
            } catch (error) {
              if (claimed.has(input.episodeId)) try { adjudicationTrace.finalize(input.episodeId, { state: 'failed', phaseCheckpoint: lastCheckpoints.get(input.episodeId) ?? null }); } catch { /* Immutable prior records remain. */ }
              throw error;
            }
          })()) } };
        } } };
    return { dependencies, close };
  } catch (error) { close(); throw error; }
}

export async function runLiveExperimentOperator(args: string[], projectRoot: string, testing?: LiveOperatorTestHooks) {
  const [requestedCommand, sessionPath, sessionDigest, runtimePath, runtimeDigest, episodeId] = args;
  const command = requestedCommand === 'pilot' || requestedCommand === 'evaluate' ? 'run-all' : requestedCommand;
  let prepared: Awaited<ReturnType<typeof prepareLiveExperimentOperator>> | undefined;
  const controller = new AbortController(), abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    if (!['preflight', 'run-one', 'run-all', 'status', 'cancel', 'recover'].includes(command!) || args.length !== (['run-one', 'cancel'].includes(command!) ? 6 : 5)) fail('live_operator_usage');
    if (requestedCommand === 'pilot' || requestedCommand === 'evaluate') {
      const session = ExperimentSessionConfigSchema.parse(readPrivateOperatorJson(sessionPath!, { projectRoot }));
      const plan = validatePlan(readPrivateOperatorJson(session.planPath, { projectRoot }));
      if (plan.kind !== (requestedCommand === 'pilot' ? 'pilot' : 'final')) fail('live_operator_plan_kind');
    }
    prepared = await prepareLiveExperimentOperator({ projectRoot, runtimeConfigPath: runtimePath!, expectedRuntimeConfigDigest: runtimeDigest!,
      sessionConfigPath: sessionPath!, command: command!, signal: controller.signal, ...(testing ? { testing } : {}) });
    const result = await runExperimentSessionOperator([command!, sessionPath!, sessionDigest!, ...(episodeId ? [episodeId] : [])], projectRoot, prepared.dependencies);
    return { ...result, output: { ...result.output, ...label, requestedCommand, syntheticTransportTest: Boolean(testing) } };
  } catch (error) {
    const code = error instanceof OperatorFileError && /^live_operator_[a-z_]+$/.test(error.code) ? error.code : 'live_operator_rejected';
    return { exitCode: 2, output: { ...label, status: 'error', syntheticTransportTest: Boolean(testing), executionPerformed: ['run-one', 'run-all'].includes(command!) ? null : false, error: { code } } };
  } finally { prepared?.close(); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLiveExperimentOperator(process.argv.slice(2), fileURLToPath(new URL('../', import.meta.url)));
  console.log(JSON.stringify(result.output, null, 2)); process.exitCode = result.exitCode;
}
