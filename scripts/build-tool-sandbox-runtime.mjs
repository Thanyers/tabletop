import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Build the two static scripts of the tool sandbox (F080):
 *
 * 1. `public/tool-sandbox-runtime.js` — React, ReactDOM and the frame bootstrap as one inline-able
 *    script. The `srcDoc` frame never fetches, so the runtime has to travel inside the document.
 * 2. `sandbox-assets/frame.js` — the document served from the sandbox's own origin (D-044): it
 *    announces itself, takes the runtime as one init message, and starts it. It is built from
 *    `frame-entry.ts` so the message rules it checks are the same module the host is tested against.
 *
 * Run by `npm run build`, `npm run dev` and the room-shell harness builder; both outputs are build
 * products and are gitignored.
 */

const root = resolve(import.meta.dirname, '..');

async function bundle(entryPoint, outfile) {
  const result = await build({
    entryPoints: [resolve(root, entryPoint)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    write: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const text = result.outputFiles?.[0]?.text;
  if (!text) {
    console.error(`${outfile}: esbuild produced no output`);
    process.exit(1);
  }
  await mkdir(dirname(resolve(root, outfile)), { recursive: true });
  await writeFile(resolve(root, outfile), text, 'utf8');
  return text;
}

// The `srcDoc` document inlines this text, so it must not be able to close its own script tag.
const runtime = await bundle('src/tabletop/ui/tool-sandbox/runtime-entry.ts', 'public/tool-sandbox-runtime.js');
if (/<\/script/iu.test(runtime)) {
  console.error('tool-sandbox-runtime: the bundle can close an inline script tag; refusing to emit it');
  process.exit(1);
}
console.log(`tool-sandbox-runtime: wrote ${runtime.length} characters to public/tool-sandbox-runtime.js`);

// The origin-served frame is a plain external script, so an inline-tag check does not apply to it.
const frame = await bundle('src/tabletop/ui/tool-sandbox/frame-entry.ts', 'sandbox-assets/frame.js');
console.log(`tool-sandbox-frame: wrote ${frame.length} characters to sandbox-assets/frame.js`);

// D-047: the sandbox origin serves the runtime itself, so the frame evaluates code it loaded from its
// own origin instead of a 686 KB string posted by the app. Same bundle, second copy.
await writeFile(resolve(root, 'sandbox-assets/runtime.js'), runtime, 'utf8');
console.log(`tool-sandbox-runtime: copied ${runtime.length} characters to sandbox-assets/runtime.js`);
