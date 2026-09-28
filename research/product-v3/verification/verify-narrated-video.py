"""Check final narration presence/timing and export review frames.

Each decoded AAC segment must correlate with its independently transcribed source
WAV at the scene's recorded narration start. This checks the assembled soundtrack,
not just the presence of an audio stream in the media container.
"""
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import wave

root = Path(sys.argv[1]).absolute()
assert root.resolve() == root and root.parent == Path('/home/andrewmohawk/.config/patchproof/demo-20260927')
assert root.name.startswith('product-v3-')
production = json.loads((root / 'video-production.json').read_text())
capture = json.loads((root / 'capture-report.json').read_text())
narration = json.loads((root / 'narration-index.json').read_text())
video = Path(production['outputPath'])
assert hashlib.sha256(video.read_bytes()).hexdigest() == production['outputSha256']
rate = 24000
decoded = array('h', subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(video), '-vn',
                                             '-ac', '1', '-ar', str(rate), '-f', 's16le', '-']))
offset = production['editing']['trimmedInitialLoadingMs']
segments = {segment['id']: segment for segment in narration['segments']}
checks = []


def correlation(left, right):
    if len(left) != len(right):
        return -1
    left_mean, right_mean = sum(left) / len(left), sum(right) / len(right)
    numerator = sum((x-left_mean) * (y-right_mean) for x, y in zip(left, right))
    divisor = math.sqrt(sum((x-left_mean)**2 for x in left) * sum((y-right_mean)**2 for y in right))
    return numerator / divisor if divisor else 0


frames = root / 'review-frames'
frames.mkdir(mode=0o700)
for scene in capture['scenes']:
    segment = segments[scene['id']]
    with wave.open(segment['audioPath']) as source:
        assert source.getframerate() == rate and source.getnchannels() == 1 and source.getsampwidth() == 2
        source_pcm = array('h', source.readframes(source.getnframes()))
    assert hashlib.sha256(Path(segment['audioPath']).read_bytes()).hexdigest() == segment['audioSha256']
    # Compare two seconds of speech, one second after the segment begins. Limit
    # tolerance to 10ms; codec delay outside that window is a timing failure.
    beginning = rate
    expected = source_pcm[beginning:beginning + rate * 2:6]
    at = round((scene['narrationStartMs'] - offset) * rate / 1000) + beginning
    trials = []
    for milliseconds in range(-10, 11):
        shift = round(milliseconds * rate / 1000)
        actual = decoded[at + shift:at + shift + rate * 2:6]
        trials.append((correlation(expected, actual), milliseconds))
    score, shift = max(trials)
    checks.append({'id': scene['id'], 'passed': score > 0.94, 'audioCorrelation': round(score, 6),
                   'bestOffsetMilliseconds': shift, 'narrationStartMs': scene['narrationStartMs'] - offset,
                   'transcriptChecked': bool(segment.get('transcription', {}).get('text'))})
    frame_at = (scene['narrationStartMs'] - offset) / 1000 + segment['durationSeconds'] * .7
    subprocess.run(['ffmpeg', '-v', 'error', '-n', '-ss', f'{frame_at:.3f}', '-i', str(video),
                    '-frames:v', '1', str(frames / (scene['id'] + '.png'))], check=True)
clipped = sum(abs(sample) >= 32767 for sample in decoded)
receipt = {'videoSha256': production['outputSha256'], 'durationSeconds': float(production['media']['format']['duration']),
           'decodedAudioSampleRate': rate, 'decodedAudioSeconds': len(decoded) / rate,
           'clippedSampleCount': clipped, 'maximumAbsoluteAmplitude': max(abs(sample) for sample in decoded),
           'sceneAudioChecks': checks, 'passed': all(check['passed'] and check['transcriptChecked'] for check in checks) and clipped == 0,
           'reviewFrames': str(frames)}
with (root / 'audio-video-verification.json').open('x') as out:
    json.dump(receipt, out, indent=2)
    out.write('\n')
for path in frames.iterdir(): path.chmod(0o600)
(root / 'audio-video-verification.json').chmod(0o600)
print(json.dumps(receipt, indent=2))
assert receipt['passed']
