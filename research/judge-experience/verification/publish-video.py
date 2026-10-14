"""Replace the approved public recording, retaining its preceding bytes privately."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
private_root = Path(os.environ.get('PATCHPROOF_PRIVATE_ROOT', Path.home() / '.config/patchproof/demo-20260927')).expanduser().resolve()
private = private_root / 'judge-experience-01'
assert source.parent == private and source.suffix == '.mp4'
production = json.loads(Path('research/judge-experience/verification/video-production.json').read_text())
new_bytes = source.read_bytes()
digest = hashlib.sha256(new_bytes).hexdigest()
assert production['outputSha256'] == digest
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(source)]))
assert 90 < float(probe['format']['duration']) < 170
target_value = os.environ.get('PATCHPROOF_PUBLIC_VIDEO_PATH')
if not target_value:
    raise SystemExit('PATCHPROOF_PUBLIC_VIDEO_PATH is required')
target = Path(target_value).expanduser().resolve()
previous = target.read_bytes()
old_digest = hashlib.sha256(previous).hexdigest()
assert old_digest == 'e2ada1696a11c5d325c4e76b548eb021fc9c9fae1a9d71e14f1a193c72398a48', 'The current public recording changed; inspect before replacing.'
backup = private / 'preceding-public-interface-demo.mp4'
with backup.open('xb') as handle:
    os.fchmod(handle.fileno(), 0o600)
    handle.write(previous)
temp = target.with_name('patchproof-judge-e15b625.tmp')
with temp.open('xb') as handle:
    os.fchmod(handle.fileno(), 0o644)
    handle.write(new_bytes)
os.replace(temp, target)
receipt = {'publishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'source': str(source), 'target': str(target), 'sha256': digest,
           'previousSha256': old_digest, 'previousBackup': str(backup),
           'bytes': len(new_bytes), 'durationSeconds': float(probe['format']['duration']),
           'url': 'https://patchproof.andrewmohawk.xyz/demo/patchproof-real-demo.mp4?v=judge-e15b625',
           'paidRequests': 0}
Path('research/judge-experience/verification/video-publication.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
