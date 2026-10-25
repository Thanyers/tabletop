import { describe, expect, it } from 'vitest';
import { createMusicPcmSample, encodeMusicWav, getPlaybackPosition, pcmEnvelope } from './musicAudio';

describe('music audio sample', () => {
  it('creates deterministic audible PCM with the requested phrase duration', () => {
    const first = createMusicPcmSample(80);
    const second = createMusicPcmSample(80);

    expect(first.samples).toEqual(second.samples);
    expect(first.durationSeconds).toBeCloseTo(3, 4);
    expect(first.peak).toBeGreaterThan(0.5);
    expect(first.peak).toBeLessThanOrEqual(1);
    expect(first.samples.some((value) => value !== 0)).toBe(true);
  });

  it('keeps the downbeat accent in both the PCM peak and its measured beat peak', () => {
    const sample = createMusicPcmSample(100);
    const measuredPeak = sample.samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);

    expect(sample.peak).toBeCloseTo(measuredPeak, 6);
    expect(sample.beatPeaks[0]).toBeGreaterThan(sample.beatPeaks[1]);
    expect(sample.beatPeaks).toHaveLength(4);
  });

  it('derives a non-empty envelope from the same PCM used for playback', () => {
    const sample = createMusicPcmSample(80);
    const envelope = pcmEnvelope(sample.samples, 96, 6);

    expect(envelope).toHaveLength(96);
    expect(Math.max(...envelope)).toBeCloseTo(sample.peak, 5);
    expect(envelope.every((value) => value >= 0 && value <= sample.peak)).toBe(true);
  });

  it('encodes the generated phrase as a valid mono PCM WAV payload', () => {
    const sample = createMusicPcmSample(120);
    const wav = encodeMusicWav(sample);
    const view = new DataView(wav);
    const tag = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(wav, offset, length));

    expect(tag(0, 4)).toBe('RIFF');
    expect(tag(8, 4)).toBe('WAVE');
    expect(tag(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(sample.samples.length * 2);
    expect(wav.byteLength).toBe(44 + sample.samples.length * 2);
  });
});

describe('music playback clock', () => {
  it('synchronizes beat and repetition with elapsed audio time', () => {
    const oneBeat = 60 / 80;
    const position = getPlaybackPosition(oneBeat * 9, 80, 8, 3);

    expect(position.progress).toBeCloseTo(9 / 24, 6);
    expect(position.beatIndex).toBe(9);
    expect(position.beatInBar).toBe(1);
    expect(position.repetition).toBe(2);
    expect(position.finished).toBe(false);
  });

  it('clamps the playhead and beat count at both ends of the section', () => {
    const start = getPlaybackPosition(-2, 80, 8, 3);
    const end = getPlaybackPosition(60, 80, 8, 3);

    expect(start.progress).toBe(0);
    expect(start.beatIndex).toBe(0);
    expect(start.repetition).toBe(1);
    expect(end.progress).toBe(1);
    expect(end.beatIndex).toBe(23);
    expect(end.repetition).toBe(3);
    expect(end.finished).toBe(true);
  });
});
