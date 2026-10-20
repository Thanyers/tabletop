# AGENTS.md — กติกาสำหรับ AI ทุกตัวที่ทำงานใน Tabletop

ไฟล์นี้คือกติกากลางที่ใช้ร่วมกันสำหรับ AI coding agent ทุกตัว (Claude Code, Codex, Cursor, Copilot ฯลฯ)
ถ้าเครื่องมือของคุณมีไฟล์กติกาเฉพาะตัว (เช่น [`CLAUDE.md`](CLAUDE.md)) ไฟล์นั้นเพิ่มได้ แต่ห้ามขัดกับไฟล์นี้

อ่านตามลำดับ: ไฟล์นี้ → [`spec.md`](spec.md) → [`MEMORY.md`](MEMORY.md) → [`PLAN.md`](PLAN.md) → เอกสารเจ้าของเรื่องใน [`docs/`](docs/README.md)

## 1. ทำงานแบบ spec-driven

`spec.md` คือแหล่งความจริงของ **สถานะระบบ** · [`PLAN.md`](PLAN.md) คือกระดานว่า **ใครทำงานไหนอยู่** · รายละเอียดฟีเจอร์อยู่ใน [`docs/features/`](docs/features/) · โปรเจกต์นี้ **ไม่ใช้ phak หรือ issue tracker ภายนอก**

1. **เริ่มงาน:** อ่าน `spec.md` และ `MEMORY.md` แล้วเช็ค `git status` / `git log -1` ว่าตรงกับที่ spec บอก
2. **ก่อนลงมือ:** หางานใน `PLAN.md` (หรือเพิ่มฟีเจอร์ใหม่จาก [`docs/features/_TEMPLATE.md`](docs/features/_TEMPLATE.md)) แล้วจองตามกติกาใน `PLAN.md`: เช็ค PR ที่เปิดอยู่ → แก้แถวของงานเป็น `doing` → เปิด **draft PR ทันที** ชื่อขึ้นต้นด้วย ID งาน · ห้ามหยิบงานที่แตะไฟล์เดียวกับงานที่ `doing` อยู่
3. **ระหว่างทำ:** ตัดสินใจเรื่อง design/contract เมื่อไหร่ ให้บันทึกใน **การตัดสินใจ** ทันที
4. **จบงาน:** เปลี่ยนแถวใน `PLAN.md` เป็น `review` · บันทึกผลใน **สถานะปัจจุบัน** ของ `spec.md` พร้อมหลักฐาน (คำสั่ง + ผล) · อัปเดตเอกสารเจ้าของเรื่องถ้า contract เปลี่ยน
5. **พลาดหรือเจอกับดัก:** เพิ่มใน `MEMORY.md` แบบ *what happened / root cause / correct behavior* โดยช่องสุดท้ายต้องเป็นคำสั่งที่ทำได้ทันที

ห้ามบอกว่า "เสร็จ" ถ้ายังไม่มีผลตรวจจริงและยังไม่ได้อัปเดต `spec.md`

## 2. Branch

| Branch | หน้าที่ | ใครเขียนได้ |
| --- | --- | --- |
| `main` | **release เท่านั้น** ทุก merge คือรุ่นที่จะ tag `vX.Y.Z` | merge ผ่าน PR โดยคน |
| `dev` | branch รวมงานของรุ่นถัดไป | merge ผ่าน PR โดยคน |
| `feat/*`, `fix/*`, `docs/*` | งานหนึ่งเรื่อง แตกจาก `dev` → PR กลับ `dev` | AI / คน |
| `release/X.Y.Z` | เตรียมออกรุ่น แตกจาก `dev` → PR เข้า `main` · แก้ได้แค่บั๊กและ CHANGELOG ห้ามเพิ่มฟีเจอร์ | AI / คน |
| `hotfix/X.Y.Z` | บั๊ก production ด่วน แตกจาก **tag ที่รันอยู่บน prod** → PR เข้า `main` | AI / คน |

`main` มีทางเข้าแค่ 2 ทาง คือ `release/*` และ `hotfix/*` · ห้ามเปิด PR จาก `feat/*` หรือ `dev` เข้า `main` ตรง ๆ

## 3. CI

[`.github/workflows/validate.yml`](.github/workflows/validate.yml) รันทุก pull request และทุก push เข้า `main` / `dev`
check ที่ต้องผ่านชื่อ **`local-validation`** · CI ไม่มีขั้น deploy และใช้แต่ credential จำลอง

ก่อน push ให้ตรวจในเครื่องเท่าที่เกี่ยวกับสิ่งที่แก้:

```bash
node scripts/check-public-files.mjs
npm test
npm run build
npm run test:cloudflare
npm run build:cloudflare
```

browser acceptance ต้องรัน `build` และ `build:cloudflare` ก่อน · ค่าเริ่มต้นของเบราว์เซอร์คือ `msedge` บน Mac/Linux ให้ระบุเอง เช่น `BROWSER_CHANNEL=chrome npm run test:cloudflare:browser` (ดู [CONTRIBUTING](CONTRIBUTING.md#ตรวจงาน))

ถ้าผลในเครื่องต่างจาก CI ให้เช็ครุ่น Node ก่อน (CI ใช้ **22.23.2**) และระบุรุ่น Node ในรายงานผลตรวจทุกครั้ง

## 4. งานปกติ (feature / fix / docs)

```bash
git fetch origin
git switch -c feat/<ID>-<ชื่อ> origin/dev
# จองงานใน PLAN.md → commit → push → draft PR ทันที
git push -u origin feat/<ID>-<ชื่อ>
gh pr create --draft --base dev --head feat/<ID>-<ชื่อ> --title "<ID>: ..."
# แก้ → ตรวจ → อัปเดต spec.md + PLAN.md → gh pr ready
```

PR ต้องมี: เปลี่ยน behavior อะไร ผู้ใช้เห็นอะไร ผลตรวจ (คำสั่ง + จำนวนที่ผ่าน + รุ่น Node) ข้อจำกัด และสิ่งที่ operator ต้องทำก่อน deploy (ถ้ามี) · จากนั้น **คนเป็นผู้ review และ merge**

## 5. ออก release

1. แตก `release/X.Y.Z` จาก `origin/dev` แก้ได้แค่บั๊กและย้ายหัวข้อ `Unreleased` ใน `CHANGELOG.md` เป็น `X.Y.Z`
2. **เสนอเลขเวอร์ชันพร้อมเหตุผล** แล้วรอคนเคาะ · ตัดสินด้วยคำถาม "deploy แล้ว rollback ทันทีได้ไหม"
   - **PATCH** แก้บั๊ก/ข้อความ/CSS · **MINOR** ฟีเจอร์ใหม่ หรือ migration ที่เข้ากันได้ย้อนหลัง
   - **MAJOR** rollback ไม่ได้ถ้าไม่ทำอะไรเพิ่ม เช่น migration ย้อนไม่ได้, ต้องเพิ่ม secret/binding/config ก่อน deploy, เปลี่ยน response จน client เก่าพัง
3. PR `release/X.Y.Z` → `main` → คน merge
4. ตรวจว่า check `local-validation` ของ **merge commit บน `main`** ผ่านจริง ไม่ใช่ดูแค่ PR:
   ```bash
   gh api repos/Thanyers/tabletop/commits/<merge-sha>/check-runs --jq '.check_runs[] | {name, conclusion}'
   ```
5. สร้าง **annotated tag** บน merge commit นั้น แล้ว push:
   ```bash
   git tag -a vX.Y.Z <merge-sha> -m "Tabletop vX.Y.Z"
   git push origin vX.Y.Z
   ```
6. เปิด PR `main` → `dev` เพื่อนำ commit ของ release กลับเข้า `dev`
7. **deploy เป็นงานของ operator (คน)** ดูหัวข้อถัดไป

## 6. Deploy (operator เท่านั้น)

deploy ขึ้น Cloudflare ทำด้วยมือจากเครื่อง operator ด้วย config ที่ **ไม่อยู่ใน git** (`wrangler.jsonc` ใน repo ใช้ ID ปลอมและงบ AI เป็นศูนย์)

1. checkout **tag** ใน worktree ที่สะอาด → `npm ci` → `npm run build` → `dist/version.json` ต้องมี `version` เป็น `X.Y.Z` (ถ้าได้ `0.0.0-dev` แปลว่าไม่ได้ build จาก tag)
2. deploy staging → ตรวจ `/healthz`, `/readyz`, `/api/capabilities`, `/version` และ UI ที่เปลี่ยน
3. deploy production ด้วยไฟล์ build **ชุดเดียวกับ** staging → ตรวจซ้ำ และให้ `/version` ตรงกับ tag
4. อัปเดต [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md) ผ่าน PR เข้า `dev`
5. ถ้า deploy ล้มเหลว บันทึกใน `MEMORY.md` → Deploy failures พร้อมเวลาที่ fail จาก log และเวลาที่แก้

ขั้นตอน recovery และการขออนุมัติเขียนฐานอยู่ที่ [TEAM_HANDOFF_TH → ส่งรุ่นใหม่และกู้คืน](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)

## 7. Hotfix

ใช้เมื่อผู้ใช้ทำงานไม่ได้ ข้อมูลเสียหาย หรือมีช่องโหว่ความปลอดภัยเท่านั้น · AI **เสนอ** ได้ แต่คนเป็นผู้ตัดสินว่าจะ hotfix หรือรอ release ปกติ

```bash
git switch -c hotfix/X.Y.Z vX.Y.(Z-1)   # แตกจาก tag ที่รันบน prod ไม่ใช่ main HEAD
```

แก้เฉพาะบั๊กนั้น → CHANGELOG (PATCH) → PR เข้า `main` → คน merge → ตรวจ check → tag → operator deploy → **PR กลับเข้า `dev` ในวันเดียวกัน**

## 8. ขอบเขตของ AI

**ทำได้:** แตก branch · แก้โค้ดและเอกสาร · รันเทสต์ · push branch งานของตัวเอง · เปิด PR · เสนอเลขเวอร์ชัน · สร้างและ push annotated tag **หลังคนเคาะเลขแล้ว และ check บน `main` ผ่านแล้ว**

**ห้ามเด็ดขาด:**
- merge PR ใด ๆ หรือ push ตรงเข้า `main` / `dev`
- deploy, รัน `wrangler deploy` ที่ไม่ใช่ `--dry-run`, หรือรัน migration แบบ `--remote`
- ลบหรือย้าย tag ที่ push แล้ว (รุ่นพังให้ออกรุ่นใหม่)
- ตั้งเลขเวอร์ชันเองโดยไม่มีคนเคาะ หรือ hardcode เลขเวอร์ชันไว้ที่อื่นนอกจาก git tag
- ใส่ secret, Worker/D1 ID จริง, room/account ID, invite link, อีเมล/ชื่อผู้ใช้จริง หรือ path ส่วนตัวลงไฟล์ที่ track — **repo นี้เป็น public**

## 9. ตั้งค่า repo ครั้งเดียว (admin ของ repo)

AI ทำขั้นนี้ไม่ได้ เพราะต้องใช้สิทธิ์ admin · ถ้ายังไม่ได้ตั้ง branch protection กติกาข้างบนเป็นแค่ข้อตกลง ระบบยังไม่ได้บังคับ

ป้องกัน `main` และ `dev`: ต้องผ่าน PR, review 1 คน, check `local-validation` ผ่าน, ห้าม force push และห้ามลบ

```bash
gh api -X POST repos/Thanyers/tabletop/rulesets --input - <<'EOF'
{"name":"protect-main-and-dev","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/heads/main","refs/heads/dev"],"exclude":[]}},
 "rules":[{"type":"deletion"},{"type":"non_fast_forward"},
  {"type":"pull_request","parameters":{"required_approving_review_count":1,"dismiss_stale_reviews_on_push":true,
   "require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":false}},
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,
   "required_status_checks":[{"context":"local-validation"}]}}]}
EOF
```

ทำให้ release tag แก้หรือลบไม่ได้หลัง push:

```bash
gh api -X POST repos/Thanyers/tabletop/rulesets --input - <<'EOF'
{"name":"immutable-release-tags","target":"tag","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
 "rules":[{"type":"deletion"},{"type":"update"},{"type":"non_fast_forward"}]}
EOF
```

ถ้าทีมมีคน review ได้แค่คนเดียว ให้ปรับ `required_approving_review_count` ก่อนรัน ไม่อย่างนั้นจะ merge งานของตัวเองไม่ได้
