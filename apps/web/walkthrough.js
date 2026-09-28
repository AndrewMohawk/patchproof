// A guided reading of two existing real runs. No generation or simulated execution.
export const storyRecords = {
  success: { id: '08087e0a-f5d9-4c55-b4b6-7666bc8e016c', taskId: 'stable-unique-01', digest: 'sha256:c2ba45e30a1526e446d5a47c7d194c65523cec18e902335f5dfa672b868bff08', checkId: 'u-v-order' },
  failure: { id: '5b356c42-8848-4e78-bce7-94800f63eebf', taskId: 'v2-r03-t02', digest: 'sha256:5a9c00d2629636f2963c63efa49ef0236876b98ac3ba7a670b684abd32e12ff8', checkId: 'v-r01-null-is-data' },
};
export function projectStory(bundle) {
  const record = Object.values(storyRecords).find(item => item.id === bundle.run?.id);
  if (!record || bundle.bundleDigest !== record.digest || bundle.mode !== 'live' || bundle.run.mode !== 'live' || bundle.fixture?.id !== record.taskId) return null;
  const run = bundle.run;
  const candidate = run.candidates.find(item => item.id === run.selectedCandidateId);
  const definition = bundle.fixture.visibleCases.find(item => item.id === record.checkId);
  const before = run.baselineChecks?.visible.find(item => item.id === record.checkId);
  const after = candidate?.visibleChecks.find(item => item.id === record.checkId);
  // These pinned cases explicitly wrap return values with argument-mutation observations.
  if (!candidate || definition?.assertArgsUnchanged !== true || !before || !after || before.status === 'error' || after.status === 'error' ||
      !Object.hasOwn(before.actual ?? {}, 'outcome') || !Object.hasOwn(after.actual ?? {}, 'outcome')) return null;
  return structuredClone({ runId: run.id, taskId: record.taskId, input: definition.args[0], kwargs: definition.kwargs,
    expected: definition.expected, before: before.actual.outcome, after: after.actual.outcome,
    beforeSource: bundle.fixture.files[bundle.fixture.entrypoint], afterSource: candidate.files[bundle.fixture.entrypoint],
    checkId: record.checkId, candidateId: candidate.id, bundleDigest: record.digest });
}
function node(tag, className, text) {
  const result = document.createElement(tag); if (className) result.className = className;
  if (text !== undefined) result.textContent = text; return result;
}
function add(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function anchor(text, href, style = 'button') { const a = node('a', style, text); a.href = href; return a; }
function value(label, data, style = '') { return add(node('div', `value-card ${style}`), node('h3', '', label), node('pre', '', JSON.stringify(data))); }
function section(title, text) { return add(node('div', 'story-explanation'), node('h3', '', title), node('p', '', text)); }
function checksOf(run) { const candidate = run.candidates.find(item => item.id === run.selectedCandidateId); return [...candidate.visibleChecks, ...candidate.acceptanceChecks]; }
function passing(checks) { return checks.filter(check => check.status === 'pass').length; }
export function renderStory(container, state, requestedStep = 'bug') {
  const steps = [['bug', '1. The bug'], ['patch', '2. AI patch'], ['decision', '3. Your decision'], ['failure', '4. Failed repair']];
  const step = steps.some(([id]) => id === requestedStep) ? requestedStep : 'bug';
  const record = step === 'failure' ? storyRecords.failure : storyRecords.success;
  const run = state.runs.get(record.id), context = run && state.contexts.get(record.id);
  const tabs = node('nav', 'story-steps'); tabs.setAttribute('aria-label', 'Walkthrough steps');
  for (const [id, label] of steps) { const a = anchor(label, `#story/${id}`, 'story-step'); if (id === step) a.setAttribute('aria-current', 'step'); tabs.append(a); }
  const card = node('article', 'story-card');
  const data = context?.status === 'ready' && context.story;
  container.dataset.state = data ? 'ready' : !state.ready || context?.status === 'loading' ? 'loading' : 'unavailable';
  if (!data) {
    const loading = !state.ready || context?.status === 'loading';
    add(card, node('h2', 'story-heading', loading ? 'Loading the recorded example…' : 'This recorded example is unavailable here.'),
      node('p', '', loading ? 'Reading its saved patch and check results.' : 'The walkthrough needs its original real-run evidence. This workspace has not supplied it; no example results have been substituted.'), anchor('Browse repair tasks', '#tasks'));
    container.replaceChildren(tabs, card); return;
  }
  const checks = checksOf(run), original = [...run.baselineChecks.visible, ...run.baselineChecks.acceptance];
  add(card, node('p', 'story-meta', 'Saved real repair · No new model calls'),
    step === 'failure' && node('p', 'story-kicker', 'A separate example: worksheet cells'));
  if (step === 'bug') {
    add(card, node('h2', 'story-heading', 'This function leaves a duplicate in the list.'),
      node('p', 'story-lead', 'Keep each item once, in its original order. The second “elm” should disappear.'),
      add(node('div', 'story-values'), value('Input', data.input), value('Current output · wrong', data.before, 'bad'), value('Required output', data.expected, 'good')),
      section('Your job', 'Ask for a fix without changing the caller’s original list or its existing error behavior. Then review the proposed change before using it.'),
      add(node('div', 'story-actions'), anchor('See the AI patch', '#story/patch', 'button primary'), anchor('Try a new repair', '#tasks', 'text-link')));
  } else if (step === 'patch') {
    const snippet = source => {
      const lines = source.split('\n').filter(line => /for value in values|if .*result|result.append/.test(line));
      const indent = Math.min(...lines.map(line => line.length - line.trimStart().length));
      return lines.map(line => line.slice(indent)).join('\n');
    };
    add(card, node('h2', 'story-heading', 'The patch checks all retained items, not just the last one.'),
      node('p', 'story-lead', 'The original code only compared neighboring items. The proposed change checks whether an item has already appeared anywhere in the result.'),
      add(node('div', 'story-code-comparison'), add(node('div'), node('h3', '', 'Original code · relevant lines'), node('pre', 'story-code bad', snippet(data.beforeSource))), add(node('div'), node('h3', '', 'AI proposal · relevant lines'), node('pre', 'story-code good', snippet(data.afterSource)))),
      add(node('div', 'story-values'), value('Original output', data.before, 'bad'), value('Output from this patch', data.after, 'good')),
      section('What PatchProof does next', 'It runs the proposed code against checks stored outside the files the model may edit. The model’s explanation does not decide whether the repair passes.'),
      node('p', 'story-footnote', `This saved repair used ${run.usage.inferenceCalls} model request and finished in ${(run.usage.elapsedMs / 1000).toFixed(1)} seconds. You are reviewing that result, not waiting for a new run.`),
      add(node('div', 'story-actions'), anchor('See the check results', '#story/decision', 'button primary'), anchor('Inspect the full patch', `#evidence/${run.id}`, 'text-link')));
  } else if (step === 'decision') {
    add(card, node('h2', 'story-heading', 'The listed checks pass. You still decide whether to use the patch.'),
      node('p', 'story-lead', `The original code passed ${passing(original)} of ${original.length} checks. The proposed patch passed ${passing(checks)} of ${checks.length}. Here is what those checks covered.`));
    const requirements = node('div', 'story-requirements');
    const labels = { R01: 'Remove duplicates and preserve first-occurrence order', R02: 'Leave the caller’s original data unchanged', R03: 'Keep the existing error when input is None' };
    for (const row of run.coverage) {
      const matched = checks.filter(check => row.checkIds.includes(check.id));
      add(requirements, add(node('div'), node('h3', '', labels[row.requirementId] ?? row.requirementId), node('p', '', `${passing(matched)} of ${matched.length} checks passed`)));
    }
    add(card, requirements,
      section('What you get beyond generated code', 'A patch, the requirements it was checked against, actual expected and observed results, and a downloadable record for review or replay. The model cannot rewrite the checks to make its answer pass.'),
      section('Your next decision', 'Inspect the full patch and the exact checks before applying it to your project. Passing these examples does not guarantee every possible input is correct. Nothing is merged automatically.'),
      add(node('div', 'story-actions'), anchor('See a repair that failed', '#story/failure', 'button primary'), anchor('Inspect patch and checks', `#evidence/${run.id}`), anchor('Download this run’s evidence', `/runs/${run.id}/evidence`, 'text-link')));
  } else {
    const candidate = run.candidates.find(item => item.id === run.selectedCandidateId);
    add(card, node('h2', 'story-heading', 'This proposed repair still changes an empty cell into a number.'),
      node('p', 'story-lead', 'In this separate task, a worksheet function swaps rows and columns. An existing null cell must stay empty; the filler value 9 is only for missing cells.'),
      add(node('div', 'story-values'), value('Input · filler is 9', data.input), value('Required output', data.expected, 'good'), value('AI patch output · wrong', data.after, 'bad')),
      add(node('div', 'story-verdict bad'), node('h3', '', `${passing(checks)} of ${checks.length} checks passed. The patch was not approved.`), node('p', '', `Attempt ${candidate.id} still replaces null with 9. Later attempts produced execution errors. PatchProof kept the results for inspection and did not turn a partial pass into an accepted repair.`)),
      section('Your job here', 'Do not treat this as a completed fix. Open the failed checks to see what still breaks, or choose another task to try a new repair.'),
      add(node('div', 'story-actions'), anchor('Inspect the failed checks', `#evidence/${run.id}`, 'button primary'), anchor('Try a new repair', '#tasks'), anchor('Back to the first example', '#story/bug', 'text-link')));
  }
  const footer = node('p', 'story-footnote', 'Recorded with an NVIDIA model on Nebius Token Factory and checks in local Docker containers. These two examples do not establish a benchmark advantage.');
  container.replaceChildren(tabs, card, footer);
}
