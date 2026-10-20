import type { CaseKind } from './contracts';

// Prepared tables offered on the /new start page. Each opens its own room kind;
// none of them turns on rules by itself.

export type StarterKind = Exclude<CaseKind, 'table'>;

export interface Starter {
  id: StarterKind;
  kind: StarterKind;
  title: string;
  summary: string;
}

export const STARTERS: readonly Starter[] = [
  { id: 'invoice', kind: 'invoice', title: 'Invoice check', summary: 'Match shipment charges with dated evidence.' },
  { id: 'teaching', kind: 'teaching', title: 'Physics lesson', summary: 'Teach one model through text, scene, and graph.' },
  { id: 'encounter', kind: 'encounter', title: 'Shared encounter', summary: 'Run turns and reactions with a Dungeon Master.' },
];

export function starterFor(kind: StarterKind): Starter {
  const starter = STARTERS.find((item) => item.kind === kind);
  if (!starter) throw new Error(`No starter for ${kind}`);
  return starter;
}
