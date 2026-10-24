"""Explicit ElevenLabs generation; credentials stay in the ignored project env.

Use --list-voices for a bounded catalogue read, or --generate --segment tools
for one audition. No network call runs during ordinary Remotion rendering.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def settings():
    values = dict(os.environ)
    env = ROOT / '.env.local'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            match = re.match(r'^\s*(ELEVENLABS_[A-Z_]+)\s*=\s*(.*?)\s*$', line)
            if match and not values.get(match[1]):
                values[match[1]] = match[2].strip().strip('\"\'')
    if not values.get('ELEVENLABS_API_KEY'):
        raise SystemExit('Missing ELEVENLABS_API_KEY in project .env.local or environment.')
    return values


def request(path, key, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request('https://api.elevenlabs.io' + path, data=body,
                                 headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Provider payloads can contain account data; do not echo them.
        raise SystemExit(f'ElevenLabs HTTP {error.code}; no response body or credentials logged.') from None


def word_boundaries(alignment):
    chars = alignment['characters']
    starts = alignment['character_start_times_seconds']
    ends = alignment['character_end_times_seconds']
    assert len(chars) == len(starts) == len(ends)
    text = ''.join(chars)
    # Audio directions are not spoken captions, even if returned by alignment.
    masked = re.sub(r'\[[^\]]*\]', lambda m: ' ' * len(m[0]), text)
    for match in re.finditer(r'\S+', masked):
        first, last = match.start(), match.end()-1
        yield {'type': 'WordBoundary', 'text': match[0],
               'offset': round(starts[first]*1e7),
               'duration': round((ends[last]-starts[first])*1e7)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--list-voices', action='store_true')
    parser.add_argument('--generate', action='store_true')
    parser.add_argument('--segment')
    parser.add_argument('--voice-id')
    parser.add_argument('--model', default='eleven_v3')
    args = parser.parse_args()
    if not args.list_voices and not args.generate:
        parser.error('Choose --list-voices or explicit --generate.')
    env = settings()
    key = env['ELEVENLABS_API_KEY']
    if args.list_voices:
        data = request('/v1/voices', key)
        for voice in data.get('voices', []):
            if voice.get('category') == 'premade':
                print(json.dumps({k: voice.get(k) for k in ['voice_id', 'name', 'description', 'labels']}, ensure_ascii=False))
        return
    voice = args.voice_id or env.get('ELEVENLABS_VOICE_ID')
    if not voice:
        parser.error('Choose an existing catalogue voice with --voice-id or ELEVENLABS_VOICE_ID.')
    script = json.loads((HERE / 'narration-r5.json').read_text(encoding='utf-8'))
    target = HERE / 'public' / 'audio' / script['assetDirectory']
    target.mkdir(parents=True, exist_ok=True)
    selected = [s for s in script['segments'] if not args.segment or s['id'] == args.segment]
    if not selected:
        parser.error('Unknown segment.')
    for segment in selected:
        payload = {'text': segment.get('deliveryText', segment['text']), 'model_id': args.model,
                   'voice_settings': {'stability': .5, 'similarity_boost': .75}, 'seed': 77}
        digest = hashlib.sha256(json.dumps([voice, payload], sort_keys=True).encode()).hexdigest()
        path = target / (segment['id'] + '.mp3')
        fingerprint = path.with_suffix('.sha256')
        metadata = path.with_suffix('.jsonl')
        if path.exists() and metadata.exists() and fingerprint.exists() and fingerprint.read_text() == digest:
            print(segment['id'] + ': reused')
            continue
        result = request('/v1/text-to-speech/' + voice + '/with-timestamps?output_format=mp3_44100_128', key, payload)
        audio = base64.b64decode(result['audio_base64'], validate=True)
        alignment = result.get('normalized_alignment') or result['alignment']
        words = list(word_boundaries(alignment))
        if not audio or not words:
            raise SystemExit('Empty speech/alignment; existing cache preserved.')
        temporary = path.with_suffix('.partial.mp3')
        temporary.write_bytes(audio)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(temporary), '-f', 'null', '-'], check=True)
        temporary.replace(path)
        metadata.write_text(''.join(json.dumps(word)+'\n' for word in words), encoding='utf-8')
        fingerprint.write_text(digest, encoding='ascii')
        print(segment['id'] + ': generated and decoded')


if __name__ == '__main__':
    main()
