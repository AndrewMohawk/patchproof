const byId = id => document.getElementById(id);
let currentRun = null;
let eventSource = null;

async function request(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed.');
  return body;
}

function showError(error) { byId('status').textContent = `Error: ${error.message}`; }

async function refreshEvidence(id) {
  const run = await request(`/runs/${id}`);
  byId('status').textContent = `MOCK · ${run.terminalStatus ?? run.phase} · $0 spent`;
  byId('evidence').textContent = JSON.stringify(run.evidence, null, 2);
  byId('cancel').disabled = run.phase === 'terminal';
  byId('run').disabled = false;
  if (run.evidence) {
    const bundle = await request(`/runs/${id}/evidence`);
    byId('export').href = `/runs/${id}/evidence`;
    byId('export').hidden = false;
    byId('replay').textContent = `Save the download as artifacts/${id}.json, then run make reproduce RUN=${id} DIGEST=${bundle.bundleDigest}. This checks mock file integrity only.`;
    byId('replay').hidden = false;
  }
}

byId('run').addEventListener('click', async () => {
  byId('run').disabled = true;
  byId('export').hidden = true;
  byId('replay').hidden = true;
  byId('events').replaceChildren();
  byId('evidence').textContent = 'Waiting for mock contract record. No execution is taking place.';
  eventSource?.close();
  try {
    const run = await request('/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: byId('task').value, variant: 'baseline', mode: 'mock', idempotencyKey: crypto.randomUUID() }),
    });
    currentRun = run.id;
    byId('cancel').disabled = false;
    byId('status').textContent = 'Mock record accepted. Reading actual handler events…';
    eventSource = new EventSource(`/runs/${run.id}/events`);
    for (const kind of ['state', 'cancel_requested', 'terminal']) {
      eventSource.addEventListener(kind, event => {
        const data = JSON.parse(event.data);
        const item = document.createElement('li');
        item.textContent = `${data.phase}: ${data.message}`;
        byId('events').append(item);
        if (kind === 'terminal') {
          eventSource.close();
          refreshEvidence(run.id).catch(showError);
        }
      });
    }
    eventSource.onerror = () => {
      eventSource.close();
      byId('run').disabled = false;
      showError(new Error('Event stream disconnected. Create another mock record or reload.'));
    };
  } catch (error) { showError(error); byId('run').disabled = false; }
});

byId('cancel').addEventListener('click', async () => {
  if (!currentRun) return;
  try {
    await request(`/runs/${currentRun}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    await refreshEvidence(currentRun);
  } catch (error) { showError(error); }
});

try {
  const { tasks } = await request('/tasks');
  byId('task').replaceChildren(...tasks.map(task => new Option(task.title, task.id)));
  const task = tasks[0];
  byId('description').textContent = task.description;
  byId('requirements').replaceChildren(...task.requirements.map(requirement => {
    const item = document.createElement('li');
    item.textContent = `${requirement.id}: ${requirement.text}`;
    return item;
  }));
  byId('task').disabled = false;
  byId('run').disabled = false;
} catch (error) { showError(error); }
