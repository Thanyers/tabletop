# F091 — ค้นเว็บพอสำหรับงานรวบรวมรายการ และหาอันดับจากตัวชี้วัดจริง

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — ขยายขอบเขต research (ไม่มี migration) rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F091-T1` |
| ต่อจาก | [F064](F064-web-search.md), [F090](F090-research-not-evidence.md) |

## ทำไม

ทดลองบน staging (2026-10-27) ขอ "ไทม์ไลน์มังงะ BL ปี 2026 รายเดือน เดือนละ 3 เรื่องที่ดังที่สุด" ได้ตารางแค่ 4 เรื่อง ช่องอันดับว่าง:

- research จำกัด 2 รอบ / 6 แหล่ง / brief 600 ตัวอักษร (เก็บได้ 1,200) และค้นทีละ query (`server/providers/deepseek-research.ts`)
- prompt ของ research บอกให้ค้นเฉพาะ "statistics, standards, formulas, constants, dates, laws" ไม่มีแนวทางสำหรับรายการหลายช่วง โมเดลจึงค้นแค่ 2 query กว้าง ๆ
- คำว่า "ดังที่สุด" ไม่มีตัวชี้วัดในผลค้น และไม่มีคำสั่งให้หาตัวชี้วัด

## สิ่งที่เปลี่ยน

- research: query ในรอบเดียวกันค้นพร้อมกัน (สูงสุด 6 ต่อรอบ) · 3 รอบภายในงบเวลารวม · เก็บ 12 แหล่ง · brief 2,400 ตัวอักษรแบบบรรทัด `รายการ | วันที่ | URL`
- prompt research: งานรวบรวมรายการให้แยก query ตามช่วง/หมวด · ขอ "ยอดนิยม/ขายดี/อันดับ" ให้หาตัวชี้วัดจริง (bestseller, อันดับในแอป, รางวัล) และระบุชื่อตัวชี้วัด ถ้าไม่พบให้บอกว่าไม่ทราบ
- ขอบเขต input ของ drafter และ metadata ของ job ขยายตาม (12 แหล่ง, 12 query)

- (พ่วง) `eslint.config.js` ignore `sandbox-assets/runtime.js` ที่ `npm run build` สร้าง (git ignore อยู่แล้ว แต่ eslint ไม่ ignore → หลัง build รัน lint ได้ 1,469 errors)

## ผลตรวจ

- local `wrangler dev` + DeepSeek จริง คำขอเดียวกับ staging ("ไทม์ไลน์มังงะ BL 2026 รายเดือน เดือนละ 3 เรื่องที่ดังที่สุด…"):

  | | ก่อน (staging) | หลัง F091 (local) |
  | --- | --- | --- |
  | query | 2 กว้าง ๆ | 4 รวม "boys love manga bestseller ranking 2026" |
  | แหล่ง | 6 | 11 |
  | เรื่องในตาราง | 4 | 12 พร้อมวันออก (BookLive, comico, honto) |
  | อันดับ | ว่าง | ระบุตัวชี้วัด (BL Award 2026 nominee, honto ranking) และบอกตรง ๆ ว่าไม่มีอันดับรายเดือน |

  ข้อจำกัด: ลองครั้งเดียว · ยังไม่ครบ 12 เดือน × 3 เพราะเว็บไม่มีข้อมูลอันดับรายเดือน
- unit: `deepseek-research.test.ts` (ค้นพร้อมกัน ≤6 ต่อรอบ ตอบทุก tool call · หยุดเมื่อเกินงบเวลา) · `deepseek-changes-research.test.ts` (12 แหล่งผ่าน 13 ไม่ผ่าน) · `cloudflare/ai.test.ts` (ตัด query ตามเพดานใหม่)
- ทั้งชุด (Node 26.3.1): unit 1315 passed / 5 skipped · `test:cloudflare` 354 · `test:cloudflare:browser` 35 PASS · lint 0 errors · build + build:cloudflare ผ่าน
