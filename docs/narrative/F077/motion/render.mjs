import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const mediaDir = resolve(here, '..', 'media');
const timeline = JSON.parse(await readFile(resolve(here, 'timeline.json'), 'utf8'));
const durationFrames = timeline.durationInFrames;
const fps = timeline.fps;
const outputVideo = resolve(mediaDir, 'tabletop-narrative-draft.mp4');
const outputPoster = resolve(mediaDir, 'tabletop-narrative-poster.png');
const silentVideo = resolve(here, '.remotion-bundle', 'tabletop-narrative-silent.mp4');
const soundtrack = resolve(here, 'public', 'audio', 'soundtrack.flac');
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
const ffmpegExecutable = process.env.F077_FFMPEG_EXECUTABLE || 'ffmpeg';
const ffprobeExecutable = process.env.F077_FFPROBE_EXECUTABLE || 'ffprobe';
const renderPort = Number(process.env.F077_REMOTION_PORT || 41739);
const extractStillsOnly = process.argv.includes('--extract-stills-only');
const silentPreview = process.argv.includes('--silent-preview');
const execFileAsync = promisify(execFile);
const durationSeconds = durationFrames / fps;
const stills = [
  [132, 'scene-01.png'],
  [272, 'scene-02.png'],
  [660, 'scene-03.png'],
  [850, 'scene-04.png'],
  [1222, 'scene-05.png'],
  [1745, 'scene-06.png'],
  [2020, 'scene-07.png'],
  [2708, 'scene-08.png'],
];
const previewIndex = process.argv.indexOf('--preview');
if (previewIndex !== -1) {
  const frames = process.argv.slice(previewIndex + 1).map(Number);
  if (!frames.length || frames.some((frame) => !Number.isInteger(frame) || frame < 0 || frame >= durationFrames)) {
    throw new Error(`Pass one or more integer frame numbers in the range 0–${durationFrames - 1} after --preview.`);
  }
  const previewDir = resolve(here, '.remotion-bundle', 'previews');
  const serveUrl = await bundle({
    entryPoint: resolve(here, 'src', 'index.jsx'),
    publicDir: resolve(here, 'public'),
    outDir: resolve(here, '.remotion-bundle'),
  });
  await mkdir(previewDir, { recursive: true });
  const composition = await selectComposition({
    serveUrl,
    id: 'TabletopNarrative',
    inputProps: {},
    browserExecutable,
    port: renderPort,
  });
  for (const frame of frames) {
    const output = resolve(previewDir, `preview-frame-${String(frame).padStart(4, '0')}.png`);
    await renderStill({
      composition,
      serveUrl,
      output,
      frame,
      inputProps: {},
      browserExecutable,
      port: renderPort,
      imageFormat: 'png',
    });
    console.log(`Preview frame ${frame}: ${output}`);
  }
  process.exit(0);
}

async function verifySoundtrackDuration() {
  const { stdout } = await execFileAsync(ffprobeExecutable, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    soundtrack,
  ]);
  const actualSeconds = Number(stdout.trim());
  const difference = Math.abs(actualSeconds - durationSeconds);
  if (!Number.isFinite(actualSeconds) || difference > 1 / fps) {
    throw new Error(`Soundtrack duration ${actualSeconds}s does not match the ${durationSeconds.toFixed(6)}s timeline (tolerance: one frame).`);
  }
  console.log(`Soundtrack duration verified: ${actualSeconds.toFixed(6)}s for ${durationFrames} frames.`);
}

async function extractFrame(frame, output) {
  const { stderr } = await execFileAsync(ffmpegExecutable, [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', (frame / 30).toFixed(6),
    '-i', outputVideo,
    '-frames:v', '1',
    '-y', output,
  ]);
  if (stderr.trim()) process.stderr.write(stderr);
}

if (!extractStillsOnly) {
  if (!silentPreview && timeline.timingStatus !== 'MEASURED_AUDIO') {
    throw new Error(`Refusing to render a final video with timingStatus=${timeline.timingStatus}.`);
  }
  const previewLocation = resolve(here, '.remotion-bundle', 'silent-preview.mp4');
  const renderLocation = silentPreview ? previewLocation : silentVideo;
  if (!silentPreview) {
    await stat(soundtrack).catch(() => {
      throw new Error('Missing public/audio/soundtrack.flac. Generate and verify the narration mix before rendering.');
    });
    await verifySoundtrackDuration();
  }

  const serveUrl = await bundle({
    entryPoint: resolve(here, 'src', 'index.jsx'),
    publicDir: resolve(here, 'public'),
    outDir: resolve(here, '.remotion-bundle'),
  });

  const composition = await selectComposition({
    serveUrl,
    id: 'TabletopNarrative',
    inputProps: {},
    browserExecutable,
    port: renderPort,
  });

  let nextMilestone = 10;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 18,
    outputLocation: renderLocation,
    inputProps: {},
    browserExecutable,
    port: renderPort,
    concurrency: 4,
    imageFormat: 'png',
    onProgress: ({ progress }) => {
      const percent = Math.floor(progress * 100);
      if (percent >= nextMilestone) {
        process.stdout.write('Video render ' + nextMilestone + '%\r');
        nextMilestone += 10;
      }
    },
  });

  if (!silentPreview) {
    const { stderr } = await execFileAsync(ffmpegExecutable, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', silentVideo,
      '-i', soundtrack,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', durationSeconds.toFixed(3),
      '-movflags', '+faststart',
      outputVideo,
    ]);
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

if (silentPreview) {
  console.log('Silent source preview only; no final media or stills were written.');
  process.exit(0);
}

await extractFrame(durationFrames - 33, outputPoster);
for (const [frame, filename] of stills) {
  await extractFrame(frame, resolve(mediaDir, filename));
}

const outputs = [outputVideo, outputPoster, ...stills.map(([, filename]) => resolve(mediaDir, filename))];
console.log(extractStillsOnly
  ? `\nExtracted the poster and eight reference stills from the existing ${durationSeconds.toFixed(1)}-second MP4.`
  : `\nRendered and muxed the ${durationSeconds.toFixed(1)}-second, 1280×720 / ${fps} fps MP4, then extracted its reference stills.`);
for (const output of outputs) {
  const details = await stat(output);
  console.log(output + ' (' + details.size.toLocaleString('en-US') + ' bytes)');
}
