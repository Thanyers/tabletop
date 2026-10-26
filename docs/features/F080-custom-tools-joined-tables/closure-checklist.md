# F080 — closure checklist (what only a person can finish)

สถานะ ณ 2026-10-26: **26 PASS / 9 UNVERIFIED** จาก 35 ข้อบน `feat/F080-custom-tools` (PR #305, draft)

ทุกข้อที่ยัง UNVERIFIED ติดเงื่อนไขที่ agent ทำแทนไม่ได้ เอกสารนี้บอกว่าต้องทำอะไรจึงจะปิดได้

## 1. AI จริง (G1-01, EXEC-01, EDIT-01)

**ต้องมี:** provider key ของโมเดลที่ทีมใช้ (ไม่เก็บในไฟล์ที่ track — ใช้ environment ของ dev)

**ขั้น:**
1. ตั้ง env ให้ dev runtime (เช่น `MODEL_API_KEY` + ชื่อโมเดล) ที่เครื่อง dev เท่านั้น
2. รัน authoring ผ่าน `/space` หรือสคริปต์ด้วย `route.kind = 'ai'` + budget ที่อนุมัติ (D-023: 3 runs × ≤6 calls, ≤USD 0.20/run)
3. เก็บหลักฐาน: จำนวน call, usd ที่ใช้จริง, ผล activation record (generator/requester/reviewer) และ readback
4. บันทึกผลใน `acceptance.json` ของทั้งสามข้อพร้อม SHA ของ dev runtime

**ห้าม:** ใช้ key กับ production, เก็บ key ใน repo

## 2. UI ที่ต้องมี session จริง (VISUAL-01, IMPACT-01)

**ต้องมี:** บัญชีที่ลงชื่อเข้าใช้ได้ (Google OAuth) บน dev server

**ขั้น:**
1. `npm run build` แล้ว `npm run dev:cloudflare` (พอร์ต 8787 หรืออื่นที่ว่าง)
2. ลงชื่อเข้าใช้ สร้างโต๊ะ แล้วสร้าง collaboration space ผ่าน command/API (ยังไม่มีปุ่มใน UI)
3. เปิด `/s/:id` — ตรวจว่า: 3 คอลัมน์บนจอกว้าง, ยุบเป็น 1 คอลัมน์บนมือถือ, เลือกโต๊ะด้วยคีย์บอร์ดได้, recap/impact แสดงค่าตรงกับ API
4. เก็บ screenshot + บันทึกผลใน `acceptance.json`

**หมายเหตุ:** `/s/:id` ตอบ 200 แล้วบน dev (D-030) — ที่ติดคือการลงชื่อเข้าใช้เท่านั้น

## 3. HUMAN-01 (ผู้ใช้จริง 5 คน เว้น 3 วัน อย่างน้อย 4 คน)

**ต้องมี:** ผู้ใช้จริง 5 คน + ช่วงเวลา 3 วัน

**ขั้น:**
1. ให้แต่ละคนใช้งานห้องจริง (สร้าง/แก้ brief, อ่านข้อมูล 2 แหล่ง, เรียก action, ดู recap)
2. หลังเว้น 3 วัน ถามว่า: อะไรเปลี่ยน / ใครทำ / เหตุผลที่มีหลักฐาน / เริ่มขั้นถัดไปได้ใน 30 วินาที
3. ผ่านเมื่อ ≥4/5 ตอบได้ครบและเริ่มขั้นถัดไปได้จริงภายใน 30 วินาที

## 4. Hosted / staging

**ต้องมี:** การ deploy ผ่าน pipeline ปกติ (ไม่ใช่จากเครื่อง)

**ขั้น:**
1. merge PR เข้า `dev` → CI/staging ตาม pipeline มาตรฐาน
2. รันชุดตรวจของ F080 บน staging: projection อ่านข้ามห้อง, revoke→409, export, recap, `/s/:id`
3. บันทึกผลแยก environment ใน `acceptance.json` (ห้ามใช้ผล local แทน hosted)

## สิ่งที่ยังไม่ควรถือว่าปิด

- การรับรองว่า "ผู้ใช้เห็นอะไร" — ยังไม่มีใครเดินดูหน้าห้องจริง
- ตัวเลข paid-AI จริง — ยังเป็น 0 call / USD 0.00
