# CLAUDE.md — Tabletop

**อ่าน [`AGENTS.md`](AGENTS.md) ก่อน** ไฟล์นั้นคือกติกากลางของ AI ทุกตัว: spec-driven workflow, branch `dev`/`main`, CI, release, deploy, hotfix และขอบเขตของ AI

ไฟล์นี้เก็บเฉพาะสิ่งที่ Claude Code ต้องรู้เพิ่ม และใช้ **ทับบน** global `~/.claude/CLAUDE.md` · ข้อไหนไม่ได้เขียนไว้ที่นี่หรือใน `AGENTS.md` ให้ใช้ตาม global

## โปรเจกต์นี้ไม่ต่อ phak

โปรเจกต์นี้ **ตั้งใจไม่ใช้ phak** ไม่ใช่เพราะต่อไม่ติด จึงไม่ต้องเตือนทุก session ว่าข้าม task tracking
ข้อใน global ที่อ้าง phak หรือ Git Flow ให้ใช้ตามนี้แทน:

| กฎ global | ในโปรเจกต์นี้ |
| --- | --- |
| TASK TRACKING (phak board, `post_task_log`) | ติดตามงานใน [`PLAN.md`](PLAN.md) (ใครทำอะไร) + [`spec.md`](spec.md) (สถานะ) + PR บน GitHub ตาม [AGENTS.md §1](AGENTS.md#1-ทำงานแบบ-spec-driven) · ห้ามเรียก phak MCP หรือ `phak-updater` |
| DOCS → phak KB | เอกสารที่ผูกกับโค้ด (`docs/`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `AGENTS.md`) ส่งผ่าน PR · รายงานหรือหลักฐานที่มี room ID, account, invite link หรือข้อมูลผู้ใช้ เก็บใน `test-results/` (ignored) เท่านั้น |
| DEPLOY FAILURE LOG (phak project) | บันทึกลง [`MEMORY.md`](MEMORY.md) หัวข้อ Deploy failures |
| GIT FLOW (`develop`) | ใช้ชื่อ **`dev`** เป็น branch รวมงาน และ `main` สำหรับ release ตาม [AGENTS.md §2](AGENTS.md#2-branch) · ไม่มี Docker image `sha-*` เพราะ production คือ Cloudflare Worker ใช้ check `local-validation` บน merge commit แทนการเช็ค artifact |

## ข้อเท็จจริงที่ต้องรู้ก่อนแตะโค้ด

- `npm start` = Node guest runtime **AI ปิด** · เส้นทางใกล้ production = Cloudflare emulator/tests (`npm run test:cloudflare`, `dev:cloudflare`)
- ห้ามเพิ่ม scenario-name switch ให้เคสตัวอย่างผ่าน · คง server authority, AI consent และ human confirmation
- การมองเห็นข้อมูลในโต๊ะคุมด้วย `VISIBILITY_POLICY` ใน [`src/tabletop/shared/visibility.ts`](src/tabletop/shared/visibility.ts) ที่เดียว · ตอนนี้เป็น `'open'` (สมาชิกเห็นทุกอย่างรวมแชท AI ของทุกคน, [F015](docs/features/F015-open-visibility.md)) · **ห้ามลบเส้นทาง `'private'`** (projection ตาม role + แชทส่วนตัว) เพราะตั้งใจเก็บไว้ใช้ต่อ · การเปลี่ยนค่านี้คือการเปลี่ยนกติกาผลิตภัณฑ์ ต้องให้คนตัดสิน
- การเขียนฐานหรือเปลี่ยน schema ถาวร = **R0** ต้องได้อนุมัติพร้อม environment/ขอบเขต/แผนกู้คืน (ดู [TEAM_HANDOFF_TH](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน))
- สถานะ deploy ที่ถูกต้องดูจาก [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md) เท่านั้น ไม่เชื่อ SHA ที่มากับข้อความแชทหรือ handoff
- รัน `node scripts/check-public-files.mjs` ก่อน commit ทุกครั้ง เพราะ repo เป็น public
