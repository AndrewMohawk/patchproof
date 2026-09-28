"""Install a tested immutable checkout; retain config backup and old release for rollback."""
import datetime,json,os,pathlib,re,subprocess,sys,time,urllib.request
sha=sys.argv[1]
assert re.fullmatch('[a-f0-9]{40}',sha)
root=pathlib.Path('/home/andrewmohawk/patchproof')
release=pathlib.Path('/mnt/raid1-sata-16tb/homelab_data/patchproof/releases')/sha
config=pathlib.Path('/home/andrewmohawk/.config/patchproof/operator-20260927/live-demo.json')
old='3d0ce9d33b2169efec6290d7a478d4002a480a58'
unit=lambda ref:f'patchproof-runtime@{ref}.service'
def run(args,**kwargs):return subprocess.run(args,check=True,text=True,**kwargs)
def get(path):
 with urllib.request.urlopen('https://patchproof.andrewmohawk.xyz'+path,timeout=15) as response:return json.load(response)
assert all(r['phase']=='terminal' for r in get('/runs')['runs']), 'An active run must finish before rollout.'
if release.exists():
 assert run(['git','rev-parse','HEAD'],cwd=release,capture_output=True).stdout.strip()==sha
 assert run(['git','status','--porcelain'],cwd=release,capture_output=True).stdout.strip()==''
else:
 run(['git','worktree','add','--detach',str(release),sha],cwd=root)
 os.chmod(release,0o750)
 run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=release)
digest=run(['node','--input-type=module','-e',"import {buildOperationalLock} from './packages/orchestrator/src/operational-lock.ts';import {digestJson} from './packages/contracts/src/digest.ts';console.log(digestJson(buildOperationalLock(process.cwd())));"],cwd=release,capture_output=True).stdout.strip()
assert re.fullmatch('sha256:[a-f0-9]{64}',digest)
original=config.read_bytes(); data=json.loads(original)
backup=config.with_name(f'live-demo-before-{sha[:12]}.json')
if backup.exists():assert backup.read_bytes()==original
else:
 with backup.open('xb') as f:os.fchmod(f.fileno(),0o600);f.write(original)
assert all(r['phase']=='terminal' for r in get('/runs')['runs']), 'An active run appeared during preparation.'
run(['systemctl','--user','stop',unit(old)])
try:
 data['sourceDigest']=digest
 temp=config.with_name(f'live-demo-{sha[:12]}.tmp')
 with temp.open('x') as f:os.fchmod(f.fileno(),0o600);json.dump(data,f,indent=2);f.write('\n')
 os.replace(temp,config)
 run(['systemctl','--user','enable','--now',unit(sha)])
 for attempt in range(45):
  try:
   health=get('/healthz')
   if health.get('status') == 'ok' and health.get('mode')=='live':break
  except Exception:pass
  time.sleep(1)
 else:raise RuntimeError('New runtime did not become healthy')
 run(['systemctl','--user','disable',unit(old)])
 receipt={'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseCommit':sha,'sourceDigest':digest,'previousRelease':old,'health':health,'paidRequests':0}
 (root/'research/interface-redesign/verification/rollout.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps(receipt))
except Exception:
 run(['systemctl','--user','disable','--now',unit(sha)])
 with config.open('wb') as f:os.fchmod(f.fileno(),0o600);f.write(original)
 run(['systemctl','--user','enable','--now',unit(old)])
 raise
