"""Mix cached narration and deterministic action sounds. No network calls.

Requires numpy and a full FFmpeg executable on PATH (or --ffmpeg).
Timing comes from narration.json and the same frame cues used by the film.
"""
import argparse
import json
import math
import re
import subprocess
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SR = 48000
RNG = np.random.default_rng(77)


def decode(ffmpeg, path):
    result = subprocess.run([ffmpeg, '-v', 'error', '-i', str(path), '-f', 'f32le',
                             '-ac', '1', '-ar', str(SR), 'pipe:1'], capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype='<f4').copy()


def write_wave(path, data):
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(SR)
        output.writeframes((np.clip(data, -1, 1) * 32767).astype('<i2').tobytes())


def stamp(seconds):
    millis = round(seconds * 1000)
    hours, rest = divmod(millis, 3600000)
    minutes, rest = divmod(rest, 60000)
    seconds, millis = divmod(rest, 1000)
    return f'{hours:02}:{minutes:02}:{seconds:02}.{millis:03}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--script', default='narration-r5.json')
    args = parser.parse_args()
    script = json.loads((HERE / args.script).read_text(encoding='utf-8'))
    cues = json.loads((HERE / 'sound-cues.json').read_text(encoding='utf-8'))
    duration = script['durationFrames'] / cues['fps']
    audio_dir = HERE / 'public' / 'audio'
    scratch = HERE / '.remotion-bundle' / 'audio-review'
    scratch.mkdir(parents=True, exist_ok=True)
    voice = np.zeros((round(duration * SR), 2), dtype=np.float32)
    effects = np.zeros_like(voice)
    report = {'duration': duration, 'segments': [], 'events': [], 'sources': 'cached TTS + procedural SFX'}
    caption_groups = []

    def place(destination, data, seconds, gain=1., pan=0.):
        index = round(seconds * SR)
        end = index + len(data)
        if index < 0 or end > len(destination):
            raise ValueError(f'Audio exceeds composition at {seconds}: {end / SR}')
        # Equal-power positioning; narration is centered, sounds follow the action.
        gains = np.array([math.sqrt((1-pan)/2), math.sqrt((1+pan)/2)]) * gain
        destination[index:end] += data[:, None] * gains

    previous_end = 0.
    for segment in script['segments']:
        file = audio_dir / script['assetDirectory'] / (segment['id'] + '.mp3')
        data = decode(args.ffmpeg, file)
        start = segment['start']
        end = start + len(data) / SR
        assert start >= previous_end, f"Narration overlaps at {segment['id']}"
        assert end <= segment['end'], f"Narration does not fit: {segment['id']}"
        previous_end = end
        active = data[np.abs(data) > .008]
        rms = float(np.sqrt(np.mean(active ** 2))) if len(active) else 1.
        gain = min(.13 / rms, .78 / max(float(np.max(np.abs(data))), .001))
        place(voice, data, start, gain * math.sqrt(2))
        report['segments'].append({'id': segment['id'], 'start': start, 'end': end,
                                   'hold': segment['end'] - end, 'gain': gain})
        metadata = file.with_suffix('.jsonl')
        words = [json.loads(line) for line in metadata.read_text(encoding='utf-8').splitlines()]
        words = [word for word in words if word['type'] == 'WordBoundary']
        group = []
        for index, word in enumerate(words):
            group.append(word)
            text = ' '.join(w['text'] for w in group)
            if len(text) >= 42 or re.search(r'[.!?]$', word['text']) or index == len(words)-1:
                caption_groups.append((start + group[0]['offset']/1e7,
                                       start + (word['offset']+word['duration'])/1e7, text))
                group = []

    def effect(kind, seconds, pan=0., gain=1.):
        length = {'key': .045, 'click': .07, 'send': .18, 'review': .11,
                  'apply': .13, 'result': .32, 'paper': .36}[kind]
        time = np.arange(round(length * SR)) / SR
        noise = RNG.normal(0, 1, len(time))
        if kind == 'key':
            signal = (.012 * noise + .022 * np.sin(2*np.pi*RNG.uniform(950, 1500)*time)) * np.exp(-time*105)
        elif kind in ['click', 'apply', 'review']:
            frequency = {'click': 720, 'apply': 560, 'review': 900}[kind]
            signal = (.025*np.sin(2*np.pi*frequency*time) + .008*noise) * np.exp(-time*55)
        elif kind == 'send':
            signal = .012 * noise * np.sin(np.pi*time/length)**2
        elif kind == 'paper':
            signal = .009 * noise * np.sin(np.pi*time/length)**2
        else:
            signal = (.035*np.sin(2*np.pi*440*time) + .017*np.sin(2*np.pi*660*time)) * np.exp(-time*16)
        signal *= np.minimum(time/.003, 1)  # click-free sample envelope
        place(effects, signal, seconds, gain, pan)
        report['events'].append({'kind': kind, 'time': round(seconds, 4)})

    fps = cues['fps']
    for typing in cues['typing']:
        at = typing['start']/fps
        until = typing['end']/fps
        while at + .045 < until:
            effect('key', at, .5, RNG.uniform(.8, 1.2))
            at += float(RNG.uniform(.105, .18))
    for key in ['send', 'review', 'apply', 'result']:
        for frame in cues[key]:
            effect(key, frame/fps, -.25 if key == 'result' else .45)
    effect('click', cues['coffeeClick']/fps, -.3, 1.3)
    for frame in cues.get('introClicks', []):
        effect('click', frame/fps, -.2, .75)
    for frame in cues.get('transition', []):
        effect('paper', frame/fps, 0., .7)
    for pencil in cues.get('introPencil', []):
        at = pencil['start']/fps
        until = pencil['end']/fps
        while at + .045 < until:
            effect('key', at, -.35, .4)
            at += .08

    combined = voice + effects
    assert float(np.max(np.abs(combined))) < .99, 'Premix clips'
    raw = scratch / 'premix.wav'
    write_wave(raw, combined)
    write_wave(scratch / 'effects-only.wav', effects)
    output = audio_dir / 'soundtrack.flac'
    result = subprocess.run([args.ffmpeg, '-hide_banner', '-y', '-i', str(raw), '-af',
                             'loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json', '-ar', str(SR),
                             '-c:a', 'flac', '-sample_fmt', 's16', str(output)], capture_output=True, text=True, check=True)
    report['loudness'] = json.JSONDecoder().raw_decode(result.stderr[result.stderr.rfind('{'):])[0]
    report['voicePeak'] = float(np.max(np.abs(voice)))
    report['effectsPeak'] = float(np.max(np.abs(effects)))
    report['premixPeak'] = float(np.max(np.abs(combined)))
    (scratch / 'report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    vtt = ['WEBVTT', '']
    for start, end, text in caption_groups:
        vtt += [f'{stamp(start)} --> {stamp(end)}', text, '']
    (HERE.parent / 'media' / 'tabletop-narration-en.vtt').write_text('\n'.join(vtt), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['duration', 'segments', 'loudness', 'voicePeak', 'effectsPeak', 'premixPeak']}, indent=2))


if __name__ == '__main__':
    main()
