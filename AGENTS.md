# AGENTS.md — กติกาสำหรับ AI ทุกตัวที่ทำงานใน Tabletop

กติกากลางสำหรับ Claude Code, Codex, OpenCode และ DeepSeek Harness ไฟล์เฉพาะ harness เช่น [`CLAUDE.md`](CLAUDE.md) เพิ่มได้แต่ต้องไม่ขัดกับไฟล์นี้

อ่านตามลำดับ: ไฟล์นี้ → [`spec.md`](spec.md) → [`MEMORY.md`](MEMORY.md) → [`PLAN.md`](PLAN.md) → เอกสารเจ้าของเรื่องใน [`docs/`](docs/README.md)

## ก่อนเริ่มหรือรับช่วงงาน: sync dev และกติกา

Native hooks/plugins เรียก [สคริปต์กลาง](scripts/agent-startup.mjs) เมื่อเริ่ม session/ส่งงานใหม่ ตาม [คู่มือ](docs/AGENT_WORKFLOW.md) ถ้าไม่มี receipt รอบนี้ให้รันเองก่อนเขียน:

1. ตรวจ repo จริงด้วย `git rev-parse --show-toplevel`, branch, status และ HEAD อย่าใช้ checkout ของงานอื่นโดยเดา
2. ต้อง fetch สำเร็จและอ่าน `AGENTS.md` จาก SHA ของ `origin/dev` ที่เพิ่งตรวจ สคริปต์ส่งเนื้อหานั้นเข้าบริบทแล้ว; ถ้าไม่สำเร็จ ระบุ UNVERIFIED และอย่าอ้างว่ากติกา/ฐานงานเป็นล่าสุด
3. งานปกติใหม่แตกจาก `origin/dev`; งานเดิมตรวจ `git merge-base --is-ancestor origin/dev HEAD` และ merge dev ก่อนพัฒนาต่อถ้ายังตามหลัง; release/hotfix ใช้ฐาน §5/§7 งานอ่านอย่างเดียวไม่ต้องเปลี่ยน branch/merge
4. รักษางานค้าง: ทำต่อใน branch เดิมถ้าเป็นงานเดียวกัน หรือแยก worktree สำหรับงานใหม่ ก่อน merge ให้ commit เฉพาะงานของตนที่ตรวจแล้ว ห้าม reset, ทิ้ง, stash หรือ commit งานคนอื่นเพื่อให้ sync ผ่าน
5. อ่านกติกาปัจจุบันจนจบ รวมกติกาของ subdirectory ที่จะเขียน ถ้า tool ตัดผลอ่านให้แบ่งอ่านต่อ หลัง merge/switch อ่านส่วนที่เปลี่ยนใหม่ แชทเก่าหรือ summary แทนไฟล์ปัจจุบันไม่ได้
6. แจ้ง checkout/branch/HEAD/dev แบบสั้นและผล sync จากหลักฐานจริง ไม่อ้างว่า hook ที่ fetch แล้วได้ merge โค้ดให้ด้วย

งานปกติส่ง PR กลับ `dev` · กติกา agent ไม่ต้อง release เว็บ แต่เครื่องต้อง sync config นี้ครั้งแรกและเปิดใช้ hooks ตามคู่มือ หลังจากนั้นเริ่มงานได้โดยไม่สั่งซ้ำ

## 1. ทำงานแบบ spec-driven

`spec.md` คือแหล่งความจริงของ **สถานะระบบ** · [`PLAN.md`](PLAN.md) คือกระดานว่า **ใครทำงานไหนอยู่** · รายละเอียดฟีเจอร์อยู่ใน [`docs/features/`](docs/features/) · โปรเจกต์นี้ **ไม่ใช้ phak หรือ issue tracker ภายนอก**

1. เริ่มงานตามขั้นข้างบน แล้วเทียบ `spec.md`/`MEMORY.md` กับ checkout จริง ตรวจหลักฐานเมื่อไม่ตรง
2. หาหรือเพิ่มงานจาก [template](docs/features/_TEMPLATE.md) → เช็ค PR เปิดอยู่ → จองแถวใน `PLAN.md` เป็น `doing` → เปิด **draft PR ทันที** ชื่อขึ้นต้น ID งาน ห้ามหยิบงานที่แตะไฟล์เดียวกับงาน `doing`
3. บันทึกการตัดสินใจ design/contract ทันที
4. จบงานเปลี่ยน PLAN เป็น `review`, บันทึกคำสั่ง+ผลตรวจใน **สถานะปัจจุบัน** ของ spec และอัปเดตเอกสารเจ้าของ contract
5. เมื่อพลาด บันทึกใน MEMORY แบบ *what happened / root cause / correct behavior*; ข้อสุดท้ายต้องทำตามได้ทันที

ห้ามบอกว่า "เสร็จ" ถ้ายังไม่มีผลตรวจจริงและยังไม่ได้อัปเดต `spec.md`

### Markdown merge conflicts

**Markdown conflict ให้ resolve แล้ว commit/push ต่อเอง** ใน branch งานที่อนุญาต ไม่ส่งให้ผู้ใช้แก้เพียงเพราะเอกสารชน

1. อ่าน base/ours/theirs แยกรายการเพิ่มอิสระจากการแก้เนื้อหาเดียวกัน
2. **เก็บรายการอิสระทั้งสองฝั่ง** รวม status/PLAN/changelog/decision log โดยไม่ทับหรือตัดอีกฝั่ง ห้ามเลือก ours/theirs ทิ้งทั้งไฟล์
3. เรียงเฉพาะบล็อกที่ชนตามเวลาเดิม (`สถานะปัจจุบัน`/`Unreleased` ใหม่ก่อนเก่า) ใช้เวลาในรายการ หรือเวลา commit ถ้าไม่มี รวมรายการซ้ำเป็นหนึ่งและเก็บรายละเอียดไม่ซ้ำ ไม่จัดหรือเรียงทั้งไฟล์ใหม่ คงหัวข้อ release ที่ตัดแล้วตาม §5
4. ถ้าเนื้อหาเดียวกันขัดกัน ตรวจเอกสารเจ้าของเรื่อง หลักฐาน และคำสั่งผู้ใช้ล่าสุด ถ้ายังตัดสินนโยบาย/ข้อเท็จจริงไม่ได้จึงถามเฉพาะจุดนั้น ไม่เก็บประโยคที่ขัดกันไว้พร้อมกันหรือถือเป็น code conflict อัตโนมัติ
5. ตรวจว่า marker/unmerged หมด, รายการทั้งสองฝั่งครบ, ลิงก์ใช้ได้ และ `git diff --check` ผ่าน แล้ว commit/push branch เดิมและอ่านสถานะ PR จาก GitHub ใหม่ รวมเฉพาะ Markdown ใช้การตรวจเอกสาร ไม่ต้องรัน runtime/browser ซ้ำ; code conflict ตรวจตามส่วนที่แก้

ยกเว้นกติกา “แก้เฉพาะแถวตัวเอง” ใน PLAN เฉพาะบล็อก merge/rebase นี้ ไม่ยกเว้น check ก่อน merge PR หรืออนุญาต deploy

## 2. Branch

| Branch | หน้าที่ | ใครเขียนได้ |
| --- | --- | --- |
| `main` | **release เท่านั้น** ทุก merge คือรุ่นที่จะ tag `vX.Y.Z` | merge ผ่าน PR · **AI merge เองได้** ตามเงื่อนไขใน [§8](#8-ขอบเขตของ-ai) |
| `dev` | branch รวมงานของรุ่นถัดไป | merge ผ่าน PR · **AI merge เองได้** ตามเงื่อนไขใน [§8](#8-ขอบเขตของ-ai) |
| `feat/*`, `fix/*`, `docs/*` | งานหนึ่งเรื่อง แตกจาก `dev` → PR กลับ `dev` | AI / คน |
| `release/X.Y.Z` | เตรียมออกรุ่น แตกจาก `dev` → PR เข้า `main` · แก้ได้แค่บั๊กและ CHANGELOG ห้ามเพิ่มฟีเจอร์ | AI / คน |
| `hotfix/X.Y.Z` | บั๊ก production ด่วน แตกจาก **tag ที่รันอยู่บน prod** → PR เข้า `main` | AI / คน |

`main` มีทางเข้าแค่ 2 ทาง คือ `release/*` และ `hotfix/*` · ห้ามเปิด PR จาก `feat/*` หรือ `dev` เข้า `main` ตรง ๆ

AI merge เองได้ตาม [§8](#8-ขอบเขตของ-ai) · ทุกรุ่นต้องมี tag + CHANGELOG ให้ย้อนกลับได้

## 3. CI

ก่อนเลือกชุดตรวจหรือแก้ CI **อ่าน [รายละเอียด CI](docs/AGENT_OPERATIONS.md#3-ci)** · check บังคับคือ `local-validation` ของ commit ล่าสุด · PR เข้า dev ใช้ชุดเร็ว ส่วน release เข้า main ใช้ชุดเต็ม · ก่อน commit รัน `node scripts/check-public-files.mjs`; ห้ามข้าม hook ด้วย `--no-verify` · รายงานคำสั่ง/ผล/รุ่น Node จริง

## 4. งานปกติ (feature / fix / docs)

```bash
git fetch origin
git switch -c feat/<ID>-<ชื่อ> origin/dev
# จองงานใน PLAN.md → commit → push → draft PR ทันที
git push -u origin feat/<ID>-<ชื่อ>
gh pr create --draft --base dev --head feat/<ID>-<ชื่อ> --title "<ID>: ..."
# แก้ → ตรวจ → อัปเดต spec.md + PLAN.md → gh pr ready
```

changelog ใส่ใน `changelog.d/` · PR ต้องมี: เปลี่ยน behavior อะไร ผู้ใช้เห็นอะไร ผลตรวจ (คำสั่ง + จำนวนที่ผ่าน + รุ่น Node) ข้อจำกัด และสิ่งที่ operator ต้องทำก่อน deploy (ถ้ามี) · จากนั้น **AI merge เข้า `dev` เองได้** ตามเงื่อนไขใน [§8](#8-ขอบเขตของ-ai) (คนจะ review หรือ merge เองก็ได้)

## 5. ออก release

ออก release เมื่อผู้ใช้สั่ง เช่น “release” หรือ “ขึ้น prod” เท่านั้น ก่อนเริ่ม **อ่านและทำครบ [ขั้น release](docs/AGENT_OPERATIONS.md#5-ออก-release)** รวมเลขเวอร์ชัน, CHANGELOG, CI ชุดเต็ม, tag/deploy และนำ main กลับ dev · หัวข้อ release ที่ตัดแล้วห้ามแทรกบรรทัดเพิ่ม ของใหม่ลง `changelog.d/`

## 6. Deploy (อัตโนมัติหลัง merge release)

ก่อนติดตาม deploy หรือกู้จากความล้มเหลว **อ่าน [ขั้น deploy](docs/AGENT_OPERATIONS.md#6-deploy-อัตโนมัติหลัง-merge-release)** · ใช้ pipeline หลัง merge release/hotfix เข้า main เท่านั้น ห้าม deploy จากเครื่อง · ติดตามจนจบแล้วรายงานรุ่น/หลักฐานจริง · สถานะปัจจุบันอยู่ใน [DEPLOYMENTS](docs/DEPLOYMENTS.md)

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

AI ไม่เปลี่ยน ruleset เอง ก่อนตรวจหรือเตรียมการตั้งค่าให้ admin **อ่าน [รายละเอียด ruleset](docs/AGENT_OPERATIONS.md#9-ตั้งค่า-repo-ครั้งเดียว-admin-ของ-repo)** · คง PR + check บังคับ + ห้าม force push/ลบ และ release tags แก้ไม่ได้ · review count ของทีมเป็น 0 ตามข้อตกลงเดิม
