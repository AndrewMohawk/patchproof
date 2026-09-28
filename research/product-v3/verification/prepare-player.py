"""Prepare the authorized public player after the reviewed video is installed."""
from html import escape
import json
from pathlib import Path
import re

receipt = json.loads(Path('research/product-v3/verification/final-video/video-publication.json').read_text())
url = receipt['url']
assert re.fullmatch(r'https://patchproof\.andrewmohawk\.xyz/demo/patchproof-real-demo\.mp4\?v=product-v3-[a-f0-9]{12}', url)
source = Path(receipt['source'])
assert source.parent.parent == Path('/home/andrewmohawk/.config/patchproof/demo-20260927')
production = json.loads((source.parent / 'video-production.json').read_text())
assert production['outputSha256'] == receipt['sha256']
duration = round(receipt['durationSeconds'])
transcript = []
for item in production['transcript']:
    seconds = item['startMs'] // 1000
    stamp = f'{seconds // 60}:{seconds % 60:02}'
    transcript.append(f'<li><strong>{stamp} · {escape(item["title"])}</strong><p>{escape(item["text"])}</p></li>')
html = f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PatchProof — a real repair, explained</title>
  <link rel="stylesheet" href="/demo/style.css">
</head>
<body>
  <main>
    <a class="brand" href="/">PatchProof</a>
    <h1>See what changed. Understand why it passed—or failed.</h1>
    <p>Follow a pagination repair that coordinates record revisions, deletions and page boundaries. Then inspect a configuration patch whose remaining defects prevent acceptance. Each example shows the original code, the goal, the proposed changes and the observed checks.</p>
    <p class="recording-note">{duration // 60} min {duration % 60:02} sec · On-screen annotations · Local Chatterbox synthetic narration. Recorded from the public app using saved real Nebius Token Factory runs, checked in isolated local Docker containers.</p>
    <video controls playsinline preload="metadata" src="{escape(url, quote=True)}">
      <a href="{escape(url, quote=True)}">Download the narrated MP4 recording.</a>
    </video>
    <nav aria-label="Explore the examples">
      <a class="button" href="/#story/bug">Open the fixed repair</a>
      <a href="/#story/failed-bug">Open the failed repair</a>
      <a href="/#tasks">Try a repair</a>
      <a href="/#how-it-works">How it works</a>
      <a href="{escape(url, quote=True)}" download>Download video</a>
    </nav>
    <p class="recording-note">Watching this recording and opening its saved examples makes no new model calls. Generate patch starts a new live attempt. The examples demonstrate the workflow; they do not establish a benchmark advantage or correctness for every possible input.</p>
    <details class="transcript">
      <summary>Read the narration transcript</summary>
      <ol>{''.join(transcript)}</ol>
    </details>
  </main>
</body>
</html>
'''
roots = [Path('/mnt/raid1-sata-16tb/homelab_backup/docker/patchproof'),
         Path('/mnt/raid1-nvme-4tb/codex-worktrees/patchproof-deploy-20260928/docker/patchproof')]
for root in roots:
    (root / 'demo/index.html').write_text(html)
    css = root / 'demo/style.css'
    content = css.read_text()
    if '.transcript {' not in content:
        content += '\n.transcript { border-top: 1px solid #d4deeb; margin-top: 28px; padding-top: 20px; }\n.transcript summary { cursor: pointer; font-weight: 650; color: #2459ce; }\n.transcript ol { padding-left: 24px; }\n.transcript li { margin: 24px 0; }\n.transcript p { margin: 6px 0; }\n.transcript summary:focus-visible { outline: 3px solid #2459ce; outline-offset: 4px; }\n'
        css.write_text(content)
print(json.dumps({'prepared': [str(root / 'demo/index.html') for root in roots],
                  'videoUrl': url, 'chapters': len(transcript), 'durationSeconds': receipt['durationSeconds']}))
