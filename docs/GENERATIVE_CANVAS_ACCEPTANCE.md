# Generative Canvas acceptance

Candidate: `feat/F005-generative-canvas` · Node `22.23.2` · 2026-10-20

สถานะ: local acceptance ผ่าน พร้อม review ใน [PR #24](https://github.com/Thanyers/tabletop/pull/24) ยังไม่อนุมัติ release และไม่ได้ deploy candidate นี้ไป staging หรือ production

## ขอบเขต

ทดสอบ local Worker/D1/Room/Billing กับข้อมูลสมมติ บัญชีและ session จำลองทั้งหมด; แยก provider จำลองที่ทำซ้ำได้ใน CI ออกจากการเรียก AI จริงแบบ opt-in

โจทย์หลักคือคิวร้านกาแฟ, แสงและเงา, และการแบ่งน้ำแบบผลัดกันเล่น พร้อมโจทย์คำนวณเงินกู้ที่ใช้สูตรใหม่เพื่อทดสอบนอก catalog เดิม ตรวจการสร้างจากไฟล์และ prompt, ทดลองร่างส่วนตัว, เปิดใช้, กด/ลาก/ปรับค่า, แก้เครื่องมือโดยเก็บข้อมูลเดิม, สอง actor, shared layout และกลับเข้าห้อง

## ผลตรวจ

| ชุดตรวจ | ที่เก็บผล local | สถานะ |
| --- | --- | --- |
| Unit/SQL และขอบเขต interpreter | `test-results/unit-report.json` | PASS 354/354 หลังรวม dev ถึง `3276276` |
| Worker/D1/Room/Billing | `test-results/cloudflare-report.json` | PASS 71/71 |
| Component Lab เดิม | `node --import tsx --test scripts/component-lab/component-lab.test.ts` | PASS 7/7 |
| Node browser regression | `test-results/tabletop-r1/report.json` | PASS 7/7 |
| Worker browser regression | `test-results/cloudflare-browser/report.json` | PASS 20/20 รวม `/new`, Actions หลังแก้กฎ และ desktop/narrow viewport |
| Generative browser, provider จำลอง | `test-results/generative-canvas/report.json` | PASS 4 เรื่อง, 8 drafts รวมการซูม/ลากระหว่างรอ focus; ไม่มี browser error หรือ external request |
| Generative browser, provider จริง | `test-results/generative-live-{cafe,shadow,water}/report.json` | PASS ทั้งสามเรื่องบน build ล่าสุด; shadow ตรวจ endpoint ของภาพและสูตรก่อน/หลัง action และลากจริง |
| Lint | `test-results/lint-report.json` | PASS 0 errors; 104 warnings ของ candidate ยังไม่ได้เคลียร์ทั้ง repo |
| Typecheck / app build / Worker bundle | `npm run build`, `npm run build:cloudflare` | PASS; Worker เป็น dry run |
| Publication / browser secret boundary | `node scripts/check-public-files.mjs`, `node scripts/check-client-secrets.mjs` | PASS 486 source files / 136 browser assets; ไม่พบ high-confidence pattern ที่ scanner ตรวจ |
| เอกสาร | local Markdown target check, `git diff --check` | PASS 170 local links ในเอกสารใช้งาน/ส่งต่อที่แก้; ไม่มี whitespace error |
| Independent review | ตรวจ source candidate และ regression | ปิดข้อค้นพบปุ่มกดซ้ำ, actor-specific output bounds และ pending focus ทับการซูมแล้ว; ไม่มี material finding ค้างในขอบเขตที่ตรวจ |

โค้ดแอปที่ตรวจคือ `8705bd9` (Node `22.23.2`); การแก้หลัง commit นี้เป็นเอกสาร, การเก็บหลักฐานเดิม และ live acceptance ที่รอ geometry ของการ์ด/ตรวจสูตรภาพเพิ่ม โดยไม่ได้แก้ runtime รวม `dev` ถึง `6cf0244` ที่บันทึก release v1.1.0 แล้วและคง F005 ไว้ใน Unreleased ผลและภาพใน `test-results/` เป็นหลักฐานในเครื่องที่ไม่ commit; CI เก็บเฉพาะผล fixture จำลองเป็น artifacts ไม่มี credential หรือประวัติผู้ใช้จริงใน repo ผล CI ของ PR ต้องตรวจบน head ล่าสุดแยกจากผล local นี้

## สิ่งที่วัดจากการใช้งาน

| เรื่อง | การลงมือใช้และผลอิสระที่ตรวจ |
| --- | --- |
| ร้านกาแฟ | แนบไฟล์ให้ AI สร้างคิว กดจบ espresso แล้ว tea ได้เวลารวม 3 → 8; ขอ AI เพิ่มการ์ดนับงานค้าง ได้ศูนย์โดยข้อมูลที่จบแล้วยังอยู่ |
| แสงและเงา | เริ่มจาก prompt; สูตร geometry ให้พิกัดปลายเงาที่พื้น 80 → 70 เมื่อขยับแหล่งกำเนิดแสง แล้วลากวัตถุจริงให้ server บันทึกตำแหน่งและคำนวณใหม่ ตรวจทั้ง metric และ endpoint ของ scene เทียบสูตรอิสระ |
| เกมแบ่งน้ำ | สอง actor ผลัดกันส่งน้ำ 20 และ 15; ตรวจน้ำคงเหลือ 65 น้ำที่ส่งแล้ว 35 ผลรวม 100 และเปิดกลับมาค่าเดิม |
| สูตรเงินกู้ | ชุด fixture แยกจากสามเรื่องหลัก ใช้สูตรดอกเบี้ยและการกดซ้ำ ตรวจผลและการแก้ร่างเพิ่มการ์ดโดยไม่แก้ interpreter ตามชื่อเรื่อง |

ชุด fixture ทั้งสี่เรื่องตรวจการทดลองร่างส่วนตัวด้วย: กด/ลาก/ปรับค่าและ reset สำเนาได้ โดยไม่มี `table.act` ไปยังห้องจริง และ active program, records, revision, candidate เดิมไม่เปลี่ยน

การรัน AI จริงเก็บทั้งผลสำเร็จและผลล้มเหลวไว้ รวมข้อผิดพลาด contract ที่ต้องปรับคำแนะนำ/ข้อความ validation, ความต่างของชื่อ object, การชนเพดานหกคำขอของรอบรวม และกฎแบ่งน้ำที่อ่านยอดของทีมแรกแทนทีมที่เลือก จึงเพิ่มคำแนะนำการใช้ selected record และตรวจผลสองตาต่อเนื่อง

รอบแสง–เงาพบด้วยว่าตัวเลขถูกแต่เส้นเงาใช้พิกัดผิด จึงระบุความสัมพันธ์ใน prompt และเพิ่ม oracle ของ scene ก่อน/หลังการเปลี่ยนค่า ส่วน pointer test ต้องรอขนาด/ตำแหน่งการ์ดนิ่งและตรวจว่า hit วัตถุจริง ไม่ใช้ force-click หรือแก้ output ของโมเดลแทน ผลสามเรื่องจากรอบรวมและรอบแยกไม่ใช่ first-attempt success rate และไม่ใช่ผล hidden evaluation

การผ่าน schema/type/limits ยืนยันว่าร่างอยู่ใน contract ไม่ได้พิสูจน์ว่ากฎตรงความหมายธุรกิจทั้งหมด ผู้ใช้ยังต้องลองร่างและตรวจผลก่อนเปิดใช้; browser acceptance ใช้ผลคำนวณอิสระ ไม่ให้โมเดลเป็นผู้ตัดสินคำตอบของตัวเอง

## สิ่งที่ยังไม่ยืนยัน

Google สองบัญชีจริงของ candidate นี้, สองอุปกรณ์/นิ้วบนโทรศัพท์จริง, hosted Workers Free CPU/latency, load/soak, full accessibility audit, การกู้ D1 + Room + Billing ทั้งระบบ และ development/hidden evaluation 20 โจทย์ × 3 trials ตามแผนก่อนเปิด beta ทั่วไป

การค้นบทสนทนาจำกัด 100 รายการล่าสุดในห้อง/epoch/ผู้ถามเดียวกัน และส่งไม่เกิน 6 คู่/16 KiB; ไม่ใช่ความจำไม่จำกัด ไม่มี schema migration, shared simulation clock, arbitrary JavaScript sandbox หรือ image generation ในรอบนี้

ดู [runtime](GENERATIVE_CANVAS_RUNTIME.md) สำหรับวิธีใช้ contract และขอบเขต recovery; ใช้ [DEPLOYMENTS](DEPLOYMENTS.md) ตรวจรุ่นที่ขึ้นจริง
