# F004 — แยก URL path ให้แต่ละหน้า

| | |
| --- | --- |
| สถานะ | `todo` |
| เจ้าของฟีเจอร์ | ผู้ใช้ (ผู้สั่งงาน) |
| เวอร์ชันที่คาด | MINOR (เปลี่ยนฝั่ง client เป็นหลัก rollback ได้ทันที) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F004-T*` |

## ทำไม

ตอนนี้ทุกหน้าอยู่ที่ `/` กดสร้างโต๊ะ เปิดโต๊ะ หรือกลับหน้าแรก URL ไม่เปลี่ยน ส่งลิงก์โต๊ะให้กันไม่ได้ ปุ่ม back ของ browser ไม่พาไปหน้าก่อนหน้า และดูแลหรือแจ้งบั๊กยากเพราะบอกไม่ได้ว่าอยู่หน้าไหน

## สิ่งที่ผู้ใช้จะเห็น

| path | หน้า |
| --- | --- |
| `/` | หน้าแรก: เลือก/สร้างโต๊ะ + My tables (หน้า welcome ถ้ายังไม่ล็อกอิน) |
| `/new` | หน้าเริ่มโต๊ะใหม่ (F001) |
| `/t/<id>` | โต๊ะหนึ่งโต๊ะ · `<id>` คือ UUID ของห้อง |
| `/join` | หน้าเข้าร่วมผ่านลิงก์เชิญ (F003) · token อยู่หลัง `#` เหมือนลิงก์เชิญเดิม |
| `/demo`, `/demo/replay` | เหมือนเดิม |

- เปิด `/t/<id>` ตรง ๆ หรือรีเฟรช → เข้าโต๊ะเดิม (ถ้าเป็นสมาชิก)
- ยังไม่ล็อกอิน → ล็อกอินแล้วกลับมาที่ path เดิม
- ไม่ใช่สมาชิก หรือโต๊ะไม่มี → หน้าแจ้งว่าเปิดไม่ได้ ไม่บอกว่าโต๊ะมีอยู่จริงหรือไม่ แล้วพากลับ `/`
- ปุ่ม back / forward ของ browser ทำงาน · โลโก้พากลับ `/`

## ขอบเขต

**รวม:** ทั้ง Worker และ Node runtime · URL ของโต๊ะ · กลับ path เดิมหลังล็อกอิน · back/forward

**ไม่รวม:** path ของการ์ดแต่ละใบใน Canvas · ใส่ชื่อโต๊ะใน URL (ชื่อเปลี่ยนได้ ใช้ id) · ลิงก์ดูโต๊ะโดยไม่ล็อกอิน

## ความปลอดภัย

- id ใน URL **ไม่ใช่ความลับและไม่ใช่สิทธิ์** เซิร์ฟเวอร์ยังตรวจสมาชิกทุกคำขอเหมือนเดิม (`authorizeSession`)
- ไม่เพิ่ม redirect ฝั่งเซิร์ฟเวอร์ตาม path ที่ผู้ใช้ส่งมา (เทสต์ `does not ... redirect to a caller supplied return URL` ต้องยังผ่าน) → การกลับ path เดิมหลังล็อกอินทำฝั่ง client: เก็บ path ใน `sessionStorage` ก่อนล็อกอิน และยอมรับเฉพาะ path ภายในที่ตรง allowlist (`/`, `/new`, `/t/<uuid>`, `/join`)
- ห้ามใส่ token เชิญใน path หรือ query (ใช้ `#` เท่านั้น) · `Referrer-Policy: no-referrer` มีอยู่แล้ว

## ข้อเท็จจริงจากโค้ด (2026-10-20)

- เลือกหน้าตาม path: `src/main.tsx:14-17` รู้จักแค่ `/demo`, `/demo/replay` · นอกนั้นโหลด `TabletopApp`
- `TabletopApp` จำโต๊ะล่าสุดใน localStorage (`saveLastWorkspace`) ไม่ได้อ่านจาก URL · โลโก้ใช้ `href="#table"`
- หลังล็อกอิน: `TabletopApp.tsx:258` ล้าง query ของ callback ด้วย `history.replaceState` · เซิร์ฟเวอร์พากลับ `publicOrigin` + `/` เสมอ (`cloudflare/auth.ts`)
- Worker: `assets.not_found_handling = single-page-application` → ทุก path ที่ไม่ใช่ `run_worker_first` ได้ `index.html` อยู่แล้ว
- Node: `serveStatic` ใน `server/app.ts` ส่ง `index.html` เมื่อไม่เจอไฟล์ → ต้องตรวจว่า path ลึก (`/t/<id>`) และ asset แบบ relative ทำงาน
- Vite build ใช้ asset path แบบ absolute (`/assets/...`) → ต้องยืนยันใน build จริงว่าเปิดที่ `/t/<id>` แล้วโหลด asset ได้

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | router เล็กใน client (History API ไม่เพิ่ม dependency): แปลง path ↔ หน้า · `navigate()` · back/forward · โลโก้ → `/` · ตัว parse ที่ยอมรับเฉพาะ path ใน allowlist | unit test ตัว parse: path ถูก, uuid ผิดรูป, path แปลก, `//evil.example`, query/fragment |
| T2 | `TabletopApp` ใช้ URL เป็นแหล่งความจริงของโต๊ะที่เปิด: เปิดโต๊ะ → `/t/<id>` · กลับหน้าแรก → `/` · เปิด `/t/<id>` ตรง ๆ โหลดโต๊ะนั้น · เลิกพึ่ง localStorage เป็นหลัก | browser test (Worker): สร้างโต๊ะ → URL เป็น `/t/<id>` → รีเฟรช → อยู่โต๊ะเดิม → back กลับ `/` |
| T3 | กลับ path เดิมหลังล็อกอิน (client-side + allowlist) · หน้า "เปิดโต๊ะนี้ไม่ได้" สำหรับคนนอก | browser test: ยังไม่ล็อกอินเปิด `/t/<id>` → ล็อกอิน → กลับโต๊ะเดิม · บัญชีที่ไม่ใช่สมาชิกเปิด `/t/<id>` → หน้าแจ้ง ไม่เห็นข้อมูล · เทสต์ open redirect เดิมยังผ่าน |
| T4 | Worker/Node: path ลึกได้ `index.html` และ asset โหลดได้ · `/new`, `/join` ไม่ชนกับ route อื่น | Worker + server tests · curl `/t/<uuid>` บน `:8787` และ `:4310` |
| T5 | ปรับ browser tests และเอกสาร (USER_GUIDE, CHANGELOG) | CI `local-validation` ผ่าน |

## คำถามเปิด

1. ใช้ prefix `/t/<id>` หรือ `/table/<id>`? (เสนอ `/t/` สั้นและส่งต่อง่าย)

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-20 | ใช้ path จริง (History API) ไม่ใช้ `#` | ผู้ใช้ขอแยก path เพื่อดูแลง่าย · Worker/Node มี SPA fallback อยู่แล้ว |
| 2026-10-20 | ทำ F004 ก่อน F001-T2 และ F003-T5 | หน้าเริ่ม (`/new`) และหน้าเข้าร่วม (`/join`) ต้องมี path |
