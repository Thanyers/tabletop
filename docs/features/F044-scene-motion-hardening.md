# F044 — Scene motion hardening: fresh build, browser proof, diagnostics

| | |
| --- | --- |
| สถานะ | `todo` (แผนพร้อมลงมือ) |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR ถ้าเพิ่ม repair/diagnostics ที่เปลี่ยนพฤติกรรม · PATCH ถ้าแก้เฉพาะ prompt/test |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F044-T*` |
| ฐานราก | `origin/dev` หลัง merge PR #145 (sync main 5.0.0) — ก่อนเริ่มต้อง merge `origin/main` เข้า branch ใหม่ก่อน |

## ทำไม (หลักฐานจากรอบ 5.0.0)

รอบ 5.0.0 ขึ้น production แล้ว (`/version` = `5.0.0 / e8c2d73`, staging = production) และ motion ทำงานในระดับ schema/evaluator/client แล้ว แต่ยังมีช่องว่างที่วัดได้:

1. **สร้างโต๊ะใหม่จากคำบรรยายวัตถุเคลื่อนที่ ยังไม่ได้ scene** — live probe 2 รอบด้วย `deepseek-flash` (คำขอ "สร้างสนามทดลองเดินรถ 10 เมตร...") ได้ controls + metric โดยไม่มี scene และไม่มี motion แม้ prompt มีคำสั่ง "MUST include a scene" แล้ว
2. **แก้โต๊ะเดิมผ่าน 2/2** — live probe กับโต๊ะที่มีฉากรถอยู่แล้ว เก็บ view `track` และใส่ `motion` ให้ car + wheel-1 + wheel-2 ด้วย speed จาก `settings.speed_mps` (18–43s)
3. **ไม่มี browser test ของการเคลื่อนไหว** — มีแต่ unit test ของ `motionPosition`/`applySceneMotion`; ยังไม่มีหลักฐานว่าในเบราว์เซอร์จริงรถเลื่อน วนลูป Pause แล้วหยุด และ reduced motion หยุดจริง
4. **view ที่ผิดถูกตัดเงียบ ๆ** — ตัวอย่าง expression ที่ขาด `op:"math"` ทำให้ scene ไม่ผ่าน schema แล้ว `canvasSalvagedChange` ตัด view ทิ้งโดยไม่มีร่องรอย ทำให้ draft ดู "สำเร็จ" แต่ของหาย
5. **แต่ละ client เริ่มเฟสต่างกัน** — clock เริ่มตอน mount ทำให้สมาชิกเห็นรถคนละตำแหน่ง
6. **เพดาน assistant ยังเป็น 48 KiB body / 192 KiB state** — โต๊ะใหญ่กว่าจะได้ `TABLE_ASSISTANT_CONTEXT_TOO_LARGE` โดยไม่รู้จำนวนไบต์จริง
7. **รอบ release ชนกัน** — มี `release/4.4.0` และ `release/5.0.0` พร้อมกัน และ PR sync #145 conflict; ต้องกำหนดเจ้าของ release ให้ชัด

## ขอบเขต

**รวม:** corpus ของคำขอเกี่ยวกับวัตถุเคลื่อนที่ · prompt/repair ให้สร้าง scene เมื่อจำเป็น · browser test ของลูป/Pause/reduced motion · diagnostics ของ view ที่ถูกตัด · ทางเลือก shared phase/performance · การวัดเพดานจริงก่อนขยาย · อัปเดตเอกสารและ PLAN

**ไม่รวม:** ไลบรารี animation ภายนอก (framer-motion/GSAP), DSL ใหม่นอก `motion`, auto-apply กฎ (F039 — คนละงาน), การขยายเพดานโดยไม่มีตัวเลข, การเล่นหลาย client พร้อมกันจริง

## หลักการที่ใช้

1. **วัดก่อนแก้** — ทุกเพดาน/พฤติกรรมต้องมีตัวเลขหรือ repro ก่อน (เช่น SSE 188 tokens = 55,890 bytes; edit 2/2, fresh 0/2)
2. **แก้ที่ชั้นที่พัง** — validation ไม่ผ่าน → แก้ schema/prompt ไม่ใช่ไปเพิ่ม token; view ถูกตัด → เพิ่ม diagnostics ไม่ใช่กลบ
3. **change เล็กที่สุดที่พิสูจน์ได้** — ไม่ขยาย token/response ทั้งระบบเพราะมีคนขอ; ขยายเฉพาะที่ชนและมี test
4. **ไม่เก็บสถานะแอนิเมชันลงโต๊ะ** — client-only, table state ยังเป็น authority
5. **เข้าถึงได้** — Pause/Play และ `prefers-reduced-motion` ต้องคงอยู่
6. **rollback ต้องรู้จริง** — `motion` เป็น strict schema; รุ่นเก่าจะไม่รู้จัก (5.0.0 จึงเป็น MAJOR) ต้องเขียนใน CHANGELOG ทุกรุ่นที่แตะ schema

## งาน

| ID | งาน | ไฟล์/พื้นที่ | เกณฑ์เสร็จ |
| --- | --- | --- | --- |
| F044-T1 | Motion corpus + baseline: เพิ่มเคส "รถวิ่งวน/ลูกบอล/ pendulum" 10 เคส × 3 trials วัดว่ามี scene + motion กี่รอบ | `tests/corpus/table-prompts.json`, `server/corpus-success-rate.test.ts`, `experiments/eval/` (ไม่ commit ผล live) | บันทึกตัวเลข fresh-build scene rate, draft rate, P95 latency; ใช้เทียบก่อน/หลัง T2 |
| F044-T2 | Prompt/repair: ใส่ตัวอย่าง scene ขนาดสั้น 1 ตัวอย่าง + repair issue "คำขอนี้บรรยายวัตถุเคลื่อนที่แต่ draft ไม่มี scene/motion" (ไม่ใช้ scenario switch) | `server/providers/table-schema-guide.ts`, `server/providers/deepseek-changes.ts`, `cloudflare/ai.ts`, `cloudflare/repair.ts` | motion fresh-build มี scene ≥8/10 drafts; corpus เดิม matched ≥18/20 และ first-attempt ≥50% ไม่ถอย |
| F044-T3 | Browser proof: fixture ที่มี motion + Playwright ตรวจ x เพิ่ม, วนกลับ, Pause แช่แข็ง, reduced motion นิ่ง, ไม่มี table write | `src/tabletop/testing/generative-scenarios.ts`, `tests/generative-canvas-browser.mjs`, `src/tabletop/ui/scene-motion.ts` | check ใหม่ผ่านใน `npm run test:generative:browser` และมี screenshot เก็บใน `test-results/`; รันซ้ำ 2 รอบไม่ flaky |
| F044-T4 | Diagnostics: `canvasSalvagedChange` คืน view id + issue แรก; job เก็บ `droppedViewIds`/`droppedViewIssues` ที่อ่านได้โดยไม่โชว์ข้อมูลส่วนตัว | `src/tabletop/domain/table.ts`, `src/tabletop/domain/table-canvas-salvage.test.ts`, `cloudflare/ai.ts`, `cloudflare/room.ts`, `cloudflare/table-assistant.ts` | unit test: view ผิด 1 ใบถูกตัดและรายงาน id/issue; ไม่กระทบ draft ที่ถูกต้อง |
| F044-T5 | Shared phase/performance: ตัดสินใจระหว่าง clock ต่อ client (ปัจจุบัน) กับ phase จาก wall clock หรือ transform + Web Animations API | `src/tabletop/ui/scene-motion.ts`, `src/tabletop/ui/GeneratedCanvasObjects.tsx` | เขียน decision + ตัวเลข; ถ้าเปลี่ยน ต้องเห็นเฟสตรงกัน ±1s และ FPS ไม่แย่ลง; ถ้าไม่เปลี่ยน บันทึกว่าเป็นที่ยอมรับของ POC |
| F044-T6 | วัดเพดานจริง: วัดขนาด request/state ของโต๊ะตัวอย่าง 10–18 objects และ assistant request; ตัดสินใจขยาย `MAX_REQUEST_BODY_BYTES`/`MAX_ACTIVE_STATE_BYTES`/billing เฉพาะเมื่อชน | `cloudflare/table-assistant.ts`, `cloudflare/ai.ts`, `cloudflare/billing.ts`, tests | มีตาราง bytes จริง + เหตุผล; ถ้าขยาย ต้องมี test โต๊ะใหญ่และไม่ทำให้ reservation ผิด |
| F044-T7 | ปิดวงจร: sync `origin/main` → dev, อัปเดต PLAN/spec/DEPLOYMENTS, ระบุเจ้าของ release | `PLAN.md`, `spec.md`, `docs/DEPLOYMENTS.md` | ไม่มี branch/PR ค้าง; `local-validation` เขียวทั้ง dev และ release |

**ลำดับ:** T1 → T2 → T3 (ขนานกับ T4 ได้) → T5/T6 → T7 · T2 ต้องรอ T1 baseline; T3 ต้องรอ T2 เฉพาะกรณี fixture ที่มาจาก prompt

## ผลตรวจที่ต้องมีก่อนปิดงาน

- `npm test`, `npm run test:cloudflare`, `npm run typecheck`, `npm run build`, `npm run build:cloudflare`
- `npm run test:generative:browser` (check motion ใหม่) และ `npm run test:cloudflare:browser`
- live probe 2 รอบ: fresh-build และ edit (ใช้ key จาก env เท่านั้น; ห้ามเขียนลงไฟล์)
- production: `/version` ตรง tag, asset chunk มี `Pause motion`, `/healthz` `/readyz` ผ่าน
- ระบุ Node 22.23.2 ในรายงาน; lint รันใน CI (เครื่องนี้ไม่มี eslint binary)

## ความเสี่ยง / ข้อจำกัด

- **Flaky browser suite:** `test:generative:browser` และ `test:cloudflare:browser` ล้มด้วย `toBeInViewport`/topbar intercept ได้จากการรันซ้อน/จังหวะเลื่อน; ต้องรันซ้ำและบันทึกว่าเป็น flake ไม่ใช่ปล่อยผ่าน
- **Cloudflare Free plan:** งาน 180s ต่อ request ต้องอยู่ใน wall-clock ที่ plan รองรับ
- **Strict schema:** การเพิ่ม field ใน canvas ทำให้รุ่นเก่าอ่านไม่ได้ → ต้องประเมิน MAJOR ทุกครั้ง
- **ต้นทุน:** live corpus 10 เคส × 3 trials ≈ $0.3–0.6; ต้องมีเพดานคำขอ
- **หลาย session แก้ repo เดียวกัน:** ก่อนแตก branch ต้อง `git fetch` และเช็ค PR/`PLAN.md`; release ต้องมีเจ้าของเดียว

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | ใช้ `requestAnimationFrame` ของเบราว์เซอร์ ไม่เพิ่ม motion library | ลด dependency/bundle, คุม pause/reduced motion ได้เอง, ภาพเป็น SVG geometry ไม่ต้องใช้ physics engine |
| 2026-10-22 | เก็บ motion เป็นข้อมูลใน program (strict schema) | ทุกคนเห็นภาพเดียวกันจาก state เดียว; ยอมรับว่ารุ่นเก่าอ่านไม่ได้ (MAJOR) |
| 2026-10-22 | เริ่ม clock ตอน mount (ยังไม่ shared phase) | ง่ายและไม่เขียน state; ยอมรับว่าแต่ละ client เฟสต่างกันชั่วคราว |
| 2026-10-22 | ไม่ขยายเพดาน token ของเส้นทางร่างกฎในรอบ 5.0.0 | หลักฐานชี้ว่าไม่ได้ชนเพดานนั้น; ขยายโดยไม่มีตัวเลขทำให้ช้าลง |
