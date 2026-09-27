import assert from 'node:assert/strict';
import { readFile, lstat, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadFixtures, publicTask } from '../../packages/orchestrator/src/fixtures.ts';
import { digestBytes, digestJson } from '../../packages/contracts/src/digest.ts';
const root = '/home/andrewmohawk/patchproof-evaluation-v2/public-preview-20260927T142827Z-565123ca-8953-4c77-abb4-0b8b9121ab5d';
const manifestBytes = await readFile(join(root, 'preview-manifest.json'));
const manifestDigest = digestBytes(manifestBytes);
assert.equal(manifestDigest, 'sha256:6d46f5a9bcc7f418e5284f1c622a405cc81887f55d6c03241149bd2d81bc3138');
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.fixtureFiles.length, 30);
const names = (await readdir(root, { recursive: true })).filter(name => name.endsWith('.json')).sort();
assert.deepEqual(names, ['preview-manifest.json', ...manifest.fixtureFiles.map(row => row.path)].sort());
for (const row of manifest.fixtureFiles) {
  assert.match(row.path, /^fixtures\/(development|calibration)\/[a-z0-9-]+\.json$/);
  const file = resolve(root, row.path); assert.ok(file.startsWith(root + '/'));
  const info = await lstat(file); assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(digestBytes(await readFile(file)), row.digest);
}
const fixtures = await loadFixtures(pathToFileURL(root + '/'));
assert.equal(fixtures.length, 30);
const projected = fixtures.map(publicTask);
assert.equal(projected.filter(task => task.mockSupported).length, 1);
assert.equal(projected.find(task => task.mockSupported).id, 'stable-unique-01');
const report = {
  scope: 'Authorized provisional public-only preview; metadata/schema inspection only. No fixture execution.',
  testedAt: new Date().toISOString(), manifestDigest, manifestStatus: manifest.status, sourceCommit: manifest.sourceCommit,
  clientCommit: '0b605f26453409e474587270fdf9292a7ec4aaf3',
  counts: { fixtures: fixtures.length, development: fixtures.filter(f=>f.split==='development').length, calibration: fixtures.filter(f=>f.split==='calibration').length,
    repositories: new Set(fixtures.map(f=>f.repoId)).size, mockSupported: projected.filter(t=>t.mockSupported).length },
  tasks: fixtures.map(f=>({ id:f.id, repoId:f.repoId, split:f.split, title:f.title, entrypoint:f.entrypoint,
    filePaths:Object.keys(f.files), editAllowlist:f.editAllowlist, sourceBytes:Object.values(f.files).reduce((n,s)=>n+Buffer.byteLength(s),0),
    requirements:f.requirements.length, visibleCaseCount:f.visibleCases.length, acceptanceCaseCount:f.acceptanceCases.length,
    functions:[...new Set([...f.visibleCases,...f.acceptanceCases].map(c=>c.function))],
    mockSupported: publicTask(f).mockSupported, fixtureProjectionDigest:digestJson(f) })),
  callerBoundary: { providersExecuted:0, candidatesExecuted:0, containersStarted:0, privateCorpusRead:false }
};
await writeFile(new URL('./metadata-report.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
await writeFile(new URL('./catalogue.json', import.meta.url), JSON.stringify(projected,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
