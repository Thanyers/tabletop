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

**สองระดับ (CI005):**
- PR และ push เข้า `dev` → **เช็คเร็ว** (public files, audit, lint, unit, typecheck+build, Worker tests, bundle) ราว 2–3 นาที · ข้าม browser suites
- PR เข้า `main` (release/hotfix), push เข้า `main` และกด **Run workflow** เอง → **ครบทุกชุด** รวม browser suites ทั้งสาม · pipeline deploy (CD001) รอชุดเต็มบน merge commit ของ `main` ก่อน deploy เสมอ
- ข้อแลก: browser regression จะเห็นตอนเปิด release PR · ถ้า PR แตะ UI/canvas/ขั้นตอนเชิญ ให้รัน browser suite ในเครื่อง หรือกด Run workflow บน branch นั้นก่อนขอ merge

CI รัน `npm run lint` ด้วย: ห้าม `any` ที่เขียนเอง และห้าม `@ts-ignore` (กฎทั้งหมดอยู่ที่ [CONTRIBUTING → Lint](CONTRIBUTING.md#lint)) · pre-commit hook (husky) รัน `check-public-files` + lint ไฟล์ที่ stage ให้ก่อน commit · **ห้ามใช้ `--no-verify` ข้าม hook**

ก่อน push ให้ตรวจในเครื่องเท่าที่เกี่ยวกับสิ่งที่แก้:

```bash
node scripts/check-public-files.mjs
npm run lint
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
3. PR `release/X.Y.Z` → `main` → **คน merge** · การ merge นี้คือการตัดสินใจปล่อยรุ่น ชื่อ branch คือเลขเวอร์ชันที่คนเคาะแล้ว
4. หลัง merge **pipeline ทำต่อเองทั้งหมด** ([`release-deploy.yml`](.github/workflows/release-deploy.yml), CD001): รอ `local-validation` ของ merge commit บน `main` ผ่าน → สร้าง annotated tag `vX.Y.Z` → build ครั้งเดียว → staging (D1 migration + deploy + smoke) → production ด้วย build เดียวกัน → smoke · ดูรายละเอียดที่หัวข้อถัดไป
5. เปิด PR `main` → `dev` เพื่อนำ commit ของ release กลับเข้า `dev`

## 6. Deploy (อัตโนมัติหลังคน merge release)

pipeline ทำงานเฉพาะ merge จาก `release/X.Y.Z` หรือ `hotfix/X.Y.Z` เข้า `main` และต้องมีหัวข้อ `## X.Y.Z` ใน `CHANGELOG.md` · merge อื่นเข้า `main` ไม่ deploy

- **config จริงอยู่ใน GitHub secrets** (`WRANGLER_CONFIG_STAGING`, `WRANGLER_CONFIG_PRODUCTION`) ไม่อยู่ใน git · pipeline ตรวจชื่อ Worker, `PUBLIC_ORIGIN`, D1 ID ก่อนใช้ เพื่อไม่ให้ config staging ไป deploy production
- **D1 migration รันอัตโนมัติ** staging ก่อน แล้วค่อย production หลัง staging ผ่าน · ก่อนรันทุกครั้งบันทึก D1 Time Travel bookmark ไว้ใน summary ของ run (กู้ได้ด้วย `wrangler d1 time-travel restore`) · เอา bookmark ไม่ได้ = ไม่ migrate
- **smoke** เป็นการอ่านอย่างเดียว: `/healthz`, `/readyz`, `/api/capabilities`, `/version` ต้องตรงกับ tag, `/` และ `/new` · ไม่ล็อกอิน ไม่สร้างห้อง ไม่เรียก AI → การตรวจที่ต้องล็อกอินหรือใช้ AI ยังต้องทำด้วยมือบน staging ก่อน merge release
- **ล้มที่ขั้นไหนก็หยุดทันที** เปิด GitHub issue "Deploy failed" พร้อม `job_started_at` / `detected_at` / ขั้นที่ล้ม · **ไม่ rollback production อัตโนมัติ** (ดูข้อห้าม rollback ใน [DEPLOYMENTS](docs/DEPLOYMENTS.md)) · คนแก้แล้วรัน **Release deploy** ใหม่ด้วย SHA เดิม (workflow_dispatch) และบันทึกลง `MEMORY.md` → Deploy failures
- หลัง deploy อัปเดต [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md) ผ่าน PR เข้า `dev`

ตั้งค่าครั้งแรกและการกู้คืน: [TEAM_HANDOFF_TH → Deploy อัตโนมัติ (CD001)](docs/TEAM_HANDOFF_TH.md#deploy-อัตโนมัติ-cd001) · การขออนุมัติเขียนฐานด้วยมืออยู่ที่ [ส่งรุ่นใหม่และกู้คืน](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)

## 7. Hotfix

ใช้เมื่อผู้ใช้ทำงานไม่ได้ ข้อมูลเสียหาย หรือมีช่องโหว่ความปลอดภัยเท่านั้น · AI **เสนอ** ได้ แต่คนเป็นผู้ตัดสินว่าจะ hotfix หรือรอ release ปกติ

```bash
git switch -c hotfix/X.Y.Z vX.Y.(Z-1)   # แตกจาก tag ที่รันบน prod ไม่ใช่ main HEAD
```

แก้เฉพาะบั๊กนั้น → CHANGELOG (PATCH) → PR เข้า `main` → คน merge → pipeline tag + deploy เอง → **PR กลับเข้า `dev` ในวันเดียวกัน**

## 8. ขอบเขตของ AI

**ทำได้:** แตก branch · แก้โค้ดและเอกสาร · รันเทสต์ · push branch งานของตัวเอง · เปิด PR · เสนอเลขเวอร์ชัน · สร้างและ push annotated tag **หลังคนเคาะเลขแล้ว และ check บน `main` ผ่านแล้ว** (ปกติ pipeline สร้างให้เอง) · กดรัน **Release deploy** ซ้ำด้วย SHA เดิมเมื่อคนสั่ง

**ห้ามเด็ดขาด:**
- merge PR ใด ๆ หรือ push ตรงเข้า `main` / `dev`
- deploy จากเครื่องตัวเอง, รัน `wrangler deploy` ที่ไม่ใช่ `--dry-run`, หรือรัน migration แบบ `--remote` · การ deploy เกิดจาก pipeline หลังคน merge release เท่านั้น
- แก้ `release-deploy.yml` ให้ข้ามการรอ check, ข้าม smoke หรือ deploy จาก branch อื่นนอกจาก `main`
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
