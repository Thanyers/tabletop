import type { CaseKind } from '../src/tabletop/shared/contracts.js';
import { AuthorityError } from '../server/errors.js';
import type { Env } from './contracts.js';

export function isTableReadOnly(env: Pick<Env, 'TABLE_READ_ONLY'>): boolean {
  return env.TABLE_READ_ONLY === 'true';
}

/** Read-only mode blocks table rules, records, and source writes; model-job and billing reconciliation may still finish. */
export function requireWorkspaceWritable(env: Pick<Env, 'TABLE_READ_ONLY'>, kind: CaseKind): void {
  if (kind === 'table' && isTableReadOnly(env)) {
    throw new AuthorityError('TABLE_READ_ONLY', 'Table workspaces are read-only while this mode is enabled.', 403);
  }
}
