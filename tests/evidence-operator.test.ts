import assert from 'node:assert/strict';
import test from 'node:test';
import type {TestContext} from 'node:test';
import {chmodSync,existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,symlinkSync,truncateSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {FixtureSchema} from '../packages/contracts/src/product.ts';
import type {ProductRun} from '../packages/contracts/src/product.ts';
import {digestBytes,digestJson} from '../packages/contracts/src/digest.ts';
import {buildEvidence} from '../packages/orchestrator/src/evidence.ts';
import {fixtureDigests} from '../packages/orchestrator/src/fixtures.ts';
import {exportPrivateEvidence,inspectPrivateEvidence,MAX_PRIVATE_EVIDENCE_BYTES,PrivateEvidenceConfigSchema,privateEvidenceConfigDigest,readPrivateEvidenceBytes,runEvidenceOperator,verifyCuratedProductEvidence} from '../scripts/evidence-operator.ts';

const ID='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',H='sha256:'+'a'.repeat(64),WHEN='2026-09-27T00:00:00.000Z';
function setup(t:TestContext,version:'2.0'|'2.1'='2.1'){
  const directory=mkdtempSync(join(tmpdir(),'private-evidence-unit-')),projectRoot=join(directory,'project'),state=join(directory,'state');
  mkdirSync(join(projectRoot,'fixtures','development'),{recursive:true,mode:0o700});mkdirSync(join(projectRoot,'fixtures','calibration'),{mode:0o700});mkdirSync(join(state,'evidence'),{recursive:true,mode:0o700});
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const fixture=FixtureSchema.parse({id:'invented-public-task',repoId:'invented-public-repo',split:'development',title:'Inert public fixture',description:'Invented metadata; never execute.',requirements:[{id:'R01',text:'Review the inert file.'}],files:{'solution.py':'# Inert synthetic evidence; never executed.\n'},editAllowlist:['solution.py'],entrypoint:'solution.py',visibleCases:[],acceptanceCases:[],license:'CC0-1.0',provenance:'Original synthetic unit metadata'});
  const fixturePath=join(projectRoot,'fixtures','development','invented.json');writeFileSync(fixturePath,JSON.stringify(fixture));
  const lock={invented:true},digests=fixtureDigests(fixture,version),run:ProductRun={schemaVersion:version,id:ID,taskId:fixture.id,variant:'baseline',mode:'mock',competitionReady:false,notice:'private-sentinel-note',phase:'terminal',terminalStatus:'needs_review',reason:'private-sentinel-reason',createdAt:WHEN,finishedAt:WHEN,...digests,runtimeLockDigest:digestJson(lock),limits:{inferenceCallLimit:3,inputTokenLimit:1000,outputTokenLimit:1000,wallTimeLimitSeconds:60,sandboxCpuSecondsLimit:60,maxApprovedSpendUsd:0},usage:{inferenceCalls:0,inputTokens:0,outputTokens:0,sandboxCpuSeconds:0,measuredCostUsd:0,costIsEstimate:false,elapsedMs:0},baselineChecks:null,candidates:[],selectedCandidateId:null,coverage:[{requirementId:'R01',status:'unverified',checkIds:[]}],events:[{sequence:1,timestamp:WHEN,phase:'terminal',message:'private-sentinel-event'}],sandboxOperationIds:[]};
  const bundle=buildEvidence(run,fixture,lock),bytes=Buffer.from(JSON.stringify(bundle,null,3)+'\n\n'),database=join(state,'runs.sqlite'),evidencePath=join(state,'evidence',bundle.bundleDigest.slice(7)+'.json');
  const db=new DatabaseSync(database);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE runs (id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, document TEXT NOT NULL, evidence_digest TEXT)');db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run(ID,'invented-request',H,JSON.stringify(run),bundle.bundleDigest);db.close();chmodSync(database,0o600);writeFileSync(evidencePath,bytes,{mode:0o600});
  const config=PrivateEvidenceConfigSchema.parse({schemaVersion:'1.0',kind:'product-evidence-operator',stateDirectory:state,runId:ID,bundleDigest:bundle.bundleDigest,fixture:{taskId:fixture.id,fixtureDigest:digestJson(fixture),...digests},outputFile:join(directory,'export.json')}),configPath=join(directory,'operator.json');
  const save=()=>writeFileSync(configPath,JSON.stringify(config),{mode:0o600});save();
  const request=()=>({projectRoot,configPath,expectedConfigDigest:privateEvidenceConfigDigest(config)});
  const changeRow=(sql:string,...values:Array<string|null>)=>{const db=new DatabaseSync(database);db.prepare(sql).run(...values);db.close();};
  const snapshot=()=>({files:readdirSync(state).sort(),db:digestBytes(readFileSync(database)),evidence:digestBytes(readFileSync(evidencePath))});
  return{directory,projectRoot,state,fixture,fixturePath,run,bundle,bytes,database,evidencePath,config,configPath,save,request,changeRow,snapshot};
}

test('inspection verifies one explicit published bundle and creates no SQLite sidecars or output',async t=>{
  const s=setup(t),before=s.snapshot(),result=await inspectPrivateEvidence(s.request());assert.equal(result.bundle.run.id,ID);assert.deepEqual(result.bytes,s.bytes);assert.equal(result.summary.integrityVerified,true);assert.equal(result.summary.authenticityVerified,false);assert.equal(result.summary.executionPerformed,false);assert.deepEqual(s.snapshot(),before);assert.equal(existsSync(s.config.outputFile!),false);
});
test('exclusive export writes exact original JSON bytes with private mode and never overwrites',async t=>{
  const s=setup(t),result=await exportPrivateEvidence(s.request());assert.equal(result.byteDigest,digestBytes(s.bytes));assert.deepEqual(readFileSync(s.config.outputFile!),s.bytes);assert.equal(statSync(s.config.outputFile!).mode&0o777,0o600);
  const original=readFileSync(s.config.outputFile!);await assert.rejects(exportPrivateEvidence(s.request()));assert.deepEqual(readFileSync(s.config.outputFile!),original);
});
test('exported-byte verification needs no original journal but requires the approved current public fixture',async t=>{
  const s=setup(t);await exportPrivateEvidence(s.request());rmSync(s.state,{recursive:true});const bytes=readPrivateEvidenceBytes(s.config.outputFile!,{projectRoot:s.projectRoot});
  assert.equal((await verifyCuratedProductEvidence({projectRoot:s.projectRoot,bytes,runId:ID,bundleDigest:s.bundle.bundleDigest,fixture:s.config.fixture})).run.id,ID);
  rmSync(s.fixturePath);await assert.rejects(verifyCuratedProductEvidence({projectRoot:s.projectRoot,bytes,runId:ID,bundleDigest:s.bundle.bundleDigest,fixture:s.config.fixture}),/curated_fixture_unavailable/);assert.deepEqual(readFileSync(s.config.outputFile!),s.bytes);
});
test('wrong config digest, run ID and bundle digest refuse without export or database changes',async t=>{
  const s=setup(t),before=s.snapshot();await assert.rejects(inspectPrivateEvidence({...s.request(),expectedConfigDigest:H}),/config_digest/);s.config.runId=OTHER;s.save();await assert.rejects(inspectPrivateEvidence(s.request()),/run_unavailable/);
  s.config.runId=ID;s.config.bundleDigest=H;s.save();writeFileSync(join(s.state,'evidence',H.slice(7)+'.json'),s.bytes,{mode:0o600});await assert.rejects(inspectPrivateEvidence(s.request()),/unpublished_or_digest/);assert.deepEqual(s.snapshot(),before);assert.equal(existsSync(s.config.outputFile!),false);
});
test('journal publication, terminal state and exact run document must all agree',async t=>{
  const s=setup(t);s.changeRow('UPDATE runs SET evidence_digest=NULL');await assert.rejects(inspectPrivateEvidence(s.request()),/unpublished/);
  s.changeRow('UPDATE runs SET evidence_digest=?,document=?',s.bundle.bundleDigest,JSON.stringify({...s.run,phase:'repair',terminalStatus:null,finishedAt:null,events:[{...s.run.events[0],phase:'repair'}]}));await assert.rejects(inspectPrivateEvidence(s.request()),/not_terminal/);
  s.changeRow('UPDATE runs SET document=?',JSON.stringify({...s.run,notice:'different journal state'}));await assert.rejects(inspectPrivateEvidence(s.request()),/journal_binding/);assert.equal(existsSync(s.config.outputFile!),false);
});
test('changed curated source, policy, full legacy fixture metadata and unknown fixture pin all reject',async t=>{
  for(const version of ['2.0','2.1']as const){const s=setup(t,version);assert.equal((await inspectPrivateEvidence(s.request())).bundle.schemaVersion,version);
    for(const changed of [{...s.fixture,files:{'solution.py':'# changed\n'}},{...s.fixture,requirements:[{id:'R01',text:'Changed policy.'}]},{...s.fixture,title:'Changed title'}]){writeFileSync(s.fixturePath,JSON.stringify(changed));await assert.rejects(inspectPrivateEvidence(s.request()),/curated_fixture_mismatch/);}
    writeFileSync(s.fixturePath,JSON.stringify(s.fixture));s.config.fixture.taskId='unknown-task';s.save();await assert.rejects(inspectPrivateEvidence(s.request()),/run_or_fixture/);}
});
test('tampered bundle/artifact and invalid byte encoding cannot export',async t=>{
  const s=setup(t),bad=structuredClone(s.bundle);bad.files['events.json']!.content='private tampered text';writeFileSync(s.evidencePath,JSON.stringify(bad));await assert.rejects(exportPrivateEvidence(s.request()));
  writeFileSync(s.evidencePath,Buffer.concat([s.bytes,Buffer.from([255])]));await assert.rejects(exportPrivateEvidence(s.request()),/invalid_utf8/);assert.equal(existsSync(s.config.outputFile!),false);
});
test('missing journal is never created and unknown schemas are never migrated',async t=>{
  const s=setup(t);rmSync(s.database);await assert.rejects(inspectPrivateEvidence(s.request()));assert.equal(existsSync(s.database),false);
  const db=new DatabaseSync(s.database);db.exec('CREATE TABLE unrelated(value TEXT)');db.close();chmodSync(s.database,0o600);const before=readFileSync(s.database);await assert.rejects(inspectPrivateEvidence(s.request()),/schema_invalid/);assert.deepEqual(readFileSync(s.database),before);
});
test('active WAL data is refused without a checkpoint or implicit sidecar changes',async t=>{
  const s=setup(t),writer=new DatabaseSync(s.database);try{writer.exec('UPDATE runs SET request_key=\'active-writer\'');for(const suffix of ['-wal','-shm'])chmodSync(s.database+suffix,0o600);const before=readFileSync(s.database+'-wal');
    await assert.rejects(inspectPrivateEvidence(s.request()),/not_quiescent/);assert.deepEqual(readFileSync(s.database+'-wal'),before);assert.equal(existsSync(s.config.outputFile!),false);
  }finally{writer.close();}
});
test('output and configuration collisions with every database sidecar preserve original inputs',async t=>{
  for(const suffix of['','-wal','-shm','-journal']){const s=setup(t);s.config.outputFile=s.database+suffix;s.save();const before=readFileSync(s.database);await assert.rejects(exportPrivateEvidence(s.request()),/path_collision/);assert.deepEqual(readFileSync(s.database),before);
    if(suffix){const alias=s.database+suffix;writeFileSync(alias,JSON.stringify({...s.config,outputFile:null}),{mode:0o600});const original=readFileSync(alias);await assert.rejects(inspectPrivateEvidence({...s.request(),configPath:alias,expectedConfigDigest:privateEvidenceConfigDigest({...s.config,outputFile:null})}),/path_collision/);assert.deepEqual(readFileSync(alias),original);}}
  const s=setup(t);for(const alias of[s.configPath,s.evidencePath]){s.config.outputFile=alias;s.save();const original=readFileSync(alias);await assert.rejects(exportPrivateEvidence(s.request()),/path_collision/);assert.deepEqual(readFileSync(alias),original);}
});
test('symlink and hardlink aliases are refused for config, evidence, output and public fixture tree',async t=>{
  const s=setup(t),alias=join(s.directory,'alias.json');symlinkSync(s.configPath,alias);await assert.rejects(inspectPrivateEvidence({...s.request(),configPath:alias}));rmSync(alias);
  linkSync(s.evidencePath,alias);await assert.rejects(inspectPrivateEvidence(s.request()));rmSync(alias);symlinkSync(s.evidencePath,s.config.outputFile!);await assert.rejects(exportPrivateEvidence(s.request()));rmSync(s.config.outputFile!);
  const bytes=readFileSync(s.fixturePath);rmSync(s.fixturePath);const privateFile=join(s.directory,'fixture.json');writeFileSync(privateFile,bytes,{mode:0o600});symlinkSync(privateFile,s.fixturePath);await assert.rejects(inspectPrivateEvidence(s.request()),/curated_symlink/);
});
test('bounded evidence/database reads and public tree size stop before output',async t=>{
  const s=setup(t);truncateSync(s.evidencePath,MAX_PRIVATE_EVIDENCE_BYTES+1);await assert.rejects(inspectPrivateEvidence(s.request()),/oversized/);writeFileSync(s.evidencePath,s.bytes);
  truncateSync(s.database,134_217_729);await assert.rejects(inspectPrivateEvidence(s.request()),/journal_oversized/);assert.equal(existsSync(s.config.outputFile!),false);
  const b=setup(t);for(let i=0;i<257;i++)writeFileSync(join(b.projectRoot,'fixtures','calibration',`empty-${i}.txt`),'');await assert.rejects(inspectPrivateEvidence(b.request()),/curated_tree_bound/);
});
test('private CLI status is compact and neither config credentials nor private event details escape',async t=>{
  const s=setup(t),result=await runEvidenceOperator(['inspect',s.configPath,privateEvidenceConfigDigest(s.config)],s.projectRoot);assert.equal(result.exitCode,0);assert.equal(JSON.stringify(result).includes('private-sentinel'),false);assert.equal(JSON.stringify(result).includes(s.directory),false);assert.equal('bundle'in result.output,false);
  writeFileSync(s.configPath,JSON.stringify({...s.config,apiKey:'private-credential-sentinel'}));const rejected=await runEvidenceOperator(['inspect',s.configPath,privateEvidenceConfigDigest(s.config)],s.projectRoot);assert.equal(rejected.exitCode,2);assert.equal(JSON.stringify(rejected).includes('credential'),false);
  const cli=new URL('../scripts/evidence-operator.ts',import.meta.url),child=spawnSync(process.execPath,[cli.pathname,'unsupported'],{encoding:'utf8'});assert.equal(child.status,2);assert.equal(JSON.parse(child.stdout).error.code,'operator_usage');assert.equal(child.stdout.includes('stack'),false);
});
test('private evidence reader rejects permissive file modes and request mutations cannot switch selected bundle',async t=>{
  const s=setup(t);chmodSync(s.evidencePath,0o644);assert.throws(()=>readPrivateEvidenceBytes(s.evidencePath,{projectRoot:s.projectRoot}));chmodSync(s.evidencePath,0o600);
  const request=s.request(),pending=inspectPrivateEvidence(request);request.configPath=join(s.directory,'missing-secret-path');request.expectedConfigDigest=H;assert.equal((await pending).bundle.run.id,ID);
});

test('URL-reinterpreted public inventory names cannot redirect reads into an unlisted sibling',async t=>{
  const s=setup(t),aliasDirectory=join(s.projectRoot,'fixtures','development','%2e%2e');
  // All files are inert invented metadata. The literal inventoried alias contains no fixture;
  // the old URL-based loader would instead read fixtures/redirected.json outside either public tree.
  rmSync(s.fixturePath);mkdirSync(aliasDirectory,{mode:0o700});
  writeFileSync(join(aliasDirectory,'redirected.json'),'{}');
  writeFileSync(join(s.projectRoot,'fixtures','redirected.json'),JSON.stringify(s.fixture));
  const before=s.snapshot();
  await assert.rejects(inspectPrivateEvidence(s.request()),/evidence_curated_path_invalid/);
  assert.deepEqual(s.snapshot(),before);assert.equal(existsSync(s.config.outputFile!),false);
});

test('concurrent metadata exports grant one exclusive output and preserve exact selected bytes',async t=>{
  const s=setup(t),before=s.snapshot();
  const results=await Promise.allSettled([exportPrivateEvidence(s.request()),exportPrivateEvidence(s.request())]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const rejected=results.find(result=>result.status==='rejected');
  assert.ok(rejected&&rejected.status==='rejected');assert.equal((rejected.reason as NodeJS.ErrnoException).code,'EEXIST');
  assert.deepEqual(readFileSync(s.config.outputFile!),s.bytes);assert.deepEqual(s.snapshot(),before);
});

test('an optional Makefile RUN binding must match the selected private configuration',async t=>{
  const s=setup(t),before=s.snapshot();
  const wrong=await runEvidenceOperator(['export',s.configPath,privateEvidenceConfigDigest(s.config),'22222222-2222-4222-8222-222222222222'],s.projectRoot);
  assert.equal(wrong.exitCode,2);assert.equal(existsSync(s.config.outputFile!),false);assert.deepEqual(s.snapshot(),before);
  const right=await runEvidenceOperator(['inspect',s.configPath,privateEvidenceConfigDigest(s.config),ID],s.projectRoot);
  assert.equal(right.exitCode,0);
});
