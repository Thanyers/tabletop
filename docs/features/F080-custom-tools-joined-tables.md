# F080 — Custom tools และการชนโต๊ะแบบสด (package host + collaboration space)

| | |
| --- | --- |
| สถานะ | `doing` — bootstrap (C0/JT-0) เสร็จ; C1 กำลังทำ |
| เจ้าของฟีเจอร์ | product owner (ยืนยัน D1–D8 เมื่อ 2026-10-25) · implementation: DeepSeek Harness (lead + specialists) |
| เวอร์ชันที่คาด | MINOR — เพิ่ม surface ใหม่แบบเพิ่มอย่างเดียว ไม่มี destructive migration; rollback = revert branch/PR โดยข้อมูลเดิมไม่หาย (ยืนยันซ้ำตอน merge จริง) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F080` (ฟีเจอร์) และ `F080-T*` (งาน) |
| Checkpoint | [index](F080-custom-tools-joined-tables/index.md) · [progress](F080-custom-tools-joined-tables/progress.json) · [acceptance](F080-custom-tools-joined-tables/acceptance.json) · [decisions](F080-custom-tools-joined-tables/decisions.md) |

## ทำไม

วันนี้ Tabletop สร้าง UI ได้เฉพาะชนิดที่ client เตรียมไว้ (`TableProgram` มี collections/actions/compute/computedColumns/canvas descriptors ที่ปิดชุด) ผู้ใช้ที่เริ่มจากความตั้งใจจึงได้เครื่องมือที่ "ใกล้เคียง" ไม่ใช่เครื่องมือที่ตรงงาน และเมื่อสองคนมีข้อมูลคนละชุดบนคนละโต๊ะ ก็ไม่มีทางประกอบเครื่องมือที่อ่านทั้งสองต้นทางโดยที่แต่ละโต๊ะยังเป็นเจ้าของข้อมูล/สิทธิ์ของตัวเอง

ผลที่ต้องการ: **The Canvas IS the software. Work defines what software becomes.** ผู้ใช้เริ่มจาก intent ได้เครื่องมือที่มี UI + behavior + backend ที่ใช้จริง เพิ่มข้อมูลภายหลัง ปรับต่อโดยงานเดิมยังอยู่ แล้วนำโต๊ะของแต่ละคนมาชนกันในห้องเพื่อสร้างสิ่งใหม่

## สิ่งที่ผู้ใช้จะเห็น

1. คน A เริ่มโต๊ะเปล่า ขอ "ผังพื้นที่กิจกรรม" ได้ผังที่ลากจัดวางและแก้คุณสมบัติได้โดยยังไม่มีไฟล์
2. คน B มีโต๊ะงบประมาณ/ราคา/จำนวนอุปกรณ์ และเพิ่มข้อมูลของตนภายหลังได้
3. ทั้งสองเข้าห้องเดียวกัน เห็นหลายโต๊ะและตำแหน่งที่กำลังทำงาน เลือกเชื่อมเฉพาะ tools/data/actions ที่ต้องการ
4. สร้างเครื่องมือร่วม: ผังอ่านราคา+อุปกรณ์จาก B คำนวณต้นทุน/ความเป็นไปได้ แล้วเรียก action ที่ได้รับอนุญาตกลับไปยังโต๊ะต้นทางหนึ่งแห่ง
5. เปลี่ยนข้อมูลบน B แล้วเครื่องมือร่วมอัปเดตตาม revision/freshness จริง (ไม่มี manual copy แอบแทน)
6. ขอปรับ interaction/logic อย่างน้อยสองรอบ โดยค่าที่ไม่เกี่ยว (values/row IDs/references/layout) ยังอยู่
7. คนแก้ source ของ package เองหนึ่งครั้ง แล้วให้ AI ปรับต่อจาก source นั้นจริง
8. เปิดผลไปถึงข้อมูล/สูตร/รุ่น/run เปรียบเทียบ A/B โดยไม่แก้งานจริง แล้วเลือกใช้บนฐานที่ยังสด
9. กลับมาหลังเว้นช่วง เข้าใจว่าอะไรเปลี่ยนและทำต่อได้; สมาชิกอีกบริบทอ่าน authoritative state ตรงกัน
10. ถอนโต๊ะ B: เครื่องมือร่วมยังอยู่ แสดง missing source และเชื่อมแหล่งใหม่ได้โดยไม่เขียนกลับไป B
11. แพ็กเครื่องมือไปโต๊ะใหม่พร้อม dependencies/mapping และใช้ข้อมูลใหม่ได้ โดยไม่ติดข้อมูล/สมาชิก/แชท/สิทธิ์เดิม

## ขอบเขต

**รวม:** package host/runtime ที่รับ tool package ได้ (UI + server behavior) · AI authoring + คนแก้ source ผ่าน pipeline เดียวกัน · isolated execution + typed bridge · revision/authority/idempotency เดิม · collaboration space aggregate ที่อ้าง source workspace IDs เดิม · multi-source live read + authorized single-target action · version/impact/recovery · A/B ที่ไม่เขียนต้นทาง · copy definitions แบบมีสิทธิ์ · export CSV/HTML ตามสิทธิ์ · visual exploration 3 แนวสำหรับเลือก room shell · โจทย์เรียนรู้/เล่นที่เลือกหลัง host พร้อม

**ไม่รวม:** merge main / release / production deploy หรือแก้ production data · Writes ลง hosted fixture ก่อนได้ scoped approval · paid AI ก่อนมี enforceable cap · public room discovery/marketplace · 3D/avatar (ยังไม่ถูกเลือก) · distributed multi-write แบบ atomic ข้าม authority (ต้องมี protocol ก่อน; unsupported → reject ก่อน side effect) · share link/guest/mobile participation (WP-R แยก ไม่ใช่เกณฑ์จบ)

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-25, `origin/dev` `a6feb3c1`)

- หนึ่ง workspace = หนึ่ง Room DO: `cloudflare/room-repository.ts` ผูก Room กับ workspace เดียว และ commit transaction อยู่ภายใน Room นั้น — ยังไม่มี cross-Room transaction protocol ในเส้นทางนี้
- `TableState` มีหนึ่ง `TableProgram`; collections/notes/cardMeta/computeRuns อยู่ภายในโต๊ะเดียว ไม่ใช่หลายโต๊ะ: `src/tabletop/shared/table-contracts.ts:31-43` (`TableProgram`) และ `:78-123` (`TableState`)
- สิทธิ์ต่อโต๊ะเป็น role×permission ที่นิยามจริงแล้ว ไม่ต้องสร้าง engine ใหม่: `src/tabletop/shared/permissions.ts:9-46` (`COMMON_PERMISSIONS` + `KIND_PERMISSIONS` ต่อ `CaseKind`) และ `:108-129` (`memberPermissions`/`viewerCan`, server ตัดสินเสมอ)
- compute ที่มีอยู่เป็น seam สำหรับ server behavior ใหม่ ไม่ใช่ของที่ต้องรื้อ: `src/tabletop/shared/table-compute.ts` (contracts/limits), `server/table-compute-orchestrator.ts` (เส้นทาง authorize→run→commit), `cloudflare/compute-runner.ts` (isolated runner + limits)
- generated UI วันนี้เป็น closed descriptor set ผ่าน `src/tabletop/shared/generative-contracts.ts` + `src/tabletop/runtime/generative/{schema,validation,evaluator}.ts` และ render ด้วย `src/tabletop/ui/GeneratedCanvasObjects.tsx`
- layout/visibility: `canvasLayout` อยู่บน `TableState` (shared, มี revision) และ `VISIBILITY_POLICY` รวมศูนย์ที่ `src/tabletop/shared/visibility.ts` (ปัจจุบัน `'open'`; ห้ามลบเส้นทาง `'private'`)

รายละเอียด source map + evidence ต่อ slice อยู่ใน [index](F080-custom-tools-joined-tables/index.md)

## งาน

Alias `JT-*` ใน handoff แมปเป็น `F080-T*` ด้านล่าง · แต่ละ row แตก PR ได้มากกว่าหนึ่ง · ลำดับวิกฤต T0 → T1A/T1B → T2A → T3A/T3B → T4A/T4B → T5 (T-V, T2B, T-X ขนานตาม dependency)

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T0 (JT-0) | bootstrap: feature/PR mapping, baseline แยก evidence level, checkpoint artifacts, acceptance registry | checkpoint 4 ไฟล์ + PLAN row + draft PR เปิด; ไม่ต้องรอ human/hosted |
| T1A (JT-1A) | package/instance/binding/connection/version schemas + validation + storage contract + reader compatibility | package round-trip, invalid/cycle rejection, old tables reload; migration draft แยกอนุมัติ |
| T1B (JT-1B) | AI authoring + human source editing + activation/readback บนโต๊ะเดียว | intent-only generate; human source edit; AI evolve จาก source ที่คนแก้; live-provider gate แยก |
| T-V (JT-V) | visual exploration 3 แนว (top-down / isometric / composable canvas) ด้วยภารกิจเดียวกัน | interactive artifact + screenshot + comparison; owner เลือกก่อน room shell |
| T2A (JT-2A) | nested composition, dependency graph, selective editing, package upgrades | สองรอบแก้รักษา records/IDs/layout; incompatible upgrade ถูก reject; source/bundle lineage |
| T2B (JT-2B) | collaboration space/membership/roles/grants/connection protocol + disconnect | member/role/grant tests; revoked subscription/job/cache; new-member negative |
| T3A (JT-3A) | room shell ตามที่เลือก + shared tool workspace + live multi-source bindings | 2 โต๊ะ/2 actor, source edit propagate, reload ได้ state จริง |
| T3B (JT-3B) | authorized action กลับต้นทาง, disconnect/rebind, third-table topology | one-target commit/retry/stale/revoked; tool อยู่ต่อโดยไม่ leak stale data; 3-table case |
| T4A (JT-4A) | context/recap เต็ม, impact/drill-down รวม package/logic/connection revisions | criteria WP-1/2 เดิม + source/version/connection readback |
| T4B (JT-4B) | scoped transforms/recovery + saved A/B + promote | scenario ไม่เขียนต้นทางจริง; freshness/conflict/seed; scoped restore ไม่ทับงานใหม่ |
| T5 (JT-5) | portable definitions/import mapping + held-out learning/play | schema/ข้อมูลใหม่ใช้งานได้; ไม่มี private payload/grants; ไม่มี host special case |
| T-X (JT-X) | export CSV/HTML ของข้อมูลและผลที่ได้รับอนุญาต | server-side permission/limits + revision-consistent + เปิดในแอปปลายทางได้ |

## คำถามเปิด

- เลือก room shell จาก T-V (ต้องให้เจ้าของเลือก — ไม่เลือกแทน)
- Live AI acceptance ต้องมี enforceable cap ก่อน dispatch (รอ authorization เฉพาะส่วน)
- Hosted synthetic writes / persistent schema mutation ต้องมี scoped approval ก่อน apply

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-25 | ใช้ feature ID **F080** | ตรวจแล้วไม่มี branch/PLAN row/open PR ที่ใช้ ID นี้; F079 เป็นตัวสูงสุดที่ถูกใช้ · ห้ามถือว่า F080 ถูกจองก่อนตรวจ |
| 2026-10-25 | checkpoint เดียวที่ `docs/features/F080-custom-tools-joined-tables/` | ตาม execution guide §2; chat history ไม่ใช่สถานะงานหลัก |
| 2026-10-25 | แยก PR ต่อ slice (C0…C11) ไม่ทำ mega-PR | ให้ review ได้จริงและ isolate ความเสี่ยงต่อ authority/isolation |
| 2026-10-25 | collaboration space เป็น aggregate ใหม่ที่อ้าง source workspace IDs | Room DO วันนี้ผูก 1 workspace; การวาดหลายโต๊ะบน canvas ไม่ทำให้เกิดหลาย authority เอง |

รายละเอียด decision log (รวม rollback/migration notes) อยู่ที่ [decisions.md](F080-custom-tools-joined-tables/decisions.md)
