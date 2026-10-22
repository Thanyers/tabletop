# F052 — Landing ภาษาอังกฤษ + รูปแชร์ใหม่

| | |
| --- | --- |
| สถานะ | `doing` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | PATCH — ข้อความ, meta และรูป static เท่านั้น ไม่มี schema/binding/secret · rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F052-T*` |

## ทำไม

ต่อจาก [F051](F051-seo-baseline.md) คำถามเปิดข้อ 1–2: ผู้ใช้ตัดสินเมื่อ 2026-10-22 ว่า **ภาษาหลักของ landing คืออังกฤษ** และให้ **เปลี่ยนรูปแชร์** (รูปเดิม crop จาก poster ภาษาไทย ตัวหนังสือเล็กอ่านไม่ออกตอนเป็น thumbnail)

ตอนนี้ `index.html` เป็น `lang="th"` และ title/description/og เป็นไทย ขณะที่ h1 กับหัวข้อเกือบทั้งหน้าใน `PublicWelcome.tsx` เป็นอังกฤษ แต่ย่อหน้าอธิบายหลายจุดยังเป็นไทย

## สิ่งที่ผู้ใช้จะเห็น

1. แชร์ลิงก์แล้วการ์ด preview เป็นภาษาอังกฤษ พร้อมรูปการ์ดแบรนด์ที่อ่านออกแม้เป็นรูปเล็ก
2. หน้า landing อ่านเป็นภาษาอังกฤษทั้งหน้า

## ขอบเขต

**รวม:** `index.html` (`lang`, title, description, og/twitter, alt) · รูป `public/og-image.png` ใหม่ + ไฟล์ต้นฉบับที่ render ซ้ำได้ · แปลงย่อหน้าไทยใน `PublicWelcome.tsx` เป็นอังกฤษ

**ไม่รวม:** ภาษาในแอปหลังล็อกอิน, เดโม, คู่มือ `docs/USER_GUIDE_TH.md` · i18n/สลับภาษา · prerender · ยื่น sitemap ใน Search Console (ผู้ใช้สั่งให้ทำทีหลัง)

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-22)

- `src/tabletop/ui/PublicWelcome.tsx` บน `dev` @ `6b0175e`: ย่อหน้าไทยใน promise, bridge, figcaption, story note, why-copy และส่วน "THE CURRENT BETA" (หัวข้อ + 4 ย่อหน้า) · หัวข้ออื่นเป็นอังกฤษอยู่แล้ว
- PR #177 (`fix/F004-navigation`) แก้ `PublicWelcome.tsx` อยู่ → T3 รอ #177 merge ก่อน
- ฟอนต์ Manrope มาจาก `@fontsource/manrope` (ใช้ใน `src/main.tsx`)

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | `index.html`: `lang="en"` + title/description/og/twitter/alt เป็นอังกฤษ | เทสต์ใน `cloudflare/pages.test.ts` อ่าน `dist/index.html` เจอ `lang="en"` และไม่มีอักษรไทย |
| T2 | รูปแชร์ใหม่: การ์ดแบรนด์ 1200×630 จาก `docs/showcase/og-card.html` render ด้วย `node scripts/render-og-image.mjs` ไปที่ `public/og-image.png` (path เดิม) | เทสต์ขนาดรูปผ่าน · รูปอ่านออกที่ขนาด thumbnail |
| T3 | แปลงย่อหน้าไทยใน `PublicWelcome.tsx` เป็นอังกฤษ (คงความหมายเดิม รวมข้อความ "ไม่ใช่ภาพหน้าจอจริง") | ไม่มีอักษรไทยใน `PublicWelcome.tsx` · browser test ที่อ้างข้อความ landing ปรับตาม |
| T4 | spec + CHANGELOG + PLAN + การตัดสินใจ | `node scripts/check-public-files.mjs` ผ่าน · CI `local-validation` เขียว |

## คำถามเปิด

- ไม่มี (ภาษาและรูปผู้ใช้ตัดสินแล้ว)

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | ภาษาหลักของ landing = อังกฤษ | ผู้ใช้ตัดสิน (ตอบคำถามเปิด F051 ข้อ 1) |
| 2026-10-22 | รูปแชร์ = การ์ดแบรนด์ (เขียว `#254d43`, โลโก้, h1 ของ landing, บรรทัดรอง) แทน poster ที่ crop | ผู้ใช้เลือกจาก 4 แบบ · ตัวหนังสือใหญ่อ่านได้ใน thumbnail ของ LINE/Slack |
| 2026-10-22 | เก็บต้นฉบับการ์ดเป็น HTML + สคริปต์ render ใน repo | แก้ข้อความ/สีแล้ว render ซ้ำได้ ไม่ต้องใช้โปรแกรมกราฟิก |
| 2026-10-22 | T1–T2 ส่งก่อน · T3 แยก PR หลัง #177 merge | #177 แก้ `PublicWelcome.tsx` อยู่ ไม่อยากให้ชนกัน |
