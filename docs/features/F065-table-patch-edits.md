# F065 — AI แก้โต๊ะแบบส่งเฉพาะส่วนที่เปลี่ยน (patch)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — เพิ่มรูปแบบคำตอบใหม่ของ AI · คำตอบแบบเดิม (ทั้งโปรแกรม) ยังรับได้ · ไม่มี migration · rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F065-T*` |

## ทำไม

ขอให้ AI เพิ่มการ์ดในโต๊ะที่ใหญ่ขึ้นแล้วล้มเหลว แม้คำขอใหม่จะเล็ก เพราะทุกการแก้ AI ต้อง **เขียนโปรแกรมทั้งโต๊ะออกมาใหม่**:

- โต๊ะ "คู่มือ GitHub Flow" (โปรแกรม ~21 KB) ขอเพิ่ม heatmap 2 รอบ (22–23 ต.ค. 2569):
  - รอบแรกเกินเวลา 240 วินาทีของการร่างหนึ่งครั้ง
  - รอบสอง AI ทิ้ง action เดิมทั้งหมดเพื่อย่อคำตอบ ระบบตรวจแล้วไม่ผ่าน (`program.actions: Too small`)
- ยิ่งโต๊ะใหญ่ คำตอบยิ่งยาว ช้า แพง และมีโอกาสลืมส่วนเดิมมากขึ้น
- #194 แก้ฝั่งขาเข้าแล้ว (ไม่ส่งไฟล์ที่อ้างแล้วซ้ำ) แต่ฝั่งคำตอบยังเป็นทั้งโปรแกรม

## สิ่งที่ผู้ใช้จะเห็น

- สั่ง "เพิ่มการ์ด…" ในโต๊ะใหญ่แล้ว AI ทำเสร็จเร็วขึ้น และไม่ทำให้ส่วนเดิมหาย
- หน้าตาและขั้นตอนเหมือนเดิมทุกอย่าง (ร่าง → ตรวจ → ใช้อัตโนมัติตาม F039)

## ขอบเขต

**รวม:**
- เมื่อแก้โปรแกรมที่มีอยู่ (`program !== null`) ให้ AI ตอบเป็น `{"kind":"table-patch", ...}` บอกเฉพาะสิ่งที่เพิ่ม แก้ หรือลบ
- server รวม patch เข้ากับโปรแกรมปัจจุบันเป็นโปรแกรมเต็ม แล้วส่งเข้าการตรวจเดิมทั้งหมด (schema, `normalizeGeneratedTableChange`, salvage canvas, `tableChangeIssues`) จึงไม่มีทางลัดผ่านการตรวจ
- คำตอบแบบโปรแกรมเต็มยังรับได้เหมือนเดิม
- รอบซ่อม (repair) ของการแก้ให้ตอบเป็น patch เช่นกัน

**ไม่รวม:**
- การสร้างโต๊ะใหม่ ยังเป็นโปรแกรมเต็ม
- เพดาน 48 KB ขาเข้า
- invoice, teaching และ encounter

## รูปแบบ patch

```json
{"kind":"table-patch",
 "set":{"title":"…","description":"…","turnOrder":["host"]},
 "upsert":{"collections":[…],"actions":[…],"invariants":[…],"views":[…]},
 "remove":{"collections":["id"],"actions":["id"],"invariants":["id"],"views":["id"]},
 "addEvidence":[{"sourceId":"…","quote":"…"}],
 "addAssumptions":["…"]}
```

- `upsert` แทนที่ของที่ id ซ้ำทั้งก้อน หรือต่อท้ายถ้าเป็น id ใหม่ (views ต่อท้าย `program.canvas.views` และสร้าง `canvas` ให้ถ้ายังไม่มี)
- ทุกส่วนไม่บังคับ แต่ต้องมีการเปลี่ยนอย่างน้อยหนึ่งอย่าง
- คำตอบส่งมาเป็นรูป patch แต่การตรวจทุกขั้นทำกับโปรแกรมเต็มหลังรวมแล้ว

## ข้อเท็จจริงจากโค้ด (ตรวจ 23 ต.ค. 2569)

- `server/providers/deepseek-changes.ts`
  - `changeFrom()` parse คำตอบ → `normalizeGeneratedTableChange` → `tableChangeSchema` / salvage
  - `systemPrompt(kind, editing)` แยกข้อความสำหรับการแก้ไว้แล้ว
  - เทสต์คุมความยาว system prompt ของการสร้างใหม่ไว้ < 20,000 ตัวอักษร
- `cloudflare/ai.ts` รอบซ่อมใช้ `tableChangeIssues(workspace.domain, change)` กับ ChangeSet เต็ม ไม่ต้องแก้ส่วนนี้
- `tableChangeIssues` ห้ามลบหรือเปลี่ยนคอลัมน์เดิม และบังคับ `initialRecords` ว่างเมื่อแก้

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F065-T1 | `applyTablePatch(program, patch)` + schema + เทสต์ | unit: upsert/remove/set/evidence ทุกชนิด, patch ว่างถูกปฏิเสธ, id ซ้ำ |
| F065-T2 | provider รับ `table-patch` ตอนแก้ แล้วรวมก่อนตรวจ · prompt ของการแก้และรอบซ่อม | unit: patch → ChangeSet เต็ม, เต็มแบบเดิมยังผ่าน, prompt สร้างใหม่ไม่เปลี่ยน (< 20,000) |
| F065-T3 | ลองจริงบน emulator: เพิ่ม heatmap ในโต๊ะ GitHub | ร่างผ่านและใช้อัตโนมัติ ส่วนเดิมอยู่ครบ |
| F065-T4 | spec + CHANGELOG + เอกสาร | อัปเดตครบ |

## ผลลองจริง (23 ต.ค. 2569)

ส่งคำขอเดียวกับที่เคยล้มบนโต๊ะ GitHub Flow (เพิ่ม scene heatmap 40 ช่อง):

- **ก่อน F065:** AI ทิ้ง action ทั้งหมดเพื่อย่อคำตอบ → ตรวจไม่ผ่าน (`program.actions: Too small`)
- **หลัง F065:** AI ส่งเฉพาะการ์ดใหม่ จบใน 134 วินาที action เดิมอยู่ครบ
- แต่ถูกปฏิเสธที่ "Canvas output exceeds deterministic bounds" คือผลลัพธ์ canvas รวมของโต๊ะเกิน 16 KB (`GENERATIVE_LIMITS.outputBytes`) เพราะโต๊ะนี้มีการ์ดเต็มเพดานอยู่แล้ว เป็นข้อจำกัดแยกจาก F065
