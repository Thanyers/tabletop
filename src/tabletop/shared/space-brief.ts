import type { CollaborationSpace } from './collaboration-space';
import type { ToolProjectionGrant } from './tool-connection';

/**
 * F080 / CTX-01: what an AI request for this room would and would not include.
 *
 * The report is a promise the room can show a person before anything is sent: this brief, these
 * sources, and by name the things deliberately left out. It is derived from the space and its grants,
 * so it cannot claim a connection the source never granted.
 */

export interface SpaceBrief {
  text: string;
  updatedBy: string;
  updatedAt: number;
}

export interface AiContextIncluded {
  kind: 'brief' | 'source';
  /** A display id or label; never a credential. */
  label: string;
  /** The revision the content was read at, when it is a source. */
  dataRevision?: number;
}

export interface AiContextOmitted {
  what: string;
  reason: 'not-connected' | 'withdrawn' | 'not-ai-context' | 'outside-scope';
}

export interface AiContextReport {
  /** True when there is no brief yet; a room works without one. */
  briefAbsent: boolean;
  included: AiContextIncluded[];
  omitted: AiContextOmitted[];
  /** One sentence a person can read before sending. */
  summary: string;
}

export function aiContextFor(input: {
  space: CollaborationSpace;
  brief?: SpaceBrief;
  grants: readonly ToolProjectionGrant[];
}): AiContextReport {
  const included: AiContextIncluded[] = [];
  const omitted: AiContextOmitted[] = [];

  if (input.brief && input.brief.text.trim().length > 0) {
    included.push({ kind: 'brief', label: input.brief.text.trim() });
  }

  for (const source of input.space.sources) {
    if (source.status !== 'linked') {
      omitted.push({ what: source.workspaceId.slice(0, 8), reason: 'not-connected' });
      continue;
    }
    const grant = input.grants.find(entry => entry.sourceWorkspaceId === source.workspaceId);
    if (!grant) {
      omitted.push({ what: source.workspaceId.slice(0, 8), reason: 'not-connected' });
      continue;
    }
    if (grant.status === 'revoked') {
      omitted.push({ what: source.workspaceId.slice(0, 8), reason: 'withdrawn' });
      continue;
    }
    included.push({ kind: 'source', label: source.workspaceId.slice(0, 8), dataRevision: grant.sourceDataRevision });
  }

  // The room's chat, notes and member list are never part of an AI request for a source.
  omitted.push({ what: 'chat and notes', reason: 'not-ai-context' });
  omitted.push({ what: 'member list', reason: 'not-ai-context' });
  omitted.push({ what: 'other rooms', reason: 'outside-scope' });

  const briefAbsent = !input.brief || input.brief.text.trim().length === 0;
  const sourceCount = included.filter(entry => entry.kind === 'source').length;
  const summary = `${briefAbsent ? 'ยังไม่มี brief ของห้อง' : 'ใช้ brief ของห้อง'} · ส่ง ${sourceCount} แหล่งข้อมูล · ไม่ส่ง ${omitted.length} รายการ`;

  return { briefAbsent, included, omitted, summary };
}
