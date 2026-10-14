"""Install the reviewed narrated video and retain the preceding public bytes."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
private = Path(os.environ.get('PATCHPROOF_PRIVATE_ROOT', Path.home() / '.config/patchproof/demo-20260927')).expanduser().resolve()
assert source.parent.parent == private
assert re.fullmatch(r'product-v3-[a-z0-9-]+', source.parent.name)
assert source.name == 'patchproof-product-v3.mp4'
production = json.loads((source.parent / 'video-production.json').read_text())
capture = json.loads((source.parent / 'capture-report.json').read_text())
assert capture['status'] == 'passed' and capture['paidRequests'] == 0
assert capture['responseSubstitution'] is False
assert not capture['errors']
assert all(row['unchanged'] for row in capture['evidenceCustody'])
new_bytes = source.read_bytes()
digest = hashlib.sha256(new_bytes).hexdigest()
assert production['outputSha256'] == digest
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
    'format=duration:stream=codec_name', '-of', 'json', str(source)]))
assert 40 < float(probe['format']['duration']) < 180
assert any(stream['codec_name'] == 'aac' for stream in probe['streams'])
target_value = os.environ.get('PATCHPROOF_PUBLIC_VIDEO_PATH')
if not target_value:
    raise SystemExit('PATCHPROOF_PUBLIC_VIDEO_PATH is required')
target = Path(target_value).expanduser().resolve()
previous = target.read_bytes()
old_digest = hashlib.sha256(previous).hexdigest()
assert old_digest == 'aafc632bf58033aa73d386d3f8045fbb24752fed95526517f5e2c43acff08eeb', 'Public media changed; inspect before replacing.'
backup = source.parent / 'preceding-public-video.mp4'
with backup.open('xb') as stream:
    os.fchmod(stream.fileno(), 0o600)
    stream.write(previous)
temporary = target.with_name('patchproof-product-v3.tmp')
with temporary.open('xb') as stream:
    os.fchmod(stream.fileno(), 0o644)
    stream.write(new_bytes)
os.replace(temporary, target)
receipt = {'publishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceCommit': capture['sourceCommit'], 'source': str(source), 'sha256': digest,
    'previousSha256': old_digest, 'previousBackup': str(backup), 'bytes': len(new_bytes),
    'durationSeconds': float(probe['format']['duration']), 'syntheticNarration': True,
    'url': 'https://patchproof.andrewmohawk.xyz/demo/patchproof-real-demo.mp4?v=product-v3-' + digest[:12],
    'paidRequests': 0}
output = Path('research/product-v3/verification/final-video')
output.mkdir(exist_ok=True)
with (output / 'video-publication.json').open('x') as stream:
    json.dump(receipt, stream, indent=2)
    stream.write('\n')
print(json.dumps(receipt))
