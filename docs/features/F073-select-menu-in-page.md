# F073 — เมนู `<select>` ต้องถูกวาดในหน้า ไม่ใช่หน้าต่าง OS

- **สถานะ:** `review`
- **วันที่:** 2026-10-23
- **branch:** `fix/F073-select-menu-in-page` (base `origin/dev` @ `20d3c60`)
- **ขอบเขต:** CSS ของแอปทั้งชุด (`src/tabletop/ui/tabletop.css`) — ไม่มี JS, ไม่มี schema, ไม่มี migration
- **รายงาน:** ผู้ใช้กด dropdown บนหน้า `/tables` แล้วมีกล่องดำโผล่ขึ้นมาแล้วขยายใหญ่ขึ้นเรื่อย ๆ จน browser ค้าง · เป็นเฉพาะ Windows · เกิดกับ dropdown ทุกตัว

## อาการและกลไก

ที่ display scaling ของ Windows มากกว่า 100% (เครื่องที่รายงานคือ 125%) Chromium **ไม่วาดเมนูของ `<select>` ในหน้า** แต่ส่งให้ **หน้าต่าง OS แยก** วาดแทน หน้าต่างนั้นคือสิ่งที่ผู้ใช้เห็นเป็นกล่องดำและขยายค้าง

หลักฐานที่วัดได้ (Playwright + Edge 155 / Brave 1.96.59, viewport 948×663 CSS = 1185×829 device ที่ dpr 1.25):

| สภาพ | `select:matches(':open')` | rect ของ `<option>` | เห็นเมนูในภาพที่ renderer วาด |
| --- | --- | --- | --- |
| ก่อนแก้ (native) @125% | true | **0×0** (ไม่ได้ถูก layout ในหน้า) | ไม่เห็น |
| ก่อนแก้ @100% | true | มีค่า (เมนูถูกวาดในหน้า) | เห็น |
| หลังแก้ (`appearance: base-select`) @125% | true | **119×31.8** | เห็น |

⇒ ที่ scaling ≠ 100% เมนูอยู่ในหน้าต่าง OS ที่ renderer วาดไม่ได้/วาดผิด; ที่ 100% ทุกอย่างอยู่ในหน้า จึงไม่มีอาการ — ตรงกับที่ผู้ใช้บอกว่าเป็นเฉพาะเครื่องที่ตั้ง scaling ไว้

ขนาด 838 px ของเนื้อหาหน้าในภาพผู้ใช้ = 670 CSS px × 1.25 ยืนยันว่าเป็น 125% เช่นกัน (และ `Sort` อยู่ที่ x=235 device = 186 CSS ซึ่งตรงกับ harness)

## วิธีแก้

เปิดใช้ customizable select ของ Chromium เฉพาะเมื่อรองรับ — ตัวเลือก (`option`) จะถูกวาดในหน้าเสมอ ไม่ว่าการ scale จะเป็นเท่าไร:

```css
@supports (appearance: base-select) {
  .tt-app select, .tt-chooser select, … { appearance: base-select; }
  …::picker-icon { /* เชฟรอนตัวเดียวกับที่แอปวาดเอง แทนสามเหลี่ยมของ UA */ }
  …::picker(select) { /* กระดาษ ขอบบาง เงา — ชุดเดียวกับเมนูอื่นของแอป */ }
  … option { … } … option:checked { … } … option::checkmark { … }
  .tt-chooser .tt-table-filters select { min-inline-size: max-content; }
}
```

เบราว์เซอร์ที่ไม่รองรับจะข้ามบล็อกนี้ทั้งหมดและยังใช้ `<select>` native ตามเดิม (macOS/Linux/mobile ไม่มีอาการนี้) · เพราะยังเป็น `<select>` จริง ฟอร์ม/คีย์บอร์ด/`required`/`selectOption` ของเทสต์เดิมจึงทำงานเหมือนเดิม

## สิ่งที่ตั้งใจให้เปลี่ยน และข้อจำกัด

- **chevron:** สถานะปิดของ select เปลี่ยนจากสามเหลี่ยมของ UA เป็นเชฟรอนที่แอปวาดเอง (`::picker-icon`) — หน้าตาตรงกับ lucide `ChevronDown` ที่ใช้ที่อื่น
- **ความกว้าง:** เมื่อหน้าวาดเมนูเอง select จะกว้างเท่าตัวเลือกที่เลือกอยู่ ไม่ใช่เท่าตัวเลือกที่ยาวที่สุด ⇒ ใส่ `min-inline-size: max-content` เฉพาะแถวตัวกรองของ `/tables` (มีที่พอและ wrap ได้) เพื่อไม่ให้แถวกระโดด · **ห้ามใส่ `min-inline-size: max-content` ทั้งแอป** เพราะ `min-width` ชนะ `max-width: 100%` ทำให้ select ใน card แคบล้นออกนอกกรอบ (วัดได้: 277.7 px ใน card 150 px)
- **ตำแหน่งเมนู:** Chromium ตัดสินใจเปิดขึ้นบนเมื่อพื้นที่ด้านล่างน้อยกว่าความสูงสูงสุดของเมนู (~320 px) ที่ 125% แถวตัวกรองอยู่ต่ำกว่านั้น ⇒ เมนูจะเปิดขึ้นบน (คร่อมหัวข้อ) ไม่ใช่ลงล่าง — เป็นพฤติกรรมของเบราว์เซอร์ ไม่ใช่ overflow; `position-area: bottom` ถูกเมินเพราะ UA ใช้ fallback `flip-block` ของตัวเอง
- **ยังไม่ครอบคลุม:** ยังไม่ได้ตรวจหน้าจออื่นของแอปทีละหน้า และยังไม่ได้รัน browser suite ของ repo

## ผลตรวจ (Node 22.23.2, branch `fix/F073-select-menu-in-page` base `origin/dev` @ `20d3c60`)

- `npx tsc -b` ผ่าน (ไม่มี output)
- `npm test` → **827 passed / 5 skipped (832)**, 113 ไฟล์ผ่าน / 2 ไฟล์ skipped
- `npx vitest run src/tabletop/ui/table-list-filter.test.ts src/tabletop/ui/relative-time.test.ts` → 8/8 (ตรวจการเรียง `updated`/`created`)
- `npm run build` ผ่าน
- `npx tsx server/changelog.ts check` → 7 fragment(s) OK · `node scripts/check-public-files.mjs` → 800 files, findings `[]`
- Chromium harness (Edge 155 + Brave 1.96.59) ที่ dpr 1.25 และ 1.0: `appearance` = `base-select`, เมนูถูกวาดในหน้า, ความกว้าง control 116.8 px เทียบ native 115.99 px (Δ0.8), คีย์บอร์ด ArrowDown + Enter เปลี่ยนค่าได้

## ภาพหลักฐาน

- `docs/previews/F073-select-menu-before-125.png` — ที่ 125% เมนูไม่ถูกวาดในหน้า (เห็นแค่ focus ring)
- `docs/previews/F073-select-menu-after-125.png` — เมนูถูกวาดในหน้า เปิดจาก control เดียวกัน
- `docs/previews/F073-sort-created.png` — หน้า proof ของ `filterTables` หลังสลับ `Sort = Created`

## หมายเหตุเรื่อง `Sort`

`Sort` ทำงานจริง (ยืนยันด้วย `filterTables()` ตัวจริง: `updated` → edited, biz, admin, weird · `created` → biz, admin, weird, edited) แต่โต๊ะ 3 ใบในภาพผู้ใช้ถูกแก้หลังสร้างไม่นาน ลำดับภายใต้สองนาฬิกาจึงออกมาเหมือนกัน — ไม่ใช่บั๊ก

## rollback

ลบบล็อก `@supports (appearance: base-select)` ใน `src/tabletop/ui/tabletop.css` — ไม่มี state/schema ที่ต้องย้าย
