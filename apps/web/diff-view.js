// Presentation only: the downloadable patch and immutable evidence are never rewritten.
// Older runs stored whole-file replacement patches. Match equal lines inside those
// replacement blocks so unchanged code remains context rather than a false change.
function align(removed, added) {
  if (!removed.length || !added.length || removed.length * added.length > 2_000_000) return [...removed, ...added];
  const width = added.length + 1, table = new Uint32Array((removed.length + 1) * width);
  for (let i = removed.length - 1; i >= 0; i--) for (let j = added.length - 1; j >= 0; j--) {
    table[i * width + j] = removed[i].text === added[j].text && removed[i].noNewline === added[j].noNewline
      ? table[(i + 1) * width + j + 1] + 1
      : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const rows = []; let i = 0, j = 0;
  while (i < removed.length || j < added.length) {
    if (i < removed.length && j < added.length && removed[i].text === added[j].text && removed[i].noNewline === added[j].noNewline) {
      rows.push({ ...removed[i++], type: 'context', newLine: added[j++].newLine });
    } else if (i < removed.length && (j === added.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) rows.push(removed[i++]);
    else rows.push(added[j++]);
  }
  return rows;
}
export function parseDiff(patch) {
  const files = []; let file, hunk, oldLine = 0, newLine = 0;
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) { file = { path: header[2], hunks: [] }; files.push(file); hunk = null; continue; }
    const range = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (range && file) { oldLine = Number(range[1]); newLine = Number(range[3]); hunk = { heading: line, rows: [] }; file.hunks.push(hunk); continue; }
    if (!hunk) continue;
    const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : line[0] === ' ' ? 'context' : null;
    if (type) hunk.rows.push({ type, text: line.slice(1), oldLine: type === 'add' ? null : oldLine++, newLine: type === 'remove' ? null : newLine++, noNewline: false });
    else if (line === '\\ No newline at end of file' && hunk.rows.length) hunk.rows.at(-1).noNewline = true;
  }
  for (const file of files) {
    for (const hunk of file.hunks) {
      const normalized = [];
      for (let i = 0; i < hunk.rows.length;) {
        if (hunk.rows[i].type === 'context') { normalized.push(hunk.rows[i++]); continue; }
        const removed = [], added = [];
        while (i < hunk.rows.length && hunk.rows[i].type !== 'context') {
          const row = hunk.rows[i++]; (row.type === 'remove' ? removed : added).push(row);
        }
        normalized.push(...align(removed, added));
      }
      hunk.rows = normalized;
    }
    file.additions = file.hunks.reduce((n, h) => n + h.rows.filter(r => r.type === 'add').length, 0);
    file.deletions = file.hunks.reduce((n, h) => n + h.rows.filter(r => r.type === 'remove').length, 0);
  }
  return files;
}
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function rowElement(row) {
  const tr = el('tr', `github-diff-row ${row.type}`);
  const before = el('td', 'diff-number', row.oldLine ?? ''), after = el('td', 'diff-number', row.newLine ?? '');
  before.setAttribute('aria-label', row.oldLine === null ? 'No original line' : `Original line ${row.oldLine}`);
  after.setAttribute('aria-label', row.newLine === null ? 'No proposed line' : `Proposed line ${row.newLine}`);
  const sign = el('td', 'diff-sign', row.type === 'add' ? '+' : row.type === 'remove' ? '−' : '');
  const source = el('td', 'diff-source'); source.append(el('code', '', row.text || ' '));
  if (row.noNewline) source.append(el('span', 'diff-eof', 'No newline at end of file'));
  tr.append(before, after, sign, source); return tr;
}
export function renderDiff(patch, label = 'Patch') {
  const wrapper = el('div', 'github-diff'); wrapper.setAttribute('aria-label', label);
  const files = parseDiff(patch);
  if (!files.length) { wrapper.append(el('pre', 'diff-raw', patch)); return wrapper; }
  const total = files.reduce((sum, f) => [sum[0] + f.additions, sum[1] + f.deletions], [0, 0]);
  wrapper.append(el('p', 'diff-overview', `${files.length} changed ${files.length === 1 ? 'file' : 'files'} · ${total[0]} additions · ${total[1]} deletions`));
  for (const file of files) {
    const section = el('section', 'github-diff-file'), header = el('div', 'github-diff-header');
    header.append(el('strong', '', file.path), el('span', 'diff-stats', `+${file.additions} −${file.deletions}`));
    const scroller = el('div', 'github-diff-scroll'); scroller.tabIndex = 0; scroller.setAttribute('aria-label', `Code changes in ${file.path}`);
    const table = el('table', 'github-diff-table');
    const caption = el('caption', 'visually-hidden', 'Original and proposed line numbers, change marker, and source code. Green plus lines are added; red minus lines are removed.'); table.append(caption);
    const body = el('tbody');
    for (const hunk of file.hunks) {
      const heading = el('tr', 'diff-hunk'), cell = el('td', '', hunk.heading); cell.colSpan = 4; heading.append(cell); body.append(heading);
      for (let i = 0; i < hunk.rows.length;) {
        if (hunk.rows[i].type !== 'context') { body.append(rowElement(hunk.rows[i++])); continue; }
        const start = i; while (i < hunk.rows.length && hunk.rows[i].type === 'context') i++;
        const rows = hunk.rows.slice(start, i);
        if (rows.length <= 8) { for (const row of rows) body.append(rowElement(row)); continue; }
        for (const row of rows.slice(0, 3)) body.append(rowElement(row));
        const middle = rows.slice(3, -3), fold = el('tr', 'diff-fold'), foldCell = el('td'); foldCell.colSpan = 4;
        const expand = el('button', '', `Show ${middle.length} unchanged lines`); expand.type = 'button';
        expand.addEventListener('click', () => fold.replaceWith(...middle.map(rowElement)));
        foldCell.append(expand); fold.append(foldCell); body.append(fold);
        for (const row of rows.slice(-3)) body.append(rowElement(row));
      }
    }
    table.append(body); scroller.append(table); section.append(header, scroller); wrapper.append(section);
  }
  wrapper.append(el('p', 'fine-print', 'Unchanged lines are context. Line numbers refer to the original and proposed files. Downloaded evidence retains the exact recorded patch.'));
  return wrapper;
}
