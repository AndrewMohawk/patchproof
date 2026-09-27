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
toolManifestPath=P/'research/corpus-v2/tools/snapshot-manifest.json'
toolManifest=load(toolManifestPath)
for item in toolManifest['files']:
 assert digest(read(B/item['privateOriginalPath']))==item['digest']
 assert digest(read(P/item['publishedPath']))==item['digest']
environmentPath=B/'validation/tooling-environment-contract22.json'
environmentDigest=digest(read(environmentPath))
previewBinding=load(B/'validation/public-preview-binding.json')
previewRoot=Path(previewBinding['path']);previewManifestPath=previewRoot/'preview-manifest.json'
assert digest(read(previewManifestPath))==previewBinding['manifestDigest']
previewManifest=load(previewManifestPath);previewFiles={f['path']:f['digest']for f in previewManifest['fixtureFiles']}
assert len(previewFiles)==30 and previewManifest['status']=='provisional-public-only-preview'
for name,d in previewFiles.items():assert digest(read(previewRoot/name))==d
operationalInventoryPath=P/'research/corpus-v2/operational-source-843b368.json'
operationalInventory=load(operationalInventoryPath)
assert operationalInventory['sourceCommit']=='843b3687eb7b07d5a9ae0c7b00d3079804e596a8'and operationalInventory['allBytesMatchedCommit']is True
handleAuditPath=P/'research/corpus-v2/local-handle-audit.json'
handleAudit=load(handleAuditPath)
assert handleAudit['status']=='complete_no_unresolved_owned_handles'
assert handleAudit['sourceCommit']==operationalInventory['sourceCommit']
assert handleAudit['operationalInventoryDigest']==digest(read(operationalInventoryPath))
assert handleAudit['sourceFilesChecked']==len(operationalInventory['sources'])
for key in ['missingResults','duplicateHandles','operationBindingErrors','unresolved','remainingTaskOwnedContainers','sourceMismatches']:assert handleAudit[key]==0
assert handleAudit['listingConfirmed']is True and handleAudit['newCandidateExecution']is False and handleAudit['providerCalls']==0
assert handleAudit['privateAuditDigest']==digest(read(B/'validation/local-handle-audit-private.json'))
incidentPath=P/'research/corpus-v2/contract22-preparation-incidents.json'
incidents=load(incidentPath)['incidents']if incidentPath.exists()else[]
freshAttempts=[]
freshIntakes=[]
for intakePath in(B/'candidate-corpus').glob('repo*-*/artifacts/intake.json'):
 if any(x['path']=='packages/contracts/src/json-data.ts'for x in load(intakePath)['sourceBindings']):
  assert (intakePath.parent/'validation-private.json').is_file(),'Unfinished fresh preparation requires review before freeze'
  freshIntakes.append(intakePath)
common_runner=None
records=[];tasks=[];counts={'goldPassedTasks':0,'buggyRejectedTasks':0,'repeatStableTasks':0,'infrastructureFailedTasks':0};controls={'authorNegativeControlsRejected':0,'independentSemanticProbesPassed':0,'independentNegativeControlsRejected':0};seen_start={};seen_gold={};duplicates=[];allcases=0;sealed_repeats=0;resolved=0;corrections=0;requirement_count=0;layer_counts={"visible":0,"acceptance":0,"sealed":0};within_repo_duplicates={'start':0,'gold':0};across_repo_duplicates={'start':0,'gold':0}
for i in range(1,13):
 slot=f'repo{i:02}';job=load(B/'shared/jobs'/f'{slot}.json');reviewpath=B/'review'/slot/'static-review.json';review=load(reviewpath)
 assert review['status']=='approved_for_bounded_validation'and review['unresolvedFindings']==0 and review['reviewerIsAuthor']is False
 manifestname=review.get('submissionFile','submission.json');subpath=B/'authors'/slot/manifestname;sub=load(subpath);assert digest(read(subpath))==review['submissionDigest'];revision=B/'authors'/slot/sub['revision'];listed={x['path']:x['digest']for x in sub['files']}
 assert len(listed)==16
 for name,d in listed.items():assert digest(read(revision/name))==d
 matches=[]
 for path in (B/'candidate-corpus').glob(slot+'-*/artifacts/validation-private.json'):
  val=load(path)
  if val.get('productContractVersion')=='2.2':
   freshAttempts.append({'repoId':job['repoId'],'status':val['status'],'submissionDigest':val['submissionDigest'],'receiptDigest':digest(read(path)),'infrastructureFailedTasks':val['summary']['infrastructureFailedTasks'],'completedBatches':len(list((path.parent/'batches').glob('*.result.json')))})
  if val['submissionDigest']==review['submissionDigest']and val['status']=='validated'and val.get('productContractVersion')=='2.2':matches.append((path,val))
 assert len(matches)==1, 'Exactly one accepted validation required; explicitly adjudicate repeated attempts before freeze'
 path,val=matches[0]
 intakeAtRun=load(path.parent/'intake.json');assert intakeAtRun['approval']==review
 assert intakeAtRun['intaken']['submissionDigest']==review['submissionDigest']
 assert digest(read(path.parent/'reviewer-probes.json'))==val['reviewerProbeDigest']==digest(read(B/'review'/slot/'reviewer-probes.json'))
 assert val['sourceStable']is True and val['providerCalls']==0 and val['spendUsd']==0 and val['benchmarkExecuted']is False
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
  for folder in ['fixtures','gold','negative-controls']:
   assert digest(read(path.parent.parent/folder/(taskId+'.json')))==listed[folder+'/'+taskId+'.json']
  assert f['repoId']==job['repoId']and f['split']==job['split']and f['id']==g['taskId']==taskId
  bound=next(t for t in validationManifest['tasks']if t['id']==taskId);assert bound['fixtureDigest']==fd and bound['oracleDigest']==gd
  allcases+=len(f['visibleCases'])+len(f['acceptanceCases'])+len(g['sealedCases']);requirement_count+=len(f['requirements'])
  for layer,cases in [('visible',f['visibleCases']),('acceptance',f['acceptanceCases']),('sealed',g['sealedCases'])]:layer_counts[layer]+=len(cases)
  case_key=lambda c:json.dumps([c['function'],c['args'],c['kwargs']],sort_keys=True,separators=(',',':'))
  public_calls={case_key(c)for c in f['visibleCases']+f['acceptanceCases']}
  sealed_repeats+=sum(case_key(c)in public_calls for c in g['sealedCases'])
  for kind,mapping,seen in [('start',f['files'],seen_start),('gold',g['goldFiles'],seen_gold)]:
   key=digest(json.dumps(mapping,sort_keys=True,separators=(',',':')).encode())
   for prior in seen.get(key,[]):
    if prior[2]==f['repoId']:within_repo_duplicates[kind]+=1
    else:across_repo_duplicates[kind]+=1
    if prior[1]!=f['split']:duplicates.append({'kind':kind,'taskIds':[prior[0],taskId]})
   seen.setdefault(key,[]).append((taskId,f['split'],f['repoId']))
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
assert len(freshAttempts)==len(freshIntakes),'All fresh attempts must appear in history'
unsuccessful=[a for a in freshAttempts if a['status']!='validated']
for attempt in unsuccessful:
 incident=next(i for i in incidents if i['originalValidationReceiptDigest']==attempt['receiptDigest'])
 assert incident['classification']=='docker_create_timeout_and_unconfirmed_cleanup'and incident['cleanupConfirmed']is True and incident['fixturesChanged']is False and incident['limitsChanged']is False and incident['originalAttemptRetained']is True
preparationHistory={'attempts':len(freshAttempts),'acceptedRepositories':12,'unsuccessfulAttempts':len(unsuccessful),'infrastructureFailedTasksInUnsuccessfulAttempts':sum(a['infrastructureFailedTasks']for a in unsuccessful),'completedBatchesInUnsuccessfulAttempts':sum(a['completedBatches']for a in unsuccessful),'incidentMetadataDigest':digest(read(incidentPath))if incidents else None,'scope':'All fresh contract2.2 preparation attempts, including preserved failures; these are not model-evaluation episodes.'}
# Atomic publication is deliberately not performed. This is a new private staging tree.
out=B/'frozen-v2';assert not out.exists();out.mkdir(mode=0o700)
for d in ['fixtures','gold','public','public/fixtures','public/fixtures/development','public/fixtures/calibration','private-receipts']:(out/d).mkdir(mode=0o700)
for task in tasks:
 rev=Path(task.pop('_revision'))
 for folder in ['fixtures','gold']:
  target=out/folder/(task['id']+'.json');shutil.copyfile(rev/folder/target.name,target);target.chmod(0o600)
 if task['split']!='final':
  assert previewFiles['fixtures/'+task['split']+'/'+task['id']+'.json']==task['fixtureDigest']
  target=out/'public/fixtures'/task['split']/(task['id']+'.json');shutil.copyfile(rev/'fixtures'/target.name,target);target.chmod(0o600)
manifest={'schemaVersion':'1.0','corpusVersion':'v2','authoredAt':datetime.date.today().isoformat(),'license':'CC0-1.0','source':'Original synthetic Python maintenance tasks from twelve separately launched AI author contexts; no third-party dataset copied.','sealStatus':'prepared-not-scored','caveats':['Authors independently designed each repository without reading other corpus definitions; same-model procedural separation is not human authorship or statistical independence.','Repositories are synthetic, not independently sampled upstream maintenance projects; shared algorithm families and JSON function-call format limit generalization.','Gold/start/repeat and negative controls are oracle preparation by an independent reviewer, not a repair-model benchmark.','Finite checks and requirement labels do not establish universal correctness or exclusive fault localization.'],'splits':{s:{'tasks':sum(t['split']==s for t in tasks),'repositories':sorted({t['repoId']for t in tasks if t['split']==s})}for s in ['development','calibration','final']},'tasks':tasks}
write(out/'split-manifest.json',manifest);shutil.copyfile(out/'split-manifest.json',out/'public/fixtures/split-manifest.json');(out/'public/fixtures/split-manifest.json').chmod(0o600);md=digest(read(out/'split-manifest.json'))
private={'manifestDigest':md,'records':records,'duplicateChecks':duplicates,'freshAttempts':freshAttempts};write(out/'private-receipts/accepted-records.json',private)
for record in records:record.pop('_validation')
provenance={'schemaVersion':'1.0','manifestDigest':md,'status':'independently_authored_reviewed_and_reviewer_runtime_validated','authorJobLedgerDigest':digest(read(launchPath)),'toolingSnapshotManifestDigest':digest(read(toolManifestPath)),'toolingEnvironmentDigest':environmentDigest,'publicPreviewManifestDigest':previewBinding['manifestDigest'],'operationalSourceInventoryDigest':digest(read(operationalInventoryPath)),'localHandleAuditDigest':digest(read(handleAuditPath)),'sharedSchemas':[{'path':f,'digest':digest(read(B/'shared'/f))}for f in ['fixture.schema.json','oracle.schema.json','negative-control.schema.json']],'repositories':records,'scope':'Root-safe metadata only. Launch ledger and author attestations are procedural records, not independent platform or human attestations.'};write(out/'public/fixtures/author-provenance.json',provenance)
summary={'schemaVersion':'1.0','corpusVersion':'v2','status':'independently_authored_reviewed_and_reviewer_runtime_validated','manifestDigest':md,'reviewArtifactDigest':digest(read(out/'private-receipts/accepted-records.json')),'provenanceDigest':digest(read(out/'public/fixtures/author-provenance.json')),'counts':{'tasksReviewed':60,'publicTasksReviewed':30,'sealedTasksReviewed':30,'repositories':12,'independentAuthorJobs':12,'requirementsReviewed':requirement_count,'caseDefinitionsReviewed':allcases,'casesByLayer':layer_counts,'sealedCasesIdenticalToVisibleOrRuntime':sealed_repeats,'resolvedFindings':resolved,'unresolvedFindings':0,'correctionRevisions':corrections,'exactCrossSplitStartingSourceDuplicates':0,'exactCrossSplitGoldDuplicates':0,'exactSourceMapWithinRepositoryDuplicatePairs':within_repo_duplicates,'exactSourceMapAcrossRepositoryDuplicatePairs':across_repo_duplicates,**controls},'independentHumanReview':False,'independentAIReview':True,'reviewerIsAnAuthor':False,'reviewerRuntimeEvidenceMatchesManifest':True,'reviewerRuntimeCounts':{'totalTasks':60,**counts},'reviewerRuntimeCountsScope':'Accepted one-per-repository preparations only; see freshPreparationHistory for unsuccessful attempts.','freshPreparationHistory':preparationHistory,'scoredModelEvaluationPerformed':False,'providerSpendUsd':0,'runner':common_runner,'toolingSnapshotManifestDigest':digest(read(toolManifestPath)),'toolingEnvironmentDigest':environmentDigest,'publicPreviewManifestDigest':previewBinding['manifestDigest'],'operationalSourceInventoryDigest':digest(read(operationalInventoryPath)),'localHandleAuditDigest':digest(read(handleAuditPath)),'productContractVersion':'2.2','historicalPreparationNote':'Earlier contract2.1 preparations are preserved but excluded from these fresh counts; see research/corpus-v2/contract22-restart-plan.json.','limitations':manifest['caveats']};write(out/'public/fixtures/independent-review-summary.json',summary)
shutil.copyfile(B/'review/README-v2.md',out/'public/fixtures/README.md');(out/'public/fixtures/README.md').chmod(0o600)
print(json.dumps({'status':summary['status'],'manifestDigest':md,'publicTasks':30,'privateTasks':60,'staging':str(out/'public')}))
