# F085 — การ์ดไม่หายวับตอนโต๊ะอัปเดต (คลิก checkbox ไม่หลุดไปโดนพื้นหลัง)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | PATCH — แก้บั๊ก UI ฝั่งเบราว์เซอร์ ไม่มี migration rollback ได้ทันที |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F085-T1` |

## ทำไม

ทดสอบติ๊ก checkbox บน staging หลัง F082 (2026-10-26) แล้วบางคลิกยังหาย แม้เว้นห่าง 3 วินาที · log event ในหน้าเว็บพบว่าคลิกที่หายไปโดน `react-flow__pane` (พื้นหลัง canvas) ไม่ใช่ checkbox · วัดด้วย `elementFromPoint` ทุกเฟรม: ทุก ~0.8 วินาที การ์ดได้ `visibility: hidden` ราว 250 ms ทั้งที่ตำแหน่งและขนาดไม่เปลี่ยน

สาเหตุ: React Flow v12 ซ่อน node ที่ยังไม่มี `measured` (`visibility: hidden` จนกว่า ResizeObserver จะวัดใหม่) และรับ `measured` จาก object ที่ส่งเข้าไปเท่านั้น · effect ที่สร้าง node ใน `CanvasWorkspace` สร้าง object ใหม่ทุกใบโดยไม่มี `measured` ทุกครั้งที่ `view`/`busy`/state อื่นเปลี่ยน การ์ดทุกใบจึงหายแล้ววัดใหม่ทุกครั้งที่โต๊ะอัปเดต (และเป็นส่วนหนึ่งของงาน ResizeObserver 10 วินาทีที่เจอใน [F084](F084-edge-routing-speed.md))

## สิ่งที่เปลี่ยน

- `ui/CanvasWorkspace.tsx`: ตอนสร้าง node ใหม่ ส่ง `measured` เดิมของการ์ดนั้นไปด้วย (`keepMeasured`) · การ์ดที่เปลี่ยนขนาดจริง ResizeObserver ของ React Flow ยังวัดใหม่ตามปกติ
- `tests/generic-table-browser.mjs`: `performAction` เฝ้าทุก 8 ms ระหว่างรันคำสั่ง ว่าไม่มีการ์ดที่เห็นอยู่กลายเป็น `visibility: hidden` (`watchCardsStayVisible` / `cardsThatBlinked`)

## ผลตรวจ

- local Chrome (แท็บอยู่หน้า, โต๊ะทดสอบ 5 การ์ด, คลิก checkbox 4 ครั้งใน 5 วินาที): โค้ดเดิม **65 เฟรมที่การ์ดหาย** (ทั้ง 5 ใบ) · โค้ดใหม่ **0 เฟรม** (288 เฟรม) · รันคำสั่งผ่านฟอร์ม Actions: 0 การ์ดหาย, React Flow ตัวเดิม
- unit 1230 / 5 skipped, `test:cloudflare` 341, lint 0 errors, build + build:cloudflare ผ่าน
- browser suite: โค้ดเดิมล้มที่เช็คใหม่ (`performAction` → การ์ด 14 ใบหาย) · โค้ดใหม่ **35 PASS** สองรอบติด
- หมายเหตุ: ตอนแผง Browser ของแอปถูกซ่อน (แท็บอยู่เบื้องหลัง) ResizeObserver ไม่ทำงาน การ์ดจึงซ่อนตลอด วัดผลต้องใช้แท็บที่อยู่หน้าเท่านั้น
