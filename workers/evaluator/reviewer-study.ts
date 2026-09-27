import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DigestSchema } from '../../packages/contracts/src/index.ts';

const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const Answer = z.enum(['accept', 'reject', 'needs_review']);
const Condition = z.enum(['patch_only', 'patch_with_evidence']);
const Text = z.string().min(1).max(100_000);
const ContentSchema = z.strictObject({
  taskStatement: Text,
  requirements: z.array(z.strictObject({ id: Id, text: Text })).min(1).max(100),
  patch: Text, sourceContext: Text.optional(),
});
const ObservationSchema = z.strictObject({ requirementId: Id, checkDescription: Text, expected: Text, observed: Text });
export const StudyItemSchema = z.strictObject({
  id: Id, sourceArtifactDigest: DigestSchema, sourceVisibility: z.literal('public_curated'),
  content: ContentSchema, observations: z.array(ObservationSchema).min(1).max(200),
  answer: Answer, answerRationale: Text, answerSource: Text,
  packetWordingReviewedForLabels: z.literal(true),
});
const ProtocolSchema = z.strictObject({
  version: z.literal('reviewer-study-v1'),
  assignment: z.literal('balanced_participant_task_crossing'),
  primaryAccuracyDenominator: z.literal('all_planned_assignments'),
  timer: z.literal('trusted_recorder_wall_time'),
  reporting: z.literal('descriptive_only'),
  maxAssignmentMs: z.number().int().min(1000).max(3_600_000),
});
const AssignmentSchema = z.strictObject({
  id: Id, participantId: Id, itemId: Id, condition: Condition, presentationIndex: z.number().int().nonnegative(),
});
const PlanBodySchema = z.strictObject({
  schemaVersion: z.literal('1.0'), studyId: Id, createdAt: z.iso.datetime(),
  recordingMode: z.enum(['synthetic', 'human']), sourceMode: z.enum(['local_mock', 'live_recorded']),
  randomizationSeed: z.number().int().nonnegative().max(2 ** 32 - 1),
  protocol: ProtocolSchema,
  participantIds: z.array(Id).min(2).max(200),
  items: z.array(StudyItemSchema).min(2).max(100),
  assignments: z.array(AssignmentSchema).min(4).max(20_000),
});
export const ReviewerStudyPlanSchema = PlanBodySchema.extend({ planDigest: DigestSchema }).strict();
export type ReviewerStudyPlan = z.infer<typeof ReviewerStudyPlanSchema>;
export type StudyItem = z.infer<typeof StudyItemSchema>;
export const StudyActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: Id, participantId: Id, assignmentId: Id, kind: z.literal('opened') }),
  z.strictObject({ id: Id, participantId: Id, assignmentId: Id, kind: z.literal('submitted'), answer: Answer }),
  z.strictObject({ id: Id, participantId: Id, assignmentId: Id, kind: z.literal('skipped'), reason: z.enum(['declined', 'timeout', 'technical_issue']) }),
]);
const EventEnvelopeSchema = z.strictObject({
  studyId: Id, planDigest: DigestSchema, recordedAt: z.iso.datetime(),
  previousEventDigest: DigestSchema.nullable(), eventDigest: DigestSchema,
  action: StudyActionSchema,
});
export type StudyAction = z.infer<typeof StudyActionSchema>;
export type StudyEvent = z.infer<typeof EventEnvelopeSchema>;
const hash = (value: unknown) => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique = (values: unknown[]) => new Set(values).size === values.length;
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled<T>(values: T[], rng: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j]!, result[i]!]; }
  return result;
}

/** Private plan includes the answer key. Never deliver this object to a reviewer. */
export function createReviewerStudy(options: {
  studyId: string; participantIds: string[]; items: StudyItem[]; randomizationSeed: number;
  recordingMode: 'synthetic' | 'human'; sourceMode: 'local_mock' | 'live_recorded';
  createdAt?: string; maxAssignmentMs?: number;
}): ReviewerStudyPlan {
  const seed = z.number().int().nonnegative().max(2 ** 32 - 1).parse(options.randomizationSeed);
  if (options.participantIds.length % 2 || options.items.length % 2) throw new Error('Balanced v1 design requires even participant and item counts.');
  if (!unique(options.participantIds) || !unique(options.items.map(x => x.id))) throw new Error('Duplicate participant or item.');
  const rng = random(seed), participants = shuffled(options.participantIds, rng), items = shuffled(options.items, rng);
  const assignments = participants.flatMap((participantId, pi) => shuffled(items.map((item, ti) => ({
    id: 'a_' + hash([options.studyId, participantId, item.id, seed]).slice(7, 39), participantId, itemId: item.id,
    condition: (pi + ti) % 2 ? 'patch_only' as const : 'patch_with_evidence' as const,
  })), rng).map((assignment, presentationIndex) => ({ ...assignment, presentationIndex })));
  const body = PlanBodySchema.parse({ schemaVersion: '1.0', studyId: options.studyId,
    createdAt: options.createdAt ?? new Date().toISOString(), recordingMode: options.recordingMode, sourceMode: options.sourceMode,
    randomizationSeed: seed, participantIds: [...options.participantIds], items: options.items, assignments,
    protocol: { version: 'reviewer-study-v1', assignment: 'balanced_participant_task_crossing',
      primaryAccuracyDenominator: 'all_planned_assignments', timer: 'trusted_recorder_wall_time', reporting: 'descriptive_only',
      maxAssignmentMs: options.maxAssignmentMs ?? 600_000 },
  });
  return validateReviewerStudy({ ...body, planDigest: hash(body) });
}

export function validateReviewerStudy(value: unknown): ReviewerStudyPlan {
  const parsed = ReviewerStudyPlanSchema.parse(value), { planDigest, ...body } = parsed;
  if (hash(body) !== planDigest) throw new Error('Study plan digest mismatch.');
  if (parsed.participantIds.length % 2 || parsed.items.length % 2 || !unique(parsed.participantIds) ||
      !unique(parsed.items.map(x => x.id)) || !unique(parsed.assignments.map(x => x.id))) throw new Error('Unbalanced or duplicate study identities.');
  if (parsed.assignments.length !== parsed.participantIds.length * parsed.items.length) throw new Error('Incomplete assignment grid.');
  for (const item of parsed.items) {
    if (!unique(item.content.requirements.map(r => r.id)) || item.observations.some(o => !item.content.requirements.some(r => r.id === o.requirementId))) throw new Error('Unknown or duplicate requirement mapping.');
    const rows = parsed.assignments.filter(a => a.itemId === item.id);
    if (rows.length !== parsed.participantIds.length || rows.filter(a => a.condition === 'patch_only').length !== rows.length / 2) throw new Error('Item is not balanced across conditions.');
  }
  for (const participant of parsed.participantIds) {
    const rows = parsed.assignments.filter(a => a.participantId === participant);
    if (rows.length !== parsed.items.length || !unique(rows.map(a => a.itemId)) || !unique(rows.map(a => a.presentationIndex)) ||
        rows.some(a => !parsed.items.some(i => i.id === a.itemId) || a.presentationIndex >= rows.length) ||
        rows.filter(a => a.condition === 'patch_only').length !== rows.length / 2) throw new Error('Participant assignments are incomplete or unbalanced.');
  }
  return parsed;
}

/** Strict projection: answer, condition, source run identity, outcome and model/variant labels stay private. */
export function reviewerPacket(planValue: unknown, eventValues: unknown[], participantId: string) {
  const plan = validateReviewerStudy(planValue);
  const { states } = validateEvents(plan, eventValues);
  if (!plan.participantIds.includes(participantId)) throw new Error('Unknown participant.');
  const active = plan.assignments.find(a => a.participantId === participantId && states.has(a.id) && !states.get(a.id)?.terminal);
  if (!active) throw new Error('Record an open event before releasing exactly one assignment packet.');
  return { schemaVersion: '1.0', studyId: plan.studyId, participantId,
    sourceNotice: plan.sourceMode === 'local_mock' ? 'Scripted proposal artifacts with local checks; this exercise measures review behavior only.' : 'Previously recorded proposal artifacts; this exercise measures review behavior only.',
    notice: plan.recordingMode === 'synthetic' ? 'Development exercise; synthetic responses are not human evidence.' : 'Research exercise; no code will be merged.',
    instruction: 'Decide whether the patch satisfies every stated requirement. Choose needs_review when the supplied information cannot support a decision.',
    allowedAnswers: ['accept', 'reject', 'needs_review'],
    tasks: [active].map(assignment => {
      const item = plan.items.find(i => i.id === assignment.itemId)!;
      return { assignmentId: assignment.id, presentationIndex: assignment.presentationIndex,
        ...structuredClone(item.content),
        ...(assignment.condition === 'patch_with_evidence' ? { observations: structuredClone(item.observations) } : {}),
      };
    }),
  };
}

type AssignmentState = { openedAt: number; terminal: StudyAction & { kind: 'submitted' | 'skipped' }; finishedAt: number } | { openedAt: number; terminal?: undefined };
function validateEvents(plan: ReviewerStudyPlan, values: unknown[]) {
  const events = values.map(v => EventEnvelopeSchema.parse(v));
  const states = new Map<string, AssignmentState>(), ids = new Set<string>();
  let previous: string | null = null, priorTime = Date.parse(plan.createdAt);
  for (const event of events) {
    const { eventDigest, ...body } = event;
    if (event.studyId !== plan.studyId || event.planDigest !== plan.planDigest || event.previousEventDigest !== previous || hash(body) !== eventDigest || ids.has(event.action.id)) throw new Error('Invalid event identity, chain or digest.');
    const at = Date.parse(event.recordedAt), action = event.action;
    if (at < priorTime) throw new Error('Recorder clock moved backward.');
    const assignment = plan.assignments.find(a => a.id === action.assignmentId && a.participantId === action.participantId);
    if (!assignment) throw new Error('Event has no planned participant assignment.');
    const state = states.get(assignment.id);
    if (action.kind === 'opened') {
      const next = plan.assignments.filter(a => a.participantId === action.participantId).sort((a,b) => a.presentationIndex - b.presentationIndex).find(a => !states.get(a.id)?.terminal);
      if (state || next?.id !== assignment.id) throw new Error('Assignment must open once in the frozen presentation order.');
      states.set(assignment.id, { openedAt: at });
    } else {
      if (!state || state.terminal) throw new Error('Submission/skip requires one open, unfinished assignment.');
      if (action.kind === 'submitted' && at - state.openedAt > plan.protocol.maxAssignmentMs) throw new Error('Assignment time allowance expired; retain a timeout skip or leave it missing.');
      if (action.kind === 'skipped' && action.reason === 'timeout' && at - state.openedAt < plan.protocol.maxAssignmentMs) throw new Error('Timeout cannot precede the frozen time allowance.');
      states.set(assignment.id, { openedAt: state.openedAt, terminal: action, finishedAt: at });
    }
    ids.add(action.id); previous = eventDigest; priorTime = at;
  }
  return { events, states };
}

/** Timestamp belongs to the trusted recorder; action input cannot supply durations or correctness. */
export function recordStudyAction(planValue: unknown, priorValues: unknown[], actionValue: unknown, recordedAt = new Date().toISOString()): StudyEvent {
  const plan = validateReviewerStudy(planValue), action = StudyActionSchema.parse(actionValue);
  const { events } = validateEvents(plan, priorValues);
  const body = { studyId: plan.studyId, planDigest: plan.planDigest, recordedAt: z.iso.datetime().parse(recordedAt),
    previousEventDigest: events.at(-1)?.eventDigest ?? null, action };
  const event = { ...body, eventDigest: hash(body) };
  validateEvents(plan, [...events, event]);
  return event;
}
const average = (values: number[]) => values.length ? values.reduce((sum,x) => sum + x, 0) / values.length : null;
const median = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b), n = sorted.length; return n ? (sorted[Math.floor((n-1)/2)]! + sorted[Math.floor(n/2)]!) / 2 : null; };

export function reportReviewerStudy(planValue: unknown, values: unknown[]) {
  const plan = validateReviewerStudy(planValue), { events, states } = validateEvents(plan, values);
  const assignments = plan.assignments.map(assignment => {
    const state = states.get(assignment.id), item = plan.items.find(i => i.id === assignment.itemId)!;
    const submitted = state?.terminal?.kind === 'submitted' ? state.terminal : null;
    return { assignmentId: assignment.id, participantId: assignment.participantId, condition: assignment.condition,
      status: submitted ? 'submitted' : state?.terminal?.kind === 'skipped' ? 'skipped' : state ? 'opened_without_submission' : 'not_started',
      correct: submitted ? submitted.answer === item.answer : null,
      durationMs: submitted && state?.terminal ? state.finishedAt - state.openedAt : null,
      skipReason: state?.terminal?.kind === 'skipped' ? state.terminal.reason : null };
  });
  const summarize = (rows: typeof assignments) => {
    const complete = rows.filter(r => r.status === 'submitted'), correct = complete.filter(r => r.correct), durations = complete.map(r => r.durationMs!);
    return { planned: rows.length, submitted: complete.length, missing: rows.length - complete.length, skipped: rows.filter(r => r.status === 'skipped').length,
      accuracy: { numerator: correct.length, denominator: rows.length, fraction: rows.length ? correct.length / rows.length : null },
      completedAccuracy: { numerator: correct.length, denominator: complete.length, fraction: complete.length ? correct.length / complete.length : null },
      completedDurationMs: { count: durations.length, mean: average(durations), median: median(durations) },
      correctDurationMs: { count: correct.length, median: median(correct.map(r => r.durationMs!)) } };
  };
  const conditions = (['patch_only', 'patch_with_evidence'] as const).map(condition => ({ condition, ...summarize(assignments.filter(a => a.condition === condition)) }));
  const complete = assignments.every(a => a.status === 'submitted'), plain = conditions[0]!, evidence = conditions[1]!;
  return { schemaVersion: '1.0', studyId: plan.studyId, planDigest: plan.planDigest,
    evidenceStatus: !events.length ? 'planned_no_responses' : plan.recordingMode === 'synthetic' ? 'synthetic_only' : 'recorded_responses_declared_human',
    recordingMode: plan.recordingMode, sourceMode: plan.sourceMode, authenticityVerified: false, complete,
    eventCount: events.length, eventJournalDigest: hash(events), plannedAssignments: plan.assignments.length,
    participantsPlanned: plan.participantIds.length, participantsWithSubmissions: new Set(assignments.filter(a => a.status === 'submitted').map(a => a.participantId)).size,
    conditions, assignments,
    participants: plan.participantIds.map(participantId => ({ participantId, conditions: conditions.map(({ condition }) => ({ condition, ...summarize(assignments.filter(a => a.participantId === participantId && a.condition === condition)) })) })),
    descriptiveComparison: { provisional: !complete,
      accuracyDifference: evidence.accuracy.fraction! - plain.accuracy.fraction!,
      completedMeanTimeDifferenceMs: complete ? evidence.completedDurationMs.mean! - plain.completedDurationMs.mean! : null,
      timeComparisonSuppressed: !complete },
    limitations: ['Descriptive usability observations only; no power calculation, confidence interval or population-level time-saving claim.',
      'The same participants and items occur in both conditions; observations are not independent task samples.',
      'Missing, skipped and unfinished assignments remain in the primary accuracy denominator; completed-only times can be selected.',
      'Recorded wall time includes interruptions; it does not measure attention or establish participant identity.',
      'Condition labels and answer keys are omitted, but evidence visibility and patch content prevent guaranteed participant blinding.',
      plan.sourceMode === 'local_mock' ? 'Scripted source artifacts cannot support model-performance or sponsor-integration claims.' : 'Recorded source artifacts do not themselves authenticate this study or demonstrate generalization.'] };
}

export async function readStudyEvents(path: string): Promise<StudyEvent[]> {
  let content: string;
  try { content = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  if (content && !content.endsWith('\n')) throw new Error('Incomplete event journal tail; preserve it for operator review.');
  return content.split('\n').filter(Boolean).map(line => EventEnvelopeSchema.parse(JSON.parse(line)));
}
export async function appendStudyAction(planValue: unknown, journalPath: string, actionValue: unknown): Promise<StudyEvent> {
  const lockPath = journalPath + '.lock', lock = await open(lockPath, 'wx', 0o600);
  try {
    const event = recordStudyAction(planValue, await readStudyEvents(journalPath), actionValue);
    const journal = await open(journalPath, 'a', 0o600);
    try { await journal.writeFile(JSON.stringify(event) + '\n'); await journal.sync(); } finally { await journal.close(); }
    return event;
  } finally { await lock.close(); await unlink(lockPath); }
}
async function cli() {
  const [command, ...args] = process.argv.slice(2);
  const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
  const write = async (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (command === 'plan' && args.length === 2) await write(args[1]!, createReviewerStudy(await read(args[0]!)));
  else if ((command === 'open' || command === 'packet') && args.length === 4) {
    const plan = validateReviewerStudy(await read(args[0]!));
    if (command === 'open') {
      const { states } = validateEvents(plan, await readStudyEvents(args[1]!));
      const next = plan.assignments.filter(a => a.participantId === args[2]).sort((a,b) => a.presentationIndex - b.presentationIndex).find(a => !states.get(a.id)?.terminal);
      if (!next) throw new Error('No unfinished assignment for this participant.');
      await appendStudyAction(plan, args[1]!, { id: randomUUID(), kind: 'opened', participantId: args[2], assignmentId: next.id });
    }
    await write(args[3]!, reviewerPacket(plan, await readStudyEvents(args[1]!), args[2]!));
  }
  else if (command === 'event' && args.length === 3) { const event = await appendStudyAction(await read(args[0]!), args[1]!, await read(args[2]!)); console.log(JSON.stringify({ eventId: event.action.id, eventDigest: event.eventDigest })); }
  else if (command === 'report' && args.length === 3) await write(args[2]!, reportReviewerStudy(await read(args[0]!), await readStudyEvents(args[1]!)));
  else throw new Error('Usage: reviewer-study.ts plan INPUT PRIVATE_PLAN | open PRIVATE_PLAN JOURNAL PARTICIPANT PACKET | packet PRIVATE_PLAN JOURNAL PARTICIPANT PACKET | event PRIVATE_PLAN JOURNAL ACTION | report PRIVATE_PLAN JOURNAL OUTPUT');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await cli(); } catch (error) { console.error(error instanceof Error ? error.message : 'Study operation failed.'); process.exitCode = 2; }
}
