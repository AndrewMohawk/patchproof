import { writeFileSync, readFileSync } from 'node:fs';
import { inspectOwnedContainer } from '/home/andrewmohawk/patchproof/workers/sandbox/local-cleanup.ts';
import { runDocker } from '/home/andrewmohawk/patchproof/workers/sandbox/process.ts';
const expected={name:'patchproof-check-fdd35fda-056a-4e12-8826-e30a134ef782',image:'sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51',ownerRunId:'8d435119-0858-4f2c-883b-5226058637ee'};
const startedAt=new Date().toISOString(),inspection=await inspectOwnedContainer(runDocker,expected,1000);
const result={purpose:'Read-only inspection of the single recorded owned handle after infrastructure failure',startedAt,finishedAt:new Date().toISOString(),expected,inspection,noCandidateStarted:true};
writeFileSync('/home/andrewmohawk/patchproof-evaluation-v2/validation/repo07-attempt001-inspection.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});process.stdout.write(JSON.stringify(result)+'\n');
