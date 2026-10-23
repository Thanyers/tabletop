# F071 — เมนูบัญชีเป็นวงกลมโปรไฟล์ที่ header

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — client อย่างเดียว ไม่มี schema/binding/secret · rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F071-T1` |

นำงานเมนูโปรไฟล์จาก #180 (F052 ที่ปิดไปแล้ว) มาสร้างใหม่บน landing ของ [F069](F069-landing-bilingual.md)

## สิ่งที่ผู้ใช้จะเห็น

- ล็อกอินแล้ว header ของ `/`, `/tables` และ `/new` แสดงวงกลมอักษรย่อสีเดียวกับ cursor แทนชื่อ/อีเมลและปุ่ม Sign out
- กดแล้วเปิดเมนู: ชื่อ/อีเมล · Your tables (ยกเว้นบน `/tables`) · ข้อมูลโต๊ะทั้งหมด (admin) · Sign out · ปิดด้วย Esc หรือคลิกนอก
- บน landing ข้อความในเมนูตามภาษาที่เลือก (EN/TH) · หน้าแอปเป็นอังกฤษ · มือถือซ่อนลิงก์ Your tables ที่ header เพราะอยู่ในเมนูแล้ว
- ในโต๊ะยังเป็นเหมือนเดิม (Sign out อยู่ในเมนู "…" ของโต๊ะ)

## ข้อเท็จจริงจากโค้ด (2026-10-23)

- ข้อมูลบัญชีไม่มีรูปโปรไฟล์ Google (`GoogleAuthUser` มี id/name/email/isAdmin) จึงใช้อักษรย่อ (`ui/initials.ts` ใช้ร่วมกับ `HeaderPeople`)
- ยังไม่มีการตั้งค่าระดับบัญชี เมนูจึงยังไม่มีรายการ Settings

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | `AccountMenu` + ใช้ใน landing และ `ChooserHeader` | tsc/lint ผ่าน · browser test 2 mark ใหม่ใน `cloudflare-browser.mjs` |
