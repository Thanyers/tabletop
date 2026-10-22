// Open, find or hide a canvas card by typing in the table chat ("เปิดการ์ด คำตอบที่ส่ง", "open rules").
// The canvas registers the finder; the chat runs it before anything is sent to the AI.

export interface CanvasObjectEntry { id: string; title: string; hidden?: boolean }
export type CanvasObjectCommandResult =
  | { handled: false }
  | { handled: true; message: string };
type Finder = (verb: 'open' | 'hide', query: string) => CanvasObjectCommandResult;

let finder: Finder | null = null;

export function registerCanvasObjectFinder(next: Finder): () => void {
  finder = next;
  return () => { if (finder === next) finder = null; };
}

const OPEN = /^(?:เปิด|ค้นหา|หา|ไปที่|ไปยัง|แสดง|โชว์|open|show|find|go to|search)\s*(?:การ์ด|card)?\s*(.+)$/iu;
const HIDE = /^(?:ซ่อน|ปิด|hide|close)\s*(?:การ์ด|card)\s*(.+)$|^(?:ซ่อน|hide)\s*(.+)$/iu;

/** The verb and card name, when the message is a card command rather than a question. */
export function parseCanvasObjectCommand(text: string): { verb: 'open' | 'hide'; query: string } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  const hide = HIDE.exec(trimmed);
  if (hide) return { verb: 'hide', query: (hide[1] ?? hide[2] ?? '').trim() };
  const open = OPEN.exec(trimmed);
  return open ? { verb: 'open', query: open[1].trim() } : null;
}

const ALIASES: Record<string, string[]> = {
  'table.rules': ['rules', 'rule', 'กฎ'],
  'table.actions': ['actions', 'action', 'การกระทำ'],
  'workspace.people': ['people', 'members', 'คน', 'สมาชิก'],
  'workspace.history': ['history', 'ประวัติ'],
};

const normalize = (value: string) => value.toLocaleLowerCase('th').replace(/[\s"'“”‘’]+/gu, '');

/** Cards whose title (or a known alias) matches the query, best match first. */
export function matchCanvasObjects(objects: readonly CanvasObjectEntry[], query: string): CanvasObjectEntry[] {
  const wanted = normalize(query);
  if (!wanted) return [];
  const scored = objects.map((object) => {
    const names = [object.title, ...(ALIASES[object.id] ?? [])].map(normalize);
    const score = Math.max(...names.map((name) => name === wanted ? 3 : name.startsWith(wanted) ? 2 : name.includes(wanted) || (name.length >= 2 && wanted.includes(name)) ? 1 : 0));
    return { object, score };
  }).filter((item) => item.score > 0);
  return scored.sort((a, b) => b.score - a.score).map((item) => item.object);
}

/** Runs a card command typed in the chat. Unrecognised text, or no matching card, goes to the AI as before. */
export function runCanvasObjectCommand(text: string): CanvasObjectCommandResult {
  const command = parseCanvasObjectCommand(text);
  if (!command || !finder) return { handled: false };
  return finder(command.verb, command.query);
}

/** A card the person pointed the chat at ("about this card: make it harder"). */
export interface ChatCardReference { id: string; title: string; detail: string }

let referenceListener: ((reference: ChatCardReference) => void) | null = null;

export function onChatCardReference(listener: (reference: ChatCardReference) => void): () => void {
  referenceListener = listener;
  return () => { if (referenceListener === listener) referenceListener = null; };
}

/** Points the table chat at a card; false when no chat is listening (e.g. a lesson or encounter). */
export function referenceCardInChat(reference: ChatCardReference): boolean {
  if (!referenceListener) return false;
  referenceListener(reference);
  return true;
}

/** The text sent ahead of the person's message, so the AI knows which card they mean. */
export function chatReferencePrompt(reference: ChatCardReference, message: string): string {
  return `[การ์ด “${reference.title}”] ${message}\n(Card in question: ${reference.detail})`;
}
