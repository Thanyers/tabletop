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
