import { validateEditRegion } from './edit-region.ts';
import { ContractError } from '../../contracts/src/index.ts';
import type { CandidateProposal, CandidateRecord, CheckResult, Fixture, RepairInput, SandboxCheckResult } from '../../contracts/src/product.ts';
import { cloneJsonData } from '../../contracts/src/json-data.ts';
import { ProposalSchema } from '../../contracts/src/product-validation.ts';
import { validatePaths } from './fixtures.ts';
import { createPatch } from './patch.ts';
import { FLAKY_CHECK_MESSAGE } from './repeated-checks.ts';

export const LOCAL_REPAIR_POLICY = Object.freeze({ id: 'local-three-proposals-v1', maximumRevisions: 3, maximumBranches: 3,
  patchproofParents: 'original' as const, baselineApproval: 'all-declared' as const });
export const EXPERIMENT_REPAIR_POLICY = Object.freeze({ id: 'experiment-progressive-branches-v1', maximumRevisions: 24, maximumBranches: 3,
  patchproofParents: 'round-robin-progressive' as const, baselineApproval: 'visible' as const,
  initialSourceChecks: false, runtimeFeedbackRounds: 24, repetitionsPerCheck: 2,
  calibrated: false, finalOracleFeedbackRounds: 0, selectionTieBreak: 'earliest-revision' });
type Policy = typeof LOCAL_REPAIR_POLICY | typeof EXPERIMENT_REPAIR_POLICY;
type Variant = 'baseline' | 'checks_only' | 'patchproof';
export interface RevisionContext {
  attempt: number; branchId: number; parentId: number | null; files: Record<string, string>;
  feedback: CheckResult[]; feedbackOrigin: string; sourceOrigin: 'original source' | 'supplied current source';
}
export interface CheckedRevision { result: SandboxCheckResult; visible: CheckResult[]; acceptance: CheckResult[]; }
export class RevisionCheckError extends ContractError {
  readonly checkCode: string;
  constructor(code: string) { super('infrastructure_error', 'Declared checker infrastructure failure.'); this.checkCode = code; }
}
export const allChecksPass = (checks: CheckResult[]) => checks.length > 0 && checks.every(check => check.status === 'pass');

export const REPAIR_FEEDBACK_FORMAT = Object.freeze({ id: 'visible-outcome-feedback-v1',
  maximumMessageBytes: 4096, maximumDiagnosticBytes: 1536, maximumOriginBytes: 256 });

function boundedFeedbackText(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return value;
  const suffix = ' [truncated]';
  let result = '', bytes = Buffer.byteLength(suffix, 'utf8');
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maximumBytes) break;
    result += character; bytes += size;
  }
  return result + suffix;
}

function diagnosticJson(value: unknown): string {
  try {
    // Reject accessors, proxies, cycles and toJSON functions without invoking
    // them. Checker output is data, never executable serialization behavior.
    const serialized = JSON.stringify(cloneJsonData(value));
    return Buffer.byteLength(serialized, 'utf8') <= REPAIR_FEEDBACK_FORMAT.maximumDiagnosticBytes ? serialized :
      '{"omitted":"diagnostic byte limit"}';
  } catch { return '{"unavailable":"invalid JSON data"}'; }
}

function feedbackMessage(fixture: Fixture, context: RevisionContext, check: CheckResult): string {
  const origin = boundedFeedbackText(context.feedbackOrigin, REPAIR_FEEDBACK_FORMAT.maximumOriginBytes);
  const source = boundedFeedbackText(context.sourceOrigin, REPAIR_FEEDBACK_FORMAT.maximumOriginBytes);
  const prefix = `${REPAIR_FEEDBACK_FORMAT.id}: Observed ${origin}; next proposal starts from ${source}.`;
  const visible = fixture.visibleCases.filter(c => c.id === check.id && c.requirementId === check.requirementId);
  // Unknown, mismatched or ambiguous identities stay opaque. Neither raw logs
  // nor checker messages/expected values can expose protected check content.
  if (visible.length !== 1) return `${prefix} Declared requirement check: ${check.status}.`;
  const c = visible[0]!;
  const outcome = c.expectedException !== undefined ? { exception: c.expectedException } : c.expected;
  const expected = c.assertArgsUnchanged ? { outcome, argsAfter: c.args, kwargsAfter: c.kwargs } : outcome;
  return boundedFeedbackText(`${prefix} Visible case ${diagnosticJson(c.id)}: ` +
    `actual=${diagnosticJson(check.actual)}; expected=${diagnosticJson(expected)}.`, REPAIR_FEEDBACK_FORMAT.maximumMessageBytes);
}

export function repairInput(fixture: Fixture, context: RevisionContext, remaining: RepairInput['remaining']): RepairInput {
  return { taskId: fixture.id, description: fixture.description, requirements: structuredClone(fixture.requirements),
    files: structuredClone(context.files), editAllowlist: [...fixture.editAllowlist], visibleCases: structuredClone(fixture.visibleCases),
    feedback: context.feedback.map(check => ({ requirementId: check.requirementId, status: check.status,
      message: feedbackMessage(fixture, context, check) })),
    ...(fixture.editRegion ? { editRegion: structuredClone(fixture.editRegion) } : {}),
    attempt: context.attempt, remaining: { ...remaining } };
}

/** Shared serial loop only. Caller owns deadlines, grants, durable observations and evidence publication. */
export async function runRevisionLoop(options: {
  fixture: Fixture; variant: Variant; policy: Policy; maximumRevisions: number; signal: AbortSignal;
  initialFeedback: CheckResult[]; revisions: CandidateRecord[];
  propose: (context: RevisionContext) => Promise<CandidateProposal>;
  onProposed: (candidate: CandidateRecord, context: RevisionContext) => void;
  check: (candidate: CandidateRecord) => Promise<CheckedRevision>;
  onChecked: (candidate: CandidateRecord, context: RevisionContext) => void;
  validateChecked?: () => void;
  onSelection: (candidateId: number) => void;
}) {
  const fixture = structuredClone(options.fixture), heads = new Map<number, CandidateRecord>();
  const progressive = options.policy.patchproofParents === 'round-robin-progressive';
  if (!Number.isSafeInteger(options.maximumRevisions) || options.maximumRevisions < 1 || options.maximumRevisions > options.policy.maximumRevisions || options.revisions.length) {
    throw new ContractError('invalid_request', 'Invalid bounded revision-loop initialization.');
  }
  let selected: CandidateRecord | null = null;
  for (let attempt = 0; attempt < options.maximumRevisions; attempt++) {
    options.signal.throwIfAborted();
    const started = Date.now(), branching = options.variant === 'patchproof';
    const branchId = branching ? (progressive ? attempt % options.policy.maximumBranches : attempt) : 0;
    const parent = heads.get(branchId);
    const prior = options.revisions.at(-1);
    const feedbackRecord = branching && !progressive ? prior : parent;
    const base = parent?.files ?? fixture.files;
    const context: RevisionContext = { attempt, branchId, parentId: parent?.id ?? null, files: structuredClone(base),
      feedback: structuredClone(feedbackRecord ? options.variant === 'baseline' ? feedbackRecord.visibleChecks : [...feedbackRecord.visibleChecks, ...feedbackRecord.acceptanceChecks] : options.initialFeedback),
      feedbackOrigin: feedbackRecord ? `on candidate ${feedbackRecord.id}` : 'on original source',
      sourceOrigin: branching && !progressive ? 'original source' : 'supplied current source' };
    const proposal = ProposalSchema.parse(await options.propose(structuredClone(context)));
    validatePaths(proposal.files, fixture.editAllowlist);
    const candidate: CandidateRecord = { id: attempt + 1, parentId: context.parentId, summary: proposal.summary.slice(0, 2000),
      files: { ...base, ...proposal.files }, diff: '', visibleChecks: [], acceptanceChecks: [], accepted: false, rejectionReason: null,
      modelId: proposal.modelId, providerRequestId: proposal.providerRequestId, sandboxOperationIds: [], elapsedMs: 0, usage: proposal.usage };
    validateEditRegion(fixture, candidate.files);
    candidate.diff = createPatch(fixture.files, candidate.files);
    options.revisions.push(candidate); options.onProposed(candidate, context);
    const checked = await options.check(candidate);
    candidate.visibleChecks = checked.visible; candidate.acceptanceChecks = checked.acceptance;
    candidate.sandboxOperationIds = checked.result.operationIds;
    candidate.elapsedMs = Date.now() - started;
    // Preserve completed observations and lifecycle logs before an authorization
    // gate can stop the run. A failed gate never reaches acceptance or selection.
    try { options.validateChecked?.(); }
    catch (error) {
      candidate.rejectionReason = error instanceof ContractError ? error.code : 'check_authorization_failed';
      options.onChecked(candidate, context);
      throw error;
    }
    if (checked.result.infrastructureError) {
      candidate.rejectionReason = checked.result.infrastructureError; options.onChecked(candidate, context);
      throw new RevisionCheckError(checked.result.infrastructureError);
    }
    const approval = options.variant === 'baseline' && options.policy.baselineApproval === 'visible' ? checked.visible : [...checked.visible, ...checked.acceptance];
    candidate.accepted = allChecksPass(approval) && (options.policy.id !== EXPERIMENT_REPAIR_POLICY.id || options.variant === 'baseline' ||
      fixture.requirements.every(requirement => approval.some(check => check.requirementId === requirement.id)));
    candidate.rejectionReason = candidate.accepted ? null : 'One or more declared checks failed or were unavailable.';
    if (checked.result.checks.some(check => check.message === FLAKY_CHECK_MESSAGE)) {
      candidate.rejectionReason = 'flaky_check'; options.onChecked(candidate, context);
      throw new ContractError('flaky_check', 'Candidate observations are inconsistent; no further repair feedback.');
    }
    const score = (value: CandidateRecord) => [...value.visibleChecks, ...value.acceptanceChecks].filter(check => check.status === 'pass').length;
    if (!branching || selected === null || score(candidate) > score(selected)) selected = candidate;
    heads.set(branchId, candidate); options.onChecked(candidate, context); options.onSelection(selected!.id);
    if (options.variant === 'baseline' ? allChecksPass(checked.visible) : candidate.accepted) break;
  }
  return { selectedCandidate: selected, revisionCount: options.revisions.length };
}
