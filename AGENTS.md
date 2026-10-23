# AGENTS.md — กติกาสำหรับ AI ทุกตัวที่ทำงานใน Tabletop

ไฟล์นี้คือกติกากลางที่ใช้ร่วมกันสำหรับ AI coding agent ทุกตัว รวม Claude Code, Codex, OpenCode และ DeepSeek Harness
ถ้าเครื่องมือของคุณมีไฟล์กติกาเฉพาะตัว (เช่น [`CLAUDE.md`](CLAUDE.md)) ไฟล์นั้นเพิ่มได้ แต่ห้ามขัดกับไฟล์นี้

อ่านตามลำดับ: ไฟล์นี้ → [`spec.md`](spec.md) → [`MEMORY.md`](MEMORY.md) → [`PLAN.md`](PLAN.md) → เอกสารเจ้าของเรื่องใน [`docs/`](docs/README.md)

## ก่อนเริ่มหรือรับช่วงงาน: sync dev และกติกา

ทำขั้นนี้เมื่อเริ่มงานใหม่ กลับมาทำต่อจากแชทเก่า หรือรับช่วงหลังเปลี่ยน checkout/branch; ก่อนแก้ไฟล์ให้ทำครบ:

1. ตรวจ repo จริงด้วย `git rev-parse --show-toplevel`, branch, `git status --short` และ `git log -1 --oneline` อย่าใช้โฟลเดอร์แม่หรือ checkout ของงานอื่นโดยเดา
2. รัน `git fetch origin` ให้สำเร็จ แล้วอ่าน `git show origin/dev:AGENTS.md` เพื่อรับกติกาล่าสุดก่อนทำต่อ แม้ไฟล์ใน branch เดิมหรือบริบทแชทจะยังเก่า ถ้า fetch ไม่สำเร็จ แจ้งว่าตรวจ dev ล่าสุดไม่ได้ และทำได้เฉพาะงานที่ไม่ขึ้นกับความสดนั้น
3. **งานปกติใหม่:** แตก `feat/*`, `fix/*` หรือ `docs/*` จาก `origin/dev` ที่เพิ่ง fetch ตาม §4 · **งานเดิม:** ตรวจ `git merge-base --is-ancestor origin/dev HEAD`; ถ้ายังไม่มี dev ล่าสุด ให้ merge `origin/dev` เข้า branch งานก่อนพัฒนาต่อ และ resolve Markdown ตามกติกาด้านล่าง · release/hotfix ใช้ฐานตาม §5/§7
4. ถ้า working tree มีงานค้าง ให้ตรวจว่าเป็นงานของใครและรักษาไว้ ทำงานต่อใน branch เดิมเมื่อเป็นงานเดียวกัน หรือแยก worktree สำหรับงานใหม่; ก่อน merge ให้เก็บเฉพาะงานของตนเป็น commit ที่ตรวจแล้ว ห้าม reset, ทิ้ง, stash หรือ commit งานคนอื่นเพื่อให้ sync ผ่าน งานอ่านอย่างเดียวไม่ต้องเปลี่ยน branch หรือ merge
5. หลัง sync อ่าน `AGENTS.md` ใน checkout **จนจบ** จากไฟล์จริง แม้ harness จะโหลดให้อัตโนมัติ เพราะงบ context รวมอาจตัดท้ายไฟล์; ถ้าผลอ่านถูกตัดให้แบ่งอ่านจนครบ แล้วอ่านเอกสารตามลำดับข้างต้นและกติกาของ subdirectory ที่จะเขียน ถ้าหลัง merge/switch มีการเปลี่ยนกติกา ให้อ่านส่วนที่เปลี่ยนก่อนเขียนต่อ ไม่ถือว่าข้อความในแชทเก่าหรือ summary แทนไฟล์ปัจจุบันได้
6. แจ้งสั้น ๆ ก่อนลงมือ: ชื่อ checkout, branch, HEAD แบบสั้น, `origin/dev` แบบสั้น และผลว่า dev อยู่ในฐานงานแล้วหรือยัง ใช้ผลตรวจจริง; ถ้ายังไม่ได้ sync ระบุเหตุผลและข้อจำกัด ไม่อ้างว่าเป็นล่าสุด

**งานปกติส่ง PR กลับ `dev`; การแก้กติกา agent ใช้ได้จาก checkout ที่ดึงและอ่านไฟล์แล้ว ไม่ต้อง release เว็บ** การ merge เข้า `dev` ไม่ได้อัปเดต clone หรือบริบท session ที่เปิดค้างเอง วิธีเริ่ม session/ตรวจจุดอ่านของแต่ละ harness อยู่ใน [คู่มือ agent](docs/AGENT_WORKFLOW.md); อ่านเมื่อเปลี่ยน harness หรือสงสัยว่ากติกาไม่ถูกโหลด

## 1. ทำงานแบบ spec-driven

`spec.md` คือแหล่งความจริงของ **สถานะระบบ** · [`PLAN.md`](PLAN.md) คือกระดานว่า **ใครทำงานไหนอยู่** · รายละเอียดฟีเจอร์อยู่ใน [`docs/features/`](docs/features/) · โปรเจกต์นี้ **ไม่ใช้ phak หรือ issue tracker ภายนอก**

1. **เริ่มงาน:** ทำขั้น sync dev และกติกาด้านบน แล้วเทียบ `spec.md` / `MEMORY.md` กับสถานะ checkout จริง ถ้าสถานะเอกสารไม่ตรงให้ตรวจหลักฐานก่อนอ้าง
2. **ก่อนลงมือ:** หางานใน `PLAN.md` (หรือเพิ่มฟีเจอร์ใหม่จาก [`docs/features/_TEMPLATE.md`](docs/features/_TEMPLATE.md)) แล้วจองตามกติกาใน `PLAN.md`: เช็ค PR ที่เปิดอยู่ → แก้แถวของงานเป็น `doing` → เปิด **draft PR ทันที** ชื่อขึ้นต้นด้วย ID งาน · ห้ามหยิบงานที่แตะไฟล์เดียวกับงานที่ `doing` อยู่
3. **ระหว่างทำ:** ตัดสินใจเรื่อง design/contract เมื่อไหร่ ให้บันทึกใน **การตัดสินใจ** ทันที
4. **จบงาน:** เปลี่ยนแถวใน `PLAN.md` เป็น `review` · บันทึกผลใน **สถานะปัจจุบัน** ของ `spec.md` พร้อมหลักฐาน (คำสั่ง + ผล) · อัปเดตเอกสารเจ้าของเรื่องถ้า contract เปลี่ยน
5. **พลาดหรือเจอกับดัก:** เพิ่มใน `MEMORY.md` แบบ *what happened / root cause / correct behavior* โดยช่องสุดท้ายต้องเป็นคำสั่งที่ทำได้ทันที

ห้ามบอกว่า "เสร็จ" ถ้ายังไม่มีผลตรวจจริงและยังไม่ได้อัปเดต `spec.md`

### Markdown merge conflicts

**เมื่อ merge/rebase ชนเฉพาะ Markdown ให้ agent resolve แล้ว commit/push ต่อเอง** ภายใน branch งานที่ได้รับอนุญาต ไม่หยุดงานหรือส่งให้ผู้ใช้แก้เพียงเพราะเอกสารชนกัน

1. อ่าน base/ours/theirs แยกว่าชนเพราะเพิ่มรายการคนละเรื่อง หรือแก้เนื้อหาเดียวกัน
2. **รายการที่เพิ่มคนละเรื่องให้เก็บทั้งสองฝั่ง** เช่น status ใน `spec.md`, แถวใน `PLAN.md`, changelog และ decision log รวมโดยไม่ทับหรือตัดรายการของอีกฝั่ง ไม่เลือก `ours`/`theirs` ทิ้งทั้งไฟล์
3. เรียงเฉพาะบล็อกที่ชนตามรูปแบบเวลาเดิมของส่วนนั้น (`สถานะปัจจุบัน` และ `Unreleased` ใหม่ก่อนเก่า); ใช้วันเวลาในรายการ ถ้าไม่มีใช้เวลา commit ของรายการนั้น รวมรายการเดียวกันที่ซ้ำให้เหลือหนึ่งรายการและเก็บรายละเอียดที่ไม่ซ้ำ ไม่จัดรูปแบบหรือเรียงทั้งไฟล์ใหม่ และคงหัวข้อ release ที่ตัดแล้วตาม §5
4. ถ้าแก้เนื้อหาเดียวกันขัดกันจริง ให้ตรวจเอกสารเจ้าของเรื่อง หลักฐาน และคำสั่งผู้ใช้ล่าสุดก่อนตัดสิน ถ้ายังต้องเลือกนโยบาย/ข้อเท็จจริงที่ตัดสินไม่ได้จึงถามเฉพาะประเด็นนั้น ไม่รวมประโยคที่ขัดกันไว้พร้อมกันหรือถือว่าเป็น conflict ของโค้ดโดยอัตโนมัติ
5. ก่อนจบ ตรวจว่าไม่มี conflict marker/ไฟล์ unmerged, รายการของทั้งสองฝั่งอยู่ครบ, ลิงก์ภายในใช้ได้ และ `git diff --check` ผ่าน แล้ว commit และ push branch เดิม ตรวจสถานะ PR จาก GitHub อีกครั้ง สำหรับการรวม Markdown อย่างเดียวใช้การตรวจเอกสาร ไม่ต้องรันชุด runtime/browser ซ้ำเพียงเพราะ Markdown ชน; ถ้ามี conflict ของโค้ดจริงให้ตรวจตามส่วนที่แก้

ข้อนี้เป็นข้อยกเว้นเฉพาะบล็อกเอกสารที่ต้องรวมจาก merge/rebase ต่อกติกา "แก้เฉพาะแถวของตัวเอง" ใน `PLAN.md` และไม่ได้อนุญาตให้ merge PR ข้าม check หรือ deploy

## 2. Branch

| Branch | หน้าที่ | ใครเขียนได้ |
| --- | --- | --- |
| `main` | **release เท่านั้น** ทุก merge คือรุ่นที่จะ tag `vX.Y.Z` | merge ผ่าน PR · **AI merge เองได้** ตามเงื่อนไขใน [§8](#8-ขอบเขตของ-ai) |
| `dev` | branch รวมงานของรุ่นถัดไป | merge ผ่าน PR · **AI merge เองได้** ตามเงื่อนไขใน [§8](#8-ขอบเขตของ-ai) |
| `feat/*`, `fix/*`, `docs/*` | งานหนึ่งเรื่อง แตกจาก `dev` → PR กลับ `dev` | AI / คน |
| `release/X.Y.Z` | เตรียมออกรุ่น แตกจาก `dev` → PR เข้า `main` · แก้ได้แค่บั๊กและ CHANGELOG ห้ามเพิ่มฟีเจอร์ | AI / คน |
| `hotfix/X.Y.Z` | บั๊ก production ด่วน แตกจาก **tag ที่รันอยู่บน prod** → PR เข้า `main` | AI / คน |

`main` มีทางเข้าแค่ 2 ทาง คือ `release/*` และ `hotfix/*` · ห้ามเปิด PR จาก `feat/*` หรือ `dev` เข้า `main` ตรง ๆ

**ไม่มีจุดที่คนต้องกด** (ผู้ใช้เปลี่ยนกฎเมื่อ 2026-10-22 เพราะโปรเจกต์ต้องการความเร็ว): AI merge ได้ทั้ง PR เข้า `dev` และ release/hotfix เข้า `main` · ที่ต้องรักษาไว้คือ **ทุกรุ่นมี tag + CHANGELOG ให้ย้อนกลับได้** · ข้อยกเว้นที่ยังต้องถามคนมีข้อเดียว ดู [§8](#8-ขอบเขตของ-ai)

## 3. CI

[`.github/workflows/validate.yml`](.github/workflows/validate.yml) รันทุก pull request และทุก push เข้า `main` / `dev`
check ที่ต้องผ่านชื่อ **`local-validation`** · CI ไม่มีขั้น deploy และใช้แต่ credential จำลอง

**สองระดับ (CI005):**
- PR และ push เข้า `dev` → **เช็คเร็ว** (public files, audit, lint, unit, typecheck+build, Worker tests, bundle) ราว 2–3 นาที · ข้าม browser suites
- PR เข้า `main` (release/hotfix), push เข้า `main` และกด **Run workflow** เอง → **ครบทุกชุด** รวม browser suites ทั้งสาม · pipeline deploy (CD001) รอ `local-validation` ของ merge commit บน `main` ก่อน deploy เสมอ
- **ไม่รันซ้ำบน `main` (CI006):** ถ้าโค้ดของ merge commit (git tree) เหมือน head ของ release PR ทุกไฟล์ และ PR นั้นผ่านชุดเต็มมาแล้ว job `plan` จะใช้ผลเดิม ข้ามทุก job แล้วให้ `local-validation` ผ่านทันที → deploy เริ่มในไม่กี่วินาที · ถ้า `main` มี commit ที่ release branch ไม่มี (tree ไม่ตรง) หรือหา run ของ PR ไม่เจอ จะรันครบทุกชุดเหมือนเดิม จึงต้อง merge `origin/main` เข้า release branch ก่อนเปิด PR (§5 ข้อ 1)
- **รันขนานกัน (CI006):** เช็คเร็ว + browser suite 3 job (demo+r1, Workers, generated) รันพร้อมกัน แต่ละ job build เอง · `local-validation` เป็น job สุดท้ายที่ผ่านเมื่อทุก job ที่รันผ่าน (ชื่อเดิมเพราะ ruleset บังคับ)
- ข้อแลก: browser regression จะเห็นตอนเปิด release PR · PR เข้า `dev` ไม่ต้องรัน browser suite ในเครื่อง (รันชุดเต็มตอนเตรียม release ตาม [§5](#5-ออก-release)) · อยากเช็คก่อนก็กด Run workflow บน branch นั้นได้

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

PR ต้องมี: เปลี่ยน behavior อะไร ผู้ใช้เห็นอะไร ผลตรวจ (คำสั่ง + จำนวนที่ผ่าน + รุ่น Node) ข้อจำกัด และสิ่งที่ operator ต้องทำก่อน deploy (ถ้ามี) · จากนั้น **AI merge เข้า `dev` เองได้** ตามเงื่อนไขใน [§8](#8-ขอบเขตของ-ai) (คนจะ review หรือ merge เองก็ได้)

## 5. ออก release

1. แตก `release/X.Y.Z` จาก `origin/dev` แก้ได้แค่บั๊กและย้ายหัวข้อ `Unreleased` ใน `CHANGELOG.md` เป็น `X.Y.Z` · ถ้า `main` มี commit ที่ `dev` ไม่มี ให้ merge `origin/main` เข้า release branch ด้วย
   - **หัวข้อ `## X.Y.Z` ที่ตัดแล้วห้ามแทรกบรรทัดเพิ่ม** (ผู้ใช้ตัดสิน 2026-10-22) — ของที่มาหลังตัดหัวข้อ เช่น บั๊กที่เจอระหว่างรอ CI ของ release ให้ขึ้นหัวข้อใหม่ใต้ `Unreleased` แล้วไปกับรุ่นถัดไป (หรือ hotfix PATCH) · หัวข้อที่ติด tag แล้วแก้ไม่ได้เด็ดขาด
   - ชุดเต็มของ [`validate.yml`](.github/workflows/validate.yml) (รวม browser suites ทั้งสาม) **รันใน CI บน release PR เอง** ไม่ต้องรันในเครื่องก่อน · ถ้าล้ม แก้บน release branch แล้ว push ใหม่
2. **AI ตั้งเลขเวอร์ชันเอง** ไม่ต้องรอคนเคาะ · เขียนเหตุผลไว้ในบรรทัดแรกใต้หัวข้อ `## X.Y.Z` ของ `CHANGELOG.md` (bump อะไร + rollback ไปรุ่นไหนได้) · ตัดสินด้วยคำถาม "deploy แล้ว rollback ทันทีได้ไหม"
   - **PATCH** แก้บั๊ก/ข้อความ/CSS · **MINOR** ฟีเจอร์ใหม่ หรือ migration ที่เข้ากันได้ย้อนหลัง
   - **MAJOR** rollback ไม่ได้ถ้าไม่ทำอะไรเพิ่ม เช่น migration ย้อนไม่ได้, ต้องเพิ่ม secret/binding/config ก่อน deploy, เปลี่ยน response จน client เก่าพัง
3. PR `release/X.Y.Z` → `main` → **AI merge เอง** เมื่อครบเงื่อนไขใน [§8](#8-ขอบเขตของ-ai) · ชื่อ branch คือเลขเวอร์ชัน
4. หลัง merge **pipeline ทำต่อเองทั้งหมด** ([`release-deploy.yml`](.github/workflows/release-deploy.yml), CD001): รอ `local-validation` ของ merge commit บน `main` ผ่าน (ใช้ผลของ release PR ถ้าโค้ดเหมือนกัน — CI006) → สร้าง annotated tag `vX.Y.Z` → build ครั้งเดียว → staging (D1 migration + deploy + smoke) → production ด้วย build เดียวกัน → smoke · ดูรายละเอียดที่หัวข้อถัดไป
5. ติดตาม run ของ **Release deploy** จนจบ (`gh run watch`) แล้วรายงานผู้ใช้: เลขเวอร์ชัน, `/version` ของ staging/production, ลิงก์ run
6. เปิด PR `main` → `dev` เพื่อนำ commit ของ release กลับเข้า `dev` (AI merge เองได้) พร้อมอัปเดต [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md)

AI ออก release เมื่อผู้ใช้สั่งในแชท (เช่น "release", "ขึ้น prod") แล้วทำตั้งแต่ข้อ 1 ถึง 6 เองจนจบ ไม่ต้องให้คนเปิด GitHub

## 6. Deploy (อัตโนมัติหลัง merge release)

pipeline ทำงานเฉพาะ merge จาก `release/X.Y.Z` หรือ `hotfix/X.Y.Z` เข้า `main` และต้องมีหัวข้อ `## X.Y.Z` ใน `CHANGELOG.md` · merge อื่นเข้า `main` ไม่ deploy

- **config จริงอยู่ใน GitHub secrets** (`WRANGLER_CONFIG_STAGING`, `WRANGLER_CONFIG_PRODUCTION`) ไม่อยู่ใน git · pipeline ตรวจชื่อ Worker, `PUBLIC_ORIGIN`, D1 ID ก่อนใช้ เพื่อไม่ให้ config staging ไป deploy production
- **D1 migration รันอัตโนมัติ** staging ก่อน แล้วค่อย production หลัง staging ผ่าน · ก่อนรันทุกครั้งบันทึก D1 Time Travel bookmark ไว้ใน summary ของ run (กู้ได้ด้วย `wrangler d1 time-travel restore`) · เอา bookmark ไม่ได้ = ไม่ migrate
- **smoke** เป็นการอ่านอย่างเดียว: `/healthz`, `/readyz`, `/api/capabilities`, `/version` ต้องตรงกับ tag, `/` และ `/new` · ไม่ล็อกอิน ไม่สร้างห้อง ไม่เรียก AI → smoke ไม่ครอบ flow ที่ต้องล็อกอินหรือใช้ AI
- **ล้มที่ขั้นไหนก็หยุดทันที** เปิด GitHub issue "Deploy failed" พร้อม `job_started_at` / `detected_at` / ขั้นที่ล้ม · **ไม่ rollback production อัตโนมัติ** (ดูข้อห้าม rollback ใน [DEPLOYMENTS](docs/DEPLOYMENTS.md)) · AI แจ้งผู้ใช้ทันที แก้ (ถ้าเป็นปัญหาในโค้ด ให้ออกรุ่น PATCH ใหม่) หรือรัน **Release deploy** ใหม่ด้วย SHA เดิม (workflow_dispatch) ถ้าเป็นปัญหาชั่วคราว และบันทึกลง `MEMORY.md` → Deploy failures
- หลัง deploy อัปเดต [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md) ผ่าน PR เข้า `dev`

ตั้งค่าครั้งแรกและการกู้คืน: [TEAM_HANDOFF_TH → Deploy อัตโนมัติ (CD001)](docs/TEAM_HANDOFF_TH.md#deploy-อัตโนมัติ-cd001) · การขออนุมัติเขียนฐานด้วยมืออยู่ที่ [ส่งรุ่นใหม่และกู้คืน](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)

## 7. Hotfix

ใช้เมื่อผู้ใช้ทำงานไม่ได้ ข้อมูลเสียหาย หรือมีช่องโหว่ความปลอดภัย · AI ตัดสินเองได้ว่าจะ hotfix หรือรอ release ปกติ (แจ้งผู้ใช้พร้อมเหตุผล) · ถ้า `dev` ไม่มีของค้างที่ยังไม่พร้อม การออก release ปกติก็เร็วพอ ๆ กัน

```bash
git switch -c hotfix/X.Y.Z vX.Y.(Z-1)   # แตกจาก tag ที่รันบน prod ไม่ใช่ main HEAD
```

แก้เฉพาะบั๊กนั้น → CHANGELOG (PATCH) → PR เข้า `main` → AI merge ตาม §8 → pipeline tag + deploy เอง → **PR กลับเข้า `dev` ในวันเดียวกัน**

## 8. ขอบเขตของ AI

**ทำได้:** แตก branch · แก้โค้ดและเอกสาร · รันเทสต์ · push branch งานของตัวเอง · เปิด PR · **ตั้งเลขเวอร์ชัน** · **merge release/hotfix เข้า `main`** · สร้างและ push annotated tag เมื่อ check บน `main` ผ่านแล้ว (ปกติ pipeline สร้างให้เอง) · กดรัน **Release deploy** ซ้ำด้วย SHA เดิม

**merge PR เข้า `dev` หรือ `main` เองได้ เมื่อครบทุกข้อ:**
1. base ของ PR คือ `dev` หรือ `main` และ PR ไม่ใช่ draft · PR เข้า `main` ต้องมาจาก `release/X.Y.Z` หรือ `hotfix/X.Y.Z` และมีหัวข้อ `## X.Y.Z` ใน `CHANGELOG.md`
2. check `local-validation` ของ commit ล่าสุดใน PR ผ่าน และ GitHub บอกว่า mergeable (ไม่มี conflict)
3. ใช้ `gh pr merge <n> --merge` (merge commit) · **ห้ามใช้ `--admin`** หรือวิธีใดที่ข้าม ruleset
4. merge เฉพาะ PR ที่ AI เปิดเอง หรือที่ผู้ใช้สั่งให้ merge · หลัง merge แจ้งผู้ใช้พร้อมลิงก์ PR และ merge commit
5. PR เข้า `main`: check `local-validation` ต้องเป็น **ชุดเต็ม** (PR เข้า `main` รันชุดเต็มอยู่แล้วตาม [§3](#3-ci))

**ข้อยกเว้นเดียวที่ยังต้องให้คนตอบในแชทก่อน merge เข้า `main`:** release ที่มี D1 migration แบบย้อนไม่ได้ (drop/rename column/table, ลบหรือเขียนทับข้อมูลเดิม) · เพราะ rollback ด้วยเลขเวอร์ชันกู้ข้อมูลไม่ได้ (เป็น R0 ตาม [CLAUDE.md](CLAUDE.md)) · migration แบบเพิ่มอย่างเดียว (เพิ่ม table/column nullable) ไม่ต้องถาม

**ห้ามเด็ดขาด:**
- merge เข้า `main` จาก branch อื่นที่ไม่ใช่ `release/*` / `hotfix/*`
- push ตรงเข้า `main` / `dev` หรือ force push
- deploy จากเครื่องตัวเอง, รัน `wrangler deploy` ที่ไม่ใช่ `--dry-run`, หรือรัน migration แบบ `--remote` · การ deploy เกิดจาก pipeline หลัง merge release เท่านั้น
- แก้ `release-deploy.yml` ให้ข้ามการรอ check, ข้าม smoke หรือ deploy จาก branch อื่นนอกจาก `main`
- ลบหรือย้าย tag ที่ push แล้ว (รุ่นพังให้ออกรุ่นใหม่)
- hardcode เลขเวอร์ชันไว้ที่อื่นนอกจาก git tag · ข้ามเลข หรือใช้เลขที่เคย tag แล้ว
- ใส่ secret, Worker/D1 ID จริง, room/account ID, invite link, อีเมล/ชื่อผู้ใช้จริง หรือ path ส่วนตัวลงไฟล์ที่ track — **repo นี้เป็น public**

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
