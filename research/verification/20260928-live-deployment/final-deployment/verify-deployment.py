#!/usr/bin/env python3
"""Read-only deployment checks. Never creates, cancels, or bills a run."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
SHA = '7467626bc77b78ffe4698efc09898471b3ab72f1'

def command(argv):
    p = subprocess.run(argv, capture_output=True, text=True, timeout=45)
    return {'argv': argv, 'exitCode': p.returncode,
            'stdout': p.stdout, 'stderr': p.stderr}

def request(name, url, extra=()):
    headers, body = OUT / (name + '.headers'), OUT / (name + '.body')
    r = command(['curl', '--max-time', '30', '--silent', '--show-error',
                 '--dump-header', str(headers), '--output', str(body),
                 '--write-out', '%{json}', *extra, url])
    info = json.loads(r['stdout']) if r['stdout'].startswith('{') else {}
    data = body.read_bytes() if body.exists() else b''
    result = {'url': url, 'curlExitCode': r['exitCode'], 'error': r['stderr'],
              'status': info.get('http_code'), 'remoteIp': info.get('remote_ip'),
              'elapsedSeconds': info.get('time_total'),
              'tlsVerificationResult': info.get('ssl_verify_result'),
              'bodyBytes': len(data), 'bodySha256': hashlib.sha256(data).hexdigest(),
              'headers': headers.name, 'body': body.name}
    if '/healthz' in url and result['status'] == 200:
        result['health'] = json.loads(data)
    if url.endswith('/tasks') and result['status'] == 200:
        task = json.loads(data)
        result['catalog'] = {k: task[k] for k in ('mode', 'competitionReady',
          'limits', 'maxApprovedSpendUsd', 'availability', 'execution',
          'runtimeLockDigest')}
        result['catalog']['taskCount'] = len(task['tasks'])
        result['catalog']['allDevelopment'] = all(t['split'] == 'development' for t in task['tasks'])
    return result

started = datetime.datetime.now(datetime.timezone.utc).isoformat()
dns = command(['dig', '+short', 'A', 'patchproof.andrewmohawk.xyz', '@1.1.1.1'])
edge = next((s for s in dns['stdout'].splitlines() if s.count('.') == 3), None)
routes = [request('public-health', 'https://patchproof.andrewmohawk.xyz/healthz'),
          request('lab-health', 'https://patchproof.lab.andrewmohawk.xyz/healthz'),
          request('public-app', 'https://patchproof.andrewmohawk.xyz/'),
          request('public-tasks', 'https://patchproof.andrewmohawk.xyz/tasks'),
          request('public-player', 'https://patchproof.andrewmohawk.xyz/demo/'),
          request('unpublished-route', 'https://patchproof.andrewmohawk.xyz/admin')]
if edge:
    routes.append(request('cloudflare-health', 'https://patchproof.andrewmohawk.xyz/healthz',
      ['--resolve', 'patchproof.andrewmohawk.xyz:443:' + edge]))
raw = command(['docker', 'inspect', 'patchproof-frontend'])
d = json.loads(raw['stdout'])[0]
h = d['HostConfig']
container = {'id': d['Id'], 'imageId': d['Image'], 'user': d['Config']['User'],
             'health': d['State'].get('Health'), 'running': d['State']['Running'],
             'readOnlyRootfs': h['ReadonlyRootfs'], 'privileged': h['Privileged'],
             'portBindings': h['PortBindings'], 'capDrop': h['CapDrop'],
             'securityOpt': h['SecurityOpt'], 'memoryBytes': h['Memory'],
             'nanoCpus': h['NanoCpus'], 'pidsLimit': h['PidsLimit'],
             'mounts': d['Mounts'], 'network': h['NetworkMode']}
unit = command(['systemctl', '--user', 'show', 'patchproof-runtime@' + SHA + '.service',
   '--property=ActiveState,SubState,MainPID,NRestarts,WorkingDirectory,UMask,MemoryMax,CPUQuotaPerSecUSec,TasksMax'])
gatus = command(['docker', 'logs', '--since', '5m', 'gatus'])
monitor = [line for line in (gatus['stdout'] + gatus['stderr']).splitlines() if 'endpoint=PatchProof;' in line]
result = {'checkedAt': started, 'releaseCommit': SHA, 'scope': 'Read-only HTTP GET, DNS, service/container metadata, PatchProof monitoring lines only',
          'paidRequests': 0, 'dns': dns, 'routes': routes, 'frontend': container,
          'runtimeUnit': unit, 'gatusPatchProofLines': monitor,
          'videoStatus': 'NOT CHECKED: root will install the actual recording after repair verification'}
(OUT / 'deployment-receipt.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'receipt': str(OUT / 'deployment-receipt.json'),
                  'routes': [{k: x.get(k) for k in ('url', 'status', 'elapsedSeconds')} for x in routes],
                  'frontendHealth': container['health']['Status'],
                  'gatusLatest': monitor[-1] if monitor else None}, indent=2))
