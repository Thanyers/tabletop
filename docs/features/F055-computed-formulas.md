# F055 — สูตรคำนวณจริง (server-computed formulas)

| | |
| --- | --- |
| สถานะ | `review` — [PR #203](https://github.com/Thanyers/tabletop/pull/203) |
| เป้าหมาย | ตารางที่ "ใส่สูตรครั้งเดียว แล้วเปลี่ยน data ได้เรื่อย ๆ" แบบ Excel: สูตรถูกเก็บใน state ของห้อง, server/worker เป็นคนคำนวณทุก projection, ทุก session เห็นเลขชุดเดียวกัน |
| ต่อยอดจาก | F017 computed columns (เดิมเป็น display-only binary arithmetic) |

## ทำไม

F017 เก็บสูตรได้แค่ `field + field/number` และฝั่ง client คำนวณเอง ทำให้ธุรกิจจริง (สัญญา: base ตามโซน + CEIL ของน้ำหนักเกิน + ฟรีเมื่อยอดถึงเกณฑ์) เขียนไม่ได้ และเลขที่เห็นไม่ได้มาจาก authority

## สิ่งที่ผู้ใช้เห็น

1. ในตาราง แต่ละ collection มี **Computed columns** — เขียนสูตรเป็นข้อความได้ เช่น
   `IF(goods_total >= 5000, 0, IF(zone = "BKK", 35, 45) + IF(weight_kg > 3, CEIL(weight_kg - 3) * 10, 0))`
2. คอลัมน์ที่คำนวณมี badge `calculated`; ค่ามาจาก server (projection) ไม่ใช่การคำนวณในเบราว์เซอร์
3. import/เพิ่ม/แก้ data แล้วค่าอัปเดตทันทีโดยไม่เรียก AI
4. สูตรที่ผิดชนิด (เช่น `IF(weight_kg, 1, 0)` หรือสูตรที่ได้ text) ถูกปฏิเสธพร้อมข้อความจาก server

## ภาษาและขอบเขตของสูตร

- ตัวเลข, ข้อความ (`"BKK"` / `'BKK'`), field id (รองรับ `-` ใน id)
- `+ - * /`, วงเล็บ, ค่าติดลบ
- เปรียบเทียบ `= == <> != < <= > >=`
- `IF(cond, a, b)`, `CEIL`, `FLOOR`, `ABS`, `ROUND(x[, 0-6])`, `MIN`, `MAX`, `AND`, `OR`
- ผลลัพธ์ของคอลัมน์ต้องเป็น number; ถ้าข้อมูลไม่ครบ/หารด้วยศูนย์/เกิน 1e9 → `null` (แสดงเป็น —)
- ไม่มี `eval`; AST ถูกจำกัด 64 nodes / depth 12 (เดิม 32/8)

## สถาปัตยกรรม

| ชั้น | ไฟล์ | บทบาท |
| --- | --- | --- |
| เก็บสูตร | `src/tabletop/shared/table-contracts.ts` (`TableState.computedColumns`) | อยู่ใน state ของห้อง (Durable Object / authority) ไม่ใช่ client storage |
| parse/format | `src/tabletop/shared/computed-formula.ts` | แปลงข้อความเป็น AST + แปลงกลับเป็นข้อความสำหรับแก้ไข |
| ตรวจ/evaluate | `src/tabletop/shared/computed-columns.ts` | type-check + ประเมินแบบ bounded AST |
| คำนวณจริง | `src/tabletop/domain/projections.ts` (`projectDomain`) | ทุก projection ของ table (open/private) เติม `computedValues` — เรียกจาก `authorizeSession` ของ authority จึงใช้ทั้ง Cloudflare Room DO และ Node server |
| UI | `src/tabletop/ui/TableCanvasObjects.tsx` | ช่องสูตร + แสดงค่าจาก `computedValues` (fallback คำนวณ local เฉพาะเมื่อไม่มีค่า) |

`computedValues` เป็น **projection-only**: ไม่ถูกเขียนลง room state จึงไม่กระทบ revision/CAS และไม่ต้อง migration; คำนวณใหม่ทุกครั้งที่ส่ง view

## ผลตรวจ (local, ล่าสุด)

- Unit: `node node_modules/vitest/vitest.mjs run` — **714 passed / 1 skipped** (เพิ่ม `computed-formula.test.ts` 8 tests, `computed-projection.test.ts` 3 tests, ปรับข้อความ error ของ F017 2 จุด)
- Cloudflare: `vitest run --config vitest.cloudflare.config.ts` — **155/155**
- Typecheck: `tsc -b`, `tsc -p tsconfig.server.json`, `tsc -p tsconfig.cloudflare.json` ผ่าน
- Local Workers browser (msedge): `node tests/cloudflare-browser.mjs` — **ผ่านทั้งชุด** (รวม HTTP assertion ว่า projection มี `computedValues` และ import แถวใหม่แล้ว recompute 15 โดยไม่มี provider call; รอบที่ล้มกลางทางเป็น flake ของ retry เดิม รันซ้ำผ่าน — ดู `test-results/computed-local-browser-5.log`)
- Local UI จริง (Miniflare + fixture owner): `node --import tsx scripts/generic-table-local.mjs` → สร้างโต๊ะ, อัปโหลด `vendor-contract.txt`, สูตรถูกเก็บ, import CSV 7 แถว → ตารางแสดง `35 / 75 / 52.5 / 0 / 45 / — / 45` จาก server; ใช้ action **Set weight** เปลี่ยน NS-1002 เป็น 3.0 กก. → `dataRevision 4 = computedValues.revision 4` และค่าเปลี่ยนเป็น **45** ทันที
  → ภาพหน้าจอจากการรันรอบนั้นถูกเก็บใน `test-results/` (ignored) ไม่ได้ commit เข้า repo
- เคสธุรกิจ (authority layer, อ่าน `docs/examples/vendor-orders.csv` จริง): `node --import tsx scripts/computed-formula-local.mjs`
  → ค่าต่อแถว `35, 75, 52.5, 0, 45, null, 45`, **total 252.50**, NS-1002 = `check`, NS-1006 = `unresolved`
  → เปลี่ยนน้ำหนัก NS-1002 จาก 5.2 เป็น 3.0 ผ่าน `table.act` แล้ว recompute เป็น **45.00** (total 222.50) โดยไม่แก้สูตร
  → หลักฐาน JSON: `test-results/vendor-computed-local.json`

## ข้อจำกัด / งานต่อไป

- คอลัมน์คำนวณยังไม่ถูกใช้ใน conditions/effects ของ action (อ่านได้อย่างเดียว)
- ยังไม่มี simulation ของ rule change สำหรับ table kind (แสดงค่าที่คำนวณได้เท่านั้น)
- สูตรถูกระบุด้วย field **id** (ไม่ใช่ label) — UI แสดงรายการ id ให้
- สูตรที่อ้างคอลัมน์คำนวณอื่นยังไม่รองรับ
