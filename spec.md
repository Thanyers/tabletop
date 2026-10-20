# spec.md — Tabletop

แหล่งความจริงของ **สถานะงาน** โปรเจกต์นี้ (ไม่ใช่แชท) · อัปเดตทุกครั้งที่จบงาน ตามกติกาใน [CLAUDE.md](CLAUDE.md)
รายละเอียดเชิงลึกอยู่ในเอกสารเจ้าของเรื่อง — ไฟล์นี้สรุปและลิงก์ ไม่คัดลอกซ้ำ

อัปเดตล่าสุด: 2026-10-20

## ผลิตภัณฑ์

Canvas ร่วมกันสำหรับสร้างงานหรือเกมจากข้อมูลและกติกา: ผู้ใช้นำไฟล์ข้อความเข้า → AI ร่างตาราง/กฎ/ปุ่มการกระทำ → คนตรวจ
*Simulate → Validate → Approve → Activate* → เชิญคนอื่นมาเล่นบนสถานะเดียวกัน ห้องเป็นหน่วยบันทึกถาวร

- คู่มือผู้ใช้: [docs/USER_GUIDE_TH.md](docs/USER_GUIDE_TH.md)
- ภาพรวมระบบและจุดเริ่มในโค้ด: [docs/TEAM_HANDOFF_TH.md](docs/TEAM_HANDOFF_TH.md)
- ดัชนีเอกสารทั้งหมด: [docs/README.md](docs/README.md)

## สถาปัตยกรรม (สรุป)

| ส่วน | ที่อยู่ในโค้ด | หน้าที่ |
| --- | --- | --- |
| React Canvas | `src/tabletop/` | แสดง projection ตามสิทธิ์ ส่งคำสั่ง — ไม่ใช่ผู้ตัดสิน |
| Domain / interpreter | `src/tabletop/domain/`, `src/tabletop/shared/` | กฎแบบข้อมูล deterministic, ไม่รัน JS ที่ AI เขียน |
| Authority | `server/authority.ts` | ตรวจ role/seat/turn/revision แล้ว commit แบบ atomic |
| Cloudflare Worker + D1 | `cloudflare/index.ts`, `cloudflare/auth.ts` | Google OIDC, session, CSRF, ดัชนี My tables |
| Room DO (SQLite) | `cloudflare/room.ts`, `room-repository.ts` | state/membership/receipts/events ต่อห้อง + WebSocket |
| Billing DO + AI | `cloudflare/billing.ts`, `cloudflare/ai.ts` | จองงบก่อนเรียก DeepSeek, consent, structured output |
| Node local runtime | `server/` | PGlite + guest session, AI ปิด (ใช้พัฒนา ไม่ใช่ production) |

ขอบเขต contract: [GENERIC_TABLE_DESIGN](docs/GENERIC_TABLE_DESIGN.md) · auth/storage: [R1_ARCHITECTURE](docs/R1_ARCHITECTURE.md) · design system: [design.md](design.md)

## สถานะปัจจุบัน

- **Branch หลัก:** `main` @ `48fb2bd` (PR #2–#8 merge แล้ว; PR #8 แก้เฉพาะเอกสาร/showcase ไม่แตะโค้ด) · ไม่มี develop/release branch
- **Deploy:** production รัน `c9d3bf0` (Calm Canvas, PR #6) · staging รัน `bec8e30` (tree เดียวกัน) — แหล่งอ้างอิงคือ [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)
- **Infra:** Cloudflare Workers Free + D1 + SQLite DO + Google OAuth + DeepSeek Flash · ไม่มี R2/Paid · เพดาน AI prod $1/วัน $10/เดือน, staging $0.20/$0.20
- **CI ล่าสุดของ candidate:** unit/SQL 309, Cloudflare 65, Component Lab 7, browser acceptance ผ่าน ([DEPLOYMENTS](docs/DEPLOYMENTS.md#ผลตรวจ-release-ล่าสุด))
- **Local (2026-10-20, เครื่องนี้):** clone `main` @ `e8cb73e` แล้ว pull เป็น `48fb2bd` → `npm ci` (0 vulnerabilities) → `npm run build` ผ่าน → `npm start` เปิด `:4310` ได้ ใช้ Node v26.3.1 (ไม่ตรง CI 22.23.2) · `npm run test:cloudflare` 65/65 ผ่าน (room 28, auth 13, ai 9, table-assistant 8, billing 7) ตรงกับจำนวนใน CI · `test:cloudflare:browser` 16/16 ผ่าน (ใช้ `BROWSER_CHANNEL=chrome` หลัง `build:cloudflare`)
- **`/version` — [PR #10](https://github.com/Thanyers/tabletop/pull/10) รอ review/merge (branch `feat/version-endpoint`):** `GET /version` → `{"version","sha","built_at"}` ทั้ง Worker และ Node อ่านจาก `dist/version.json` ที่ build เขียน · ตรวจแล้ว: `npm test` 314/314, `npm run build` ผ่าน, `test:cloudflare` 65/65, `build:cloudflare` dry run, `test:cloudflare:browser` 17/17 (มี check `/version`), curl `:4310/version` → 200 `no-store`, `check-public-files` + `check-client-secrets` ไม่มี finding
- **Spec-driven setup:** `CLAUDE.md` / `spec.md` / `MEMORY.md` (ไม่ใช้ phak) — PR แยก branch `docs/spec-driven`

### ข้อจำกัดผลิตภัณฑ์ที่มีผล

- ไฟล์โต๊ะทั่วไป: UTF-8 CSV/JSON/TXT/MD, 32 KiB/ไฟล์, 4 ไฟล์, รวม 64 KiB · ไม่รับ PDF/ภาพ/ไบนารี
- AI context: สถานะปัจจุบัน + ≤6 คู่/16 KiB, คำขอ ≤48 KiB, ≤500 assistant jobs/ห้อง · ไม่มีความจำระยะยาว
- ห้อง: เจ้าของ + สมาชิก ≤7 · invite ใช้ครั้งเดียว หมดอายุ 10 นาที
- เปลี่ยนโครงสร้างตารางระหว่างเล่นไม่ได้

### ยังไม่ได้พิสูจน์

มือถือ/สองอุปกรณ์จริง, load/soak, live budget-negative, กู้คืน D1 + Room + Billing ทั้งระบบ, automated a11y audit

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-20 | โปรเจกต์นี้ไม่ใช้ phak; ติดตามงานใน `spec.md` + GitHub PR | ผู้ใช้สั่ง — ทับกฎ global ใน [CLAUDE.md](CLAUDE.md) |
| 2026-10-20 | `CLAUDE.md` / `spec.md` / `MEMORY.md` ขึ้น repo public | ผู้ใช้สั่ง · ห้ามใส่ secret/ID/ข้อมูลผู้ใช้ตามกฎใน CLAUDE.md |
| 2026-10-20 | เอกสารผูกโค้ดอยู่ใน git ผ่าน PR; หลักฐานที่มีข้อมูลส่วนตัวอยู่ใน `test-results/` | ตรงกับ convention เดิมของ repo และ repo เป็น public |
| 2026-10-20 | `/version` อ่านจาก `version.json` ที่ build วางคู่ไฟล์เว็บ แทนการฉีดค่าตอน deploy | คำสั่ง deploy อยู่ในเครื่อง operator (ไม่อยู่ใน git) — วิธีนี้ไม่ต้องแก้คำสั่งนั้น แต่ config deploy ต้องมี `/version` ใน `run_worker_first` |
| 2026-10-20 | commit ที่ไม่มี tag `vX.Y.Z` ได้ version `0.0.0-dev`; ไม่อ่านเลขจาก `package.json` | กฎ global: git tag เป็นแหล่งเดียวของเลขเวอร์ชัน |
| ก่อนหน้า | ไม่ rollback Worker ไปรุ่นที่ไม่รู้จักห้อง `table` ใช้ `TABLE_READ_ONLY=true` แทน | ดู [TEAM_HANDOFF_TH](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน) |

## งานที่กำลังทำ

_(ว่าง)_ — เขียนก่อนลงมือ: เป้าหมาย · ขอบเขต · ไฟล์ที่จะแตะ · วิธีตรวจ · branch

## ถัดไป

1. `/version`: คน review + merge [PR #10](https://github.com/Thanyers/tabletop/pull/10) · operator เพิ่ม `/version` ใน `run_worker_first` ของ config deploy ก่อนรอบถัดไป
2. คน review + merge PR ของ `docs/spec-driven` (ไฟล์ spec-driven)
3. ลง Node 22.23.2 (เช่นผ่าน nvm/fnm) ให้ตรง CI ก่อนเชื่อผลทดสอบ local
4. รัน `npm run test:r1:browser` (`BROWSER_CHANNEL=chrome`) ให้ครบ baseline — unit, Cloudflare และ Cloudflare browser ผ่านแล้ว
5. งานผลิตภัณฑ์ที่ทีมจัดลำดับไว้ (ข้อเสนอ ยังไม่อนุมัติ): ดู [TEAM_HANDOFF_TH → สถานะและลำดับงาน](docs/TEAM_HANDOFF_TH.md#สถานะและลำดับงาน)
