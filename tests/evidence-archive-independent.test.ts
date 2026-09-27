import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { createEvidenceArchive } from '../apps/api/src/evidence-archive.ts';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { prepareArchiveFixture, syntheticArchiveBundle } from './helpers/archive-fixture.ts';
async function opened(t: import('node:test').TestContext) {
 const fixture=await prepareArchiveFixture([syntheticArchiveBundle('live'),syntheticArchiveBundle('mock','2.0','baseline')]);t.after(fixture.close);
 const archive=await createEvidenceArchive(fixture);archive.server.listen(0,'127.0.0.1');await once(archive.server,'listening');
 const a=archive.server.address();assert.ok(a&&typeof a==='object');
 t.after(async()=>{archive.server.closeAllConnections();await new Promise<void>(resolve=>archive.server.close(()=>resolve()));});
 return {fixture,archive,base:`http://127.0.0.1:${a.port}`};
}

test('independent archive: source/config disappearance cannot change verified byte snapshots',async t=>{
 const s=await opened(t);const before=await (await fetch(s.base+'/tasks')).text();
 await rm(s.fixture.projectRoot,{recursive:true});await rm(s.fixture.configFile);await Promise.all(s.fixture.paths.map(p=>rm(p)));
 s.archive.manifest.recordedModes.length=0;
 assert.equal(await (await fetch(s.base+'/tasks')).text(),before);
 for(const [i,bundle]of s.fixture.bundles.entries())assert.deepEqual(Buffer.from(await (await fetch(`${s.base}/runs/${bundle.run.id}/evidence`)).arrayBuffer()),s.fixture.bytes[i]);
});

test('independent archive: scoped GET surface rejects active routes, origin aliases and unknown identities',async t=>{
 const s=await opened(t),id=s.fixture.bundles[0]!.run.id,before=(await readdir(s.fixture.directory)).sort();
 for(const method of ['POST','PATCH','PUT','DELETE','OPTIONS'])assert.equal((await fetch(s.base+'/runs',{method})).status,405);
 for(const suffix of ['/events','/cancel'])assert.equal((await fetch(s.base+'/runs/'+id+suffix)).status,405);
 assert.equal((await fetch(s.base+'/runs/00000000-0000-4000-8000-000000000000')).status,404);
 assert.equal((await fetch(s.base+'/runs?file=private')).status,400);
 for(const headers of [{Origin:'https://localhost'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(s.base+'/runs',{headers})).status,403);
 const status=await new Promise<number|undefined>((resolve,reject)=>{const req=request(s.base+'/runs',{headers:{Host:'localhost.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 assert.equal(status,403);assert.deepEqual((await readdir(s.fixture.directory)).sort(),before);
 const text=await (await fetch(s.base+'/tasks')).text();assert.ok(!text.includes(s.fixture.directory));
 const body=JSON.parse(text);assert.equal(body.authenticityVerified,false);assert.equal(body.realExecutionEnabled,false);assert.deepEqual(body.recordedModes,['live','mock']);
});

test('independent archive: source acceptance-policy mutation rejects historical-version bundle too',async t=>{
 const s=await prepareArchiveFixture([syntheticArchiveBundle('mock','2.0')]);t.after(s.close);
 const fixture=JSON.parse(await readFile(s.fixtureFile,'utf8'));
 fixture.acceptanceCases=[{id:'new-check',requirementId:'R01',function:'identity',args:[],expected:'different'}];
 await writeFile(s.fixtureFile,JSON.stringify(fixture));
 await assert.rejects(createEvidenceArchive(s),e=>e instanceof Error&&e.message==='archive_input_invalid');
});

test('independent archive: independent configuration pin and safe failures never reflect private input',async t=>{
 const s=await prepareArchiveFixture();t.after(s.close);
 await assert.rejects(createEvidenceArchive({...s,expectedConfigDigest:digestJson('unaccepted')}),/archive_config_digest_mismatch/);
 const original=await readFile(s.configFile);s.config.bundles[0]!.path='/not-present/private-sensitive-unit-only.json';s.expectedConfigDigest=await s.writeConfig();
 await assert.rejects(createEvidenceArchive(s),e=>e instanceof Error&&e.message==='archive_input_invalid'&&!e.message.includes('sensitive'));
 assert.notDeepEqual(await readFile(s.configFile),original);
});
