import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Build the F080 room-setup harness (D-049) as a self-contained file:// page.
 *
 * The real token file and stylesheet are inlined, so what the UI gate measures is the product's styling.
 */

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results/room-setup-harness');
await mkdir(output, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'tests/ui/room-setup/harness.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const bundle = result.outputFiles?.[0]?.text;
if (!bundle) {
  console.error('build-room-setup-harness: esbuild produced no output');
  process.exit(1);
}

const tokens = await readFile(resolve(root, 'src/tabletop/ui/tabletop-tokens.css'), 'utf8');
const page = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>F080 room setup</title>
<style>${tokens}</style>
<style>
  /* The panel ships with the app's own rules; keep the page background identical to the product. */
  body { margin: 0; background: var(--tt-cream-1); color: var(--tt-ink); font: inherit; }
</style>
</head>
<body class="tt-app">
<div id="root"></div>
<script>${bundle}</script>
</body>
</html>
`;
await writeFile(resolve(output, 'index.html'), page, 'utf8');
console.log(`build-room-setup-harness: wrote ${resolve(output, 'index.html')}`);
