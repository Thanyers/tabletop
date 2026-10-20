# CLAUDE.md — Tabletop

กฎเฉพาะโปรเจกต์นี้ ใช้ **ทับบน** global `~/.claude/CLAUDE.md` · ข้อไหนไม่ได้เขียนไว้ที่นี่ ให้ใช้ตาม global

## โปรเจกต์นี้ไม่ต่อ phak

โปรเจกต์นี้ **ตั้งใจไม่ใช้ phak** — ไม่ใช่ "phak ต่อไม่ติด" จึงไม่ต้องเตือนทุก session ว่าข้าม task tracking
ข้อใน global ที่อ้าง phak ให้ใช้ตามนี้แทน:

| กฎ global | ในโปรเจกต์นี้ |
| --- | --- |
| TASK TRACKING (phak board, `post_task_log`) | ติดตามงานใน [`spec.md`](spec.md) หัวข้อ **งานที่กำลังทำ** และ **ถัดไป** + branch/PR บน GitHub · ห้ามเรียก phak MCP หรือ `phak-updater` |
| DOCS → phak KB | เอกสารที่ผูกกับโค้ด (`docs/`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`) ส่งผ่าน PR ตามแบบเดิมของ repo · รายงาน/หลักฐานที่มี room ID, account, invite link หรือข้อมูลผู้ใช้ เก็บใน `test-results/` (ignored) เท่านั้น |
| DEPLOY FAILURE LOG (phak project) | บันทึกลง [`MEMORY.md`](MEMORY.md) หัวข้อ Deploy failures พร้อมเวลาที่ fail (จาก log ไม่ใช่ "ตอนนี้") และเวลาที่แก้ |
| GIT FLOW (develop/release/hotfix) | repo นี้ **ไม่ใช้ Git Flow** · แตก `feat/*` หรือ `docs/*` จาก `main` → PR กลับ `main` → คน merge (ดู [CONTRIBUTING](CONTRIBUTING.md)) |

## Spec-driven workflow

1. **เริ่ม session:** อ่าน [`spec.md`](spec.md) และ [`MEMORY.md`](MEMORY.md) ก่อนทำอะไร แล้วเช็ค `git status` / `git log -1` ว่าตรงกับที่ spec บอก
2. **ก่อนลงมือ:** เขียนงานลง `spec.md` → **งานที่กำลังทำ** (เป้าหมาย, ขอบเขต, ไฟล์ที่คาดว่าจะแตะ, วิธีตรวจ)
3. **ระหว่างทำ:** ถ้าตัดสินใจเรื่อง design/contract ให้บันทึกใน **การตัดสินใจ** ของ `spec.md` ทันที ไม่รอจบงาน
4. **จบงาน:** ย้ายงานจาก "กำลังทำ" ไป "สถานะปัจจุบัน" พร้อมหลักฐานตรวจ (คำสั่ง + ผล) และอัปเดต "ถัดไป" · ถ้า interface/contract เปลี่ยน ให้อัปเดตเอกสารเจ้าของเรื่องใน `docs/` ด้วย
5. **พลาด/เจอกับดัก:** บันทึกลง `MEMORY.md` แบบสามช่อง *what happened / root cause / correct behavior*

ห้ามบอกว่า "เสร็จ" ถ้ายังไม่ได้อัปเดต `spec.md`

`spec.md` เป็น **สรุปสถานะ + ตัวชี้ทาง** ไม่ใช่สำเนาเอกสาร · รายละเอียดอยู่ในเอกสารเจ้าของเรื่อง (ดู [docs/README.md](docs/README.md)) อย่าคัดลอกเนื้อหาซ้ำ ให้ลิงก์

## ⚠️ Repo นี้เป็น public

`CLAUDE.md`, `spec.md`, `MEMORY.md` ถ้า commit แล้ว **ทุกคนบนอินเทอร์เน็ตอ่านได้** และอยู่ในประวัติ git ถาวร
ห้ามใส่: secret/token, Worker/D1 ID จริง, room/account ID, invite link, อีเมล/ชื่อผู้ใช้จริง, path ในเครื่องส่วนตัว
รัน `node scripts/check-public-files.mjs` ก่อน commit ทุกครั้ง

## ข้อเท็จจริงที่ต้องรู้ก่อนแตะโค้ด

- Node **22.23.2** ตาม CI (`engines >=22.13.0`) · เครื่องที่ใช้ Node รุ่นอื่นให้ระบุไว้ในรายงานผลตรวจ
- `npm start` = Node guest runtime, **AI ปิด** · เส้นทางใกล้ production = Cloudflare emulator/tests (`npm run test:cloudflare`, `dev:cloudflare`)
- `npm run build:cloudflare` เป็น **dry run** ไม่ deploy · CI ไม่มี deploy step · การ deploy เป็นงานของ operator (คน)
- ห้ามเพิ่ม scenario-name switch ให้เคสตัวอย่างผ่าน · คง server authority, private projections, AI consent, human confirmation
- การเขียนฐาน/เปลี่ยน schema ถาวร = **R0** ต้องได้อนุมัติพร้อม environment/ขอบเขต/แผนกู้คืน (ดู [TEAM_HANDOFF_TH](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน))
- สถานะ deploy ที่ถูกต้องดูจาก [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) เท่านั้น ไม่เชื่อ SHA ที่มากับข้อความแชท/handoff

## ตรวจงาน (เลือกตามส่วนที่เปลี่ยน)

```bash
node scripts/check-public-files.mjs
npm test
npm run build
npm run test:cloudflare
npm run build:cloudflare
```

browser checks บน Mac เครื่องนี้ (ต้อง `build` + `build:cloudflare` ก่อน · ค่าเริ่มต้นของเทสต์คือ `msedge` ซึ่งไม่มี):

```bash
BROWSER_CHANNEL=chrome npm run test:cloudflare:browser
```

รายละเอียดเพิ่มเติมดู [CONTRIBUTING](CONTRIBUTING.md#ตรวจงาน)
