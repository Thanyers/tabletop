import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Publish only this reviewed synthetic recording. Never use latest.json or hosted history.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const archive = 'handoff/Final/auto-demo/0926de9d-b570-4229-a6a9-3e10f5e2d7d8/run.json';
const expectedSha256 = '1137b7b657c058bfd40c34dd56fe9686ab0cf6d50d53dfeba4f25008536bc864';
const output = resolve(root, 'src/tabletop/demo/data.ts');
const args = process.argv.slice(2);
assert(args.length === 0 || args.length === 1 && args[0] === '--check', 'Use only --check or no arguments.');

// Public copy explains the observed outcome; it does not expose test harness internals.
const copy = {
  'invoice-evidence-gaps': {
    title: 'บิลที่ยังขาดหลักฐาน',
    prompt: 'ยอดไหนตรวจได้แล้ว และยังต้องขอเอกสารอะไรเพิ่ม?',
    outcome: 'แยกยอดที่ตรวจได้ 85 บาท ออกจากอีก 2 รายการที่ยังขาดอัตราค่าพื้นที่ห่างไกล',
    steps: [
      ['บันทึกยอดจากหลักฐานที่มี', 'เก็บยอดที่คำนวณได้ไว้ พร้อมระบุรายการที่ยังสรุปไม่ได้'],
      ['กลับมาเปิดผลที่บันทึก', 'ยังเห็นยอดที่ทราบ 85 บาท ผลต่าง 5 บาท และ 2 รายการที่ต้องขอหลักฐานเพิ่ม'],
    ],
  },
  'invoice-dated-rule-lifecycle': {
    title: 'อัตราที่ใช้ได้เฉพาะช่วงวันที่',
    prompt: 'กำหนดช่วงวันที่ของอัตราให้ตรงกับหลักฐาน แล้วค่อยนำไปตรวจบิล',
    outcome: 'เปิดกติกาใหม่หลังจำลอง ตรวจ และอนุมัติ พร้อมบันทึกและส่งออกผลที่ยังแสดงหลักฐานที่ขาด',
    steps: [
      ['เสนอช่วงวันที่ของอัตรา', 'สร้างร่างจากกติกาและหลักฐานตัวอย่างที่ตรวจแล้ว กติกาที่ใช้อยู่ยังไม่เปลี่ยน'],
      ['จำลองก่อนเปิดใช้', 'ดูผลที่คาดว่าจะเปลี่ยนโดยยังใช้กติกาเดิม'],
      ['ตรวจร่างกติกา', 'ร่างผ่านการตรวจช่วงวันที่และข้อกำหนดของการคำนวณ'],
      ['เจ้าของอนุมัติร่าง', 'อนุมัติเฉพาะร่างที่เพิ่งตรวจแล้ว'],
      ['เปิดใช้ช่วงวันที่ใหม่', 'กติกาเปลี่ยนเป็นเวอร์ชัน 1 หลังผ่านขั้นตอนอนุมัติ'],
      ['บันทึกผลตรวจบิล', 'อีก 2 รายการยังขาดอัตราพื้นที่ห่างไกล การแก้ช่วงวันที่ไม่ได้เติมหลักฐานที่ไม่มี'],
      ['ส่งออกผลเป็น CSV', 'เจ้าของได้รับไฟล์ผลตรวจที่มีรหัสรายการขนส่ง'],
    ],
  },
  'invoice-overlap-and-retry': {
    title: 'กติกาซ้อนและการกดซ้ำ',
    prompt: 'ถ้าอัตราซ้อนกันหรือกดบันทึกซ้ำ ระบบควรจัดการอย่างไร?',
    outcome: 'กติกาที่ซ้อนกันไม่ผ่านการตรวจ และการส่งคำสั่งเดิมซ้ำไม่เพิ่มผลบันทึกอีกชุด',
    steps: [
      ['เสนออัตราที่ซ้อนช่วงเดิม', 'เก็บเป็นร่างเพื่อตรวจข้อขัดแย้งก่อนเปิดใช้'],
      ['จำลองร่างที่มีข้อขัดแย้ง', 'เก็บผลจำลองสำหรับการตรวจร่าง'],
      ['พบว่ากติกาซ้อนกัน', 'ร่างไม่ผ่านการตรวจ กติกาที่ใช้อยู่ยังเป็นเวอร์ชันเดิม'],
      ['บันทึกผลครั้งแรก', 'ระบบบันทึกผลหนึ่งชุดและเก็บหลักฐานว่ารับคำสั่งแล้ว'],
      ['ลองส่งคำสั่งเดิมอีกครั้ง', 'ระบบตอบผลจากคำสั่งเดิม'],
      ['กลับมาตรวจจำนวนผลบันทึก', 'ยังมีผลใหม่เพียงหนึ่งชุด ไม่มีการเพิ่มเวอร์ชันซ้ำ'],
      ['ใช้คำสั่งเดิมแต่เปลี่ยนข้อมูล', 'ระบบปฏิเสธข้อมูลที่ขัดกับคำสั่งซึ่งรับไปแล้ว'],
      ['ตรวจผลหลังการปฏิเสธ', 'จำนวนผลบันทึกและเวอร์ชันยังเท่าเดิม'],
    ],
  },
  'teaching-private-experiments': {
    title: 'โจทย์ร่วม คำตอบแยกคน',
    prompt: 'สอนฟ้าและต้นด้วยโจทย์เดียวกัน ให้ฟ้าดูกราฟขั้นสูง และเก็บคำตอบแยกกัน',
    outcome: 'ครูเห็นคำตอบทั้งสองคน ผู้เรียนเห็นเฉพาะคำตอบของตน และการตั้งมุมมองให้ฟ้าไม่ส่งไปถึงต้น',
    steps: [
      ['ครูตั้งโจทย์ให้ทั้งห้อง', 'แรง 10 นิวตัน มวล 5 กิโลกรัม และเวลา 2 วินาที ให้ตำแหน่ง 4 เมตร'],
      ['เลือกกราฟขั้นสูงให้ฟ้า', 'เปลี่ยนวิธีแสดงของฟ้าโดยไม่เปลี่ยนค่าของบทเรียนร่วม'],
      ['ตรวจมุมมองของทั้งสองคน', 'ฟ้าได้รับการตั้งค่ากราฟขั้นสูง ส่วนต้นไม่ได้รับการตั้งค่าของฟ้า'],
      ['ครูจดหมายเหตุส่วนตัว', 'บันทึกสำหรับครูถูกซ่อนจากผู้เรียน'],
      ['ฟ้าส่งคำตอบ', 'ฟ้าเห็นคำตอบของตัวเอง โดยไม่มีหมายเหตุส่วนตัวของครู'],
      ['ต้นส่งคำตอบ', 'ต้นเห็นเฉพาะคำตอบของตัวเอง'],
      ['เปิดดูผลจากทุกมุมมองอีกครั้ง', 'ครูเห็นคำตอบ 2 รายการ ส่วนฟ้าและต้นยังเห็นเฉพาะคำตอบของตนเอง'],
    ],
  },
  'teaching-stale-and-role-guards': {
    title: 'กลับมาตอบโจทย์เก่า',
    prompt: 'ต้นเปิดโจทย์ค้างไว้ แล้วครูเปลี่ยนโจทย์ก่อนที่ต้นจะส่งคำตอบ',
    outcome: 'คำตอบของโจทย์เก่าถูกปฏิเสธ และผู้เรียนเปลี่ยนค่าบทเรียนของครูไม่ได้',
    steps: [
      ['ครูเปลี่ยนโจทย์', 'บทเรียนได้โจทย์ใหม่และกติกาเวอร์ชันใหม่'],
      ['ต้นส่งคำตอบของโจทย์เก่า', 'ระบบให้โหลดโจทย์ปัจจุบันก่อนตอบใหม่'],
      ['ต้นลองแก้ค่าบทเรียน', 'ระบบปฏิเสธ เพราะผู้เรียนไม่มีสิทธิ์เปลี่ยนบทเรียนร่วม'],
    ],
  },
  'teaching-invalid-physics': {
    title: 'มวลศูนย์ที่คำนวณไม่ได้',
    prompt: 'ถ้าครูใส่มวลเป็นศูนย์ บทเรียนเดิมจะเสียหรือไม่?',
    outcome: 'ค่าที่ไม่ถูกต้องถูกปฏิเสธ แล้วเปิดอ่านใหม่ยังได้บทเรียนเดิมและตำแหน่ง 10 เมตร',
    steps: [
      ['ลองใส่มวลเป็นศูนย์', 'ระบบปฏิเสธค่าที่ใช้คำนวณไม่ได้'],
      ['กลับมาตรวจบทเรียน', 'แรงยังเป็น 10 นิวตัน มวล 2 กิโลกรัม เวลา 2 วินาที และตำแหน่ง 10 เมตร'],
    ],
  },
  'encounter-ally-shield': {
    title: 'ช่วยเพื่อนด้วยโล่',
    prompt: 'ให้ Mira ใช้โล่ช่วย Pip โดยใช้ 1 AP และทำได้ครั้งเดียวต่อเทิร์น',
    outcome: 'หลังเปิดกติกาและตัดสินการโจมตี Pip เหลือ 8 HP ส่วน Mira เหลือ 1 AP',
    steps: [
      ['เสนอให้ใช้โล่ช่วยเพื่อน', 'ร่างกติกาถูกสร้าง แต่กติกาที่ใช้อยู่ยังไม่เปลี่ยน'],
      ['จำลองผลของกติกา', 'ดูผลจำลองก่อนนำไปใช้ในฉาก'],
      ['ตรวจความถูกต้อง', 'ร่างผ่านการตรวจข้อกำหนดและผลจำลอง'],
      ['ผู้คุมเกมอนุมัติ', 'อนุมัติร่างที่ผ่านการตรวจล่าสุด'],
      ['เปิดใช้กติกาโล่', 'กติกาเวอร์ชัน 1 เริ่มใช้งาน'],
      ['Goblin เตรียมโจมตี Pip', 'เปิดช่วงให้ผู้เล่นตอบโต้ ก่อนตัดสินผลการโจมตี'],
      ['ดูสิ่งที่ Mira มองเห็น', 'ผลทอยและความเสียหายที่ผู้คุมเกมยังไม่เปิดเผยถูกซ่อนไว้'],
      ['Mira เลือกป้องกัน Pip', 'รับการใช้โล่ไว้เพื่อใช้ตอนตัดสินผล'],
      ['ผู้คุมเกมตัดสินการโจมตี', 'Pip เสีย 2 HP และ Mira ใช้ 1 AP สำหรับการป้องกัน'],
    ],
  },
  'encounter-pause-and-roles': {
    title: 'พักเกมแล้วกลับมาเล่นต่อ',
    prompt: 'หยุดฉากไว้ระหว่างตอบโต้ และให้เฉพาะผู้คุมเกมสั่งเล่นต่อ',
    outcome: 'ตัดสินผลระหว่างพักไม่ได้ ผู้เล่นสั่งเล่นต่อเองไม่ได้ และผู้คุมเกมกลับมาตัดสินผลเดิมได้',
    steps: [
      ['เริ่มการโจมตี Mira', 'การโจมตีรอการตอบโต้จากผู้เล่น'],
      ['ผู้คุมเกมหยุดฉาก', 'เก็บการโจมตีที่ยังค้างอยู่ไว้ขณะพัก'],
      ['ลองตัดสินผลระหว่างพัก', 'ระบบปฏิเสธคำสั่งขณะฉากยังหยุดอยู่'],
      ['Mira ลองสั่งเล่นต่อ', 'ระบบปฏิเสธ เพราะต้องเป็นผู้คุมเกมที่สั่งเล่นต่อ'],
      ['ผู้คุมเกมสั่งเล่นต่อ', 'การโจมตีเดิมยังอยู่ให้ดำเนินต่อ'],
      ['ตัดสินการโจมตีที่ค้างไว้', 'การโจมตีจบลงและ Mira เหลือ 6 HP'],
    ],
  },
  'teaching-expired-approval': {
    title: 'คำอนุมัติที่หมดอายุ',
    prompt: 'ครูกลับมาเปิดร่างที่อนุมัติไว้นานแล้ว ต้องทบทวนอะไรใหม่บ้าง?',
    outcome: 'คำอนุมัติเก่าเปิดใช้ไม่ได้ ครูจึงจำลอง ตรวจ และอนุมัติใหม่ก่อนเปลี่ยนบทเรียน',
    steps: [
      ['เสนอการเปลี่ยนบทเรียน', 'สร้างร่างจากบทเรียนที่ใช้อยู่'],
      ['จำลองร่าง', 'บันทึกผลจำลองโดยไม่เปลี่ยนบทเรียนร่วม'],
      ['ตรวจร่าง', 'ร่างผ่านการตรวจความถูกต้อง'],
      ['ครูอนุมัติร่าง', 'เก็บคำอนุมัติสำหรับร่างนี้'],
      ['จำลองว่าคำอนุมัติหมดอายุ', 'ตัวอย่างนี้กำหนดให้คำอนุมัติหมดเวลา เพื่อสาธิตขั้นตอนทบทวน'],
      ['ลองเปิดใช้ด้วยคำอนุมัติเก่า', 'ระบบปฏิเสธคำอนุมัติที่หมดอายุ'],
      ['เสนอร่างใหม่', 'เริ่มทบทวนการเปลี่ยนแปลงกับบทเรียนปัจจุบันอีกครั้ง'],
      ['จำลองใหม่', 'สร้างผลจำลองจากร่างปัจจุบัน'],
      ['ตรวจใหม่', 'ร่างปัจจุบันผ่านการตรวจความถูกต้อง'],
      ['ครูอนุมัติอีกครั้ง', 'ออกคำอนุมัติใหม่หลังตรวจครบ'],
      ['เปิดใช้บทเรียนใหม่', 'กติกาเป็นเวอร์ชัน 1 มวลเปลี่ยนเป็น 5 กิโลกรัม และตำแหน่งเป็น 4 เมตร'],
    ],
  },
};

function numbers(input, names) {
  assert(input && typeof input === 'object' && !Array.isArray(input));
  return Object.fromEntries(names.filter(key => input[key] !== undefined).map(key => {
    assert.equal(typeof input[key], 'number');
    assert(Number.isFinite(input[key]));
    return [key, input[key]];
  }));
}
function checkpoint(input) {
  if (!input) return undefined;
  const result = numbers(input, ['ruleRevision', 'dataRevision']);
  if (input.totals) result.totals = numbers(input.totals, ['expectedSatang', 'deltaSatang', 'unknownCount']);
  if (input.physics) result.physics = numbers(input.physics, ['force', 'mass', 'time', 'acceleration', 'velocity', 'position']);
  if (input.characters) result.characters = input.characters.map(character => {
    assert(['Mira', 'Pip'].includes(character.name));
    return { name: character.name, ...numbers(character, ['hp', 'ap']) };
  });
  if (input.privateFieldsHidden !== undefined) {
    assert.equal(typeof input.privateFieldsHidden, 'boolean');
    result.privateFieldsHidden = input.privateFieldsHidden;
  }
  return result;
}

const bytes = await readFile(resolve(root, archive));
assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha256, 'Only the reviewed archive may be published.');
const run = JSON.parse(bytes);
assert.equal(run.identity, 'synthetic');
assert.equal(run.runtime, 'local-cloudflare');
assert.equal(run.ai, 'not-used');
assert.equal(run.productionMutations, 0);
assert.equal(run.status, 'passed');
assert.equal(run.scenarios.length, 9);
assert.deepEqual(run.scenarios.map(s => s.id).sort(), Object.keys(copy).sort());
const catalog = {
  schemaVersion: 1,
  recordedAt: run.finishedAt,
  scenarios: run.scenarios.map(scenario => {
    const wording = copy[scenario.id];
    assert.equal(scenario.status, 'passed');
    assert.equal(scenario.steps.length, wording.steps.length);
    assert(['invoice', 'teaching', 'encounter'].includes(scenario.domain));
    return {
      id: scenario.id, title: wording.title, domain: scenario.domain,
      persona: { name: scenario.persona.name, role: scenario.persona.role, goal: wording.prompt },
      prompt: wording.prompt, outcome: wording.outcome,
      steps: scenario.steps.map((step, index) => {
        assert(['passed', 'expected-rejection'].includes(step.status));
        assert(step.checks.every(check => check.passed === true));
        return {
          id: `${scenario.id}-${index + 1}`,
          title: wording.steps[index][0], actor: step.actor === 'local test harness' ? 'เวลาจำลอง' : step.actor, description: wording.steps[index][1],
          outcome: step.status === 'expected-rejection' ? 'expected-rejection' : 'recorded',
          checkpoint: checkpoint(step.checkpoint),
        };
      }),
    };
  }),
};
const source = `// Generated by scripts/generate-public-demo.mjs from the reviewed synthetic archive.\n// Do not replace this with live rooms, hosted history, or latest test output.\nimport type { PublicDemoCatalog } from './types';\n\nexport const publicDemo: PublicDemoCatalog = ${JSON.stringify(catalog, null, 2)};\n`;
if (args[0] === '--check') {
  const current = (await readFile(output, 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(current, source, 'Public demo data drifted from its reviewed projection. Regenerate explicitly.');
} else await writeFile(output, source, 'utf8');
console.log(JSON.stringify({ publicDemo: args[0] === '--check' ? 'verified' : 'generated', scenarios: catalog.scenarios.length, steps: catalog.scenarios.reduce((n, s) => n + s.steps.length, 0), liveDataIncluded: false }));
