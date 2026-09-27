import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validatePaths } from './fixtures.ts';

function lines(content: string, prefix: string) {
  if (!content) return [];
  const parts = content.split('\n');
  const finalNewline = parts.at(-1) === '';
  if (finalNewline) parts.pop();
  const output = parts.map(line => `${prefix}${line}\n`);
  if (!finalNewline) output.push('\\ No newline at end of file\n');
  return output;
}

export function createPatch(before: Record<string, string>, after: Record<string, string>): string {
  validatePaths(before); validatePaths(after);
  return Object.keys(after).sort().filter(path => before[path] !== after[path]).map(path => {
    const old = before[path] ?? '';
    const next = after[path]!;
    const oldCount = old ? old.split('\n').length - Number(old.endsWith('\n')) : 0;
    const newCount = next ? next.split('\n').length - Number(next.endsWith('\n')) : 0;
    return `diff --git a/${path} b/${path}\n${path in before ? '' : 'new file mode 100644\n'}--- ${path in before ? `a/${path}` : '/dev/null'}\n+++ b/${path}\n@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@\n` +
      lines(old, '-').join('') + lines(next, '+').join('');
  }).join('');
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
