// Trusted scheduling only. Authored Python is executed exclusively by the bounded child validator.
import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const base=resolve(process.env.PATCHPROOF_EVALUATION_ROOT??join(projectRoot,'..','patchproof-evaluation-v2'));
const slots=process.argv.slice(2);
if(!slots.length||new Set(slots).size!==slots.length||slots.some(s=>!/^repo(?:0[1-9]|1[0-2])$/.test(s)))throw new Error('Explicit unique approved repository slots required');
const queueId=randomUUID(),startedAt=new Date().toISOString(),digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(base,'validation',queueId+'-queue-plan.json'),JSON.stringify({queueId,startedAt,slots,maxParallelRepositoriesInThisQueue:1,maximumConcurrentQueues:2,automaticRetries:false,validationToolDigest:digest(readFileSync(join(base,'validation/validate-repository.mjs')))},null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
for(const slot of slots){
 const logfile=join(base,'validation',slot+'-contract22-queue-'+queueId+'.log'),fd=openSync(logfile,'wx',0o600),start=new Date().toISOString();
 let code;
 try{const child=spawn(process.execPath,[join(base,'validation/validate-repository.mjs'),slot],{cwd:base,stdio:['ignore',fd,fd]});code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(c,signal)=>resolve(c??(signal?128:1)));});}finally{closeSync(fd);}
 const result={queueId,slot,startedAt:start,finishedAt:new Date().toISOString(),exitCode:code,logfile,logDigest:digest(readFileSync(logfile))};
 writeFileSync(join(base,'validation',queueId+'-'+slot+'-queue-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
 process.stdout.write(JSON.stringify(result)+'\n');
 if(code!==0){process.exitCode=code;break;}
}
