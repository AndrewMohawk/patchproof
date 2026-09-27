import { z } from 'zod';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';

export const ReleaseDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ReleasePathSchema = z.string().max(250).regex(/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/)
  .refine(path => !path.split('/').some(part => part === '.' || part === '..'));
const digests = z.array(ReleaseDigestSchema).max(100).refine(values => new Set(values).size === values.length);
export const ReleaseBindingsSchema = z.strictObject({
  sourceDigest: ReleaseDigestSchema, runtimeDigest: ReleaseDigestSchema, protocolDigest: ReleaseDigestSchema,
  bundleDigests: digests, runtimeMode: z.enum(['mock', 'live']), liveProtocolFrozen: z.boolean(),
});
export type ReleaseBindings = z.infer<typeof ReleaseBindingsSchema>;

export function buildReleaseBindings(input: { sources: Record<string, string>; runtime: unknown; protocol: unknown;
  bundleDigests: string[]; runtimeMode: 'mock' | 'live'; liveProtocolFrozen: boolean }): ReleaseBindings {
  const sources = z.record(ReleasePathSchema, ReleaseDigestSchema).parse(input.sources);
  if (!Object.keys(sources).length) throw new Error('release_source_manifest_empty');
  return ReleaseBindingsSchema.parse({ sourceDigest: digestJson(sources), runtimeDigest: digestJson(input.runtime), protocolDigest: digestJson(input.protocol),
    bundleDigests: [...input.bundleDigests].sort(), runtimeMode: input.runtimeMode, liveProtocolFrozen: input.liveProtocolFrozen });
}

export const RELEASE_GATES = {
  live_smoke: { execution: 'live', human: false, independent: false, frozen: false,
    assertions: ['two_sponsor_cases_replayed', 'model_and_operation_ids_retained', 'isolation_and_cancellation_verified', 'billing_reconciled'] },
  pilot: { execution: 'live', human: false, independent: false, frozen: true,
    assertions: ['planned_episodes_accounted', 'failures_retained', 'matched_limits_verified', 'continuation_decision_recorded'] },
  sealed_evaluation: { execution: 'live', human: false, independent: false, frozen: true,
    assertions: ['planned_episodes_accounted', 'failures_retained', 'sealed_selection_boundary_verified', 'matched_analysis_and_limits_verified'] },
  reviewer_study: { execution: 'live', human: true, independent: false, frozen: true,
    assertions: ['uncoached_human_responses', 'missing_assignments_retained', 'timing_and_scoring_reviewed'] },
  presentation_runs: { execution: 'live', human: false, independent: false, frozen: false,
    assertions: ['three_reproducible_successes', 'honest_failure_or_abstention', 'claims_linked_to_selected_artifacts'] },
  independent_replay: { execution: 'local', human: false, independent: true, frozen: false,
    assertions: ['independent_machine', 'selected_success_and_failure_replayed', 'source_and_image_pins_verified'] },
  hosted_judge_access: { execution: 'live', human: false, independent: false, frozen: false,
    assertions: ['actual_deployment_observed', 'curated_access_controls_verified', 'operator_and_funding_recorded', 'required_access_duration_verified'] },
  release_secrets: { execution: 'local', human: false, independent: false, frozen: false,
    assertions: ['selected_artifacts_scanned', 'scanner_scope_and_findings_reviewed', 'no_unresolved_secret_findings'] },
  current_rules: { execution: 'not_applicable', human: true, independent: false, frozen: false,
    assertions: ['official_rules_rechecked', 'current_deadline_and_access_date_reviewed', 'eligibility_rights_ai_assistance_reviewed'] },
  license_review: { execution: 'local', human: true, independent: false, frozen: false,
    assertions: ['application_license_reviewed', 'dependency_and_fixture_notices_reviewed', 'redistribution_rights_reviewed'] },
} as const;
export type ReleaseGate = keyof typeof RELEASE_GATES;
export const ReleaseArtifactSchema = z.strictObject({ path: ReleasePathSchema, digest: ReleaseDigestSchema });
export const ReleaseReceiptSchema = z.strictObject({
  schemaVersion: z.literal('1.0'), id: z.uuid(), gate: z.enum(Object.keys(RELEASE_GATES) as [ReleaseGate, ...ReleaseGate[]]),
  observedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), bindings: ReleaseBindingsSchema,
  scope: z.strictObject({ origin: z.enum(['actual', 'synthetic']), execution: z.enum(['local', 'live', 'not_applicable']),
    human: z.enum(['none', 'actual', 'synthetic']), independence: z.enum(['same_host', 'independent_machine', 'not_applicable']) }),
  outcome: z.enum(['pass', 'fail', 'not_run']), assertions: z.array(z.string().regex(/^[a-z][a-z0-9_]+$/)).max(20),
  evidence: z.array(ReleaseArtifactSchema).min(1).max(50),
  scannedArtifacts: z.array(ReleaseArtifactSchema).max(100).default([]),
  commands: z.array(z.strictObject({ argv: z.array(z.string().min(1).max(200)).min(1).max(20), exitCode: z.number().int(), output: ReleaseArtifactSchema })).max(20),
  receiptDigest: ReleaseDigestSchema,
});
export type ReleaseReceipt = z.infer<typeof ReleaseReceiptSchema>;
export type ReleaseReceiptStatus = 'pass' | 'missing' | 'invalid' | 'stale' | 'mismatched' | 'scope_mismatch' | 'synthetic_only' | 'untrusted' | 'failed';
export interface ReleaseGateResult { id: ReleaseGate; status: ReleaseReceiptStatus; receiptDigest: string | null; detail: string; }
export interface ReleaseReceiptInput {
  bindings: ReleaseBindings; receipts: unknown[];
  /** Digests accepted by trusted ingestion (e.g. direct local command capture or external evidence review).
   * This is not publication permission, nor authentication supplied by hashing the receipt itself. */
  trustedReceiptDigests: string[];
  readArtifact: (path: string) => Promise<Uint8Array>;
  now?: Date;
}

export async function validateReleaseReceipts(input: ReleaseReceiptInput) {
  if (input.receipts.length > 100) throw new Error('release_receipt_count_limit');
  const bindings = ReleaseBindingsSchema.parse(input.bindings);
  const now = input.now?.getTime() ?? Date.now();
  if (!Number.isFinite(now)) throw new Error('invalid_release_clock');
  const trusted = new Set(digests.parse(input.trustedReceiptDigests));
  const parsed = input.receipts.map(value => ReleaseReceiptSchema.safeParse(value));
  const malformedCount = parsed.filter(value => !value.success).length;
  const receipts = parsed.flatMap(value => value.success ? [value.data] : []);
  const duplicateIds = new Set(receipts.filter((r, i) => receipts.findIndex(other => other.id === r.id) !== i).map(r => r.id));
  const gates: ReleaseGateResult[] = [];
  for (const [id, policy] of Object.entries(RELEASE_GATES) as Array<[ReleaseGate, typeof RELEASE_GATES[ReleaseGate]]>) {
    const matches = receipts.filter(receipt => receipt.gate === id);
    const receipt = matches[0];
    const row = (status: ReleaseReceiptStatus, detail: string) => gates.push({ id, status, receiptDigest: receipt?.receiptDigest ?? null, detail });
    if (!receipt) { row('missing', 'No receipt supplied.'); continue; }
    if (matches.length !== 1 || duplicateIds.has(receipt.id)) { row('invalid', 'Ambiguous or duplicate receipt identity; select one explicit receipt per gate.'); continue; }
    const { receiptDigest, ...body } = receipt;
    if (digestJson(body) !== receiptDigest) { row('invalid', 'Receipt content digest mismatch.'); continue; }
    if (Date.parse(receipt.observedAt) > now || Date.parse(receipt.expiresAt) <= now || Date.parse(receipt.expiresAt) <= Date.parse(receipt.observedAt)) {
      row('stale', 'Receipt is expired, future-dated or has an invalid observation window.'); continue;
    }
    if (!bindings.bundleDigests.length || digestJson({ ...receipt.bindings, bundleDigests: [...receipt.bindings.bundleDigests].sort() }) !== digestJson({ ...bindings, bundleDigests: [...bindings.bundleDigests].sort() })) {
      row('mismatched', 'Source, runtime, protocol or selected bundle bindings changed.'); continue;
    }
    if (receipt.scope.origin === 'synthetic' || receipt.scope.human === 'synthetic') { row('synthetic_only', 'Synthetic plumbing evidence cannot fulfill an actual release gate.'); continue; }
    if (receipt.scope.execution !== policy.execution || (policy.human && receipt.scope.human !== 'actual') ||
        (policy.independent && receipt.scope.independence !== 'independent_machine') ||
        (policy.execution === 'live' && bindings.runtimeMode !== 'live') || (policy.frozen && !bindings.liveProtocolFrozen)) {
      row('scope_mismatch', 'Receipt scope does not establish the required execution, human, independence or protocol scope.'); continue;
    }
    if (receipt.outcome !== 'pass' || policy.assertions.some(assertion => !receipt.assertions.includes(assertion)) ||
        receipt.assertions.some(assertion => !(policy.assertions as readonly string[]).includes(assertion)) ||
        (id === 'release_secrets' && (!receipt.commands.length || !receipt.scannedArtifacts.length || receipt.commands.some(command => command.exitCode !== 0)))) {
      row('failed', 'Required observations are not all recorded as passed.'); continue;
    }
    if (!trusted.has(receiptDigest)) { row('untrusted', 'Receipt has not been accepted by trusted evidence ingestion.'); continue; }
    try {
      const refs = [...receipt.evidence, ...receipt.scannedArtifacts, ...receipt.commands.map(command => command.output)];
      const seen = new Map<string, string>();
      for (const ref of refs) {
        if (seen.has(ref.path) && seen.get(ref.path) !== ref.digest) throw new Error('conflicting_artifact_digest');
        if (!seen.has(ref.path) && digestBytes(await input.readArtifact(ref.path)) !== ref.digest) throw new Error('artifact_digest_mismatch');
        seen.set(ref.path, ref.digest);
      }
    } catch { row('invalid', 'Referenced evidence is missing, inaccessible or has changed bytes.'); continue; }
    row('pass', 'Accepted actual-scope receipt and referenced bytes match these bindings; claims remain attestations.');
  }
  return { status: malformedCount === 0 && gates.every(gate => gate.status === 'pass') ? 'complete' as const : 'blocked' as const,
    bindings, gates, malformedCount, authenticityVerified: false as const, publicationAuthorized: false as const,
    notice: 'Digests establish content consistency, not the truth, independence or authorship of observations. Publication and entry are separate owner actions.' };
}
