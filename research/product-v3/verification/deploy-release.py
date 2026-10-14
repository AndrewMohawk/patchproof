"""Deploy a tested immutable PatchProof revision with an explicit curated catalogue."""
import datetime, json, os, pathlib, re, subprocess, sys, time, urllib.request

root = pathlib.Path(__file__).resolve().parents[3]
sha, previous, *tasks = sys.argv[1:]
assert all(re.fullmatch('[a-f0-9]{40}', value) for value in [sha, previous])
assert 1 <= len(tasks) <= 20 and len(set(tasks)) == len(tasks)
assert all(re.fullmatch('v3-[a-z0-9-]+', task) for task in tasks)
release_root = os.environ.get('PATCHPROOF_RELEASE_ROOT')
if not release_root:
    raise SystemExit('PATCHPROOF_RELEASE_ROOT is required')
release = pathlib.Path(release_root).expanduser().resolve() / sha
config = pathlib.Path(os.environ.get('PATCHPROOF_OPERATOR_CONFIG', pathlib.Path.home() / '.config/patchproof/operator-20260927/live-demo.json')).expanduser().resolve()
unit = lambda ref: f'patchproof-runtime@{ref}.service'

def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)

def get(path):
    with urllib.request.urlopen('https://patchproof.andrewmohawk.xyz' + path, timeout=15) as response:
        return json.load(response)

def idle():
    assert all(item['phase'] == 'terminal' for item in get('/runs')['runs']), 'Wait for active public run before rollout.'

idle()
if release.exists():
    assert run(['git', 'rev-parse', 'HEAD'], cwd=release, capture_output=True).stdout.strip() == sha
    assert not run(['git', 'status', '--porcelain'], cwd=release, capture_output=True).stdout.strip()
else:
    run(['git', 'worktree', 'add', '--detach', str(release), sha], cwd=root)
    os.chmod(release, 0o750)
    run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=release)
for task in tasks:
    fixture = json.loads((release / 'fixtures/development' / (task + '.json')).read_text())
    assert fixture['id'] == task and fixture['split'] == 'development'
digest = run(['node', '--input-type=module', '-e', "import {buildOperationalLock} from './packages/orchestrator/src/operational-lock.ts';import {digestJson} from './packages/contracts/src/digest.ts';console.log(digestJson(buildOperationalLock(process.cwd())));"], cwd=release, capture_output=True).stdout.strip()
assert re.fullmatch('sha256:[a-f0-9]{64}', digest)
pricing_digest = run(['node', '--input-type=module', '-e', "import {readFileSync} from 'node:fs';import {digestJson} from './packages/contracts/src/digest.ts';console.log(digestJson(JSON.parse(readFileSync('research/product-v3/model-discovery.json','utf8'))));"], cwd=release, capture_output=True).stdout.strip()
assert re.fullmatch('sha256:[a-f0-9]{64}', pricing_digest)
original = config.read_bytes()
data = json.loads(original)
backup = config.with_name(f'live-demo-before-{sha[:12]}.json')
with backup.open('xb') as stream:
    os.fchmod(stream.fileno(), 0o600)
    stream.write(original)
idle()
run(['systemctl', '--user', 'stop', unit(previous)])
try:
    data.update(sourceDigest=digest, pricingEvidenceDigest=pricing_digest, taskIds=tasks)
    temporary = config.with_name(f'live-demo-{sha[:12]}.tmp')
    with temporary.open('x') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(data, stream, indent=2)
        stream.write('\n')
    os.replace(temporary, config)
    run(['systemctl', '--user', 'enable', '--now', unit(sha)])
    for _ in range(45):
        try:
            health = get('/healthz')
            catalogue = get('/tasks')
            if health.get('status') == 'ok' and health.get('mode') == 'live' and [task['id'] for task in catalogue['tasks']] == tasks:
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise RuntimeError('Release health or catalogue verification failed')
    run(['systemctl', '--user', 'disable', unit(previous)])
    receipt = dict(deployedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), releaseCommit=sha,
                   sourceDigest=digest, pricingEvidenceDigest=pricing_digest, previousRelease=previous, health=health, tasks=tasks, paidRequests=0)
    (root / f'research/product-v3/verification/rollout-{sha[:12]}.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
except Exception:
    run(['systemctl', '--user', 'disable', '--now', unit(sha)])
    with config.open('wb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(original)
    run(['systemctl', '--user', 'enable', '--now', unit(previous)])
    raise
