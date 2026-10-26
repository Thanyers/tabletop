import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const project = resolve(here);
const showcase = resolve(project, '..');
const args = process.argv.slice(2);
const localeArgument = args.find((argument) => argument.startsWith('--locale='));
const locale = localeArgument?.split('=')[1] ?? 'en';
const caseArgument = args.find((argument) => argument.startsWith('--case='));
const caseName = caseArgument?.split('=')[1] ?? 'learning';
if (args.length > 2 || args.some((argument) => ![localeArgument, caseArgument].includes(argument))
  || new Set(args.map((argument) => argument.split('=')[0])).size !== args.length
  || !['en', 'th'].includes(locale) || !['learning', 'sales', 'play'].includes(caseName)) {
  throw new Error('Use --locale=en|th and --case=learning|sales|play. Defaults are --locale=en --case=learning.');
}

const fileBase = caseName === 'learning' ? 'hero-evolution' : `hero-${caseName}`;
const outputGif = resolve(showcase, `${fileBase}-${locale}.gif`);
const outputPoster = resolve(showcase, `${fileBase}-${locale}-poster.png`);
const bundleDir = resolve(project, '..', '..', '..', 'test-results', 'f077', 'hero-remotion-bundle');
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
const port = process.env.REMOTION_SERVER_PORT ? Number(process.env.REMOTION_SERVER_PORT) : undefined;
if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) {
  throw new Error('REMOTION_SERVER_PORT must be an available integer port between 1024 and 65535.');
}

await mkdir(bundleDir, { recursive: true });
const serveUrl = await bundle({
  entryPoint: resolve(project, 'src/hero-entry.jsx'),
  publicDir: resolve(project, 'public'),
  outDir: bundleDir,
});
const inputProps = { locale, caseName };
const composition = await selectComposition({
  serveUrl,
  id: 'HeroEvolution',
  inputProps,
  browserExecutable,
  port,
});

await renderMedia({
  composition,
  serveUrl,
  codec: 'gif',
  outputLocation: outputGif,
  inputProps,
  browserExecutable,
  port,
  concurrency: 4,
  numberOfGifLoops: null,
  imageFormat: 'png',
  onProgress: ({ progress }) => {
    const percent = Math.round(progress * 100);
    if (percent % 10 === 0) process.stdout.write(`Hero GIF render ${percent}%\r`);
  },
});

// Capture the completed case canvas before its frame-driven loop reset.
await renderStill({
  composition,
  serveUrl,
  output: outputPoster,
  frame: 200,
  imageFormat: 'png',
  inputProps,
  browserExecutable,
  port,
});

console.log(`\nWrote ${outputGif}`);
console.log(`Wrote ${outputPoster}`);
