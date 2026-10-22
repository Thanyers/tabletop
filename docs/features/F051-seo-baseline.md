# F051 — SEO พื้นฐาน: preview ตอนแชร์ลิงก์, noindex หน้าในแอป, 404 จริง, robots/sitemap

| | |
| --- | --- |
| สถานะ | `review` (PR #176) |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | PATCH — เพิ่ม meta tag, ไฟล์ static และ header เท่านั้น ไม่มี schema/binding/secret · rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F051-T*` |

## ทำไม

ตรวจ production `https://tabletop.ptchrr.workers.dev/` เมื่อ 2026-10-22 (curl แบบไม่มี cookie):

- แชร์ลิงก์ใน LINE / Facebook / Slack / X แล้วไม่มีรูปและหัวข้อ เพราะ HTML ดิบไม่มี `og:*` / `twitter:*` และบอทพวกนี้ไม่รัน JS
- ทุก path ตอบ `200 text/html` ด้วย HTML ชุดเดียวกัน รวม `/t/<uuid>`, `/join`, `/new`, `/robots.txt`, `/sitemap.xml`, `/favicon.ico` และ path มั่วอย่าง `/asdf` ทำให้ URL โต๊ะที่หลุดออกไปถูกเก็บเป็นหน้าซ้ำของ landing ได้ (ข้อมูลในโต๊ะไม่รั่ว เพราะมี auth gate)
- ไม่มี `robots.txt`, `sitemap.xml`, canonical และ `apple-touch-icon`

## สิ่งที่ผู้ใช้จะเห็น

1. แปะลิงก์ `/` หรือ `/demo` ในแชท แล้วได้การ์ด preview ที่มีรูป ชื่อ และคำอธิบาย
2. ไม่มีอะไรเปลี่ยนในแอปสำหรับคนที่ล็อกอินแล้ว: `/`, `/new`, `/t/<id>`, `/join`, `/demo` ทำงานเหมือนเดิมทุกอย่าง
3. path ที่ไม่มีอยู่จริงได้สถานะ 404 (หน้าตายังเป็นแอปเหมือนเดิม)

## ขอบเขต

**รวม:**
- meta tag แบบ static ใน `index.html` (OG, Twitter, canonical, apple-touch-icon)
- รูป `og:image` และไอคอนใน `public/`
- `public/robots.txt` และ `public/sitemap.xml`
- Worker ส่ง `X-Robots-Tag: noindex, nofollow` ให้ route ของแอป และตอบ 404 ให้ path ที่ไม่รู้จัก
- เทสต์ของทั้งหมดนี้

**ไม่รวม:** (แยกเป็นงานหลังจากนี้)
- เปลี่ยนภาษาหรือ copy ของ landing (รอคนตัดสิน ดูคำถามเปิด)
- prerender landing และแยก bundle ของ landing ออกจาก `calm-workspace` / canvas
- JSON-LD
- custom domain
- แก้ redirect ของหน้า `/` ที่พาเข้าโต๊ะเอง (เป็นงานแยก)
- ยื่น sitemap ใน Search Console (เจ้าของบัญชีต้องทำเอง)

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-22)

- `wrangler.jsonc`: `assets.not_found_handling = "single-page-application"` และ `run_worker_first = ["/api/*", "/healthz", "/readyz", "/version", "/internal/*"]` ทำให้ทุก path ที่ไม่ใช่ API ได้ `index.html` พร้อม 200 โดยไม่ผ่าน Worker
- `index.html`: มีแค่ charset, viewport, theme-color, description (ไทย), title (ไทย), icon `favicon.svg` และ `lang="th"`
- `public/`: มีแค่ `_headers`, `data/`, `demo-art/`, `favicon.svg`, `samples/` ส่วน `_headers` มี CSP `img-src 'self' data: blob:` (ไม่กระทบ og:image เพราะบอทดึงรูปเอง)
- route ของแอปฝั่ง client อยู่ใน `src/tabletop/routes.ts` (`/`, `/new`, `/join`, `/t/<uuid v4>`) และ `src/main.tsx` มี `/demo`, `/demo/replay` และรับ `?legacy-demo=1`
- `PUBLIC_ORIGIN` = `https://tabletop.ptchrr.workers.dev` (อยู่ใน `vars` ของ `wrangler.jsonc`)
- รูปที่ crop เป็น og:image ได้: `docs/showcase/tabletop-story-poster.png`

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | meta tag ใน `index.html`: `og:title`, `og:description`, `og:type=website`, `og:url`, `og:image` (absolute URL, ไฟล์ชื่อคงที่ใน `public/` ไม่ผ่าน hash ของ Vite, 1200×630), `og:image:alt`, `twitter:card=summary_large_image`, `<link rel="canonical" href="https://tabletop.ptchrr.workers.dev/">`, `apple-touch-icon` 180×180 | `curl` HTML ดิบของ build เจอทุกแท็ก · รูปเปิดได้ที่ path คงที่ · เทสต์ที่อ่าน `dist/index.html` ผ่าน |
| T2 | `public/robots.txt` (`Allow: /`, `Disallow: /api/`, `Sitemap: <origin>/sitemap.xml`) **ห้าม** Disallow `/t/` เพราะ Google จะอ่าน noindex ใน path ที่ถูกบล็อกไม่ได้ · `public/sitemap.xml` มีแค่ `/` และ `/demo` | `/robots.txt` ได้ `text/plain` และ `/sitemap.xml` ได้ XML ทั้งบน emulator และ build |
| T3 | Worker คุม HTML route: เพิ่ม path ของแอปใน `run_worker_first` หรือจัดการ 404 ใน Worker แล้วตอบ: `/`, `/demo`, `/demo/replay` = 200 ไม่มี noindex · `/new`, `/join`, `/t/<uuid>` = 200 + `X-Robots-Tag: noindex, nofollow` · path อื่นที่ไม่ใช่ asset = **404** + `index.html` + noindex · asset ที่มีจริงยังเสิร์ฟตรงพร้อม header จาก `_headers` | เทสต์ Cloudflare (`npm run test:cloudflare`) ครอบทุกกลุ่มข้างต้น และไม่ทำให้ asset, `/api/*`, `/healthz`, `/version`, OAuth callback, invite (`/join#invite=…`) และ deep link `/t/<id>` หลังล็อกอินพัง |
| T4 | เอกสาร: `spec.md`, `CHANGELOG.md` (ใต้ `Unreleased`), แถวใน `PLAN.md`, ส่วนการตัดสินใจในไฟล์นี้ | `node scripts/check-public-files.mjs` ผ่าน · CI `local-validation` เขียว |

T3 แตะ `cloudflare/index.ts` และ `wrangler.jsonc` ซึ่งเป็น hotspot ให้ merge `dev` เข้า branch บ่อย ๆ

## คำถามเปิด

1. **ภาษาหลักของ landing:** ตอนนี้ `lang="th"` และ title/description เป็นไทย แต่ h1 (`PublicWelcome.tsx:53`) กับเนื้อหาเกือบทั้งหน้าเป็นอังกฤษ ต้องให้คนเลือกภาษา งานนี้จึงไม่แตะ copy · ระหว่างนี้ให้ `og:title` / `og:description` ใช้ข้อความเดียวกับ `<title>` / description เดิม
2. **รูปตอนแชร์ลิงก์:** ถ้าเจ้าของยังไม่ได้ให้รูป ใช้รูปที่ crop จาก `docs/showcase/tabletop-story-poster.png` ไปก่อน

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | กันหน้าในแอปไม่ให้ติด index ด้วย `X-Robots-Tag` ไม่ใช่ `Disallow` ใน robots.txt | crawler ที่ถูก Disallow จะไม่เห็น noindex และยังเก็บ URL ได้ |
| 2026-10-22 | prerender landing / แยก bundle เป็นงานถัดไป | ทำให้ PR นี้เล็กและ rollback ได้ทันที |
| 2026-10-22 | T3 ใช้ `not_found_handling: "none"` แทนการเพิ่ม path ของแอปใน `run_worker_first` · asset จริงและ `/` ยังเสิร์ฟจาก asset server ตรง (ใช้ `_headers` เดิม) ส่วน path อื่นตกมาที่ Worker | ไม่ต้องดูแลรายการ path สองที่ · Worker ไม่ต้องรันทุกครั้งที่โหลด JS/รูป · HTML ที่ Worker ส่งได้ security header จาก `secured()` ชุดเดียวกับ `_headers` |
| 2026-10-22 | รายการ route ของแอปใน Worker มาจาก `parseRoute` ตัวเดียวกับ client (ย้ายฟังก์ชัน pure ไป `src/tabletop/shared/route-paths.ts`, `routes.ts` re-export) | route ใหม่ของ client (เช่น `/tables` ใน PR #177) ได้ 200 + noindex เองโดยไม่ต้องแก้ Worker · `routes.ts` เดิมใช้ `window` จึง import ใน Worker ไม่ได้ |
| 2026-10-22 | path ที่มีนามสกุลไฟล์แต่ไม่มีไฟล์ (เช่น `/favicon.ico`, chunk เก่า) = 404 `text/plain` ไม่ส่ง `index.html` | ไม่ส่ง HTML ไปให้ `<script>`/`<img>` · 404 สำหรับบอทเล็กลง |
| 2026-10-22 | หน้า HTML ตอบก่อนการตรวจ `PUBLIC_ORIGIN` | ตรงกับพฤติกรรมเดิมตอน asset server ตอบเอง (เปิด `localhost` แทน `127.0.0.1` ตอน dev ได้) · การตรวจ origin มีไว้กัน API |
| 2026-10-22 | `og:url`/canonical/รูปชี้ production เสมอ แม้บน staging | ตามเกณฑ์ T1 · staging ไม่ได้อยู่ใน sitemap · กัน index staging เป็นงานแยก |
| 2026-10-22 | `og:image:alt` เป็นภาษาไทยให้ตรงกับ `<title>`/description เดิม | ไม่ตัดสินภาษาของ landing (คำถามเปิดข้อ 1) |
