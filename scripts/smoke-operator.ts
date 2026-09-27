import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { DigestSchema, LimitsSchema, VariantSchema } from '../packages/contracts/src/index.ts';
import type { ProductRun } from '../packages/contracts/src/product.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { createTrustedSmokeEpisode, SmokeCpuProofSchema, SmokeModelProofSchema, SmokeSourceProofSchema, TrustedSmokeGateError } from '../packages/orchestrator/src/trusted-smoke.ts';
import type { TrustedSmokeInput } from '../packages/orchestrator/src/trusted-smoke.ts';
import { SandboxVerificationSchema } from '../workers/sandbox/nebius.ts';
import { BudgetLedger } from '../packages/orchestrator/src/budget-ledger.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore } from '../packages/orchestrator/src/evidence.ts';
import { loadFixtures } from '../packages/orchestrator/src/fixtures.ts';
import { prepareSmokeTokenizer } from '../packages/orchestrator/src/smoke-tokenizer.ts';
import { SmokeOperatorSessions, SmokeOperatorSessionError } from '../packages/orchestrator/src/smoke-operator-sessions.ts';
import { BudgetSchema } from './config.ts';
import { assertPrivateOperatorPath, operatorJsonDigest, readPrivateOperatorJson } from './operator-files.ts';

export const SmokeOperatorConfigSchema = z.strictObject({ schemaVersion: z.literal('1.0'), executionAuthorized: z.literal(true),
  episodeId: z.uuid(), taskId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), variant: VariantSchema, limits: LimitsSchema,
  stateDirectory: z.string().min(1), ledgerFile: z.string().min(1), budgetDigest: DigestSchema,
  tokenizerArtifactFile: z.string().min(1), modelCredentialFile: z.string().min(1), sandboxCredentialFile: z.string().min(1),
  model: z.strictObject({ modelId: z.string().min(1), accountVerifiedAt: z.iso.datetime(),
    inputUsdPerMillionTokens: z.number().finite().nonnegative(), outputUsdPerMillionTokens: z.number().finite().nonnegative() }),
  modelProof: SmokeModelProofSchema, sourceProof: SmokeSourceProofSchema, cpuProof: SmokeCpuProofSchema,
  sandboxVerification: SandboxVerificationSchema,
});
type Config = z.infer<typeof SmokeOperatorConfigSchema>;
export interface SmokeOperatorRuntime {
  envelope: unknown; start: (signal: AbortSignal) => void;
  settled: () => Promise<Record<string, unknown>>; snapshot: () => Record<string, unknown>;
  close: () => Promise<void>;
}
export interface SmokeOperatorTesting {
  scope: 'synthetic-test'; sourceDigest: () => string;
  buildRuntime: (input: TrustedSmokeInput) => SmokeOperatorRuntime;
}
const safe = (error: unknown) => error instanceof TrustedSmokeGateError ? error.gateCode : error instanceof SmokeOperatorSessionError && /^[a-z_]+$/.test(error.code) ? `smoke_session_${error.code}` : error && typeof error === 'object' && 'code' in error &&
  typeof error.code === 'string' && /^(?:operator_|smoke_|budget_|approval_)[a-z_]+$/.test(error.code) ? error.code :
  error instanceof Error && /^smoke_[a-z_]+$/.test(error.message) ? error.message : 'smoke_operator_unavailable';
function fail(code: string): never { throw new Error(`smoke_${code}`); }
export function smokeRunSummary(run: ProductRun) {
  const observed = run.events.flatMap(event => {
    const match = /^(?:Nebius model (request_intent|response): |Failed inference response ID: )([A-Za-z0-9._:/-]{1,200})\. Billing remains unreconciled\.$/.exec(event.message);
    return match ? [{ kind: match[1] ?? 'response', id: match[2] }] : [];
  });
  return { episodeId: run.id, phase: run.phase, terminalStatus: run.terminalStatus, reason: run.reason,
    usage: run.usage, sandboxOperationIds: run.sandboxOperationIds.slice(0, 192),
    sandboxOperationCount: run.sandboxOperationIds.length, sandboxOperationIdsTruncated: run.sandboxOperationIds.length > 192,
    completeOperationJournal: 'runs.sqlite',
    modelResponseIds: [...new Set([...run.candidates.map(candidate => candidate.providerRequestId).filter(value => value !== null),
      ...observed.filter(item => item.kind === 'response').map(item => item.id)])],
    modelRequestIntentIds: observed.filter(item => item.kind === 'request_intent').map(item => item.id),
    billing: 'unreconciled', competitionReady: false };
}
function realRuntime(input: TrustedSmokeInput): SmokeOperatorRuntime {
  const episode = createTrustedSmokeEpisode(input);
  return { envelope: episode.envelope, start: signal => { episode.start(signal); },
    snapshot: () => smokeRunSummary(episode.coordinator.get(input.episodeId)),
    settled: async () => { const run = await episode.settled(); return { ...smokeRunSummary(run), bundleDigest: input.journal.evidenceDigest(run.id),
      accounting: episode.accounting() }; }, close: () => episode.close() };
}

/** Explicit private operator session. Test hooks are in-memory only and cannot appear in CLI JSON. */
export function createSmokeOperator(options: { projectRoot: string; testing?: SmokeOperatorTesting }) {
  const projectRoot = resolve(options.projectRoot), testing = options.testing;
  if (testing && testing.scope !== 'synthetic-test') fail('test_scope_invalid');
  const scope = testing ? 'synthetic-test' as const : 'live' as const;
  const currentSource = testing?.sourceDigest ?? (() => digestJson(buildOperationalLock(projectRoot)));
  const buildRuntime = testing?.buildRuntime ?? realRuntime;
  const load = (filename: string) => {
    const config = SmokeOperatorConfigSchema.parse(readPrivateOperatorJson(filename, { projectRoot }));
    if (resolve(config.stateDirectory) !== config.stateDirectory) fail('state_path_invalid');
    assertPrivateOperatorPath(join(config.stateDirectory, 'sessions.sqlite'), projectRoot, { allowMissing: true, database: true });
    assertPrivateOperatorPath(config.ledgerFile, projectRoot, { allowMissing: true, database: true });
    return { config, configDigest: digestJson(config), filename };
  };
  const prepare = async (loaded: ReturnType<typeof load>) => {
    const { config, configDigest, filename } = loaded;
    for (const path of [config.tokenizerArtifactFile, config.modelCredentialFile, config.sandboxCredentialFile]) assertPrivateOperatorPath(path, projectRoot);
    const fixture = (await loadFixtures(pathToFileURL(projectRoot + '/'))).find(item => item.id === config.taskId);
    if (!fixture || fixture.split === 'final') fail('unknown_public_task');
    const budget = BudgetSchema.parse(JSON.parse(readFileSync(join(projectRoot, 'budget.json'), 'utf8')));
    if (operatorJsonDigest(budget) !== config.budgetDigest) fail('budget_binding_changed');
    for (const key of ['inferenceCallLimit', 'inputTokenLimit', 'outputTokenLimit', 'wallTimeLimitSeconds', 'sandboxCpuSecondsLimit'] as const) {
      const ceiling = budget.episodeLimits[key];
      if (ceiling === null || config.limits[key] > ceiling) fail('episode_allowance_exceeded');
    }
    if (config.limits.maxApprovedSpendUsd > budget.stages.smoke || config.limits.inferenceCallLimit > 3) fail('episode_allowance_exceeded');
    const artifact = readPrivateOperatorJson(config.tokenizerArtifactFile, { projectRoot, maximumBytes: 20_971_520 });
    const tokenizer = prepareSmokeTokenizer(artifact, config.model.modelId, config.modelProof.tokenizerDigest);
    const validate = () => {
      if (digestJson(SmokeOperatorConfigSchema.parse(readPrivateOperatorJson(filename, { projectRoot }))) !== configDigest) fail('config_changed');
      if (digestJson(readPrivateOperatorJson(config.tokenizerArtifactFile, { projectRoot, maximumBytes: 20_971_520 })) !== tokenizer.digest) fail('tokenizer_binding');
      tokenizer.verifyCurrent();
      if (currentSource() !== config.sourceProof.digest) fail('source_changed');
      return config.sourceProof.digest;
    };
    validate();
    const credential = (path: string) => async () => {
      const value = z.strictObject({ token: z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/) }).parse(readPrivateOperatorJson(path, { projectRoot, maximumBytes: 32768 }));
      return value.token;
    };
    // Preflight initializes only private local state, never an episode reservation or dispatch.
    const journalFile = join(config.stateDirectory, 'runs.sqlite');
    assertPrivateOperatorPath(journalFile, projectRoot, { allowMissing: true, database: true });
    try { closeSync(openSync(journalFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const evidenceDirectory = join(config.stateDirectory, 'evidence');
    try { mkdirSync(evidenceDirectory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const evidenceStat = lstatSync(evidenceDirectory);
    if (!evidenceStat.isDirectory() || evidenceStat.isSymbolicLink() || evidenceStat.mode & 0o077 || process.getuid && evidenceStat.uid !== process.getuid()) fail('evidence_directory_invalid');
    const ledger = new BudgetLedger({ filename: config.ledgerFile, budget });
    let journal: RunJournal | null = null, runtime: SmokeOperatorRuntime | null = null;
    try {
      journal = new RunJournal(journalFile);
      const forbiddenFetch: typeof globalThis.fetch = async () => { fail('synthetic_network_forbidden'); };
      runtime = buildRuntime({ episodeId: config.episodeId, fixture, variant: config.variant, limits: config.limits,
        model: { ...config.model, authorized: true, fetch: testing ? forbiddenFetch : globalThis.fetch,
          credential: credential(config.modelCredentialFile), countInputTokens: tokenizer.countInputTokens },
        modelProof: config.modelProof, sourceProof: config.sourceProof, cpuProof: config.cpuProof,
        sandbox: { authorized: true, fetch: testing ? forbiddenFetch : globalThis.fetch, expectedProjectId: config.sandboxVerification.projectId,
          credential: async () => ({ token: await credential(config.sandboxCredentialFile)(), projectId: config.sandboxVerification.projectId }) },
        sandboxVerification: config.sandboxVerification, verifySourceDigest: validate,
        ledger, journal, store: new EvidenceStore(evidenceDirectory) });
      const prepared = runtime;
      return { runtime: prepared, close: async () => { try { await prepared.close(); } finally { ledger.close(); } } };
    } catch (error) { if (runtime) await runtime.close(); else journal?.close(); ledger.close(); throw error; }
  };
  return {
    async preflight(filename: string) {
      const loaded = load(filename), prepared = await prepare(loaded);
      try { return { command: 'preflight', scope: 'no-execution', status: 'ready-for-explicit-start', episodeId: loaded.config.episodeId,
        configDigest: loaded.configDigest, sourceDigest: loaded.config.sourceProof.digest, tokenizerDigest: loaded.config.modelProof.tokenizerDigest,
        envelope: prepared.runtime.envelope, localStateInitialized: true, credentialsRead: 0, providerCalls: 0, reservationCreated: false }; }
      finally { await prepared.close(); }
    },
    status(filename: string) {
      const { config, configDigest } = load(filename), path = join(config.stateDirectory, 'sessions.sqlite');
      if (!assertPrivateOperatorPath(path, projectRoot, { allowMissing: true, database: true })) return { command: 'status', status: 'not-started', episodeId: config.episodeId, commandProviderCalls: 0 };
      const sessions = new SmokeOperatorSessions({ filename: path });
      try { const session = sessions.status(config.episodeId); return { command: 'status', session, configMatches: session ? session.configDigest === configDigest : null,
        cleanup: 'remote-cleanup-not-established', commandProviderCalls: 0 }; }
      finally { sessions.close(); }
    },
    cancel(filename: string) {
      const { config } = load(filename), path = join(config.stateDirectory, 'sessions.sqlite');
      if (!assertPrivateOperatorPath(path, projectRoot, { allowMissing: true, database: true })) fail('session_not_started');
      const sessions = new SmokeOperatorSessions({ filename: path });
      try { return { command: 'cancel', status: 'cancellation-requested', session: sessions.requestCancel(config.episodeId), commandProviderCalls: 0,
        note: 'A cancellation request is not remote cleanup or billing reconciliation.' }; }
      finally { sessions.close(); }
    },
    async start(filename: string, signal: AbortSignal) {
      const loaded = load(filename), { config } = loaded;
      signal.throwIfAborted();
      const sessions = new SmokeOperatorSessions({ filename: join(config.stateDirectory, 'sessions.sqlite') });
      let prepared: Awaited<ReturnType<typeof prepare>> | null = null, timer: ReturnType<typeof setInterval> | undefined;
      const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
      let claim: ReturnType<SmokeOperatorSessions['claimStart']>;
      try { claim = sessions.claimStart({ episodeId: config.episodeId, configDigest: loaded.configDigest, scope }); }
      catch (error) { sessions.close(); throw error; }
      try {
        if (!claim.granted) return { command: 'start', scope: claim.session.scope, reused: true, session: claim.session, commandProviderCalls: 0 };
        prepared = await prepare(loaded);
        if (sessions.status(config.episodeId)?.cancelRequested) controller.abort();
        combined.throwIfAborted(); prepared.runtime.start(combined);
        sessions.update(claim.token!, prepared.runtime.snapshot());
        timer = setInterval(() => {
          try { if (sessions.status(config.episodeId)?.cancelRequested) controller.abort(); sessions.update(claim.token!, prepared!.runtime.snapshot()); }
          catch { controller.abort(new Error('smoke_session_persistence_failed')); }
        }, 100);
        const result = await prepared.runtime.settled();
        clearInterval(timer); timer = undefined;
        return { command: 'start', scope, reused: false, session: sessions.finish(claim.token!, result) };
      } catch (error) {
        const wasCancelled = combined.aborted;
        controller.abort();
        if (prepared) { try { await prepared.runtime.settled(); } catch {} }
        let partial: Record<string, unknown> = {};
        try { partial = prepared?.runtime.snapshot() ?? {}; } catch {}
        if (claim.granted) sessions.finish(claim.token!, { ...partial, phase: 'terminal', status: 'blocked', reason: wasCancelled ? 'cancelled_or_runtime_error' : safe(error), billing: 'unreconciled' });
        throw error;
      } finally { if (timer) clearInterval(timer); try { await prepared?.close(); } finally { sessions.close(); } }
    },
  };
}

export async function smokeOperatorMain(args: string[]) {
  const [command, filename, ...extra] = args;
  if (!filename || extra.length || !['preflight', 'start', 'status', 'cancel'].includes(command ?? '')) fail('usage');
  const operator = createSmokeOperator({ projectRoot: fileURLToPath(new URL('../', import.meta.url)) });
  const controller = new AbortController(), abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const result = command === 'preflight' ? await operator.preflight(filename) : command === 'start' ? await operator.start(filename, controller.signal) :
      command === 'status' ? operator.status(filename) : operator.cancel(filename);
    return result;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await smokeOperatorMain(process.argv.slice(2)), null, 2)); }
  catch (error) { console.log(JSON.stringify({ command: 'smoke-operator', status: 'blocked', error: { code: safe(error) },
    note: 'No retry is implied. Inspect private session state and unresolved billing before another explicit episode.' })); process.exitCode = 2; }
}
