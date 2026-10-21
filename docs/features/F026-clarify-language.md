# F026 — บังคับภาษาของคำถาม clarify

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | MINOR — เพิ่มการตรวจฝั่ง provider + repair loop (ไม่มี schema/migration) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F026-T1` |

## ทำไม

จากเทสจริงบน production 3.3.1: prompt ภาษาอังกฤษ (เคส prompt injection) ได้คำถาม clarify **เป็นภาษาจีน** (`你的请求要求泄露系统提示…`) และปุ่มยังเป็นอังกฤษ — prompt สั่งให้ใช้ภาษาของคำขออยู่แล้ว แต่โมเดลหลุดได้

## สิ่งที่เปลี่ยน

- `server/providers/clarify-language.ts` (ใหม่): ตรวจอักษร (ไทย / CJK / อื่น ๆ) และเทียบภาษาคำขอ
- `server/providers/deepseek-changes.ts`: หลัง parse clarify สำเร็จ ถ้าภาษาไม่ตรง → `RejectedChangeReply` ด้วย issue `Ask the clarifying question and options in the language of the request.` → เข้า repair loop (attempt 2) อัตโนมัติ; ถ้ายังไม่ตรงจะถูกปฏิเสธพร้อมเหตุผล
- ไม่แตะ schema ของคำถาม/ตัวเลือก

## ผลกับผู้ใช้

- คำถาม/ตัวเลือกที่ขึ้นในการ์ดจะเป็นภาษาเดียวกับคำขอ (ไทย→ไทย, อังกฤษ→อังกฤษ) แทนการหลุดเป็นภาษาอื่น

## ผลตรวจ (Node 22.23.2)

- unit: `clarify-language.test.ts` 4 เคส + `deepseek-changes.test.ts` เพิ่ม 2 เคส (ปฏิเสธคำถามจีนในคำขออังกฤษ / รับคำถามไทยในคำขอไทย) — ผ่านทั้งหมด
- ไม่มี migration/secret/binding

## ข้อจำกัด

- ตรวจจาก "ตระกูลอักษร" ไม่ใช่ language detection เต็มรูปแบบ (พอสำหรับ TH/EN/ZH; ภาษาละตินอื่นถือว่าตรงกับอังกฤษ)
