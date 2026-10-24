import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const project = resolve(here);
const showcase = resolve(project, '..');
const localeArgument = process.argv.slice(2).find((argument) => argument.startsWith('--locale='));
const locale = localeArgument?.split('=')[1] ?? 'th';
if (process.argv.slice(2).some((argument) => argument !== localeArgument) || !['th', 'en'].includes(locale)) {
  throw new Error('Use --locale=th or --locale=en. Thai is the default.');
}
const localizedSuffix = locale === 'en' ? '-en' : '';
const outputGif = resolve(showcase, `tabletop-story${localizedSuffix}.gif`);
const outputPoster = resolve(showcase, `tabletop-story${localizedSuffix}-poster.png`);
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
const renderPort = process.env.REMOTION_SERVER_PORT ? Number(process.env.REMOTION_SERVER_PORT) : undefined;
const inputProps = { locale };
if (renderPort !== undefined && (!Number.isInteger(renderPort) || renderPort < 1024 || renderPort > 65535)) {
  throw new Error('REMOTION_SERVER_PORT must be an available integer port between 1024 and 65535.');
}

const serveUrl = await bundle({
  entryPoint: resolve(project, 'src/index.jsx'),
  publicDir: resolve(project, 'public'),
  outDir: resolve(project, '.remotion-bundle'),
});

const composition = await selectComposition({
  serveUrl,
  id: 'TabletopStory',
  inputProps,
  browserExecutable,
  port: renderPort,
});

await renderMedia({
  composition,
  serveUrl,
  codec: 'gif',
  outputLocation: outputGif,
  inputProps,
  browserExecutable,
  port: renderPort,
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
  inputProps,
  browserExecutable,
  port: renderPort,
});

console.log(`\nWrote ${outputGif}`);
console.log(`Wrote ${outputPoster}`);
