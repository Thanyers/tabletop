# F080 — Decision log

Log การตัดสินใจที่ผูกกับ contract/สถาปัตยกรรมของ Goal นี้ บันทึก **ก่อน** ทำ downstream ที่พึ่งมัน; การเปลี่ยน default ต้องมี rationale + evidence และไม่เขียนทับประวัติ

สถานะที่ใช้: `accepted` (ตัดสินแล้วและมีหลักฐาน) · `default` (ค่าเริ่มต้นที่ใช้ได้ แต่ยังเปลี่ยนได้ด้วยหลักฐาน) · `proven` (พิสูจน์ด้วยผลตรวจจริงแล้ว) · `superseded` · `open`

---

## D-001 — Feature ID = F080

- **วันที่:** 2026-10-25
- **สถานะ:** `accepted`
- **ตัดสิน:** ใช้ `F080` เป็น feature ID หลัก และ `F080-T*` เป็นงานย่อย
- **เหตุผล/หลักฐาน:** ที่ `origin/dev` `a6feb3c1` ไม่มี `docs/features/F080*`, ไม่มีแถว `F080` ใน `PLAN.md`, ไม่มี remote branch ที่ใช้ `F080`, และ open PR มีเพียง #250 (`fix/CI-provider-mock-diagnostics`) · ตัวสูงสุดที่ถูกใช้คือ F079 · แผนห้ามถือว่า F080 ถูกจองก่อนตรวจ จึงตรวจแล้วค่อยจอง
- **ทางเลือกที่ตัดทิ้ง:** ใช้ F081 เพื่อ "เว้นที่" — ไม่มีเหตุ เพราะไม่มีผู้ถือ F080 · ใช้ชื่อ `JT-*` เป็น ID จริง — แผนระบุให้ JT เป็น alias เท่านั้น
- **Contract ที่กระทบ:** `PLAN.md`, `changelog.d/`, `docs/features/F080*`, ชื่อ branch `feat/F080-*`
- **Rollback:** ไม่ต้องมี; การ rename ภายหลังทำได้ก่อน merge

## D-002 — Checkpoint เดียวที่ `docs/features/F080-custom-tools-joined-tables/`

- **วันที่:** 2026-10-25
- **สถานะ:** `accepted`
- **ตัดสิน:** ใช้ directory เดียว มี `index.md`, `progress.json`, `acceptance.json`, `decisions.md`; feature entry คือ `docs/features/F080-custom-tools-joined-tables.md` ชี้เข้าดirectory
- **เหตุผล/หลักฐาน:** execution guide §2 กำหนด schema นี้และห้ามใช้ chat history เป็นสถานะงานหลัก · แยกไฟล์ของ tracked checkpoint ออกจาก `test-results/` (ignored) ที่เก็บ evidence ที่มี local path/identity
- **ทางเลือกที่ตัดทิ้ง:** เก็บทุกอย่างใน `spec.md` — โตเกินและชน hotspot ทุก PR · ใช้ GitHub issue เป็น checkpoint — repo ไม่ใช้ issue tracker เป็นกระดานงาน
- **Contract ที่กระทบ:** `docs/features/**`, `PLAN.md`, `spec.md` (สรุปสถานะตอนจบ slice)
- **Rollback:** ย้าย directory ได้โดยไม่กระทบ runtime

## D-003 — PR slice = C0…C11 ตาม dependency

- **วันที่:** 2026-10-25
- **สถานะ:** `accepted`
- **ตัดสิน:** หนึ่ง PR ต่อหนึ่ง slice (แตกย่อยได้) ตาม execution guide §4; lead ถือ shared contracts/integration/spec/PLAN, specialists ถือ runtime/UI ของ slice
- **เหตุผล/หลักฐาน:** แผน §8 ห้าม mega-PR และห้ามรวม compiler + space permission + room visuals พร้อมกัน · bootstrap เอกสารไม่ต้องรอ human/hosted acceptance
- **ทางเลือกที่ตัดทิ้ง:** PR เดียวทั้ง Goal — review ไม่ได้จริงและปิดความเสี่ยง authority/isolation ไม่ได้
- **Rollback:** แต่ละ PR revert ได้อิสระถ้าไม่มี migration ที่ apply แล้ว

## D-004 — Collaboration space เป็น aggregate ใหม่ที่อ้าง source workspace IDs เดิม

- **วันที่:** 2026-10-25
- **สถานะ:** `default` (ยังต้องพิสูจน์ใน C5/T2B ด้วย schema/route จริง)
- **ตัดสิน:** ไม่ rename/move/clone source tables; เพิ่ม aggregate ของห้องซึ่งถือ shared-tool workspace/layout/membership และ refs ไป source workspace IDs; ใช้ repository/authority abstraction เดิม
- **เหตุผล/หลักฐาน:** `cloudflare/room-repository.ts` ผูก Room กับ workspace เดียว และ transaction commit อยู่ใน Room นั้น; `TableState` มีหนึ่ง `TableProgram` (`src/tabletop/shared/table-contracts.ts:31-43`, `:78-123`) จึงไม่มีที่ให้เก็บหลายโต๊ะเป็น authority เดียว — ต้องไม่ยัดทุกโต๊ะลง program เดียวแล้วเรียกว่า joined
- **ทางเลือกที่ตัดทิ้ง:** ใช้ Room เดิมเป็นห้องรวม — Room DO รองรับ workspace เดียว; การวาดหลายโต๊ะบน canvas ไม่ได้สร้างหลาย authority
- **Contract ที่กระทบ:** schema/storage ใหม่ (เพิ่มอย่างเดียว), route ใหม่, `src/tabletop/shared/permissions.ts` (role×verb ของห้องเป็นคนละชุดกับ source grant)
- **Rollback/migration:** เพิ่ม table/case ใหม่แบบ additive; ถ้าต้องมี D1 migration ต้องขอ scoped approval ก่อน apply (ห้าม apply จากมือ/`--remote`)

## D-005 — Server behavior เกาะ execution seam เดิม (ComputeRunner/orchestrator)

- **วันที่:** 2026-10-25
- **สถานะ:** `default` (พิสูจน์ใน C2/T1A)
- **ตัดสิน:** เริ่ม JavaScript บน seam ของ `ComputeRunner`/`cloudflare/compute-runner.ts`/`server/table-compute-orchestrator.ts` ที่มีอยู่ แทนการสร้าง runtime stack ใหม่; แยก execute ออกจาก commit (isolate รันแบบไม่มี DB/network/credential → parse → authority ตรวจสิทธิ์/revision/grants อีกครั้ง → validate whole state → commit หนึ่ง target พร้อม receipt)
- **เหตุผล/หลักฐาน:** มี isolated runner + limits + orchestrator ที่ตรวจ revision/authority อยู่แล้ว; Python เดิมต้องไม่ regress และ custom behavior ไม่ต้องรอภาษาใหม่
- **ทางเลือกที่ตัดทิ้ง:** ให้ generated code เรียก privileged host method/SQL ตรง ๆ — ขัด authority/receipt และขัด reject-before-side-effect
- **Rollback:** adapter ใหม่ห่อ seam เดิม; ปิด adapter = ปิด custom behavior โดยไม่กระทบ compute เดิม

## D-006 — Compiler location: ตัดสินหลังทดลอง ไม่เดา

- **วันที่:** 2026-10-25
- **สถานะ:** `open`
- **ตัดสิน (ชั่วคราว):** ยังไม่ล็อกระหว่าง (a) trusted deployment-compatible compile adapter และ (b) isolated client compiler ที่ artifact ยังถือว่า untrusted; ต้องทดลองทั้งสองทางเท่าที่จำเป็นใน C2 แล้วเลือกจาก deployability/resource limits/source reproducibility
- **เหตุผล/หลักฐาน:** `package.json` ของ dev ไม่มี direct compiler dependency สำหรับ package authoring (มี Vite/esbuild ผ่าน transitive เท่านั้น) · ห้ามสมมติว่า transitive esbuild ใช้เป็น deployed runtime compiler ได้ · ห้ามอ้าง server-verified source-to-bundle ถ้า compile อยู่ client อย่างเดียว
- **ทางเลือกที่ตัดทิ้ง:** เพิ่ม compiler service ใหม่ต่อ package — ยังไม่มีหลักฐานว่าราคา/น้ำหนักคุ้ม
- **Rollback:** ทั้งสองทางเลือกไม่ผูก schema ถาวร; artifact มี `contentHash`/`buildHash` แยกจาก source อยู่แล้ว

## D-007 — UI isolation = sandboxed iframe + typed channel ต่อ instance

- **วันที่:** 2026-10-25
- **สถานะ:** `default` (ต้องผ่าน ISO-01 ก่อนอ้างว่าปลอดภัย)
- **ตัดสิน:** generated UI รันใน sandboxed iframe แยกสิทธิ์จาก host ใช้ SDK/protocol รุ่นชัด และ channel ผูกกับ frame instance จริง; รับเฉพาะ typed message/allowed method; iframe ไม่ได้ session cookie/token/DB credential; host ไม่เชื่อ actor/source/workspace ID ที่ iframe ส่งมาเอง
- **เหตุผล/หลักฐาน:** แผน §4.2 และ execution guide T2; `allow-scripts` + `allow-same-origin` บน same-origin untrusted content ไม่ถือว่าปลอดภัย
- **ทางเลือกที่ตัดทิ้ง:** รัน generated component ใน host React tree — ไม่มีขอบเขตสิทธิ์และ host ไม่สามารถบังคับ limits ได้
- **ข้อจำกัดที่บันทึกไว้:** iframe ไม่แก้ปัญหา browser UI thread/CPU; ต้องวัด hang/recovery และ **ห้ามอ้าง hard CPU isolation ของ UI** ถ้าตัด execution ไม่ได้

## D-008 — Custom ที่นับว่าผ่าน ต้องไม่เพิ่ม renderer/host special case

- **วันที่:** 2026-10-25
- **สถานะ:** `accepted` (เป็นเกณฑ์ ไม่ใช่ตัวเลือก)
- **ตัดสิน:** เพิ่ม generic package host ครั้งเดียว; หลัง host พร้อม การรับ package ของโจทย์ใหม่ (รวมโจทย์เรียนรู้/เล่น held-out) ต้องไม่แก้ host ตามโจทย์ การเพิ่มชนิดการ์ดหรือเรียก CRUD เดิมไม่นับเป็น custom
- **เหตุผล/หลักฐาน:** แผน §1/§7 G1/G6 และ CLAUDE.md ห้ามเพิ่ม scenario-name switch ให้เคสตัวอย่างผ่าน
- **Rollback:** ไม่มี — เป็นเกณฑ์รับ

## D-009 — Visual room shell ต้องให้เจ้าของเลือก (ห้ามเลือกแทน)

- **วันที่:** 2026-10-25
- **สถานะ:** `open`
- **ตัดสิน:** ทำ 3 แนว (top-down / isometric / composable canvas) ด้วยภารกิจเดียวกัน เก็บภาพ+interactive evidence แล้ว **ถามเจ้าของเลือกหนึ่งครั้ง** ก่อนสร้าง room shell; ระหว่างรอเดินงาน runtime/backend/export ต่อ
- **เหตุผล/หลักฐาน:** D5 + แผน §6 "ไม่อ้างว่าได้รับอนุมัติภาพใดแล้วจากคำว่าเหมือนเล่นเกม"
- **Rollback:** prototype ไม่ผูก production path

## D-010 — ข้อมูล live / code pinned: แยก lifecycle

- **วันที่:** 2026-10-25
- **สถานะ:** `accepted` (เกณฑ์)
- **ตัดสิน:** ข้อมูลที่เชื่อมเป็น live พร้อม source revision/freshness; package/formula/schema dependency อ้างรุ่นที่เลือก (immutable version) และ instance ที่อ้างรุ่นเก่าไม่เปลี่ยนเอง; update มี impact/compatibility check + compatible rollback/compensating revision
- **เหตุผล/หลักฐาน:** D8; แผน §4.3
- **Rollback:** downstream reroll ไปรุ่นก่อนได้เพราะ version immutable

## D-011 — Single-target write เท่านั้นใน operation ที่ประกาศ

- **วันที่:** 2026-10-25
- **สถานะ:** `accepted` (เกณฑ์)
- **ตัดสิน:** action เขียนหนึ่ง target authority; ข้อมูลจากแหล่งอื่นเป็น input ณ revision ที่ระบุ; operation ที่ต้องเขียนหลาย authority หรือรักษา invariant ข้ามโต๊ะถูก **reject ก่อน side effect** จนมี protocol ที่พิสูจน์ได้ (coordinator/compensation ที่แสดง partial/pending/recovery) ไม่มี all-or-nothing จากสอง writes ต่อกัน
- **เหตุผล/หลักฐาน:** แผน §4.4; execution guide T5
- **Rollback:** ไม่มี side effect เกิดขึ้นเมื่อ reject

## D-012 — ไม่อัปเดต `CHANGELOG.md` ตรง ๆ

- **วันที่:** 2026-10-25
- **สถานะ:** `accepted`
- **ตัดสิน:** ทุก PR เขียน fragment ใน `changelog.d/F080-*.md` และรัน `npx tsx server/changelog.ts check`
- **เหตุผล/หลักฐาน:** `changelog.d/README.md` และ CI `fast-checks`
- **Rollback:** ไม่ต้องมี
