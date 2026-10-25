import { access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

/**
 * F078-T10: the Node guest runtime answers `/model` with `MODEL_NOT_CONFIGURED`
 * and never reaches a provider, so the parallel `ModelGateway`/`SqlModelJobStore`
 * lifecycle in `server/model.ts` has no caller. `server/features.test.ts` keeps
 * the HTTP contract; this guard keeps the dead lifecycle from coming back.
 */
describe('Node runtime model surface', () => {
  it('does not carry a second, unreachable model-job lifecycle', async () => {
    await expect(access(new URL('./model.ts', import.meta.url))).rejects.toThrow();
  });
});
