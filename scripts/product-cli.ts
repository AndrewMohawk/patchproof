import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { lstat, mkdir, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { createApplication } from '../apps/api/src/application.ts';
import { readConfiguration, readiness } from './config.ts';
import { createLocalRuntime, DockerCheckRunner } from '../workers/sandbox/index.ts';
import { RunJournal } from '../packages/orchestrator/src/journal.ts';
import { EvidenceStore, verifyEvidence, reproduceEvidence } from '../packages/orchestrator/src/evidence.ts';
import { loadFixtures } from '../packages/orchestrator/src/fixtures.ts';
import { ContractError } from '../packages/contracts/src/index.ts';
import { auditRelease } from './release-audit.ts';
import { verifyOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { ReleaseDigestSchema } from './release-receipts.ts';
import { buildReleasePacket, verifyReleasePacket } from './release-packet.ts';
import { readReleaseInput } from './release-input.ts';

const root = new URL('../', import.meta.url);
const [command, argument, variant = 'patchproof'] = process.argv.slice(2);
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const stateDirectory = fileURLToPath(new URL('.local/product/', root));
const label = { mode: 'mock', competitionReady: false };

async function sourceReference() {
  try {
    const run = promisify(execFile);
    const { stdout: commit } = await run('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root) });
    const { stdout: changes } = await run('git', ['status', '--porcelain', '--untracked-files=normal', '--',
      'packages', 'workers', 'apps', 'scripts', 'Makefile', 'tsconfig.json', 'package.json', 'package-lock.json', 'runtime-lock.json', 'budget.json', 'owner-decisions.json'], { cwd: fileURLToPath(root) });
    return { sourceCommit: /^[a-f0-9]{40}$/.test(commit.trim()) ? commit.trim() : null, workingTreeDirty: changes.length > 0 };
  } catch { return { sourceCommit: null, workingTreeDirty: true }; }
}

async function exportPath(id: string) {
  if (!z.uuid().safeParse(id).success) throw new ContractError('invalid_request', 'RUN must be a run UUID.');
  const directory = new URL('artifacts/', root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(fileURLToPath(directory).replace(/\/$/, ''));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ContractError('invalid_request', 'Artifact directory cannot be a symlink.');
  return new URL(`${id}.json`, directory);
}

async function main() {
  const config = await readConfiguration(root);
  if (command === 'doctor') {
    const runtime = await createLocalRuntime();
    print({ ...label, command, status: 'diagnostic_complete', paidCalls: 0,
      local: { node: process.versions.node, architecture: process.arch, platform: process.platform },
      localRuntime: runtime.status, publicFixtureCount: (await loadFixtures(root)).length,
      maxApprovedSpendUsd: config.budget.maxApprovedSpendUsd, verifiedCredits: config.budget.verifiedCredits,
      blockers: readiness(config), realIntegration: 'NOT RUN', experimentEpisodesExecuted: 0 });
    return;
  }
  if (command === 'release-check') {
    const result = await auditRelease(root, config, argument ? await readReleaseInput(fileURLToPath(root), argument, config) : undefined);
    print(result); if (!result.checks.every(check => check.status === 'pass')) process.exitCode = 2; return;
  }
  if (command === 'release-packet') {
    if (!argument) throw new ContractError('invalid_request', 'Provide a repository-relative release input JSON path.');
    const input = await readReleaseInput(fileURLToPath(root), argument, config);
    const packet = await buildReleasePacket({ root: fileURLToPath(root), ...input, ...await sourceReference() });
    print({ ...label, mode: input.bindings.runtimeMode, command, status: 'local_preparation', directory: packet.directory, packetDigest: packet.packetDigest,
      evidenceStatus: packet.manifest.evidenceStatus, paidCalls: packet.paidCalls, published: packet.published });
    return;
  }
  if (command === 'verify-packet') {
    if (!argument || !/^artifacts\/release-packets\/[a-f0-9]{64}$/.test(argument)) throw new ContractError('invalid_request', 'Provide artifacts/release-packets/<digest> and the expected sha256 digest.');
    print(await verifyReleasePacket(fileURLToPath(new URL(argument + '/', root)), ReleaseDigestSchema.parse(variant)));
    return;
  }
  if (['smoke', 'pilot', 'evaluate'].includes(command ?? '')) {
    print({ ...label, command, status: 'blocked', paidCalls: 0, experimentEpisodesExecuted: 0,
      blockers: readiness(config), note: 'Full local implementation is authorized; real integration/evaluation and competition readiness remain gated.' });
    process.exitCode = 2; return;
  }
  if (command === 'run') {
    const app = await createApplication(root);
    try {
      const { run } = app.coordinator.create({ taskId: argument ?? 'stable-unique-01', variant, mode: 'mock', idempotencyKey: `cli-${crypto.randomUUID()}` });
      await app.coordinator.settled();
      const result = app.coordinator.get(run.id);
      print({ ...label, run: result, commands: [`make export RUN=${run.id}`, `make reproduce RUN=${run.id}`] });
      if (result.terminalStatus === 'infrastructure_error') process.exitCode = 2;
    } finally { await app.close(); }
    return;
  }
  if (command === 'export' || command === 'reproduce') {
    if (!argument) throw new ContractError('invalid_request', 'Provide RUN=<run UUID>.');
    const path = await exportPath(argument);
    if (command === 'export') {
      const journal = new RunJournal(`${stateDirectory}/runs.sqlite`, true);
      try {
        const digest = journal.evidenceDigest(argument);
        if (!digest) throw new ContractError('evidence_not_ready', 'Run has no published evidence.', 409);
        const bundle = await new EvidenceStore(`${stateDirectory}/evidence`).get(digest);
        try {
          const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try { await file.writeFile(JSON.stringify(bundle, null, 2) + '\n'); } finally { await file.close(); }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          try { verifyEvidence(JSON.parse(await file.readFile('utf8')), digest); } finally { await file.close(); }
        }
        print({ ...label, mode: bundle.mode, command, path: fileURLToPath(path), bundleDigest: digest });
      } finally { journal.close(); }
      return;
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bundle;
    try { bundle = verifyEvidence(JSON.parse(await file.readFile('utf8'))); } finally { await file.close(); }
    if (bundle.run.id !== argument) throw new ContractError('digest_mismatch', 'Requested run and artifact differ.');
    if (bundle.mode === 'live') throw new Error('live_replay_configuration_required');
    const lock = bundle.runtimeLock as { localCheckImage?: string; operationalLock?: unknown };
    if (lock.operationalLock) verifyOperationalLock(fileURLToPath(root), lock.operationalLock);
    if (!lock.localCheckImage) throw new ContractError('setup_error', 'Export has no pinned local checker image.');
    const replay = await reproduceEvidence(bundle, new DockerCheckRunner({ image: lock.localCheckImage }), AbortSignal.timeout(35_000));
    print({ ...replay, bundleDigest: bundle.bundleDigest, authenticityVerified: false });
    if (replay.status !== 'reproduced') process.exitCode = 2;
    return;
  }
  throw new ContractError('invalid_request', 'Use doctor, run, smoke, pilot, evaluate, export, reproduce, release-check, release-packet or verify-packet.');
}
try { await main(); }
catch (error) {
  const releaseCode = error instanceof Error && /^release_[a-z_]+$/.test(error.message) ? error.message : null;
  const liveReplay = error instanceof Error && error.message === 'live_replay_configuration_required';
  const code = error instanceof ContractError ? error.code : liveReplay ? 'live_replay_configuration_required' : releaseCode ?? 'setup_error';
  print({ ...label, ...(liveReplay ? { mode: 'live' } : {}), status: 'error', error: { code, message: error instanceof ContractError ? error.message :
    liveReplay ? 'Live evidence replay requires the private operator CONFIG; default replay cannot use the local checker.' :
    releaseCode ? `Release preparation stopped: ${releaseCode}. Inspect release-check and the release evidence guide.` :
      'Local configuration, runtime or artifact unavailable. Check doctor and active coordinator ownership.' } });
  process.exitCode = 2;
}
