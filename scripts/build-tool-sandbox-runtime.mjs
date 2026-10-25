import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Build the tool sandbox runtime: React, ReactDOM and the frame bootstrap as one inline-able
 * script. The frame never fetches, so the runtime has to travel inside the document.
 *
 * Run by `npm run build` and `npm run dev`; the output is a build product and is gitignored.
 */

const root = resolve(import.meta.dirname, '..');
const entry = resolve(root, 'src/tabletop/ui/tool-sandbox/runtime-entry.ts');
const output = resolve(root, 'public/tool-sandbox-runtime.js');

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  write: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

const text = result.outputFiles?.[0]?.text;
if (!text) {
  console.error('tool-sandbox-runtime: esbuild produced no output');
  process.exit(1);
}
if (/<\/script/iu.test(text)) {
  console.error('tool-sandbox-runtime: the bundle can close an inline script tag; refusing to emit it');
  process.exit(1);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, text, 'utf8');
console.log(`tool-sandbox-runtime: wrote ${text.length} characters to public/tool-sandbox-runtime.js`);
