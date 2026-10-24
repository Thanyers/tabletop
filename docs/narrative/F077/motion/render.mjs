import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const mediaDir = resolve(here, '..', 'media');
const outputVideo = resolve(mediaDir, 'tabletop-narrative-draft.mp4');
const outputPoster = resolve(mediaDir, 'tabletop-narrative-poster.png');
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
const renderPort = Number(process.env.F077_REMOTION_PORT || 41739);
const extractStillsOnly = process.argv.includes('--extract-stills-only');
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const compositorPackage = (() => {
  if (process.platform === 'win32' && process.arch === 'x64') return '@remotion/compositor-win32-x64-msvc';
  if (process.platform === 'darwin' && process.arch === 'x64') return '@remotion/compositor-darwin-x64';
  if (process.platform === 'darwin' && process.arch === 'arm64') return '@remotion/compositor-darwin-arm64';
  if (process.platform === 'linux' && (process.arch === 'x64' || process.arch === 'arm64')) {
    const libc = process.report?.getReport().header.glibcVersionRuntime ? 'gnu' : 'musl';
    return '@remotion/compositor-linux-' + process.arch + '-' + libc;
  }
  throw new Error('Unsupported OS or architecture for Remotion bundled ffmpeg: ' + process.platform + '/' + process.arch);
})();
const compositorDir = require(compositorPackage).dir;
const ffmpegExecutable = resolve(compositorDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const stills = [
  [240, 'scene-01.png'],
  [360, 'scene-02.png'],
  [630, 'scene-03.png'],
  [825, 'scene-04.png'],
  [1020, 'scene-05.png'],
  [1170, 'scene-06.png'],
  [1476, 'scene-07.png'],
  [1695, 'scene-08.png'],
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
    outputLocation: outputVideo,
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
}

await extractFrame(1770, outputPoster);
for (const [frame, filename] of stills) {
  await extractFrame(frame, resolve(mediaDir, filename));
}

const outputs = [outputVideo, outputPoster, ...stills.map(([, filename]) => resolve(mediaDir, filename))];
console.log(extractStillsOnly
  ? '\nExtracted the poster and eight reference stills from the existing 60-second MP4.'
  : '\nRendered the 60-second, 1280×720 / 30 fps MP4 and extracted its reference stills.');
for (const output of outputs) {
  const details = await stat(output);
  console.log(output + ' (' + details.size.toLocaleString('en-US') + ' bytes)');
}
