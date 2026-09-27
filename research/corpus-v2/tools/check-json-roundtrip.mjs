import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {FunctionCaseSchema} from '/home/andrewmohawk/patchproof/packages/contracts/src/product.ts';
const base='/home/andrewmohawk/patchproof-evaluation-v2';
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const records=[],failures=[];let caseCount=0;
for(let i=1;i<=12;i++){
 const slot='repo'+String(i).padStart(2,'0'),dir=base+'/authors/'+slot;
 if(!existsSync(dir+'/submission.json'))continue;
 const approval=base+'/review/'+slot+'/static-review.json';
 const manifest=existsSync(approval)?(JSON.parse(readFileSync(approval)).submissionFile??'submission.json'):'submission.json';
 const subBytes=readFileSync(dir+'/'+manifest),sub=JSON.parse(subBytes);let count=0;
 for(const file of sub.files.filter(f=>f.path.startsWith('fixtures/')||f.path.startsWith('gold/'))){
  const raw=JSON.parse(readFileSync(dir+'/'+sub.revision+'/'+file.path));
  for(const c of [...raw.visibleCases??[],...raw.acceptanceCases??[],...raw.sealedCases??[]]){
   const parsed=FunctionCaseSchema.safeParse(c);count++;caseCount++;
   if(!parsed.success||!isDeepStrictEqual(c,parsed.data))failures.push({slot,path:file.path,id:c.id,kind:parsed.success?'lossy_projection':'rejected'});
  }
 }
 records.push({slot,submissionDigest:hash(subBytes),caseCount:count});
}
const output={purpose:'authored-case JSON parser projection preflight, no authored Python execution',contractDigest:hash(readFileSync('/home/andrewmohawk/patchproof/packages/contracts/src/product.ts')),records,caseCount,failures,providerCalls:0,candidateExecutions:0};
const outputPath=base+'/review/json-roundtrip-'+new Date().toISOString().replaceAll(':','-')+'.json';writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({repositories:records.length,cases:caseCount,projectionFailures:failures.length,artifactDigest:hash(readFileSync(outputPath))}));
