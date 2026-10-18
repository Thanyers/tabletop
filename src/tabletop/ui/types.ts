import type { WorkspaceView } from '../shared/contracts';
import type { ExecutablePlan, PlanNode } from '../runtime';

export type { ExecutablePlan, PlanNode };

export type Command = (type: string, payload: unknown) => Promise<WorkspaceView | null>;

export interface WorkbenchProps {
  view: WorkspaceView;
  plan: ExecutablePlan;
  onCommand: Command;
  busy: string | null;
  onUpload: (kind: 'shipments' | 'invoice' | 'rate-card', file: File) => Promise<void>;
  onExport: (format: 'csv' | 'html') => Promise<void>;
  onFocusEvidence: (sourceIds: string[]) => void;
  onBackFromEvidence: () => void;
  focusSourceIds: string[];
}

export function summarize(value: unknown): string {
  if (value === null || value === undefined) return 'Unknown';
  if (typeof value === 'string') return value.length > 58 ? `${value.slice(0, 55)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    const first = entries.slice(0, 2).map(([key, item]) => `${key}: ${summarize(item)}`).join(' · ');
    return entries.length > 2 ? `${first} · +${entries.length - 2}` : first || 'No values';
  }
  return 'Not available';
}

export function formatMoney(satang: number | null | undefined): string {
  if (satang === null || satang === undefined || !Number.isSafeInteger(satang)) return 'Unknown';
  return new Intl.NumberFormat('en-TH', { style: 'currency', currency: 'THB' }).format(satang / 100);
}

export function actorLabel(view: WorkspaceView, actorId: string): string {
  return view.members.find((member) => member.actorId === actorId)?.name ?? 'Learner';
}
