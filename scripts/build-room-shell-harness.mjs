import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Build the F080 room-shell harness (variant C) as a self-contained file:// page.
 *
 * The real token file and the real shell stylesheet are inlined, so a layout measurement here is a
 * measurement of the product's styling rather than of a mock.
 */

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results/room-shell-harness');
await mkdir(output, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'tests/ui/room-shell/harness.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  outfile: resolve(output, 'app.js'),
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
if (result.errors.length > 0) {
  console.error(result.errors.map(error => error.text).join('\n'));
  process.exit(1);
}

const tokens = await readFile(resolve(root, 'src/tabletop/ui/tabletop-tokens.css'), 'utf8');
const shell = await readFile(resolve(root, 'src/tabletop/ui/room-shell.css'), 'utf8');

const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>F080 room shell (variant C)</title>
<style>${tokens}</style>
<style>${shell}</style>
<style>
  html, body { margin: 0; background: var(--tt-cream-2); }</style>
</head>
<body>
<div id="root"></div>
<script src="app.js"></script>
</body>
</html>
`;
await writeFile(resolve(output, 'index.html'), html, 'utf8');
console.log(`build-room-shell-harness: wrote ${resolve(output, 'index.html')}`);
