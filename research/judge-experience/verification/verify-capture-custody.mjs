// Independently check the completed footage after concurrent public traffic
// invalidated the recorder's overly broad global-history assertion.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyEvidence } from '../../../packages/orchestrator/src/evidence.ts';
const privateRoot=resolve(process.env.PATCHPROOF_PRIVATE_ROOT??join(homedir(),'.config/patchproof/demo-20260927'));
const root = resolve(process.argv[2]);
assert.equal(root, join(privateRoot,'judge-experience-03'));
const read = async name => JSON.parse(await readFile(`${root}/${name}`));
const reportBytes = await readFile(`${root}/report.json`);
const report = JSON.parse(reportBytes), audit = await read('capture-custody-audit.json');
assert.equal(audit.status, 'verified_with_concurrent_live_traffic');
assert.equal(audit.reportSha256, createHash('sha256').update(reportBytes).digest('hex'));
assert.equal(report.status, 'failed');
assert.match(report.error, /Expected values to be strictly deep-equal/);
assert.deepEqual(report.errors, []);
assert.equal(report.scenes.length, 8);
assert.ok(report.requests.every(row => row.allowed && row.method === 'GET'));
const before = (await read('runs-before.json')).runs, after = (await read('runs-after.json')).runs;
const beforeMap = new Map(before.map(run => [run.id, run])), afterMap = new Map(after.map(run => [run.id, run]));
for (const [id, run] of beforeMap) assert.deepEqual(afterMap.get(id), run);
const additional = after.filter(run => !beforeMap.has(run.id));
assert.ok(additional.length > 0);
assert.deepEqual(additional.map(({ id, taskId, phase, createdAt }) => ({ id, taskId, phase, createdAt })), audit.additionalRuns);
for (let i = 0; i < audit.recordedRunIds.length; i++) {
  const id = audit.recordedRunIds[i];
  const bundle = verifyEvidence(await read(`evidence-${id}.json`), audit.bundleDigests[i]);
  assert.deepEqual(bundle.run, beforeMap.get(id));
  assert.deepEqual(bundle.run, afterMap.get(id));
}
const downloaded = verifyEvidence(await read('download.json'), audit.bundleDigests[0]);
assert.equal(downloaded.run.id, audit.recordedRunIds[0]);
assert.equal(report.download.bundleDigest, downloaded.bundleDigest);
console.log(JSON.stringify({ status: 'verified_with_concurrent_live_traffic', originalObserverStatus: report.status, paidRequestsFromRecorder: 0 }));
