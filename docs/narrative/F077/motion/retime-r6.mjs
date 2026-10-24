import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const mediaDir = resolve(here, '..', 'media');
const publicDir = resolve(repoRoot, 'public', 'narrative');
const testDir = resolve(repoRoot, 'test-results', 'f077');
const timelinePath = resolve(here, 'timeline.json');
const sourceVideo = resolve(mediaDir, 'tabletop-narrative-draft.mp4');
const sourceVtt = resolve(mediaDir, 'tabletop-narration-en.vtt');
const outputVideo = resolve(mediaDir, 'tabletop-narrative-r6.mp4');
const outputPoster = resolve(mediaDir, 'tabletop-narrative-r6-poster.png');
const outputVtt = resolve(mediaDir, 'tabletop-narrative-r6-en.vtt');
const outputPlan = resolve(mediaDir, 'tabletop-narrative-r6-retime.json');
const ffmpeg = process.env.F077_FFMPEG_EXECUTABLE || 'ffmpeg';
const ffprobe = process.env.F077_FFPROBE_EXECUTABLE || 'ffprobe';
const execFileAsync = promisify(execFile);
const EXPECTED_R5_SHA256 = '901380adbfb2096f96c8b73098990d7a523f7f9eca58364affb780fd8205672c';

// Retiming is always derived from the original R5 render, never from R6 or a
// published copy. Rates are pitch-preserving FFmpeg atempo/setpts factors.
const SPEEDS = {
  tools: 1.20,
  friction: 1.18,
  reversal: 1.15,
  table: 1.11,
  'quick-request': 1.11,
  'quick-use': 1.10,
  chart: 1.11,
  discount10: 1.11,
  discount20: 1.11,
  close: 1.00,
};

const sourceStillFrames = [
  [132, 'scene-01.png'],
  [272, 'scene-02.png'],
  [660, 'scene-03.png'],
  [850, 'scene-04.png'],
  [1222, 'scene-05.png'],
  [1745, 'scene-06.png'],
  [2020, 'scene-07.png'],
  [2708, 'scene-08.png'],
];

const fail = (message) => {
  throw new Error(message);
};

const hashFile = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');

const probe = async (path) => {
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels',
    '-of', 'json',
    path,
  ]);
  return JSON.parse(stdout);
};

const runFfmpeg = (args, totalSeconds) => new Promise((resolvePromise, reject) => {
  const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let stdoutBuffer = '';
  let lastPercent = 0;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('out_time=')) continue;
      const [, timestamp] = line.split('=');
      const [hours, minutes, seconds] = timestamp.split(':').map(Number);
      const current = hours * 3600 + minutes * 60 + seconds;
      const percent = Math.min(100, Math.floor((current / totalSeconds) * 100));
      if (percent >= lastPercent + 10) {
        lastPercent = Math.floor(percent / 10) * 10;
        process.stdout.write(`R6 encode ${lastPercent}%\n`);
      }
    }
  });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolvePromise();
    else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.trim()}`));
  });
});

const formatVttTime = (seconds) => {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secondsPart = Math.floor((milliseconds % 60_000) / 1000);
  const millisPart = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}.${String(millisPart).padStart(3, '0')}`;
};

const timeline = JSON.parse(await readFile(timelinePath, 'utf8'));
const { fps, durationInFrames } = timeline;
if (timeline.timingStatus !== 'MEASURED_AUDIO') fail(`Expected measured R5 timing, got ${timeline.timingStatus}.`);
if (fps !== 30 || durationInFrames !== 3133) fail(`Unexpected R5 composition: ${fps} fps / ${durationInFrames} frames.`);

const sourceHash = await hashFile(sourceVideo);
if (sourceHash !== EXPECTED_R5_SHA256) {
  fail(`R6 source must be the frozen R5 render (${EXPECTED_R5_SHA256}); got ${sourceHash}. Refusing to retime a different or already-retimed file.`);
}

const sourceInfo = await probe(sourceVideo);
const sourceDuration = Number(sourceInfo.format.duration);
const sourceVideoStream = sourceInfo.streams.find(({ codec_type }) => codec_type === 'video');
if (!sourceVideoStream || sourceVideoStream.width !== 1280 || sourceVideoStream.height !== 720 || sourceVideoStream.r_frame_rate !== `${fps}/1`) {
  fail('R5 source must be a 1280×720, 30 fps video.');
}
if (Math.abs(sourceDuration - durationInFrames / fps) > 1 / fps) {
  fail(`R5 source duration ${sourceDuration}s does not match ${durationInFrames / fps}s timeline.`);
}

let targetFrameCursor = 0;
let previousSourceEnd = 0;
const segments = timeline.segments.map((segment, index) => {
  const startFrame = index === 0 ? 0 : segment.startFrame;
  const endFrame = segment.endFrame;
  const requestedSpeed = SPEEDS[segment.id];
  if (!requestedSpeed) fail(`Missing R6 speed for timeline segment ${segment.id}.`);
  if (startFrame !== previousSourceEnd || endFrame <= startFrame) {
    fail(`R5 segments are not contiguous at ${segment.id}: ${startFrame} after ${previousSourceEnd}.`);
  }
  const sourceFrames = endFrame - startFrame;
  const targetFrames = Math.round(sourceFrames / requestedSpeed);
  const speed = sourceFrames / targetFrames;
  const mapped = {
    id: segment.id,
    sourceStartFrame: startFrame,
    sourceEndFrame: endFrame,
    sourceFrames,
    requestedSpeed,
    effectiveSpeed: Number(speed.toFixed(9)),
    targetStartFrame: targetFrameCursor,
    targetEndFrame: targetFrameCursor + targetFrames,
    targetFrames,
  };
  targetFrameCursor += targetFrames;
  previousSourceEnd = endFrame;
  return mapped;
});
if (previousSourceEnd !== durationInFrames) fail(`R6 map stops at source frame ${previousSourceEnd}, expected ${durationInFrames}.`);

const targetFrames = targetFrameCursor;
const targetDuration = targetFrames / fps;
const mapSourceTime = (sourceSeconds) => {
  const sourceFrame = sourceSeconds * fps;
  const segment = segments.find((item) => sourceFrame >= item.sourceStartFrame && sourceFrame <= item.sourceEndFrame)
    ?? segments.at(-1);
  const segmentStartSeconds = segment.sourceStartFrame / fps;
  const mappedStartSeconds = segment.targetStartFrame / fps;
  return mappedStartSeconds + (sourceSeconds - segmentStartSeconds) / segment.effectiveSpeed;
};
const mapSourceFrame = (sourceFrame) => Math.max(0, Math.min(targetFrames - 1, Math.round(mapSourceTime(sourceFrame / fps) * fps)));

const videoSourceLabels = segments.map((_, index) => `[vsrc${index}]`).join('');
const audioSourceLabels = segments.map((_, index) => `[asrc${index}]`).join('');
const filters = [
  `[0:v]split=${segments.length}${videoSourceLabels}`,
  ...segments.map((segment, index) => {
    const speed = segment.effectiveSpeed.toFixed(9);
    return `[vsrc${index}]trim=start_frame=${segment.sourceStartFrame}:end_frame=${segment.sourceEndFrame},setpts=(PTS-STARTPTS)/${speed},fps=${fps},tpad=stop_mode=clone:stop_duration=0.1,trim=end_frame=${segment.targetFrames},setpts=N/(${fps}*TB)[v${index}]`;
  }),
  `${segments.map((_, index) => `[v${index}]`).join('')}concat=n=${segments.length}:v=1:a=0,format=yuv420p[vout]`,
  `[0:a]asplit=${segments.length}${audioSourceLabels}`,
  ...segments.map((segment, index) => {
    const start = (segment.sourceStartFrame / fps).toFixed(9);
    const end = (segment.sourceEndFrame / fps).toFixed(9);
    const duration = (segment.targetFrames / fps).toFixed(9);
    const speed = segment.effectiveSpeed.toFixed(9);
    return `[asrc${index}]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,atempo=${speed},aresample=48000,aformat=channel_layouts=stereo,apad=pad_dur=0.1,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`;
  }),
  `${segments.map((_, index) => `[a${index}]`).join('')}concat=n=${segments.length}:v=0:a=1,aresample=48000,apad=pad_dur=0.1,atrim=duration=${targetDuration.toFixed(9)},asetpts=PTS-STARTPTS[aout]`,
].join(';');

const plan = {
  version: 'R6',
  source: 'media/tabletop-narrative-draft.mp4',
  sourceSha256: sourceHash,
  method: 'Piecewise pitch-preserving retime with FFmpeg setpts and atempo, mapped from R5 narration boundaries.',
  fps,
  sourceDurationFrames: durationInFrames,
  sourceDurationSeconds: sourceDuration,
  targetDurationFrames: targetFrames,
  targetDurationSeconds: targetDuration,
  segments,
  stills: sourceStillFrames.map(([sourceFrame, filename]) => ({
    sourceFrame,
    targetFrame: mapSourceFrame(sourceFrame),
    filename: filename.replace('.png', '-r6.png'),
  })),
};

const sourceWebVtt = await readFile(sourceVtt, 'utf8');
const vttCueStarts = [];
let previousCueStart = -Infinity;
const mappedWebVtt = sourceWebVtt.split(/\r?\n/).map((line) => {
  const match = line.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})(.*)$/);
  if (!match) return line;
  const parseTime = (timestamp) => {
    const [hours, minutes, seconds] = timestamp.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  };
  const start = mapSourceTime(parseTime(match[1]));
  const end = mapSourceTime(parseTime(match[2]));
  if (!(end > start) || start < previousCueStart) fail(`Invalid remapped VTT cue at ${match[1]}.`);
  previousCueStart = start;
  vttCueStarts.push({ start, end });
  return `${formatVttTime(start)} --> ${formatVttTime(end)}${match[3]}`;
}).join('\n');

const graphArgs = [
  '-hide_banner', '-y', '-i', sourceVideo,
  '-filter_complex_threads', '4',
  '-filter_complex', filters,
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-fps_mode', 'cfr', '-r', String(fps),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
  '-t', targetDuration.toFixed(9),
  '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats',
  outputVideo,
];

await mkdir(mediaDir, { recursive: true });
await mkdir(publicDir, { recursive: true });
await mkdir(testDir, { recursive: true });
console.log(`Retiming frozen R5 source into R6: ${durationInFrames} frames → ${targetFrames} frames (${targetDuration.toFixed(3)}s).`);
await runFfmpeg(graphArgs, targetDuration);

const outputInfo = await probe(outputVideo);
const outputStream = outputInfo.streams.find(({ codec_type }) => codec_type === 'video');
if (!outputStream || outputStream.width !== 1280 || outputStream.height !== 720 || outputStream.r_frame_rate !== `${fps}/1`) {
  fail('R6 output does not match the expected 1280×720 / 30 fps format.');
}
if (Number(outputStream.nb_frames) !== targetFrames) {
  fail(`R6 output has ${outputStream.nb_frames} frames; expected ${targetFrames}.`);
}
if (Math.abs(Number(outputInfo.format.duration) - targetDuration) > 1 / fps) {
  fail(`R6 output duration ${outputInfo.format.duration}s differs from the ${targetDuration.toFixed(6)}s map.`);
}

await execFileAsync(ffmpeg, [
  '-hide_banner', '-v', 'error', '-i', outputVideo,
  '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
]);

const mappedStillFrames = plan.stills;
const posterFrame = mapSourceFrame(durationInFrames - 33);
const extractFrame = async (frame, output) => execFileAsync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-i', outputVideo,
  '-ss', (frame / fps).toFixed(9),
  '-frames:v', '1',
  output,
]);

await extractFrame(posterFrame, outputPoster);
for (const still of mappedStillFrames) {
  await extractFrame(still.targetFrame, resolve(mediaDir, still.filename));
}
await writeFile(outputVtt, mappedWebVtt.replace(/\n+$/, '\n'));
await writeFile(outputPlan, `${JSON.stringify({ ...plan, posterFrame, captions: { source: 'media/tabletop-narration-en.vtt', output: 'media/tabletop-narrative-r6-en.vtt', cueCount: vttCueStarts.length } }, null, 2)}\n`);

const publicCopies = [
  [outputVideo, resolve(publicDir, 'tabletop-story.mp4')],
  [outputPoster, resolve(publicDir, 'tabletop-story-poster.png')],
  [outputVtt, resolve(publicDir, 'tabletop-story-en.vtt')],
];
for (const [source, destination] of publicCopies) await copyFile(source, destination);
await copyFile(outputVideo, resolve(testDir, 'tabletop-story-r6.mp4'));

const outputs = [outputVideo, outputPoster, outputVtt, outputPlan, ...mappedStillFrames.map((still) => resolve(mediaDir, still.filename)), ...publicCopies.map(([, destination]) => destination)];
console.log(`R6 verified: ${Number(outputInfo.format.duration).toFixed(3)}s, ${targetFrames} video frames, ${vttCueStarts.length} remapped caption cues; full FFmpeg decode passed.`);
for (const path of outputs) {
  const details = await stat(path);
  console.log(`${path} (${details.size.toLocaleString('en-US')} bytes)`);
}
