"""Copy only completed receipt metadata into the root-safe author ledger."""
from pathlib import Path
import json,hashlib,datetime,os
B=Path('/home/andrewmohawk/patchproof-evaluation-v2');P=Path('/home/andrewmohawk/patchproof/research/corpus-v2/author-jobs.json')
digest=lambda b:'sha256:'+hashlib.sha256(b).hexdigest()
original=P.read_bytes();ledger=json.loads(original);updated=[]
for i in range(1,13):
 slot=f'repo{i:02}';approval=json.loads((B/'review'/slot/'static-review.json').read_text());matches=[]
 for path in (B/'candidate-corpus').glob(slot+'-*/artifacts/validation-private.json'):
  v=json.loads(path.read_text())
  if v.get('productContractVersion')=='2.2'and v['submissionDigest']==approval['submissionDigest']and v['status']=='validated':matches.append((path,v))
 if not matches:continue
 assert len(matches)==1,'Repeated successful attempts require explicit review'
 path,v=matches[0];s=v['summary'];assert v['sourceStable']and v['sourceCommit']=='843b3687eb7b07d5a9ae0c7b00d3079804e596a8'
 assert s['goldPassedTasks']==s['buggyRejectedTasks']==s['repeatStableTasks']==5 and s['infrastructureFailedTasks']==0
 assert v['controls']and all(c['passed']for c in v['controls'])and v['providerCalls']==v['spendUsd']==0 and v['benchmarkExecuted']is False
 job=next(j for j in ledger['jobs']if j['slot']==slot);d=digest(path.read_bytes());prior=job.get('validation')
 if prior and prior.get('productContractVersion')=='2.2':
  assert prior['receiptDigest']==d,'Do not silently replace a completed receipt'
  continue
 exit_records=[]
 for completed in (B/'validation').glob('*-'+slot+'-queue-result.json'):
  q=json.loads(completed.read_text())
  if q.get('exitCode')!=0:continue
  log=Path(q['logfile']).read_bytes()
  if digest(log)!=q['logDigest']:continue
  for line in log.decode().splitlines():
   try:message=json.loads(line)
   except json.JSONDecodeError:continue
   if message.get('status')=='validated'and message.get('privateResult')==str(path):exit_records.append(q)
 if not exit_records:continue # receipt may precede the child's actual exit; wait for durable exit evidence
 assert len(exit_records)==1,'Repeated successful dispatch needs review'
 if prior:
  assert 'historicalContract21Validation'not in job or job['historicalContract21Validation']==prior
  job['historicalContract21Validation']=prior
 job['validation']={'receiptDigest':d,'reportedBy':'/root/fixtures_evaluation','productContractVersion':'2.2','sourceCommit':v['sourceCommit'],'exitCode':0,'goldPassed':s['goldPassedTasks'],'startRejected':s['buggyRejectedTasks'],'repeatStable':s['repeatStableTasks'],'controlsPassed':sum(c['passed']for c in v['controls']),'infrastructureFailures':s['infrastructureFailedTasks'],'sourceStable':v['sourceStable']}
 job['status']='runtime-validated-contract-2.2';updated.append(slot)
if updated:
 stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();ledger['recordedAt']=stamp
 preserved=B/'validation'/('author-ledger-before-'+stamp.replace(':','-')+'.json')
 with preserved.open('x')as f:f.write(original.decode())
 preserved.chmod(0o600)
 assert P.read_bytes()==original,'Concurrent ledger mutation; no overwrite'
 temporary=P.with_name('.author-jobs.pending-'+str(os.getpid()))
 with temporary.open('x')as f:json.dump(ledger,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 os.replace(temporary,P);fd=os.open(P.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
print(json.dumps({'updatedSlots':updated,'topLevelStatus':ledger['status'],'ledgerDigest':digest(P.read_bytes())}))
