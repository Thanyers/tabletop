export interface MusicPcmSample {
  samples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
  peak: number;
  beatPeaks: number[];
}

export interface PlaybackPosition {
  progress: number;
  beatIndex: number;
  beatInBar: number;
  repetition: number;
  totalBeats: number;
  finished: boolean;
}

const DEFAULT_SAMPLE_RATE = 24_000;
const MAX_SAMPLE_SECONDS = 8;
const WAV_HEADER_BYTES = 44;

/**
 * Builds one deterministic four-beat synth phrase. The phrase is the PCM used
 * both by the waveform and by the Web Audio preview; callers may loop it to
 * cover the selected section without allocating a buffer for every repetition.
 */
export function createMusicPcmSample(
  bpm: number,
  beatsPerPhrase = 4,
  sampleRate = DEFAULT_SAMPLE_RATE,
): MusicPcmSample {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new RangeError('BPM must be a positive finite number.');
  if (!Number.isSafeInteger(beatsPerPhrase) || beatsPerPhrase < 1 || beatsPerPhrase > 16) {
    throw new RangeError('Phrase length must be an integer between 1 and 16 beats.');
  }
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000) {
    throw new RangeError('Sample rate must be an integer from 8000 to 96000 Hz.');
  }

  const framesPerBeat = Math.max(1, Math.round((sampleRate * 60) / bpm));
  const frameCount = framesPerBeat * beatsPerPhrase;
  if (!Number.isSafeInteger(frameCount) || frameCount > sampleRate * MAX_SAMPLE_SECONDS) {
    throw new RangeError(`The generated phrase cannot exceed ${MAX_SAMPLE_SECONDS} seconds.`);
  }

  const raw = new Float32Array(frameCount);
  const beatPeaks = Array.from({ length: beatsPerPhrase }, () => 0);
  const melody = [261.63, 329.63, 392, 329.63];
  let rawPeak = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const beat = Math.floor(frame / framesPerBeat);
    const frameInBeat = frame - beat * framesPerBeat;
    const secondsInBeat = frameInBeat / sampleRate;
    const noteEnvelope = Math.exp(-secondsInBeat * 5.4);
    const clickEnvelope = secondsInBeat < 0.055 ? Math.exp(-secondsInBeat * 72) : 0;
    const noteFrequency = melody[beat % melody.length];
    const note = Math.sin((2 * Math.PI * noteFrequency * frameInBeat) / sampleRate) * 0.17 * noteEnvelope
      + Math.sin((2 * Math.PI * noteFrequency * 2 * frameInBeat) / sampleRate) * 0.045 * noteEnvelope;
    const tickFrequency = beat === 0 ? 1_620 : 1_120;
    const tick = Math.sin((2 * Math.PI * tickFrequency * frameInBeat) / sampleRate) * (beat === 0 ? 0.32 : 0.19) * clickEnvelope;
    const lowAccentEnvelope = beat % 4 === 0 ? Math.exp(-secondsInBeat * 26) : 0;
    const lowAccent = Math.sin((2 * Math.PI * 72 * frameInBeat) / sampleRate) * 0.2 * lowAccentEnvelope;
    const value = note + tick + lowAccent;

    raw[frame] = value;
    const magnitude = Math.abs(value);
    beatPeaks[beat] = Math.max(beatPeaks[beat], magnitude);
    rawPeak = Math.max(rawPeak, magnitude);
  }

  const targetPeak = 0.82;
  const gain = rawPeak === 0 ? 1 : targetPeak / rawPeak;
  const samples = new Float32Array(frameCount);
  const normalizedBeatPeaks = beatPeaks.map((peak) => peak * gain);
  let peak = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const value = Math.fround(raw[frame] * gain);
    samples[frame] = value;
    peak = Math.max(peak, Math.abs(value));
  }

  return {
    samples,
    sampleRate,
    durationSeconds: samples.length / sampleRate,
    peak,
    beatPeaks: normalizedBeatPeaks,
  };
}

/** Returns a compact envelope sampled from the PCM, including repeated bars. */
export function pcmEnvelope(samples: Float32Array, bins: number, repeats = 1): number[] {
  if (!Number.isSafeInteger(bins) || bins < 1) throw new RangeError('Envelope bins must be a positive integer.');
  if (samples.length === 0) return Array.from({ length: bins }, () => 0);
  const safeRepeats = Number.isSafeInteger(repeats) && repeats > 0 ? repeats : 1;
  const totalFrames = samples.length * safeRepeats;
  return Array.from({ length: bins }, (_, bin) => {
    const start = Math.floor((bin * totalFrames) / bins);
    const end = Math.max(start + 1, Math.ceil(((bin + 1) * totalFrames) / bins));
    let maximum = 0;
    if (end - start >= samples.length) {
      for (let frame = 0; frame < samples.length; frame += 1) maximum = Math.max(maximum, Math.abs(samples[frame]));
    } else {
      for (let frame = start; frame < end; frame += 1) {
        maximum = Math.max(maximum, Math.abs(samples[frame % samples.length]));
      }
    }
    return maximum;
  });
}

/** Maps one elapsed clock to the four beat lamps and section repetition count. */
export function getPlaybackPosition(
  elapsedSeconds: number,
  bpm: number,
  beatsPerRepetition: number,
  repetitions: number,
): PlaybackPosition {
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 1;
  const safeBeats = Number.isSafeInteger(beatsPerRepetition) && beatsPerRepetition > 0 ? beatsPerRepetition : 1;
  const safeRepetitions = Number.isSafeInteger(repetitions) && repetitions > 0 ? repetitions : 1;
  const totalBeats = safeBeats * safeRepetitions;
  const duration = (totalBeats * 60) / safeBpm;
  const rawElapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const finished = rawElapsed >= duration;
  const elapsed = Math.min(rawElapsed, duration);
  const progress = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0;
  const beatIndex = finished ? totalBeats - 1 : Math.min(totalBeats - 1, Math.floor((elapsed * safeBpm) / 60));

  return {
    progress,
    beatIndex,
    beatInBar: beatIndex % 4,
    repetition: Math.min(safeRepetitions, Math.floor(beatIndex / safeBeats) + 1),
    totalBeats,
    finished,
  };
}

/** Encodes the phrase as a mono, 16-bit PCM WAV file. */
export function encodeMusicWav(sample: MusicPcmSample): ArrayBuffer {
  const dataBytes = sample.samples.length * 2;
  const output = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(output);
  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < tag.length; index += 1) view.setUint8(offset + index, tag.charCodeAt(index));
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, output.byteLength - 8, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sample.sampleRate, true);
  view.setUint32(28, sample.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < sample.samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, sample.samples[index]));
    view.setInt16(WAV_HEADER_BYTES + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }

  return output;
}
