import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const mediaDir = resolve(here, '..', 'media');
const outputVideo = resolve(mediaDir, 'tabletop-narrative-draft.mp4');
const outputPoster = resolve(mediaDir, 'tabletop-narrative-poster.png');
const silentVideo = resolve(here, '.remotion-bundle', 'tabletop-narrative-silent.mp4');
const soundtrack = resolve(here, 'public', 'audio', 'soundtrack.flac');
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
const ffmpegExecutable = process.env.F077_FFMPEG_EXECUTABLE || 'ffmpeg';
const renderPort = Number(process.env.F077_REMOTION_PORT || 41739);
const extractStillsOnly = process.argv.includes('--extract-stills-only');
const execFileAsync = promisify(execFile);
const durationSeconds = 2541 / 30;
const stills = [
  [155, 'scene-01.png'],
  [390, 'scene-02.png'],
  [585, 'scene-03.png'],
  [865, 'scene-04.png'],
  [1086, 'scene-05.png'],
  [1380, 'scene-06.png'],
  [1730, 'scene-07.png'],
  [2060, 'scene-08.png'],
];

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
  await stat(soundtrack).catch(() => {
    throw new Error('Missing public/audio/soundtrack.flac. Generate and verify the narration mix before rendering.');
  });

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
    outputLocation: silentVideo,
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

await extractFrame(2500, outputPoster);
for (const [frame, filename] of stills) {
  await extractFrame(frame, resolve(mediaDir, filename));
}

const outputs = [outputVideo, outputPoster, ...stills.map(([, filename]) => resolve(mediaDir, filename))];
console.log(extractStillsOnly
  ? '\nExtracted the poster and eight reference stills from the existing 84.7-second MP4.'
  : '\nRendered and muxed the 84.7-second, 1280×720 / 30 fps MP4, then extracted its reference stills.');
for (const output of outputs) {
  const details = await stat(output);
  console.log(output + ' (' + details.size.toLocaleString('en-US') + ' bytes)');
}
