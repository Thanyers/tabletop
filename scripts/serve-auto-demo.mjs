import { createServer } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/serve-auto-demo.mjs [--file <report.html>] [--port <1024-65535>]');
  process.exit(0);
}
if (args.length % 2 !== 0 || args.some((arg, i) => i % 2 === 0 && !['--file', '--port'].includes(arg))) {
  throw new Error('Only --file and --port options are supported.');
}
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
const portText = options['--port'] ?? '4311';
const port = Number(portText);
if (!/^\d+$/u.test(portText) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port from 1024 to 65535.');
const selected = options['--file'] ?? JSON.parse(await readFile(resolve(root, 'test-results/auto-demo/latest.json'), 'utf8')).reportFile;
if (typeof selected !== 'string') throw new Error('No recorded replay was selected. Run the auto demo first.');
const reportPath = resolve(root, selected);
const archiveRoots = ['test-results/auto-demo', 'handoff/Final/auto-demo'].map(path => resolve(root, path));
const isArchived = path => archiveRoots.some(parent => {
  const child = relative(parent, path);
  return child !== '' && !child.startsWith('..') && !isAbsolute(child);
});
if (!isArchived(reportPath) || !reportPath.endsWith('.html') || !(await lstat(reportPath)).isFile()
    || !isArchived(await realpath(reportPath))) throw new Error('Only HTML files inside the auto-demo archive can be served.');
const html = await readFile(reportPath);
const server = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  if (request.url !== '/' && request.url !== '/index.html') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  response.end(request.method === 'HEAD' ? undefined : html);
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'This local port is already in use; choose another --port.' : 'The local replay server could not start.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Auto-demo replay: http://127.0.0.1:${port}/ (read-only; Ctrl+C stops this preview)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
