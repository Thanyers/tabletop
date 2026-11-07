# F092 — แปะรูปจากลิงก์ (ภาพปกจากหน้าเว็บทางการ)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — route ใหม่ + เมนูใหม่ ไม่มี migration (ใช้ `room_images` เดิม) rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F092-T1` |
| ต่อจาก | [F073](F073-image-cards.md), [F076](F076-composer-images.md) |

## ทำไม

ทดลองบน staging (2026-10-27) ขอไทม์ไลน์มังงะพร้อม "ภาพปก" แต่ช่องภาพปกว่างทุกแถว: ผลค้นเว็บเป็นข้อความอย่างเดียว และการแปะรูปบน canvas (F073/F076) ต้องอัปโหลดไฟล์จากเครื่องเท่านั้น ส่วนรูปจากเว็บภายนอกแสดงตรง ๆ ไม่ได้เพราะ CSP `img-src 'self' data: blob:`

## สิ่งที่เปลี่ยน

- เมนู + มี "Image from a link": วางลิงก์รูป หรือลิงก์หน้าเว็บ (เช่นหน้าหนังสือของสำนักพิมพ์/ร้าน) → server ดึงรูปมาให้ (หน้าเว็บใช้ `og:image`/`twitter:image`) → รูปรอในช่องแชทเหมือนรูปที่เลือกจากเครื่อง (F076) → ส่งเพื่อแปะเป็นการ์ดรูป · คำบรรยายต่อท้าย "ที่มา: <ลิงก์>" อัตโนมัติ
- route `POST /api/workspaces/:id/images/from-link` ใน Room (สิทธิ์เท่ากับอัปโหลดรูป, ผ่าน CSRF/rate limit เดิม) คืน bytes ของรูปที่ตรวจแล้ว ไม่เก็บอะไรเพิ่ม — ย่อและเก็บผ่านทางอัปโหลดเดิม

## ความปลอดภัย (ตัดสินใจ)

- รับเฉพาะ `http(s)` พอร์ต 80/443 ไม่มี user:pass ใน URL · ปฏิเสธ IP ตรง ๆ (v4/v6), `localhost`, ชื่อที่ไม่มีจุด และ `.local/.internal/.localhost/.test`
- ตาม redirect เองไม่เกิน 3 ครั้ง ตรวจซ้ำทุกปลายทาง · หมดเวลารวม 10 วินาที
- หน้า HTML อ่านไม่เกิน 512 KiB · รูปไม่เกิน 8 MiB (ย่อในเบราว์เซอร์ก่อนเก็บ ≤ 1.5 MiB ตามเดิม) · ตรวจชนิดจาก magic bytes (JPEG/PNG/WebP) ไม่เชื่อ Content-Type
- ไม่ส่ง cookie/credential ของผู้ใช้ไปเว็บปลายทาง (fetch จาก server)

- `cloudflare/image-link.ts` (ตรวจลิงก์ + ดึงรูป), route ใน `cloudflare/room.ts` / `room-http.ts`, Worker จำกัด 20 ครั้ง/นาที/คน (`cloudflare/index.ts`), `client.imageFromLink`, ช่องลิงก์ใน `ui/TableChat.tsx`, `imageCaption` ใน `ui/NoteCard.tsx`

## ผลตรวจ

- local `wrangler dev` + Chrome บนโต๊ะไทม์ไลน์มังงะ (ลิงก์ทางการที่ AI หาได้จาก F091):
  - booklive.jp → JPEG 13 KB (og:image ที่ res.booklive.jp) · nhn-comico.com → PNG 1 MB · aladin.co.kr → JPEG 50 KB · honto.jp → 422 "That link answered 403." (เว็บบล็อกบอท) · ใช้เวลาราว 2–3 วินาทีต่อลิงก์
  - ผ่านหน้าจอ: + → Image from a link → วางลิงก์ booklive → Get picture → รูปปกรอในช่องแชท → พิมพ์ "ปก ม.ค. 2026" → ส่ง → การ์ดรูป 320×547 คำบรรยาย "ปก ม.ค. 2026\nSource: https://booklive.jp/…"
- unit: `cloudflare/image-link.test.ts` 5 (ลิงก์ที่รับ/ปฏิเสธ, og:image, redirect ถูกตรวจซ้ำ, ไม่ส่ง cookie, เกินขนาด/ไม่ใช่รูป/ไม่มีรูป) · `cloudflare/room-images.test.ts` +1 (สมาชิก + CSRF, ลิงก์ภายใน 422, body ผิด 400, คนนอกถูกปฏิเสธ) · `room-http.test.ts` +1 route · `ui/note-image-caption.test.ts` 2
- ทั้งชุด (Node 26.3.1): unit 1315 passed / 5 skipped · `test:cloudflare` 361 · lint 0 errors · typecheck 3 config · build + build:cloudflare ผ่าน
- `test:cloudflare:browser` ในเครื่อง: **ไม่ผ่าน 3 รอบ** ที่จุดต่างกันทุกครั้งซึ่ง F092 ไม่ได้แตะ (หน้า landing รอ networkidle 30 วิ ×2, ปุ่มใน interactive demo 30 วิ, รอบหนึ่งผ่าน 4 ขั้นแรก) ขณะเครื่องมี load average 11–13 · ยังไม่ยืนยัน ให้ชุดเต็มบน dev CI ตรวจหลัง merge

## ข้อจำกัด / ต่อไป

- บางเว็บบล็อกการดึงจาก server (honto 403) → ผู้ใช้ต้องเปิดรูปแล้วคัดลอกลิงก์รูปตรง ๆ หรือบันทึกแล้วอัปโหลด
- การ์ดรูปใหม่ยังวางตามตำแหน่ง note เดิม อาจทับการ์ดอื่น (คำถามเปิดเดิมของ F073)
- ยังไม่มีปุ่ม "ดึงปกจากลิงก์ของแถวนี้" ในตาราง (เช่นจากช่อง `official_url`) — ทำได้เป็นงานต่อ
