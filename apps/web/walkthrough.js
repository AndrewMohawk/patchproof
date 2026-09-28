import { renderDiff } from './diff-view.js';

// Guided readings of pinned, saved real runs. Viewing a story never creates a run.
export const storyRecords = {
  success: {
    id: '08087e0a-f5d9-4c55-b4b6-7666bc8e016c', taskId: 'stable-unique-01', digest: 'sha256:c2ba45e30a1526e446d5a47c7d194c65523cec18e902335f5dfa672b868bff08', checkId: 'u-v-order',
    bugTitle: 'Separated duplicates survive the original filter.',
    scenario: 'A list-maintenance helper should retain the first occurrence of each item, in order. Its refactor compares only neighboring values, so a repeated item can survive.',
    goal: 'Remove repeated items while preserving their first-occurrence order, the caller’s original data, and the existing error behavior.',
    patchTitle: 'The proposal checks every item already retained.',
    changeDescription: 'The proposed condition checks membership in the whole result instead of comparing only its last item. Review the exact lines below, then inspect what happened when the checks ran.',
    codeFunctions: ['unique'],
  },
  failure: {
    id: '5b356c42-8848-4e78-bce7-94800f63eebf', taskId: 'v2-r03-t02', digest: 'sha256:5a9c00d2629636f2963c63efa49ef0236876b98ac3ba7a670b684abd32e12ff8', checkId: 'v-r01-null-is-data',
    bugTitle: 'Existing empty worksheet cells must survive a transpose.',
    scenario: 'This worksheet helper swaps rows and columns, padding missing cells when the rows have different lengths. An existing null cell is data; it must not be replaced by the padding value.',
    goal: 'Transpose uneven rows while preserving existing cell values. Use the filler only for a missing position and leave the original worksheet unchanged.',
    patchTitle: 'This proposal still confuses a null cell with a missing cell.',
    changeDescription: 'Review the retained proposal as a complete repair attempt. Its recorded output still replaces an existing null cell with the filler value, so a partial pass does not make it an accepted repair.',
  },
};
const rows = value => Array.isArray(value) ? value : [];
const has = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
function observed(check, definition) {
  if (!check || !['pass', 'fail'].includes(check.status) || !has(check, 'actual')) return { available: false };
  if (definition.assertArgsUnchanged === true) return has(check.actual, 'outcome')
    ? { available: true, value: check.actual.outcome } : { available: false };
  return { available: true, value: check.actual };
}
export function projectStory(bundle) {
  const entry = Object.entries(storyRecords).find(([, item]) => item.id === bundle?.run?.id);
  if (!entry) return null;
  const [kind, record] = entry, run = bundle.run, fixture = bundle.fixture;
  if (bundle.bundleDigest !== record.digest || bundle.mode !== 'live' || run.mode !== 'live' ||
      fixture?.id !== record.taskId || run.taskId !== record.taskId || run.phase !== 'terminal') return null;
  const candidate = rows(run.candidates).find(item => item.id === run.selectedCandidateId);
  const definitions = [...rows(fixture.visibleCases), ...rows(fixture.acceptanceCases)];
  const definition = definitions.find(item => item.id === record.checkId);
  const baselineChecks = [...rows(run.baselineChecks?.visible), ...rows(run.baselineChecks?.acceptance)];
  const checks = [...rows(candidate?.visibleChecks), ...rows(candidate?.acceptanceChecks)];
  const beforeCheck = baselineChecks.find(item => item.id === record.checkId), afterCheck = checks.find(item => item.id === record.checkId);
  if (!candidate || !definition || !Array.isArray(definition.args) || typeof definition.function !== 'string' ||
      !rows(fixture.requirements).length || typeof fixture.files?.[fixture.entrypoint] !== 'string' ||
      typeof candidate.files?.[fixture.entrypoint] !== 'string' ||
      !(has(definition, 'expected') || typeof definition.expectedException === 'string')) return null;
  const before = observed(beforeCheck, definition), after = observed(afterCheck, definition);
  if (!before.available || !after.available) return null;
  // Presentation labels cannot turn a failed run into a fixed example, or vice versa.
  const accepted = candidate.accepted === true && run.terminalStatus === 'verified_for_declared_checks';
  if ((kind === 'success') !== accepted || (kind === 'success' && checks.some(check => check.status !== 'pass')) ||
      (kind === 'failure' && rows(run.candidates).some(item => item.accepted === true))) return null;
  return structuredClone({
    kind, metadata: record, runId: run.id, taskId: record.taskId, title: fixture.title, description: fixture.description,
    input: definition.args[0], args: definition.args, kwargs: definition.kwargs ?? {}, function: definition.function,
    expected: has(definition, 'expected') ? definition.expected : { exception: definition.expectedException },
    before: before.value, after: after.value, beforeCheck, afterCheck, definition, definitions,
    entrypoint: fixture.entrypoint, files: fixture.files, candidateFiles: candidate.files,
    beforeSource: fixture.files[fixture.entrypoint], afterSource: candidate.files[fixture.entrypoint],
    diff: candidate.diff ?? '', modelSummary: candidate.summary ?? '', requirements: fixture.requirements,
    checks, baselineChecks, accepted, terminalStatus: run.terminalStatus, reason: run.reason, usage: run.usage,
    attempts: rows(run.candidates).map(item => ({ id: item.id, accepted: item.accepted === true,
      retained: item.id === run.selectedCandidateId, rejectionReason: item.rejectionReason ?? null,
      checks: [...rows(item.visibleChecks), ...rows(item.acceptanceChecks)] })),
    execution: bundle.runtimeLock?.execution ?? null,
    checkId: record.checkId, candidateId: candidate.id, bundleDigest: record.digest,
  });
}
function node(tag, className, text) {
  const result = document.createElement(tag); if (className) result.className = className;
  if (text !== undefined) result.textContent = String(text); return result;
}
function add(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function anchor(text, href, style = 'button') { const a = node('a', style, text); a.href = href; return a; }
function format(value) { const compact = JSON.stringify(value); return compact?.length <= 85 ? compact : JSON.stringify(value, null, 2); }
function value(label, data, style = '') { return add(node('div', `value-card ${style}`), node('h3', '', label), node('pre', '', format(data))); }
function section(title, text) { return add(node('div', 'story-explanation'), node('h3', '', title), node('p', '', text)); }
function details(title, ...children) { return add(node('details', 'disclosure'), node('summary', '', title), ...children); }
function passing(checks) { return checks.filter(check => check.status === 'pass').length; }
function statusCounts(checks) { return { pass: passing(checks), fail: checks.filter(check => check.status === 'fail').length, error: checks.filter(check => check.status === 'error').length, total: checks.length }; }
function inputCard(data) {
  const entries = {};
  data.args.forEach((argument, index) => { entries[data.metadata.inputLabels?.[index] ?? `Argument ${index + 1}`] = argument; });
  for (const [key, argument] of Object.entries(data.kwargs)) entries[`${key} (keyword)`] = argument;
  return value(`Input to ${data.function}()`, entries);
}
function sourceExcerpt(data) {
  const lines = data.beforeSource.split('\n'); if (lines.at(-1) === '') lines.pop();
  const names = data.metadata.codeFunctions ?? [data.function];
  let start = lines.findIndex(line => names.some(name => line.startsWith(`def ${name}(`)));
  if (start < 0) start = 0;
  let end = Math.min(lines.length, start + 18);
  for (let index = start + 1; index < end; index++) if (/^def /.test(lines[index])) { end = index; break; }
  const excerpt = lines.slice(start, end).map((line, index) => `${String(start + index + 1).padStart(3)}  ${line}`).join('\n');
  return add(node('div', 'story-explanation'), node('h3', '', `Starting code · ${data.entrypoint}`),
    node('p', 'story-footnote', `Lines ${start + 1}–${end} of the original file. The full starting snapshot is available below.`),
    node('pre', 'story-source', excerpt),
    details('Open the full starting source', ...Object.entries(data.files).map(([path, source]) => add(node('div'), node('h3', '', path), node('pre', 'story-source', source)))));
}
function recordedCase(data) {
  return details('Exact check input and observations', node('pre', 'check-log', JSON.stringify({ checkId: data.checkId,
    requirementId: data.definition.requirementId, function: data.function, args: data.args, kwargs: data.kwargs,
    assertArgsUnchanged: data.definition.assertArgsUnchanged === true,
    before: { status: data.beforeCheck.status, expected: data.beforeCheck.expected, actual: data.beforeCheck.actual, message: data.beforeCheck.message },
    after: { status: data.afterCheck.status, expected: data.afterCheck.expected, actual: data.afterCheck.actual, message: data.afterCheck.message } }, null, 2)));
}
function requirementResults(data) {
  const list = node('div', 'story-requirements');
  for (const requirement of data.requirements) {
    const before = data.baselineChecks.filter(check => check.requirementId === requirement.id);
    const after = data.checks.filter(check => check.requirementId === requirement.id);
    const count = statusCounts(after);
    add(list, add(node('div'), node('h3', '', `${requirement.id} · ${data.metadata.requirementLabels?.[requirement.id] ?? requirement.text}`),
      node('p', count.pass === count.total && count.total > 0 ? '' : 'fail', `Before ${passing(before)}/${before.length} → after ${count.pass}/${count.total} passed${count.error ? ` · ${count.error} ${count.error === 1 ? 'error' : 'errors'}` : ''}`)));
  }
  return list;
}
function attemptHistory(data) {
  const table = node('table', 'story-attempts');
  const head = node('tr'); for (const label of ['Attempt', 'Recorded checks', 'Decision']) { const th = node('th', '', label); th.scope = 'col'; head.append(th); }
  table.append(add(node('thead'), head)); const body = node('tbody');
  for (const attempt of data.attempts) {
    const count = statusCounts(attempt.checks);
    add(body, add(node('tr'), node('td', '', `${attempt.id}${attempt.retained ? ' · retained' : ''}`),
      node('td', '', `${count.pass}/${count.total} passed${count.fail ? ` · ${count.fail} failed` : ''}${count.error ? ` · ${count.error} ${count.error === 1 ? 'error' : 'errors'}` : ''}`),
      add(node('td'), node('strong', '', attempt.accepted ? 'Checks passed' : 'Not accepted'),
        attempt.rejectionReason && node('p', 'fine-print', attempt.rejectionReason.replaceAll('_', ' ')))));
  }
  table.append(body); return table;
}
export function renderStory(container, state, requestedStep = 'bug') {
  const normalized = requestedStep === 'failure' ? 'failed-bug' : requestedStep;
  const kind = normalized?.startsWith('failed-') ? 'failure' : 'success';
  const stage = (kind === 'failure' ? normalized.slice(7) : normalized) || 'bug';
  const step = ['bug', 'patch', 'checks', 'decision'].includes(stage) ? stage : 'bug';
  const route = next => `#story/${kind === 'failure' ? 'failed-' : ''}${next}`;
  const record = storyRecords[kind], run = state.runs.get(record.id), context = run && state.contexts.get(record.id);
  const cases = node('nav', 'story-cases'); cases.setAttribute('aria-label', 'Recorded examples');
  for (const [name, label, href] of [['success', 'Fixed repair', '#story/bug'], ['failure', 'Failed repair', '#story/failed-bug']]) {
    const a = anchor(label, href, 'story-case'); if (kind === name) a.setAttribute('aria-current', 'true'); cases.append(a);
  }
  const tabs = node('nav', 'story-steps'); tabs.setAttribute('aria-label', 'Walkthrough steps');
  for (const [id, label] of [['bug', '1. The bug & goal'], ['patch', '2. AI patch'], ['checks', '3. Check results'], ['decision', '4. Your decision']]) {
    const a = anchor(label, route(id), 'story-step'); if (id === step) a.setAttribute('aria-current', 'step'); tabs.append(a);
  }
  const card = node('article', 'story-card');
  const projected = context?.status === 'ready' && context.story;
  const data = projected?.runId === record.id && projected.bundleDigest === record.digest && projected.taskId === record.taskId && projected.kind === kind ? projected : null;
  container.dataset.state = data ? 'ready' : !state.ready || context?.status === 'loading' ? 'loading' : 'unavailable';
  if (!data) {
    const loading = !state.ready || context?.status === 'loading';
    add(card, node('h2', 'story-heading', loading ? 'Loading the recorded example…' : 'This recorded example is unavailable here.'),
      node('p', '', loading ? 'Reading its saved source, patch and check results.' : 'The walkthrough needs its original real-run evidence. This workspace has not supplied it; no example results have been substituted.'), anchor('Browse repair tasks', '#tasks'));
    container.replaceChildren(cases, tabs, card); return;
  }
  const count = statusCounts(data.checks), original = statusCounts(data.baselineChecks);
  add(card, node('p', 'story-meta', `${kind === 'success' ? 'Fixed repair' : 'Failed repair'} · Saved real run · No new model calls`));
  if (step === 'bug') {
    add(card, node('h2', 'story-heading', data.metadata.bugTitle ?? data.title), node('p', 'story-lead', data.metadata.scenario ?? data.description),
      section('The goal', data.metadata.goal ?? data.requirements.map(row => row.text).join(' ')),
      add(node('div', 'story-values'), inputCard(data), value('Starting code · observed output', data.before, data.beforeCheck.status === 'pass' ? 'good' : 'bad'), value('Required output', data.expected, 'good')),
      sourceExcerpt(data),
      add(node('div', 'story-actions'), anchor('See the AI patch', route('patch'), 'button primary'), anchor('Try a new repair', '#tasks', 'text-link')));
  } else if (step === 'patch') {
    add(card, node('h2', 'story-heading', data.metadata.patchTitle ?? `Review the proposal from attempt ${data.candidateId}.`),
      node('p', 'story-lead', data.metadata.changeDescription ?? 'The model proposed the following changes. Check the actual diff before deciding whether the proposal meets the maintenance request.'),
      data.diff ? renderDiff(data.diff, `Recorded proposal from attempt ${data.candidateId}`) : node('p', 'no-diff', 'This attempt did not change the source.'),
      details('Model summary', node('p', 'candidate-description', data.modelSummary || 'No model summary was recorded.'), node('p', 'fine-print', 'This explanation was written by the model. Recorded check results determine whether the proposal passed.')),
      add(node('div', 'story-values'), value('Starting code output', data.before, data.beforeCheck.status === 'pass' ? 'good' : 'bad'), value(`Attempt ${data.candidateId} · observed output`, data.after, data.afterCheck.status === 'pass' ? 'good' : 'bad')),
      add(node('div', 'story-actions'), anchor('See the check results', route('checks'), 'button primary'), anchor('Inspect the full run', `#evidence/${data.runId}`, 'text-link')));
  } else if (step === 'checks') {
    add(card, node('h2', 'story-heading', `${count.pass} of ${count.total} checks passed for this proposal.`),
      node('p', 'story-lead', `The starting code passed ${original.pass} of ${original.total}. The retained proposal was executed against the same declared checks. Each requirement below is tied to its recorded results.`),
      section(`One exact check · ${data.checkId}`, `${data.afterCheck.status === 'pass' ? 'Passed' : 'Failed'} for attempt ${data.candidateId}. ${data.afterCheck.message ?? ''}`),
      add(node('div', 'story-values'), inputCard(data), value('Required output', data.expected, 'good'), value('Proposal · observed output', data.after, data.afterCheck.status === 'pass' ? 'good' : 'bad')),
      data.definition.assertArgsUnchanged === true && node('p', 'story-footnote', 'This check also verifies that the caller’s arguments remain unchanged. The exact observations include both the return value and the arguments after execution.'),
      recordedCase(data), requirementResults(data),
      section('Why these checks matter', 'The model can change allowed source files. It cannot rewrite the check definitions or their expected results. A correct-looking return value is only one part of the maintenance contract.'),
      add(node('div', 'story-actions'), anchor('Make the review decision', route('decision'), 'button primary'), anchor('Inspect every check', `#evidence/${data.runId}`, 'text-link')));
  } else {
    add(card, node('h2', 'story-heading', data.accepted ? 'The listed checks pass. Review the patch before using it.' : 'The run did not produce an accepted repair.'),
      node('p', 'story-lead', data.accepted ? 'The selected proposal met the declared checks. Its source change and evidence are ready for a human review.' : `The retained proposal passed ${count.pass} of ${count.total} checks. The full attempt history remains available, including failures and execution errors.`),
      add(node('div', `story-verdict${data.accepted ? '' : ' bad'}`),
        node('h3', '', data.accepted ? 'Decision supported: review this patch for use.' : 'Decision supported: do not use this as a completed fix.'),
        node('p', '', data.accepted ? 'These results support the stated requirements for the inputs checked. They do not establish correctness for every possible input. Nothing is merged automatically.' : `No candidate was accepted for this run. ${count.fail ? `${count.fail} check${count.fail === 1 ? '' : 's'} still failed in the retained attempt. ` : ''}${count.error ? `${count.error} check${count.error === 1 ? '' : 's'} could not execute normally. ` : ''}A partial pass is not a completed repair.`)),
      section('Every attempt stays in the record', `This run made ${data.usage?.inferenceCalls ?? 'an unrecorded number of'} model ${data.usage?.inferenceCalls === 1 ? 'request' : 'requests'} and recorded ${data.attempts.length} patch ${data.attempts.length === 1 ? 'attempt' : 'attempts'}${Number.isFinite(data.usage?.elapsedMs) ? ` over ${(data.usage.elapsedMs / 1000).toFixed(1)} seconds` : ''}. Retained means the attempt kept for inspection; its check results determine whether it passed.`),
      attemptHistory(data),
      section('Take the evidence with you', 'Open the complete run to inspect every changed line and check. Download its source snapshot, proposals, recorded outputs, logs, identifiers, and accounting. Run details includes instructions for a separate fresh replay of the checks.'),
      add(node('div', 'story-actions'),
        data.accepted ? anchor('Follow the failed repair', '#story/failed-bug', 'button primary') : anchor('Inspect the failed repair', `#evidence/${data.runId}`, 'button primary'),
        anchor(data.accepted ? 'Inspect patch and checks' : 'Try a new repair', data.accepted ? `#evidence/${data.runId}` : '#tasks'),
        anchor('Download this run’s evidence', `/runs/${data.runId}/evidence`, 'text-link')));
  }
  const runtime = data.execution?.modelProvider === 'nebius-token-factory' ? 'NVIDIA inference through Nebius Token Factory.' : 'Model and provider identifiers are preserved in the run details.';
  const backend = data.execution?.checkBackend === 'local_container' ? ' Checks executed in isolated local Docker containers.' : ' The recorded run identifies its check runtime.';
  const footer = node('p', 'story-footnote', `${runtime}${backend} These curated examples explain the workflow; they do not establish a benchmark advantage.`);
  container.replaceChildren(cases, tabs, card, footer);
}
