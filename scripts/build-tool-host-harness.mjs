import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Build the F080 C2 browser harness: bundle the harness page and inline the sandbox runtime so
 * the fixture needs no server and no network (it is opened from file://).
 */

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results/tool-host-harness');

await mkdir(output, { recursive: true });

const runtimePath = resolve(root, 'public/tool-sandbox-runtime.js');
let runtimeScript;
try {
  runtimeScript = await readFile(runtimePath, 'utf8');
} catch {
  console.error('build-tool-host-harness: run `node scripts/build-tool-sandbox-runtime.mjs` first');
  process.exit(1);
}
if (/<\/script/iu.test(runtimeScript)) {
  console.error('build-tool-host-harness: the runtime can close an inline script tag');
  process.exit(1);
}

const result = await build({
  entryPoints: [resolve(root, 'tests/ui/tool-host/harness.tsx')],
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
<title>F080 C2 tool host harness</title>
</head>
<body>
<div id="root"></div>
<script>window.__TOOL_SANDBOX_RUNTIME__=${JSON.stringify(runtimeScript)};</script>
<script src="app.js"></script>
</body>
</html>
`;
await writeFile(resolve(output, 'index.html'), html, 'utf8');
console.log(`build-tool-host-harness: wrote ${resolve(output, 'index.html')}`);
