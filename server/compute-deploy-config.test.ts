import { describe, expect, it } from 'vitest';
import { computeDeployConfig } from './compute-deploy-config';

const operator = () => ({
  name: 'synthetic-staging', vars: { PUBLIC_ORIGIN: 'https://staging.example', AI_MONTHLY_BUDGET_MICRO_USD: '1' },
  d1_databases: [{ binding: 'DB', database_id: 'synthetic-only' }],
  durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'Room' }, { name: 'BILLING', class_name: 'Billing' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['Room', 'Billing'] }],
});

describe('hosted compute deployment profile', () => {
  it('enables both engines without changing environment identity, bindings or budgets', () => {
    const input = operator();
    const original = structuredClone(input);
    const result = computeDeployConfig(input);
    expect(result.worker_loaders).toEqual([{ binding: 'COMPUTE_LOADER' }]);
    expect(result.vars).toEqual({ ...input.vars, TABLE_COMPUTE_PYTHON: 'enabled' });
    expect(result.containers).toEqual([{ class_name: 'Room', scheduling_policy: 'durable_object', images: { compute: { dockerfile: './compute/Dockerfile' } } }]);
    for (const key of ['name', 'd1_databases', 'durable_objects', 'migrations']) expect(result[key]).toEqual(input[key as keyof typeof input]);
    expect(input).toEqual(original);
    expect(computeDeployConfig(result)).toEqual(result);
  });
  it('retains other loaders and containers and refuses conflicting Room applications', () => {
    const other = { class_name: 'Other', image: 'synthetic' };
    const config = { ...operator(), worker_loaders: [{ binding: 'OTHER_LOADER' }], containers: [other] };
    expect(computeDeployConfig(config).worker_loaders).toEqual([{ binding: 'OTHER_LOADER' }, { binding: 'COMPUTE_LOADER' }]);
    expect(computeDeployConfig(config).containers).toEqual([other, { class_name: 'Room', scheduling_policy: 'durable_object', images: { compute: { dockerfile: './compute/Dockerfile' } } }]);
    expect(() => computeDeployConfig({ ...operator(), containers: [{ class_name: 'Room', image: 'old-policy' }] })).toThrow('Conflicting Room container');
  });
  it('refuses configs without the existing Room binding before modifying anything', () => {
    expect(() => computeDeployConfig({ name: 'wrong-app' })).toThrow('Room binding');
  });
});
