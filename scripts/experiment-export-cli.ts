import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import { captureExperimentSnapshot, exportExperiment, ExportBindingsSchema,
  liveReadinessReceiptDigest, verifyExperimentExport } from '../workers/evaluator/experiment-export.ts';
import { assertPrivateOperatorPath, operatorJsonDigest, OperatorFileError, readPrivateOperatorJson } from './operator-files.ts';

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ExperimentExportOperatorConfigSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), kind: z.literal('patchproof-experiment-export-operator'),
  dispatcherDatabase: z.string().min(1), directory: z.string().min(1), bindings: ExportBindingsSchema,
  sourceBinding: z.enum(['current-operational-lock', 'expected-historical-lock']),
  readiness: z.strictObject({ path: z.string().min(1), acceptedDigest: Digest }).nullable(),
});
const label = { kind: 'trusted-experiment-export-operator', executionPerformed: false, providerCalls: 0,
  authenticityVerified: false, sourceExecutionVerified: false, competitionReady: false } as const;
const stop = (code: string): never => { throw new OperatorFileError(code); };

/** Trusted metadata export only: no execution factory or repair/evaluator callbacks. */
export function runExperimentExportOperator(args: string[], projectRoot: string) {
  try {
    const [command, configPath, expectedConfigDigest, expectedManifestDigest] = args;
    if (!((command === 'export' && args.length === 3) || (command === 'verify' && args.length === 4))) stop('operator_usage');
    const config = ExperimentExportOperatorConfigSchema.parse(readPrivateOperatorJson(configPath!, { projectRoot }));
    if (operatorJsonDigest(config) !== Digest.parse(expectedConfigDigest)) stop('operator_config_digest_mismatch');
    if (command === 'verify') {
      assertPrivateOperatorPath(join(config.directory, 'manifest.json'), projectRoot);
      const verified = verifyExperimentExport({ directory: config.directory, expected: config.bindings,
        expectedManifestDigest: Digest.parse(expectedManifestDigest),
        ...(config.readiness ? { acceptedReadinessReceiptDigest: config.readiness.acceptedDigest } : {}) });
      return { exitCode: 0, output: { ...label, command, status: 'verified', manifestDigest: verified.manifestDigest,
        executionMode: verified.manifest.executionMode, integrityVerified: true,
        plannedEpisodes: verified.summary.plannedEpisodes, terminalEpisodes: verified.summary.terminalEpisodes,
        complete: verified.summary.complete } };
    }
    assertPrivateOperatorPath(config.dispatcherDatabase, projectRoot, { database: true });
    if (config.sourceBinding === 'current-operational-lock' && digestJson(buildOperationalLock(projectRoot).sources) !== config.bindings.sourceDigest) {
      stop('operator_current_source_mismatch');
    }
    const readiness = config.readiness ? readPrivateOperatorJson(config.readiness.path, { projectRoot }) : undefined;
    if (config.readiness && liveReadinessReceiptDigest(readiness) !== config.readiness.acceptedDigest) stop('operator_readiness_digest_mismatch');
    const capture = captureExperimentSnapshot({ dispatcherDatabase: config.dispatcherDatabase,
      expected: config.bindings, sourceBinding: config.sourceBinding });
    const exported = exportExperiment({ directory: config.directory, projectRoot, capture, expected: config.bindings,
      ...(config.readiness ? { liveReadinessReceipt: readiness, acceptedReadinessReceiptDigest: config.readiness.acceptedDigest } : {}) });
    return { exitCode: 0, output: { ...label, command, status: 'exported', manifestDigest: exported.manifestDigest,
      executionMode: exported.manifest.executionMode, plannedEpisodes: exported.summary.plannedEpisodes,
      terminalEpisodes: exported.summary.terminalEpisodes, complete: exported.summary.complete } };
  } catch (error) {
    return { exitCode: 2, output: { ...label, status: 'error', error: {
      code: error instanceof OperatorFileError ? error.code : 'operator_export_or_verification_rejected' } } };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runExperimentExportOperator(process.argv.slice(2), fileURLToPath(new URL('../', import.meta.url)));
  console.log(JSON.stringify(result.output, null, 2));
  process.exitCode = result.exitCode;
}
