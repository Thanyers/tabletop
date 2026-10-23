import { readFile, writeFile } from 'node:fs/promises';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid compute deployment config.');
  return value as Record<string, unknown>;
}

/** Add the versioned execution profile to the operator's private environment config. */
export function computeDeployConfig(config: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(config);
  const durableObjects = object(result.durable_objects ?? {});
  const bindings = Array.isArray(durableObjects.bindings) ? durableObjects.bindings : [];
  if (!bindings.some(binding => object(binding).class_name === 'Room')) throw new Error('Missing existing Room binding.');
  const loaders = Array.isArray(result.worker_loaders) ? result.worker_loaders : [];
  if (!loaders.some(loader => object(loader).binding === 'COMPUTE_LOADER')) loaders.push({ binding: 'COMPUTE_LOADER' });
  result.worker_loaders = loaders;
  const containers = Array.isArray(result.containers) ? result.containers : [];
  const existing = containers.find(container => object(container).class_name === 'Room');
  if (existing) {
    const container = object(existing);
    const images = object(container.images ?? {});
    const compute = object(images.compute ?? {});
    if (container.scheduling_policy !== 'durable_object' || compute.dockerfile !== './compute/Dockerfile') {
      throw new Error('Conflicting Room container: refusing an implicit application/image migration.');
    }
  } else {
    containers.push({ class_name: 'Room', scheduling_policy: 'durable_object', images: { compute: { dockerfile: './compute/Dockerfile' } } });
  }
  result.containers = containers;
  result.vars = { ...object(result.vars ?? {}), TABLE_COMPUTE_PYTHON: 'enabled' };
  return result;
}

if (process.argv[1]?.endsWith('compute-deploy-config.ts')) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: compute-deploy-config.ts <private-wrangler-config.json>');
  const config = computeDeployConfig(object(JSON.parse(await readFile(file, 'utf8'))));
  // Config identity is checked by release-deploy.ts before and after this operation.
  // Never log the private config or change credentials/environment targets here.
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  console.log('Prepared hosted JavaScript/Python profile tabletop-compute-1.');
}
