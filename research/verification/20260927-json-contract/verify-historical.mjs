// Read-only evidence admission check. Does not instantiate a checker or execute candidates.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [sourceRoot, evidenceDirectory, output] = process.argv.slice(2);
if (!sourceRoot || !evidenceDirectory || !output || process.argv.length !== 5) throw Error('Expected source root, evidence directory and new output path.');
const { verifyEvidence } = await import(pathToFileURL(join(resolve(sourceRoot), 'packages/orchestrator/src/evidence.ts')).href);
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const results = [];
for (const filename of (await readdir(evidenceDirectory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
  const bytes = await readFile(join(evidenceDirectory,filename));
  const original = JSON.parse(bytes.toString('utf8'));
  const bundle = verifyEvidence(original, 'sha256:' + filename.slice(0,-5));
  results.push({ filename, byteDigest: hash(bytes), bundleDigest: bundle.bundleDigest,
    schemaVersion: bundle.schemaVersion, runId: bundle.run.id, mode: bundle.mode,
    verdict: bundle.run.terminalStatus, verifierChangedObject: JSON.stringify(bundle) !== JSON.stringify(original) });
}
const report = { schemaVersion:'1.0', kind:'historical-evidence-admission', sourceRoot:resolve(sourceRoot),
  evidenceDirectory:resolve(evidenceDirectory), checkedAt:new Date().toISOString(), executedCandidates:0,
  providerCalls:0, total:results.length, results };
await writeFile(output, JSON.stringify(report,null,2)+'\n', { flag:'wx', mode:0o600 });
console.log(JSON.stringify({ total:results.length, versions:[...new Set(results.map(row=>row.schemaVersion))],
  changedObjects:results.filter(row=>row.verifierChangedObject).length, providerCalls:0, executedCandidates:0 }));
