import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Build an opt-in configuration without forcing Docker on unrelated local tests.
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
config.vars.TABLE_COMPUTE_PYTHON = 'enabled';
config.main = resolve(root, config.main);
config.assets.directory = resolve(root, config.assets.directory);
for (const db of config.d1_databases ?? []) db.migrations_dir = resolve(root, db.migrations_dir);
config.containers = [{ class_name: 'Room', scheduling_policy: 'durable_object', images: { compute: { dockerfile: resolve(root, 'compute/Dockerfile') } } }];
const directory = resolve(root, 'test-results/compute-config');
await mkdir(directory, { recursive: true });
const path = resolve(directory, 'wrangler.json');
await writeFile(path, JSON.stringify(config, null, 2) + '\n');
process.stdout.write(path + '\n');
