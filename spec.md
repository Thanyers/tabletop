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

- **Release ล่าสุด:** **`v1.0.0`** (annotated tag บน `ce2c50e` = merge PR #15, CI `local-validation` บน main ผ่าน) · staging และ production deploy แล้วและตอบ `1.0.0` / `ce2c50e` เมื่อ 2026-10-20 เวลา 13:32 น. Bangkok · output เทียบกับรุ่นก่อนหน้าต่างเฉพาะ `version.json`
- **Branch:** `main` @ `ce2c50e` = release · PR #12–#14 เคยเข้า `main` ตรงโดยไม่ผ่าน `dev` · **`dev`** สร้างจาก `9fbfdec` เมื่อ 2026-10-20 = branch รวมงาน (มี #11) · ขั้นตอนทั้งหมดอยู่ใน [AGENTS.md](AGENTS.md) · ยังไม่มี branch protection
- **Deploy:** production และ staging ใช้ sealed build ชุดเดียวจาก `v1.0.0` · Node 22.23.2 · `npm ci --ignore-scripts` (0 vulnerabilities), typecheck/build/secret scan ผ่าน · health/readiness/capabilities/version 4/4 และ served-asset hashes 135/135 ผ่านทั้งสอง environment · อ่านหน้า anonymous และห้องเดิมหลังล็อกอินได้ ไม่มี room writes หรือ AI calls — ดู [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)
- **F001 T1–T2 หน้าเริ่ม `/new` (branch `feat/F001-start-page`, รอ review):** การ์ด 3 ใบ + ช่องพิมพ์ (สร้างโต๊ะข้อมูลว่างและเติมช่องร่างกฎ ยังไม่เรียก AI) + เริ่มโต๊ะว่าง · ตรวจแล้ว: `npm test` 319/319, typecheck/build ผ่าน, `test:cloudflare` 65/65, `test:cloudflare:browser` 20/20, `test:r1:browser` 7/7, ภาพหน้าจอ 1280 และ 390 ไม่มีเลื่อนแนวนอน · Node v26.3.1
- **F004 URL paths — merge เข้า `dev` แล้ว (#21):** `/`, `/t/<id>`, `/join#invite=...`, `/new`
- **Infra:** Cloudflare Workers Free + D1 + SQLite DO + Google OAuth + DeepSeek Flash · ไม่มี R2/Paid · เพดาน AI prod $1/วัน $10/เดือน, staging $0.20/$0.20
- **CI ล่าสุดของ candidate:** unit/SQL 309, Cloudflare 65, Component Lab 7, browser acceptance ผ่าน ([DEPLOYMENTS](docs/DEPLOYMENTS.md#ผลตรวจ-release-ล่าสุด))
- **Local (2026-10-20, เครื่องนี้):** clone `main` @ `e8cb73e` แล้ว pull เป็น `48fb2bd` → `npm ci` (0 vulnerabilities) → `npm run build` ผ่าน → `npm start` เปิด `:4310` ได้ ใช้ Node v26.3.1 (ไม่ตรง CI 22.23.2) · `npm run test:cloudflare` 65/65 ผ่าน (room 28, auth 13, ai 9, table-assistant 8, billing 7) ตรงกับจำนวนใน CI · `test:cloudflare:browser` 16/16 ผ่าน (ใช้ `BROWSER_CHANNEL=chrome` หลัง `build:cloudflare`)
- **`/version` — [PR #10](https://github.com/Thanyers/tabletop/pull/10) merge เข้า `main` แล้ว (`9fbfdec`) และ deploy แล้วพร้อม PR #13:** `GET /version` → `{"version","sha","built_at"}` ทั้ง Worker และ Node อ่านจาก `dist/version.json` ที่ build เขียน · ตรวจแล้ว: `npm test` 314/314, `npm run build` ผ่าน, `test:cloudflare` 65/65, `build:cloudflare` dry run, `test:cloudflare:browser` 17/17 (มี check `/version`), curl `:4310/version` → 200 `no-store`, `check-public-files` + `check-client-secrets` ไม่มี finding
- **Spec-driven + CI/CD สำหรับ AI:** `AGENTS.md` (กติกากลางของ AI ทุกตัว) / `CLAUDE.md` / `spec.md` / `MEMORY.md` · [PR #11](https://github.com/Thanyers/tabletop/pull/11) branch `docs/spec-driven` → `dev` · ใน PR นี้ CONTRIBUTING เปลี่ยนเป็น branch จาก `dev` และ CI รัน push เข้า `dev` ด้วย

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
| 2026-10-20 | `dev` = branch รวมงาน, `main` = release เท่านั้น; `main` รับแค่ `release/*` และ `hotfix/*` | ผู้ใช้สั่ง · ตามกฎ Git Flow ใน global โดยใช้ชื่อ `dev` แทน `develop` |
| 2026-10-20 | กติกา CI/CD ของ AI ทุกตัวอยู่ใน `AGENTS.md`; `CLAUDE.md` เก็บแค่ส่วนเฉพาะ Claude | ผู้ใช้สั่งให้ AI ตัวอื่นทำงานแบบเดียวกัน · `AGENTS.md` เป็นชื่อที่ Codex/Cursor ฯลฯ อ่าน |
| 2026-10-20 | ตั้ง branch protection ไม่ได้จากบัญชีนี้ (push ได้ ไม่ใช่ admin) — เตรียมคำสั่ง ruleset ไว้ใน AGENTS.md §9 | เจ้าของ repo ต้องรัน |
| 2026-10-20 | release แรกคือ `v1.0.0` | ผู้ใช้เคาะ · production เปิดให้ผู้ใช้จริงแล้ว และตามกฎ global release แรกของ production คือ `v1.0.0` |
| 2026-10-20 | งานที่กำลังทำย้ายไป `PLAN.md` + `docs/features/` จองงานด้วย draft PR | ผู้ใช้ขอให้ทีมทำงานตรงกันไม่ชนกัน · `spec.md` เหลือแค่สถานะระบบ |
| ก่อนหน้า | ไม่ rollback Worker ไปรุ่นที่ไม่รู้จักห้อง `table` ใช้ `TABLE_READ_ONLY=true` แทน | ดู [TEAM_HANDOFF_TH](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน) |

## งานที่กำลังทำ

ดู [PLAN.md](PLAN.md) — กระดานว่าใครทำงานไหน branch อะไร (ย้ายมาจากหัวข้อนี้เพื่อไม่ให้หลายคนแก้ส่วนเดียวกันจนชน)

## ถัดไป

1. **เจ้าของ repo (admin):** รันคำสั่ง ruleset ใน [AGENTS.md §9](AGENTS.md#9-ตั้งค่า-repo-ครั้งเดียว-admin-ของ-repo) เพื่อ protect `main` + `dev` และล็อก tag `v*`
2. ออก release ถัดไปตาม AGENTS.md; production ปัจจุบันคือ tag `v1.0.0` แล้ว ไม่ต้อง deploy tag นี้ซ้ำเพียงเพื่อให้มีเลขรุ่น
3. แจ้งทีมว่างานใหม่ต้องเปิด PR เข้า `dev` เท่านั้น — #12–#14 ยังเข้า `main` ตรง
4. ลง Node 22.23.2 ให้ตรง CI · รัน `npm run test:r1:browser` (`BROWSER_CHANNEL=chrome`) ให้ครบ baseline
5. F001 เริ่มโต๊ะใหม่ด้วยคำถาม + การ์ดเดโม + AI ช่วยเลือก + แชท island — รอตอบคำถามเปิดใน [F001](docs/features/F001-guided-table-start.md#คำถามเปิด-ต้องตอบก่อนเริ่มงานที่เกี่ยว)
6. งานผลิตภัณฑ์ที่ทีมจัดลำดับไว้ (ข้อเสนอ ยังไม่อนุมัติ): ดู [TEAM_HANDOFF_TH → สถานะและลำดับงาน](docs/TEAM_HANDOFF_TH.md#สถานะและลำดับงาน)
