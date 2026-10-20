import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const project = resolve(here);
const showcase = resolve(project, '..');
const outputGif = resolve(showcase, 'tabletop-story.gif');
const outputPoster = resolve(showcase, 'tabletop-story-poster.png');
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;

const serveUrl = await bundle({
  entryPoint: resolve(project, 'src/index.jsx'),
  publicDir: resolve(project, 'public'),
  outDir: resolve(project, '.remotion-bundle'),
});

const composition = await selectComposition({
  serveUrl,
  id: 'TabletopStory',
  inputProps: {},
  browserExecutable,
});

await renderMedia({
  composition,
  serveUrl,
  codec: 'gif',
  outputLocation: outputGif,
  inputProps: {},
  browserExecutable,
  concurrency: 4,
  numberOfGifLoops: 2,
  imageFormat: 'png',
  onProgress: ({ progress }) => {
    const percent = Math.round(progress * 100);
    if (percent % 10 === 0) process.stdout.write(`GIF render ${percent}%\r`);
  },
});

await renderStill({
  composition,
  serveUrl,
  output: outputPoster,
  frame: composition.durationInFrames - 1,
  imageFormat: 'png',
  inputProps: {},
  browserExecutable,
});

console.log(`\nWrote ${outputGif}`);
console.log(`Wrote ${outputPoster}`);
