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
- **สถานะ:** `superseded` โดย D-013 (เลือก Sucrase เป็น compiler แล้ว)
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

## D-013 — Compiler: pure-JS transform (Sucrase) ใน platform adapter

- **วันที่:** 2026-10-25
- **สถานะ:** `proven` (local compile + render + invoke; ยังไม่พิสูจน์บน staging Worker)
- **ตัดสิน:** ใช้ `sucrase@3.35.0` (pin แน่นอน) เป็น compiler ที่รันได้ทั้ง browser/Node/Worker แทน native binary
- **เหตุผล/หลักฐาน:** ทางเลือก (a) trusted deployment-compatible adapter ต้องรันได้บน staging ซึ่งเป็น Cloudflare Worker — native esbuild รันไม่ได้ และ esbuild-wasm หนัก/ต้องเสิร์ฟ asset เพิ่ม · Sucrase เป็น pure JS จึงให้ผลเหมือนกันทุก environment · artifact ยังถือว่า untrusted (sandbox/bridge/authority เป็นตัวคุม) · UI compile เป็น CommonJS เพื่อโหลดผ่าน registry ใน frame; behaviour compile เป็น ESM เพราะ isolate import `./module.js` (และ validation บังคับให้ behaviour module self-contained ไม่มี relative import)
- **ทางเลือกที่ตัดทิ้ง:** ให้ client compile แล้วอ้างว่า server verified — ทำไม่ได้ตามที่ตัดสิน; เพิ่ม compiler service ใหม่ — ยังไม่มีหลักฐานคุ้ม
- **Contract ที่กระทบ:** `package.json` (+`sucrase`), `src/tabletop/runtime/tools/compile.ts`, `TOOL_COMPILE_LIMITS`
- **Rollback:** เปลี่ยน adapter ได้โดยไม่แตะ schema; artifact มี `contentHash` แยกจาก source อยู่แล้ว
- **ข้อจำกัดที่บันทึก:** ไม่มี type-check ในขั้น compile (ตรวจได้แค่ parse + schema) — ต้องบอกผู้ใช้ตามจริง ไม่ใช่ "type-safe"

## D-014 — Frame CSP อนุญาต `'unsafe-eval'` เฉพาะใน sandbox

- **วันที่:** 2026-10-25
- **สถานะ:** `proven` (browser harness ผ่าน 13 checks)
- **ตัดสิน:** `TOOL_SANDBOX_CSP` = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'` และไม่ใส่ `frame-ancestors` (meta ไม่รองรับ)
- **เหตุผล/หลักฐาน:** ต้อง instantiate โมดูลที่ compile มาเป็นข้อความ; frame มี opaque origin (sandbox ไม่มี `allow-same-origin`) และ browser harness ยืนยันว่า `document.cookie` โยน SecurityError, `localStorage` ถูกบล็อก, `fetch` ล้มเหลว, `location.origin === 'null'` · `unsafe-eval` จึงไม่ขยายสิทธิ์ของ host
- **ทางเลือกที่ตัดทิ้ง:** ใช้ `blob:`/`import()` แทน eval — ต้องเปิด `script-src blob:` และพึ่ง behavior ของ opaque origin ที่ยังไม่พิสูจน์; คง eval ที่แคบและพิสูจน์ได้
- **Rollback:** แก้ที่ `ui/tool-sandbox/document.ts` ที่เดียว
- **ข้อจำกัด:** iframe ไม่ได้ให้ hard CPU isolation — ยังต้องวัด hang/recovery แยก

## D-015 — ใช้ binding `COMPUTE_LOADER` เดิมกับ tool behaviour (ยังไม่แยก binding ใหม่)

- **วันที่:** 2026-10-25
- **สถานะ:** `default` (เปลี่ยนได้เมื่อมีเหตุผลด้านโควตา/การแยก)
- **ตัดสิน:** `cloudflare/tool-behavior-runner.ts` รับ `loader?: WorkerLoader` และใช้ binding เดียวกับ compute แทนการเพิ่ม `TOOL_LOADER` ใน `wrangler.jsonc`
- **เหตุผล/หลักฐาน:** `wrangler.jsonc` มี `worker_loaders[0] = COMPUTE_LOADER` อยู่แล้ว และ `server/compute-deploy-config.ts` ตรวจ config ตอน deploy — เพิ่ม binding ใหม่จะแตะ config ของ operator ทันทีโดยยังไม่มีเหตุผลด้านโควตา · `loader.load()` สร้าง isolate ใหม่ต่อครั้งอยู่แล้ว จึงแยกกันได้ในระดับ execution
- **ทางเลือกที่ตัดทิ้ง:** เพิ่ม binding/DO class ใหม่ (ต้อง wrangler migration + staging config) — เลื่อนไปจนมีหลักฐานว่าโควตาหรือ isolation ต้องการ
- **Rollback:** เปลี่ยนเป็น binding แยกได้โดยแก้ที่จุดสร้าง runner เท่านั้น
- **ข้อจำกัด:** สองความสามารถแชร์โควตาของ loader เดียวกัน — ต้องวัดโหลดก่อนสรุป capacity

## D-012 — ไม่อัปเดต `CHANGELOG.md` ตรง ๆ

- **วันที่:** 2026-10-25
- **สถานะ:** `accepted`
- **ตัดสิน:** ทุก PR เขียน fragment ใน `changelog.d/F080-*.md` และรัน `npx tsx server/changelog.ts check`
- **เหตุผล/หลักฐาน:** `changelog.d/README.md` และ CI `fast-checks`
- **Rollback:** ไม่ต้องมี

## D-016 — Authoring pipeline เดียว + budget ที่บังคับก่อน dispatch

- **วันที่:** 2026-10-25
- **สถานะ:** `proven` (pipeline + budget), `open` (live provider)
- **ตัดสิน:** ทั้ง AI และคนใช้ `authorToolPackage()` เส้นเดียว: validate → compile → isolated trial → activate พร้อม record ที่แยก requester / generator / reviewer และ **generator ถูกเรียกได้เฉพาะผ่านฟังก์ชันที่ตรวจ budget ก่อน** (ถ้า estimate เกิน cap จะไม่เรียกเลย) · declaredWrites มาจาก package ผ่าน `buildToolBehaviorRequest()` ไม่ใช่จากผู้เรียก และ `checkToolBehaviorFreshness()` บังคับ `TOOL_STALE_REVISION`/`TOOL_SOURCE_REVOKED` ก่อน side effect
- **เหตุผล/หลักฐาน:** `authoring.test.ts` 12/12 (พิสูจน์ว่า generator ไม่ถูกเรียกเมื่อเกิน budget, repair ได้ diagnostics, trial failure บล็อก activation, hand edit ที่ไม่เปลี่ยนอะไรถูก reject, AI ได้ base ที่คนแก้) · `tool-behavior-request.test.ts` 11/11 (scope มาจาก package, freshness codes ทำงานจริง)
- **ทางเลือกที่ตัดทิ้ง:** ให้ UI/route เรียก generator เองแล้วค่อยตรวจ budget ทีหลัง — ตรวจไม่ทันต้นทุนจริง · ให้ caller ส่ง declaredWrites เอง — ขยาย scope ได้เกิน package
- **Contract ที่กระทบ:** `runtime/tools/authoring.ts`, `shared/tool-behavior-request.ts`
- **Rollback:** ปิด generator = AI route fail closed โดย pipeline/คนยังทำงาน
- **ข้อจำกัด:** ยังไม่มีการเรียก model จริง (GATE-PAID-AI) · source editor UI ยังไม่ทำ · ยังไม่มี readback บนโต๊ะจริง

## D-017 — เก็บ collaboration space เป็น optional field บน workspace (ไม่มี migration)

- **วันที่:** 2026-10-25
- **สถานะ:** `proven` (storage round-trip) · `open` (route/grants)
- **ตัดสิน:** `TableState.collaborationSpace?: CollaborationSpace` — เพิ่มแบบ optional แบบเดียวกับ `notes` (F037) และ `cardMeta` (F054) ไม่มีตาราง/คอลัมน์/migration ใหม่ และไม่มี D1 change ที่ต้องขออนุมัติ
- **เหตุผล/หลักฐาน:** ไม่มี zod schema เข้มงวดครอบ domain state ที่เก็บลง storage (grep ใน `server/` ไม่พบ `domainStateSchema`/`tableStateSchema`; อ่านกลับผ่าน `parseJsonValue`) จึงเพิ่ม field ได้โดยไม่ต้องแก้ codec · `domain/collaboration-space.test.ts` 9/9 (workspace ที่ไม่มี space อ่านสะอาด, create ทำให้ owner เป็น manager คนเดียว, addMember ไม่แตะ `sources`, JSON round-trip เท่าเดิม, schemaVersion ใหม่ถูกปฏิเสธโดยไม่ทำ workspace พัง) · `npx vitest run src/tabletop` 801/801 ยืนยันว่าไม่มี regression
- **ทางเลือกที่ตัดทิ้ง:** สร้างตาราง/aggregate ใหม่ใน DO SQLite — ต้องมี migration + scoped approval โดยยังไม่ได้อะไรเพิ่มในระดับ storage · เก็บทุกอย่างใน `TableProgram` — ชนเพดาน 64 KiB และทำให้ space ผูกกับ rule revision
- **Contract ที่กระทบ:** `shared/table-contracts.ts` (field เดียว), `domain/collaboration-space.ts` (ใหม่), `shared/collaboration-space.ts` (มีอยู่)
- **Rollback:** ลบ field ออกได้ทันทีเพราะ reader ทนการไม่มี field; ไม่มี schema ที่ apply ไปแล้วให้ย้อน
- **ข้อจำกัด:** ยังไม่มี route/command ผ่าน authority (จะทำใน C6/C7) · space ยังไม่ผูก connection/projection จริง · ถ้าต้อง query space ข้าม workspace จะต้องมี index/migration แยกและขออนุมัติ

## D-018 — Space commands เดินผ่าน command path เดิม (ไม่เพิ่ม route)

- **วันที่:** 2026-10-25
- **สถานะ:** `proven`
- **ตัดสิน:** เพิ่ม `SPACE_COMMANDS` เข้า `publicCommands.table` และ hook ใน `handleTableCommand` ครั้งเดียว แทนการเปิด endpoint ใหม่ · payload ถูก parse ที่ขอบเขตด้วย zod (strict) แล้วจึงถึง domain · `space.create` สงวนให้ owner; ที่เหลือใช้ role×verb ของ space
- **เหตุผล/หลักฐาน:** `domain/collaboration-space.test.ts` 17/17 (รวม maker link source ได้แต่จัดการสมาชิกไม่ได้), `shared/collaboration-space-command.test.ts` 12/12, `server/collaboration-space-commands.test.ts` 7/7 (allowlist ต่อ kind, invented command ถูกปฏิเสธ, trusted operation เป็นส่วนเพิ่มไม่ใช่ทางข้ามสิทธิ์)
- **ทางเลือกที่ตัดทิ้ง:** route ใหม่ `/api/spaces/...` — เพิ่ม surface + auth ที่ต้องพิสูจน์ซ้ำ โดยยังไม่ได้อะไรเพิ่ม
- **Rollback:** ลบ 2 บรรทัด (import + spread) และ hook 1 บรรทัด
- **ข้อจำกัด:** ยังไม่มี UI/route เฉพาะของ connection และยังไม่มีการทดสอบผ่าน HTTP จริง

## D-019 — Connection protocol: grant ที่ต้นทาง, revoke มี effective point, in-flight ต้องถูกปฏิเสธ

- **วันที่:** 2026-10-25
- **สถานะ:** `proven` (protocol) · `open` (transport)
- **ตัดสิน:** `TOOL_CONNECTION_PROTOCOL` เป็นแหล่งความจริงเดียว (snapshot/freshness/commit owner/atomicity/in-flight/revocation/recovery) · grant เก็บที่ source ใน `TableState.spaceGrants` และ client ระบุได้แค่ space/audience/projections/actions — epoch/dataRevision/issuer/เวลา/version ถูกประทับจาก state จริง · `authorizeProjectionRead` ตรวจ revoke ก่อน stale epoch · `adjudicateInFlight` ปฏิเสธคำขอที่ค้างเมื่อ grant ถูกถอนหรือ source reset · `projectionUsableAt` ปิด cache ตั้งแต่ `revokedAt`
- **เหตุผล/หลักฐาน:** `tool-connection.test.ts` 14/14, `tool-grant.test.ts` 10/10, `server/collaboration-space-commands.test.ts` 7/7; ยืนยันว่าไม่มี distributed atomicity และไม่มีการเขียนหลาย authority ใน operation เดียว
- **ทางเลือกที่ตัดทิ้ง:** ให้ destination เก็บสำเนา grant เอง — จะทำให้ revoke ที่ source ไม่มีผล; re-read ก่อน write แล้วหวังว่าปิด race ได้ — แผนห้ามไว้ชัด
- **Contract ที่กระทบ:** `shared/tool-connection.ts` (ใหม่), `TableState.spaceGrants?` (additive), `domain/tool-grant.ts`, `server/authority.ts` allowlist
- **Rollback:** ลบ field/commands ได้โดยไม่ต้อง migrate; reader ทนการไม่มี field
- **ข้อจำกัด:** ยังไม่มี transport ข้าม Room (Room A อ่าน Room B), ไม่มี subscription/invalidation จริง, ไม่มี UI; ผลที่ผู้ใช้เห็น/export ไปแล้วเรียกคืนไม่ได้ และต้องรายงานตามนั้น

## D-020 — Transport ข้ามห้องใช้ internal route ของ Worker (ไม่เพิ่ม secret)

- **วันที่:** 2026-10-26
- **สถานะ:** `accepted` (decision) · resolver พิสูจน์แล้ว · HTTP wiring ยังไม่ทำ
- **ปัญหา:** การอ่าน projection ข้าม workspace ต้องตอบสองคำถามพร้อมกัน — (1) ผู้ใช้เป็นสมาชิกของ *space* ปลายทางหรือไม่ (คำตอบอยู่ที่ปลายทาง) และ (2) ต้นทางได้ให้ grant ไว้หรือยัง (คำตอบอยู่ที่ต้นทาง) · ทางเลือกที่ต้อง secret ใหม่ (HMAC ระหว่าง Room) ถูกตัดออกเพราะเท่ากับขอ operator config ที่ยังไม่อนุมัติ
- **ตัดสิน:** ให้ **Worker** เป็นผู้ไกล่เกลี่ย โดยไม่ต้องมี secret:
  1. client เรียก `GET /api/workspaces/<spaceId>/space/projection?connection=<sourceId>&port=<portId>` ด้วย session ของตน
  2. Worker authenticate session แล้วอ่าน view ของ workspace ปลายทาง → ตรวจว่า actor เป็นสมาชิกของ space นั้นจริง (นี่คือคำตอบของ (1))
  3. Worker เรียก Room ต้นทางด้วย `internalRequest(request, '/internal/space-projection')` โดยส่ง `{ grantId, spaceId, actorId, portId }`
  4. Room ต้นทางเรียก `resolveSpaceProjectionRead()` กับ grant ที่ตัวเองถืออยู่ + epoch ปัจจุบัน + คำยืนยันสมาชิกจากปลายทาง แล้วตอบ projection หรือ code ที่ปฏิเสธ
  5. ทุกครั้งที่อ่านต้องผ่านขั้นนี้ซ้ำ — ไม่มี cache ให้ต้อง purge เมื่อ revoke
- **เหตุผลว่าทำไมไม่ต้อง secret:** internal routes ของ Room ถูก match ด้วย path ที่เท่ากับ `/internal/...` เป๊ะ (`cloudflare/room-http.ts:77+`) ขณะที่ Worker ส่งต่อให้ Room เฉพาะ path ที่ match `/api/workspaces/<uuid>` และส่ง URL เดิมไป → client ไม่สามารถทำให้ Room เห็น path `/internal/...` ได้ (แผนเดียวกับที่ `/internal/create`, `/internal/view` ใช้อยู่แล้ว — `cloudflare/index.ts:71`)
- **การตัดสินใจที่อยู่ในฟังก์ชันเดียว:** `shared/space-projection-read.ts` — grant ต้องเป็นของ space/ต้นทางนั้น, ต้องไม่ถูก revoke ก่อน `now`, ต้องมีคำยืนยันสมาชิกที่ตรงกับ actor, ต้องไม่ stale epoch, ต้องมี port ที่ grant เปิด — คืน `sourceDataRevision`/`grantVersion`/`readAt` ติดไปทุกครั้ง (7/7 tests)
- **ผลต่อ finding 7:** การ re-read ไม่ใช่หน้าที่ของผู้เรียกอีกต่อไป เพราะจุดตัดสินใจรับ "grant ปัจจุบัน" เป็น input และ transport ต้องอ่าน state ใหม่ภายในจังหวะ commit
- **ทางเลือกที่ตัดทิ้ง:** ให้ destination เก็บสำเนา grant (revoke ที่ต้นทางจะไม่มีผล) · ให้ client ถือ token แล้วอ่านเอง (ย้ายการตัดสินใจไปฝั่ง client) · ใช้ HMAC secret ระหว่าง Room (ต้องขอ config ใหม่โดยยังไม่จำเป็น)
- **Rollback:** ลบ route + handler; resolver เป็น pure function ที่ลบได้โดยไม่กระทบ state
- **ข้อจำกัด:** ยังไม่มี subscription/push (อ่านตาม request) · ยังไม่มี test ระดับ Worker ที่มีสอง workspace จริง — ต้องทำก่อนอ้าง JOIN-01 · ไม่มี global snapshot ข้ามแหล่ง (ตาม D-019)

## D-021 — last-seen เป็นคำสั่งของห้อง ไม่ใช่ค่าที่ route เดา

**บริบท:** recap ต้องบอกว่าใครอ่านถึง revision ไหน (เกณฑ์ HIST-01) และ `buildSpaceRecap` รับ `lastSeen` ได้แล้ว (15/15) แต่ยังไม่มีที่เก็บค่าจริง

**การตัดสินใจ:** เก็บ last-seen เป็นฟิลด์ของ space state (`seen: Record<actorId, revision>`) และเขียนผ่านคำสั่ง `space.seen` ตามห่วงโซ่ปกติ (schema → parse → apply → activity) ไม่ให้ route เขียนข้อมูลเอง

**เหตุผล:** (1) การอ่านไม่ควรเปลี่ยนข้อมูล — ถ้า route เขียน last-seen ระหว่าง GET จะทำให้การอ่านกลายเป็นการเขียน และเกิด race กับ revision (2) คำสั่งเดินผ่าน authority เดิม จึงได้ actor/permission/receipt ฟรี (3) ฟิลด์นี้ additive ⇒ ไม่ต้อง migration

**ผลที่ต้องตามมา:** `applySpaceCommand` ต้อง bump `revision` ตามกติกาเดิม, recap ต้องอ่าน `seen` จาก state แล้วส่งเข้า `buildSpaceRecap`, และ member ที่ยังไม่เคยเรียกจะยัง `unseen: true` ตามที่ตกลงไว้

**ขั้นที่ยังไม่ทำ:** ห่วงโซ่นี้ยังไม่ลงโค้ด — ต้องแก้พร้อมกัน 6 จุดใน `shared/collaboration-space-command.ts` (array, schema, union, parse switch, apply case) และ `shared/collaboration-space.ts` (type)

**แผนที่ไฟล์ที่ตรวจแล้ว (สำหรับลงมือรอบถัดไป):**

| ไฟล์ | จุดที่ต้องแก้ |
| --- | --- |
| `shared/collaboration-space-command.ts` | `SPACE_COMMANDS` (บรรทัด ~15-24), schema ใหม่, union `ParsedSpaceCommand`, `case 'space.seen'` ใน `parseSpaceCommand` (~บรรทัด 120) |
| `shared/collaboration-space.ts` | ฟิลด์ `seen?: Record<string, number>` ของ state + `case 'space.seen'` ใน `applySpaceCommand` (ไม่ได้อยู่ในไฟล์ command) + bump `revision` |
| `domain/collaboration-space.ts` | `toSpaceCommand` (~บรรทัด 154) และ `spaceLabel` (~บรรทัด 166) |
| `cloudflare/space-recap-transport.ts` | ส่ง `lastSeen` (อ่านจาก state) เข้า `buildSpaceRecap` |
| `shared/collaboration-space-command.test.ts` | เปลี่ยน `it.todo` 6 ข้อเป็นเทสต์จริง (สัญญาเขียนไว้แล้ว) |

**สถานะ:** ยังไม่ลงโค้ด — สัญญา (todo 6 ข้อ) และแผนที่ไฟล์พร้อมแล้ว

## D-022 — room shell คือ C · Split ledger

**บริบท:** เสนอสามแนวพร้อมภาพจริงและผล ui-gate (14/16 measured, 4 skipped) ในรอบที่ 16

**การตัดสินใจของผู้ใช้ (2026-10-26):** เลือก **C · Split ledger** — รายชื่อโต๊ะซ้าย, ตารางข้อมูลรวมกลาง, แผงเครื่องมือ/recap ขวา

**เหตุผล:** ตรงกับจุดขาย joined tables ที่สุด และมีที่ให้ recap/impact โดยไม่ต้องเพิ่มหน้าจอใหม่; จอแคบยุบเป็นคอลัมน์เดียวได้

**ผลที่ต้องตามมา:** shell ต้องใช้ token ของ repo (ไม่ใช่ hex ใน mockup), ต้องผ่าน ui-gate ด้วยตัวเลขจริงก่อนอ้างว่าเสร็จ, และเป็นที่ mount ของ `ToolAuthoringPanel`, `JoinedProjectionView` และ recap/impact

## D-023 — วงเงิน paid-AI สำหรับ dev

**การตัดสินใจของผู้ใช้ (2026-10-26):** อนุมัติ **3 runs × ≤6 calls, ≤USD 0.20/run** (รวม ≤18 calls / ≤USD 0.60) สำหรับการทดสอบ AI authoring บน dev เท่านั้น

**ขอบเขตที่ผูกไว้:** ต้องมี budget check ก่อน dispatch ทุกครั้ง (`checkToolAiBudget`), ห้ามใช้กับ production, และต้องรายงานจำนวน call/ค่าใช้จ่ายจริงที่ใช้ไป

## D-024 — EXPORT-01 ปิดด้วยการอ่านกลับของผู้ใช้

**การตัดสินใจของผู้ใช้ (2026-10-26):** เปิด `test-results/export-sample/budget.csv` ใน Excel แล้ว **ถูกต้อง** — 3 แถว, ไทยไม่เพี้ยน, `ห้องโถง, ใหญ่` อยู่เซลล์เดียว, `'=1+1` ไม่กลายเป็นสูตร

**ผล:** `EXPORT-01` = PASS ที่ environment `human` โดยมีผู้ใช้เป็นผู้ยืนยัน ไม่ใช่ inference ของ AI

## D-025 — `/s/:id` เป็น client route และไม่แก้ asset config ของ production

**สิ่งที่ตรวจพบ (2026-10-26):**
- `wrangler.jsonc` ตั้ง `assets.not_found_handling = "none"` และ `run_worker_first = ["/api/*", "/healthz", "/readyz", "/version", "/internal/*"]`
- Worker ไม่มีโค้ดเสิร์ฟ `index.html` สำหรับ path ของแอป (ค้นแล้ว: ไม่มี `parseRoute`/`text/html` ใน `cloudflare/index.ts`)
- ⇒ path อย่าง `/t/:id` หรือ `/s/:id` ไม่มีไฟล์จริงให้ asset service ตอบ และไม่ถูกจัดเข้า worker-first

**ผลที่บันทึกไว้ตรง ๆ:** การเปิด `/s/:id` ตรง ๆ ใน production **อาจ 404** เช่นเดียวกับ `/t/:id` ที่มีอยู่ก่อนแล้ว — เป็นข้อจำกัดเดิมของ repo ไม่ใช่ข้อถอยหลังของงานนี้ การนำทางภายในแอป (history/popstate) ยังทำงาน

**ทำไมไม่แก้:** การเปลี่ยน `not_found_handling` เป็น `single-page-application` คือการเปลี่ยนพฤติกรรมการเสิร์ฟของ **production** ซึ่งอยู่นอกขอบเขตที่อนุญาต (dev-only, no production config) จึงต้องขออนุมัติแยกพร้อมผลกระทบ

**ถ้าจะปิดช่องนี้ภายหลัง:** เปลี่ยน `assets.not_found_handling` เป็น `"single-page-application"` (หรือเพิ่ม `_redirects` แบบ rewrite ไป `/index.html` ที่ status 200) แล้วทดสอบทั้ง `/t/:id` และ `/s/:id` บน staging ก่อน

## D-026 — PROV-01 ยังไม่ปิด: หลักฐานแยกบทบาทได้ แต่เส้นทาง manual review ยังอธิบายไม่ได้

**สิ่งที่ยืนยันแล้ว (จากโค้ดและ probe):** `ToolActivationRecord` มี `requesterActorId`, `generator` (human | ai+generatorId+calls+usd), `reviewer` (auto | manual+actorId), `problems`, `reason`, `recordedAt` — แยกสี่บทบาทจริง และกรณี `auto` ไม่แต่งชื่อคนขึ้นมา

**สิ่งที่ยังอธิบายไม่ได้ (timebox หมดแล้ว):** ใน fixture ที่ถือว่า valid แล้ว reviewer แบบ `auto` activate สำเร็จ แต่ `manual` ไม่ activate ทั้งกรณีผู้สั่งเองและคนอื่น ทั้งที่โค้ดที่อ่าน (`authorToolPackage`) ไม่ได้ใช้ `reviewer` ในการตัดสิน ⇒ มีการปฏิเสธอยู่ก่อนถึงจุดนั้น ยังไม่ได้ระบุว่าเกิดจากที่ใด

**สิ่งที่ต้องแก้ในรายงานรอบก่อน:** ผมเคยสรุปว่า "manual review ไม่เคย activate เพราะนโยบาย" — ที่จริงเทสต์ชุดแรกใช้ package ที่ผิด (`runtimeProfile` และ import pin ไม่ตรง) จึงถูกปฏิเสธด้วย `TOOL_PACKAGE_INVALID` ข้อสรุปนั้นจึงไม่ถูกต้อง และผมถอนคำกล่าวนั้น

**ขั้นถัดไปที่ควรทำ:** ไล่หาว่ามี guard ที่ไหนอ่าน `route.kind`/reviewer (เช่น wrapper หรือ policy module) แล้วเขียนเทสต์ที่ valid จริง; ห้ามสรุปซ้ำจนกว่าจะมี `record.reason` ของเคส valid มายืนยัน

**ผลต่อ acceptance:** `PROV-01` คงเป็น UNVERIFIED — ไม่ใช่เพราะขาดข้อมูลแยกบทบาท แต่เพราะเส้นทาง manual review ยังไม่ผ่านการพิสูจน์

**D-026 (แก้ไข 2026-10-26):** ข้อสรุปเดิมผิด — เมื่อใช้ package ที่ valid จริง (`runtimeProfile = tabletop-tool-1`, import pin ของ repo, และประกาศ behaviour ที่ตรงกับ `behaviorEntry`) reviewer แบบ `manual` **activate สำเร็จ** ทั้งกรณีผู้สั่งเองและคนอื่น (พิสูจน์ด้วย probe: `ok: true` ทั้งสองกรณี) ⇒ ไม่มีนโยบายปิดกั้น manual review; ที่ถูกปฏิเสธก่อนหน้าคือ fixture ที่ผิด และถูกรายงานเป็น `TOOL_PACKAGE_INVALID` ไม่ใช่เหตุผลด้าน reviewer

**บทเรียน:** เทสต์ที่ assert เฉพาะ "ฟิลด์มีค่า" โดยไม่ assert `ok` และไม่พิมพ์ `record.problems` ทำให้เข้าใจผิดได้ — ตอนนี้เทสต์แรกของ PROV-01 บังคับให้ fixture ต้อง valid ก่อน (ถ้าไม่ valid จะเห็น problems ทันที)

## D-027 — EVOLVE-01 ยังไม่ปิด: update รอบสองถูกปฏิเสธด้วย TABLE_PRESERVE_DATA

**สิ่งที่พยายาม:** สร้างโต๊ะที่มี program+records (import → evolve ครบวงจร) แล้ว activate change รอบสองที่แก้แค่ `program.title` จากนั้นเทียบ record ids / action ids / canvas view ids ก่อน-หลัง

**ผล:** `evolve.simulate` ตอบ `422 TABLE_PRESERVE_DATA`

**สิ่งที่รู้จากโค้ด:** guard อยู่ที่ `src/tabletop/domain/table.ts:381` — "A rule edit must retain every current field definition unless a numeric field is promoted with the same id and collection" ⇒ การ activate ซ้ำต้องรักษา field definitions เดิม (หรือ promote numeric field ด้วย id/collection เดิม) ซึ่ง change ที่สร้างจาก `equipmentChange(sourceId)` ควรผ่าน แต่กลับไม่ผ่าน — ยังไม่ทราบสาเหตุ

**สิ่งที่ยังไม่ได้ลอง (สำหรับรอบหน้า):** (1) พิมพ์ diff ที่ guard เห็นจริง (`nextProgram` vs `program`) เพื่อดูว่า field ใดถูกมองว่าเปลี่ยน (2) ตรวจว่า `equipmentChange` สร้าง `computedColumns`/`fields` ชุดใหม่ที่ id ไม่ตรงกับของเดิมหรือไม่ (3) ใช้ change ที่ผู้ใช้แก้ผ่าน UI จริงแทนการสร้างใหม่จาก scenario

**สิ่งที่ถอนออก:** เทสต์ที่เขียนไว้ถูกลบก่อน commit เพื่อไม่ให้ CI แดง — ไม่มีการอ้างว่า EVOLVE-01 ผ่าน

**D-027 (เพิ่ม 2026-10-26):** ลองเส้นทางที่โดเมนรองรับตรง ๆ คือ update แบบ *additive* (เพิ่ม field ใหม่ ไม่แตะของเดิม) — ผลคือ `evolve.propose` ตอบ `422 INVALID_COMMAND` เพราะ payload ของ change ที่ประกอบเองไม่ผ่าน schema (field ที่เพิ่มต้องมีรูปตาม `TableField` ครบ)

**สรุปสถานะ EVOLVE-01:** ยังไม่มีเทสต์ที่ผ่าน — ทั้งเส้นทาง title-only (`TABLE_PRESERVE_DATA`) และ additive (`INVALID_COMMAND`) ถูกปฏิเสธจากสิ่งที่ผมยังไม่เข้าใจ

**หยุดตาม timebox:** สมมติฐานที่ลองแล้ว 2 ข้อจากเพดาน ~5 และ context ต่อรอบใกล้หมด การเดาต่อจะทำให้สรุปผิดซ้ำแบบรอบ 71

**ทางที่ควรทำต่อ (ต้องอ่านข้อมูลจริงก่อน ไม่ใช่เดา):**
1. พิมพ์ schema ของ change (`TableChange`) และของ field ที่ถูกต้อง แล้วสร้าง payload ให้ตรงชนิด
2. พิมพ์ diff ที่ `assertPromotedFieldSafe` เห็นจริงในเคส title-only (ว่า field ใดถูกมองว่าถูกลบ)
3. ถ้า guard ปฏิเสธ update ที่ไม่แตะ field จริง นั่นคือบั๊กของโดเมน ต้องแจ้งเป็น finding ไม่ใช่ปรับเทสต์ให้ผ่าน

**ไม่มีการอ้างว่า EVOLVE-01 ผ่าน และไม่มีเทสต์ที่ล้มค้างใน CI**

## D-028 — last-seen เป็น per-member (ผู้ใช้อนุมัติให้ยกเว้นเกณฑ์ per-device)

**การตัดสินใจของผู้ใช้ (2026-10-26):** ให้เก็บ reading position **ต่อสมาชิก** ไม่ต้องแยกต่ออุปกรณ์

**เหตุผล:** หนึ่งคนมีหลายอุปกรณ์แต่เป็นคนเดียวกัน การมีตำแหน่งเดียวต่อคนอ่านง่ายกว่า และไม่ต้องเพิ่ม device key ใน state/คำสั่ง

**ผลต่อ acceptance:** `HIST-01` ปิดได้ โดยต้องระบุส่วนเบี่ยงเบนนี้ไว้ใน limitation อย่างชัดเจน ไม่ใช่เงียบ

## D-029 — จะลองเดินดูหน้า `/s/:id` บน dev runtime

**การตัดสินใจของผู้ใช้:** ให้ AI ลองสตาร์ท dev server ในเครื่อง (ไม่ใช่ production) และขับ browser เอง แล้วรายงานหลักฐานจริง

**ขอบเขต:** dev-only; ห้าม deploy, ห้ามแตะ production data/config; ถ้าติด auth flow ให้รายงานตรง ๆ ว่า UNVERIFIED

## D-030 — `/s/:id` เสิร์ฟแอปได้เมื่อ build เสร็จ และการเดินดูต้องผ่าน Google sign-in

**สิ่งที่ทดลอง (2026-10-26, dev-only):**
1. `npm run dev:cloudflare` บนพอร์ต 8787 **ล้มเหลว** เพราะมี server อื่นถือพอร์ตอยู่แล้ว (ไม่ใช่ของ session นี้ — ไม่ได้ไปฆ่า)
2. สตาร์ท wrangler บนพอร์ต **8788** พร้อม `dist` ที่ build แล้ว ผลคือ:
   - `/healthz` → 200 json
   - `/` → **200 text/html**
   - `/t/<uuid>` → **200 text/html**
   - `/s/<uuid>` → **200 text/html**
3. เปิดหน้าแรกในเบราว์เซอร์จริง (UI Lab) → ได้ landing page พร้อมปุ่ม **"Continue with Google"**

**แก้ D-025:** ข้อสรุปเดิมที่ว่า path ของแอป "อาจ 404" ไม่ถูกต้องสำหรับ build ปกติ — เมื่อ `dist` มี `index.html` asset layer ตอบ SPA ให้ทุก client route รวม `/s/:id` (404 ที่เห็นก่อนหน้าเป็น server เก่าที่ค้างอยู่บนพอร์ต 8787)

**ข้อจำกัดที่ยังเหลือ:** แอปที่ลงชื่อเข้าใช้ต้องผ่าน **Google OAuth** ซึ่งไม่มีในเครื่องนี้ ⇒ ผมเดินดูหน้า `/s/:id` แบบมี session ไม่ได้ จึงยังไม่พิสูจน์ VISUAL-01/G1/G2 ในระดับ UI จริง

**ไม่มีการกระทำกับ production:** ไม่มี deploy, ไม่แตะ production data/config; ปิด dev server ที่สตาร์ทเองแล้ว

## D-031 — EXEC-01 ยังเป็นช่องว่างของโค้ด: ยังไม่มีทาง commit ผลของ behaviour

**สิ่งที่ตรวจ (2026-10-26):** ค้นทั้ง `cloudflare/index.ts`, `cloudflare/room-http.ts` และ `src/tabletop` ไม่พบ route หรือ trusted operation ที่รับผลจาก tool behaviour ไป commit — มีเพียง

- `shared/tool-behavior.ts` (สัญญา + `validateToolBehaviorOutput`)
- `shared/tool-behavior-request.ts` (`buildToolBehaviorRequest`, `checkToolBehaviorFreshness`)
- `cloudflare/tool-behavior-runner.ts` + `server/local-tool-behavior-runner.ts` (รันใน isolate)
- `shared/permissions` + space matrix มี `tool.run` แล้ว

⇒ behaviour ถูก **validate** ได้ แต่ไม่มีเส้นทางให้ authority **commit** ซึ่งเป็นครึ่งหลังของ EXEC-01 ("authority commit; output นอก scope = zero write")

**ผลต่อการรายงานรอบก่อน:** ผมเคยสรุปว่า 9 ข้อที่เหลือ "ติดเงื่อนไขภายนอกทั้งหมด" — **ไม่ถูก** ข้อนี้เป็นงานโค้ดที่ยังไม่ได้ทำ

**แนวทางที่ควรทำต่อ (ต้องออกแบบก่อนเขียน):**
1. trusted operation ใหม่ `tool-behavior` ใน `server/authority.ts` ที่รับ changeset ที่ผ่าน `validateToolBehaviorOutput` แล้ว และเขียนเฉพาะ resource ที่ **ประกาศไว้** ใน `declaredWrites` (in-port เท่านั้น)
2. domain: ต้องมีคำสั่งที่รับ record create/update จากผล behaviour ได้ (ปัจจุบัน records เปลี่ยนผ่าน action/compute เท่านั้น) — นี่คือส่วนที่ต้องออกแบบ ไม่ใช่แค่ต่อ route
3. route: Worker ตรวจ `tool.run` + freshness (`checkToolBehaviorFreshness`) → Room รันใน isolate → validate → commit ด้วย idempotency key
4. เทสต์: ผลที่ valid → เขียนจริง; resource ที่ไม่ประกาศ/ผิด schema → 4xx และ **zero write**; revision stale → ปฏิเสธก่อนเขียน

**ห้าม:** ให้ behaviour เขียนนอก declaredWrites หรือข้าม authority แม้แต่กรณีเดียว — เพราะนั่นคือช่องที่ทั้งฟีเจอร์นี้มีไว้ปิด

## D-032 — A11Y-01 วัดด้วย ui-gate + theme: 17/17 ทั้งสาม surface

**สิ่งที่รัน:** ui-gate กับ `--full --theme=src/tabletop/ui/tabletop-tokens.css` บน room shell, joined panel และ authoring panel

**ผล:** 17/17 measured ทั้งสาม (เพิ่ม check "ทุก var(--…) resolve กับ theme" จากการให้ theme)

**checks ที่ยัง SKIPPED และเหตุผล (ไม่นับเป็นผ่าน):** DTCG token validity (repo ใช้ CSS custom properties ไม่ใช่ไฟล์ DTCG) · token-pair contrast (ใช้ state-aware contrast ซึ่งวัดจริงและผ่านแทน) · focus trap in dialogs (ทั้งสาม surface ไม่มี modal)

**ข้อจำกัด:** host iframe วัดด้วย driver ของ host harness (sandbox/bridge/ไม่มี cookie-storage-network) ไม่ใช่ ui-gate

## D-033 — behaviour commit ผ่าน "action ที่ประกาศไว้" แทนการเปิดทางเขียนแถวใหม่

**บริบท:** EXEC-01 ต้องการ "custom server algorithm เสนอ state ที่ valid → authority commit; นอก scope = zero write" แต่โดเมนปัจจุบันเขียนแถวได้ทาง action effect และ compute run outputs เท่านั้น (D-031)

**ทางเลือกที่พิจารณา:**
1. เพิ่มคำสั่ง domain ใหม่ที่รับ changeset ของแถวโดยตรง — ยืดหยุ่นสุด แต่เปิดทางเขียนใหม่ทั้งเส้น (validation/invariant/limit ต้องทำซ้ำ) และเสี่ยงที่สุด
2. **ใช้ action ที่ประกาศไว้เป็นทาง commit** (เลือกข้อนี้)

**การตัดสินใจ:** behaviour เสนอ `{ actionId, inputs }` และ host ตรวจด้วย `planToolBehaviorAction` ก่อน แล้ว commit ด้วยคำสั่ง `table.act` เดิมของ authority

**เหตุผล:**
- ไม่มีทางเขียนที่สอง ⇒ invariant/revision/limit/permission/receipt ยังถูกบังคับโดยเส้นทางเดียวกับที่ผู้ใช้กดเอง
- "นอก scope" ตรวจได้ก่อน commit: action ที่ package ไม่ได้ประกาศ หรือตารางไม่มี → plan คืน `ok:false` และไม่มีคำสั่งถูกส่ง ⇒ zero write
- ลดความเสี่ยง regression ในโดเมนขนาดใหญ่ (table.ts ~1.3k บรรทัด) ในช่วงท้ายของงาน

**ข้อจำกัดที่ยอมรับ:** behaviour สร้าง/แก้แถว "ดิบ" ไม่ได้ — ต้องมี action ที่ประกาศไว้ในตาราง ถ้าอนาคตต้องการ free-form writes ต้องทำข้อ 1 อย่างตั้งใจพร้อมรีวิว

**หลักฐาน:** `tool-action-proposal.test.ts` 6/6 · e2e `cloudflare/space-projection-cross.test.ts` ("a behaviour proposal is gated before the commit") — declared action commit จริง (row เปลี่ยน), undeclared → plan refuse และ dataRevision ไม่ขยับ

## D-034 — adapter สำหรับ DeepSeek authoring + CLI สำหรับรันจริง (ยังไม่รันเพราะยังไม่มี key ในเครื่อง)

**สิ่งที่เพิ่ม:** `server/providers/deepseek-tool-package.ts` (`DeepSeekToolPackageGenerator`) และ `author-tool-package-cli.ts`

- ใช้ endpoint/model เดิมของโปรเจกต์ (`api.deepseek.com/chat/completions`, `deepseek-flash`) และคีย์จาก `DEEPSEEK_KEY` ใน environment (ไม่พิมพ์ ไม่เก็บลงไฟล์)
- `response_format: json_object` + ตัวดึง JSON ที่รับมือ reply ที่มี ```fence``` หรือมีข้อความนำ/ตาม
- คืน `{definition, usage:{calls, promptTokens, completionTokens, usd}}` ให้ pipeline ตรวจต่อด้วย `validateToolPackage` — reply ที่ไม่ใช่ package ที่ถูกต้องจะถูกปฏิเสธก่อนถึง isolated trial
- CLI บังคับเพดานที่อนุมัติ: **≤6 calls และ ≤USD 0.20 ต่อ run** (ถ้า estimate เกินจะไม่ยิง request) และพิมพ์สรุป calls/usd/withinCap

**สถานะ:** adapter พิสูจน์แล้วด้วย fetch ปลอม 7/7 (ไม่มีค่าใช้จ่าย) — **ยังไม่มีการเรียกโมเดลจริง** เพราะเครื่องนี้ไม่มี `DEEPSEEK_KEY` (ไม่มี `.dev.vars`/`.env`) และ `AI_DAILY_BUDGET_MICRO_USD` ใน wrangler เป็น 0

**ขั้นปิด G1-01/EDIT-01:** ตั้ง `DEEPSEEK_KEY` ใน environment ของเครื่อง dev แล้วรัน
`npx tsx server/providers/author-tool-package-cli.ts "<intent>"` (และ `--base <package.json>` สำหรับ EDIT-01) แล้วบันทึกผล `calls/usd/withinCap` ลง acceptance ของสองข้อนั้น

## D-035 — เพิ่ม `actions?` ใน `ToolBehavior` (แก้ข้อบกพร่องของ D-033 ที่เจอจาก integration test)

**What happened:** เทสต์ที่ต่อ adapter เข้า pipeline จริงล้มด้วย `PACKAGE_SCHEMA behaviors.0: Unrecognized key: "actions"` — D-033 ใช้ `declaredActions` จาก package แต่ **schema ยังไม่มีฟิลด์นั้น** เทสต์เดี่ยว ๆ ของ D-033 (ที่ส่ง array ตรง ๆ) จึงไม่จับข้อผิดพลาดนี้

**Root cause:** ผมเพิ่มชั้น plan ที่อ้างฟิลด์ของ package โดยไม่ได้แก้ schema ก่อน — และเทสต์ที่เขียนไว้ bypass การตรวจ schema ด้วยการส่ง `declaredActions` เข้าไปเอง

**การแก้:** เพิ่ม `actions?: string[]` (สูงสุด `TOOL_PACKAGE_LIMITS.maxActions` = 8) ใน `ToolBehavior` + `toolBehaviorSchema` แบบ **optional** เพื่อให้ package เดิมยัง validate ผ่านและ hash ไม่เปลี่ยนเมื่อไม่ใช้ฟิลด์นี้

**Correct behavior:** เมื่อเพิ่ม "สัญญาใหม่" ให้ package ต้องแก้ schema พร้อมเทสต์ที่วิ่งผ่าน `validateToolPackage` จริง ไม่ใช่เทสต์ที่ประกอบ object เอง — และควรมีเทสต์ต่อ adapter → pipeline ไว้กันสัญญาไม่ตรงกัน

**หลักฐาน:** 404/404 ใน `src/tabletop/shared` + `src/tabletop/runtime/tools` · `deepseek-tool-package.pipeline.test.ts` 2/2 (AI route activate จริงพร้อม usage, และ reply ที่ไม่ใช่ package ไม่ถูก activate)

## D-036 — สถานะจริงของ "ผลิตภัณฑ์": authoring panel กับ tool surface ยังไม่ถูก mount ในหน้าใช้งาน

**สิ่งที่ตรวจ (2026-10-26):**

- `ToolAuthoringPanel` ถูกใช้แค่ใน browser harness (`tests/ui/tool-authoring/`) — **ไม่มีหน้าจอผลิตภัณฑ์ใด mount มัน**
- `SpaceRoomScreen` ส่งเข้า `RoomShell`: `joinedSources` (จริง, `JoinedProjectionView` ถูก render ในซอง), `tables`, `recap` — แต่
  - `tool` slot = **placeholder note** ไม่ใช่ `GeneratedToolHost`
  - `authoring` slot = **ไม่ถูกส่ง**
  - `onDisconnectSource` = no-op
- ไม่มี Worker route สำหรับ authoring (`cloudflare/*.ts` ไม่มี route tool package) และ Room ไม่มี tool store

**ผลต่อ acceptance:** G1-01/EDIT-01 พิสูจน์ได้เฉพาะระดับ harness + pipeline (PARTIAL) — ไม่ใช่ "ผู้ใช้สร้าง/ใช้ในหน้าจริง" และรายการที่ limitation เขียนว่า "not rendered in a product screen" (HIST-01, IMPACT-01) ก็เป็นเพราะเหตุนี้

**สไลซ์ที่ต้องทำต่อ (ยังไม่เริ่ม):**
1. Room: tool store (per workspace) + คำสั่งติดตั้ง/เปิดเวอร์ชันผ่าน authority (ใช้ `ToolActivationRecord` ที่มีอยู่)
2. Worker: route `/api/workspaces/:id/tools` (อ่านรายการ), `/tools/:packageId/author` (human + AI, ต้องมี `DEEPSEEK_KEY` และ budget), `/tools/:packageId/activate`
3. UI: mount `ToolAuthoringPanel` ในช่อง `authoring` และ `GeneratedToolHost` ในช่อง `tool`, ต่อ `onDisconnectSource` กับคำสั่งถอนจริง
4. เทสต์: browser harness ของ room shell ต้องเห็น tool จริงและ authoring จริง (ไม่ใช่ placeholder)

**ทำไมไม่ทำในรอบนี้:** เป็นงาน 3 ชั้น (Room + Worker + UI) ที่ต้องมี key เพื่อทดสอบ AI route จริง และแตะ authority/store ซึ่งควรทำเป็นสไลซ์ของตัวเองพร้อมรีวิว

## D-037 — สไลซ์ถัดไปของ D-036: ต้องมี "ที่เก็บ package source" ก่อนจะรัน tool ในห้องได้

**สิ่งที่ตรวจ:** `TableState`/โดเมนโต๊ะ **ไม่มี** ที่เก็บ tool package — มีเพียง `space.tool` ที่เป็น reference (packageId/version/contentHash) ที่เพิ่งเพิ่มใน D-036 และ `tool-grant` สำหรับ source grants

**ผลคือ:** หน้าห้องตอนนี้แสดง **การ์ดข้อมูลของเครื่องมือ** ได้ (ทำแล้วใน slice 2) แต่ยัง **รัน UI ของเครื่องมือไม่ได้** เพราะ client ไม่มี source/compiled ของ package

**ดีไซน์ที่ต้องทำต่อ (ยังไม่เริ่ม):**
1. **Store**: เก็บ `definition` ของ package ที่ activate แล้วไว้กับ shared-tool workspace (จำกัดด้วย `TOOL_PACKAGE_LIMITS` ทั้งจำนวนไฟล์และไบต์) — ต้องตัดสินว่าจะเก็บใน `TableState` (JSON, มีผลกับขนาด state) หรือแยกที่เก็บ
2. **คำสั่ง**: `space.installTool` รับ definition เพิ่ม (หรือคำสั่ง `tool.save` แยก) โดย authority ตรวจ hash ตรงกับ definition จริง (`toolPackageContentHash`) ⇒ contentHash ใน reference ต้องพิสูจน์ได้ ไม่ใช่ค่าที่ client อ้าง
3. **Route**: `GET /api/workspaces/:id/space/tool` คืน reference + definition (เฉพาะสมาชิก, เคารพ visibility) ให้ client compile เองด้วย `compileToolPackage`
4. **UI**: mount `GeneratedToolHost` ในช่อง `tool` แทนการ์ด และ `ToolAuthoringPanel` ในช่อง `authoring`
5. **เทสต์**: worker e2e (ติดตั้ง → อ่าน → hash ตรง/ไม่ตรง), browser (host รัน UI ของ package ที่ติดตั้งจริง), isolation ยังต้องผ่าน

**ทำไมไม่ทำในรอบนี้:** เป็นงาน 5 ชั้นที่แตะการเก็บ state + authority + route + UI พร้อมกัน และต้องมีการทดสอบ isolation ซ้ำ — ไม่ควรทำครึ่ง ๆ กลาง ๆ ในโค้ดที่ merge ลง dev แล้ว

## D-038 — D-037 slice 1 merge แล้ว; slice 2 (mount host) ผูกกับ "ทางรัน behaviour" ที่ยังไม่มี

**ทำแล้ว (PR #341):** `SpaceToolInstallation.definition?` + `verifyToolInstall` ใน Room (hash proof ก่อน authority) + แยก `toolPackageContentCanonical` · เทสต์ 6/6 · room+cross 94/94 · shared+domain 659/659

**สิ่งที่ตรวจเพิ่มเพื่อจะต่อ slice 2:** `GeneratedToolHost` ต้องการ `compiled`, `ports` snapshot, `presentation` และ **`onIntent`** ซึ่งคือ "รัน behaviour หนึ่งตัวผ่านทาง authority"

- ทางรัน behaviour จาก client ยังไม่มี route (มีแค่ runner ใน Room/Node + plan ใน shared)
- ถ้า mount host โดยไม่มี `onIntent` จริง = ได้ UI ที่กดแล้วไม่เกิดอะไร ⇒ เป็นของหลอก ไม่ควร merge

**จึงหยุดที่ slice 1 และบันทึกเงื่อนไข:** ต้องมี route `POST /api/workspaces/:id/space/tool/intent` ที่ runner → `validateToolBehaviorOutput` → `planToolBehaviorAction` → `table.act` (D-033) ก่อน แล้วค่อย mount host

**หมายเหตุ:** การ mount host ไม่ได้เป็นเกตของ acceptance ที่ยังค้าง (G1-01/EDIT-01 = provider key, HUMAN-01 = ผู้ใช้จริง) — เป็นงานต่อยอดคุณภาพผลิตภัณฑ์

## D-039 — เพิ่มช่อง `proposal` ใน behaviour ABI (เพราะของเดิม "ไม่มีทางส่งคำเสนอ action")

**What happened:** ก่อนทำ route ตาม D-038 มีการตรวจว่าผลของ behaviour จะเสนอ action ได้หรือไม่ พบว่า **ไม่ได้** — `ToolBehaviorResult` มีแค่ `output` (row changes), wire จาก isolate คือ `{ changes }` และ `validateToolBehaviorOutput` ปฏิเสธ key อื่นทั้งหมด ⇒ `planToolBehaviorAction` (D-033) ไม่มีทางได้รับ proposal จาก behaviour จริง; e2e ที่ปิด EXEC-01 ก่อนหน้านี้ **ประกอบ proposal เองในเทสต์**

**Root cause:** D-033 ตัดสินกลไก commit (ผ่าน `table.act`) แต่ไม่ได้ขยาย ABI ให้ behaviour ส่งคำเสนอ — และเทสต์ที่เขียนไว้ไม่ผ่าน runner จริงจึงไม่จับช่องว่างนี้

**การตัดสินใจ:** เพิ่ม `proposal?: { actionId, inputs }` แบบ **additive**
- `ToolBehaviorResult.proposal?` + `toolBehaviorProposalSchema` (actionId ตามรูปแบบ id, inputs เป็น primitive)
- wire รับ `{ changes, proposal? }` และ entry wrapper ส่งผ่านทั้งสองแบบ (list เดิม หรือ `{ changes, proposal }`)
- `validateToolBehaviorOutput` ยอมรับ key `proposal` และตรวจ schema (ไม่ใช่ปล่อยผ่าน) แล้วแนบไปกับผลลัพธ์; การตรวจสิทธิ์/การประกาศ action ยังเป็นของ `planToolBehaviorAction`

**Backward compatibility:** behaviour ที่คืน list ยังทำงานเหมือนเดิม 100% (wire ไม่มี proposal, validator คืน `changes` เท่านั้น)

**ผลต่อ EXEC-01:** ต้องลดเป็น **PARTIAL** เพราะหลักฐานเดิมใช้ proposal ที่เทสต์สร้างเอง ไม่ได้มาจาก behaviour จริง — จะกลับเป็น PASS เมื่อ e2e รัน behaviour ผ่าน runner แล้วได้ proposal จากมันจริง

## D-040 — route ที่รัน tool ในห้อง: refusal เป็นค่า, hash callback, gate `tool.run`, และที่มาของ `expected`

**บริบท:** D-038 slice 2 — `POST /api/workspaces/:id/space/tool/intent` → Room → runner → validate → plan → `table.act`

**การตัดสินใจ 4 ข้อ:**

1. **refusal เป็นค่า ไม่ throw** — ทุกการปฏิเสธคืน `{ok:false, code, message}` ⇒ route ตอบ code ที่มีความหมาย (ไม่ใช่ 500) และ **ไม่มีคำสั่งถูกส่งเข้า authority**; ยัง throw เฉพาะข้อผิดพลาดจริง (storage) เท่านั้น ต่างจากคำสั่งอื่นที่ใช้ `AuthorityError` เพราะเส้นนี้เป็น "การพยายามรัน" ที่ต้องอธิบายเหตุผลให้ผู้ใช้เห็น
2. **hash callback ของ `compileToolPackage`** ต้อง hash **canonical string** ตรง ๆ (ไม่ใช่ `JSON.stringify` ซ้อน) เพื่อให้ `compiled.contentHash` เท่ากับ hash ที่ install ไว้ — มิฉะนั้นทุกการรันจะถูกปฏิเสธด้วย `TOOL_HASH_MISMATCH`
3. **gate `tool.run`** — ใช้ matrix ของ space (`viewer` ไม่มี `tool.run`) ⇒ `TOOL_NOT_AUTHORIZED`; ไม่อ้างว่า "สมาชิกทุกคนรันได้"
4. **`expected` ของ request** — ห้องไม่ได้เก็บ `ToolInstance` (D-037 เก็บ reference+definition) จึงไม่มี `instanceRevision`/`grantVersion` ของ connection; ใช้ `domain.dataRevision` และ `space.revision` และความสดจริงถูกบังคับด้วย `expectedRevision` ของ `table.act` (ไม่ใช่ `checkToolBehaviorFreshness` ซึ่งยังไม่มีผู้เรียกใน production)

**ช่องว่างที่พบระหว่างทำ (แก้ในรอบนี้):** `ParsedSpaceCommand` ของ `space.installTool` ไม่มีฟิลด์ `definition` ในชนิด แม้ schema รับและ runtime ส่งต่อครบ ⇒ อ่านโค้ดแล้วเข้าใจผิดว่า definition ไม่ถูกพาไป

**ยังค้าง (สำหรับ slice ถัดไป):** code ใหม่ (`TOOL_NOT_INSTALLED`, `TOOL_HASH_MISMATCH`, `TOOL_NOT_AUTHORIZED`) ยังไม่อยู่ใน `TOOL_INTENT_REJECTIONS` (`shared/tool-protocol.ts`) ซึ่ง frame ต้องใช้เมื่อ mount `GeneratedToolHost`

## D-041 — mount host ในหน้าห้องเสร็จแล้ว แต่ **CSP ของหน้า production บล็อก frame** (ต้องตัดสินก่อน merge)

**What happened:** หลัง mount `GeneratedToolHost` ใน `SpaceRoomScreen` และวัดด้วย harness (file://) ได้ผลดี — driver 12 checks, ui-gate 17/17 — เมื่อจำลอง **CSP จริงจาก `public/_headers`** (`script-src 'self'`) หน้า frame กลับ **ว่างเปล่า**:

```json
{ "rendered": "no",
  "consoleErrors": ["Executing inline script violates … script-src 'self' … The action has been blocked."] }
```

**Root cause:** frame เป็น `about:srcdoc` ⇒ สืบทอด CSP ของหน้าหลัก และ bootstrap ของ sandbox เป็น inline script ⇒ ถูกบล็อกทุกครั้ง ไม่ใช่ปัญหา bridge/runner (ทั้งคู่ทำงานใน harness)

**ผลต่อสถานะที่เคยรายงาน:** ISO-01/EXEC-01/G1-03 พิสูจน์ "isolation ทำงาน" ด้วย harness ที่ไม่มี CSP ของ production — **ถูกต้องในระดับกลไก แต่ยังไม่ใช่หลักฐานว่าใช้งานได้บนหน้าที่ deploy จริง** ต้องบันทึกข้อจำกัดนี้

**ทางเลือกที่ต้องให้เจ้าของตัดสิน (ไม่ทำเอง):**
1. เพิ่ม hash ของ inline bootstrap ใน `script-src` ของ `public/_headers` (ดีที่สุดด้านความปลอดภัย ถ้า bootstrap คงที่)
2. เสิร์ฟเอกสาร frame จาก path ที่มี CSP ของตัวเอง (เช่น `/tool-sandbox.html`) แล้วชี้ iframe ไปที่นั่น
3. ผ่อน `script-src` เป็น `'unsafe-inline'` (แย่ที่สุด — ลดความแข็งแรงของทั้งแอป)

**สถานะงาน:** branch `feat/f080-room-host-mount` มีโค้ด mount + tests + gate ที่ผ่านแล้ว แต่เปิดเป็น **draft PR** จนกว่าจะตัดสิน CSP และควรเพิ่ม timeout ตรวจจับ frame ที่ไม่ตื่น (ตอนนี้ถ้า frame ถูกบล็อก ผู้ใช้เห็นช่องว่างโดยไม่รู้สาเหตุ)
