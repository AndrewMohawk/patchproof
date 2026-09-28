"""Generate independently replayable local Chatterbox narration segments.

Usage: python3 narrate.py manifest.json PRIVATE_OUTPUT_DIR [--transcribe]
The manifest contains scenes with id, narration and annotation fields. Existing
segments are only reused when their complete input and audio digest still match.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.request
import uuid
import wave

TTS = 'https://chatterbox.lab.andrewmohawk.xyz'
STT = 'https://stt-ui.lab.andrewmohawk.xyz'
REFERENCE = 'ivr_female_02_prompt.wav'
PRIVATE = Path('/home/andrewmohawk/.config/patchproof/demo-20260927')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    with path.open('x') as output:
        json.dump(value, output, indent=2)
        output.write('\n')
    path.chmod(0o600)


def multipart(url, fields, files=None):
    boundary = 'patchproof-' + uuid.uuid4().hex
    pieces = []
    for key, value in fields.items():
        pieces.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    for key, path in (files or {}).items():
        pieces.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode())
        pieces.extend([path.read_bytes(), b'\r\n'])
    pieces.append(f'--{boundary}--\r\n'.encode())
    request = urllib.request.Request(url, b''.join(pieces), {'Content-Type': f'multipart/form-data; boundary={boundary}'}, method='POST')
    with urllib.request.urlopen(request, timeout=600) as response:
        return response.read(), dict(response.headers)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--transcribe', action='store_true')
    args = parser.parse_args()
    root = args.output.absolute()
    assert root.resolve() == root and root.parent == PRIVATE
    assert re.fullmatch(r'product-v3-[a-z0-9-]+', root.name)
    root.mkdir(mode=0o700, exist_ok=True)
    root.chmod(0o700)
    audio_dir = root / 'audio'
    audio_dir.mkdir(mode=0o700, exist_ok=True)
    manifest = json.loads(args.manifest.read_text())
    manifest_digest = digest(args.manifest.read_bytes())
    health = json.load(urllib.request.urlopen(TTS + '/health', timeout=20))
    info = json.load(urllib.request.urlopen(TTS + '/api/info', timeout=20))
    refs = json.load(urllib.request.urlopen(TTS + '/api/references', timeout=20))
    assert health['model_loaded'] and health['model'] == 'turbo'
    assert REFERENCE in refs['references']
    segments = []
    seen = set()
    for scene in manifest['scenes']:
        key, text = scene['id'], scene['narration']
        assert re.fullmatch(r'[a-z0-9-]+', key) and key not in seen
        seen.add(key)
        assert 1 <= len(text) <= info['max_text_length'] and '\n' not in text
        fields = {'text': text, 'reference_choice': REFERENCE, 'speaking_rate': '1.0'}
        fingerprint = digest(json.dumps(fields, sort_keys=True).encode())
        wav, receipt_path = audio_dir / (key + '.wav'), audio_dir / (key + '.json')
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text())
            assert receipt['inputDigest'] == fingerprint
            assert digest(wav.read_bytes()) == receipt['audioSha256']
        else:
            assert not wav.exists(), f'Unreceipted audio exists: {wav}'
            start = time.monotonic()
            audio, headers = multipart(TTS + '/api/tts', fields)
            with wav.open('xb') as output:
                output.write(audio)
            wav.chmod(0o600)
            with wave.open(str(wav)) as audio_file:
                duration = audio_file.getnframes() / audio_file.getframerate()
                assert audio_file.getnchannels() == 1
            assert 0.5 < duration < 60
            receipt = {'id': key, 'narration': text, 'inputDigest': fingerprint,
                       'audioPath': str(wav), 'audioSha256': digest(audio),
                       'durationSeconds': duration, 'elapsedSeconds': round(time.monotonic() - start, 3),
                       'endpoint': TTS + '/api/tts', 'referenceChoice': REFERENCE,
                       'syntheticNarration': True, 'health': health,
                       'metrics': {key: value for key, value in headers.items() if key.lower().startswith('x-')}}
            write_json(receipt_path, receipt)
        transcription = audio_dir / (key + '-transcript.json')
        if args.transcribe and not transcription.exists():
            data, _ = multipart(STT + '/api/transcribe', {'model': 'small-int8', 'language': 'en'}, {'audio': wav})
            write_json(transcription, json.loads(data))
        if transcription.exists():
            receipt = {**receipt, 'transcription': json.loads(transcription.read_text())}
        segments.append(receipt)
        print(json.dumps({'id': key, 'durationSeconds': receipt['durationSeconds'],
                          'transcript': receipt.get('transcription', {}).get('text')}), flush=True)
    index = root / 'narration-index.json'
    result = {'manifestSha256': manifest_digest, 'referenceChoice': REFERENCE,
              'syntheticNarration': True, 'ttsService': TTS,
              'health': health, 'segments': segments}
    if index.exists():
        assert json.loads(index.read_text()) == result, 'Use a new output directory for a changed manifest'
    else:
        write_json(index, result)
    print(json.dumps({'output': str(index), 'totalSpeechSeconds': sum(s['durationSeconds'] for s in segments)}))


if __name__ == '__main__':
    os.umask(0o077)
    main()
