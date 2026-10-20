import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FixtureSchema } from '../packages/contracts/src/product.ts';
import { validateEditRegion } from '../packages/orchestrator/src/edit-region.ts';
import { validatePaths } from '../packages/orchestrator/src/fixtures.ts';
import { digestBytes } from '../packages/contracts/src/digest.ts';
const f = FixtureSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/development/humanize-negative-duration.json', import.meta.url), 'utf8')));
const r = f.editRegion!;
test('Humanize source and MIT notice retain pinned provenance', () => {
  const provenance = JSON.parse(readFileSync(new URL('../research/verification/20261020-humanize/provenance.json', import.meta.url), 'utf8'));
  for (const [path, hash] of Object.entries(provenance.pythonSourceSha256)) assert.equal(digestBytes(f.files[path]!), 'sha256:' + hash);
  assert.equal(f.license, 'MIT'); assert.match(f.licenseText!, /Jason Moiron/);
  assert.equal(FixtureSchema.safeParse({ ...f, licenseText: undefined }).success, false);
  assert.match(f.files['humanize_adapter.py']!, /4.9.1.dev32/);
  validateEditRegion(f, f.files);
});
test('function guard accepts an indented body and rejects surrounding, signature, and top-level changes', () => {
  validateEditRegion(f, { ...f.files, [r.path]: r.prefix + '    return "example"\n' + r.suffix });
  for (const source of [f.files[r.path]! + '\n# changed', '# changed\n' + f.files[r.path],
    f.files[r.path]!.replace('def naturaldelta(', 'def other('), r.prefix + 'return "escape"\n' + r.suffix,
    r.prefix + '    return "ok"\ndef other():\n    pass\n' + r.suffix]) {
    assert.throws(() => validateEditRegion(f, { ...f.files, [r.path]: source }), /frozen function|indented/);
  }
  assert.throws(() => validatePaths({ 'humanize_adapter.py': 'replacement' }, f.editAllowlist), /Protected/);
  assert.throws(() => validatePaths({ 'src/humanize/i18n.py': 'replacement' }, f.editAllowlist), /Protected/);
});

import { NebiusRepairProvider, RepairError } from '../workers/repair/index.ts';
import type { RepairInput } from '../packages/contracts/src/product.ts';
test('region transport expands only body, retains usage, and rejects whole-file or extra-file responses', async () => {
 const input: RepairInput = { taskId:f.id, description:f.description, requirements:f.requirements, files:f.files,
   editAllowlist:f.editAllowlist, visibleCases:f.visibleCases, editRegion:r, feedback:[], attempt:0,
   remaining:{inferenceCallLimit:3,inputTokenLimit:262144,outputTokenLimit:4000,wallTimeLimitSeconds:600,sandboxCpuSecondsLimit:900,maxApprovedSpendUsd:0.25} };
 for (const bad of [false, true, 'extra'] as const) {
  const provider = new NebiusRepairProvider({modelId:'nvidia/test-only',accountVerifiedAt:'2026-10-01T00:00:00Z',
   inputUsdPerMillionTokens:0.3,outputUsdPerMillionTokens:0.9,authorized:true,credential:async()=> 'SYNTHETIC-TOKEN',countInputTokens:()=>100,
   fetch:async (_url, init) => {
    const request=JSON.parse(String(init?.body));
    assert.match(request.messages[0].content,/REGION PROTOCOL/); assert(!request.messages[0].content.includes('full replacement source')); assert.match(request.messages[0].content,/valid JSON string/); assert.equal(request.max_tokens,4000);
    assert(!request.messages[1].content.includes('218a86ec'));
    return Response.json({id:'test-request',model:'nvidia/test-only',usage:{prompt_tokens:100,completion_tokens:20},
     choices:[{finish_reason:'stop',message:{content:JSON.stringify({files:bad==='extra'?{[r.path]:'    return "example"\n','humanize_adapter.py':'bad'}:{[r.path]:bad?f.files[r.path]:'    return "example"\n'},summary:'Synthetic protocol test, not a repair.'})}}]});
   }});
  if(bad) await assert.rejects(provider.propose(input,new AbortController().signal),e=>e instanceof RepairError && e.code==='protected_path' && e.usage.inferenceCalls===1);
  else {const proposal=await provider.propose(input,new AbortController().signal);assert.equal(proposal.files[r.path],r.prefix+'    return "example"\n'+r.suffix);validateEditRegion(f,{...f.files,...proposal.files});}
 }
});


test('invalid candidate syntax and shape retain static diagnostics without response contents', async () => {
 const input: RepairInput = { taskId:f.id,description:f.description,requirements:f.requirements,files:f.files,
   editAllowlist:f.editAllowlist,visibleCases:f.visibleCases,editRegion:r,feedback:[],attempt:0,
   remaining:{inferenceCallLimit:3,inputTokenLimit:262144,outputTokenLimit:4000,wallTimeLimitSeconds:600,sandboxCpuSecondsLimit:900,maxApprovedSpendUsd:0.25} };
 for(const [content,diagnostic] of [['not JSON','invalid_json'],[JSON.stringify({unexpected:'value'}),'invalid_schema']] as const) {
  const provider = new NebiusRepairProvider({modelId:'nvidia/test-only',accountVerifiedAt:'2026-10-01T00:00:00Z',
   inputUsdPerMillionTokens:0.3,outputUsdPerMillionTokens:0.9,authorized:true,credential:async()=> 'SYNTHETIC-TOKEN',countInputTokens:()=>100,
   fetch:async()=>Response.json({id:'format-test',model:'nvidia/test-only',usage:{prompt_tokens:100,completion_tokens:20},choices:[{finish_reason:'stop',message:{content}}]})});
  await assert.rejects(provider.propose(input,new AbortController().signal),e=>e instanceof RepairError && e.code==='invalid_candidate' && e.candidateFormatFailure===diagnostic && e.usage.inferenceCalls===1 && e.providerRequestId==='format-test' && !e.message.includes(content));
 }
 for(const control of ['\r','\f','\v']) assert.throws(()=>validateEditRegion(f,{...f.files,[r.path]:r.prefix+'    '+control+'    pass\n'+r.suffix}),/indented/);
});
