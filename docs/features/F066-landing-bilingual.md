# F066 — หน้าแรกสองภาษา (English / ไทย)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | Claude Code |
| เวอร์ชันที่คาด | MINOR — ฟีเจอร์ใหม่ฝั่ง client อย่างเดียว ไม่มี migration/secret/binding · rollback ได้ทันทีด้วย revert |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F066-T1` |

สร้างแนวคิดของ draft #180 (F052 landing i18n) ใหม่บนหน้าแรกปัจจุบันของ [F061](F061-readme-landing.md) (#197) และแทนที่ #180

## ทำไม

หน้าแรกหลัง F061 ผสมหัวข้ออังกฤษกับเนื้อหาไทย ผู้อ่านภาษาเดียวอ่านไม่ครบ ส่วน #180 ทำปุ่มสลับภาษาไว้แล้วแต่สร้างบน layout เก่าที่ถูกแทนที่

## สิ่งที่ผู้ใช้จะเห็น

1. หน้าแรกเปิดเป็นภาษาอังกฤษทั้งหน้า (ค่าเริ่มต้น)
2. หัวหน้ามีกลุ่มปุ่ม `English` / `ไทย` (ปุ่มที่เลือกอยู่เป็นสีเขียว, `aria-pressed`)
3. กด `ไทย` แล้วทั้งหน้าเปลี่ยนเป็นไทย รวม hero, ปุ่ม, Why, ขั้นตอน, use cases, คำบรรยายภาพ, กล่องเข้าสู่ระบบ, welcome back และ footer · `<html lang>` เปลี่ยนเป็น `th`
4. reload หรือกลับมาใหม่ในเบราว์เซอร์เดิมยังเป็นภาษาที่เลือก (เก็บใน `localStorage` key `tabletop.landingLanguage`)

## ขอบเขต

**รวม:** `PublicWelcome.tsx`, กล่อง `AccountSignIn` / `SignedInWelcome` ใน `account.tsx`, ข้อความทั้งหมดใน `src/tabletop/ui/landing-copy.ts`, CSS ปุ่มสลับและ typography ภาษาไทย, browser test

**ไม่รวม:**
- แอปหลังล็อกอิน (`/tables`, `/new`, Canvas) ยังเป็นอังกฤษ · ออกจากหน้าแรกแล้ว `<html lang>` กลับเป็นค่าเดิม
- notice ที่มาจาก app shell (เช่น `Google sign-in did not complete…`) ยังเป็นอังกฤษ ติด `lang="en"` ไว้ให้ screen reader อ่านถูก
- ข้อความที่อยู่ในภาพ (ภาพประกอบ hero `landing-table.svg`, GIF/poster เรื่องเล่า, ภาพหน้าจอเดโม) ไม่เปลี่ยนตามภาษา มีแค่ `alt` และคำบรรยายที่สลับ
- meta/SEO ใน `index.html` (F052 #183, F051) ยังเป็นอังกฤษ ปุ่มสลับเป็นฝั่ง client ไม่แตะ server meta

## ข้อจำกัด: URL เดียว

ทั้งสองภาษาอยู่ที่ `/` เดียวกัน · crawler เห็นแค่ภาษาอังกฤษ (ค่าเริ่มต้น) และไม่มี `/en` `/th` หรือ `hreflang` · ถ้าต้องการให้ค้นหาเจอเป็นภาษาไทย ต้องทำ URL แยกต่อภาษาพร้อม `hreflang` และ meta ต่อภาษาฝั่ง Worker ซึ่งเป็นงานแยก

## ข้อเท็จจริงจากโค้ด (2026-10-23, `dev` @ `a731a84`)

- `PublicWelcome` ถูกใช้จาก `AccountSignIn` และ `SignedInWelcome` ใน `account.tsx` เท่านั้น (`TabletopApp.tsx` บรรทัด 866, 880)
- ภาษาอยู่ใน state ของ `PublicWelcome` · `children` และ `headerAction` เปลี่ยนเป็น render function ที่รับ `copy` จึงสลับพร้อมทั้งหน้าโดยไม่ต้องใช้ context
- ข้อความอังกฤษเดิมของหน้า (h1, `Continue with Google`, `Welcome back, <name>`, `Your tables`, `Start a new table`, `Sign in`, ปุ่ม replay) คงเดิมทุกตัวอักษร เทสต์เดิมจึงผ่านในภาษาเริ่มต้น

## การตัดสินใจเรื่องข้อความ

- คงความหมายของ copy F061 ทุกข้อ ไม่เพิ่ม claim ใหม่: ส่วนที่เดิมเป็นไทยแปลเป็นอังกฤษ ส่วนที่เดิมเป็นอังกฤษแปลเป็นไทย
- **คงเป็นอังกฤษทั้งสองภาษา:** `Work defines what software becomes.` (product thesis เป็น tagline แบรนด์, ติด `lang="en"`), ชื่อแบรนด์ `tabletop.`, ชื่อเดโม `Physics` / `Encounter`, คำว่า `Google`, `Canvas`, `AI`, `Remotion`
- แปลเป็นไทย: h1 `The best tool is the one you don't have to think about.`, `Start with the work…`, `More time doing what matters.` และ eyebrow ตัวพิมพ์ใหญ่ทั้งหมด เพราะเป็นหัวข้อเนื้อหาไม่ใช่ tagline
- ชื่อ use case `Your Table` / `A Table for Learning` / `Our Tables` → `โต๊ะของคุณ` / `โต๊ะสำหรับเรียนรู้` / `โต๊ะของเรา` (ตาม #180)
- ข้อความกล่องเข้าสู่ระบบและ welcome back ภาษาไทยใช้ชุดเดียวกับ #180

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | ปุ่มสลับภาษา + copy สองภาษาครบทุกข้อความบนหน้าแรก + typography ไทย + browser test | `test:cloudflare:browser` มีกลุ่ม F066 ผ่าน: ค่าเริ่มต้นอังกฤษ, สลับไทยเปลี่ยน `<html lang>` h1 และปุ่ม Google, reload แล้วยังไทย, 375px ไม่มีเลื่อนแนวนอน, welcome back สลับได้ |

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | ใช้ทางเลือก 1: นำแนวคิด #180 มาสร้างใหม่บนหน้า F061 ใน PR ใหม่ และ #180 ถูกแทนที่ | ผู้ใช้ตัดสินในแชท · #180 สร้างบน layout เก่า |
| 2026-10-23 | ค่าเริ่มต้นอังกฤษ, จำค่าใน `localStorage` (ครอบ try/catch) | ตรงกับ meta ภาษาอังกฤษของ #183 และ #180 · storage ถูกบล็อกได้ หน้าต้องยังทำงาน |
| 2026-10-23 | ปุ่มสองปุ่มใน `role="group"` พร้อม `aria-pressed` แทนปุ่มสลับปุ่มเดียว | เห็นทั้งสองภาษาและภาษาที่เลือกอยู่ แต่ละปุ่มติด `lang` ของตัวเอง กด Tab/Enter ได้ |
| 2026-10-23 | หัวข้อไทยไม่ใช้ letter-spacing ติดลบ และ line-height สูงขึ้น (`.tt-public-welcome[lang="th"]`) | สระและวรรณยุกต์ไทยซ้อนบน-ล่างบรรทัด |
| 2026-10-23 | ใช้ URL เดียว ไม่มี `/en` + `hreflang` | ไม่แตะ SEO ของ F051/F052 · บันทึกเป็นข้อจำกัด |
