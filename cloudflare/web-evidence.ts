// F064 slice C: web sources become table evidence only through these two commands.
//
// `table.addWebSources` is the only command whose payload carries provider text. The worker redacts
// and clamps it before the domain validates it, and the feature switch can refuse both commands so
// production can keep web results display-only.
import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import {
  headWithin,
  safeExternalUrl,
  MAX_JOB_RESEARCH_DATE_CHARS,
  MAX_JOB_RESEARCH_SUMMARY_CHARS,
  MAX_JOB_RESEARCH_TITLE_CHARS,
  MAX_SOURCE_AUTHORITY,
} from '../src/tabletop/shared/model-job-progress.js';
import { createIdentityReplacements, redactString, type IdentityReplacement } from './table-assistant.js';
import type { Env } from './contracts.js';

/** The command types this module owns. */
export const WEB_EVIDENCE_COMMANDS = ['table.addWebSources', 'table.reviewWebSource'] as const;

interface WebSourcePayload {
  title: string;
  url: string;
  summary: string;
  date: string | null;
  authority: number;
}

function replacementsFor(workspace: WorkspaceView): IdentityReplacement[] | null {
  if (workspace.domain.kind !== 'table') return [];
  try {
    return createIdentityReplacements(workspace);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type WebEvidencePreparation =
  | { ok: true; envelope: unknown }
  | { ok: false; code: 'WEB_EVIDENCE_DISABLED' | 'WEB_EVIDENCE_UNAVAILABLE' };

/**
 * Redacts and clamps the web sources a member offered, and refuses the feature when it is off.
 * Returns the envelope unchanged for every other command.
 */
export function prepareWebEvidenceCommand(env: Env, workspace: WorkspaceView, envelope: unknown): WebEvidencePreparation {
  if (!isRecord(envelope)) return { ok: true, envelope };
  const type = envelope.type;
  if (type !== 'table.addWebSources' && type !== 'table.reviewWebSource') return { ok: true, envelope };
  if (env.TABLE_WEB_EVIDENCE === 'off') return { ok: false, code: 'WEB_EVIDENCE_DISABLED' };
  if (type === 'table.reviewWebSource') return { ok: true, envelope };
  const replacements = replacementsFor(workspace);
  if (replacements === null) return { ok: false, code: 'WEB_EVIDENCE_UNAVAILABLE' };
  const payload = isRecord(envelope.payload) ? envelope.payload : {};
  const rawSources = Array.isArray(payload.sources) ? payload.sources : [];
  const sources: WebSourcePayload[] = [];
  for (const entry of rawSources) {
    if (!isRecord(entry)) continue;
    const url = safeExternalUrl(redactString(typeof entry.url === 'string' ? entry.url : '', replacements));
    const title = headWithin(redactString(typeof entry.title === 'string' ? entry.title : '', replacements), MAX_JOB_RESEARCH_TITLE_CHARS).trim();
    const summary = headWithin(redactString(typeof entry.summary === 'string' ? entry.summary : '', replacements), MAX_JOB_RESEARCH_SUMMARY_CHARS).trim();
    if (!url || !title || !summary) continue;
    const date = typeof entry.date === 'string' ? headWithin(entry.date, MAX_JOB_RESEARCH_DATE_CHARS).trim() : '';
    const authority = typeof entry.authority === 'number' && Number.isSafeInteger(entry.authority)
      ? Math.min(Math.max(entry.authority, 0), MAX_SOURCE_AUTHORITY)
      : 0;
    sources.push({ title, url, summary, date: date || null, authority });
  }
  return { ok: true, envelope: { ...envelope, payload: { sources } } };
}
