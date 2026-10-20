import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import { DockerCheckRunner } from '../workers/sandbox/index.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';
const fixture = FixtureSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/development/humanize-negative-duration.json', import.meta.url), 'utf8')));
const cases = [...fixture.visibleCases, ...fixture.acceptanceCases];
const runner = new DockerCheckRunner();
const rounds = [];
for (let i = 0; i < 2; i++) {
 const result = await runner.run({ files: fixture.files, entrypoint: fixture.entrypoint, cases, timeoutSeconds: 120 }, AbortSignal.timeout(125000));
 rounds.push(result);
 console.log(JSON.stringify({round:i, infrastructureError:result.infrastructureError, checks:result.checks.map(c => ({id:c.id,status:c.status,actual:c.actual,expected:c.expected}))}));
 assert.equal(result.infrastructureError, null);
 assert(result.checks.every(c => c.status !== 'error'));
 assert(result.checks.filter(c => !c.id.startsWith('negative-') && c.id !== 'numeric-negative').every(c => c.status === 'pass'));
 assert.equal(result.checks.find(c=>c.id==='negative-tiny')!.actual, 'a day');
 assert.equal(result.checks.find(c=>c.id==='negative-tiny')!.status, 'fail');
}
const receipt = { checkedAt:new Date().toISOString(), fixtureDigest:digestJson(fixture), paidCalls:0, scope:'Two repeated baseline observations on actual pinned upstream modules; English duration cases only; not full upstream suite.', rounds };
writeFileSync(new URL('../research/verification/20261020-humanize/baseline.json',import.meta.url), JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
