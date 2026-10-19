import { calculatePhysics } from '../domain/physics';
import type { DomainState } from '../shared/contracts';
import type { ParsedPracticeFile } from './sample-parser';
import type { PracticeFileKind } from './sample-files';

export interface PracticeImportedSampleContext {
  id: string;
  sampleId?: string;
  kind: PracticeFileKind;
  sourceId?: string;
  parsed: ParsedPracticeFile;
}

export interface PracticeScenarioCommand {
  type: string;
  payload: unknown;
  payloadFromState?: (state: DomainState, files: readonly PracticeImportedSampleContext[]) => unknown;
}

export interface PracticeScenarioStepDefinition {
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
  kind: 'invoice' | 'teaching' | 'encounter';
  persona: string;
  goal: string;
  challenge: string;
  steps: readonly PracticeScenarioStepDefinition[];
}

function rateCardOperations(state: DomainState, files: readonly PracticeImportedSampleContext[]): unknown {
  if (state.kind !== 'invoice') return {};
  const rateFile = files.find((file) => file.kind === 'rate-card' && file.parsed.caseKind === 'invoice' && file.parsed.kind === 'rate-card');
  if (!rateFile || rateFile.sourceId === undefined || rateFile.parsed.caseKind !== 'invoice' || rateFile.parsed.kind !== 'rate-card') return {};
  return {
    change: {
      kind: 'invoice',
      operations: rateFile.parsed.rates.map((rate) => ({ ...rate, sourceId: rateFile.sourceId })),
    },
  };
}

function sourceReviewPayloadFor(kind: 'shipments' | 'invoice' | 'rate-card') {
  return (state: DomainState, files: readonly PracticeImportedSampleContext[]): unknown => {
  if (state.kind !== 'invoice') return {};
  const importedFile = files.find((file) => file.kind === kind && file.parsed.caseKind === 'invoice');
  return importedFile?.sourceId ? { sourceId: importedFile.sourceId, status: 'verified' } : {};
  };
}

function currentLessonAnswer(state: DomainState, offset: number): unknown {
  if (state.kind !== 'teaching') return {};
  return { questionId: state.questionId, lessonRevision: state.ruleRevision, value: calculatePhysics(state.parameters).position + offset };
}

function currentEncounterTarget(state: DomainState, files: readonly PracticeImportedSampleContext[]): unknown {
  if (state.kind !== 'encounter') return {};
  const encounterFile = files.find((file) => file.kind === 'encounter-plan' && file.parsed.caseKind === 'encounter');
  return { target: encounterFile?.parsed.caseKind === 'encounter' ? encounterFile.parsed.target : 'pip' };
}

export const PRACTICE_SCENARIOS = [
  {
    id: 'invoice-rules',
    title: 'ตรวจบิลและแก้กติกา',
    kind: 'invoice',
    persona: 'คุณอ้อม · เจ้าของโต๊ะ',
    goal: 'นำเข้าข้อมูล ตรวจช่วงวันที่ของกฎ และเก็บรายการที่ยังขาดหลักฐาน',
    challenge: 'แก้กฎที่มียอดไม่ตรง โดยคงรายการระยะไกลที่ยังต้องขอเอกสารเพิ่ม',
    steps: [
      { title: 'นำเข้ารายการจัดส่ง', detail: 'วางไฟล์ CSV เพื่อเพิ่มวันที่ น้ำหนัก และเขตบริการลงในโต๊ะว่าง', actorId: 'practice-owner', command: { type: 'practice.importSample', payload: { sampleId: 'invoice-shipments' } } },
      { title: 'ตรวจรายการจัดส่ง', detail: 'ยืนยันว่าข้อมูลจัดส่งที่เพิ่งอ่านมาพร้อมใช้ในการตรวจยอด', actorId: 'practice-owner', command: { type: 'invoice.reviewSource', payload: {}, payloadFromState: sourceReviewPayloadFor('shipments') } },
      { title: 'นำเข้ารายการบิล', detail: 'เพิ่มยอดเรียกเก็บและจับคู่กับหมายเลขจัดส่งจากไฟล์แรก', actorId: 'practice-owner', command: { type: 'practice.importSample', payload: { sampleId: 'invoice-lines' } } },
      { title: 'ตรวจรายการบิล', detail: 'ยืนยันยอดและสกุลเงินก่อนนำไปเทียบกับราคา', actorId: 'practice-owner', command: { type: 'invoice.reviewSource', payload: {}, payloadFromState: sourceReviewPayloadFor('invoice') } },
      { title: 'เพิ่มตารางตรวจยอด', detail: 'เปิดวัตถุตารางเพื่อดูผลจากไฟล์สองชุดที่นำเข้าแล้ว', actorId: 'practice-owner', command: { type: 'practice.addObject', payload: { id: 'invoice.table' } } },
      { title: 'นำเข้าบัตรราคา', detail: 'เพิ่มหลักฐานราคาจำลองในสถานะรอตรวจ โดยยังไม่เปิดใช้กฎใด', actorId: 'practice-owner', command: { type: 'practice.importSample', payload: { sampleId: 'invoice-rate-card' } } },
      { title: 'ตรวจบัตรราคา', detail: 'ยืนยันเอกสารราคาก่อนนำช่วงวันที่และอัตราไปสร้างร่างกฎ', actorId: 'practice-owner', command: { type: 'invoice.reviewSource', payload: {}, payloadFromState: sourceReviewPayloadFor('rate-card') } },
      { title: 'เพิ่มวัตถุกฎราคา', detail: 'เปิดพื้นที่ตรวจและแก้ช่วงวันที่กับองค์ประกอบราคา', actorId: 'practice-owner', command: { type: 'practice.addObject', payload: { id: 'invoice.rules' } } },
      { title: 'ร่างกฎจากบัตรราคา', detail: 'สร้างร่างราคาเริ่มต้นและน้ำหนักส่วนเพิ่มจากแถวในเอกสาร โดยยังไม่เปิดใช้', actorId: 'practice-owner', command: { type: 'evolve.propose', payload: {}, payloadFromState: rateCardOperations } },
      { title: 'จำลองผลก่อนและหลัง', detail: 'ดูผลกระทบของชุดกฎต่อสี่รายการโดยยังไม่เปลี่ยนกฎที่ใช้งานอยู่', actorId: 'practice-owner', command: { type: 'evolve.simulate', payload: {} } },
      { title: 'ตรวจข้อเสนอ', detail: 'ตรวจความครบถ้วนของร่างกฎกับข้อมูลและหลักฐานบนโต๊ะ', actorId: 'practice-owner', command: { type: 'evolve.validate', payload: {} } },
      { title: 'อนุมัติกฎ', detail: 'บันทึกการอนุมัติสำหรับข้อเสนอและผลตรวจชุดนี้', actorId: 'practice-owner', command: { type: 'evolve.approve', payload: {} } },
      { title: 'เปิดใช้กฎที่อนุมัติ', detail: 'เริ่มคำนวณด้วยกฎที่ผ่านการตรวจและอนุมัติแล้ว', actorId: 'practice-owner', command: { type: 'evolve.activate', payload: {} } },
      { title: 'บันทึกผลตรวจยอด', detail: 'จัดเก็บผลรวมที่คำนวณจากไฟล์นำเข้าและกฎที่เปิดใช้งาน', actorId: 'practice-owner', command: { type: 'invoice.saveRun', payload: {} } },
      { title: 'เพิ่มประวัติบน Canvas', detail: 'เปิดประวัติคำสั่งทั้งหมดในแท็บนี้ รวมถึงการแก้ไขที่ลองด้วยตัวเอง', actorId: 'practice-owner', command: { type: 'practice.addObject', payload: { id: 'workspace.history' } } },
    ],
  },
  {
    id: 'teaching-physics',
    title: 'ทดลองแรงและมวล',
    kind: 'teaching',
    persona: 'ครูเมย์ · ฟ้า · ต้น',
    goal: 'นำเข้าค่าบทเรียนร่วม ดูการคำนวณใหม่ และให้ผู้เรียนตอบแยกกัน',
    challenge: 'เมื่อครูเปลี่ยนแรงและมวล คำตอบใหม่ควรได้ตำแหน่งเท่าไร และผู้เรียนเห็นข้อมูลของใครบ้าง?',
    steps: [
      { title: 'นำเข้าบทเรียนแรงและมวล', detail: 'อ่านค่าแรง มวล และเวลาเข้าบทเรียนร่วม แล้วคำนวณตำแหน่งจากค่าที่อ่านได้', actorId: 'practice-teacher', command: { type: 'practice.importSample', payload: { sampleId: 'teaching-physics' } } },
      { title: 'เพิ่มกฎของบทเรียน', detail: 'เปิดที่แก้ค่าร่วมของครู ก่อนที่ผู้เรียนจะเริ่มตอบ', actorId: 'practice-teacher', command: { type: 'practice.addObject', payload: { id: 'lesson.rules' } } },
      { title: 'เพิ่มฉากรถทดลอง', detail: 'เปิดฉากที่แสดงแรง มวล เวลา และตำแหน่งจากบทเรียนเดียวกัน', actorId: 'practice-teacher', command: { type: 'practice.addObject', payload: { id: 'lesson.scene' } } },
      { title: 'เพิ่มกราฟตำแหน่ง', detail: 'เพิ่มกราฟที่คำนวณจากค่าบทเรียนชุดเดียวกัน', actorId: 'practice-teacher', command: { type: 'practice.addObject', payload: { id: 'lesson.graph' } } },
      { title: 'เลือกกราฟให้ฟ้า', detail: 'ตั้งมุมมองกราฟขั้นสูงให้ฟ้าผ่านคำสั่งของครู', actorId: 'practice-teacher', command: { type: 'teaching.setRepresentation', payload: { actorId: 'practice-learner-1', representation: 'graph', difficulty: 'advanced' } } },
      { title: 'เพิ่มโจทย์และคำตอบ', detail: 'เปิดพื้นที่คำถามก่อนให้ผู้เรียนแต่ละคนส่งคำตอบของตัวเอง', actorId: 'practice-teacher', command: { type: 'practice.addObject', payload: { id: 'lesson.question' } } },
      { title: 'ครูบันทึกหมายเหตุส่วนตัว', detail: 'เก็บข้อความที่ปรากฏเฉพาะในมุมมองของครู', actorId: 'practice-teacher', command: { type: 'teaching.saveNote', payload: {}, payloadFromState: (state) => state.kind === 'teaching' ? { text: `คำตอบอ้างอิง: ${calculatePhysics(state.parameters).position} เมตร` } : {} } },
      { title: 'ฟ้าส่งคำตอบ', detail: 'คำตอบคำนวณจากค่าบทเรียนที่นำเข้าจริง', actorId: 'practice-learner-1', command: { type: 'teaching.answer', payload: {}, payloadFromState: (state) => currentLessonAnswer(state, 0) } },
      { title: 'ต้นส่งคำตอบ', detail: 'คำตอบของต้นถูกบันทึกแยกจากคำตอบของฟ้า', actorId: 'practice-learner-2', command: { type: 'teaching.answer', payload: {}, payloadFromState: (state) => currentLessonAnswer(state, 2) } },
      { title: 'ต้นลองแก้ค่าบทเรียน', detail: 'ผู้เรียนไม่มีสิทธิ์แก้ค่าร่วมของครู คำตอบเดิมจึงยังอยู่ครบ', actorId: 'practice-learner-2', command: { type: 'teaching.setParameters', payload: { force: 12, mass: 3, time: 2 } }, expectedOutcome: 'rejected', expectedErrorCode: 'FORBIDDEN' },
      { title: 'เพิ่มประวัติบน Canvas', detail: 'เปิดประวัติคำสั่งทั้งหมดในแท็บนี้ รวมถึงคำตอบและการแก้ไขที่ลองด้วยตัวเอง', actorId: 'practice-teacher', command: { type: 'practice.addObject', payload: { id: 'workspace.history' } } },
    ],
  },
  {
    id: 'encounter-shield',
    title: 'ช่วยเพื่อนด้วยโล่',
    kind: 'encounter',
    persona: 'DM · Mira · Pip',
    goal: 'อ่านแผนกติกาป้องกัน แล้วทดลองใช้กับการโจมตีในลำดับเกม',
    challenge: 'โล่ลดความเสียหายให้เป้าหมายได้เท่าไร และผู้เล่นเสีย AP เท่าไร?',
    steps: [
      { title: 'นำเข้าแผนโล่ป้องกัน', detail: 'อ่านเป้าหมายและเงื่อนไขโล่จากไฟล์ แล้วสร้างร่างที่ยังไม่เปิดใช้', actorId: 'practice-dm', command: { type: 'practice.importSample', payload: { sampleId: 'encounter-shield' } } },
      { title: 'เพิ่มกระดานเผชิญหน้า', detail: 'เปิดกระดานที่แสดงตัวละคร เทิร์น และผลจากกฎปัจจุบัน', actorId: 'practice-dm', command: { type: 'practice.addObject', payload: { id: 'encounter.board' } } },
      { title: 'จำลองกติกาโล่', detail: 'ตรวจผลก่อนเปิดใช้กติกาที่นำเข้ามา', actorId: 'practice-dm', command: { type: 'evolve.simulate', payload: {} } },
      { title: 'ตรวจข้อเสนอโล่', detail: 'ตรวจข้อเสนอภายใต้สถานะ encounter ปัจจุบัน', actorId: 'practice-dm', command: { type: 'evolve.validate', payload: {} } },
      { title: 'อนุมัติกติกาโล่', detail: 'บันทึกการอนุมัติก่อนเริ่มการโจมตี', actorId: 'practice-dm', command: { type: 'evolve.approve', payload: {} } },
      { title: 'เปิดใช้กติกาโล่', detail: 'ใช้กฎป้องกันที่ผ่าน lifecycle แล้ว', actorId: 'practice-dm', command: { type: 'evolve.activate', payload: {} } },
      { title: 'เพิ่มเครื่องมือการกระทำ', detail: 'เปิดเครื่องมือเลือกการโจมตีและปฏิกิริยา', actorId: 'practice-dm', command: { type: 'practice.addObject', payload: { id: 'encounter.actions' } } },
      { title: 'Goblin ประกาศโจมตี', detail: 'เริ่มปฏิกิริยาต่อการโจมตีเป้าหมายจากไฟล์แผน', actorId: 'practice-dm', command: { type: 'encounter.declareHit', payload: {}, payloadFromState: currentEncounterTarget } },
      { title: 'Mira ยกโล่ให้เพื่อน', detail: 'Mira ใช้ AP เพื่อป้องกันเป้าหมายตามกฎที่เปิดใช้งาน', actorId: 'practice-mira', command: { type: 'encounter.shield', payload: {}, payloadFromState: currentEncounterTarget } },
      { title: 'DM ตัดสินผลการโจมตี', detail: 'โดเมนคำนวณความเสียหายหลังลดจากโล่และอัปเดต HP/AP', actorId: 'practice-dm', command: { type: 'encounter.resolve', payload: {} } },
      { title: 'เพิ่มประวัติบน Canvas', detail: 'เปิดบันทึกการเคลื่อนไหวและคำสั่งของโต๊ะทดลองนี้', actorId: 'practice-dm', command: { type: 'practice.addObject', payload: { id: 'workspace.history' } } },
    ],
  },
] as const satisfies readonly PracticeScenarioDefinition[];

export type PracticeScenario = (typeof PRACTICE_SCENARIOS)[number];
export type PracticeScenarioStep = PracticeScenario['steps'][number];
