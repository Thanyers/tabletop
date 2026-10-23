import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const outputDirectory = resolve('test-results');
mkdirSync(outputDirectory, { recursive: true });

await build({
  entryPoints: [resolve('tests/ui/f066-rules-harness.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: resolve(outputDirectory, 'f066-rules.js'),
  logLevel: 'info',
});
