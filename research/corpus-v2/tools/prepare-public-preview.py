"""Create a new read-only public-only preview after the first six repositories pass."""
from pathlib import Path
import json,hashlib,datetime,uuid,shutil
B=Path('/home/andrewmohawk/patchproof-evaluation-v2');ROOT=Path('/home/andrewmohawk/patchproof')
digest=lambda b:'sha256:'+hashlib.sha256(b).hexdigest()
ledger=json.loads((ROOT/'research/corpus-v2/author-jobs.json').read_text());prepared=[];bindings=[]
for i in range(1,7):
 slot=f'repo{i:02}';approval=json.loads((B/'review'/slot/'static-review.json').read_text());sp=B/'authors'/slot/approval.get('submissionFile','submission.json');sb=sp.read_bytes();sub=json.loads(sb);assert digest(sb)==approval['submissionDigest'];revision=sp.parent/sub['revision'];listed={x['path']:x['digest']for x in sub['files']};matches=[]
 for p in(B/'candidate-corpus').glob(slot+'-*/artifacts/validation-private.json'):
  v=json.loads(p.read_text())
  if v.get('productContractVersion')=='2.2'and v['status']=='validated'and v['submissionDigest']==approval['submissionDigest']:matches.append((p,v))
 assert len(matches)==1
 rp,v=matches[0];row=next(j for j in ledger['jobs']if j['slot']==slot)['validation'];assert row['receiptDigest']==digest(rp.read_bytes())and row['exitCode']==0
 assert v['sourceStable']and v['sourceCommit']=='843b3687eb7b07d5a9ae0c7b00d3079804e596a8'and v['summary']['goldPassedTasks']==v['summary']['buggyRejectedTasks']==v['summary']['repeatStableTasks']==5 and v['summary']['infrastructureFailedTasks']==0 and all(c['passed']for c in v['controls'])
 job=json.loads((B/'shared/jobs'/f'{slot}.json').read_text());assert job['split']in['development','calibration']
 for task_id in job['taskIds']:
  path=revision/'fixtures'/(task_id+'.json');assert path.is_file()and not path.is_symlink();raw=path.read_bytes();f=json.loads(raw);assert f['id']==task_id and f['repoId']==job['repoId']and f['split']==job['split'];assert digest(raw)==listed['fixtures/'+task_id+'.json']==digest((rp.parent.parent/'fixtures'/path.name).read_bytes())
  prepared.append((f'fixtures/{f["split"]}/{path.name}',raw,{'id':task_id,'repoId':job['repoId'],'split':job['split']}))
 bindings.append({'repoId':job['repoId'],'acceptedRevision':sub['revision'],'submissionDigest':approval['submissionDigest'],'runtimeValidationDigest':digest(rp.read_bytes())})
assert len(prepared)==30 and len({x[0]for x in prepared})==30
out=B/('public-preview-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+str(uuid.uuid4()));out.mkdir(mode=0o700)
for name in['fixtures','fixtures/development','fixtures/calibration']:(out/name).mkdir(mode=0o700)
files=[]
for name,raw,identity in prepared:
 p=out/name
 with p.open('xb')as f:f.write(raw)
 p.chmod(0o444);files.append({'path':name,'digest':digest(raw),**identity})
manifest={'schemaVersion':'1.0','status':'provisional-public-only-preview','notFinalCorpusFreeze':True,'sourceCommit':'843b3687eb7b07d5a9ae0c7b00d3079804e596a8','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'taskCounts':{'development':20,'calibration':10},'fixtureFiles':files,'repositories':bindings,'included':'Thirty accepted development/calibration Fixture JSONs only. No gold, final definitions, reviewer probes or private receipts.','constraints':['Main fixtures remain unchanged.','Final v2 freeze must match every preview byte.','No scored experiment or publication authorization is conveyed.']}
p=out/'preview-manifest.json'
with p.open('x')as f:json.dump(manifest,f,indent=2);f.write('\n')
p.chmod(0o444)
assert sorted(str(p.relative_to(out))for p in out.rglob('*')if p.is_file())==sorted([x[0]for x in prepared]+['preview-manifest.json'])
for name in['fixtures/development','fixtures/calibration','fixtures','']:(out/name).chmod(0o555)
record={'path':str(out),'manifestDigest':digest(p.read_bytes()),'fixtureFiles':30,'status':manifest['status']};r=B/'validation/public-preview-binding.json'
with r.open('x')as f:json.dump(record,f,indent=2);f.write('\n')
r.chmod(0o600)
print(json.dumps(record))
