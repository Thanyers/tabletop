# รายละเอียด CI, release, deploy และการตั้งค่า repo

อ่านตามเงื่อนไขใน [AGENTS.md](../AGENTS.md) ก่อนทำงานส่วนนั้น เอกสารนี้เก็บรายละเอียดปฏิบัติการเดิม ส่วนกติกาเริ่มงานและขอบเขตของ AI อยู่ใน AGENTS

## 1. Markdown merge conflicts (รายละเอียด)

`CHANGELOG.md`, `PLAN.md`, `MEMORY.md` ใช้ `merge=union` ใน [`.gitattributes`](../.gitattributes): `git merge` ในเครื่องเก็บบรรทัดที่ทั้งสองฝั่งเพิ่มไว้ให้เองโดยไม่หยุด · หลัง merge ยังต้องตรวจตาม [AGENTS.md §1](../AGENTS.md#markdown-merge-conflicts) ข้อ 2–5 (บรรทัดซ้ำ, ลำดับ, หัวข้อ release ที่ตัดแล้ว) · `spec.md` ไม่ใช้ union เพราะมีการแก้เนื้อหาเดิม · ปุ่ม Update branch ของ GitHub ไม่ใช้กฎนี้ ให้ merge `origin/dev` ในเครื่องแทน

## 3. CI

[`.github/workflows/validate.yml`](../.github/workflows/validate.yml) รันทุก pull request และทุก push เข้า `main` / `dev`
check ที่ต้องผ่านชื่อ **`local-validation`** · CI ไม่มีขั้น deploy และใช้แต่ credential จำลอง

**สองระดับ (CI005):**
- PR เข้า `dev` → **เช็คเร็ว** (public files, audit, lint, unit, typecheck+build, Worker tests, bundle) ราว 2–3 นาที · ข้าม browser suites
- **หลัง merge เข้า `dev` (CI007):** push เข้า `dev` รันชุดเต็มรวม browser suites · ruleset บังคับแค่ PR จึง **ไม่บล็อกการ merge** · ถ้าล้มจริง (ไม่นับ run ที่ถูกยกเลิกเพราะมี merge ใหม่) job `report-dev-failure` เปิด issue "dev: browser suites failing after merge" หรือ comment ใน issue เดิม · แก้บน `dev` ก่อนตัด release
- PR เข้า `main` (release/hotfix), push เข้า `main` และกด **Run workflow** เอง → **ครบทุกชุด** รวม browser suites ทั้งสาม · pipeline deploy (CD001) รอ `local-validation` ของ merge commit บน `main` ก่อน deploy เสมอ
- **ไม่รันซ้ำบน `main` (CI006):** ถ้าโค้ดของ merge commit (git tree) เหมือน head ของ release PR ทุกไฟล์ และ PR นั้นผ่านชุดเต็มมาแล้ว job `plan` จะใช้ผลเดิม ข้ามทุก job แล้วให้ `local-validation` ผ่านทันที → deploy เริ่มในไม่กี่วินาที · ถ้า `main` มี commit ที่ release branch ไม่มี (tree ไม่ตรง) หรือหา run ของ PR ไม่เจอ จะรันครบทุกชุดเหมือนเดิม จึงต้อง merge `origin/main` เข้า release branch ก่อนเปิด PR (§5 ข้อ 1)
- **รันขนานกัน (CI006):** เช็คเร็ว + browser suite 3 job (demo+r1, Workers, generated) รันพร้อมกัน แต่ละ job build เอง · `local-validation` เป็น job สุดท้ายที่ผ่านเมื่อทุก job ที่รันผ่าน (ชื่อเดิมเพราะ ruleset บังคับ)
- ข้อแลก: browser regression จะเห็นตอนเปิด release PR · PR เข้า `dev` ไม่ต้องรัน browser suite ในเครื่อง (รันชุดเต็มตอนเตรียม release ตาม [§5](../AGENTS.md#5-ออก-release)) · อยากเช็คก่อนก็กด Run workflow บน branch นั้นได้

CI รัน `npm run lint` ด้วย: ห้าม `any` ที่เขียนเอง และห้าม `@ts-ignore` (กฎทั้งหมดอยู่ที่ [CONTRIBUTING → Lint](../CONTRIBUTING.md#lint)) · pre-commit hook (husky) รัน `check-public-files` + lint ไฟล์ที่ stage ให้ก่อน commit · **ห้ามใช้ `--no-verify` ข้าม hook**

ก่อน push ให้ตรวจในเครื่องเท่าที่เกี่ยวกับสิ่งที่แก้:

```bash
node scripts/check-public-files.mjs
npm run lint
npm test
npm run build
npm run test:cloudflare
npm run build:cloudflare
```

browser acceptance ต้องรัน `build` และ `build:cloudflare` ก่อน · ค่าเริ่มต้นของเบราว์เซอร์คือ `msedge` บน Mac/Linux ให้ระบุเอง เช่น `BROWSER_CHANNEL=chrome npm run test:cloudflare:browser` (ดู [CONTRIBUTING](../CONTRIBUTING.md#ตรวจงาน))

ถ้าผลในเครื่องต่างจาก CI ให้เช็ครุ่น Node ก่อน (CI ใช้ **22.23.2**) และระบุรุ่น Node ในรายงานผลตรวจทุกครั้ง


## 5. ออก release

1. แตก `release/X.Y.Z` จาก `origin/dev` แก้ได้แค่บั๊กและตัดหัวข้อ changelog · ถ้า `main` มี commit ที่ `dev` ไม่มี ให้ merge `origin/main` เข้า release branch ด้วย
   - **ตัดหัวข้อด้วยสคริปต์ (CI008):** `npx tsx server/changelog.ts cut X.Y.Z --summary "<MAJOR/MINOR/PATCH: เหตุผล · rollback ไปรุ่นไหนได้>"` รวมทุกไฟล์ใน `changelog.d/` (ใหม่ก่อนเก่า) และบรรทัดเก่าใต้ `## Unreleased` เข้า `## X.Y.Z — วันที่` แล้วลบไฟล์ใน `changelog.d/` · ตรวจผลก่อน commit · สคริปต์ปฏิเสธเลขที่ตัดแล้ว และ fragment ที่รูปแบบผิด
   - **หัวข้อ `## X.Y.Z` ที่ตัดแล้วห้ามแทรกบรรทัดเพิ่ม** (ผู้ใช้ตัดสิน 2026-10-22) — ของที่มาหลังตัดหัวข้อ เช่น บั๊กที่เจอระหว่างรอ CI ของ release ให้ขึ้นหัวข้อใหม่ใต้ `Unreleased` แล้วไปกับรุ่นถัดไป (หรือ hotfix PATCH) · หัวข้อที่ติด tag แล้วแก้ไม่ได้เด็ดขาด
   - ชุดเต็มของ [`validate.yml`](../.github/workflows/validate.yml) (รวม browser suites ทั้งสาม) **รันใน CI บน release PR เอง** ไม่ต้องรันในเครื่องก่อน · ถ้าล้ม แก้บน release branch แล้ว push ใหม่
2. **AI ตั้งเลขเวอร์ชันเอง** ไม่ต้องรอคนเคาะ · เขียนเหตุผลไว้ในบรรทัดแรกใต้หัวข้อ `## X.Y.Z` ของ `CHANGELOG.md` (bump อะไร + rollback ไปรุ่นไหนได้) · ตัดสินด้วยคำถาม "deploy แล้ว rollback ทันทีได้ไหม"
   - **PATCH** แก้บั๊ก/ข้อความ/CSS · **MINOR** ฟีเจอร์ใหม่ หรือ migration ที่เข้ากันได้ย้อนหลัง
   - **MAJOR** rollback ไม่ได้ถ้าไม่ทำอะไรเพิ่ม เช่น migration ย้อนไม่ได้, ต้องเพิ่ม secret/binding/config ก่อน deploy, เปลี่ยน response จน client เก่าพัง
3. PR `release/X.Y.Z` → `main` → **AI merge เอง** เมื่อครบเงื่อนไขใน [§8](../AGENTS.md#8-ขอบเขตของ-ai) · ชื่อ branch คือเลขเวอร์ชัน
4. หลัง merge **pipeline ทำต่อเองทั้งหมด** ([`release-deploy.yml`](../.github/workflows/release-deploy.yml), CD001): รอ `local-validation` ของ merge commit บน `main` ผ่าน (ใช้ผลของ release PR ถ้าโค้ดเหมือนกัน — CI006) → สร้าง annotated tag `vX.Y.Z` → build → **production** (D1 migration + deploy + smoke) · staging ไม่อยู่ในขั้นนี้แล้ว เพราะ deploy ทุกครั้งที่ merge เข้า `dev` (CD002) · ดูรายละเอียดที่หัวข้อถัดไป
5. ติดตาม run ของ **Release deploy** จนจบ (`gh run watch`) แล้วรายงานผู้ใช้: เลขเวอร์ชัน, `/version` ของ production, ลิงก์ run
6. เปิด PR `main` → `dev` เพื่อนำ commit ของ release กลับเข้า `dev` (AI merge เองได้) พร้อมอัปเดต [`docs/DEPLOYMENTS.md`](DEPLOYMENTS.md)
7. **อัปเดตหน้า Release Notes** (หน้าเว็บสรุปว่าแต่ละรุ่นเปลี่ยนอะไร กดดรอปดาวน์ดูรายละเอียด ค้นหา/กรอง MAJOR·MINOR·PATCH ได้)
   - สร้างหน้าใหม่จาก `CHANGELOG.md` ของ `main` หลัง release (รวมไฟล์ใน `changelog.d/` เป็นหัวข้อ "ยังไม่ออก"): `node scripts/build-release-notes.mjs` → ได้ `test-results/release-notes/tabletop-releases.html` (ignored ไม่ commit)
   - เผยแพร่ทับลิงก์เดิม **ห้ามสร้างลิงก์ใหม่**: Claude ใช้ Artifact tool `publish` พร้อม `url` = `https://claude.ai/artifact/HohMBJcKQz2ujHmw6hqKQ8` (อ่านก่อนด้วย `action: "read"` ตามกติกาของ tool) · หน้านี้เป็น private ของเจ้าของ เปิดได้เฉพาะคนที่ถูกแชร์
   - AI ที่ไม่มี Artifact tool: สร้างไฟล์แล้วบอกผู้ใช้ว่าไฟล์อยู่ที่ไหน ให้ Claude เผยแพร่ต่อ · อย่าข้ามเงียบ
   - แก้หน้าตา/การทำงานของหน้าที่ [`scripts/release-notes/template.html`](../scripts/release-notes/template.html) · ข้อมูลมาจาก CHANGELOG อย่างเดียว ไม่ต้องแก้มือ
   - รายงานผู้ใช้พร้อมลิงก์ในข้อความสรุป release (ข้อ 5)

AI ออก release เมื่อผู้ใช้สั่งในแชท (เช่น "release", "ขึ้น prod") แล้วทำตั้งแต่ข้อ 1 ถึง 7 เองจนจบ ไม่ต้องให้คนเปิด GitHub


## 6. Deploy (อัตโนมัติหลัง merge release)

มี pipeline สองตัว (ผู้ใช้ตัดสิน 2026-10-23):

| pipeline | ทำงานเมื่อ | deploy ไป | `/version` |
| --- | --- | --- | --- |
| job `deploy-staging` ใน [`validate.yml`](../.github/workflows/validate.yml) (CD002) | push เข้า `dev` (merge PR) และ `local-validation` ชุดเต็มของ run เดียวกันผ่าน (CI007) | **tabletop-staging** | `0.0.0-dev` + sha ของ dev |
| [`release-deploy.yml`](../.github/workflows/release-deploy.yml) (CD001) | merge `release/X.Y.Z` / `hotfix/X.Y.Z` เข้า `main` และมีหัวข้อ `## X.Y.Z` ใน `CHANGELOG.md` | **tabletop** (production) | `X.Y.Z` + sha ของ merge commit |

- merge อื่นเข้า `main` ไม่ deploy · staging deploy ทีละรอบ ถ้ามีหลาย merge ติดกัน GitHub เก็บเฉพาะรอบล่าสุดที่รอคิว จึง deploy dev ล่าสุด · ล้มแล้ว merge ใหม่เข้า dev จะ deploy ซ้ำเอง หรือกด Re-run failed jobs ของ run นั้น · run บน `dev` ไม่ถูกยกเลิกกลางทางเมื่อมี merge ใหม่ (กัน deploy/migration ค้างครึ่งทาง) · เป็น job ใน validate.yml เพราะ `workflow_run` ทำงานเฉพาะไฟล์บน default branch (`main`)
- ⚠️ D1 migration ใน PR เข้า `dev` **รันบน staging ทันทีหลัง merge** · migration แบบย้อนไม่ได้ต้องถามผู้ใช้ก่อน merge เข้า `dev` ด้วย (เดิมถามตอน merge เข้า `main`)
- production ไม่ได้ใช้ build เดียวกับ staging แล้ว (build ใหม่จาก merge commit บน main) แต่โค้ดเดียวกับ dev ตอนตัด release ที่ผ่าน staging มาแล้ว

- **config จริงอยู่ใน GitHub secrets** (`WRANGLER_CONFIG_STAGING`, `WRANGLER_CONFIG_PRODUCTION`) ไม่อยู่ใน git · pipeline ตรวจชื่อ Worker, `PUBLIC_ORIGIN`, D1 ID ก่อนใช้ เพื่อไม่ให้ config staging ไป deploy production
- **D1 migration รันอัตโนมัติ** staging ตอน merge เข้า dev และ production ตอน merge release · ก่อนรันทุกครั้งบันทึก D1 Time Travel bookmark ไว้ใน summary ของ run (กู้ได้ด้วย `wrangler d1 time-travel restore`) · เอา bookmark ไม่ได้ = ไม่ migrate
- **smoke** เป็นการอ่านอย่างเดียว: `/healthz`, `/readyz`, `/api/capabilities`, `/version` ต้องตรงกับ tag, `/` และ `/new` · ไม่ล็อกอิน ไม่สร้างห้อง ไม่เรียก AI → smoke ไม่ครอบ flow ที่ต้องล็อกอินหรือใช้ AI
- **ล้มที่ขั้นไหนก็หยุดทันที** เปิด GitHub issue "Deploy failed" พร้อม `job_started_at` / `detected_at` / ขั้นที่ล้ม · **ไม่ rollback production อัตโนมัติ** (ดูข้อห้าม rollback ใน [DEPLOYMENTS](DEPLOYMENTS.md)) · AI แจ้งผู้ใช้ทันที แก้ (ถ้าเป็นปัญหาในโค้ด ให้ออกรุ่น PATCH ใหม่) หรือรัน **Release deploy** ใหม่ด้วย SHA เดิม (workflow_dispatch) ถ้าเป็นปัญหาชั่วคราว และบันทึกลง `MEMORY.md` → Deploy failures
- หลัง deploy อัปเดต [`docs/DEPLOYMENTS.md`](DEPLOYMENTS.md) ผ่าน PR เข้า `dev`

ตั้งค่าครั้งแรกและการกู้คืน: [TEAM_HANDOFF_TH → Deploy อัตโนมัติ (CD001)](TEAM_HANDOFF_TH.md#deploy-อัตโนมัติ-cd001) · การขออนุมัติเขียนฐานด้วยมืออยู่ที่ [ส่งรุ่นใหม่และกู้คืน](TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)


## 9. ตั้งค่า repo ครั้งเดียว (admin ของ repo)

AI ทำขั้นนี้ไม่ได้ เพราะต้องใช้สิทธิ์ admin · ถ้ายังไม่ได้ตั้ง branch protection กติกาข้างบนเป็นแค่ข้อตกลง ระบบยังไม่ได้บังคับ

ป้องกัน `main` และ `dev`: ต้องผ่าน PR, check `local-validation` ผ่าน, ห้าม force push และห้ามลบ · ruleset ที่ใช้จริง (`protect-main-and-dev`, ตรวจ 2026-10-22) ตั้ง review ไว้ **0 คน** เพื่อให้ AI merge ได้ทั้ง `dev` และ `main` (ตามกฎ 2026-10-22) · ที่ระบบยังบังคับคือ ต้องผ่าน PR + `local-validation` ผ่าน + ห้าม force push · **ห้ามเพิ่ม review ≥1 ให้ `main`** ไม่อย่างนั้น AI จะ release เองไม่ได้

```bash
gh api -X POST repos/Thanyers/tabletop/rulesets --input - <<'EOF'
{"name":"protect-main-and-dev","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/heads/main","refs/heads/dev"],"exclude":[]}},
 "rules":[{"type":"deletion"},{"type":"non_fast_forward"},
  {"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":true,
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
