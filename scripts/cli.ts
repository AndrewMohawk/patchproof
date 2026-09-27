import { MOCK_LABEL, ContractError, DigestSchema } from '../packages/contracts/src/index.ts';
import { MockCoordinator } from '../packages/mock/src/coordinator.ts';
import { buildBundle, verifyBundle } from '../packages/mock/src/bundle.ts';
import { optionalBundle, readBundle, writeBundle } from '../packages/mock/src/store.ts';
import { readConfiguration, readiness } from './config.ts';

const root = new URL('../', import.meta.url);
const [command, runId, suppliedDigest] = process.argv.slice(2);
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function main() {
  const config = await readConfiguration(root);
  if (command === 'doctor') {
    print({ ...MOCK_LABEL, command, status: 'diagnostic_complete', paidCalls: 0,
      local: { node: process.versions.node, architecture: process.arch, platform: process.platform },
      expectedLocal: config.runtime.local, maxApprovedSpendUsd: config.budget.maxApprovedSpendUsd,
      verifiedCreditCount: config.budget.verifiedCredits.length, entitlements: 'unverified',
      gates: { G0: 'blocked', G1: 'not_run', G2: 'not_run', G3: 'not_run', G4: 'not_run' },
      blockers: readiness(config),
    });
    return;
  }
  if (['smoke', 'pilot', 'evaluate', 'release-check'].includes(command ?? '')) {
    print({ ...MOCK_LABEL, command, status: 'blocked', paidCalls: 0,
      implementation: 'gate_report_only', blockers: readiness(config),
      additionallyRequired: command === 'smoke' ? ['Two authorized sponsor-backed cases.'] :
        ['Dependent tasks and real episode artifacts.', 'Passing pilot before UI polish and final evaluation.',
          'Public-source license, clean release audit and owner publishing/entry decisions.'],
      experimentEpisodesExecuted: 0,
    });
    process.exitCode = 2;
    return;
  }
  if (command === 'mock-run') {
    const coordinator = new MockCoordinator(config.runtime);
    const { run } = coordinator.create({ taskId: 'contract-smoke', variant: 'baseline', mode: 'mock',
      idempotencyKey: `cli-${crypto.randomUUID()}` });
    await coordinator.settled();
    const bundle = buildBundle(coordinator.get(run.id), config.runtime);
    await writeBundle(root, '.local/mock/', bundle);
    print({ ...MOCK_LABEL, runId: run.id, path: `.local/mock/${run.id}.json`, terminalStatus: 'needs_review',
      commands: [`make export RUN=${run.id}`, `make reproduce RUN=${run.id}`] });
    return;
  }
  if (command === 'export' || command === 'reproduce') {
    if (!runId) throw new ContractError('invalid_request', 'Provide RUN=<mock run UUID>; generate one with npm run mock-run.');
    if (command === 'export') {
      const original = await readBundle(root, '.local/mock/', runId);
      await writeBundle(root, 'artifacts/', original);
      print({ ...MOCK_LABEL, command, path: `artifacts/${runId}.json`, bundleDigest: original.bundleDigest });
    } else {
      const original = await optionalBundle(root, '.local/mock/', runId);
      const exported = await readBundle(root, 'artifacts/', runId);
      if (suppliedDigest && !DigestSchema.safeParse(suppliedDigest).success) {
        throw new ContractError('invalid_request', 'DIGEST must be a sha256 digest.');
      }
      verifyBundle(exported, suppliedDigest || original?.bundleDigest);
      print({ ...MOCK_LABEL, command, status: 'integrity_verified',
        replayScope: 'integrity_only_no_execution', executionPerformed: false,
        integrityBasis: suppliedDigest ? 'provided_digest' : original ? 'local_reference' : 'export_self_digest',
        authenticityVerified: false,
        notice: 'MOCK integrity check only. No patch verdict reproduced; not competition evidence.',
        bundleDigest: exported.bundleDigest });
    }
    return;
  }
  throw new ContractError('invalid_request', 'Unknown command. Use doctor, mock-run, smoke, pilot, evaluate, export, reproduce or release-check.');
}

try { await main(); }
catch (error) {
  // Never print raw errors: provider errors/invalid configuration may contain secrets.
  const known = error instanceof ContractError ? error : new ContractError('setup_error', 'Configuration or artifact could not be read/validated.');
  print({ ...MOCK_LABEL, command: command ?? null, status: 'error', error: { code: known.code, message: known.message } });
  process.exitCode = 2;
}
