const byId = id => document.getElementById(id);
const variants = {
  baseline: { name: 'Ordinary repair', label: 'B0 · Baseline', description: 'A minimal repair loop with the task requirements and visible test feedback.' },
  checks_only: { name: 'Checks only', label: 'B1 · Acceptance feedback', description: 'The same repair loop with frozen acceptance checks and their feedback.' },
  patchproof: { name: 'PatchProof', label: 'P · Candidate selection', description: 'Acceptance checks, bounded candidates and an explicit selection record.' },
};
const phaseNames = { queued: 'Queued', preflight: 'Preflight', baseline_capture: 'Starting checks', repair: 'Repairing', check: 'Checking', export: 'Preparing evidence', terminal: 'Finished' };
const outcomes = {
  verified_for_declared_checks: 'Passes declared checks', needs_review: 'Needs review', failed: 'Checks failed', infrastructure_error: 'Execution error',
};
const state = { tasks: [], runs: new Map(), taskId: '', runId: '', candidateIds: new Map(), meta: {}, busy: false };
const streams = new Map();
const refreshing = new Set();
let pollTimer;

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function append(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function link(text, href, className = 'text-link') { const node = el('a', className, text); node.href = href; return node; }
function button(text, handler, className = 'button') {
  const node = el('button', className, text);
  node.type = 'button'; node.addEventListener('click', handler); return node;
}
function pill(text, kind = '') { return el('span', `pill ${kind}`, text); }
function money(value) { return value === null || value === undefined ? 'Not measured' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value > 0 && value < .01 ? 4 : 2 }).format(value); }
function duration(ms) { return ms === null || ms === undefined ? 'Not measured' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`; }
function count(value) { return new Intl.NumberFormat('en-US').format(value ?? 0); }
function time(value) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
function taskFor(id) { return state.tasks.find(task => task.id === id); }
function currentTask() { return taskFor(state.taskId); }
function mockSupported(task) { return task?.mockSupported === true; }
function isArchive() { return state.meta.mode === 'archive'; }
function canCreate() { return !isArchive() && state.meta.capabilities?.createRuns !== false; }
function canCancel() { return !isArchive() && state.meta.capabilities?.cancelRuns !== false; }
function modeLabel(run) {
  if (isArchive()) return run.mode === 'live' ? 'RECORDED LIVE · READ ONLY' : 'RECORDED MOCK · READ ONLY';
  return run.mode === 'mock' ? 'MOCK MODEL · LOCAL CHECKS' : run.phase === 'terminal' ? 'RECORDED LIVE' : 'LIVE PROVIDER';
}
function renderMode() {
  byId('mode-indicator').textContent = isArchive() ? 'Recorded evidence · Read only' : 'Mock model · Local checks';
  byId('mode-label').textContent = isArchive() ? 'EVIDENCE ARCHIVE' : 'LOCAL WORKSPACE';
  byId('mode-description').textContent = isArchive()
    ? 'Recorded runs, verified against pinned bundle digests and approved public fixtures. Viewing does not execute work or authenticate provider and billing claims.'
    : 'Scripted model responses. Checks execute in local containers. No paid inference or competition-ready evidence.';
  byId('comparison-notice').textContent = isArchive()
    ? 'This view compares the supplied recorded runs. Source modes remain visible; mock and live records are never a matched comparison. No new runs or checks execute here. A few recorded runs do not establish a benchmark result.'
    : 'These local runs demonstrate the workflow using scripted model responses. Their results are not a model benchmark or evidence that one repair approach performs better. Sealed evaluation and sponsor integration remain separate gates.';
}
function runsForTask() { return [...state.runs.values()].filter(run => run.taskId === state.taskId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
function runName(run) { return `${taskFor(run.taskId)?.title ?? run.taskId} · ${variants[run.variant]?.name ?? run.variant}${isArchive() ? ` · recorded ${run.mode}` : ''} · ${time(run.createdAt)}`; }
function selectedCandidate(run) { return run.candidates.find(candidate => candidate.id === run.selectedCandidateId); }
function outcome(run) { return outcomes[run.terminalStatus] ?? phaseNames[run.phase] ?? run.phase; }
function outcomeClass(run) { return run.terminalStatus === 'failed' || run.terminalStatus === 'infrastructure_error' ? 'fail' : run.terminalStatus === 'needs_review' ? 'warn' : ''; }
function humanReason(reason) {
  const labels = { declared_local_checks_passed: 'The selected candidate satisfies all declared local checks.', declared_checks_not_satisfied: 'The selected candidate does not satisfy every declared check.', cancelled: 'The run was cancelled. Completed results are preserved for review.', timeout: 'The run reached its elapsed-time limit. Review the partial results.', interrupted_by_restart: 'Execution was interrupted by a service restart.', evidence_publish_failed: 'Execution ended, but the evidence bundle could not be published.' };
  return labels[reason] ?? reason.replaceAll('_', ' ');
}
function announce(text) { byId('announcer').textContent = text; }
function clearError() { byId('error').hidden = true; byId('error').replaceChildren(); }
function showError(error) {
  const box = byId('error'); box.hidden = false;
  box.replaceChildren(el('span', '', error instanceof Error ? error.message : 'The request could not be completed.'), button('Dismiss', clearError, ''));
}
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status}).`);
  return body;
}
function panel(title, description, content, extra) {
  const box = el('section', 'panel'); const head = el('div', 'panel-head'); const labels = append(el('div'), el('h2', '', title), description && el('p', '', description));
  append(box, append(head, labels, extra), content); return box;
}
function empty(title, description, actionText, href) {
  return append(el('div', 'empty-state'), el('span', 'empty-symbol', '↗'), el('h2', '', title), el('p', '', description), actionText && link(actionText, href, 'button primary'));
}
function route() {
  const [rawView, id] = location.hash.slice(1).split('/');
  const view = ['tasks', 'compare', 'evidence'].includes(rawView) ? rawView : 'tasks';
  if (id && view === 'evidence') state.runId = id;
  for (const name of ['tasks', 'compare', 'evidence']) byId(`${name}-view`).hidden = name !== view;
  document.querySelectorAll('[data-nav]').forEach(node => {
    if (node.dataset.nav === view) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  });
  if (view === 'compare') renderComparison();
  if (view === 'evidence') {
    renderRunPicker(); renderEvidence();
    if (state.runId && !state.runs.has(state.runId)) refreshRun(state.runId).catch(showError);
  }
}
function chooseTask(id) {
  const taskHadFocus = document.activeElement?.classList.contains('task-card');
  state.taskId = id;
  renderTasks(); renderTaskDetail(); renderTaskPicker(); renderComparison();
  if (taskHadFocus) document.querySelector('.task-card[aria-pressed="true"]')?.focus({ preventScroll: true });
}
function renderTasks() {
  byId('task-count').textContent = `${state.tasks.length} available`;
  byId('task-list').replaceChildren(...state.tasks.map(task => {
    const node = button('', () => chooseTask(task.id), 'task-card');
    node.setAttribute('aria-pressed', String(task.id === state.taskId));
    node.dataset.taskId = task.id;
    append(node, el('span', 'task-title', task.title), el('span', 'task-meta', `${task.requirements.length} requirements · ${isArchive() ? 'Recorded evidence available' : mockSupported(task) ? 'Local demo ready' : 'Connected model required'}`));
    if (task.id === state.taskId) append(node, el('span', 'selection-mark', '✓'));
    return node;
  }));
  if (!state.tasks.length) byId('task-list').append(el('p', 'empty-small', 'No curated tasks are available. Check the fixture configuration.'));
}
function renderTaskPicker() {
  byId('compare-task').replaceChildren(...state.tasks.map(task => new Option(task.title, task.id, false, task.id === state.taskId)));
  byId('compare-run').disabled = !canCreate() || state.busy || !mockSupported(currentTask());
  byId('compare-run').hidden = !canCreate();
}
function renderTaskDetail() {
  const task = currentTask(); if (!task) return;
  const requirements = el('ol', 'requirements');
  for (const requirement of task.requirements) append(requirements, append(el('li'), el('span', 'requirement-id', requirement.id), el('span', '', requirement.text)));
  const allowance = el('div', 'allowance');
  if (isArchive()) {
    const runs = runsForTask();
    append(allowance, el('strong', '', 'Recorded evidence · Read only'), el('p', '', `${runs.length} archived run${runs.length === 1 ? '' : 's'} for this approved public task. Resource limits and usage belong to those recorded runs; this viewer grants no execution allowance.`));
    byId('task-detail').replaceChildren(
      append(el('div', 'detail-top'), pill('PYTHON MAINTENANCE'), el('span', 'quiet', task.repoId ?? task.id)),
      el('h2', '', task.title), el('p', 'task-description', task.description), el('h3', 'requirements-heading', 'Requirements to preserve'), requirements, allowance,
      append(el('div', 'actions'), runs[0] && link('Review recorded evidence →', `#evidence/${runs[0].id}`, 'button primary'), link('Compare recorded approaches', '#compare', 'button')),
      el('p', 'fine-print', 'Only explicitly configured evidence is available. Nothing is executed, merged or published by this viewer.'),
    );
    return;
  }
  append(allowance, append(el('div', 'allowance-title'), el('span', '', mockSupported(task) ? 'Mock model · Local checks' : 'Requires connected model'), el('span', '', '$0 provider spend')),
    el('p', '', `Project ceiling: ${money(state.meta.maxApprovedSpendUsd ?? state.meta.allowance?.maxApprovedSpendUsd ?? 25)}. Paid execution is unavailable in this local build.`));
  if (!mockSupported(task)) append(allowance, el('p', '', 'This fixture is ready for connected model development. Scripted local repair is available only for the stable-unique demonstration task.'));
  const limits = state.meta.limits;
  append(allowance, el('p', '', limits ? `Identical per-run limits: ${limits.inferenceCallLimit} model calls · ${count(limits.inputTokenLimit)} input / ${count(limits.outputTokenLimit)} output tokens · ${limits.wallTimeLimitSeconds} s elapsed. CPU usage is not measured; ${limits.sandboxCpuSecondsLimit} s is the configured allowance, not a verified cumulative limit.` : 'Per-run resource limits are fixed by the coordinator and included in every run record.'));
  const start = button('Run PatchProof →', () => launch(['patchproof']), 'button primary');
  const compare = button('Compare all three', () => launch(Object.keys(variants)), 'button');
  start.disabled = compare.disabled = !canCreate() || state.busy || !mockSupported(task);
  byId('task-detail').replaceChildren(
    append(el('div', 'detail-top'), pill('PYTHON MAINTENANCE'), el('span', 'quiet', task.repoId ?? task.id)),
    el('h2', '', task.title), el('p', 'task-description', task.description),
    el('h3', 'requirements-heading', 'Requirements to preserve'), requirements, allowance,
    append(el('div', 'actions'), start, compare), el('p', 'fine-print', 'Curated tasks only. Every change remains yours to review. Nothing is merged automatically.'),
  );
}
async function launch(selectedVariants) {
  if (!canCreate() || state.busy || !mockSupported(currentTask())) return;
  const taskId = state.taskId;
  state.busy = true; clearError(); renderTaskDetail(); renderTaskPicker();
  try {
    for (const variant of selectedVariants) {
      const run = await request('/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, variant, mode: 'mock', idempotencyKey: crypto.randomUUID() }) });
      storeRun(run); state.runId = run.id;
      if (selectedVariants.length === 1) location.hash = `evidence/${run.id}`;
      else location.hash = 'compare';
    }
    announce(`${selectedVariants.length === 1 ? 'Run' : 'Comparison'} started. Execution events will appear as they arrive.`);
  } catch (error) { showError(error); }
  finally { state.busy = false; renderTaskDetail(); renderTaskPicker(); renderComparison(); renderRunPicker(); renderEvidence(); }
}
function storeRun(run) {
  const previous = state.runs.get(run.id);
  state.runs.set(run.id, run);
  if (run.phase === 'terminal') {
    streams.get(run.id)?.close(); streams.delete(run.id);
    if (previous && previous.phase !== 'terminal') announce(`${variants[run.variant].name}: ${outcome(run)}.`);
  } else watchRun(run.id);
  if (!pollTimer && [...state.runs.values()].some(item => item.phase !== 'terminal')) pollTimer = setInterval(pollActiveRuns, 2000);
  if (pollTimer && ![...state.runs.values()].some(item => item.phase !== 'terminal')) { clearInterval(pollTimer); pollTimer = undefined; }
}
function watchRun(id) {
  if (isArchive() || state.meta.capabilities?.streamEvents === false) return;
  if (streams.has(id)) return;
  const stream = new EventSource(`/runs/${encodeURIComponent(id)}/events`); streams.set(id, stream);
  const onEvent = () => refreshRun(id).catch(showError);
  stream.onmessage = onEvent;
  for (const kind of ['state', 'terminal', 'cancel_requested']) stream.addEventListener(kind, onEvent);
  stream.onerror = () => {
    stream.close(); streams.delete(id);
    refreshRun(id).catch(() => { /* Polling retries the same run; it never starts another. */ });
  };
}
async function refreshRun(id) {
  if (refreshing.has(id)) return;
  refreshing.add(id);
  try {
    const run = await request(`/runs/${encodeURIComponent(id)}`); storeRun(run);
    renderComparison(); renderRunPicker();
    if (state.runId === id) renderEvidence();
  } finally { refreshing.delete(id); }
}
async function pollActiveRuns() {
  await Promise.allSettled([...state.runs.values()].filter(run => run.phase !== 'terminal').map(run => refreshRun(run.id)));
}
function metrics(entries, className = 'metric-list') {
  const list = el('dl', className);
  for (const [name, value] of entries) append(list, append(el('div'), el('dt', '', name), el('dd', '', value)));
  return list;
}
function progress(run) {
  const box = el('div', 'run-progress');
  for (const phase of ['baseline_capture', 'repair', 'check', 'export']) append(box, el('span', `step${phase === run.phase ? ' current' : ''}`, phaseNames[phase]));
  return box;
}
function coverageText(run) { return `${run.coverage.filter(row => row.status === 'pass').length} / ${taskFor(run.taskId)?.requirements.length ?? run.coverage.length}`; }
function matchedContext(runs) {
  if (runs.length < 3) return { matched: false, message: isArchive() ? 'The archive needs all three approaches to compare their source, policy and resource limits.' : 'Run all three approaches to compare their source, policy and resource limits.' };
  const signature = run => JSON.stringify([run.schemaVersion, run.sourceDigest, run.policyDigest, run.runtimeLockDigest, run.mode, Object.entries(run.limits).sort()]);
  const matched = runs.every(run => signature(run) === signature(runs[0]));
  return { matched, message: matched ? 'Source snapshot, acceptance policy, runtime lock and every resource limit match.' : isArchive() ? 'These recorded runs have different modes, inputs or limits. They are not a matched comparison.' : 'These runs have different inputs or limits. Start a new comparison before drawing conclusions.' };
}
function renderComparison() {
  const runs = runsForTask();
  const latest = Object.keys(variants).map(variant => runs.find(run => run.variant === variant));
  const match = matchedContext(latest.filter(Boolean));
  const context = append(el('div', 'comparison-context'), pill(match.matched ? 'MATCHED CONTEXT' : 'COMPARISON CONTEXT', match.matched ? '' : 'neutral'), el('span', '', match.message));
  const cards = el('div', 'variant-grid');
  Object.entries(variants).forEach(([key, variant], index) => {
    const run = latest[index]; const card = el('article', `variant-card${key === 'patchproof' ? ' featured' : ''}`);
    append(card, el('p', 'variant-kicker', variant.label), el('h2', '', variant.name), el('p', 'variant-description', variant.description));
    if (run) {
      if (isArchive()) append(card, pill(modeLabel(run), 'neutral'));
      append(card, el('p', `outcome ${outcomeClass(run)}${run.phase !== 'terminal' ? ' busy-indicator' : ''}`, outcome(run)),
        metrics([['Requirements passing', coverageText(run)], ['Candidates recorded', run.candidates.length], ['Elapsed', duration(run.usage.elapsedMs)], ['Provider cost', money(run.usage.measuredCostUsd)]]),
        run.phase !== 'terminal' && progress(run), link('Review evidence ↗', `#evidence/${run.id}`, 'button'));
    } else {
      if (!canCreate()) {
        append(card, el('p', 'empty-small', 'No recorded run for this approach in the archive.'));
        cards.append(card); return;
      }
      const start = button('Run this approach →', () => launch([key]), 'button');
      start.disabled = state.busy || !mockSupported(currentTask());
      append(card, el('p', 'empty-small', mockSupported(currentTask()) ? 'No run for this task yet.' : 'Requires a connected model. Local scripted repair is unavailable for this task.'), start);
    }
    cards.append(card);
  });
  const tableWrap = el('div', 'comparison-table-wrap');
  tableWrap.tabIndex = 0; tableWrap.setAttribute('role', 'region');
  tableWrap.setAttribute('aria-label', 'Resource usage and limits for all three approaches. Scroll horizontally on narrow screens.');
  const table = el('table', 'comparison-table');
  const head = append(el('tr'), el('th', '', 'Resource allowance'));
  head.firstChild.scope = 'col';
  for (const variant of Object.values(variants)) { const th = el('th', '', variant.name); th.scope = 'col'; head.append(th); }
  table.append(append(el('thead'), head)); const tbody = el('tbody');
  const rows = [
    ['Model calls', 'inferenceCallLimit', 'inferenceCalls'], ['Input tokens', 'inputTokenLimit', 'inputTokens'],
    ['Output tokens', 'outputTokenLimit', 'outputTokens'], ['Elapsed time (seconds)', 'wallTimeLimitSeconds', null],
    ['Sandbox CPU (seconds)', 'sandboxCpuSecondsLimit', 'sandboxCpuSeconds'], ['Approved provider spend', 'maxApprovedSpendUsd', null],
  ];
  for (const [label, limitKey, usageKey] of rows) {
    const row = el('tr'); const th = el('th', '', label); th.scope = 'row'; row.append(th);
    for (const run of latest) {
      let value = '—';
      if (run) {
        const limit = run.limits[limitKey];
        if (limitKey === 'maxApprovedSpendUsd') value = money(limit);
        else if (limitKey === 'wallTimeLimitSeconds') value = `${(run.usage.elapsedMs / 1000).toFixed(1)} / ${count(limit)}`;
        else value = `${run.usage[usageKey] === null ? 'Unmeasured' : count(run.usage[usageKey])} / ${count(limit)}`;
      }
      row.append(el('td', '', value));
    }
    tbody.append(row);
  }
  append(table, tbody); tableWrap.append(table);
  byId('comparison').replaceChildren(context, cards, el('p', 'table-scroll-hint', 'Scroll the table → to compare every approach.'), tableWrap, el('p', 'fine-print', isArchive() ? 'Recorded usage / limit. Unknown values remain unmeasured. Mock counters describe scripted operations; an archive digest does not authenticate live-provider measurements.' : 'Usage / limit. Mock model counters describe scripted operations; they are not measurements of real model inference.'));
}
function renderRunPicker() {
  const picker = byId('evidence-run');
  const runs = [...state.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!state.runId && runs.length) state.runId = runs[0].id;
  picker.replaceChildren(...(runs.length ? runs.map(run => new Option(runName(run), run.id, false, run.id === state.runId)) : [new Option('No runs yet', '')]));
}
function candidateHistory(run) {
  if (!run.candidates.length) return panel('Candidate history', 'Each candidate preserves its result and decision.', el('p', 'empty-small', run.phase === 'terminal' ? 'No candidate was produced. The run reason and event journal explain where execution stopped.' : 'No candidate yet. The first result will appear after the repair and check stages.'));
  const chosenId = state.candidateIds.get(run.id) ?? run.selectedCandidateId ?? run.candidates.at(-1).id;
  const candidate = run.candidates.find(item => item.id === chosenId) ?? run.candidates.at(-1);
  const wrapper = el('div'); const tabs = el('div', 'candidate-tabs'); tabs.setAttribute('aria-label', 'Candidate history');
  for (const item of run.candidates) {
    const tab = button('', () => {
      state.candidateIds.set(run.id, item.id); renderEvidence();
      document.querySelector('.candidate-tab[aria-pressed="true"]')?.focus({ preventScroll: true });
    }, `candidate-tab${item.accepted ? ' accepted' : ''}`);
    tab.setAttribute('aria-pressed', String(item.id === candidate.id));
    const decision = item.accepted ? 'passed' : item.rejectionReason ? 'rejected' : run.phase === 'terminal' ? 'unverified' : 'checking';
    append(tab, el('span', 'candidate-dot'), el('span', '', `Candidate ${item.id} · ${decision}${item.id === run.selectedCandidateId ? ' · selected' : ''}`));
    tabs.append(tab);
  }
  const body = el('div', 'panel-body');
  append(body, el('p', 'candidate-description', candidate.summary), el('p', 'candidate-caption', `Parent: ${candidate.parentId === null ? 'original snapshot' : `candidate ${candidate.parentId}`} · ${duration(candidate.elapsedMs)} · ${candidate.sandboxOperationIds.length} sandbox operation${candidate.sandboxOperationIds.length === 1 ? '' : 's'}`));
  if (candidate.rejectionReason) append(body, append(el('div', 'failure-card'), el('h3', '', 'Why this candidate was rejected'), el('p', '', candidate.rejectionReason)));
  const failed = [...candidate.visibleChecks, ...candidate.acceptanceChecks].find(check => check.status !== 'pass');
  if (failed) append(body, append(el('div', 'failure-card'), el('h3', '', `${failed.requirementId} · ${failed.status === 'error' ? 'Check could not complete' : 'A declared requirement failed'}`), el('p', '', failed.message), el('p', 'failure-value', `Expected: ${JSON.stringify(failed.expected)}`), el('p', 'failure-value', `Observed: ${JSON.stringify(failed.actual)}`)));
  append(wrapper, tabs, body, el('div', 'diff-title', `Candidate ${candidate.id} · patch against the original snapshot`));
  if (candidate.diff) {
    const diff = el('pre', 'diff'); diff.tabIndex = 0; diff.setAttribute('aria-label', `Patch for candidate ${candidate.id}`); const code = el('code');
    for (const line of candidate.diff.split('\n')) append(code, el('span', `diff-line${line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ') ? ' heading' : line.startsWith('+') ? ' add' : line.startsWith('-') ? ' remove' : ''}`, line || ' '));
    diff.append(code); wrapper.append(diff);
  } else append(wrapper, el('p', 'no-diff', 'No source difference recorded for this candidate.'));
  const checkBody = el('div', 'panel-body'); append(checkBody, checksGroup('Visible checks', candidate.visibleChecks), checksGroup('Independent runtime acceptance checks', candidate.acceptanceChecks));
  wrapper.append(checkBody);
  return panel('Candidate history', 'Decision summaries and executed results, with the actual patch.', wrapper, pill(`${run.candidates.length} CANDIDATE${run.candidates.length === 1 ? '' : 'S'}`, 'neutral'));
}
function checkStatus(status) { return pill(status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'error' ? 'ERROR' : 'UNVERIFIED', status === 'pass' ? '' : status === 'fail' || status === 'error' ? 'fail' : 'warn'); }
function checkLog(check) {
  let parsed;
  try { parsed = JSON.parse(check.log); } catch { /* Older exports contain plain process logs. */ }
  if (parsed?.protocol === 'repeat-observations-v1' && Array.isArray(parsed.observations)) {
    return `Expected: ${JSON.stringify(check.expected)}\nCombined result: ${check.status}\nRepeat agreement: ${parsed.stability}\n\n` +
      parsed.observations.map((observation, index) => `Observation ${index + 1} · ${observation.status}\nObserved: ${JSON.stringify(observation.actual)}\n${observation.message}\n${observation.log || 'No additional log output.'}`).join('\n\n');
  }
  return `Expected: ${JSON.stringify(check.expected)}\nObserved: ${JSON.stringify(check.actual)}\n\n${check.log || 'No additional log output.'}`;
}
function checksGroup(title, checks) {
  const group = append(el('div', 'checks-group'), el('h3', '', title));
  if (!checks.length) return append(group, el('p', 'empty-small', 'No results recorded.'));
  for (const check of checks) {
    const row = el('div', 'check-row');
    append(row, append(el('div', 'check-heading'), el('span', 'check-name', `${check.requirementId} · ${check.id}`), checkStatus(check.status)), el('p', '', check.message));
    const details = el('details');
    append(details, el('summary', '', `Observed result and log · ${duration(check.durationMs)}`), el('pre', 'check-log', checkLog(check)));
    append(group, append(row, details));
  }
  return group;
}
function coveragePanel(run) {
  const requirements = taskFor(run.taskId)?.requirements ?? [];
  const list = el('ul', 'coverage-list');
  for (const requirement of requirements) {
    const row = run.coverage.find(item => item.requirementId === requirement.id);
    append(list, append(el('li', 'coverage-row'), append(el('div', 'coverage-row-header'), el('span', 'requirement-id', requirement.id), checkStatus(row?.status ?? 'unverified')), el('p', '', requirement.text), el('p', 'check-ids', row?.checkIds.length ? row.checkIds.join(' · ') : 'No supporting checks recorded')));
  }
  if (!requirements.length) append(list, el('li', 'empty-small', 'Task requirements are unavailable.'));
  return panel('Requirement coverage', run.selectedCandidateId === null ? 'Coverage of the run; no candidate selected.' : `Final selection: candidate ${run.selectedCandidateId}.`, list, el('span', 'coverage-count', coverageText(run)));
}
function eventPanel(run) {
  const list = el('ol', 'event-list');
  for (const event of run.events) append(list, append(el('li'), el('time', 'event-time', time(event.timestamp)), append(el('div', 'event-message'), el('span', 'event-phase', phaseNames[event.phase] ?? event.phase), el('span', '', event.message))));
  return panel('Execution journal', 'Events recorded by the coordinator.', append(el('div', 'panel-body'), list));
}
function accountingPanel(run) {
  const body = el('div', 'panel-body');
  append(body, metrics([
    ['Provider cost', `${money(run.usage.measuredCostUsd)}${run.usage.costIsEstimate ? ' (estimate)' : ''}`],
    ['Per-run spend limit', money(run.limits.maxApprovedSpendUsd)],
    ['Model operations / limit', `${count(run.usage.inferenceCalls)} / ${count(run.limits.inferenceCallLimit)}`],
    ['Input tokens / limit', `${count(run.usage.inputTokens)} / ${count(run.limits.inputTokenLimit)}`],
    ['Output tokens / limit', `${count(run.usage.outputTokens)} / ${count(run.limits.outputTokenLimit)}`],
    ['Elapsed / limit', `${duration(run.usage.elapsedMs)} / ${run.limits.wallTimeLimitSeconds} s`],
    ['Sandbox CPU / limit', `${run.usage.sandboxCpuSeconds === null ? 'Not measured' : `${run.usage.sandboxCpuSeconds.toFixed(2)} s`} / ${run.limits.sandboxCpuSecondsLimit} s`],
  ], 'accounting'), el('p', 'fine-print', run.mode === 'mock' ? 'Model operations and token counts come from scripted responses. No paid inference was performed. Local electricity and hardware cost are not billed or measured here.' : 'Provider cost is measured only when billing data is available.'));
  return panel('Resource accounting', 'Every candidate contributes to the same allowance.', body);
}
function provenancePanel(run) {
  const body = el('div', 'panel-body'); const list = el('dl', 'digest-list');
  const candidate = selectedCandidate(run);
  for (const [name, value] of [['Source snapshot', run.sourceDigest], ['Acceptance policy', run.policyDigest], ['Runtime lock', run.runtimeLockDigest], ['Run ID', run.id], ['Model identifier', candidate?.modelId ?? (run.mode === 'mock' ? 'Mock response provider; no model inference.' : 'Not recorded')], ['Provider request ID', candidate?.providerRequestId ?? 'Not recorded']]) append(list, el('dt', '', name), el('dd', '', value));
  if (candidate?.sandboxOperationIds.length) append(list, el('dt', '', 'Selected candidate operation IDs'), el('dd', '', candidate.sandboxOperationIds.join('\n')));
  if (isArchive()) {
    const entry = state.meta.bundles?.find(item => item.runId === run.id);
    if (entry) append(list, el('dt', '', 'Pinned archive bundle'), el('dd', '', entry.bundleDigest));
    append(list, el('dt', '', 'Archive verification'), el('dd', '', 'Integrity and approved public fixture match verified at load. Provider and billing authenticity not established.'));
  }
  append(body, list);
  if (run.phase === 'terminal' && run.mode === 'live') {
    append(body, el('p', 'fine-print', 'Replay of recorded live evidence is a separate operator action requiring an approved private configuration and its digest. This viewer does not execute checks.'),
      el('code', 'reproduce-command', `make reproduce RUN=${run.id} CONFIG=<private-replay.json> CONFIG_DIGEST=<digest>`),
      el('p', 'fine-print', 'The download preserves the original evidence and historical commands. Use the current private replay instructions; replay may incur separately authorized provider charges.'));
  } else if (run.phase === 'terminal') append(body, el('p', 'fine-print', 'Export the bundle, then reproduce the recorded checks from the project checkout:'), el('code', 'reproduce-command', `make reproduce RUN=${run.id}`), el('p', 'fine-print', 'The export records its inputs and digests. Replay is a separate fresh check execution; it does not rerun model inference.'));
  return panel('Reproducibility', 'Immutable inputs and trace references.', body);
}
async function cancelRun(id, control) {
  if (!canCancel()) return;
  control.disabled = true;
  try {
    const run = await request(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    storeRun(run); renderEvidence(); renderComparison(); announce('Cancellation requested. Waiting for the final execution state.');
  } catch (error) { showError(error); control.disabled = false; }
}
function renderEvidence() {
  const run = state.runs.get(state.runId);
  if (!run) {
    byId('evidence').replaceChildren(empty(state.runId ? 'Loading this run…' : 'Your evidence starts with a run.', state.runId ? 'Fetching the recorded state from the coordinator.' : 'Choose a curated task and run one approach, or start a comparison to review all three.', state.runId ? null : 'Choose a task →', '#tasks')); return;
  }
  const summary = el('section', 'panel run-summary'); const intro = el('div');
  append(intro, pill(modeLabel(run)), el('h2', '', taskFor(run.taskId)?.title ?? run.taskId), el('p', 'run-meta', `${run.phase === 'terminal' ? 'Recorded run' : 'In progress'} · ${variants[run.variant]?.name ?? run.variant} · ${new Date(run.createdAt).toLocaleString()}`), el('p', `outcome ${outcomeClass(run)}${run.phase !== 'terminal' ? ' busy-indicator' : ''}`, outcome(run)), run.reason && el('p', 'run-reason', humanReason(run.reason)));
  if (run.phase !== 'terminal') append(intro, progress(run), el('p', 'stream-note', 'Displaying recorded execution events. This page reconnects to the same run if the stream drops.'));
  const actions = el('div', 'actions');
  if (run.phase === 'terminal') {
    const download = link('Download evidence ↓', `/runs/${encodeURIComponent(run.id)}/evidence`, 'button primary'); download.download = `${run.id}.json`; append(actions, download);
  } else if (canCancel()) { const cancel = button('Cancel run', () => cancelRun(run.id, cancel)); actions.append(cancel); }
  append(summary, intro, actions);
  const columns = el('div', 'evidence-grid'); const primary = el('div'); const secondary = el('aside'); secondary.setAttribute('aria-label', 'Run coverage and provenance');
  append(primary, candidateHistory(run));
  if (run.baselineChecks) {
    const details = el('details', 'panel-body'); append(details, el('summary', '', 'Inspect checks on the original source'), checksGroup('Original visible checks', run.baselineChecks.visible), checksGroup('Original acceptance checks', run.baselineChecks.acceptance));
    append(primary, panel('Starting point', 'Actual check results before any candidate repair.', details));
  }
  append(primary, eventPanel(run)); append(secondary, coveragePanel(run), accountingPanel(run), provenancePanel(run));
  append(columns, primary, secondary);
  byId('evidence').replaceChildren(summary, columns, append(el('div', 'callout'), el('strong', '', 'Review boundary'), el('p', '', run.notice || 'Results apply only to the declared checks. Mock runs cannot establish model performance or sponsor integration, and do not constitute competition-ready evidence.')));
}
byId('compare-task').addEventListener('change', event => chooseTask(event.target.value));
byId('compare-run').addEventListener('click', () => launch(Object.keys(variants)));
byId('evidence-run').addEventListener('change', event => { state.runId = event.target.value; location.hash = `evidence/${state.runId}`; renderEvidence(); });
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', () => { for (const stream of streams.values()) stream.close(); clearInterval(pollTimer); });
route();
try {
  const [meta, history] = await Promise.all([request('/tasks'), request('/runs')]);
  state.meta = meta; state.tasks = [...meta.tasks].sort((a, b) => Number(mockSupported(b)) - Number(mockSupported(a))); state.taskId = state.tasks[0]?.id ?? '';
  renderMode();
  for (const run of history.runs) storeRun(run);
  renderTasks(); renderTaskDetail(); renderTaskPicker(); renderRunPicker(); renderComparison(); renderEvidence(); route();
} catch (error) {
  showError(new Error(`Could not load the workspace. ${error.message} Reload this page after the API is available.`));
  byId('task-count').textContent = 'Unavailable';
  byId('task-list').replaceChildren(el('p', 'empty-small', 'The task catalogue could not be loaded.'));
}
