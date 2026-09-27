import { closeSync, constants, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { PhaseAccountingStore, PhaseAccountingContextSchema, PhaseAccountingReceiptSchema } from '../packages/orchestrator/src/phase-accounting.ts';
import { assertPrivateOperatorPath, OperatorFileError, readPrivateOperatorJson } from './operator-files.ts';

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const PhaseAccountingOperatorConfigSchema = z.strictObject({ schemaVersion: z.literal('1.0'),
  kind: z.literal('patchproof-phase-accounting-operator'), journalPath: z.string().min(1) });
const label = { kind: 'trusted-phase-accounting-operator', executionPerformed: false, dispatchGranted: false,
  ledgerModified: false, providerCalls: 0, authenticityVerified: false, competitionReady: false } as const;
const fail = (code: string): never => { throw new OperatorFileError(code); };

/** Separate from whole-episode reconciliation. It cannot release a reservation or open a runtime. */
export function runPhaseAccountingOperator(args: string[], projectRoot: string) {
  let store: PhaseAccountingStore | undefined;
  try {
    const [command, configPath, configDigest, ...rest] = args;
    if (!['status', 'request', 'accept'].includes(command!) || rest.length !== ({ status: 0, request: 3, accept: 3 }[command!] ?? -1)) fail('phase_operator_usage');
    const read = (path: string) => readPrivateOperatorJson(path, { projectRoot });
    const config = PhaseAccountingOperatorConfigSchema.parse(read(configPath!));
    if (digestJson(config) !== Digest.parse(configDigest)) fail('phase_operator_config_digest_mismatch');
    assertPrivateOperatorPath(config.journalPath, projectRoot, { database: true });
    // Intake requires a pre-existing journal with an immutable runtime request. No typo-created state.
    if (command === 'accept') {
      const receipt = PhaseAccountingReceiptSchema.parse(read(rest[0]!));
      const context = PhaseAccountingContextSchema.parse(read(rest[1]!));
      if (digestJson(context) !== Digest.parse(rest[2])) fail('phase_operator_context_digest_mismatch');
      store = new PhaseAccountingStore({ filename: config.journalPath });
      const result = store.acceptObservation(receipt, context);
      return { exitCode: 0, output: { ...label, ...result } };
    }
    store = new PhaseAccountingStore({ filename: config.journalPath, readOnly: true });
    const requests = store.requests();
    if (command === 'status') return { exitCode: 0, output: { ...label, status: 'observed', requestCount: requests.length,
      requests: requests.map(value => {
        const observation = store!.readObservedUsage(value.request);
        return { dispatchId: value.request.binding.dispatchId, phase: value.request.binding.phase, requestDigest: value.requestDigest,
          currentReceiptDigest: observation.receiptDigest, completeForCheckpoint: observation.billingComplete && observation.cpuComplete &&
            observation.inventoryComplete && observation.cleanupComplete && observation.retentionFinal };
      }) } };
    const id = z.uuid().parse(rest[0]), phase = z.enum(['runtime', 'adjudication']).parse(rest[1]), output = rest[2]!;
    const request = requests.find(value => value.request.binding.dispatchId === id && value.request.binding.phase === phase);
    if (!request) fail('phase_operator_request_not_found');
    assertPrivateOperatorPath(output, projectRoot, { allowMissing: true });
    const descriptor = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(descriptor, JSON.stringify(request, null, 2) + '\n'); fsyncSync(descriptor); }
    finally { closeSync(descriptor); }
    return { exitCode: 0, output: { ...label, status: 'request_exported', requestDigest: request!.requestDigest } };
  } catch (error) {
    const code = error instanceof OperatorFileError ? error.code : 'phase_operator_input_or_observation_rejected';
    return { exitCode: 2, output: { ...label, status: 'error', error: { code } } };
  } finally { store?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runPhaseAccountingOperator(process.argv.slice(2), fileURLToPath(new URL('../', import.meta.url)));
  console.log(JSON.stringify(result.output, null, 2)); process.exitCode = result.exitCode;
}
