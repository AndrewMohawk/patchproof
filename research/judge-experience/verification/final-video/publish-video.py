"""Replace the approved public recording, retaining its preceding bytes privately."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
private = Path('/home/andrewmohawk/.config/patchproof/demo-20260927/judge-experience-03')
assert source.parent == private and source.suffix == '.mp4'
production = json.loads(Path('research/judge-experience/verification/video-production.json').read_text())
new_bytes = source.read_bytes()
digest = hashlib.sha256(new_bytes).hexdigest()
assert production['outputSha256'] == digest
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(source)]))
assert 90 < float(probe['format']['duration']) < 170
target = Path('/mnt/raid1-sata-16tb/homelab_data/patchproof/media/patchproof-real-demo.mp4')
previous = target.read_bytes()
old_digest = hashlib.sha256(previous).hexdigest()
assert old_digest == 'fe8b13daae03dc0b882f3827a313dc4bd92a9adeca4dca7bf70886567286f4d9', 'The current public recording changed; inspect before replacing.'
backup = private / 'preceding-public-judge-demo.mp4'
with backup.open('xb') as handle:
    os.fchmod(handle.fileno(), 0o600)
    handle.write(previous)
temp = target.with_name('patchproof-judge-e15b625-evidence.tmp')
with temp.open('xb') as handle:
    os.fchmod(handle.fileno(), 0o644)
    handle.write(new_bytes)
os.replace(temp, target)
receipt = {'publishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'source': str(source), 'target': str(target), 'sha256': digest,
           'previousSha256': old_digest, 'previousBackup': str(backup),
           'bytes': len(new_bytes), 'durationSeconds': float(probe['format']['duration']),
           'url': 'https://patchproof.andrewmohawk.xyz/demo/patchproof-real-demo.mp4?v=judge-e15b625-evidence',
           'paidRequests': 0}
Path('research/judge-experience/verification/final-video/video-publication.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
