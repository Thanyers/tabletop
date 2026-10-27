/**
 * F047: one intent classifier for the table composer, shared by the client card router.
 *
 * Before this, routing was a single binary regex in the UI: "is this obviously a change?" → draft,
 * otherwise ask. Two measured consequences:
 * - a build request phrased without the exact words ("อยากได้ตารางเก็บลูกค้า") went to the assistant
 *   and created nothing;
 * - the reverse mistake ("change this row's status to paid") could be promoted to a rule draft.
 *
 * Four intents make the decision reviewable: build (new table), edit (change the current one),
 * act (do something to a record with an existing action) and ask (answer only). Ambiguity resolves
 * towards building because a question never creates anything, while a stray build is a visible draft
 * the person can reject.
 */

export type ChatIntent = 'build' | 'edit' | 'ask' | 'act';

export interface ChatIntentInput {
  prompt: string;
  hasActiveProgram: boolean;
  /** The table already has an action that creates rows, so "add a record" is an act, not a build. */
  hasCreateAction: boolean;
}

const QUESTION = /^(?:(?:how many|how much|what|which|why|when|who|where|explain|summari[sz]e|can i|could i|should i|do i|is it|does)\b|อธิบาย|สรุป|ทำไม|มีอะไร|อะไร|เท่าไร|เท่าไหร่|ยังไง|อย่างไร|ที่ไหน|เมื่อไร|ใคร|มี.{0,32}กี่|กี่)/iu;
const GREETING = /^(?:hi|hello|hey|thanks|thank you|ok|okay|สวัสดี|ขอบคุณ|โอเค)[\s!.,]*$/iu;
const CHANGE_VERB = /\b(?:add|creat\w*|build|make|design|extend|chang\w*|edit|new|simplify|remove|delete)\b|เพิ่ม|สร้าง|ปรับ|แก้|ทำ|ขอ|อยาก|เอาออก|ลบ/iu;
/** A UI noun that only exists inside the rules: a form, a button, a card, a chart. */
const UI_NOUN = /\b(?:forms?|buttons?|cards?|charts?|graphs?|diagrams?|views?|ui|sliders?|toggles?|dashboards?)\b|ฟอร์ม|ปุ่ม|การ์ด|กราฟ|แผนภูมิ|หน้าจอ|สไลเดอร์/iu;
/** A structural noun: the table itself or one of its columns. */
const STRUCTURE = /\b(?:add|creat\w*|build|make|design|extend)\s+(?:(?:a|an|the|this|new|another|extra)\s+)*(?:tables?|collections?|columns?|fields?)\b|\b(?:new|another|extra)\s+(?:tables?|collections?|columns?|fields?)\b|(?:เพิ่ม|สร้าง)\s*(?:ตาราง|คอลัมน์|ฟิลด์)/iu;
const DATA_NOUN = /\b(?:records?|rows?|entries|data|mock\w*|samples?)\b|รายการ|แถว|ข้อมูล|จำลอง|ตัวอย่าง/iu;
/** Something the builder can act on; a change verb without one is conversation, not a rule edit. */
const TOPIC = /\b(?:tables?|collections?|columns?|fields?|records?|rows?|data|cards?|charts?|forms?|buttons?|views?|ui|dashboards?)\b|ตาราง|คอลัมน์|ฟิลด์|ข้อมูล|รายการ|การ์ด|กราฟ|ปุ่ม|ฟอร์ม|หน้าจอ/iu;
/** Changing one existing record: this belongs to an action, not to the builder. */
/** F082: words about the rules themselves; with a change verb (or "new/instead") they ask the builder, not an action. */
const RULE_NOUN = /\b(?:rules?|conditions?|formulas?|calculat\w*)\b|กฎ|เงื่อนไข|สูตร|คำนวณ/iu;
const RULE_CHANGE = /\b(?:instead|new|cite|evidence)\b|ใหม่|แทน|อ้างอิง|หลักฐาน/iu;
/** F086: words a bare "Change this rule" is made of; anything beyond them names what to change. */
const RULE_FILLER = /\b(?:please|this|that|the|a|my|our|rules?|conditions?|formulas?)\b|นี้|นั้น|ของ|ให้|หน่อย|กฎ|เงื่อนไข|สูตร/giu;
const DATA_ACTION = /\b(?:mark|set|move|assign|approve|reject|confirm|delete|remove)\b[^.!?]{0,60}\b(?:status|paid|unpaid|done|to|from|row|record)\b|\b(?:change|update|edit)\b[^.!?]{0,60}\b(?:status|paid|unpaid|row|record|cell)\b|ทำเครื่องหมาย|จ่ายแล้ว|เปลี่ยนสถานะ|ยืนยัน|อนุมัติ|ปฏิเสธ/iu;

const DATA_ACTION_ANYWHERE = new RegExp(DATA_ACTION.source, 'giu');

/**
 * F082: a request to change the table's own structure or rules, even when it names a record action inside it
 * ("add a todo table with a button to mark it done"). Action phrases are removed first so the "ทำ" in
 * "ทำเครื่องหมาย" no longer reads as a change verb.
 */
function asksTheBuilder(prompt: string): boolean {
  if (STRUCTURE.test(prompt)) return true;
  const rest = prompt.replace(DATA_ACTION_ANYWHERE, ' ');
  if (UI_NOUN.test(rest) && CHANGE_VERB.test(rest)) return true;
  if (!RULE_NOUN.test(rest) || !(CHANGE_VERB.test(rest) || RULE_CHANGE.test(rest))) return false;
  // A bare "Change this rule" names nothing to change yet, so it stays a conversation until a rule is picked.
  // F086: anything more specific (a table word, or what the change is, e.g. "cite the verified VAT sources") drafts.
  const detail = rest.replace(RULE_FILLER, ' ').replace(new RegExp(CHANGE_VERB.source, 'giu'), ' ').replace(/[\s.!?,]+/gu, '');
  return TOPIC.test(rest) || detail.length >= 3;
}

export function classifyChatIntent(input: ChatIntentInput): ChatIntent {
  const prompt = input.prompt.trim();
  const fallback: ChatIntent = input.hasActiveProgram ? 'edit' : 'build';
  if (prompt.length < 3) return 'ask';
  if (GREETING.test(prompt)) return 'ask';
  // A question never becomes a draft, even when it mentions a form or a table.
  if (QUESTION.test(prompt)) return 'ask';
  if (asksTheBuilder(prompt)) return fallback;
  if (DATA_ACTION.test(prompt)) return 'act';

  if (CHANGE_VERB.test(prompt)) {
    if (UI_NOUN.test(prompt)) return fallback;
    if (STRUCTURE.test(prompt)) return fallback;
    if (DATA_NOUN.test(prompt)) return input.hasCreateAction ? 'act' : fallback;
  }
  // With no table yet, any change request is an attempt to build one.
  if (!input.hasActiveProgram) return 'build';
  // A change to an existing table needs a subject the builder can act on ("make it harder" alone
  // is a conversation, not a rule edit).
  if (TOPIC.test(prompt) && CHANGE_VERB.test(prompt)) return fallback;
  if (DATA_NOUN.test(prompt) && input.hasCreateAction) return 'act';
  return 'ask';
}
