import hashlib
import json
import os
import pathlib
import subprocess
import sys
import textwrap

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/home/andrewmohawk/.config/patchproof/demo-20260927/judge-experience-01')
assert root.parent == pathlib.Path('/home/andrewmohawk/.config/patchproof/demo-20260927')
assert root.name.startswith('judge-experience-') and root.resolve() == root
report = json.loads((root / 'report.json').read_text())
assert report['status'] == 'passed' and report['unchangedRunList']
assert report['paidRequests'] == 0 and all(row['method'] == 'GET' and row['allowed'] for row in report['requests'])
assert hashlib.sha256(pathlib.Path(report['videoPath']).read_bytes()).hexdigest() == report['videoSha256']

def stamp(ms):
    ticks = round(ms / 10)
    return f'{ticks // 360000}:{ticks // 6000 % 60:02}:{ticks // 100 % 60:02}.{ticks % 100:02}'

def subtitle_text(text):
    assert not any(character in text for character in '{}\\\n\r')
    lines = textwrap.wrap(text, width=82)
    assert len(lines) <= 2, f'Caption is too long: {text}'
    return r'\N'.join(lines)

header = '''[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 1180
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,28,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,60,60,1040,1
Style: Context,DejaVu Sans,17,&H00D2D8E5,&H00D2D8E5,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,60,60,1008,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
end_ms = report['captions'][-1]['endMs']
header += f'Dialogue: 0,0:00:00.00,{stamp(end_ms)},Context,,0,0,0,,Saved real repairs | No new model calls in this recording\n'
for caption in report['captions']:
    header += f"Dialogue: 1,{stamp(caption['startMs'])},{stamp(caption['endMs'])},Caption,,0,0,0,,{subtitle_text(caption['text'])}\n"
caption_path = root / 'captions.ass'
with caption_path.open('x') as file:
    file.write(header)
os.chmod(caption_path, 0o600)
output = root / 'patchproof-judge-demo.mp4'
command = ['ffmpeg', '-v', 'warning', '-n', '-i', report['videoPath'], '-vf',
           f'pad=1440:1180:0:0:color=0x172033,ass={caption_path}', '-c:v', 'libx264',
           '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(output)]
subprocess.run(command, check=True)
os.chmod(output, 0o600)
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                    'format=duration:stream=codec_name,width,height', '-of', 'json', str(output)]))
assert 115 <= float(probe['format']['duration']) <= 140
frames = root / 'review-frames'
frames.mkdir(mode=0o700)
for index, seconds in enumerate([5, 19, 37, 63, 87, 108, 122]):
    subprocess.run(['ffmpeg', '-v', 'error', '-n', '-ss', str(seconds), '-i', str(output),
                    '-frames:v', '1', str(frames / f'{index + 1:02}-{seconds}s.png')], check=True)
receipt = {'recordingReport': str(root / 'report.json'), 'recordingSourceSha256': report['videoSha256'],
           'editing': {'cuts': False, 'speedChanges': False, 'added': '180px caption strip below original 1440x1000 browser capture; lower space retained for player controls', 'audio': False},
           'command': command, 'outputPath': str(output), 'outputSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
           'bytes': output.stat().st_size, 'media': probe, 'reviewFrames': str(frames)}
with (root / 'video-production.json').open('x') as file:
    json.dump(receipt, file, indent=2)
    file.write('\n')
os.chmod(root / 'video-production.json', 0o600)
print(json.dumps(receipt, indent=2))
