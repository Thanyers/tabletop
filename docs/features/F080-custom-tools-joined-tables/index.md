# F080 — Custom tools & joined tables · checkpoint index

Landing page สำหรับ agent ถัดไป อ่านไฟล์นี้ก่อน แล้วค่อยเปิด `progress.json` / `acceptance.json` / `decisions.md`

- **Feature entry:** [../F080-custom-tools-joined-tables.md](../F080-custom-tools-joined-tables.md)
- **Goal:** native DSH goal `goal-95e6a3b3-fa95-4d67-b31f-8cefa5e8bf5c` (scope JT ทั้งชุด รวม JT-V/JT-X, dev-only)
- **Base:** `origin/dev` `a6feb3c1fbe2aa89396ccf9bc3995467d82e438c` · **branch:** `feat/F080-custom-tools`
- **สถานะ:** 15 PASS / 20 UNVERIFIED (จาก 35) · PR #305 draft · ยังไม่มี production release
- **อ่านต่อ:** `progress.json` (checkpoint ล่าสุด) → `acceptance.json` (เกณฑ์+PASS/FAIL/SKIPPED/UNVERIFIED รายข้อ) → `decisions.md` (D-001…D-026)
- **สิ่งที่ยังปิดไม่ได้เอง:** VISUAL-01/G1/G2 (ต้องเดินดูบน dev runtime ที่มี session จริง) · hosted/human gate · AI provider จริง (วงเงินอนุมัติแล้ว 3×6 calls ≤USD0.20/run แต่ยังใช้ 0)

## Concept (สั้น)

ผู้ใช้เริ่มจาก intent → ได้ **tool package** ที่มีทั้ง UI และ server behavior ใช้งานจริง → เพิ่มข้อมูลภายหลัง → ปรับต่อโดยงานเดิมอยู่ → นำ **โต๊ะของแต่ละคนมาชนกันในห้อง** แล้วสร้างเครื่องมือร่วมที่อ่านหลายต้นทางและเรียก action ที่ได้รับอนุญาตกลับต้นทางจริง โดยแต่ละโต๊ะยังรักษา authority/สิทธิ์ของตน

แกนสถาปัตยกรรม 3 อย่างที่ต้องพิสูจน์ให้ได้ (ไม่ใช่แค่ตั้งชื่อ):

1. **Package host** — generated UI รันใน sandboxed iframe ที่แยกสิทธิ์จาก host พร้อม typed bridge ที่ผูกกับ frame instance จริง; ไม่มี host branch ต่อ use case
2. **Behavior executor** — generated server code รันใน isolate ที่ไม่มี DB/secret/network แล้ว **เสนอ** changeset ให้ authority ตรวจสิทธิ์/revision ก่อน commit หนึ่ง target
3. **Collaboration space** — aggregate ใหม่ที่ถือ shared-tool workspace/layout/membership และ **refs** ไป source workspace IDs เดิม (ไม่ rename/move/clone ข้อมูลต้นทาง)

## Source map (ตรวจแล้วที่ `origin/dev` `a6feb3c1`)

### Package / compute / authority seam

| เรื่อง | ไฟล์จริง | ใช้ทำอะไรในงานนี้ |
| --- | --- | --- |
| compute contracts + limits | `src/tabletop/shared/table-compute.ts` | precedent ของ typed ports/validation/output trust boundary (`validateComputeOutputs`, `COMPUTE_LIMITS`) |
| runtime profile | `src/tabletop/shared/compute-runtime-profiles.ts` | precedent ของ profile id + timeout + wire cap |
| runner (Worker) | `cloudflare/compute-runner.ts` | isolate จริงต่อ invocation: `loader.load({env:{}, globalOutbound:null, limits})` |
| runner (Node/local) | `server/compute-runner.ts`, `server/local-compute-isolate.ts` | local proof path + docker สำหรับ Python |
| wire + entry | `server/compute-wire.ts`, `server/compute-program.ts` | source ส่งเป็น data string แล้ว compile ใน sandbox (ไม่ `eval` ใน host) |
| orchestrator | `server/table-compute-orchestrator.ts` | queue/drain/run/commit loop + trust boundary |
| authority | `server/authority.ts` | `executeTrusted*`, idempotency, `STALE_REVISION`, receipt/event/outbox |
| domain | `src/tabletop/domain/table.ts` | `queueComputeRun`, `decideDomain`, `commitDecision` |
| permissions | `src/tabletop/shared/permissions.ts` | role×permission ที่มีอยู่ (`data.compute`, `rules.approve`, …) |

### Generated UI seam (ปัจจุบันเป็น closed set)

| เรื่อง | ไฟล์จริง | ข้อจำกัดที่ต้องแก้ |
| --- | --- | --- |
| descriptor union | `src/tabletop/shared/generative-contracts.ts` | `GenerativeViewDescriptor` เป็น union ปิด (scene/chart/metric/controls) ไม่มี code/component |
| wire schema | `src/tabletop/runtime/generative/schema.ts` | zod discriminated union + limit ต่อ kind |
| semantic validation | `src/tabletop/runtime/generative/validation.ts` | validator ต่อ kind |
| evaluator | `src/tabletop/runtime/generative/evaluator.ts` | per-kind evaluator + fuel |
| kind metadata | `src/tabletop/shared/view-kinds.ts` | `layoutRole` + capability id ต่อ kind |
| plan node | `src/tabletop/runtime/index.ts` | emit `table.view.<id>` + capability |
| renderer registry | `src/tabletop/ui/GeneratedCanvasObjects.tsx` | `generatedViewRenderers` เป็น compile-time record ต่อ kind |
| mount point | `src/tabletop/ui/TableCanvasObjects.tsx` | branch `table.view.*` ที่จะส่ง descriptor ให้ host ใหม่ |
| canvas layout | `src/tabletop/ui/CanvasWorkspace.tsx`, `src/tabletop/domain/canvas-layout.ts`, `src/tabletop/shared/canvas-layout-ids.ts` | shared layout + CAS `STALE_LAYOUT`; id ใหม่ต้องผ่าน `SHARED_CANVAS_ID_PATTERN` |

**ประเด็นสำคัญ:** ไม่มี TSX/JSX compiler ในเบราว์เซอร์ และไม่มี iframe/CSP/postMessage ใน `src` เลย (`legacy/lab` เป็น dead code ที่ protocol ห้าม script) — C2 ต้องสร้างทั้ง compiler path และ sandbox primitive ใหม่ ไม่ใช่ต่อยอดของเดิม

### Collaboration / identity seam

ดู `progress.json` → `tasks[F080-T2B]` และ [decisions.md](decisions.md) D-004; สรุปที่ตรวจแล้ว: หนึ่ง Room DO = หนึ่ง workspace, transaction commit อยู่ภายใน Room นั้น, `TableState` มีหนึ่ง `TableProgram` → ห้องหลายโต๊ะต้องเป็น aggregate ใหม่ที่อ้าง source workspace IDs

## Ownership และ JT → feature/PR mapping

| Alias | Feature task | Owner | PR | Depends |
| --- | --- | --- | --- | --- |
| C0 / JT-0 | F080-T0 | lead | draft PR (branch `feat/F080-custom-tools`) | startup |
| C1 / JT-1A | F080-T1A | lead + backend | แตก PR ใหม่จาก branch เดียวกัน | C0 |
| C2 / JT-1A | F080-T1A | backend (runner) + frontend (host) | แตก PR | C1 |
| C3 / JT-1B | F080-T1B | backend + frontend | แตก PR | C2 |
| C4 / JT-2A | F080-T2A | lead + backend | แตก PR | C3 |
| C5 / JT-2B | F080-T2B | backend | แตก PR | C1 |
| CV / JT-V | F080-T-V | frontend/design | แตก PR | C0, C1 |
| C6 / JT-3A | F080-T3A | frontend + backend | แตก PR | C4+C5+CV |
| C7 / JT-3B | F080-T3B | backend + UI | แตก PR | C6 |
| C8 / JT-4A | F080-T4A | domain + frontend | แตก PR | C4, C7 |
| C9 / JT-4B | F080-T4B | backend + frontend | แตก PR | C7+C8 |
| C10 / JT-5 | F080-T5 | backend + frontend | แตก PR | C9 |
| CX / JT-X | F080-T-X | export owner (แยก) | แตก PR | C1, C7 |
| C11 | F080-Closure | lead + independent reviewer | — | C10+CX |

lead ถือ shared contracts (`shared/tool-*.ts`), integration, `spec.md`, `PLAN.md`; specialists ถือ runtime/UI ของ slice; independent reviewer อ่าน candidate ที่นิ่งแล้วพร้อม exact SHA

## How to resume

1. อ่าน `progress.json` → `currentCheckpoint`, `tasks[].state`, `nextActions`, `externalGates`
2. ตรวจ actual state เฉพาะที่เกี่ยว (ห้าม audit ทั้ง repo ซ้ำ): `git rev-parse HEAD`, `git status`, `gh pr view`, แล้วเทียบกับ `sha.candidateSha`
3. เลือก task ที่ `dependsOn` ผ่านและไม่มีไฟล์ชนกับ owner ที่ `doing`
4. ถ้า blocker เป็น external gate ให้ทำ disposable local test / งานอิสระอื่นต่อ — ห้ามลด acceptance เพื่อปิด Goal
5. อัปเดต checkpoint เมื่อจบชิ้นงาน/ได้ผลตรวจ/พบ blocker/เปลี่ยน decision และ **ก่อนจบ turn**

## กติกาที่ห้ามลืม

- ห้าม merge `main`, release tag, production deploy/rerun, deploy จากเครื่อง, แก้ production data/config/credential
- persistent DB/schema mutation และ hosted fixture writes ต้องมี scoped approval (environment/object/scope/expected rows/rollback)
- live AI ต้องมี enforceable call/cost cap ก่อน dispatch
- repo เป็น public: ห้ามใส่ secret/Worker ID/room ID/invite link/ชื่อจริง/path ส่วนตัวลงไฟล์ที่ track; รัน `node scripts/check-public-files.mjs` ก่อน commit
- `VISIBILITY_POLICY` เป็นกติกาผลิตภัณฑ์: ห้ามเปลี่ยนค่าระหว่างทำงานนี้ และห้ามลบเส้นทาง `'private'`
- ห้ามเพิ่ม scenario-name switch ให้เคสตัวอย่างผ่าน — เพิ่ม generic capability เท่านั้น
