"""Assemble only fully reviewed, validated v2 submissions. Never runs candidates."""
from pathlib import Path
import hashlib,json,shutil,datetime
B=Path('/home/andrewmohawk/patchproof-evaluation-v2');P=Path('/home/andrewmohawk/patchproof')
def digest(b):return 'sha256:'+hashlib.sha256(b).hexdigest()
def read(p):
 if p.is_symlink()or not p.is_file():raise ValueError('Unsafe regular file')
 return p.read_bytes()
def load(p):return json.loads(read(p))
def write(p,value):
 with p.open('x')as f:json.dump(value,f,indent=2,ensure_ascii=False);f.write('\n')
 p.chmod(0o600)
common_runner=None
records=[];tasks=[];counts={'goldPassedTasks':0,'buggyRejectedTasks':0,'repeatStableTasks':0,'infrastructureFailedTasks':0};controls={'authorNegativeControlsRejected':0,'independentSemanticProbesPassed':0,'independentNegativeControlsRejected':0};seen_start={};seen_gold={};duplicates=[];allcases=0;sealed_repeats=0;resolved=0;corrections=0;requirement_count=0;layer_counts={"visible":0,"acceptance":0,"sealed":0}
for i in range(1,13):
 slot=f'repo{i:02}';job=load(B/'shared/jobs'/f'{slot}.json');reviewpath=B/'review'/slot/'static-review.json';review=load(reviewpath)
 assert review['status']=='approved_for_bounded_validation'and review['unresolvedFindings']==0 and review['reviewerIsAuthor']is False
 manifestname=review.get('submissionFile','submission.json');subpath=B/'authors'/slot/manifestname;sub=load(subpath);assert digest(read(subpath))==review['submissionDigest'];revision=B/'authors'/slot/sub['revision'];listed={x['path']:x['digest']for x in sub['files']}
 assert len(listed)==16
 for name,d in listed.items():assert digest(read(revision/name))==d
 matches=[]
 for path in (B/'candidate-corpus').glob(slot+'-*/artifacts/validation-private.json'):
  val=load(path)
  if val['submissionDigest']==review['submissionDigest']and val['status']=='validated'and val.get('productContractVersion')=='2.2':matches.append((path,val))
 assert len(matches)==1, 'Exactly one accepted validation required; explicitly adjudicate repeated attempts before freeze'
 path,val=matches[0];assert val['sourceStable']is True and val['providerCalls']==0 and val['spendUsd']==0 and val['benchmarkExecuted']is False
 assert val['sourceCommit']=='843b3687eb7b07d5a9ae0c7b00d3079804e596a8'
 runner={'sourceCommit':val['sourceCommit'],'image':val['runnerImage'],'sources':val['sourceBindings'],'validationToolDigest':val['validationToolDigest'],'intakeToolDigest':val['intakeToolDigest']}
 if common_runner is None:common_runner=runner
 assert runner==common_runner, 'Validation runner drift across repositories requires explicit review'
 validationManifest=load(path.parent.parent/'split-manifest.json');assert len(validationManifest['tasks'])==5
 for k in counts:counts[k]+=val['summary'][k]
 for c in val['controls']:
  assert c['passed']
  key={'author-negative-control':'authorNegativeControlsRejected','independent-reviewer-semantic':'independentSemanticProbesPassed','independent-reviewer-negative-control':'independentNegativeControlsRejected'}.get(c['kind'])
  if key:controls[key]+=1
 assert val['summary']['goldPassedTasks']==val['summary']['buggyRejectedTasks']==val['summary']['repeatStableTasks']==5 and val['summary']['infrastructureFailedTasks']==0
 for taskId in job['taskIds']:
  f=load(revision/'fixtures'/f'{taskId}.json');g=load(revision/'gold'/f'{taskId}.json');fd=digest(read(revision/'fixtures'/f'{taskId}.json'));gd=digest(read(revision/'gold'/f'{taskId}.json'))
  assert f['repoId']==job['repoId']and f['split']==job['split']and f['id']==g['taskId']==taskId
  bound=next(t for t in validationManifest['tasks']if t['id']==taskId);assert bound['fixtureDigest']==fd and bound['oracleDigest']==gd
  allcases+=len(f['visibleCases'])+len(f['acceptanceCases'])+len(g['sealedCases']);requirement_count+=len(f['requirements'])
  for layer,cases in [('visible',f['visibleCases']),('acceptance',f['acceptanceCases']),('sealed',g['sealedCases'])]:layer_counts[layer]+=len(cases)
  case_key=lambda c:json.dumps([c['function'],c['args'],c['kwargs']],sort_keys=True,separators=(',',':'))
  public_calls={case_key(c)for c in f['visibleCases']+f['acceptanceCases']}
  sealed_repeats+=sum(case_key(c)in public_calls for c in g['sealedCases'])
  for kind,mapping,seen in [('start',f['files'],seen_start),('gold',g['goldFiles'],seen_gold)]:
   key=digest(json.dumps(mapping,sort_keys=True,separators=(',',':')).encode())
   if key in seen and seen[key][1]!=f['split']:duplicates.append({'kind':kind,'taskIds':[seen[key][0],taskId]})
   seen[key]=(taskId,f['split'])
  tasks.append({'id':taskId,'repoId':job['repoId'],'split':job['split'],'fixtureDigest':fd,'oracleDigest':gd,'_revision':str(revision)})
 resolved+=review.get('resolvedFindings',0);corrections+=int(sub['revision'].split('-')[1])-1
 records.append({'repoId':job['repoId'],'split':job['split'],'canonicalAuthorIdentity':f'/root/corpus_v2_{slot}','declaredAuthorName':sub['authorIdentity'] if isinstance(sub['authorIdentity'],str) else sub['authorIdentity']['canonicalAgentName'],'declaredIdentityShape':'string' if isinstance(sub['authorIdentity'],str) else 'object','acceptedRevision':sub['revision'],'acceptedSubmission':str(subpath.relative_to(B)),'submissionDigest':digest(read(subpath)),'provenanceDigest':listed['provenance.json'],'sharedInstructionDigest':digest(read(B/'shared/author-instructions.md')),'sharedJobDigest':digest(read(B/'shared/jobs'/f'{slot}.json')),'correctionCount':int(sub['revision'].split('-')[1])-1,'staticApprovalDigest':digest(read(reviewpath)),'runtimeValidationDigest':digest(read(path)),'runtimeStatus':'independent_reviewer_validated','_validation':str(path)})
assert len(tasks)==60 and len({x['id']for x in tasks})==60 and not duplicates
assert [sum(t['split']==s for t in tasks)for s in ['development','calibration','final']]==[20,10,30]
launchPath=P/'research/corpus-v2/author-jobs.json';launch=load(launchPath)
assert len(launch['jobs'])==12 and len({j['slot']for j in launch['jobs']})==12
for record in records:
 slot='repo'+record['repoId'][-2:];job=next(j for j in launch['jobs']if j['slot']==slot)
 assert job['agent']==record['canonicalAuthorIdentity'] and job['forkTurns']=='none' and job['launchTool']=='collaboration.spawn_agent'
 assert any(r['revision']==record['acceptedRevision']and r['submissionDigest']==record['submissionDigest']for r in job['submittedRevisions'])
 assert job.get('validation',{}).get('receiptDigest')==record['runtimeValidationDigest']
# Atomic publication is deliberately not performed. This is a new private staging tree.
out=B/'frozen-v2';assert not out.exists();out.mkdir(mode=0o700)
for d in ['fixtures','gold','public','public/fixtures','public/fixtures/development','public/fixtures/calibration','private-receipts']:(out/d).mkdir(mode=0o700)
for task in tasks:
 rev=Path(task.pop('_revision'))
 for folder in ['fixtures','gold']:
  target=out/folder/(task['id']+'.json');shutil.copyfile(rev/folder/target.name,target);target.chmod(0o600)
 if task['split']!='final':
  target=out/'public/fixtures'/task['split']/(task['id']+'.json');shutil.copyfile(rev/'fixtures'/target.name,target);target.chmod(0o600)
manifest={'schemaVersion':'1.0','corpusVersion':'v2','authoredAt':datetime.date.today().isoformat(),'license':'CC0-1.0','source':'Original synthetic Python maintenance tasks from twelve separately launched AI author contexts; no third-party dataset copied.','sealStatus':'prepared-not-scored','caveats':['Authors independently designed each repository without reading other corpus definitions; same-model procedural separation is not human authorship or statistical independence.','Repositories are synthetic, not independently sampled upstream maintenance projects; shared algorithm families and JSON function-call format limit generalization.','Gold/start/repeat and negative controls are oracle preparation by an independent reviewer, not a repair-model benchmark.','Finite checks and requirement labels do not establish universal correctness or exclusive fault localization.'],'splits':{s:{'tasks':sum(t['split']==s for t in tasks),'repositories':sorted({t['repoId']for t in tasks if t['split']==s})}for s in ['development','calibration','final']},'tasks':tasks}
write(out/'split-manifest.json',manifest);shutil.copyfile(out/'split-manifest.json',out/'public/fixtures/split-manifest.json');(out/'public/fixtures/split-manifest.json').chmod(0o600);md=digest(read(out/'split-manifest.json'))
private={'manifestDigest':md,'records':records,'duplicateChecks':duplicates};write(out/'private-receipts/accepted-records.json',private)
for record in records:record.pop('_validation')
provenance={'schemaVersion':'1.0','manifestDigest':md,'status':'independently_authored_reviewed_and_reviewer_runtime_validated','authorJobLedgerDigest':digest(read(launchPath)),'sharedSchemas':[{'path':f,'digest':digest(read(B/'shared'/f))}for f in ['fixture.schema.json','oracle.schema.json','negative-control.schema.json']],'repositories':records,'scope':'Root-safe metadata only. Launch ledger and author attestations are procedural records, not independent platform or human attestations.'};write(out/'public/fixtures/author-provenance.json',provenance)
summary={'schemaVersion':'1.0','corpusVersion':'v2','status':'independently_authored_reviewed_and_reviewer_runtime_validated','manifestDigest':md,'reviewArtifactDigest':digest(read(out/'private-receipts/accepted-records.json')),'provenanceDigest':digest(read(out/'public/fixtures/author-provenance.json')),'counts':{'tasksReviewed':60,'publicTasksReviewed':30,'sealedTasksReviewed':30,'repositories':12,'independentAuthorJobs':12,'requirementsReviewed':requirement_count,'caseDefinitionsReviewed':allcases,'casesByLayer':layer_counts,'sealedCasesIdenticalToVisibleOrRuntime':sealed_repeats,'resolvedFindings':resolved,'unresolvedFindings':0,'correctionRevisions':corrections,'exactCrossSplitStartingSourceDuplicates':0,'exactCrossSplitGoldDuplicates':0,**controls},'independentHumanReview':False,'independentAIReview':True,'reviewerIsAnAuthor':False,'reviewerRuntimeEvidenceMatchesManifest':True,'reviewerRuntimeCounts':{'totalTasks':60,**counts},'scoredModelEvaluationPerformed':False,'providerSpendUsd':0,'runner':common_runner,'productContractVersion':'2.2','historicalPreparationNote':'Earlier contract2.1 preparations are preserved but excluded from these fresh counts; see research/corpus-v2/contract22-restart-plan.json.','limitations':manifest['caveats']};write(out/'public/fixtures/independent-review-summary.json',summary)
shutil.copyfile(B/'review/README-v2.md',out/'public/fixtures/README.md');(out/'public/fixtures/README.md').chmod(0o600)
print(json.dumps({'status':summary['status'],'manifestDigest':md,'publicTasks':30,'privateTasks':60,'staging':str(out/'public')}))
