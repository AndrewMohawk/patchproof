import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validatePaths } from './fixtures.ts';

// Frozen pre-v3 representation. Historical signed bundles retain these exact bytes.
// Accepting it verifies the same source mapping, without rewriting stored evidence.
export function createLegacyPatch(before: Record<string, string>, after: Record<string, string>): string {
  validatePaths(before); validatePaths(after);
  const lines = (content: string, prefix: string) => {
    if (!content) return '';
    const parts = content.split('\n'), finalNewline = parts.at(-1) === '';
    if (finalNewline) parts.pop();
    return parts.map(line => `${prefix}${line}\n`).join('') + (finalNewline ? '' : '\\ No newline at end of file\n');
  };
  return Object.keys(after).sort().filter(path => before[path] !== after[path]).map(path => {
    const old = before[path] ?? '', next = after[path]!;
    const oldCount = old ? old.split('\n').length - Number(old.endsWith('\n')) : 0;
    const newCount = next ? next.split('\n').length - Number(next.endsWith('\n')) : 0;
    return `diff --git a/${path} b/${path}\n${path in before ? '' : 'new file mode 100644\n'}--- ${path in before ? `a/${path}` : '/dev/null'}\n+++ b/${path}\n@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@\n` + lines(old, '-') + lines(next, '+');
  }).join('');
}

export function createPatch(before: Record<string, string>, after: Record<string, string>): string {
  validatePaths(before); validatePaths(after);
  return Object.keys(after).sort().filter(path => before[path] !== after[path]).map(path => {
    const rows = lineChanges(before[path] ?? '', after[path]!);
    let output = `diff --git a/${path} b/${path}\n${path in before ? '' : 'new file mode 100644\n'}--- ${path in before ? `a/${path}` : '/dev/null'}\n+++ b/${path}\n`;
    let oldPosition = 0, newPosition = 0;
    const positions = rows.map(row => {
      const position = { old: oldPosition, next: newPosition };
      if (row.kind !== '+') oldPosition++;
      if (row.kind !== '-') newPosition++;
      return position;
    });
    for (let cursor = 0; cursor < rows.length;) {
      while (cursor < rows.length && rows[cursor]!.kind === ' ') cursor++;
      if (cursor === rows.length) break;
      const start = Math.max(0, cursor - 3);
      let lastChange = cursor++;
      while (cursor < rows.length && cursor <= lastChange + 7) {
        if (rows[cursor]!.kind !== ' ') lastChange = cursor;
        cursor++;
      }
      const end = Math.min(rows.length, lastChange + 4), hunk = rows.slice(start, end);
      const oldCount = hunk.filter(row => row.kind !== '+').length, newCount = hunk.filter(row => row.kind !== '-').length;
      output += `@@ -${positions[start]!.old + Number(oldCount > 0)},${oldCount} +${positions[start]!.next + Number(newCount > 0)},${newCount} @@\n`;
      for (const row of hunk) output += row.kind + row.line + (row.line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n');
      cursor = end;
    }
    return output;
  }).join('');
}

type LineChange = { kind: ' ' | '+' | '-'; line: string };
function lineChanges(before: string, after: string): LineChange[] {
  const old = before.match(/[^\n]*\n|[^\n]+$/g) ?? [], next = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let prefix = 0, suffix = 0;
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
  while (suffix < old.length - prefix && suffix < next.length - prefix && old.at(-1 - suffix) === next.at(-1 - suffix)) suffix++;
  const a = old.slice(prefix, old.length - suffix), b = next.slice(prefix, next.length - suffix);
  const result: LineChange[] = old.slice(0, prefix).map(line => ({ kind: ' ', line }));
  // Bound memory for pathological sources; normal maintenance files get a minimal
  // line edit. The fallback still emits a valid, lossless contextual patch.
  if ((a.length + 1) * (b.length + 1) > 2_000_000) {
    result.push(...a.map(line => ({ kind: '-' as const, line })), ...b.map(line => ({ kind: '+' as const, line })));
  } else {
    const width = b.length + 1, table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: ' ', line: a[i++]! }); j++; }
      else if (i < a.length && (j === b.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) result.push({ kind: '-', line: a[i++]! });
      else result.push({ kind: '+', line: b[j++]! });
    }
  }
  result.push(...old.slice(old.length - suffix).map(line => ({ kind: ' ' as const, line })));
  return result;
}

export async function applyPatch(before: Record<string, string>, patch: string): Promise<Record<string, string>> {
  validatePaths(before);
  const paths = new Set([...Object.keys(before), ...[...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1]!)]);
  validatePaths(Object.fromEntries([...paths].map(path => [path, ''])));
  const workspace = await mkdtemp(join(tmpdir(), 'patchproof-replay-'));
  try {
    for (const [path, content] of Object.entries(before)) {
      await mkdir(dirname(join(workspace, path)), { recursive: true });
      await writeFile(join(workspace, path), content);
    }
    if (patch) {
      const patchPath = join(workspace, 'candidate.patch');
      await writeFile(patchPath, patch);
      const exec = promisify(execFile);
      await exec('git', ['-c', 'core.hooksPath=/dev/null', 'init', '--quiet', '--initial-branch=replay', '.'], { cwd: workspace, timeout: 5000, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
      await exec('git', ['apply', '--check', '--', patchPath], { cwd: workspace, timeout: 5000, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
      await exec('git', ['apply', '--', patchPath], { cwd: workspace, timeout: 5000, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    }
    return Object.fromEntries(await Promise.all([...paths].map(async path => [path, await readFile(join(workspace, path), 'utf8')])));
  } finally { await rm(workspace, { recursive: true, force: true }); }
}
