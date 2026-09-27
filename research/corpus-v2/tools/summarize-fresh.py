"""Root-safe progress metadata only; never emits task names, cases or source."""
from pathlib import Path
import json,hashlib
b=Path('/home/andrewmohawk/patchproof-evaluation-v2/candidate-corpus')
rows=[]
for p in sorted(b.glob('repo*-*/artifacts/validation-private.json')):
 v=json.loads(p.read_text())
 if v.get('productContractVersion')!='2.2':continue
 rows.append({'slot':v['slot'],'status':v['status'],'sourceCommit':v['sourceCommit'],'sourceStable':v['sourceStable'],'summary':{k:v['summary'][k]for k in ['totalTasks','goldPassedTasks','buggyRejectedTasks','repeatStableTasks','infrastructureFailedTasks']},'controlsPassed':sum(c['passed']for c in v['controls']),'controlsTotal':len(v['controls']),'receiptPath':str(p),'receiptDigest':'sha256:'+hashlib.sha256(p.read_bytes()).hexdigest()})
print(json.dumps({'completedRepositories':len(rows),'validatedRepositories':sum(r['status']=='validated'for r in rows),'rows':rows},indent=2))
