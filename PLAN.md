# PLAN.md — กระดานงานของทีม

ใช้ไฟล์นี้ดูว่า **ใครกำลังทำอะไร ไฟล์ไหน** ก่อนหยิบงาน เพื่อไม่ให้สองคน (หรือสอง AI) แก้เรื่องเดียวกันพร้อมกัน
รายละเอียดของแต่ละฟีเจอร์อยู่ใน [`docs/features/`](docs/features/) ส่วนสถานะระบบที่เสร็จแล้วอยู่ใน [`spec.md`](spec.md)

## กติกา

1. **ก่อนหยิบงาน:** ดูตารางด้านล่าง แล้วรัน `gh pr list -R Thanyers/tabletop --state open` ว่าไม่มี PR ที่ชื่อขึ้นต้นด้วย ID เดียวกัน
2. **จองงาน:** แตก branch จาก `dev` (`feat/<ID>-<ชื่อสั้น>`) แก้แถวของงานนั้นในไฟล์นี้ (สถานะ `doing`, ผู้รับผิดชอบ, branch) แล้ว **เปิด draft PR ทันที** ชื่อ PR ขึ้นต้นด้วย ID เช่น `F001-T4: ...` · draft PR คือการจองที่ทุกคนเห็น
3. **แก้เฉพาะแถวของตัวเอง** อย่าจัดรูปแบบหรือเรียงตารางใหม่ จะได้ไม่ชนกับคนอื่น
4. **ดูคอลัมน์ "พื้นที่ที่แตะ":** ถ้างานที่ `doing` อยู่แตะไฟล์เดียวกับงานที่จะหยิบ ให้รอ หรือคุยกันก่อน · งานที่มี "ต้องรอ" ห้ามเริ่มจนงานนั้น `done`
5. **จบงาน:** PR พร้อม review → เปลี่ยนสถานะเป็น `review` · คน merge แล้ว → `done` (แก้ใน PR ถัดไปของคุณได้)
6. งานใหม่ที่ยังไม่มีใครจอง ให้เพิ่มไว้ใน feature doc ก่อน แล้วค่อยเพิ่มแถวที่นี่

**สถานะ:** `todo` · `doing` · `review` · `done` · `blocked` (ใส่เหตุผลในคอลัมน์หมายเหตุ)

## จุดที่ชนบ่อย (hotspots)

ไฟล์เหล่านี้หลายงานแตะพร้อมกัน ให้แก้เท่าที่จำเป็นและ merge `dev` เข้า branch ตัวเองบ่อย ๆ:
`src/tabletop/TabletopApp.tsx` · `tests/generic-table-browser.mjs` · `tests/cloudflare-browser.mjs` · `tests/tabletop-r1.mjs` · `cloudflare/index.ts` · `CHANGELOG.md` (เพิ่มบรรทัดใต้ `Unreleased` เท่านั้น) · `spec.md`

## ฟีเจอร์

| ID | ฟีเจอร์ | สถานะ | เอกสาร |
| --- | --- | --- | --- |
| F001 | เริ่มโต๊ะใหม่ด้วยคำถาม + การ์ดเดโม + AI ช่วยเลือก + แชทแบบ island | `todo` (รอตอบคำถามเปิด) | [F001](docs/features/F001-guided-table-start.md) |

## งาน

| ID | งาน | สถานะ | ผู้รับผิดชอบ | branch / PR | พื้นที่ที่แตะ | ต้องรอ | หมายเหตุ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F001-T1 | ชุดข้อมูลการ์ด starter 3 โจทย์ | `todo` | — | — | `src/tabletop/shared/starters.ts` (ใหม่) | — | |
| F001-T2 | หน้าเริ่มโต๊ะใหม่: คำถาม + การ์ด + ช่องพิมพ์ | `todo` | — | — | `src/tabletop/ui/StartPrompt.tsx` (ใหม่), `TabletopApp.tsx`, CSS ใหม่ | T1 | hotspot `TabletopApp.tsx` |
| F001-T3 | ตรวจและเตรียม "ตัวอย่าง + กฎให้ตรวจ" ของแรงกับมวลและเกมโล่ | `todo` | — | — | `src/tabletop/domain/` (teaching, encounter) | — | spike ก่อน: ตอนนี้มีแค่ `invoice.sample` |
| F001-T4 | กดการ์ดแล้วสร้างโต๊ะชนิดนั้นและโหลดตัวอย่าง | `todo` | — | — | `client.ts`, `TabletopApp.tsx` | T2, T3 | |
| F001-T5 | Endpoint AI แนะนำ starter จากข้อความ (Worker) | `todo` | — | — | `cloudflare/starter-ai.ts` (ใหม่), `cloudflare/index.ts`, `cloudflare/contracts.ts`, `cloudflare/*.test.ts` | — | แตะงบ AI + consent ต้องมีเทสต์ด้านปฏิเสธ |
| F001-T6 | Node runtime ตอบ endpoint เดียวกันว่า AI ปิด | `todo` | — | — | `server/app.ts`, `server/*.test.ts` | T5 (contract) | |
| F001-T7 | ช่องพิมพ์เรียก T5 แล้วไฮไลต์การ์ดที่แนะนำ | `todo` | — | — | `StartPrompt.tsx`, `client.ts` | T2, T5 | |
| F001-T8 | แชทเป็น island ลอย | `todo` | — | — | `TableAssistant.tsx`, `assistant-calm.css`, `calm-workspace.css`, `TableSurface.tsx` | — | T8 + T9 คนเดียวทำ (ไฟล์เดียวกัน) |
| F001-T9 | แชทย่อเป็นวงกลมไอคอนดุ๊กดิ๊กเมื่อไม่มีคนพิมพ์ | `todo` | — | — | ไฟล์เดียวกับ T8 | T8 | ต้องรองรับ reduced motion |
| F001-T10 | ปรับ browser tests ตาม flow ใหม่ | `todo` | — | — | `tests/*.mjs` | T2, T4, T8 | แต่ละงานแก้เทสต์ของตัวเองได้ งานนี้เก็บส่วนที่เหลือ |
| F001-T11 | คู่มือผู้ใช้ + CHANGELOG | `todo` | — | — | `docs/USER_GUIDE_TH.md`, `CHANGELOG.md` | T4, T7, T9 | |
