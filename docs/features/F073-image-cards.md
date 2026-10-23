# F073 — แปะรูปบน canvas แบบ post-it (การ์ดรูป)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — ฟีเจอร์ใหม่ + ตาราง SQLite ใหม่ใน Room DO แบบเพิ่มอย่างเดียว rollback ได้ (ตารางใหม่แค่ไม่ถูกใช้) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F073-T1` |

## ทำไม

ผู้ใช้อยากแปะรูปประกอบบนโต๊ะได้แบบเดียวกับแปะ post-it (2026-10-23) เช่นรูปใบเสร็จ ภาพสถานที่ หรือภาพอ้างอิง ตอนนี้แนบได้แค่ไฟล์ข้อความ และ post-it เก็บได้แค่ข้อความ 500 ตัวอักษร

## สิ่งที่ผู้ใช้จะเห็น

1. ข้างปุ่ม post-it ข้างช่องแชทมีปุ่ม "Add an image"
2. เลือกรูป JPEG/PNG/WebP → เบราว์เซอร์ย่อด้านยาวสุดเหลือ 1600px แล้วอัปโหลด → การ์ดรูปโผล่บน canvas ตรงที่เดียวกับที่ post-it ใหม่โผล่
3. การ์ดรูปลากย้าย ย่อ/ขยาย และพิมพ์คำบรรยายใต้รูปได้เหมือน post-it ทุกคนในโต๊ะเห็นสด
4. ลบได้โดยคนที่แปะหรือเจ้าของโต๊ะ · โต๊ะหนึ่งมีได้ไม่เกิน 20 รูป

## ขอบเขต

**รวม:** อัปโหลดและแสดงรูปบน Cloudflare Worker (production path) · ตาราง `room_images` · การ์ดรูปใน canvas · ล้างรูปเมื่อรีเซ็ตโต๊ะ และเก็บกวาดรูปที่ไม่มีการ์ดอ้างอิง

**ไม่รวม (v1):**
- ส่งรูปให้ AI อ่าน (OCR/vision) — AI ยังเห็นแค่คำบรรยายใต้รูป
- ลากไฟล์มาวาง / วางจาก clipboard
- Node guest runtime (`npm start`) — ปุ่มซ่อนเมื่อ `/api/capabilities` ไม่ประกาศ `images`

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-23 บน `origin/dev` 214f82c)

- post-it อยู่ใน `TableState.notes` (`shared/table-contracts.ts`) · คำสั่ง `table.addNote|updateNote|moveNote|removeNote` ใน `domain/table.ts` (`handleNoteCommand`) · owner/participant ทำได้ทุกคำสั่ง · สูงสุด 20 ใบ
- Worker ส่ง request ของ `/api/workspaces/:id/...` ที่ตรง regex ใน `cloudflare/index.ts` ต่อให้ Room ทั้งก้อน · ทุก mutation ผ่าน `requireMutation` (Origin + CSRF) และ rate limit ก่อนถึง Room
- Room สร้างตารางจากลิสต์ `TABLES` ใน `room-repository.ts` (`CREATE TABLE IF NOT EXISTS`) ไม่มีระบบ migration อื่น · รีเซ็ตโต๊ะลบข้อมูลใน `persistCommit`
- CSP มี `img-src 'self' data: blob:` อยู่แล้ว · `/api/*` ได้ `Cache-Control: no-store` และ `nosniff`

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | `room_images` + `POST/GET /api/workspaces/:id/images` + `imageId` บน note + การ์ดรูป + ปุ่มอัปโหลด | เทสต์ domain + Room (อัปโหลด/อ่าน/สิทธิ์/ชนิดไฟล์/ขนาด/จำนวน/รีเซ็ต) + typecheck/lint/unit/build + ลองจริงใน local |

## คำถามเปิด

- บทบาท Viewer (F035) ยังเป็น `participant` จึงแปะรูปได้ เหมือนแปะ post-it ได้อยู่แล้ว · ถ้าไม่อยากให้ Viewer แปะ ต้องเพิ่ม permission แยกทั้งใน `handleNoteCommand` และ route อัปโหลด
- การ์ดใหม่วางที่ (640, 40) เมื่อยังไม่มี note ใด ๆ (พฤติกรรมเดิมของ post-it) จึงอาจทับการ์ดอื่น ควรวางกลางมุมมองปัจจุบัน
- v2: ให้ AI อ่านรูป (ต้องเลือกโมเดลที่รับภาพ) · ลากวาง/paste · cache รูปแบบ immutable แทน `no-store`

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | เก็บรูปในตาราง `room_images` ของ Room DO SQLite (ผู้ใช้อนุมัติในแชท) | ไม่ต้องเพิ่ม binding/config ก่อน deploy · เพิ่มอย่างเดียว rollback ได้ |
| 2026-10-23 | สิทธิ์เหมือน post-it แต่ลบการ์ดรูปได้เฉพาะคนแปะหรือ owner (ผู้ใช้เลือก) | กันลบรูปคนอื่นโดยไม่ตั้งใจ |
| 2026-10-23 | อัปโหลดก่อน แล้วสร้างการ์ดด้วย `table.addNote` + `imageId` · รูปที่ไม่มีการ์ดอ้างเกิน 10 นาทีถูกลบตอนอัปโหลดครั้งถัดไป | ใช้ทางคำสั่งเดิม (revision, broadcast, undo ของ note) ไม่ต้องขยาย commit ของ Room |
| 2026-10-23 | server ตรวจ magic bytes (JPEG/PNG/WebP) ไม่เชื่อ Content-Type · ขนาดไม่เกิน 1.5 MiB · ส่งกลับด้วย Content-Type ที่ตรวจได้ + `nosniff` + `Content-Security-Policy: default-src 'none'` | กันไฟล์อื่นปลอมเป็นรูป |

## ผลตรวจ (2026-10-23)

- ลองจริง local (`wrangler dev` บนข้อมูลห้องที่มีอยู่แล้ว → ตาราง `room_images` ถูกเพิ่มเองโดยข้อมูลเดิมยังอยู่): ปุ่ม "Add an image" ขึ้นข้างปุ่ม post-it · รูป PNG 95 KB ถูกย่อเป็น WebP 29.5 KB · การ์ดรูป 320×554 ขึ้นบน canvas · พิมพ์คำบรรยายแล้วบันทึกและใช้เป็น `alt` · `GET` ตอบ `image/webp` + `nosniff` (CSP ของ response ถูก Worker แทนด้วย CSP หลักของแอป ซึ่งไม่อนุญาต script แปลกปลอมอยู่แล้ว) · ภาพใน `test-results/f073-image-cards/` (ignored)
- เทสต์ใหม่ 29 ข้อ: `canvas-images.test.ts` 4, `canvas-image-prepare.test.ts` 8, `table-image-notes.test.ts` 10, `cloudflare/room-images.test.ts` 7 (อัปโหลด/อ่าน/สิทธิ์/ชนิดไฟล์/ขนาด/จำนวน/เก็บกวาด/รีเซ็ต)
