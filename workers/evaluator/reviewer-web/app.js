'use strict';
const $ = id => document.getElementById(id);
const storageKey = 'patchproof-reviewer-token';
const supplied = new URLSearchParams(location.hash.slice(1)).get('token');
if (supplied) { sessionStorage.setItem(storageKey, supplied); history.replaceState(null, '', location.pathname); }
let token = supplied || sessionStorage.getItem(storageKey) || '', state = null, busy = false, clockOffset = 0;
const showMessage = value => { $('message').textContent = value; };
const element = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
function access(message = '') { $('access').hidden = false; $('study').hidden = true; showMessage(message); }
async function api(path, value) {
  const response = await fetch(path, { method: value === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error?.message || 'The request could not be recorded.'); error.code = result.error?.code; error.status = response.status; throw error; }
  return result;
}
function timer() {
  if (!state || state.status !== 'active') return;
  const remaining = Math.max(0, Date.parse(state.deadlineAt) - (Date.now() + clockOffset));
  const seconds = Math.ceil(remaining / 1000);
  $('time-remaining').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const expired = remaining <= 0;
  $('submit-response').disabled = busy || expired;
  if (expired && $('timeout-message').hidden) $('skip-reason').value = 'timeout';
  $('timeout-message').hidden = !expired; $('timeout-option').disabled = !expired;
  for (const input of document.querySelectorAll('input[name="answer"]')) input.disabled = busy || expired;
}
function render(next) {
  state = next; clockOffset = Date.parse(next.serverNow) - Date.now();
  $('access').hidden = true; $('study').hidden = false;
  $('notice').textContent = next.notice; $('participant').textContent = `Participant ${next.participantId}`;
  $('source-notice').textContent = next.sourceNotice;
  $('progress-label').textContent = `${next.completedAssignments} of ${next.totalAssignments} reviews recorded`;
  $('progress').max = next.totalAssignments; $('progress').value = next.completedAssignments;
  for (const name of ['ready', 'active', 'complete']) $(name).hidden = next.status !== name;
  $('allowance').textContent = `Each task allows up to ${Math.round(next.maxAssignmentMs / 1000)} seconds. No code is executed from this page.`;
  if (next.status !== 'active') return;
  const task = next.packet.tasks[0];
  $('task-number').textContent = `Review ${task.presentationIndex + 1} of ${next.totalAssignments}`;
  $('task-statement').textContent = task.taskStatement; $('patch').textContent = task.patch;
  $('requirements').replaceChildren(...task.requirements.map(requirement => { const row = document.createElement('li'); row.append(element('span', requirement.id, 'requirement-id'), element('span', requirement.text, 'requirement-text')); return row; }));
  $('source-context-card').hidden = !task.sourceContext; $('source-context').textContent = task.sourceContext || '';
  $('observations-card').hidden = !task.observations;
  $('observations').replaceChildren(...(task.observations || []).map(observation => { const card = element('article', '', 'observation'); const values = document.createElement('dl'); values.append(element('dt', 'Expected'), element('dd', observation.expected), element('dt', 'Observed'), element('dd', observation.observed)); card.append(element('h4', `${observation.requirementId} · ${observation.checkDescription}`), values); return card; }));
  $('response-form').reset(); $('skip-reason').value = 'declined'; timer();
}
async function refresh() { try { render(await api('/api/session')); } catch (error) { if (error.status === 401) { token = ''; sessionStorage.removeItem(storageKey); access(error.message); } else showMessage(error.message || 'Connection unavailable. Your recorded responses remain on the server.'); } }
async function act(path, extra = {}) {
  if (busy || !state?.nextAssignmentId) return;
  busy = true; $('open-task').disabled = true; $('skip-task').disabled = true; timer(); showMessage('');
  try {
    render(await api(path, { assignmentId: state.nextAssignmentId, requestId: crypto.randomUUID(), ...extra }));
    if (path === '/api/open') $('task-title').focus();
    else { showMessage(path === '/api/submit' ? 'Your response was recorded.' : 'Your skip was recorded.'); $('main').focus(); }
  } catch (error) { await refresh(); showMessage(error.message || 'Connection unavailable. Refresh to check whether the action was recorded.'); }
  finally { busy = false; $('open-task').disabled = false; $('skip-task').disabled = false; timer(); }
}
$('access-form').addEventListener('submit', async event => { event.preventDefault(); token = $('access-token').value.trim(); sessionStorage.setItem(storageKey, token); await refresh(); });
$('open-task').addEventListener('click', () => act('/api/open'));
$('response-form').addEventListener('submit', event => { event.preventDefault(); const answer = new FormData(event.currentTarget).get('answer'); if (typeof answer === 'string') act('/api/submit', { answer }); });
$('skip-task').addEventListener('click', () => act('/api/skip', { reason: $('skip-reason').value }));
window.addEventListener('pageshow', () => { if (token) refresh(); });
setInterval(timer, 250);
if (token) refresh(); else access();
