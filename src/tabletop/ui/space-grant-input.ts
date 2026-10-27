/**
 * F080 / D-054: what a table owner sends to let a room read one projection.
 *
 * A grant names the room by *workspace id* as well as slug, because the authority compares the
 * workspace, not the slug: a room that reuses a slug cannot read through someone else's grant. The
 * helper exists so the panel cannot build a payload that omits that half.
 */

export interface GrantProjectionInput {
  /** The table doing the granting; the command goes to this workspace. */
  sourceWorkspaceId: string;
  /** The room being granted. Both halves are required by the authority. */
  spaceWorkspaceId: string;
  spaceId: string;
  /** One port: which resource is readable, which fields, and how many rows. */
  portId: string;
  resource: string;
  fields: string[];
  maxRows: number;
}

export type GrantBuild =
  | { ok: true; workspaceId: string; payload: { grantId: string; spaceId: string; spaceWorkspaceId: string; audience: { kind: 'space-members' }; projections: { portId: string; resource: string; fields: string[]; maxRows: number }[]; actions: never[] } }
  | { ok: false; problem: string };

const PORT_ID = /^[a-z][a-z0-9-]{1,39}$/u;

/** Read the fields a person typed: comma or space separated, de-duplicated, order kept. */
export function readFields(text: string): string[] {
  const seen = new Set<string>();
  const fields: string[] = [];
  for (const part of text.split(/[,\s]+/u)) {
    const field = part.trim();
    if (field === '' || seen.has(field)) continue;
    seen.add(field);
    fields.push(field);
  }
  return fields;
}

export function buildGrant(input: GrantProjectionInput, randomId: () => string = () => globalThis.crypto.randomUUID()): GrantBuild {
  if (!PORT_ID.test(input.portId)) return { ok: false, problem: 'ชื่อ port ต้องเป็น lowercase kebab-case (เช่น budget)' };
  if (input.resource.trim() === '') return { ok: false, problem: 'ต้องระบุ resource ที่จะให้อ่าน' };
  const fields = readFields(input.fields.join(','));
  if (fields.length === 0) return { ok: false, problem: 'ต้องระบุอย่างน้อยหนึ่ง field' };
  if (!Number.isInteger(input.maxRows) || input.maxRows < 1) return { ok: false, problem: 'จำนวนแถวต้องเป็นจำนวนเต็มตั้งแต่ 1' };
  if (input.spaceId.trim() === '' || input.spaceWorkspaceId.trim() === '') return { ok: false, problem: 'ต้องระบุห้องที่จะให้สิทธิ์' };

  return {
    ok: true,
    workspaceId: input.sourceWorkspaceId,
    payload: {
      grantId: `grant-${randomId()}`,
      spaceId: input.spaceId,
      spaceWorkspaceId: input.spaceWorkspaceId,
      audience: { kind: 'space-members' },
      projections: [{ portId: input.portId, resource: input.resource.trim(), fields, maxRows: input.maxRows }],
      actions: [],
    },
  };
}
