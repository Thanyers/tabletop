# F090 — ผลค้นเว็บไม่ถูกใส่เป็น evidence ของโต๊ะที่ไม่มีไฟล์แหล่งที่มา

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | PATCH — ข้อความ prompt + ข้อความตรวจ ไม่มี migration rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F090-T1` |
| ต่อจาก | [F064](F064-web-search.md), [F064 สไลซ์ C](F064-slice-c-web-evidence.md) |

## ทำไม

ทดลองบน staging (2026-10-27, โต๊ะไทม์ไลน์มังงะ BL) ขอรอบสอง "ค้นเพิ่มและเติม… เท่าที่มีหลักฐาน" → ล้มหลัง 272 วินาที `MODEL_PROVIDER_OUTPUT_REJECTED`: *Prompt-only tables cannot cite a source that is not on the table.*

Root cause:
- โต๊ะไม่มีไฟล์แหล่งที่มา (0 sources) `applyTableChange` จึงบังคับ `program.evidence: []` (`domain/table.ts`)
- system prompt บรรทัดก่อนหน้าบอก evidence:[] แล้ว แต่บรรทัด research บอกว่า "cite only exact quotes from a supplied source text" ซึ่งโมเดลอ่านว่าให้อ้างผลค้นเว็บใน evidence (คำขอมีคำว่า "หลักฐาน")
- ข้อความตรวจที่ส่งกลับเป็น repair issue บอกแค่กฎ ไม่บอกว่าต้องแก้อะไร โมเดลซ่อม 3 รอบก็ผิดแบบเดิม

## สิ่งที่เปลี่ยน

- `server/providers/deepseek-changes.ts`: บรรทัด research → "Research grounds values, not program.evidence: put its URLs and short quotes in record fields, notes or assumptions; program.evidence may quote only table source files listed in sources."
- `domain/table.ts`: ข้อความเดิมคงไว้ + ต่อท้ายวิธีแก้ "Set program.evidence to [] (in a table-patch, omit addEvidence); put web research links and short quotes in record fields, notes or assumptions instead." (ข้อความนี้คือ repair issue ที่โมเดลเห็น)

## ผลตรวจ

- unit: `deepseek-changes-research.test.ts` (prompt มีบรรทัดใหม่), `table-web-sources.test.ts` (ข้อความบอกวิธีแก้) · ทั้งชุด 1313 passed / 5 skipped · `test:cloudflare` 354 passed · lint 0 errors · build + build:cloudflare ผ่าน (Node 26.3.1)
- local `wrangler dev` + DeepSeek จริง: โต๊ะใหม่คำขอเดียวกับ staging → รอบแรก applied (6 แหล่ง) → รอบสอง "ค้นเพิ่มและเติม… เท่าที่มีหลักฐาน" **applied** (`evidence` 0, ruleRevision 2) · บน staging คำขอเดียวกันล้มหลัง 272 วิ · ข้อจำกัด: ลองหนึ่งครั้ง โมเดลไม่ deterministic
