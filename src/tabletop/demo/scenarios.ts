import type { CaseKind, DomainState } from '../shared/contracts';

export interface PracticeScenarioCommand {
  type: string;
  payload: unknown;
  payloadFromState?: (state: DomainState) => unknown;
}

export interface PracticeScenarioStep {
  title: string;
  detail: string;
  actorId: string;
  command: PracticeScenarioCommand;
  expectedOutcome?: 'applied' | 'rejected';
  expectedErrorCode?: string;
}

export interface PracticeScenarioDefinition {
  id: string;
  title: string;
  kind: CaseKind;
  persona: string;
  goal: string;
  challenge: string;
  steps: readonly PracticeScenarioStep[];
}

export const PRACTICE_SCENARIOS = [
  {
    id: 'invoice-rules',
    title: 'ตรวจบิลและแก้กติกา',
    kind: 'invoice',
    persona: 'คุณอ้อม · เจ้าของร้าน',
    goal: 'ปรับช่วงวันที่ของอัตราค่าขนส่ง แล้วตรวจผลกับรายการบิลเดิม',
    challenge: 'ยอดที่คำนวณได้กับยอดที่เรียกเก็บต่างกันตรงไหน และหลักฐานส่วนใดยังขาดอยู่?',
    steps: [
      {
        title: 'เสนอวันเริ่มอัตราใหม่',
        detail: 'ขยับวันเปลี่ยนจากอัตราเดิมเป็นอัตราใหม่ให้ต่อกันพอดี โดยยังไม่เปลี่ยนกฎที่ใช้อยู่',
        actorId: 'practice-owner',
        command: {
          type: 'evolve.propose',
          payload: {
            change: {
              kind: 'invoice',
              operations: [
                { op: 'setEffectiveWindow', id: 'base-bangkok-before-15', from: '2000-01-01', to: '2026-10-14' },
                { op: 'setEffectiveWindow', id: 'base-bangkok-from-15', from: '2026-10-14', to: null },
              ],
            },
          },
        },
      },
      {
        title: 'จำลองผลก่อนเปิดใช้',
        detail: 'คำนวณผลก่อนและหลังจากรายการเดิม เพื่อเห็นผลของวันที่เปลี่ยน',
        actorId: 'practice-owner',
        command: { type: 'evolve.simulate', payload: {} },
      },
      {
        title: 'ตรวจร่างกติกา',
        detail: 'ให้ตัวตรวจสอบยืนยันช่วงวันที่และผลคำนวณจากข้อมูลชุดเดิม',
        actorId: 'practice-owner',
        command: { type: 'evolve.validate', payload: {} },
      },
      {
        title: 'เจ้าของอนุมัติร่าง',
        detail: 'บันทึกการอนุมัติหลังจากร่างผ่านการตรวจแล้ว',
        actorId: 'practice-owner',
        command: { type: 'evolve.approve', payload: {} },
      },
      {
        title: 'เปิดใช้กติกาใหม่',
        detail: 'บันทึกอัตราเป็นกฎเวอร์ชันใหม่หลังผ่านขั้นตอนอนุมัติ',
        actorId: 'practice-owner',
        command: { type: 'evolve.activate', payload: {} },
      },
      {
        title: 'บันทึกผลตรวจบิล',
        detail: 'เก็บผลที่คำนวณใหม่ พร้อมคงรายการที่ยังต้องขอหลักฐานเพิ่ม',
        actorId: 'practice-owner',
        command: { type: 'invoice.saveRun', payload: {} },
      },
    ],
  },
  {
    id: 'teaching-physics',
    title: 'ทดลองแรงและมวล',
    kind: 'teaching',
    persona: 'ครูเมย์ · ฟ้า · ต้น',
    goal: 'เปลี่ยนค่าบทเรียนร่วม ดูการคำนวณใหม่ และให้ผู้เรียนตอบแยกกัน',
    challenge: 'เมื่อครูเปลี่ยนแรงและมวล คำตอบใหม่ควรได้ตำแหน่งเท่าไร และผู้เรียนเห็นข้อมูลของใครบ้าง?',
    steps: [
      {
        title: 'ครูเปลี่ยนค่าบทเรียน',
        detail: 'ตั้งแรง 10 นิวตัน มวล 5 กิโลกรัม และเวลา 2 วินาที แบบจำลองคำนวณตำแหน่งได้ 4 เมตร',
        actorId: 'practice-teacher',
        command: { type: 'teaching.setParameters', payload: { force: 10, mass: 5, time: 2 } },
      },
      {
        title: 'เลือกกราฟให้ฟ้า',
        detail: 'ตั้งมุมมองกราฟขั้นสูงให้ฟ้า โดยไม่เปลี่ยนบทเรียนร่วมของต้น',
        actorId: 'practice-teacher',
        command: {
          type: 'teaching.setRepresentation',
          payload: { actorId: 'practice-learner-1', representation: 'graph', difficulty: 'advanced' },
        },
      },
      {
        title: 'ครูบันทึกหมายเหตุส่วนตัว',
        detail: 'เก็บข้อความสำหรับครูซึ่งจะไม่ปรากฏในมุมมองของผู้เรียน',
        actorId: 'practice-teacher',
        command: { type: 'teaching.saveNote', payload: { text: 'คำตอบอ้างอิง: 4 เมตร' } },
      },
      {
        title: 'ฟ้าส่งคำตอบ',
        detail: 'ฟ้าตอบตำแหน่ง 4 เมตรจากโจทย์ปัจจุบัน',
        actorId: 'practice-learner-1',
        command: {
          type: 'teaching.answer',
          payload: {},
          payloadFromState: (state) => state.kind === 'teaching'
            ? { questionId: state.questionId, lessonRevision: state.ruleRevision, value: 4 }
            : {},
        },
      },
      {
        title: 'ต้นส่งคำตอบ',
        detail: 'ต้นส่งคำตอบของตัวเอง โดยข้อมูลคำตอบยังแยกตามผู้เรียน',
        actorId: 'practice-learner-2',
        command: {
          type: 'teaching.answer',
          payload: {},
          payloadFromState: (state) => state.kind === 'teaching'
            ? { questionId: state.questionId, lessonRevision: state.ruleRevision, value: 6 }
            : {},
        },
      },
      {
        title: 'ต้นลองเปลี่ยนโจทย์',
        detail: 'ผู้เรียนไม่มีสิทธิ์แก้ค่าบทเรียนของครู คำสั่งนี้จึงถูกปฏิเสธตามกติกา',
        actorId: 'practice-learner-2',
        command: { type: 'teaching.setParameters', payload: { force: 12, mass: 3, time: 2 } },
        expectedOutcome: 'rejected',
        expectedErrorCode: 'FORBIDDEN',
      },
    ],
  },
  {
    id: 'encounter-shield',
    title: 'ช่วยเพื่อนด้วยโล่',
    kind: 'encounter',
    persona: 'DM · Mira · Pip',
    goal: 'ให้ DM ปรับกฎป้องกัน แล้วใช้กฎใหม่ในจังหวะต่อสู้จริง',
    challenge: 'Mira จะช่วยลดความเสียหายให้ Pip ได้หรือไม่ และค่า AP เปลี่ยนอย่างไร?',
    steps: [
      {
        title: 'เสนอการป้องกันเพื่อนร่วมทีม',
        detail: 'กำหนดให้โล่ป้องกันเพื่อน ใช้ 1 AP และใช้ได้ครั้งเดียวต่อเทิร์น',
        actorId: 'practice-dm',
        command: {
          type: 'evolve.propose',
          payload: { change: { kind: 'encounter', rule: { allyTarget: true, apCost: 1, oncePerTurn: true } } },
        },
      },
      {
        title: 'จำลองกฎโล่',
        detail: 'เปรียบเทียบความเสียหายก่อนและหลังใช้กฎใหม่',
        actorId: 'practice-dm',
        command: { type: 'evolve.simulate', payload: {} },
      },
      {
        title: 'ตรวจการจำลอง',
        detail: 'ตรวจว่าการจำลองตรงกับกฎป้องกันที่เสนอ',
        actorId: 'practice-dm',
        command: { type: 'evolve.validate', payload: {} },
      },
      {
        title: 'DM อนุมัติกฎ',
        detail: 'อนุมัติกฎหลังจากผ่านการตรวจ',
        actorId: 'practice-dm',
        command: { type: 'evolve.approve', payload: {} },
      },
      {
        title: 'เปิดใช้กฎโล่',
        detail: 'นำกฎที่อนุมัติไปใช้ในการเผชิญหน้าปัจจุบัน',
        actorId: 'practice-dm',
        command: { type: 'evolve.activate', payload: {} },
      },
      {
        title: 'Goblin โจมตี Pip',
        detail: 'เปิดหน้าต่างตอบโต้สำหรับการโจมตีที่กำหนดเป้าหมาย Pip',
        actorId: 'practice-dm',
        command: { type: 'encounter.declareHit', payload: { target: 'pip' } },
      },
      {
        title: 'Mira ยกโล่ช่วย Pip',
        detail: 'บันทึกปฏิกิริยาของ Mira ตามกฎที่ DM เปิดใช้',
        actorId: 'practice-mira',
        command: { type: 'encounter.shield', payload: { target: 'pip' } },
      },
      {
        title: 'DM ตัดสินผลการโจมตี',
        detail: 'คำนวณความเสียหายหลังโล่ลดแรงโจมตี และบันทึกค่า AP',
        actorId: 'practice-dm',
        command: { type: 'encounter.resolve', payload: {} },
      },
    ],
  },
] as const satisfies readonly PracticeScenarioDefinition[];

export type PracticeScenario = (typeof PRACTICE_SCENARIOS)[number];
export type PracticeScenarioStepValue = PracticeScenario['steps'][number];
