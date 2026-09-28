"""Add aligned synthetic narration and persistent annotations to real UI video.

No UI frames are substituted, cut, or sped up. Audio starts at each recorded
scene's narrationStartMs; captions describe the same scene below the browser.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap

root = Path(sys.argv[1]).absolute()
assert root.resolve() == root
assert root.parent == Path('/home/andrewmohawk/.config/patchproof/demo-20260927')
assert root.name.startswith('product-v3-')
report = json.loads((root / 'capture-report.json').read_text())
narration = json.loads((root / 'narration-index.json').read_text())
assert report['status'] == 'passed'
assert report['responseSubstitution'] is False and report['paidRequests'] == 0
assert all(r['allowed'] and r['method'] == 'GET' for r in report['requests'])
assert all(item['unchanged'] for item in report['evidenceCustody'])
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(report['videoPath']) == report['videoSha256']
segments = {s['id']: s for s in narration['segments']}
assert set(segments) == {s['id'] for s in report['scenes']}


def stamp(ms):
    ticks = round(ms / 10)
    return f'{ticks // 360000}:{ticks // 6000 % 60:02}:{ticks // 100 % 60:02}.{ticks % 100:02}'


def caption(text, width=87, maximum=2):
    assert not any(c in text for c in '{}\\\n\r')
    rows = textwrap.wrap(text, width=width)
    assert len(rows) <= maximum, text
    return r'\N'.join(rows)


header = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 1200
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,DejaVu Sans,19,&H00BEECC6,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,8,48,48,1018,1
Style: Caption,DejaVu Sans,27,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,48,48,1052,1
Style: Context,DejaVu Sans,15,&H00BDC7D7,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,48,48,1164,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
end = report['scenes'][-1]['endMs']
header += f'Dialogue: 0,0:00:00.00,{stamp(end)},Context,,0,0,0,,Saved real repairs | Local Chatterbox synthetic narration | No new model calls in this recording\n'
transcript = []
inputs, filters, audio_labels = [], [], []
for index, scene in enumerate(report['scenes'], 1):
    segment = segments[scene['id']]
    assert sha(segment['audioPath']) == segment['audioSha256']
    assert scene['narrationStartMs'] + segment['durationSeconds'] * 1000 <= scene['endMs']
    title = f'{index:02d} / {len(report["scenes"]):02d}  {scene["title"]}'
    header += f'Dialogue: 1,{stamp(scene["startMs"])},{stamp(scene["endMs"])},Title,,0,0,0,,{caption(title, maximum=1)}\n'
    header += f'Dialogue: 1,{stamp(scene["startMs"])},{stamp(scene["endMs"])},Caption,,0,0,0,,{caption(scene["annotation"])}\n'
    transcript.append({'startMs': scene['narrationStartMs'], 'endMs': scene['narrationStartMs'] + round(segment['durationSeconds'] * 1000),
                       'title': scene['title'], 'text': segment['narration']})
    inputs.extend(['-i', segment['audioPath']])
    filters.append(f'[{index}:a]adelay={scene["narrationStartMs"]}:all=1[a{index}]')
    audio_labels.append(f'[a{index}]')
filters.append(''.join(audio_labels) + f'amix=inputs={len(audio_labels)}:normalize=0,apad[audio]')
captions = root / 'annotations.ass'
captions.write_text(header)
captions.chmod(0o600)
output = root / 'patchproof-product-v3.mp4'
command = ['ffmpeg', '-v', 'warning', '-n', '-i', report['videoPath'], *inputs,
           '-filter_complex', ';'.join(filters), '-map', '0:v', '-map', '[audio]',
           '-vf', f'pad=1440:1200:0:0:color=0x14202f,ass={captions}',
           '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
           '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', str(output)]
subprocess.run(command, check=True)
output.chmod(0o600)
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                                          'format=duration:stream=codec_name,width,height,sample_rate,channels', '-of', 'json', str(output)]))
assert 40 < float(probe['format']['duration']) < 180, 'The challenge video must remain under three minutes'
assert any(s['codec_name'] == 'aac' for s in probe['streams'])
receipt = {'recordingReport': str(root / 'capture-report.json'), 'narrationIndex': str(root / 'narration-index.json'),
           'rawVideoSha256': report['videoSha256'], 'editing': {'cuts': False, 'speedChanges': False,
           'added': '200px annotation strip below original 1440x1000 browser capture and aligned local synthetic narration'},
           'outputPath': str(output), 'outputSha256': sha(output), 'bytes': output.stat().st_size, 'media': probe,
           'transcript': transcript, 'command': command}
with (root / 'video-production.json').open('x') as file:
    json.dump(receipt, file, indent=2)
    file.write('\n')
(root / 'video-production.json').chmod(0o600)
print(json.dumps(receipt, indent=2))
