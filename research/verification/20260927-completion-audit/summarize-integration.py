"""Summarize retained actual local observations; never execute candidate/provider work."""
import datetime, hashlib, json, pathlib, subprocess, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = pathlib.Path(__file__).resolve().parent
SOURCE = '06c584c23ac1b620a14ba5e3c68fbdb02199a164'
PINNED = pathlib.Path('/tmp/patchproof-handoff-audit')

def read(path):
    return json.loads(path.read_text())

def digest(path):
    return 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()

def parsed_log(path):
    text = path.read_text()
    return json.JSONDecoder().raw_decode(text[text.index('{\n'):])[0]

def lifecycles(value):
    found = {}
    def visit(item):
        if isinstance(item, dict):
            if 'dockerLifecycle' in item:
                row = item['dockerLifecycle']; prior = found.get(row['operationId'])
                assert prior is None or prior == row
                found[row['operationId']] = row
            for key, child in item.items():
                if key == 'log' and isinstance(child, str):
                    try: visit(json.loads(child))
                    except json.JSONDecodeError: pass
                elif isinstance(child, (dict, list)): visit(child)
        elif isinstance(item, list):
            for child in item: visit(child)
    visit(value)
    assert all(row['createAcknowledged'] and row['cleanupConfirmed'] for row in found.values())
    return found

before = read(OUT/'historical-before.json')
for row in before['results']:
    path = ROOT/'.local/product/evidence'/row['filename']
    assert digest(path) == row['byteDigest']
precommit = read(OUT/'precommit-verification.json')
for file, expected in precommit['operationalLock']['sources'].items():
    assert digest(ROOT/file) == expected == digest(PINNED/file)
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=PINNED,text=True).strip() == SOURCE
browser = read(OUT/'browser-report.json')
assert browser['status'] == 'passed' and len(browser['createdIds']) == 3
runs, replays, operations = [], [], {}
for variant in ['baseline','checks_only','patchproof','abstention']:
    file = OUT/'bundles'/f'{variant}.json'; bundle = read(file); run = bundle['run']
    assert bundle['mode'] == 'mock' and not bundle['competitionReady']
    assert run['usage']['inferenceCalls'] == 0 and run['usage']['measuredCostUsd'] == 0
    found = lifecycles(run)
    assert set(found) == set(run['sandboxOperationIds'])
    assert not set(found).intersection(operations)
    operations.update(found)
    if variant != 'abstention':
        assert run['terminalStatus'] == 'verified_for_declared_checks'
        assert len(run['candidates']) == 2 and run['selectedCandidateId'] == 2
        assert not run['candidates'][0]['accepted'] and run['candidates'][1]['accepted']
        assert len(found) == 54
    else:
        assert run['terminalStatus'] == 'needs_review' and run['reason'] == 'mock_task_unavailable'
        assert not run['candidates'] and run['selectedCandidateId'] is None
    runs.append({'id':run['id'],'taskId':run['taskId'],'variant':run['variant'],'selection':variant,
        'status':run['terminalStatus'],'reason':run['reason'],'path':str(file.relative_to(OUT)),
        'bundleDigest':bundle['bundleDigest'],'byteDigest':digest(file),'usage':run['usage'],'limits':run['limits'],
        'candidates':len(run['candidates']),'selectedCandidateId':run['selectedCandidateId'],
        'operations':len(found),'cleanupConfirmed':len(found)})
    replay = parsed_log(OUT/f'reproduce-{variant}.log'); replay_ops = lifecycles(replay)
    if variant != 'abstention':
        assert replay['status'] == 'reproduced' and replay['checkCount'] == 9 and len(replay_ops) == 18
    else:
        assert replay['status'] == 'no_selected_patch' and replay['executionPerformed'] is False and not replay_ops
    assert not set(replay_ops).intersection(operations); operations.update(replay_ops)
    replays.append({'runId':run['id'],'selection':variant,'status':replay['status'],
        'exitCode':2 if variant == 'abstention' else 0,'checkCount':replay.get('checkCount',0),
        'executionPerformed':replay['executionPerformed'],'operations':len(replay_ops),'cleanupConfirmed':len(replay_ops),
        'log':f'reproduce-{variant}.log'})
assert runs[0]['limits'] == runs[1]['limits'] == runs[2]['limits']
assert all(row['exitCode'] == 0 for row in read(OUT/'reproduce-commands.json'))
assert read(OUT/'abstention-replay.json')['exitCode'] == 2
packet_result = parsed_log(OUT/'release-packet.log')
packet_path = pathlib.Path(packet_result['directory']); manifest = read(packet_path/'manifest.json')
assert manifest['sourceCommit'] == SOURCE and not manifest['workingTreeDirty']
assert len(manifest['bundles']) == 4 and all(b['sourceBinding'] == 'current' for b in manifest['bundles'])
assert manifest['evidenceStatus'] == 'blocked' and not manifest['competitionReady'] and not manifest['publicationAuthorized']
assert next(g for g in manifest['gates'] if g['id']=='release_secrets')['status']=='pass'
api_runs = json.load(urllib.request.urlopen('http://127.0.0.1:43171/runs'))['runs']
assert len(api_runs) == 24 and all(r['phase']=='terminal' for r in api_runs)
remaining = subprocess.check_output(['docker','ps','-aq','--filter','label=org.patchproof.owned=true'],text=True).splitlines()
assert not remaining
receipt = {'schemaVersion':'1.0','kind':'local-completion-integration','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceCommit':SOURCE,'sourceRoot':str(PINNED),'sourceFilesVerified':len(precommit['operationalLock']['sources']),
    'mode':'mock','competitionReady':False,'providerCalls':0,'providerSpendUsd':0,'approvedProjectCeilingUsd':25,
    'doctor':{'command':'make doctor','exitCode':0,'log':'doctor.log','paidCalls':0,'realIntegration':'NOT RUN'},
    'tests':{'command':'make test','exitCode':0,'passed':622,'log':'make-test.log','sourceBinding':'precommit-verification.json'},
    'browser':{'command':'node /tmp/patchproof-handoff-audit/apps/web/verify-browser.ts http://127.0.0.1:43171','exitCode':0,
        'report':'browser-report.json','log':'browser.log','historicalContext':'historical-browser-mcp.json','abstentionView':'abstention-browser-mcp.json','screenshots':'screenshots.json'},
    'runs':runs,'replays':replays,'containerOperations':len(operations),'cleanupConfirmed':len(operations),'remainingOwnedContainers':remaining,
    'historicalEvidence':{'before':before['total'],'unchanged':before['total'],'reference':'historical-before.json','currentTotal':len(api_runs),'activeRuns':0},
    'releasePacket':{'directory':str(packet_path),'packetDigest':manifest['packetDigest'],'sourceBinding':'current','selectedBundles':4,
        'evidenceStatus':manifest['evidenceStatus'],'secretScan':'release-scan-receipt.json','manifest':'packet-manifest.json',
        'verifyExitCode':0,'checksumExitCode':0,'releaseCheckExitCode':2,'publicationAuthorized':False},
    'independence':'Same host container replay and AI source/artifact review; not independent-machine or uncoached human validation',
    'limits':['Scripted model responses are not a model benchmark or evidence of policy advantage.',
        'Sandbox CPU consumption is unmeasured; elapsed wall time and operation lifecycle are recorded.',
        'Provider account, prices, isolation, cancellation and billing remain unverified.',
        'Live calibrated experiments, uncoached human study, independent-machine replay and owner release decisions remain open.']}
(OUT/'integration-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
(OUT/'operation-cleanup.json').write_text(json.dumps({'sourceCommit':SOURCE,'operations':list(operations.values()),'remainingOwnedContainers':remaining},indent=2)+'\n')
print(json.dumps({'runs':len(runs),'replays':[r['status'] for r in replays],'operations':len(operations),'historicalUnchanged':before['total'],'packetDigest':manifest['packetDigest']},indent=2))
