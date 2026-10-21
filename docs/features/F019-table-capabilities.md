# F019 — บอกความสามารถและข้อจำกัดของโต๊ะให้ผู้ใช้เห็น

| | |
| --- | --- |
| สถานะ | `review` (implement แล้ว, รอ merge) |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เพิ่มข้อมูลใน `/api/capabilities` และ panel; ไม่มี schema/migration |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F019-T*` |

## ทำไม

`/api/capabilities` คืนแค่ 3 flag และความรู้เรื่องขีดจำกัดอยู่ใน docs/prompt ผู้ใช้จึงไม่รู้ว่าโต๊ะทำอะไรได้และทำอะไรไม่ได้ ทำให้ขอสิ่งที่ runtime ไม่รองรับแล้วเจอความล้มเหลวโดยไม่รู้ทางไปต่อ

## สิ่งที่ผู้ใช้จะเห็น

- การ์ด Rules มี **What this table can do** (collapsible): รายการความสามารถที่ใช้ได้ + ขีดจำกัดจริง (6 collections · 12 fields · 100 rows/collection · 12 views · 6 computed columns)
- **Known gaps** 5 ข้อ (joins/rollups ข้าม collection, ลบ schema ที่มีข้อมูล, image/audio/3D, simulation clock, capability ใหม่นอก DSL) พร้อมคำอธิบายว่าตอนนี้ทำอะไรได้แทน

## ขอบเขต

**รวม:** registry แบบ TS ที่อ้างค่าจริง (`TABLE_CAPABILITY_LIMITS`), `tableCapabilitySummary()` สำหรับ API, panel ใน Rules card, unit tests, browser check

**ไม่รวม:** การ derive สถานะจาก test อัตโนมัติ, การ map error ของ F016 → gap/คำแนะนำอัตโนมัติ, หน้า capability เต็มรูปแบบ

## ข้อเท็จจริงจากโค้ด

- `src/tabletop/shared/table-capabilities.ts` (ใหม่) — registry + limits + summary
- `cloudflare/index.ts` — `/api/capabilities` เพิ่ม field `table` (additive; field เดิมไม่เปลี่ยน)
- `src/tabletop/ui/TableCanvasObjects.tsx` — details ใน TableRules
- ค่าที่ใช้: program schema (6 collections, 12 fields, 16 actions), rows 100/200, canvas 12 views, computed 6

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | registry + summary + unit tests | ids ไม่ซ้ำ, limits ตรงกับ schema, summary stable |
| T2 | `/api/capabilities` + panel ใน Rules | additive, panel แสดงผลจริง |
| T3 | browser check + เอกสาร | ผ่าน CI |

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-21 | registry เป็น TS constant ที่ import ค่าจริง ไม่ derive จาก test | เร็วและตรงไปตรงมา; รักษ์ด้วย unit test เมื่อ schema เปลี่ยน |
| 2026-10-21 | API เพิ่ม field `table` แบบ additive | client เก่าไม่พัง; ไม่ต้อง migration |
