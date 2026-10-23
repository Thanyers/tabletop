# F072 — Cloudflare Web Analytics บนหน้าสาธารณะ

| | |
| --- | --- |
| สถานะ | `blocked` — รอ site token จาก Cloudflare dashboard |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — client + CSP ไม่มี schema/binding/secret · rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F072-T1` |

## ทำไม

ยังไม่มี analytics เลย ผู้ใช้เลือก Cloudflare Web Analytics แทน GA4 (2026-10-23) เพราะไม่ใช้ cookie จึงไม่ต้องมีแถบ consent และ production อยู่บน Cloudflare อยู่แล้ว

## สิ่งที่วัด / ไม่วัด

- **วัด:** page view, ที่มา, ประเทศ, อุปกรณ์ และ Web Vitals ของ `/` (เฉพาะผู้ที่ยังไม่ล็อกอิน) และ `/demo`, `/demo/replay` บน `tabletop.ptchrr.workers.dev`
- **ไม่วัด:** หน้าที่ล็อกอินแล้ว, `/tables`, `/new`, `/join`, `/t/<id>` (ไม่ให้ id ของโต๊ะและลิงก์เชิญไปถึง beacon), staging และเครื่อง dev
- beacon ตั้ง `spa: false` จึงไม่รายงานการเปลี่ยนหน้าภายในแอปหลังโหลด

## ข้อเท็จจริงจากโค้ด

- loader อยู่ที่ [`src/analytics.ts`](../../src/analytics.ts) · token ว่าง = ปิด
- CSP เพิ่ม `https://static.cloudflareinsights.com` (script) และ `https://cloudflareinsights.com` (connect) ทั้งใน `secured()` ของ Worker และ `public/_headers`
- token ของ Web Analytics ไม่ใช่ความลับ (อยู่ในหน้า HTML ทุกหน้าที่โหลด beacon) เก็บใน repo public ได้

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | loader + CSP + ใส่ token | unit `analytics.test.ts` ผ่าน · หลัง deploy เห็น page view ใน dashboard |
