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

// "BPMN อยู่ไหน", "ตารางคำตอบอยู่ตรงไหน", "where is the BPMN chart?"
const WHERE_TH = /^(?:การ์ด|card)?\s*(.+?)\s*(?:อยู่ไหน|อยู่ที่ไหน|อยู่ตรงไหน|ที่ไหน|ตรงไหน)\s*[?？]?$/iu;
const WHERE_EN = /^where(?:'s|\s+is|\s+are)?\s+(?:the\s+)?(.+?)\s*\??$/iu;
const OPEN = /^(?:เปิด|ค้นหา|หา|ไปที่|ไปยัง|แสดง|โชว์|open|show|find|go to|search)\s*(?:การ์ด|card)?\s*(.+)$/iu;
const HIDE = /^(?:ซ่อน|ปิด|hide|close)\s*(?:การ์ด|card)\s*(.+)$|^(?:ซ่อน|hide)\s*(.+)$/iu;

/** The verb and card name, when the message is a card command rather than a question. */
export function parseCanvasObjectCommand(text: string): { verb: 'open' | 'hide'; query: string } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  const hide = HIDE.exec(trimmed);
  if (hide) return { verb: 'hide', query: (hide[1] ?? hide[2] ?? '').trim() };
  const open = OPEN.exec(trimmed);
  if (open) return { verb: 'open', query: open[1].trim() };
  const where = WHERE_TH.exec(trimmed) ?? WHERE_EN.exec(trimmed);
  return where ? { verb: 'open', query: where[1].replace(/^(?:การ์ด|card)\s*/iu, '').trim() } : null;
}

const ALIASES: Record<string, string[]> = {
  'table.rules': ['rules', 'rule', 'กฎ'],
  'table.actions': ['actions', 'action', 'การกระทำ'],
  'workspace.people': ['people', 'members', 'คน', 'สมาชิก'],
  'workspace.history': ['history', 'ประวัติ'],
};

const normalize = (value: string) => value.toLocaleLowerCase('th').replace(/[\s"'“”‘’]+/gu, '');

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** A small typo in one word still finds the card ("bpnn" → "BPMN 3 Swimlane"). */
function nearWord(title: string, query: string): boolean {
  const wanted = normalize(query);
  if (wanted.length < 3) return false;
  const allowed = wanted.length <= 5 ? 1 : 2;
  return title.toLocaleLowerCase('th').split(/[\s,·:()/_-]+/u).some((word) => word.length >= 3 && editDistance(word, wanted) <= allowed);
}

/** Cards whose title (or a known alias) matches the query, best match first. */
export function matchCanvasObjects(objects: readonly CanvasObjectEntry[], query: string): CanvasObjectEntry[] {
  const wanted = normalize(query);
  if (!wanted) return [];
  const scored = objects.map((object) => {
    const names = [object.title, ...(ALIASES[object.id] ?? [])].map(normalize);
    const exact = Math.max(...names.map((name) => name === wanted ? 3 : name.startsWith(wanted) ? 2 : name.includes(wanted) || (name.length >= 2 && wanted.includes(name)) ? 1 : 0));
    const score = exact > 0 ? exact : [object.title, ...(ALIASES[object.id] ?? [])].some((name) => nearWord(name, query)) ? 0.5 : 0;
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

/** Centre the canvas on a point in canvas coordinates (e.g. another member's live cursor). */
let pointFocus: ((x: number, y: number) => void) | null = null;

export function registerCanvasPointFocus(next: (x: number, y: number) => void): () => void {
  pointFocus = next;
  return () => { if (pointFocus === next) pointFocus = null; };
}

export function focusCanvasPoint(x: number, y: number): boolean {
  if (!pointFocus) return false;
  pointFocus(x, y);
  return true;
}

/**
 * A sent message without the card-reference wrapping, for titles: "[การ์ด “X”] msg\n(Card in question: …)"
 * becomes { reference: "X", message: "msg" }. Nested references keep only the innermost card name.
 */
export function splitReferencedPrompt(prompt: string): { reference: string | null; message: string } {
  const firstLine = prompt.split('\n')[0];
  const prefix = '[การ์ด “';
  if (!firstLine.startsWith(prefix)) return { reference: null, message: firstLine };
  const end = firstLine.lastIndexOf('”] ');
  if (end < prefix.length) return { reference: null, message: firstLine };
  const inner = splitReferencedPrompt(firstLine.slice(prefix.length, end));
  // Older referenced titles were cut short and may still carry a "[การ์ด “" start or a "(Card in question" tail.
  const reference = (inner.reference ?? inner.message).replace(/^(?:\[การ์ด “)+/u, '').replace(/\s*\(Card in qu.*$/u, '').replace(/”\]\s*/u, ' · ').trim();
  return { reference, message: firstLine.slice(end + 3) };
}
