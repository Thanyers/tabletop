# Deployment ปัจจุบัน

ตรวจ `/version` ออนไลน์ล่าสุด **27 ตุลาคม 2569 เวลา 15:59 น. (Asia/Bangkok)**: production รายงาน **9.2.0 / 467cb37**; [Release deploy](https://github.com/Thanyers/tabletop/actions/runs/40476842884) ผ่านครบ รวม sandbox Worker, smoke และ GitHub Release publication. Health/readiness 200; `/api/capabilities` ประกาศ `toolSandboxOrigin` และ sandbox `runtime.js` ตอบ 200. Staging snapshot **0.0.0-dev / b17ce90** เป็นการอ่าน ณ เวลานั้น.

| รายการ | Production | Staging |
| --- | --- | --- |
| URL | [tabletop.ptchrr.workers.dev](https://tabletop.ptchrr.workers.dev/) | [tabletop-staging.ptchrr.workers.dev](https://tabletop-staging.ptchrr.workers.dev/) |
| Worker / D1 | tabletop / tabletop-production | tabletop-staging / tabletop-staging |
| Durable Objects | Room และ Billing ของ production | Room และ Billing แยก namespace |
| Source | [467cb37](https://github.com/Thanyers/tabletop/commit/467cb378a1e57d7c7e67b5ed41d0ea8d0b3ff3af) — PR #399 | `b17ce90` — observed snapshot |
| Release | v9.2.0 / 9.2.0 — deploy/smoke passed | dev / 0.0.0-dev |
| แผน | Workers Paid ตามการอนุญาต F066-T8 | บัญชี Paid เดียวกัน |
| เพดาน AI | คง private config เดิม; รอบนี้ไม่ได้อ่านวงเงินบัญชี | คง private config เดิม; รอบนี้ไม่ได้อ่านวงเงินบัญชี |

/demo และ /demo/replay อยู่ใน Worker เดียวกัน merge เข้า `dev` รวมงานเอกสาร รันชุดเต็มและ deploy **staging** อัตโนมัติ (CD002, `/version` = `0.0.0-dev`) · merge `release/*` / `hotfix/*` เข้า `main` deploy **production** ([CD001](TEAM_HANDOFF_TH.md#deploy-อัตโนมัติ-cd001)) ([ขั้น deploy](AGENT_OPERATIONS.md#6-deploy-อัตโนมัติหลัง-merge-release)); branch งานอื่นไม่ deploy

## Release 9.2.0 — custom tools sandbox origin and canvas fixes (27 October 2026)

- [Release PR #399](https://github.com/Thanyers/tabletop/pull/399), main `467cb37`; [exact-head full CI](https://github.com/Thanyers/tabletop/actions/runs/40475961603) passed all three browser suites (Workers split 1/2 + 2/2) and fast checks. [Deploy](https://github.com/Thanyers/tabletop/actions/runs/40476842884) succeeded: sandbox assets Worker, app with `TOOL_SANDBOX_ORIGIN`, smoke and GitHub Release publication. Readback 9.2.0 / 467cb37, built_at 2026-10-27T08:55:37Z; health/readiness 200.
- MINOR from dev `b17ce90`: F080 custom tools on their own sandbox origin with joined-table sources, F081 checkbox toggles, F082–F087 canvas/card fixes, /tables filter controls, F078 internal refactors, F079 Procedural surface frozen to `legacy/`, CI/CD changes (CD004/CD005, CI009/CI010). No D1 migration; no config needed before deploy (sandbox Worker uses default names). Rollback target 9.1.6.
- The first full CI on the release head failed on the hero clock check (Workers 1/2, both attempts; the same race had failed two dev runs that day). Fixed on the release branch with a test-only wait for `data-hero-loaded` (`b8b0352`); part 1 then passed 3/3 locally (23 PASS each) and in CI. The changelog line for that fix sits in `changelog.d/` for the next release because the 9.2.0 section was already cut.

## Release 9.1.6 — bilingual README and consistent icon (26 October 2026)

- [Release PR #366](https://github.com/Thanyers/tabletop/pull/366), main `b809d9b`; [exact-head full CI](https://github.com/Thanyers/tabletop/actions/runs/40305987823) passed all three browser suites and fast checks. [Deploy](https://github.com/Thanyers/tabletop/actions/runs/40307321305) succeeded including Container settings, smoke and GitHub Release publication.
- README removes production-process commentary and adds reciprocal English/ไทย links with existing localized GIFs. Browser and README favicon match the homepage mark. Both main README pages and served favicon verified. Production version 9.1.6 / b809d9b; health/readiness 200.
- Scope-only publication from production 9.1.5 excludes unrelated dev work. Homepage copy/layout, animations, film, runtime, schema, dependencies and configuration unchanged. Rollback reference 9.1.5. No AI calls or production data writes used for validation.
- Release Notes generated from the main-equivalent release tree: 34 releases, latest 9.1.6, 0 fragments. Existing private artifact cannot be updated by available tools; generated HTML is the handoff.

## Release 9.1.5 — README parity with published hero cases (26 October 2026)

- [Release PR #351](https://github.com/Thanyers/tabletop/pull/351), main `0ce11c8`; [exact-head full CI](https://github.com/Thanyers/tabletop/actions/runs/40294440122) passed all three browser suites and fast checks. [Deploy](https://github.com/Thanyers/tabletop/actions/runs/40295626873) passed Container settings, smoke and GitHub Release publication. Production readback: 9.1.5 / 0ce11c8, built_at 2026-10-26T08:56:08Z; health/readiness 200.
- Default-branch README now presents café sales → physics learning → adventure play using the same EN hero GIFs/posters. Origin, capability/beta/start guidance and AGPL text preserved; all 13 local references resolve. Actual GitHub rendering and README blob checked against the approved source. [F077 evidence](narrative/F077/verification.md).
- This scope-only documentation release starts from verified production 9.1.4 and excludes unrelated dev runtime work. App, homepage, film, media, backend, dependencies and deployment configuration have no diff from that baseline. Rollback reference 9.1.4; no live AI or production data mutation used for validation.
- Release Notes HTML generated from the main-equivalent changelog (33 releases, latest 9.1.5). The existing private Claude artifact cannot be published with this agent's tools; the ignored file is the handoff without a replacement public URL.

## Release 9.1.4 — scope-only three-case hero (26 October 2026)

- [Release PR #309](https://github.com/Thanyers/tabletop/pull/309), main `d09d2f2`; [exact-head full release CI](https://github.com/Thanyers/tabletop/actions/runs/40255695998) passed all three browser suites and fast checks. [Deploy](https://github.com/Thanyers/tabletop/actions/runs/40256468104) passed Worker/Container settings, migrations, smoke and GitHub Release publication. Readback: `9.1.4 / d09d2f2`, built_at `2026-10-26T01:55:13Z`; health/readiness/capabilities 200.
- The user's explicit no-other-changes instruction required a bounded production-baseline release instead of bundling unrelated dev architecture work. Only the hero rotates café sales → accepted physics → adventure play, with EN/TH selection, pause and reduced-motion posters. README, film, non-hero homepage copy/sections, existing learning media, backend, lockfile, schema and deploy configuration match production 9.1.3. Rollback target 9.1.3.
- Production case order/source selection verified; all three served EN GIF hashes equal source. [F077 evidence](narrative/F077/verification.md) retains the first clock-test race, its fix, 35 local browser groups, final-source CI and 13 PASS / 3 FAIL / 4 SKIP raw UI gate. No live AI or production account/data writes used for validation.
- Replacement deployment completed the settings stage that failed for 9.1.3; incident #291 closed on 26 October. The earlier attempts remain failed/partial; their underlying cause was not established. This does not add actual compute execution acceptance beyond the pipeline smoke scope.
- Release Notes HTML generated from the main-equivalent released changelog (32 releases, latest 9.1.4). This agent cannot publish to the existing private Claude artifact; the ignored HTML remains the handoff without a replacement public URL.

## Release 9.1.3 — public content live; Container settings incomplete (25 October 2026)

- [Release PR #289](https://github.com/Thanyers/tabletop/pull/289), main `4748689`; [full release CI](https://github.com/Thanyers/tabletop/actions/runs/40131202479) passed all three browser suites and fast checks. Public homepage and GitHub README contain the final narrative order/copy; accepted media and backend/configuration source are unchanged. Rollback reference: 9.1.2 (no rollback performed).
- Both [initial deploy](https://github.com/Thanyers/tabletop/actions/runs/40132004027) and [same-SHA retry](https://github.com/Thanyers/tabletop/actions/runs/40132413721) failed at Production — deploy after Worker publication, while applying Durable Object-managed Container settings. D1 migration steps succeeded. Workflow smoke and GitHub Release publication were SKIPPED. `/version` and health/readiness readback do not establish compute readiness or full pipeline completion. [Incident #291](https://github.com/Thanyers/tabletop/issues/291) was open at that snapshot; replacement 9.1.4 later completed deployment and closed it. The underlying cause of these earlier attempts is unknown.
- No third blind retry, local deployment, backend/configuration/credential change or production account/data mutation was made for this homepage/README request. [F077 evidence](narrative/F077/verification.md) records final-source validation and retained UI-gate limits.
- Release Notes HTML was generated from the released changelog. This agent cannot publish to the existing private Claude artifact; the ignored HTML is the handoff without a replacement public URL.

## Release 9.1.2 — scoped hero and realistic tool imagery (24 October 2026)

- [Release PR #286](https://github.com/Thanyers/tabletop/pull/286), main `abe4aaf`; [full release CI](https://github.com/Thanyers/tabletop/actions/runs/40092252022) passed all three browser suites and fast checks. [Production deploy](https://github.com/Thanyers/tabletop/actions/runs/40092917650) succeeded; version `9.1.2 / abe4aaf`, health/readiness 200.
- Only the requested homepage hero and physical images changed visibly: typed requests create/add cards on a flat infinitely looping canvas; the old note and initial Play requirement are removed; realistic before/after images show personalized fit. README, accepted R6 film, sales walkthrough and other page copy remain unchanged. Rollback target 9.1.1; no schema/binding/secret/backend/data-policy change.
- Local Workers browser suite 35 PASS groups, no browser errors, plus scoped production visual readback. [Full evidence and limits](narrative/F077/verification.md).
- Release Notes HTML generated from the released changelog. The existing private Claude artifact cannot be updated through this agent's tools; the ignored HTML is the handoff, without creating a replacement public URL.

## Release 9.1.1 — English README and visual homepage correction (24 October 2026)

- [Release PR #282](https://github.com/Thanyers/tabletop/pull/282), main `3f8a06e`, [full release CI](https://github.com/Thanyers/tabletop/actions/runs/40089761432) passed all three browser suites and fast checks. [Main validation](https://github.com/Thanyers/tabletop/actions/runs/40090333516) reused the identical validated release tree.
- [Production deploy](https://github.com/Thanyers/tabletop/actions/runs/40090356750) succeeded. `/version`: `9.1.1 / 3f8a06e`, `built_at=2026-10-24T11:33:54Z`; `/healthz` and `/readyz` returned 200. No new schema, binding, secret or data-policy change; rollback target 9.1.0.
- Public browser readback: original animation hero now has an English rendition, the sales illustration starts at 225, the same hammer/chair show useful additions, and README links are absent. Hero and lazy-loaded demo images loaded; no horizontal overflow at 1280/375px. The accepted R6 film is unchanged.
- Local Workers browser acceptance: 35 PASS groups, exit 0, no browser errors (37 mocked provider requests). Local offline UI gate retains two documented findings and four skipped checks; see [F077 verification](narrative/F077/verification.md). No production account/data mutation or live AI invocation was used for this readback.
- Release Notes HTML generated from the released changelog. Updating the existing private Claude artifact is unavailable to this agent; the ignored local HTML is the handoff, with no replacement public link created.

## Release 9.1.0 — F077 homepage and paced film (24 October 2026)

- [Release PR #274](https://github.com/Thanyers/tabletop/pull/274), main `48d9b98`, [full release CI](https://github.com/Thanyers/tabletop/actions/runs/40085660035) passed all three browser suites plus fast checks. [Main validation](https://github.com/Thanyers/tabletop/actions/runs/40086273497) reused the identical validated release tree.
- [Production deploy](https://github.com/Thanyers/tabletop/actions/runs/40086302663) succeeded. Readback: `9.1.0 / 48d9b98`, `built_at=2026-10-24T10:33:10Z`; `/healthz` and `/readyz` returned 200. No new schema, binding or credential; rollback target 9.0.2.
- Public homepage shows the accepted EN/TH story. The served MP4 matches R6 SHA-256 `5B1A53F7D79A4115A21AB3B335C794C8FFFDC9688870E68D0090239CDC6BF5A0`; served English captions match the checked-in file. Media is 93.233333 seconds; it remains a concept illustration, not live-AI proof.
- Initial full validation caught stale homepage text assertions. [PR #275](https://github.com/Thanyers/tabletop/pull/275) repaired the browser contract without weakening auth/language/mobile/navigation gates; the local harness passed 34 checks. [PR #277](https://github.com/Thanyers/tabletop/pull/277) merged main back to dev at `5f40b33`.
- The earlier dev `5281c4f` [staging run](https://github.com/Thanyers/tabletop/actions/runs/40083418488) timed out while Cloudflare prepared the container image. This is distinct from the successful production release above; no manual deploy or rollback was used.
- Release Notes HTML was generated from the released changelog. This environment has no Claude Artifact publishing tool, so the existing private hosted notes page was not overwritten; the generated file is supplied for that separate publishing step.

## F078 development validation snapshot (24 ตุลาคม 2569)

- T0/#264 และ T1/#260 ผ่าน required PR validation; merge dev ที่ `1ec4e61` และ `4e9e197` ผ่าน full browser suites ทั้งสาม, compute checks และ staging deploy/smoke ([T0 run](https://github.com/Thanyers/tabletop/actions/runs/40072711919), [T1 run](https://github.com/Thanyers/tabletop/actions/runs/40073104615)).
- Readback at `2026-10-24T07:46:48Z`: staging `0.0.0-dev / 78c6002`, built_at `2026-10-24T07:33:19Z`; production `9.0.2 / 8e2c7e1`, built_at `2026-10-23T15:58:39Z`. No release branch, tag or production deploy was created for F078.
- T4/#263 และ T2/#261 ผ่าน full validation/deploy แล้ว ([T4 run](https://github.com/Thanyers/tabletop/actions/runs/40073659100), [T2 run](https://github.com/Thanyers/tabletop/actions/runs/40074184030)).
- T3/#262 dev `694d556` ผ่าน full validation รวม browser3 ([run40074892319](https://github.com/Thanyers/tabletop/actions/runs/40074892319)) แต่ staging เป็น **SKIPPED** จาก transitive optional-job skips; ไม่ใช่ deploy PASS. [T3a/#265](https://github.com/Thanyers/tabletop/pull/265) แก้เฉพาะ status condition โดยคง successful-validation/push/dev guards แล้ว **ปิดจริง**: merge `d374e70`, [run40075882571](https://github.com/Thanyers/tabletop/actions/runs/40075882571) success และ `Deploy tabletop-staging` เป็น **success** (ไม่ใช่ skipped) พร้อม `/version` ของ staging อ่านกลับเป็น `0.0.0-dev / d374e70`, `built_at` `2026-10-24T07:59:41Z`; focused PR-only jobs ยังเป็น SKIPPED ตามแบบและไม่นับเป็น PASS.
- Readback at `2026-10-24T08:27Z` (15:27 น.): staging `0.0.0-dev / d374e70`; production `9.0.2 / 8e2c7e1`, `built_at` `2026-10-23T15:58:39Z`. Work ต่อจาก T3a (`F078-T5a…T9`) merge เข้า `dev` แล้ว deploy staging ต่อตาม pipeline; ยังไม่มี release branch, tag หรือ production deploy ของ F078.

## ผลตรวจ deploy 9.0.0 / 9.0.1 / 9.0.2 และ hosted compute (23 ตุลาคม 2569)

- **9.0.2 PATCH:** [PR #257](https://github.com/Thanyers/tabletop/pull/257), main8e2c7e1, [deploy39982761764](https://github.com/Thanyers/tabletop/actions/runs/39982761764) ผ่าน; built_at2026-10-23T15:58:39Z [fullreleaseCI39980581719](https://github.com/Thanyers/tabletop/actions/runs/39980581719) ผ่าน Node22.23.2 unit901/5skipped Workers197 browser3suites แก้Ask/Changeที่ถูกcanvasnavigationรับก่อนส่ง; actualAskอ้างกฎส่วนลดถูกตัวและไม่แก้program/raw/revisions FreshJSRunได้405และfreshPythonRunได้8วันด้วยsource/versionเดิม/rawเดิม ไม่มีmigration/config/credentialchange; rollbacktarget9.0.1
- **Staging9e7a66b:** [run39979203280](https://github.com/Thanyers/tabletop/actions/runs/39979203280) fullvalidation/deploy/smokeผ่าน built_at2026-10-23T15:50:14Z และactualAskอ้างกฎส่วนลดได้ก่อนขึ้นproduction
- **9.0.0:** [PR #249](https://github.com/Thanyers/tabletop/pull/249), main49f2dd7, [deploy39962089610](https://github.com/Thanyers/tabletop/actions/runs/39962089610) ผ่าน; built_at2026-10-23T13:33:24Z เปิด JavaScript/Python พร้อม profile `tabletop-compute-1` และ libraries ที่ pin ไว้ มี typed executions จริงจาก hosted QA ไม่ยืนยันจาก flag อย่างเดียว
- **9.0.1 PATCH:** [PR #256](https://github.com/Thanyers/tabletop/pull/256), mainf2f1629, [deploy39973772263](https://github.com/Thanyers/tabletop/actions/runs/39973772263) ผ่าน; built_at2026-10-23T14:56:01Z [release CI39971674579](https://github.com/Thanyers/tabletop/actions/runs/39971674579) ผ่านครบ Node22.23.2: unit901passed/5skipped, Workers197passed, browser3suites และ real local Worker Loader/Container2checks ผ่าน ไม่มี schema migration หรือ binding/credential ใหม่จาก9.0.0; rollback target9.0.0
- **Stagingก่อนหน้า16de683:** [run39970589793](https://github.com/Thanyers/tabletop/actions/runs/39970589793) fullvalidationผ่าน; attempt1 deployล้มหลังimageuploadด้วยCloudflare internal error, attempt2 retry failedjobด้วย16de683เดิมผ่านและ smokeผ่าน `/version`built_at2026-10-23T14:42:14Z ปิด auto failure [issue255](https://github.com/Thanyers/tabletop/issues/255) หลังตรวจการกู้คืน ไม่เรียกattempt1ว่าPASS
- รายละเอียดรายเคสและขอบเขตผลตรวจอยู่ใน [รายงาน48เคส](testing/f066-post-deploy/RELEASE9_RESULTS_TH.md) และ [F066](features/F066-reusable-compute-rules.md); acceptanceของรุ่น9เริ่มจาก9.0.0และแก้/ตรวจซ้ำถึง9.0.2 หลายบัญชี8เคสคงBLOCKEDตามผู้ใช้ ผลschema-valid/build/smokeไม่ใช่หลักฐานว่าแต่ละโจทย์AIถูกทุกครั้ง
- Snapshotนี้ยืนยันรุ่นตามเวลาตรวจข้างต้น; mergeเอกสารกลับdevอาจทำให้ staging deploy commitใหม่โดยอัตโนมัติ ไม่เปลี่ยน production9.0.2

## ผลตรวจ staging หลัง merge license (23 ตุลาคม 2569)

- [PR #238](https://github.com/Thanyers/tabletop/pull/238) merge เข้า `dev` ที่ `7b28376` หลัง `local-validation` ของ head `3e035e6` ผ่าน และ GitHub รายงาน mergeable ไม่มี code conflict
- [Run 39933143323](https://github.com/Thanyers/tabletop/actions/runs/39933143323) ของ merge commit ผ่านทุก job ที่รัน รวม fast checks, browser suites ทั้งสาม, `local-validation`, deploy staging และ smoke check; `report-dev-failure` เป็น **SKIPPED**
- Node **22.23.2**: unit/local SQL **849 passed / 5 skipped / 0 failed**, Workers integration **177 passed / 0 failed**
- `/version` ของ staging อ่านกลับได้ `0.0.0-dev / 7b28376`, `built_at: 2026-10-23T09:52:26Z`; production อ่านกลับได้ `8.0.0 / 89a604e`, `built_at: 2026-10-23T07:42:56Z`
- อ่าน `LICENSE` กลับจาก `dev` ได้ blob `be3f7b28e564e7dd05eaf59d64adba1a4065ac0e` ตรงกับไฟล์ที่ตรวจ การ deploy นี้ไม่ใช่การตรวจ source offer จากหน้าเว็บ และไม่ได้ออก release production
- snapshot นี้ผูกกับ run/เวลาตรวจข้างต้น; merge ที่ใหม่กว่าติดตามผลจาก run ของ commit นั้น

## ผลตรวจ deploy 8.0.0 (23 ตุลาคม 2569)

Release 8.0.0 (**MAJOR**) ผ่าน pipeline CD001 ([run 39919542374](https://github.com/Thanyers/tabletop/actions/runs/39919542374)) — [PR #224](https://github.com/Thanyers/tabletop/pull/224) จาก `dev` @ `910b0a3` · ออกตามหลัง 7.0.0 ทันทีเพราะ 7.0.0 ตัดจาก `dev` @ `a731a84` (#204) จึงไม่มีงานที่ merge หลังจากนั้น (#205–#220) · เหตุผล MAJOR: F066 เพิ่ม contract `compute` ที่บันทึกใน state ของห้อง ซึ่ง build 7.0.0 อ่านไม่ได้ → **ห้าม rollback ทั้งระบบหลังมีห้องบันทึก compute** (ก่อนหน้านั้น deploy `v7.0.0` กลับได้) · ไม่มี D1 migration

- CI ของ PR #224 รอบสุดท้ายผ่านทุก job (Node 22.23.2): fast-checks 3m8s, generated 3m34s, Workers 8m24s, persona 9m49s, `local-validation` PASS · รอบแรก Workers ล้มเพราะ merge เอา fixture ของ main (#194) มาปนกับ mock ของ dev (`MODEL_PROVIDER_HTTP_ERROR`) และ generated ล้มแบบ flaky (`exerciseAction:933`) → คงชุดเทสต์ของ dev ทั้งชุด (`c932bda`) แล้วผ่าน
- Validate บน merge commit **16 วินาที** — CI006 ใช้ผลชุดเต็มของ PR ซ้ำ (tree ของ merge commit ตรงกับ head)
- Tag `v8.0.0` (annotated) → `89a604e`; build ครั้งเดียว `8.0.0 / 89a604e` (`built_at` 2026-10-23T07:42:56Z)
- D1: `no pending D1 migrations` ทั้ง staging และ production
- Staging: Worker version `97d1d29a-41f8-4fb9-b616-99d2df7c8646`, smoke PASS
- Production: Worker version `90b81e2a-d7f6-429c-96e7-a98e37396a28`, smoke PASS
- `/version` ทั้งสอง environment = `8.0.0 / 89a604e` (ตรวจซ้ำด้วยมือ 14:45 น.)
- ข้อจำกัด ณ snapshot8.0.0 (เปิด enginesแล้วใน9.0.0ตามบันทึกด้านบน): binding `worker_loaders` (`COMPUTE_LOADER`) และ `TABLE_COMPUTE_PYTHON` ยังไม่อยู่ใน `WRANGLER_CONFIG_*` — capability JavaScript/Python compute รายงานปิดจนกว่า operator จะเติม config ตาม [REUSABLE_COMPUTE](REUSABLE_COMPUTE.md) (ระบบไม่ crash เพราะ gate ด้วย capability)
- `dev` รับ release คืนผ่าน PR `chore/sync-main-8.0.0`

## ผลตรวจ deploy 7.0.0 (23 ตุลาคม 2569)

Release 7.0.0 (**MAJOR**) ผ่าน pipeline CD001 ([run 39916314413](https://github.com/Thanyers/tabletop/actions/runs/39916314413)) — [PR #206](https://github.com/Thanyers/tabletop/pull/206) จาก `dev` @ `a731a84` · ไม่รวม #180/#219 (หน้าแรกสองภาษา) · เหตุผล MAJOR: F055 เก็บสูตรคำนวณแบบใหม่ใน state รุ่น 6.0.0 อ่านแล้ว crash → **ห้าม rollback ทั้งระบบ แก้ไปข้างหน้าเป็น 7.0.x**

- CI ของ PR ล้ม 2 ชุด (Workers `requestProposal:479`, generated `exerciseAction:901`) · สาเหตุ: #194 ตั้งใจไม่ส่งเนื้อหาไฟล์ที่กฎอ้างแล้ว (`importedSources`) แต่ mock provider ในเทสต์ยังคาด `input.sources` ครบ → แก้เทสต์อย่างเดียว `18fddb2` · ตัดออกด้วย bisect: Node 26/22, #192/#193, #196–#198, #201, #203/#204 · ยืนยันด้วย full suite บน runner จริง (run 39914232300) ผ่านรอบแรก
- Validate บน merge commit **1 นาที** — CI006 ใช้ผลชุดเต็มของ PR ซ้ำได้จริงครั้งแรก (ข้ามทุก job)
- Tag `v7.0.0` (annotated) → `c250a60`; build ครั้งเดียว `7.0.0 / c250a60` (`built_at` 2026-10-23T07:13:38Z)
- D1: `no pending D1 migrations` ทั้ง staging และ production
- Staging: Worker version `8d632dcb-3d60-407d-804e-b76791fa352f`, smoke PASS
- Production: Worker version `9982c969-7ddd-483f-a62a-d6fe4961bfc3`, smoke PASS
- `/version` ทั้งสอง environment = `7.0.0 / c250a60` (ตรวจซ้ำด้วยมือ 14:21 น.)
- `dev` รับ release คืนผ่าน PR `chore/sync-main-7.0.0` · เทสต์ใน dev แก้เรื่อง #194 ไว้ละเอียดกว่าแล้ว จึงใช้ของ dev

## ผลตรวจ deploy 6.0.0 (22 ตุลาคม 2569)

Release 6.0.0 (**MAJOR**) ผ่าน pipeline CD001 ([run 39818503916](https://github.com/Thanyers/tabletop/actions/runs/39818503916)) — [PR #191](https://github.com/Thanyers/tabletop/pull/191) จาก `dev` @ `9d2ee5e` · เลขและเหตุผล MAJOR โดย Thanyers: F048/F060 (server dice / dice ผูก `roll`) และที่นั่ง `member-8..12` ทำให้ย้อนไป 5.1.0 ไม่สะอาด → **ห้าม rollback ทั้งระบบ แก้ไปข้างหน้าเป็น 6.0.x**

- แก้ใน release branch ระหว่างรอ CI: `e01ad24` (Thanyers, Workers suite ตาม auto-apply notice), `33db3f0` (Thanyers, pan gesture ไม่โดนแผง Objects), `a193b4d` (บั๊ก client: บันทึกผังร่วมครั้งแรกถูกทิ้งเมื่อการ์ดหายจาก canvas ระหว่างรอ + helper ลาก canvas ผิดทิศ) · บรรทัด CHANGELOG ของ `a193b4d` อยู่ใต้ `Unreleased` (ไม่แทรกหัวข้อที่ตัดแล้ว)
- CI ของ PR รอบสุดท้าย (`a193b4d`) ผ่านทุก job · Validate บน merge commit รันชุดเต็มขนาน (CI006) **5 นาที** — ยังไม่ได้ใช้ผล PR ซ้ำ เพราะ API `commits/{sha}/pulls` คืน body ว่างสำหรับ merge commit นี้ (fail-safe ทำงานถูก)
- Tag `v6.0.0` (annotated) → `195b84c`; build ครั้งเดียว `6.0.0 / 195b84c` (`built_at` 2026-10-22T16:58:47Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production
- Staging: Worker version `16956b15-dbc1-4002-8012-0f7d5ca2621b`, smoke PASS
- Production: Worker version `a6cc5f70-405c-4a98-a6c6-c0d53157c0eb`, smoke PASS
- `/version` ทั้งสอง environment = `6.0.0 / 195b84c` (ตรวจซ้ำด้วยมือ 23 ต.ค. 00:00 น.)
- `dev` รับ release คืนผ่าน PR `chore/sync-main-6.0.0`

## ผลตรวจ deploy 5.1.0 (22 ตุลาคม 2569)

Release 5.1.0 (MINOR) ผ่าน pipeline CD001 ([run 39782486699](https://github.com/Thanyers/tabletop/actions/runs/39782486699)) — [PR #152](https://github.com/Thanyers/tabletop/pull/152) จาก `dev` @ `8f97859` · รวม #147 (ตั้งค่าเส้นโยงของโต๊ะ), #144 (ปุ่มลูกศร), #146 (ไอคอนย่อ/ปิดการ์ด + Arrange), #148 · ไม่รวม #149 และ #133 (F039) · AI merge release เอง (กฎใหม่ #139) หลังคนเคาะเลข

- แก้ใน release branch: browser suite ยังกดป๊อปอัป Move ที่ #144 เอาออก → ใช้ปุ่มลูกศร (ยกจาก `1b3fdee`) · CI รอบแรกล้มที่ F038 → **บั๊ก server จาก F034-T3**: ร่างกฎที่เสร็จแล้วถูกเขียนทับจน prompt หาย การ์ดคำขอร่างกฎจึงหายหลัง reload → เก็บ prompt ไว้ (`742a002`)
- ก่อนเปิด PR รัน validate.yml เต็มชุดในเครื่อง (Node 26, Chrome) ผ่าน · หลังแก้ prompt รัน unit/Cloudflare + cloudflare browser แบบ CI (chromium) ผ่าน 2 รอบติด · CI ของ PR (Node 22, เต็มชุด) ผ่าน
- Validate บน merge commit `main` ผ่าน แล้ว Release deploy เริ่มเอง (12:57 UTC)
- Tag `v5.1.0` (annotated) → `8a6611e`; build ครั้งเดียว `5.1.0 / 8a6611e` (`built_at` 2026-10-22T12:57:01Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `878dc0b3-21fe-4cbe-9830-95e5e734d857`, smoke PASS
- Production: Worker version `694fc695-789a-46e8-9b86-864fb30f2472`, smoke PASS
- `/version` ทั้งสอง environment = `5.1.0 / 8a6611e` (ตรวจซ้ำด้วยมือ 19:59 น.)
- `dev` รับ release คืนผ่าน [PR #166](https://github.com/Thanyers/tabletop/pull/166)

## ผลตรวจ deploy 5.0.0 (22 ตุลาคม 2569)

AI merge release เองตามกฎใหม่ ([AGENTS.md §8](../AGENTS.md#8-ขอบเขตของ-ai))

- **5.0.0 (MAJOR: F040 `motion`, F041, F042, #136)** — [PR #141](https://github.com/Thanyers/tabletop/pull/141) → `e8c2d73`, [run 39762394546](https://github.com/Thanyers/tabletop/actions/runs/39762394546) success · build เดียว `built_at` 2026-10-22T10:21:33Z
  - D1: `no pending D1 migrations` ทั้งสองที่
  - Staging Worker version `77a1c73d-ab15-4b20-9986-9f8362345442` · Production `104713e6-aeb0-4965-8d00-6f907f843e1a` · smoke 6/6 PASS ทั้งสองที่
  - `/version` ตรวจซ้ำด้วยมือหลัง run จบ = `5.0.0 / e8c2d73` ทั้งสองที่
  - MAJOR เพราะ rollback กลับ 4.4.0 ทำให้โต๊ะที่ใช้ `motion` ไม่แสดง canvas และ AI ล้ม (ดู CHANGELOG) · ถ้ามีปัญหาให้แก้ไปข้างหน้าเป็น 5.0.x
- ยังไม่ได้ตรวจด้วยมือแบบล็อกอิน/ใช้ AI — smoke ไม่ครอบ
- `dev` รับ release คืนผ่าน PR `chore/sync-main-5.0.0`

## ผลตรวจ deploy 4.4.0 (22 ตุลาคม 2569)

Release 4.4.0 (MINOR) ผ่าน pipeline CD001 ([run 39761035504](https://github.com/Thanyers/tabletop/actions/runs/39761035504)) — [PR #138](https://github.com/Thanyers/tabletop/pull/138) จาก `dev` @ `1063062` + `main` (4.3.1) · รวม F038 (#131, #135) และ #128 · ไม่รวม #134/#136/#137 ที่ merge เข้า dev หลังตัด branch

- ก่อนเปิด PR รัน validate.yml เต็มชุดในเครื่อง (Node 26, Chrome) ผ่านทุกขั้น: unit 512, Cloudflare 112, demo, browser r1 7 / cloudflare 26 / generative 8
- Validate บน merge commit `main` ผ่าน แล้ว Release deploy เริ่มเอง (10:10–10:11 UTC)
- Tag `v4.4.0` (annotated) → `d04da37`; build ครั้งเดียว `4.4.0 / d04da37` (`built_at` 2026-10-22T10:10:59Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `8c69d101-d41e-478c-8a19-605ae2bbeace`, smoke PASS
- Production: Worker version `66313fbe-3507-4c6f-9753-60bb250a2ea7`, smoke PASS
- `/version` ทั้งสอง environment = `4.4.0 / d04da37` (ตรวจซ้ำด้วยมือ 17:15 น.)
- ยังไม่ได้ตรวจด้วยมือแบบล็อกอินหลายบัญชี (คิวร่างกฎ/คำถามขนาน) บน staging — browser suite ครอบคลุมด้วย synthetic AI
- `dev` รับ release คืนผ่าน PR `chore/sync-main-4.4.0` · 5.0.0 (#141) merge เข้า `main` แล้วแต่ยังไม่ได้บันทึกที่นี่

## ผลตรวจ deploy 4.3.0 (22 ตุลาคม 2569)

Release 4.3.0 (MINOR) ผ่าน pipeline CD001 ([run 39748581327](https://github.com/Thanyers/tabletop/actions/runs/39748581327)) — [PR #125](https://github.com/Thanyers/tabletop/pull/125) จาก `dev` @ `d4b5b47` + `main` (#121, #124) · รวม F035 (สิทธิ์ตาม role), F034-T3 (#120, #122), #121, #124

- Tag `v4.3.0` (annotated, github-actions) → `12c40a4`; build ครั้งเดียว `4.3.0 / 12c40a4` (`built_at` 2026-10-22T08:33:52Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `bffc4ad5-efde-4919-9d2e-b6d6f9414f2c`, smoke PASS
- Production: Worker version `68d96b6d-b139-46f1-a247-56471739e5d2`, smoke PASS
- `/version` หลัง deploy ทั้งสอง environment = `4.3.0 / 12c40a4` (ตรวจซ้ำด้วยมือหลัง run จบ)
- ยังไม่ได้ตรวจด้วยมือบน staging แบบล็อกอิน (role สองบัญชี, แชท AI) — smoke ไม่ล็อกอินและไม่เรียก AI
- `dev` รับ release คืนผ่าน PR `chore/sync-main-4.3.0`
- ไม่ได้บันทึกหัวข้อของ 4.0.0 / 4.2.0 ไว้ที่นี่ (ดู GitHub Actions ของ release นั้น)

## ผลตรวจ deploy 3.3.2 (21 ตุลาคม 2569)

Release 3.3.2 (PATCH) ผ่าน pipeline CD001 — [PR #96](https://github.com/Thanyers/tabletop/pull/96) จาก `dev` @ `0f360c9` · รวม F025 (refresh race), F026 (บังคับภาษา clarify), F027 (hint ตอน reject), F028 (fallback ตารางขั้นต่ำ), F029 (golden corpus)

- Tag `v3.3.2` (annotated) → `957074d`; build ครั้งเดียว `3.3.2 / 957074d` (`built_at` 2026-10-21T13:49:50Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `eaec9c18-56bd-4696-8463-ee71a12f2a72`, smoke PASS
- Production: Worker version `2f5f6e53-cd9c-4c94-9feb-9f6a0e575b43`, smoke PASS
- `/version` หลัง deploy ทั้งสอง environment = `3.3.2 / 957074d`
- ตรวจซ้ำบน production 5 เคส: injection เป็นอังกฤษ, join ได้ draft, dragon ไม่มี refresh error, vague/toomany clarify — ดู [report](../test-results/weird-cases-3.3.2/REPORT.md) (local, ignored)
- `dev` รับ release คืนผ่าน [PR #97](https://github.com/Thanyers/tabletop/pull/97)

## ผลตรวจ deploy 3.3.1 (21 ตุลาคม 2569)

Release 3.3.1 (PATCH) ผ่าน pipeline CD001 — [PR #89](https://github.com/Thanyers/tabletop/pull/89) จาก `dev` @ `942e2c6` · รวม F024 (repair escalation)

- Tag `v3.3.1` (annotated) → `6c6bfcc`; build ครั้งเดียว `3.3.1 / 6c6bfcc` (`built_at` 2026-10-21T12:00:01Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `e2558859-a6e3-41b5-ac39-35262e61dce6`, smoke PASS
- Production: Worker version `8a6a4c97-914b-4c77-a899-52eb11c118b1`, smoke PASS
- `/version` หลัง deploy ทั้งสอง environment = `3.3.1 / 6c6bfcc`
- `dev` รับ release คืนผ่าน [PR #90](https://github.com/Thanyers/tabletop/pull/90)

## ผลตรวจ deploy 3.3.0 (21 ตุลาคม 2569)

Release 3.3.0 (MINOR) ผ่าน pipeline CD001 — [PR #84](https://github.com/Thanyers/tabletop/pull/84) จาก `dev` @ `356e734` · รวม F023 (salvage การ์ดภาพ), F022 (ตอบหลายคำตอบ), F021 (พิมพ์ระหว่างรอ), F020 (ข้อความ field), F003-T1 (เตะสมาชิก), F003-T3 (invite link ใช้ซ้ำ)

- Tag `v3.3.0` (annotated) → `457373a`; build ครั้งเดียว `3.3.0 / 457373a` (`built_at` 2026-10-21T11:09:07Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `f413119b-3100-4e5f-85b9-0ecd6f9879b7`, smoke PASS
- Production: Worker version `ffe13c48-a02f-4821-b7a3-cba1b2638943`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version`, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `3.3.0 / 457373a`
- `dev` รับ release คืนผ่าน [PR #86](https://github.com/Thanyers/tabletop/pull/86)

## ผลตรวจ deploy 3.2.0 (21 ตุลาคม 2569)

Release 3.2.0 (MINOR) ผ่าน pipeline CD001 — [PR #76](https://github.com/Thanyers/tabletop/pull/76) จาก `dev` @ `25210ad` · รวม F018 (รักษา canvas views ตอน evolve) และ F019 (capability registry + panel)

- Tag `v3.2.0` (annotated) → `430b0c9`; build ครั้งเดียว `3.2.0 / 430b0c9` (`built_at` 2026-10-21T08:33:38Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `3b280d8d-d27c-4db7-b034-b2dd872c3b38`, smoke PASS
- Production: Worker version `d4e71a3c-7503-4da5-9d99-c5a2480271a5`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version`, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `3.2.0 / 430b0c9`
- รอบนี้ตรวจเฉพาะ build/version/smoke ตาม pipeline; ยังไม่ได้เล่นสองบัญชีหรือทดสอบฟีเจอร์ใหม่บน hosted

## ผลตรวจ deploy 3.1.0 (21 ตุลาคม 2569)

Release 3.1.0 (MINOR) ผ่าน pipeline CD001 — [PR #68](https://github.com/Thanyers/tabletop/pull/68) จาก `dev` @ `dc38dcc` · รวม F015 (import rows), F016 (validation reasons) และ F017 (computed columns)

- Tag `v3.1.0` (annotated) → `f8a6b43`; build ครั้งเดียว `3.1.0 / f8a6b43` (`built_at` 2026-10-21T07:10:14Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `d20c9263-c367-4008-b9a3-f90d95ce9ac0`, smoke PASS
- Production: Worker version `444f9abf-1d03-482e-a864-f35b52a2f402`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version`, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `3.1.0 / f8a6b43`
- รอบนี้ตรวจเฉพาะ build/version/smoke ตาม pipeline; ยังไม่ได้เล่นสองบัญชีหรือทดสอบฟีเจอร์ใหม่บน hosted

## ผลตรวจ deploy 3.0.0 (21 ตุลาคม 2569)

Release 3.0.0 (MAJOR) ผ่าน pipeline CD001 ครบทุกขั้น — branch `release/3.0.0` ([PR #59](https://github.com/Thanyers/tabletop/pull/59)) จาก `dev` @ `a22122d` + merge `main` (v2.2.0) · เป็น MAJOR เพราะ F010 บันทึก contract ใหม่ของกฎ/Canvas ที่ writer รุ่นก่อนอ่านไม่ได้หลังเขียน

- Tag `v3.0.0` (annotated) → `df1e5f5`; build ครั้งเดียว `3.0.0 / df1e5f5` (`built_at` 2026-10-21T04:30:03Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `c33846ea-b41a-4338-bdf8-40a8c474abe9`, smoke PASS
- Production: Worker version `d22ff83e-b67d-47bd-9883-bcdc217aaf42`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version`, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `3.0.0 / df1e5f5`
- รุ่นนี้รวม F010/F011/F012/F014, CD002 (retry-once) และ CD003 (draft-refresh failure) จาก 2.2.0
- รอบนี้ตรวจเฉพาะ build/version/smoke ตาม pipeline; ยังไม่ได้เล่นสองบัญชีหรือทดสอบ F010/F012 บน hosted ใหม่

## ผลตรวจ deploy 2.2.0 (21 ตุลาคม 2569)

Release deploy รอบแรกของ CD001 ล้มที่ staging เพราะ config secret ยังมี `limits.cpu_ms` ซึ่ง Workers Free ไม่รับ (Cloudflare error 100328, [issue #49](https://github.com/Thanyers/tabletop/issues/49)) หลังแก้ config แล้วรันซ้ำด้วย SHA เดิม `f29e799` ([run 39527338589](https://github.com/Thanyers/tabletop/actions/runs/39527338589)) สำเร็จใน 81 วินาที

- Tag `v2.2.0` (annotated) → `f29e799`; build ครั้งเดียว `2.2.0 / f29e799` (`built_at` 2026-10-21T01:27:27Z) ใช้ร่วม staging และ production
- D1: `no pending D1 migrations` ทั้ง staging และ production — ไม่มี schema change
- Staging: Worker version `1f739525-09bf-4df0-8c22-8fbbcca0c717`, smoke PASS
- Production: Worker version `95d45422-f2f8-460c-9696-7a01744f93d1`, smoke PASS (`/healthz`, `/readyz`, `/api/capabilities`, `/version` ตรงกับ tag, `/`, `/new`)
- `/version` หลัง deploy ทั้งสอง environment = `2.2.0 / f29e799`
- **deploy ซ้ำโดยไม่จำเป็น 09:24–09:25 (Asia/Bangkok):** [run 39532864723](https://github.com/Thanyers/tabletop/actions/runs/39532864723) ถูกสั่งรันด้วย SHA เดิมหลังจากรอบ 01:27Z สำเร็จไปแล้ว (ผู้สั่งไม่เห็นรอบก่อนหน้า) และสั่งยกเลิกไม่ทันก่อนจบ ผลคือ code เดิม `2.2.0 / f29e799` ที่ build ใหม่ (`built_at` 2026-10-21T02:25:24Z) · D1 ไม่มี migration ค้าง · smoke ผ่านทุกจุดทั้งสอง environment · Worker version ปัจจุบัน: staging `d38a193d-9bcb-4962-9758-f0a1bc2dfee9`, production `b55d3f12-5d89-4718-9f75-04df5ead15a1` · ก่อนสั่ง Release deploy ด้วยมือ ให้ดู Actions ว่ามีรอบของ SHA นั้นสำเร็จแล้วหรือยัง
- รุ่นนี้รวมงาน 2.1.0 (F008/F009/F001) และ 2.2.0 (F013 consent ครั้งเดียว + CD001) — ยังไม่อัปเกรดแผน ยังใช้ Workers Free
- รอบนี้ตรวจเฉพาะ build/version/smoke ตาม pipeline; ไม่ได้เล่นสองบัญชีหรือทดสอบ F013 บน hosted ใหม่ (หลักฐานสองบัญชีล่าสุดยังเป็นรุ่น 2.0.0)

## ผลตรวจ release ล่าสุด

รุ่น2.0 รวม Generative Canvas, แชทด้านล่างของโต๊ะทั่วไป, ตั้งชื่อโต๊ะ และตำแหน่งการ์ดร่วม พร้อมแก้บั๊ก turn-form preview ที่พบจากการเล่นจริง ผ่าน staging สองบัญชีก่อน merge [PR #33](https://github.com/Thanyers/tabletop/pull/33) → [main CI 39439056507](https://github.com/Thanyers/tabletop/actions/runs/39439056507) → annotated tag → clean tagged build → staging → production โดยใช้ build ชุดเดียวกัน ไม่มี SQL migration หรือการเปลี่ยน secrets/bindings/งบ

- Node22.23.2; unit376, Cloudflare71, browser Node7/Worker25/generated4เรื่อง8checks ผ่าน
- Served assets135/135 ต่อ environment ตรง sealed manifest และ Worker content2modules ตรงระหว่าง staging/prod; /version เป็น2.0.0/d93620d
- สอง Google accounts เล่นคาเฟ่/เกมแบ่งน้ำจริงบน staging พร้อม AI, private trial, activation, turn/actions, shared drag, private chat, close/reopen และ read-only rejection/restore
- Final tagged staging เปิดทั้งสองห้องด้วยสองบัญชีเดิม ผลคาเฟ่8/0; น้ำ65/20/15รวม100 ยังครบ ไม่สร้างห้องหรือเรียก AI เพิ่มระหว่าง final promotion
- Production readback ไม่สร้างห้อง ไม่ส่งคำสั่งเล่น และไม่เรียก AI; ไม่ใช่การเล่นเต็มซ้ำบน production

ดู provenance ของแต่ละ candidate, bugfix, ข้อจำกัด และหลักฐานทดสอบใน [Release2.0 acceptance](RELEASE_2_0_ACCEPTANCE.md) เก็บ receipts ที่มีข้อมูลเฉพาะบัญชีไว้ใน ignored local เท่านั้น

**Recovery:** หลังเขียน expression/Canvas JSON ใหม่ ห้าม rollback ไป writer1.1หรือต่ำกว่า ใช้ compatible build, TABLE_READ_ONLY และ forward fix การซ้อมครั้งนี้พิสูจน์การปฏิเสธ writes/AI และเปิดคืน ไม่ใช่ full backup/restore

## สิ่งที่ใช้และค่าใช้จ่าย

ใช้ Workers Static Assets/API + D1 + SQLite Durable Objects + Google OAuth + DeepSeek ฝั่งเซิร์ฟเวอร์ ยังไม่ได้เปิด R2, Render, Supabase หรือ custom domain และไม่ได้เปิด Workers Paid

ค่าฐานของแผนที่เลือกเป็น Free; ค่า AI คิดตามใช้จริงและมี ledger จำกัดเฉพาะคำขอจาก Tabletop เพดานข้างต้นไม่ครอบคลุมการใช้ provider key ที่แอปอื่น และไม่ใช่การรับประกัน capacity หรือ hard cap ค่าโครงสร้างพื้นฐาน ข้อมูลราคาและสมมติฐานเดิมอยู่ใน [production setup](PRODUCTION_SETUP.md#ค่าใช้จ่ายรายเดือน) พร้อมวันที่ตรวจ ต้องทวนราคาก่อนเปลี่ยนแผน

## Secret อยู่ที่ไหน

- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `TABLETOP_ADMIN_EMAIL`, `DEEPSEEK_KEY` อยู่ใน Worker Secrets ของแต่ละ environment
- `CLOUDFLARE_API_TOKEN` และ `GITHUB_TOKEN` ใช้บนเครื่องผู้ดูแลสำหรับส่งโค้ด/ตั้งระบบ ไม่เป็นส่วนหนึ่งของ browser bundle
- Git เก็บ source และชื่อ config เท่านั้น `wrangler.jsonc` ใช้ D1 ID placeholder และงบ AI เป็นศูนย์ ไม่ใช่ config production ที่พร้อมสั่ง deploy ทันที
- คนพัฒนา local ใช้ fixture ได้โดยไม่ต้องขอ production keys ถ้ารับหน้าที่ operator ให้รับสิทธิ์ผ่านช่องทางของเจ้าของบริการ ไม่ส่งค่า secret ใน issue, PR หรือแชททีม

## ประวัติ release ที่เกี่ยวข้อง

| Release | v9.2.0 / 9.2.0 — deploy/smoke passed | dev / 0.0.0-dev |
| --- | --- | --- |
| 21 ต.ค. `v3.4.0` / `442e074` | F031 thinking/caps/compact guide/180s, F030 corpus rounds | [PR #102](https://github.com/Thanyers/tabletop/pull/102), [run 39629734074](https://github.com/Thanyers/tabletop/actions/runs/39629734074) |
| 21 ต.ค. `v3.3.2` / `957074d` | F025 refresh race, F026 clarify language, F027 reject hint, F028 minimal fallback, F029 corpus | [PR #96](https://github.com/Thanyers/tabletop/pull/96), [run 39611292996](https://github.com/Thanyers/tabletop/actions/runs/39611292996), [PR #97](https://github.com/Thanyers/tabletop/pull/97) |
| 21 ต.ค. `v3.3.1` / `6c6bfcc` | F024 repair escalation (issue ซ้ำ → ลดความซับซ้อน) | [PR #89](https://github.com/Thanyers/tabletop/pull/89), [run 39596026230](https://github.com/Thanyers/tabletop/actions/runs/39596026230), [PR #90](https://github.com/Thanyers/tabletop/pull/90) |
| 21 ต.ค. `v3.3.0` / `457373a` | F023 salvage, F022 multi-answer, F021 type while pending, F020 field messages, F003-T1 remove member, F003-T3 reusable invite link | [PR #84](https://github.com/Thanyers/tabletop/pull/84), [run 39589703856](https://github.com/Thanyers/tabletop/actions/runs/39589703856), [PR #86](https://github.com/Thanyers/tabletop/pull/86) |
| 21 ต.ค. `v3.2.0` / `430b0c9` | F018 preserve canvas views, F019 capability panel + `/api/capabilities.table` | [PR #76](https://github.com/Thanyers/tabletop/pull/76), [run 39570078824](https://github.com/Thanyers/tabletop/actions/runs/39570078824), [PR #78](https://github.com/Thanyers/tabletop/pull/78) |
| 21 ต.ค. `v3.1.0` / `f8a6b43` | F015 import rows, F016 validation reasons, F017 computed columns | [PR #68](https://github.com/Thanyers/tabletop/pull/68), [run 39560013409](https://github.com/Thanyers/tabletop/actions/runs/39560013409), [PR #69](https://github.com/Thanyers/tabletop/pull/69) |
| 21 ต.ค. `v3.0.0` / `df1e5f5` | F010/F011/F012/F014 + CD002/CD003 จาก 2.2.0; MAJOR เพราะ contract ใหม่ของกฎ/Canvas | [PR #59](https://github.com/Thanyers/tabletop/pull/59), [run 39544308701](https://github.com/Thanyers/tabletop/actions/runs/39544308701), [PR #61](https://github.com/Thanyers/tabletop/pull/61) |
| 21 ต.ค. `v2.2.0` / `f29e799` | Consent ส่ง AI ครั้งเดียวต่อโต๊ะ (F013) รวมงาน 2.1.0 ที่ยังไม่เคยขึ้น hosted และ pipeline CD001 ที่ใช้งานจริงบน Workers Free | [PR #48](https://github.com/Thanyers/tabletop/pull/48), [run 39527338589](https://github.com/Thanyers/tabletop/actions/runs/39527338589), [issue #49](https://github.com/Thanyers/tabletop/issues/49) |
| 20 ต.ค. `v1.0.0` / `ce2c50e` | Build จาก release tag; UI และ runtime เดิม เปลี่ยนเฉพาะข้อมูล version | [PR #15](https://github.com/Thanyers/tabletop/pull/15), [CI main](https://github.com/Thanyers/tabletop/actions/runs/39376131015) |
| 18 ต.ค. รุ่นแรก | Google, ห้องเดิมสามแบบ, ledger และ Cloudflare Free | [บันทึกรุ่นแรก](CLOUDFLARE_RELEASE.md) |
| 19 ต.ค. `ba29062` | Shared data table, ไฟล์ข้อความ, แชทส่วนตัว/confirmation และ migration 0002 | [Generic table acceptance](GENERIC_TABLE_ACCEPTANCE.md) |
| 19 ต.ค. `f1725c8` | ภาพที่เตรียมไว้ใน interactive demo | [Demo art](DEMO_ART.md), [CI ของรุ่นที่ deploy](https://github.com/Thanyers/tabletop/actions/runs/39235880486) |
| 19 ต.ค. `6216eb3` | Canvas flow, draft lifecycle, ผลตรวจบิลและการปฏิเสธ blank action text | [PR #4](https://github.com/Thanyers/tabletop/pull/4), [Helpdesk acceptance](CANVAS_HELPDESK_ACCEPTANCE.md) |
| 20 ต.ค. `c9d3bf0` | Calm Canvas, การ์ดโทนอุ่น, ช่องพิมพ์ในโต๊ะ, contextual actions และไม่มี Use/Arrange | [PR #6](https://github.com/Thanyers/tabletop/pull/6), [Calm Canvas acceptance](CALM_CANVAS_ACCEPTANCE.md) |
| 20 ต.ค. `9fbfdec` | ข้อความเริ่มงานตามแนวคิดใหม่ ฟีเจอร์หลักเดิม และ `/version` สำหรับตรวจ build | [PR #9](https://github.com/Thanyers/tabletop/pull/9), [PR #10](https://github.com/Thanyers/tabletop/pull/10), [CI ของรุ่นที่ deploy](https://github.com/Thanyers/tabletop/actions/runs/39368620190) |
| 20 ต.ค. `524d9cc` | หน้าแนวคิดก่อนล็อกอิน พร้อมภาพการงอกของเครื่องมือ; หน้าโต๊ะและฟีเจอร์หลักเดิม | [PR #13](https://github.com/Thanyers/tabletop/pull/13), [Public welcome acceptance](PUBLIC_WELCOME_ACCEPTANCE.md), [CI ของ candidate](https://github.com/Thanyers/tabletop/actions/runs/39373019632) |

Migration 0002 ทำแล้วในทั้งสอง environment ห้ามนำคำสั่ง provisioning รุ่นแรกไปรันซ้ำโดยถือว่าฐานยังว่าง การย้าย production คัดลอกข้อมูล directory 3 ห้องและสมาชิก 3 รายการครบ พร้อมสำรองเฉพาะตารางและทดสอบกู้คืน local; ยังไม่ใช่หลักฐานกู้คืน D1 + Room + Billing ทั้งระบบ ดูขั้นตอนรับงาน operator ใน [ทีมพัฒนาต่อ](TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)
