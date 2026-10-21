# F030 — corpus หลายรอบ + ค่าความเสถียรต่อเคส

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เครื่องมือวัดผล (ไม่มี schema/migration) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F030-T1` |

## ทำไม

corpus เดี่ยว (F029) บอกได้แค่ "รอบนั้นเป็นอะไร" แต่ปัญหาจริงคือ **ความแกว่ง** (เช่น join/dragon ได้ draft บ้าง clarify บ้าง) การตัดสินจากรอบเดียวทำให้เข้าใจผิดทั้งสองทาง

## สิ่งที่เพิ่ม

- `TABLE_CORPUS_ROUNDS` (1–5, default 1) ใน `server/corpus-success-rate.test.ts`
- รายงานสรุปเพิ่ม: **ตารางต่อรอบ**, **ตารางต่อเคส (outcomes ทุกรอบ + stable + match rate)**, totals
- log `CORPUS unstable <ids>` ให้ grep ง่ายใน CI/log

## ผลวัดจริง 3 รอบ (2026-10-21 21:28–21:32, dev `90a75d7`, Node 22.23.2)

| รอบ | draft | clarify | reject | error | matched | avg |
| --- | --- | --- | --- | --- | --- | --- |
| r1 | 5 | 5 | 0 | 0 | 10/10 | 8.7s |
| r2 | 4 | 6 | 0 | 0 | 9/10 | 6.1s |
| r3 | 5 | 5 | 0 | 0 | 10/10 | 6.0s |

- **รวม 29/30 (97%) · reject 0 · error 0**
- เคสที่แกว่ง: **dragon** (draft 2 รอบ, clarify 1 รอบ = ถามรายละเอียดก่อนสร้าง — ไม่ใช่ failure)
- **join: draft 100% ทั้ง 3 รอบ** (1x/2x/4x) — ต่างจากรายงาน 3.3.1 ที่ reject; แปลว่า F023/F024/F028 ช่วยจริง แต่ยังต้องเฝ้าด้วย corpus

## วิธีรัน

```
TABLE_CORPUS_KEY=<key> TABLE_CORPUS_ROUNDS=3 npx vitest run server/corpus-success-rate.test.ts
```

## ข้อจำกัด

- ใช้ AI จริง (มีค่าใช้จ่าย ≈ 10–30 calls ต่อรอบ) — ไม่ผูก CI
- ผลขึ้นกับโมเดล/timeout; ต้องดูหลายรอบและหลายวัน
