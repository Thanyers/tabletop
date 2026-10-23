# F074 — GNU Affero General Public License v3.0

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | ไม่ออก release เว็บในงานนี้ — เพิ่ม license ของ repository |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F074-T1` |

## ทำไม

ผู้ใช้เลือก AGPL-3.0 สำหรับ Tabletop เมื่อ 2026-10-23 แต่ repository ยังไม่มีไฟล์ license และ package metadata ยังไม่ระบุ license

## สิ่งที่ผู้ใช้จะเห็น

อ่านเงื่อนไขฉบับเต็มได้จาก `LICENSE` ที่ root และเห็นชื่อ license พร้อมลิงก์ใน README

## ขอบเขต

**รวม:** `LICENSE`, `README.md`, license ของ root package ใน `package.json` และ `package-lock.json`, เอกสารงานและ changelog fragment

**ไม่รวม:** เปลี่ยนฟีเจอร์หรือหน้าจอเว็บ, release production, เปลี่ยน license ของ dependency หรือเนื้อหาที่บุคคลอื่นเป็นเจ้าของ

## ข้อเท็จจริงจากโค้ด

ตรวจ `origin/dev` @ `20d3c60` เมื่อ 2026-10-23: ไม่มีไฟล์ `LICENSE`/`COPYING` ที่ track และ root package ทั้งสองไฟล์ยังไม่มีฟิลด์ `license` งานที่ PLAN เดิมระบุ `doing` และแตะ spec (F052/F054) merge แล้วใน PR #183/#201; PR ที่ยังเปิดคือ #231/#237 จึงเพิ่มเฉพาะรายการสถานะของงานนี้

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | เพิ่ม license และ metadata ให้ตรงกัน | LICENSE ตรงกับต้นฉบับ GNU, README/package/lockfile ระบุ `AGPL-3.0-only`, public scan และ diff check ผ่าน |

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | ใช้ `AGPL-3.0-only` | ผู้ใช้เลือก AGPL-3.0; ระบุเวอร์ชัน 3 เท่านั้น ไม่เพิ่มสิทธิ์ใช้เวอร์ชันอนาคตโดยปริยาย |
| 2026-10-23 | ใช้ข้อความ license มาตรฐานจาก GNU โดยไม่แก้ | คงเงื่อนไขทางกฎหมายต้นฉบับและแยกคำอธิบายของโปรเจกต์ไว้ใน README |

## ก่อน deploy

ผู้ที่แจกจ่าย build หรือเปิดบริการต้องให้ผู้ใช้เข้าถึง Corresponding Source ตามเงื่อนไขข้อ 6/13 รวมไฟล์ build/install ที่จำเป็นของรุ่นที่ใช้งานจริง เก็บ notice ของ dependency ตาม license เดิม และไม่รวม secret หรือข้อมูลผู้ใช้ใน source package งานนี้ไม่ยืนยันการเข้าถึง source จากหน้าเว็บที่ deploy อยู่

## ผลตรวจ (2026-10-23)

- Node `22.23.2`: ตรวจ LICENSE SHA-256 เท่าต้นฉบับ GNU ที่ดาวน์โหลดจาก `https://www.gnu.org/licenses/agpl-3.0.txt` เป็น `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`
- `node -e` ตรวจ integrity/metadata/README รวม **5 checks ผ่าน**
- `npx tsx server/changelog.ts check`: **7 fragments ผ่าน**
- ตรวจ Markdown links ของ README/feature: **9 links ผ่าน**, ไม่พบ conflict markers
- `node scripts/check-public-files.mjs`: **781 files / 0 findings** หลังเพิ่มผลตรวจและก่อน commit
- `git diff --cached --check`: ผ่าน รวม LICENSE ที่ stage แล้ว
- GitHub Contents API อ่าน `LICENSE` กลับจาก commit `c074f32`: blob `be3f7b28e564e7dd05eaf59d64adba1a4065ac0e` ตรงกับ `git rev-parse HEAD:LICENSE`
- Local runtime/browser/unit suites: **SKIPPED** เพราะแก้เอกสารและ license metadata เท่านั้น; PR ยังต้องผ่าน `local-validation` ของ commit ล่าสุด
- PR: [#238](https://github.com/Thanyers/tabletop/pull/238)

### Sync ก่อน merge เข้า dev (2026-10-23)

- รวม `dev` @ `b0ba328` และ `ad6764e` เข้าสาขางาน เก็บรายการสถานะจากทั้งสองฝั่งครบ แก้ conflict เฉพาะ Markdown ใน `spec.md`; ไม่มี code conflict
- ตรวจรายการอิสระใน spec/PLAN จาก merge parents และ Markdown links ผ่าน; ไม่พบ conflict markers หรือ unmerged paths
- Node `22.23.2`: public scan **797 files / 0 findings**, changelog **10 fragments ผ่าน**, `git diff --cached --check` ผ่านหลังรวม dev ล่าสุด
- CI ก่อน sync (`b82b27c`): `local-validation` ผ่าน, unit **827 passed / 5 skipped**, Workers **170 passed**; หลัง sync ต้องใช้ check ของ commit ใหม่ก่อน merge
