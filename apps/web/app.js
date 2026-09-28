import { projectStory, renderStory } from './walkthrough.js';
const byId = id => document.getElementById(id);
const variants = {
  baseline: { name: 'Standard repair', label: 'Task checks', description: 'Uses the task checks to guide patch revisions.' },
  checks_only: { name: 'Repair with extra checks', label: 'Additional feedback', description: 'Also uses additional checks to guide patch revisions.' },
  patchproof: { name: 'PatchProof', label: 'Patch selection', description: 'Uses additional checks and keeps the best checked attempt.' },
};
// Display summaries apply only to the exact public task inputs they describe.
const taskCopy = {
  "stable-unique-01": {
    "sourceDigest": "sha256:2b9975006fe494a204d21bce70c73d5d025bb23cf50d1e7cb11b0e6229a331df",
    "policyDigest": "sha256:4e8250b6b6454e08a353e4be209b95f32fcdc9a4fc58716bf76ddc2b954740ce",
    "summary": "The function misses duplicates that are separated by other items. Keep the first copy of each item, in order."
  },
  "v2-r01-t02": {
    "sourceDigest": "sha256:83cfde7b695762fce2f7b5db03e307d5abcf68a18f36d5e42e5f2ad12a666a99",
    "policyDigest": "sha256:ad1a0592c97317091c074a5549c969dd1467ea1bae6528bad5735958091fe56e",
    "summary": "Splitting a list into batches currently drops the last batch when it is short. Keep every item."
  },
  "v2-r01-t03": {
    "sourceDigest": "sha256:1fad6b6f83b12af44d0e015692443f2764ef376d85280e3ffb7f5327127503fe",
    "policyDigest": "sha256:82c84b2cee8f4d70393ce18cfe08fc58c8890e918d60f6dc4423b937b3d34868",
    "summary": "Negative shifts currently rotate the wrong way. Positive shifts should move right; negative shifts should move left."
  },
  "v2-r01-t04": {
    "sourceDigest": "sha256:00ad1365467e0ae65fe324fea7038af4e63ceadb76f8a5823093322557eb327a",
    "policyDigest": "sha256:b00cbf39f7aba4fba9e008f45818e7f120ada567e447bce4914a7598c873ff62",
    "summary": "Alternating between two lists currently loses items from the longer list. Append those leftover items in order."
  },
  "v2-r01-t05": {
    "sourceDigest": "sha256:477dc47cf8d16a9945ec979f71e600911b6d939f866743f3a5703cf441455d91",
    "policyDigest": "sha256:e0dbcdd813e27b5a0450fb2bec53a4f0109125f33934042748966f8b246df339",
    "summary": "The function combines matching items even when they are separated. Count each consecutive group on its own."
  },
  "v2-r02-t01": {
    "sourceDigest": "sha256:2f783fc7146371ffacb570b1937785fd1c8af9348edbb321362a8247c2a54b09",
    "policyDigest": "sha256:3c54e159224f0646a88c1db8c6013a1f93653e39dba919a5bec7d4051febb321",
    "summary": "Repeated page marks split reading ranges incorrectly. Sort the distinct pages and group consecutive numbers."
  },
  "v2-r02-t02": {
    "sourceDigest": "sha256:d680ab4236cfbb7bb345013ced309308a694235db0b1cb555fe740f78db2a776",
    "policyDigest": "sha256:00d5fd806061b43b8e060741ea10c87a63378b5e889c89a66b176c789919fa9a",
    "summary": "Chapters that exactly fill a reading session are split too early. Keep them together when their total equals the limit."
  },
  "v2-r02-t03": {
    "sourceDigest": "sha256:31bbec94d8747beec54710684392ae0095a27c817389f2934610abe9893aaca0",
    "policyDigest": "sha256:848f710ef2ffbd75acdfaa3dd6b780d101d4a1f729a6b082d43e7ab1e6eb2afe",
    "summary": "Looking up the last page of a chapter gives the wrong chapter. Both page and chapter numbers start at one."
  },
  "v2-r02-t04": {
    "sourceDigest": "sha256:4f40690adb9c7696e736414971357d0cc636f3aac412c83ee583d7a668310673",
    "policyDigest": "sha256:848ff01ec02c2cea164ccae55ad509a2d13b59fcb8aa7aba8da77815711349da",
    "summary": "A later reading session replaces a book’s earlier total. Add all its sessions and keep books in first-seen order."
  },
  "v2-r02-t05": {
    "sourceDigest": "sha256:c928620e20a4f0e9727068e82f9a5dcba8a7d280bb09de13efc00c8cd1ce8279",
    "policyDigest": "sha256:9430601bad31e34fb5885b72f0374a64e07e4a9128349e6ea72ea9d8c71825b1",
    "summary": "Progress at an exact half percent uses the wrong rounding rule. Round halfway values upward."
  },
  "v2-r03-t01": {
    "sourceDigest": "sha256:048c6fafc72c46a39d0c010480689363fef99db0973b0a83ba5513eb4c3afc0e",
    "policyDigest": "sha256:4c6739355a9da6ce70ee7a5f02b291af509bd36147e01bafb4588186625cdeb2",
    "summary": "Blank rows and missing cells erase the remembered value of a column. Keep that value for later blank cells."
  },
  "v2-r03-t02": {
    "sourceDigest": "sha256:fadeaa7547f295fb8c022469c6276ceb2f65496bb8bce17043703edf8797aa82",
    "policyDigest": "sha256:8e0c36a17027968bd9933e586da61b19fdb7c3e53e510c453a4997d07cde2f21",
    "summary": "The transpose function replaces existing null cells with padding. Use padding only where a cell is missing."
  },
  "v2-r03-t03": {
    "sourceDigest": "sha256:5f05d5a856fadb9be4c8889d446cedd77b578cf9c5527665eed1b5f84390ee76",
    "policyDigest": "sha256:a6d63ba20e850d2e66f379057d6480694726a57852bcba640043d50c04abdbd5",
    "summary": "The function drops a complete window that ends exactly at the worksheet boundary. Include it; omit only incomplete windows."
  },
  "v2-r03-t04": {
    "sourceDigest": "sha256:52d976a2c599cba09df6fa0ef7f210325e5ddb369f50bdc6549ace41814e3b5d",
    "policyDigest": "sha256:0c522be1197f041ee10df16f9cf59cc759f20dba6622502ff04922991e18bff4",
    "summary": "Column counts ignore zero-valued cells. Count every integer, including zero and negative values."
  },
  "v2-r03-t05": {
    "sourceDigest": "sha256:9c17822fc8e8b8b8c982337f84dac822c4fe75f1b6b2686abb4dea6988ca8886",
    "policyDigest": "sha256:685910bc721f5e8b703193cea2733b355f7bf96c29cb0366a242c8148d035486",
    "summary": "The function removes later rows that match an earlier row. Collapse consecutive duplicates; keep separated repeats."
  },
  "v2-r04-t01": {
    "sourceDigest": "sha256:c4ec4248c6ba54f8c8087fb02bb6e16682afa7f56861a96fb57dd55a2f66c86b",
    "policyDigest": "sha256:7eb2b849bb7f5fcb2434c8a1e7baa5400ad3c653a9856e25a955152433802302",
    "summary": "Combining colored bands currently moves separated colors together. Merge adjacent matches and preserve the pattern’s order."
  },
  "v2-r04-t02": {
    "sourceDigest": "sha256:55ed96cc1039af5c62f209b2c79fa969b54beb7654f9e75ed5512ff42790bd3c",
    "policyDigest": "sha256:400abe478bb1ab83f86b19a2dcc679ceba889fe3e0bc46506825ee66e31b3427",
    "summary": "Cutting out a ribbon span loses bands that overlap either edge. Keep the overlapping part of each band."
  },
  "v2-r04-t03": {
    "sourceDigest": "sha256:545c7a1b59aa25df51f0da2ed6582c91b778edf3366f96a07addd6fb75e9888e",
    "policyDigest": "sha256:625d9e0a554cb079d9f098309ae3d94a2612c31e82640e896a8c1365e566efca",
    "summary": "The repeat function duplicates each band separately. Repeat the full sequence instead."
  },
  "v2-r04-t04": {
    "sourceDigest": "sha256:af3019596bfc204c74ab584c322a505fa2351ab4987973e36ba21a12d4d3f799",
    "policyDigest": "sha256:114bba4fb519c453d589b613307d505c40b803a24411bbd677c9760822f58516",
    "summary": "Color totals are sorted alphabetically. Keep the order in which each color first appears in the pattern."
  },
  "v2-r04-t05": {
    "sourceDigest": "sha256:edb946fa470fd9010715159ce5193b49c8f689db5ad59579d8b5bed993adb1f5",
    "policyDigest": "sha256:256f6510c71f88ba8b089c9867df1c20d5e16a5b8dff0362318790ae7e68f330",
    "summary": "The rotation function counts bands instead of material units. Move the start by the given distance, splitting a band if needed."
  }
};
const phaseNames = { queued: 'Queued', preflight: 'Preflight', baseline_capture: 'Starting checks', repair: 'Repairing', check: 'Checking', export: 'Preparing evidence', terminal: 'Finished' };
const outcomes = {
  verified_for_declared_checks: 'All listed checks passed', needs_review: 'Needs review', failed: 'Checks failed', infrastructure_error: 'Execution error',
};
const state = { tasks: [], runs: new Map(), taskId: '', runId: '', candidateIds: new Map(), contexts: new Map(), ownedRunIds: new Set(), meta: {}, ready: false, busy: false, comparison: null, resultTabs: new Map(), taskQuery: '' };
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
function money(value) { return value === null || value === undefined ? 'Not measured' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value > 0 && value < .01 ? 8 : 2 }).format(value); }
function duration(ms) { return ms === null || ms === undefined ? 'Not measured' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`; }
function count(value) { return new Intl.NumberFormat('en-US').format(value ?? 0); }
function time(value) { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
function taskFor(id) { return state.tasks.find(task => task.id === id); }
function currentTask() { return taskFor(state.taskId); }
function mockSupported(task) { return task?.mockSupported === true; }
function isLive() { return state.meta.mode === 'live'; }
function taskSupported(task) { return isLive() ? task?.executionSupported === true : mockSupported(task); }
function checkBackendLabel(backend) {
  return backend === 'local_container' ? 'Local Docker checks' : backend === 'nebius_sandbox' ? 'Nebius Sandbox checks' : 'Check runtime not recorded';
}
function runtimeFor(run) {
  if (run.phase === 'terminal') return runContext(run).execution;
  return run.mode === state.meta.mode && run.runtimeLockDigest === state.meta.runtimeLockDigest ? state.meta.execution : undefined;
}
function providerCost(run) {
  return `${money(run.usage.measuredCostUsd)}${run.usage.measuredCostUsd !== null && run.usage.costIsEstimate ? ' (estimate)' : ''}`;
}
function isArchive() { return state.meta.mode === 'archive'; }
function canCreate() { return state.ready && !isArchive() && state.meta.capabilities?.createRuns === true && (state.meta.mode === 'mock' || isLive() && state.meta.realExecutionEnabled === true); }
function canCancel(run) { return state.ready && !isArchive() && state.meta.capabilities?.cancelRuns === true && (!isLive() || state.ownedRunIds.has(run?.id)); }
function modeLabel(run) {
  if (isArchive()) return run.mode === 'live' ? 'Recorded live · Read only' : 'Recorded mock · Read only';
  return run.mode === 'mock' ? 'Mock model · Local checks' : run.phase === 'terminal' ? 'Recorded live' : 'Live model';
}
function renderMode() {
  byId('workspace-intro').textContent = isArchive() ? 'Choose a task and inspect its saved patches and checks. This archive cannot start new repairs.' : isLive() ? 'Choose a small Python bug. Generate patch asks the live model for a repair, then checks it against the requirements. You review the change; nothing is merged.' : 'Choose a small Python bug. Generate patch uses a scripted response, runs local checks, and opens the result for review. No live model is called.';
  byId('demo-link').hidden = !isLive();
  byId('footer-demo-link').hidden = !isLive();
  byId('mode-indicator').textContent = isArchive() ? 'Read-only archive' : isLive() ? 'Live model' : 'Mock model';
  byId('mode-label').textContent = 'About this workspace';
  byId('mode-description').textContent = isArchive()
    ? 'Saved runs only. Each record keeps its original live or mock label. Viewing a record does not run code.'
    : isLive() ? `Nebius Token Factory generates patches. ${checkBackendLabel(state.meta.execution?.checkBackend)} test them. Nothing is merged automatically.`
      : 'Scripted responses with local checks. No real model inference; mock results are not competition-ready evidence.';
  byId('comparison-notice').textContent = isArchive() ? 'Saved runs only. Different modes or limits cannot form a matched comparison.'
    : isLive() ? 'Each approach gets the same limits. A few runs on one example do not establish which approach is better.'
      : 'Scripted mock responses demonstrate the workflow. They do not measure model performance.';
}
function runsForTask() { return [...state.runs.values()].filter(run => run.taskId === state.taskId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
function runName(run) { return `${runTitle(run)} · ${variants[run.variant]?.name ?? run.variant}${run.phase === 'terminal' ? ` · recorded ${run.mode}` : ` · ${run.mode}`} · ${time(run.createdAt)}`; }

// The server validates immutable evidence. The UI binds its saved task projection to
// this exact run, independently of a catalogue that may reuse the same task ID.
function sameJson(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}
function runContext(run) {
  if (run.phase === 'terminal') {
    const context = state.contexts.get(run.id);
    return context && sameJson(context.run, run) ? context : { status: 'loading', fixture: null };
  }
  const task = taskFor(run.taskId);
  return task && task.sourceDigest === run.sourceDigest && task.policyDigest === run.policyDigest
    ? { status: 'ready', fixture: task } : { status: 'unavailable', fixture: null };
}
function runTitle(run) { return runContext(run).fixture?.title ?? run.taskId; }
function contextMessage(run, context) {
  if (context.status === 'ready') return run.phase === 'terminal' ? 'Task statement saved with this run.' : 'Task statement matches the recorded inputs.';
  if (context.status === 'loading') return 'Loading the saved task statement…';
  return run.phase === 'terminal' ? 'Saved task statement unavailable or mismatched. Requirement text is withheld.' : 'Task statement unavailable for these recorded inputs.';
}
async function loadRunContext(run, retry = false) {
  if (!state.ready || run.phase !== 'terminal') return;
  const previous = state.contexts.get(run.id);
  if (!retry && previous && sameJson(previous.run, run)) return;
  const context = { run: structuredClone(run), status: 'loading', fixture: null };
  state.contexts.set(run.id, context);
  if (retry && state.runId === run.id) renderEvidence();
  try {
    const bundle = await request(`/runs/${encodeURIComponent(run.id)}/evidence`);
    const fixture = bundle.fixture;
    const archivePin = state.meta.bundles?.find(entry => entry.runId === run.id)?.bundleDigest;
    if (bundle.format !== 'patchproof-evidence-v2' || bundle.schemaVersion !== run.schemaVersion || bundle.mode !== run.mode ||
        bundle.competitionReady !== false || !sameJson(bundle.run, run) || fixture?.id !== run.taskId ||
        typeof fixture.title !== 'string' || !Array.isArray(fixture.requirements) ||
        fixture.requirements.some(row => typeof row.id !== 'string' || typeof row.text !== 'string') ||
        new Set(fixture.requirements.map(row => row.id)).size !== fixture.requirements.length ||
        fixture.requirements.length !== run.coverage.length || run.coverage.some(row => !fixture.requirements.some(item => item.id === row.requirementId)) ||
        (isArchive() && archivePin !== bundle.bundleDigest)) throw new Error('Saved task context does not match this run.');
    // Retain only detached display data. Do not relabel it from later catalogue responses.
    context.fixture = Object.freeze({ id: fixture.id, title: fixture.title,
      requirements: Object.freeze(fixture.requirements.map(row => Object.freeze({ id: row.id, text: row.text }))) });
    const execution = bundle.runtimeLock?.execution;
    context.execution = execution && typeof execution === 'object' ? Object.freeze({
      modelProvider: typeof execution.modelProvider === 'string' ? execution.modelProvider : null,
      modelId: typeof execution.modelId === 'string' ? execution.modelId : null,
      checkBackend: ['local_container', 'nebius_sandbox'].includes(execution.checkBackend) ? execution.checkBackend : null,
    }) : bundle.runtimeLock?.localExecution?.available === true && typeof bundle.runtimeLock?.localCheckImage === 'string'
      ? Object.freeze({ checkBackend: 'local_container', modelProvider: null, modelId: null }) : undefined;
    context.story = projectStory(bundle);
    context.status = 'ready';
  } catch { context.status = 'error'; }
  if (state.contexts.get(run.id) !== context || !sameJson(state.runs.get(run.id), context.run)) return;
  renderRunPicker(); renderComparison(); renderWalkthrough();
  if (state.runId === run.id) renderEvidence();
}

function selectedCandidate(run) { return run.candidates.find(candidate => candidate.id === run.selectedCandidateId); }
function outcome(run) { return outcomes[run.terminalStatus] ?? phaseNames[run.phase] ?? run.phase; }
function outcomeClass(run) { return run.terminalStatus === 'failed' || run.terminalStatus === 'infrastructure_error' ? 'fail' : run.terminalStatus === 'needs_review' ? 'warn' : ''; }
function humanReason(reason) {
  const labels = { declared_requirements_unverified: 'Checks could not finish. This patch has not been verified.', declared_local_checks_passed: 'The patch passes every listed check.', declared_checks_not_satisfied: 'Some checks failed. No patch was approved.', cancelled: 'The run was cancelled. Completed results are preserved for review.', timeout: 'The run reached its elapsed-time limit. Review the partial results.', interrupted_by_restart: 'Execution was interrupted by a service restart.', evidence_publish_failed: 'Execution ended, but the evidence bundle could not be published.' };
  return labels[reason] ?? reason.replaceAll('_', ' ');
}
function announce(text) { byId('announcer').textContent = text; }
function clearError() { byId('error').hidden = true; byId('error').replaceChildren(); }
function showError(error) {
  const box = byId('error'); box.hidden = false;
  box.replaceChildren(el('span', '', error instanceof Error ? error.message : 'The request could not be completed.'), button('Dismiss', clearError, ''));
}
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: options.signal ?? AbortSignal.timeout(20000) });
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
  const view = ['story', 'tasks', 'runs', 'compare', 'evidence'].includes(rawView) ? rawView : 'story';
  if (id && view === 'evidence') state.runId = id;
  for (const name of ['story', 'tasks', 'runs', 'compare', 'evidence']) byId(`${name}-view`).hidden = name !== view;
  document.querySelectorAll('[data-nav]').forEach(node => {
    if (node.dataset.nav === (view === 'evidence' ? 'runs' : view)) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  });
  if (view === 'story') renderWalkthrough();
  if (view === 'runs') renderHistory();
  if (view === 'compare') renderComparison();
  if (view === 'evidence') {
    renderRunPicker(); renderEvidence();
    if (state.ready && state.runId && !state.runs.has(state.runId)) refreshRun(state.runId).catch(showError);
  }
}
function renderWalkthrough() { renderStory(byId('story'), state, location.hash.split('/')[1]); }
function chooseTask(id) {
  const taskHadFocus = document.activeElement?.classList.contains('task-card');
  state.taskId = id;
  renderTasks(); renderTaskDetail(); renderTaskPicker(); renderComparison();
  if (taskHadFocus) document.querySelector('.task-card[aria-pressed="true"]')?.focus({ preventScroll: true });
}
function renderTasks() {
  const query = state.taskQuery.toLowerCase().trim();
  const tasks = state.tasks.filter(task => [task.title, task.description, task.repoId, task.id].join(' ').toLowerCase().includes(query));
  byId('task-count').textContent = `${tasks.length} of ${state.tasks.length}`;
  byId('task-list').replaceChildren(...tasks.map(task => {
    const node = button('', () => chooseTask(task.id), 'task-card');
    node.setAttribute('aria-pressed', String(task.id === state.taskId)); node.dataset.taskId = task.id;
    append(node, el('span', 'task-title', task.title), el('span', 'task-meta', `${task.repoId ?? task.id} · ${task.requirements.length} requirements`));
    return node;
  }));
  if (!tasks.length) byId('task-list').append(el('p', 'empty-small', state.tasks.length ? 'No examples match. Try another search.' : 'No examples are available.'));
  byId('mobile-task').replaceChildren(...state.tasks.map(task => new Option(task.title, task.id, false, task.id === state.taskId)));
}
function renderTaskPicker() {
  byId('compare-task').replaceChildren(...state.tasks.map(task => new Option(task.title, task.id, false, task.id === state.taskId)));
  byId('compare-run').disabled = !canCreate() || state.busy || !taskSupported(currentTask());
  byId('compare-run').hidden = !canCreate();
  byId('compare-run').textContent = isLive() ? `Run all three · ${money((state.meta.limits?.maxApprovedSpendUsd ?? 0) * 3)} maximum` : 'Run all three';
}
function disclosure(title, ...children) { return append(el('details', 'disclosure'), el('summary', '', title), ...children); }
function renderTaskDetail() {
  const task = currentTask(); if (!task) return;
  const requirements = el('ol', 'requirements');
  for (const requirement of task.requirements) append(requirements, append(el('li'), el('span', 'requirement-id', requirement.id), el('span', '', requirement.text)));
  const latest = runsForTask()[0]; const limits = state.meta.limits;
  const start = button('Generate patch', () => launch(['patchproof']), 'button primary');
  start.disabled = !canCreate() || state.busy || !taskSupported(task);
  const actions = append(el('div', 'task-actions actions'), !isArchive() && start, latest && link('Latest result', `#evidence/${latest.id}`, 'button'), link('Compare approaches', '#compare'));
  const sentences = task.description.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [task.description];
  const savedCopy = taskCopy[task.id];
  const brief = savedCopy?.sourceDigest === task.sourceDigest && savedCopy?.policyDigest === task.policyDigest ? savedCopy.summary : sentences.find(sentence => !/^\s*(Repair|Restore)\b/.test(sentence) && /\b(refactor|shortcut|optimization|off-by-one|wrong|unexpectedly|loses|drops|current|repeated page marks)\b/i.test(sentence))?.trim() ?? sentences[0].trim();
  const allowance = el('div', 'allowance');
  append(allowance, el('p', '', isArchive() ? 'Read only. This workspace cannot start repairs.' : isLive()
    ? `${money(limits?.maxApprovedSpendUsd)} maximum per run. Project ceiling: ${money(state.meta.maxApprovedSpendUsd)}. ${Number.isInteger(state.meta.availability?.remainingRuns) ? `${state.meta.availability.remainingRuns} runs remain in the current allowance.` : ''}`
    : 'Mock model · Local checks. $0 provider spend. No paid inference.'),
    isLive() && el('p', 'model-name', `Model: ${state.meta.execution?.modelId ?? 'Not recorded'}. ${checkBackendLabel(state.meta.execution?.checkBackend)}.`),
    limits && el('p', '', `${limits.inferenceCallLimit} model calls · ${count(limits.inputTokenLimit)} input / ${count(limits.outputTokenLimit)} output tokens · ${limits.wallTimeLimitSeconds} s elapsed · ${limits.sandboxCpuSecondsLimit} s CPU allowance. Unmeasured CPU is not treated as zero.`));
  byId('task-detail').replaceChildren(...[
    append(el('div', 'task-intro'), el('p', 'eyebrow', task.repoId ?? 'Python example'), el('h2', '', task.title), el('p', 'task-description', brief)),
    actions,
    el('p', 'fine-print run-cost', isArchive() ? 'Saved results only.' : isLive() ? `${money(limits?.maxApprovedSpendUsd)} maximum · Up to ${limits?.wallTimeLimitSeconds ?? 300} seconds · Review before applying` : 'Scripted mock response · No model charge'),
    !isArchive() && (!canCreate() || !taskSupported(task)) && el('p', 'availability-note', state.meta.availability?.reason ?? (isLive() ? 'New runs are unavailable for this task. Saved results are still available.' : 'This example needs a connected model. Scripted repair is unavailable.')),
    disclosure('Full requirements', el('p', 'task-description', task.description), requirements),
    disclosure('Run limits', allowance),
  ].filter(Boolean));
}
function renderHistory() {
  const node = byId('run-history'); if (!node) return;
  const runs = [...state.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  node.replaceChildren(...runs.map(run => {
    const row = link('', `#evidence/${run.id}`, 'history-row');
    return append(row, append(el('div', 'history-main'), el('h2', '', runTitle(run)), el('p', 'history-meta', `${variants[run.variant]?.name ?? run.variant} · ${new Date(run.createdAt).toLocaleString()} · ${modeLabel(run)}`)),
      append(el('div', 'history-result'), el('span', `outcome ${outcomeClass(run)}`, outcome(run)), el('span', 'history-meta', `${duration(run.usage.elapsedMs)} · ${providerCost(run)}`)));
  }));
  if (!runs.length) node.append(empty('No runs yet', 'Choose an example to generate your first patch.', 'Browse examples', '#tasks'));
}
async function launch(selectedVariants) {
  if (!canCreate() || state.busy || !taskSupported(currentTask())) return;
  const taskId = state.taskId, mode = state.meta.mode;
  const sequential = isLive() && selectedVariants.length > 1;
  state.busy = true; clearError(); renderTaskDetail(); renderTaskPicker(); renderComparison();
  try {
    for (const [index, variant] of selectedVariants.entries()) {
      if (sequential) {
        if (!canCreate()) throw new Error(`Comparison stopped before ${variants[variant].name}. ${state.meta.availability?.reason ?? 'New runs are unavailable.'}`);
        state.comparison = { index: index + 1, total: selectedVariants.length, variant }; renderComparison();
      }
      const run = await request('/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, variant, mode, idempotencyKey: crypto.randomUUID() }) });
      storeRun(run); state.runId = run.id;
      if (selectedVariants.length === 1) location.hash = `evidence/${run.id}`;
      else location.hash = 'compare';
      if (isLive()) {
        const history = await request('/runs');
        state.ownedRunIds = new Set(history.ownedRunIds ?? []);
        if (history.availability) applyAvailability(history.availability);
      }
      if (sequential) {
        const completed = await waitForComparisonRun(run.id);
        const usable = completed.terminalStatus === 'verified_for_declared_checks' ||
          completed.terminalStatus === 'failed' && completed.reason === 'declared_checks_not_satisfied';
        if (!usable || /cancel|timeout/.test(completed.reason ?? '')) {
          throw new Error(`Comparison stopped after ${variants[variant].name}: ${completed.reason ? humanReason(completed.reason) : outcome(completed)} No later approach was started.`);
        }
      }
    }
    if (sequential) announce('Comparison finished. All three recorded approaches are available for review.');
    else announce(`${selectedVariants.length === 1 ? 'Run' : 'Comparison'} started. Execution events will appear as they arrive.`);
  } catch (error) { showError(error); }
  finally { state.busy = false; state.comparison = null; renderTaskDetail(); renderTaskPicker(); renderComparison(); renderRunPicker(); renderEvidence(); }
}
async function waitForComparisonRun(id) {
  const deadline = performance.now() + 330000, signal = AbortSignal.timeout(330000);
  try {
    while (performance.now() < deadline) {
      await refreshRun(id, signal);
      const run = state.runs.get(id);
      if (run?.phase === 'terminal') {
        // A concurrent SSE refresh may have stored terminal before its metadata request finishes.
        const meta = await request('/tasks', { signal });
        if (meta.mode !== state.meta.mode || meta.runtimeLockDigest !== state.meta.runtimeLockDigest) throw new Error('The workspace changed. Reload before starting another approach.');
        if (meta.availability) applyAvailability(meta.availability);
        renderTasks(); renderTaskDetail(); renderTaskPicker();
        return run;
      }
      await new Promise(done => setTimeout(done, Math.max(0, Math.min(500, deadline - performance.now()))));
    }
  } catch (error) { if (!signal.aborted) throw error; }
  throw new Error('Comparison stopped waiting for the active run after 330 seconds. Review or cancel that run; no later approach was started.');
}
function storeRun(run) {
  const previous = state.runs.get(run.id);
  state.runs.set(run.id, run);
  if (run.phase === 'terminal') {
    void loadRunContext(run);
    streams.get(run.id)?.close(); streams.delete(run.id);
    if (previous && previous.phase !== 'terminal') announce(`${variants[run.variant].name}: ${outcome(run)}.`);
  } else { state.contexts.delete(run.id); watchRun(run.id); }
  if (!pollTimer && [...state.runs.values()].some(item => item.phase !== 'terminal')) pollTimer = setInterval(pollActiveRuns, 2000);
  if (pollTimer && ![...state.runs.values()].some(item => item.phase !== 'terminal')) { clearInterval(pollTimer); pollTimer = undefined; }
}
function watchRun(id) {
  if (!state.ready || isArchive() || state.meta.capabilities?.streamEvents === false) return;
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
function applyAvailability(availability) {
  state.meta.availability = availability;
  state.meta.capabilities.createRuns = availability.enabled === true;
  state.meta.realExecutionEnabled = availability.enabled === true;
}
async function refreshRun(id, signal) {
  if (refreshing.has(id)) return;
  refreshing.add(id);
  try {
    const run = await request(`/runs/${encodeURIComponent(id)}`, { signal }); storeRun(run);
    if (isLive() && run.phase === 'terminal') {
      const meta = await request('/tasks', { signal });
      if (meta.availability) applyAvailability(meta.availability);
      renderTasks(); renderTaskDetail(); renderTaskPicker();
    }
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
function coverageText(run) { return `${run.coverage.filter(row => row.status === 'pass').length} / ${run.coverage.length}`; }
function matchedContext(runs) {
  if (runs.length < 3) return { matched: false, message: isArchive() ? 'The archive needs all three approaches to compare their source, policy and resource limits.' : 'Run all three approaches to compare their source, policy and resource limits.' };
  const signature = run => JSON.stringify([run.schemaVersion, run.sourceDigest, run.policyDigest, run.runtimeLockDigest, run.mode, Object.entries(run.limits).sort()]);
  const matched = runs.every(run => signature(run) === signature(runs[0]));
  return { matched, message: matched ? 'All three runs used the same inputs and resource limits.' : isArchive() ? 'These recorded runs have different modes, inputs or limits. They are not a matched comparison.' : 'These runs have different inputs or limits. Start a new comparison before drawing conclusions.' };
}
function renderComparison() {
  const runs = runsForTask();
  const latest = Object.keys(variants).map(variant => runs.find(run => run.variant === variant));
  const match = matchedContext(latest.filter(Boolean));
  const context = append(el('div', 'comparison-context'), pill(match.matched ? 'Same inputs and limits' : 'Comparison details', match.matched ? '' : 'neutral'), el('span', '', match.message));
  if (state.comparison) {
    const pending = el('p', 'stream-note', `Live comparison · approach ${state.comparison.index} of ${state.comparison.total}: ${variants[state.comparison.variant].name}. Waiting for its recorded completion before starting another approach.`);
    pending.setAttribute('role', 'status'); context.append(pending);
  }
  const cards = el('div', 'variant-grid');
  Object.entries(variants).forEach(([key, variant], index) => {
    const run = latest[index]; const card = el('article', `variant-card${key === 'patchproof' ? ' featured' : ''}`);
    append(card, el('p', 'variant-kicker', variant.label), el('h2', '', variant.name), el('p', 'variant-description', variant.description));
    if (run) {
      append(card, pill(modeLabel(run), 'neutral'));
      append(card, el('p', 'run-meta', `${run.phase === 'terminal' ? 'Recorded task' : 'Task'}: ${runTitle(run)}`));
      append(card, el('p', `outcome ${outcomeClass(run)}${run.phase !== 'terminal' ? ' busy-indicator' : ''}`, outcome(run)),
        metrics([['Requirements passing', coverageText(run)], ['Patch attempts', run.candidates.length], ['Elapsed', duration(run.usage.elapsedMs)], [run.usage.costIsEstimate ? 'Estimated model cost' : 'Model cost', providerCost(run)]]),
        run.phase !== 'terminal' && progress(run), link('View result', `#evidence/${run.id}`, 'button'));
    } else {
      if (!canCreate()) {
        append(card, el('p', 'empty-small', isArchive() ? 'No recorded run for this approach in the archive.' : 'No recorded run for this approach. New runs are unavailable.'));
        cards.append(card); return;
      }
      append(card, el('p', 'empty-small', taskSupported(currentTask()) ? 'No run for this task yet.' : isLive() ? 'New runs are unavailable for this task.' : 'Requires a connected model. Local scripted repair is unavailable for this task.'));
    }
    if (canCreate()) {
      const start = button('Run this approach', () => launch([key]), 'button');
      start.disabled = state.busy || !taskSupported(currentTask());
      card.append(start);
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
  byId('comparison').replaceChildren(context, cards, el('p', 'table-scroll-hint', 'Scroll the table → to compare every approach.'), tableWrap, el('p', 'fine-print', isArchive() ? 'Recorded usage / limit. Unknown values remain unmeasured. Mock counters describe scripted operations; an archive digest does not authenticate live-provider measurements.' : isLive() ? 'Recorded usage / limit. Estimates are labeled; unknown cost and CPU stay unmeasured. Older mock runs retain their own mode labels.' : 'Usage / limit. Mock model counters describe scripted operations; they are not measurements of real model inference.'));
}
function renderRunPicker() {
  renderHistory();
  const picker = byId('evidence-run');
  const runs = [...state.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!state.runId && runs.length) state.runId = runs[0].id;
  picker.replaceChildren(...(runs.length ? runs.map(run => new Option(runName(run), run.id, false, run.id === state.runId)) : [new Option('No runs yet', '')]));
}
function displayedCandidate(run) {
  return run.candidates.find(item => item.id === (state.candidateIds.get(run.id) ?? run.selectedCandidateId)) ?? run.candidates.at(-1);
}
function candidatePicker(run) {
  const picker = el('div', 'candidate-tabs'); picker.setAttribute('aria-label', 'Patch attempts');
  const current = displayedCandidate(run);
  for (const candidate of run.candidates) {
    const checked = [...candidate.visibleChecks, ...candidate.acceptanceChecks];
    const status = candidate.accepted ? 'Passed' : checked.some(check => check.status === 'error') ? 'Check error' : checked.some(check => check.status === 'fail') ? 'Failed' : 'Unverified';
    const label = `Attempt ${candidate.id} · ${status}${candidate.id === run.selectedCandidateId ? candidate.accepted ? ' · Final patch' : ' · Kept for review' : ''}`;
    const control = button(label, () => { state.candidateIds.set(run.id, candidate.id); renderEvidence(); document.querySelector('.candidate-tab[aria-pressed="true"]')?.focus({ preventScroll: true }); }, 'candidate-tab');
    control.setAttribute('aria-pressed', String(candidate.id === current?.id)); picker.append(control);
  }
  return picker;
}
function candidateHistory(run) {
  const candidate = displayedCandidate(run);
  if (!candidate) return empty('No patch yet', run.phase === 'terminal' ? 'The run stopped before a patch was produced. See Activity for the recorded events.' : 'The model is working. This page updates automatically.');
  const wrapper = el('div');
  append(wrapper, el('h2', '', `Patch from attempt ${candidate.id}`), el('p', 'fine-print', candidate.accepted ? 'Passes the listed checks. Review the change before applying it.' : 'This attempt is not approved. Review the failed checks before using it.'));
  if (candidate.diff) {
    const diff = el('pre', 'diff'); diff.tabIndex = 0; diff.setAttribute('aria-label', `Patch for attempt ${candidate.id}`); const code = el('code');
    for (const line of candidate.diff.split('\n')) append(code, el('span', `diff-line${line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ') ? ' heading' : line.startsWith('+') ? ' add' : line.startsWith('-') ? ' remove' : ''}`, line || ' '));
    diff.append(code); wrapper.append(diff);
  } else wrapper.append(el('p', 'no-diff', 'No source changes in this attempt.'));
  append(wrapper, disclosure('Model summary', el('p', 'candidate-description', candidate.summary), el('p', 'fine-print', 'Written by the model. The check results determine whether the patch passed.')));
  return wrapper;
}
function checkStatus(status) { return pill(status === 'pass' ? 'Passed' : status === 'fail' ? 'Failed' : status === 'error' ? 'Error' : 'Unverified', status === 'pass' ? '' : status === 'fail' || status === 'error' ? 'fail' : 'warn'); }
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
  for (const check of [...checks].sort((a, b) => Number(a.status === 'pass') - Number(b.status === 'pass'))) {
    const row = el('div', 'check-row');
    append(row, append(el('div', 'check-heading'), el('span', 'check-name', `${check.requirementId} · ${check.id}`), checkStatus(check.status)), el('p', '', check.status === 'error' ? 'This check did not produce a verified result.' : check.status === 'fail' ? 'The observed result did not match the expected result.' : 'The observed result matches the expected result.'));
    if (check.status === 'fail') append(row, el('pre', 'check-values', `Expected: ${JSON.stringify(check.expected)}\nObserved: ${JSON.stringify(check.actual)}`));
    const details = el('details');
    append(details, el('summary', '', `Observed result and log · ${duration(check.durationMs)}`), el('p', '', check.message), el('pre', 'check-log', checkLog(check)));
    append(group, append(row, details));
  }
  return group;
}
function coveragePanel(run) {
  const context = runContext(run);
  const requirements = context.fixture?.requirements ?? [];
  const list = el('ul', 'coverage-list');
  for (const row of run.coverage) {
    const requirement = requirements.find(item => item.id === row.requirementId);
    const text = requirement?.text ?? (context.status === 'loading' ? 'Loading saved requirement text…' : 'Requirement text unavailable.');
    append(list, append(el('li', 'coverage-row'), append(el('div', 'coverage-row-header'), el('span', 'requirement-id', row.requirementId), checkStatus(row.status)), el('p', '', text), el('p', 'check-ids', row.checkIds.length ? row.checkIds.join(' · ') : 'No supporting checks recorded')));
  }
  if (!run.coverage.length) append(list, el('li', 'empty-small', 'No requirement coverage recorded.'));
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
    [run.usage.costIsEstimate ? 'Estimated model cost' : 'Model cost', providerCost(run)],
    ['Per-run spend limit', money(run.limits.maxApprovedSpendUsd)],
    ['Model operations / limit', `${count(run.usage.inferenceCalls)} / ${count(run.limits.inferenceCallLimit)}`],
    ['Input tokens / limit', `${count(run.usage.inputTokens)} / ${count(run.limits.inputTokenLimit)}`],
    ['Output tokens / limit', `${count(run.usage.outputTokens)} / ${count(run.limits.outputTokenLimit)}`],
    ['Elapsed / limit', `${duration(run.usage.elapsedMs)} / ${run.limits.wallTimeLimitSeconds} s`],
    ['Sandbox CPU / limit', `${run.usage.sandboxCpuSeconds === null ? 'Not measured' : `${run.usage.sandboxCpuSeconds.toFixed(2)} s`} / ${run.limits.sandboxCpuSecondsLimit} s`],
  ], 'accounting'), el('p', 'fine-print', run.mode === 'mock' ? 'Model operations and token counts come from scripted responses. No paid inference was performed. Local electricity and hardware cost are not billed or measured here.' : 'Estimated provider cost is labeled separately from measured billing. Unknown charges and CPU stay unmeasured; local electricity and hardware costs are not included.'));
  return panel('Cost and limits', 'Usage across every attempt in this run.', body);
}
function provenancePanel(run) {
  const body = el('div', 'panel-body'); const list = el('dl', 'digest-list');
  const candidate = selectedCandidate(run);
  for (const [name, value] of [['Repair approach', run.variant], ['Source snapshot', run.sourceDigest], ['Acceptance policy', run.policyDigest], ['Runtime lock', run.runtimeLockDigest], ['Run ID', run.id], ['Model identifier', candidate?.modelId ?? (run.mode === 'mock' ? 'Mock response provider; no model inference.' : 'Not recorded')], ['Provider request ID', candidate?.providerRequestId ?? 'Not recorded']]) append(list, el('dt', '', name), el('dd', '', value));
  if (candidate?.sandboxOperationIds.length) append(list, el('dt', '', 'Selected candidate operation IDs'), el('dd', '', candidate.sandboxOperationIds.join('\n')));
  if (isArchive()) {
    const entry = state.meta.bundles?.find(item => item.runId === run.id);
    if (entry) append(list, el('dt', '', 'Pinned archive bundle'), el('dd', '', entry.bundleDigest));
    append(list, el('dt', '', 'Archive verification'), el('dd', '', 'Integrity and approved public fixture match verified at load. Provider and billing authenticity not established.'));
  }
  if (run.mode === 'live') {
    const runtime = runtimeFor(run);
    append(list, el('dt', '', 'Check runtime'), el('dd', '', checkBackendLabel(runtime?.checkBackend)));
    if (runtime?.modelProvider === 'nebius-token-factory') append(list, el('dt', '', 'Model service'), el('dd', '', 'Nebius Token Factory'));
  }
  append(body, list);
  if (run.phase === 'terminal' && run.mode === 'live' && runtimeFor(run)?.checkBackend !== 'local_container') {
    append(body, el('p', 'fine-print', 'Replay of recorded live evidence is a separate operator action requiring an approved private configuration and its digest. This viewer does not execute checks.'),
      el('code', 'reproduce-command', `make reproduce RUN=${run.id} CONFIG=<private-replay.json> CONFIG_DIGEST=<digest>`),
      el('p', 'fine-print', 'The download preserves the original evidence and historical commands. Use the current private replay instructions; replay may incur separately authorized provider charges.'));
  } else if (run.phase === 'terminal') append(body, el('p', 'fine-print', 'Save the downloaded bundle under artifacts/product/exports/<run-id>.json in the source checkout recorded by this run, then execute:'), el('code', 'reproduce-command', `make reproduce RUN=${run.id}`), el('p', 'fine-print', 'The export records its inputs and digests. Replay is a separate fresh check execution; it does not rerun model inference.'));
  return panel('Reproduce this run', 'Saved inputs, request IDs and replay instructions.', body);
}
async function cancelRun(id, control) {
  if (!canCancel(state.runs.get(id))) return;
  control.disabled = true;
  try {
    const run = await request(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    storeRun(run); renderEvidence(); renderComparison(); announce('Cancellation requested. Waiting for the final execution state.');
  } catch (error) { showError(error); control.disabled = false; }
}
function renderEvidence() {
  const container = byId('evidence');
  const sameRun = container.dataset.runId === state.runId;
  const detailKey = node => `${node.closest('[data-panel]')?.dataset.panel ?? ''}:${node.querySelector('summary')?.textContent}`;
  const openDetails = new Set(sameRun ? [...container.querySelectorAll('details[open]')].map(detailKey) : []);
  const focused = sameRun && container.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = node => [node.tagName, node.id, node.getAttribute('aria-label'), node.getAttribute('href'), node.textContent].join('|');
  const previousFocus = focused ? focusKey(focused) : null;
  const run = state.runs.get(state.runId);
  if (!run) { byId('evidence').replaceChildren(empty(state.runId ? 'Loading run…' : 'No runs yet', state.runId ? 'Fetching its saved result.' : 'Choose an example to generate a patch.', state.runId ? null : 'Browse examples', '#tasks')); return; }
  if (location.hash.startsWith('#evidence/') && taskFor(run.taskId) && state.taskId !== run.taskId) {
    state.taskId = run.taskId; renderTasks(); renderTaskDetail(); renderTaskPicker(); renderComparison();
  }
  const context = runContext(run); const candidate = displayedCandidate(run);
  const checks = candidate ? [...candidate.visibleChecks, ...candidate.acceptanceChecks] : [];
  const failed = checks.filter(check => check.status !== 'pass');
  const summary = el('section', 'run-summary'); summary.dataset.contextState = context.status;
  const intro = append(el('div', 'result-heading'), el('p', 'history-meta', `${variants[run.variant]?.name ?? run.variant} · ${new Date(run.createdAt).toLocaleString()} · ${modeLabel(run)}`), el('h2', '', runTitle(run)), el('p', `outcome ${outcomeClass(run)}`, outcome(run)));
  if (context.status !== 'ready') intro.append(el('p', 'run-meta', contextMessage(run, context)));
  if (run.phase !== 'terminal') append(intro, progress(run), el('p', 'stream-note', 'Updates automatically. You can leave and return to this run.'));
  else if (run.terminalStatus !== 'verified_for_declared_checks') intro.append(el('p', 'failure-summary', run.reason ? humanReason(run.reason) : 'No patch was approved. Review the checks and activity.'));
  if (run.phase === 'terminal') intro.append(el('p', 'review-instruction', run.terminalStatus === 'verified_for_declared_checks' ? 'Next: inspect the patch and its checks, then download the record if you want to review or replay it. Applying the change remains your decision.' : 'This is not an approved fix. Start with the checks below to see what failed or could not be verified.'));
  if (checks.length) intro.append(el('p', 'result-counts', `Attempt ${candidate.id}: ${checks.length - failed.length} checks passed · ${failed.filter(check => check.status === 'fail').length} failed · ${failed.filter(check => check.status === 'error').length} errors`));
  const actions = el('div', 'actions');
  if (run.phase === 'terminal' && context.status === 'ready') {
    const download = link('Download evidence', `/runs/${encodeURIComponent(run.id)}/evidence`, 'button'); download.download = `${run.id}.json`; actions.append(download);
  } else if (run.phase === 'terminal' && context.status === 'error') actions.append(button('Retry saved task context', () => loadRunContext(state.runs.get(run.id), true)));
  else if (run.phase !== 'terminal' && canCancel(run)) { const cancel = button('Cancel run', () => cancelRun(run.id, cancel)); actions.append(cancel); }
  append(summary, intro, actions);
  const chosenTab = state.resultTabs.get(run.id) ?? (run.phase !== 'terminal' ? 'activity' : run.terminalStatus === 'verified_for_declared_checks' ? 'patch' : 'checks');
  const tabs = el('div', 'result-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Run result');
  const panels = el('div', 'result-panels'); const definitions = [['patch', 'Patch'], ['checks', 'Checks'], ['activity', 'Activity'], ['details', 'Run details']];
  definitions.forEach(([key, label], index) => {
    const tab = button(label, () => { state.resultTabs.set(run.id, key); renderEvidence(); byId(`result-tab-${key}`).focus({ preventScroll: true }); });
    tab.id = `result-tab-${key}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(key === chosenTab)); tab.setAttribute('aria-controls', `result-panel-${key}`); tab.tabIndex = key === chosenTab ? 0 : -1;
    tab.addEventListener('keydown', event => { let next; if (event.key === 'ArrowRight') next = (index + 1) % definitions.length; if (event.key === 'ArrowLeft') next = (index + definitions.length - 1) % definitions.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = definitions.length - 1; if (next !== undefined) { event.preventDefault(); state.resultTabs.set(run.id, definitions[next][0]); renderEvidence(); byId(`result-tab-${definitions[next][0]}`).focus(); } });
    tabs.append(tab);
    const content = el('section', 'result-panel'); content.id = `result-panel-${key}`; content.dataset.panel = key; content.setAttribute('role', 'tabpanel'); content.setAttribute('aria-labelledby', tab.id); content.tabIndex = 0; content.hidden = key !== chosenTab;
    if (key === 'patch') content.append(candidateHistory(run));
    if (key === 'checks') {
      append(content, el('h2', '', candidate ? `Checks for attempt ${candidate.id}` : 'Check results'), el('p', 'result-counts', checks.length ? `${checks.length - failed.length} passed · ${failed.filter(check => check.status === 'fail').length} failed · ${failed.filter(check => check.status === 'error').length} errors` : 'No checks recorded for a patch yet.'),
        candidate && checksGroup('Task checks', candidate.visibleChecks), candidate && checksGroup('Additional checks', candidate.acceptanceChecks), disclosure('Requirements checked', coveragePanel(run)));
      if (candidate?.rejectionReason) content.append(disclosure('Attempt decision', el('p', '', candidate.rejectionReason)));
      if (run.baselineChecks) content.append(disclosure('Checks before repair', checksGroup('Original task checks', run.baselineChecks.visible), checksGroup('Original additional checks', run.baselineChecks.acceptance)));
    }
    if (key === 'activity') content.append(eventPanel(run));
    if (key === 'details') append(content, accountingPanel(run), provenancePanel(run), el('p', 'fine-print', run.notice || 'Results apply only to the listed checks. No patch is merged automatically.'));
    panels.append(content);
  });
  container.replaceChildren(summary, candidatePicker(run), tabs, panels); container.dataset.runId = run.id;
  for (const details of container.querySelectorAll('details')) details.open = openDetails.has(detailKey(details));
  if (previousFocus) {
    const replacement = [...container.querySelectorAll('button,a,summary,[tabindex]')].find(node => focusKey(node) === previousFocus);
    (replacement ?? byId(`result-tab-${chosenTab}`))?.focus({ preventScroll: true });
  }
}
byId('task-search').addEventListener('input', event => { state.taskQuery = event.target.value; renderTasks(); });
byId('mobile-task').addEventListener('change', event => chooseTask(event.target.value));
byId('compare-task').addEventListener('change', event => chooseTask(event.target.value));
byId('compare-run').addEventListener('click', () => launch(Object.keys(variants)));
byId('evidence-run').addEventListener('change', event => { state.runId = event.target.value; location.hash = `evidence/${state.runId}`; renderEvidence(); });
window.addEventListener('hashchange', () => {
  route();
  if (location.hash.startsWith('#story/')) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    const heading = document.querySelector('#story .story-heading');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
});
window.addEventListener('pagehide', () => { for (const stream of streams.values()) stream.close(); clearInterval(pollTimer); });
route();
try {
  const [meta, history] = await Promise.all([request('/tasks'), request('/runs')]);
  state.meta = meta; state.ready = true; state.tasks = [...meta.tasks].sort((a, b) => Number(taskSupported(b)) - Number(taskSupported(a))); state.taskId = state.tasks[0]?.id ?? '';
  state.ownedRunIds = new Set(history.ownedRunIds ?? []);
  renderMode();
  for (const run of history.runs) storeRun(run);
  renderTasks(); renderTaskDetail(); renderTaskPicker(); renderRunPicker(); renderComparison(); renderEvidence(); route();
} catch (error) {
  showError(new Error(`Could not load the workspace. ${error.message} Reload this page after the API is available.`));
  byId('task-count').textContent = 'Unavailable';
  byId('task-list').replaceChildren(el('p', 'empty-small', 'The task catalogue could not be loaded.'));
}
