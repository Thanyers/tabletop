import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Build the F080 C3 authoring harness. Self-contained: no server, no network, opened from file://. */

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results/tool-authoring-harness');
await mkdir(output, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'tests/ui/tool-authoring/harness.tsx')],
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

const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>F080 C3 authoring harness</title>
</head>
<body>
<div id="root"></div>
<script src="app.js"></script>
</body>
</html>
`;
await writeFile(resolve(output, 'index.html'), html, 'utf8');
console.log(`build-tool-authoring-harness: wrote ${resolve(output, 'index.html')}`);
