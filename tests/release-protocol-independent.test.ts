import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { digestJson } from '../packages/contracts/src/digest.ts';
import { resolveReleaseBindings,classifyReleaseBundle } from '../scripts/release-protocol.ts';
import { syntheticReleaseData,syntheticSmokeLock } from './helpers/release-live-data.ts';

test('independent release: accepting the whole lock as a source-map pin cannot authorize current source',async t=>{
 const s=await syntheticReleaseData();t.after(()=>rm(s.root,{recursive:true,force:true}));
 const document=structuredClone(s.document);document.acceptance.sourceDigest=digestJson(s.operational);
 const selection={...s.selection,document,acceptedProofDigest:digestJson(document.acceptance)};
 assert.throws(()=>resolveReleaseBindings({operational:s.operational,runtime:s.config.runtime,bundleDigests:[],liveProtocol:selection,now:s.now}),/source_changed/);
});

test('independent release: newly accepted future-dated proof cannot pass current release gate',async t=>{
 const s=await syntheticReleaseData();t.after(()=>rm(s.root,{recursive:true,force:true}));
 const document=structuredClone(s.document);document.acceptance.verifiedAt=new Date(s.now.getTime()+1000).toISOString();
 const selection={...s.selection,document,acceptedProofDigest:digestJson(document.acceptance)};
 assert.throws(()=>resolveReleaseBindings({operational:s.operational,runtime:s.config.runtime,bundleDigests:[],liveProtocol:selection,now:s.now}),/stale/);
});

test('independent release: smoke scope and protocol remain necessary and never classify experiment execution',async t=>{
 const s=await syntheticReleaseData();t.after(()=>rm(s.root,{recursive:true,force:true}));
 const {bindings,liveProtocol}=resolveReleaseBindings({operational:s.operational,runtime:s.config.runtime,bundleDigests:[],liveProtocol:s.selection,now:s.now});
 const smoke=syntheticSmokeLock(s.document);
 assert.equal(classifyReleaseBundle(smoke,'live',bindings,liveProtocol),'compatible_presentation');
 for(const changes of [{scope:'experiment'},{scope:null},{checkProtocol:{}},{calibratedExperiment:true},{modelId:'another'}])
   assert.equal(classifyReleaseBundle({...smoke,...changes},'live',bindings,liveProtocol),'historical_or_unbound');
});
