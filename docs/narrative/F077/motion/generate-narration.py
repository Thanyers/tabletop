"""Generate the authored, non-personal narration script with an installed edge-tts.

Only explicit --generate contacts the TTS service. Existing files are reused.
Install edge-tts==7.3.1 in an isolated environment; no credentials are needed.
"""
import argparse
import asyncio
import json
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent

async def main():
    import edge_tts
    data = json.loads((HERE / 'narration.json').read_text(encoding='utf-8'))
    target = HERE / 'public' / 'audio' / data['assetDirectory']
    target.mkdir(parents=True, exist_ok=True)
    for segment in data['segments']:
        path = target / (segment['id'] + '.mp3')
        metadata = target / (segment['id'] + '.jsonl')
        fingerprint = target / (segment['id'] + '.sha256')
        digest = hashlib.sha256(json.dumps([segment['text'], data['voice'], data['rate']], ensure_ascii=False).encode()).hexdigest()
        if path.exists() and path.stat().st_size > 0 and metadata.exists() and fingerprint.exists() and fingerprint.read_text() == digest:
            print(segment['id'] + ': reused')
            continue
        temporary = path.with_suffix('.partial.mp3')
        await edge_tts.Communicate(segment['text'], data['voice'], rate=data['rate'], boundary='WordBoundary').save(str(temporary), str(metadata))
        temporary.replace(path)
        fingerprint.write_text(digest)
        print(segment['id'] + ': generated', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--generate', action='store_true')
    args = parser.parse_args()
    if not args.generate:
        parser.error('Pass --generate to send narration.json text to the TTS service.')
    asyncio.run(main())
