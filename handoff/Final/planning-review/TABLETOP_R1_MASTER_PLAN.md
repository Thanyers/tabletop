# tabletop. — R1 Master Plan

18 ตุลาคม 2026 · Asia/Bangkok · สถานะ: **PROPOSED — รอ Owner Approval**

> Work defines what software becomes. แผนนี้ให้คนตรวจบิล สอน และเล่นต่อได้ระหว่างเปลี่ยนเครื่องมือ โดยรักษางานและสิทธิ์ของแต่ละคนไว้

เอกสารนี้เป็นแผนสำหรับ Implementation Session ถัดไป รอบนี้อนุญาตเฉพาะ audit, เอกสาร และ GitHub review branch ไม่อนุญาต product implementation, CI changes หรือ application deployment

อ่านร่วมกับ [Critical Audit](TABLETOP_R1_CRITICAL_AUDIT.md), [Deployment Blueprint](TABLETOP_R1_DEPLOYMENT_BLUEPRINT.md), [GitHub Submission Plan](TABLETOP_R1_GITHUB_SUBMISSION_PLAN.md), [Open Decisions](TABLETOP_R1_OPEN_DECISIONS.md) แต่ละเอกสารมีหน้าที่ต่างกัน; contracts และ acceptance ด้านผลิตภัณฑ์มีแหล่งหลักที่ไฟล์นี้

## 1. คำแนะนำและเงื่อนไขการตัดสินใจ

**Proceed with reduced breadth, after approval.** ใช้ Hybrid extraction: เก็บ React Flow Canvas, renderers, deterministic calculations และ tests ที่มีอยู่ เพิ่ม shared runtime ขนาดเล็กที่อ่าน manifest จริง พร้อม server authority, durable revisions และ projection ตามสิทธิ์ แล้ว migrate ทีละ vertical slice

ไม่แนะนำ rewrite ทั้งหมด และไม่แนะนำแค่เปลี่ยนชื่อสามเดโม เพราะจะยังไม่มี shared runtime หรือ connected sessions ที่เป้าหมาย R1 ต้องพิสูจน์ Invoice เป็น hero workflow; Teaching กับ D&D เป็น functional slices ที่เชื่อมผ่าน runtime เดียวกัน

| R1 release contract | หลักฐานที่ต้องมีหลัง implementation | สถานะวันนี้ |
| --- | --- | --- |
| Three playable tables | Invoice, Teaching, D&D รับ input อิสระในขอบเขตและเกิด state transition จริง | ยังไม่มี Tabletop R1 |
| One complete Invoice workflow | Import → gap → evidence → propose → simulate → validate → approve → activate → export → resume | มี shipping calculation เดิมบางส่วน |
| One shared Living Component Runtime | โหลด 3 manifests ผ่าน compiler/registry/store ชุดเดียว; binding แต่ละ case เปลี่ยนผลจริง | ยังไม่มี |
| Verified evolution | immutable candidate + validation proof + approval + CAS activation + compatible rollback | มีตัวอย่าง local fingerprint gate |
| Non-scripted bounded evolution | live model แปลงคำขอที่ไม่เคยเห็นเป็น typed patch; independent tests; human activation | local rhythm experiment เป็นคนละ use case |
| Real collaboration | teacher+2 learners และ DM+2 players ผ่าน server; role-negative tests | เดิมเป็น local authored simulation |

คำว่า P0/P1 ใช้จัดลำดับงานเท่านั้น: non-scripted path, privacy, persistence และ connected D&D เป็น **release blockers** แม้จะถูกจัดท้าย milestone ห้ามลด acceptance โดยเงียบ ๆ

## 2. Evidence baseline และความเป็นเจ้าของข้อมูล

อ่าน latest handoff ครบ 4 ไฟล์: work prompt, HTML 20 sections, draft schema และ draft examples วันที่ 18 ตุลาคม 2026 รวมภาพ historical 4 ภาพ แยก concept/reference ออกจาก implemented state; addendum ที่เจ้าของส่งในแชต override ข้อห้าม commit/push เดิมเฉพาะเอกสาร

**Observed:** workspace `D:\Project\project-procedural` ไม่มี `.git`; จึงไม่มี current branch/dirty status/commit ที่ใช้ระบุ source หลักโดยตรง Nested `sites/living-canvas` เป็น historical Git checkout, branch `main`, clean, HEAD `df2aac2`, ไม่มี remotes และไม่มี tracked workflows อย่านำประวัตินี้ไป push โดยอนุมานว่าเป็นประวัติของ official repo

**Observed GitHub:** `Thanyers/tabletop` เป็น public, main ที่ `1de3d7adfd3955df6a8892d17f7d55f9d25e839b`, มี README เท่านั้น ณ audit; 0 workflows, 0 runs, 0 deployments, `has_pages=false`; branch API ระบุ `protected:false`, rulesets ว่าง แต่ detailed protection endpoint คืน 403 จึงไม่กล่าวว่าตรวจทุก policy แล้ว Token ยืนยันบัญชีเป้าหมาย; account push permission ไม่ใช่หลักฐานของการ push สำเร็จ

### Source evidence map

พาธและเลขบรรทัดต่อไปนี้อ้าง **local source snapshot ที่ audit** ไม่ใช่ไฟล์ที่เผยแพร่แล้วบน GitHub รอบเอกสารนี้ไม่ส่ง source code; reviewer ที่มีเพียง GitHub จะอ่านคำอธิบายและผลทดสอบได้ แต่ยังรันแอปจาก branch เอกสารไม่ได้

| ID | หลักฐาน | สิ่งที่สรุปได้ / ข้อจำกัด |
| --- | --- | --- |
| E01 | `src/App.tsx:27`, `src/trio/TrioCanvas.tsx:497` | Canvas เดียวรวม authored objects และ lab; reference edges ยังไม่ใช่ typed executable wiring |
| E02 | `src/trio/types.ts:2`, `src/trio/domain.ts:511`, `:678`, `:724` | RuleBook เป็น shipping/quest/music; fingerprint + verification + current-candidate gate นำหลักการกลับใช้ได้ |
| E03 | `src/trio/TrioExperience.tsx:214`, `:283`, `:884` | per-case browser-local saves; ยังไม่ใช่ server durability หรือ immutable revision chain |
| E04 | `src/trio/TrioExperience.tsx:792`, `src/trio/types.ts:13` | approval evidence ไม่ยืนยัน identity; ใช้เป็น financial authority ไม่ได้ |
| E05 | `src/trio/TrioManualDock.tsx:34` | bounded parser รองรับ structured edits; ไม่ใช่ arbitrary natural-language generation |
| E06 | `src/trio/creative/encounterModel.ts:14`, `:165`, `:215` | deterministic trace / simulated participant; ไม่ใช่ multiplayer |
| E07 | `scripts/component-lab/plugin.ts:337`, `:402`, `src/lab/GeneratedFrame.tsx:37`, `README.md:27` | loopback dev API และ iframe screening; ไม่ใช่ production hostile-code sandbox |
| E08 | `scripts/component-lab/types.ts:1`, `scripts/component-lab/prompt.ts:20` | generated-component contract จำกัด rhythm/tap และ 4 actions |
| E09 | `src/state/types.ts:9`, `src/domain/connections.ts:111`, `:156` | untyped config/dependency refs และ bundled ingestion patterns; ไม่มี generic schema-driven runtime |
| E10 | `package.json:6`, `vite.config.ts:1`, `tsconfig.json:1` | React/Vite/TS; unit include เฉพาะ src; lab tests แยก; ยังไม่มี lint script/server package |

### Fresh checks — executed 18 October 2026

| Check | ผลจริง | ขอบเขต |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc -b --pretty false` | PASS | src ตาม tsconfig; ไม่ครอบคลุม production server ที่ยังไม่มี |
| `node node_modules/vitest/vitest.mjs run` | PASS — 189 tests / 28 files | existing local logic; ไม่พิสูจน์ R1 sessions |
| `node --experimental-strip-types --test scripts/component-lab/component-lab.test.ts` | PASS — 7 tests | injected runner; ไม่ส่ง live model requests |
| `node node_modules/vite/bin/vite.js build` | PASS with advisory | App chunk 832.15 kB / 220.18 kB gzip; ยังไม่มี hosted measurement |
| `TRIO_URL=http://127.0.0.1:4173/ TRIO_REPORT_DIR=… node tests/trio-canvas-controls.mjs` | PASS — 9 checks, 0 console/page errors | production build local: use/arrange, save/resume, lineage, stale/failed candidate |
| First browser probe using legacy hub selector | HARNESS FAILURE | `trio-hub` ไม่ใช่ default entry แล้ว; current Canvas suite ข้างต้นผ่าน ไม่ได้แก้ product เพื่อให้ test ผ่าน |
| Draft schema/examples | JSON parsed + structural/semantic read | ยังไม่ได้รัน full JSON Schema 2020-12 validator; semantic gaps ระบุใน Audit |
| Hosted R1 E2E / live bounded AI / privacy / concurrent writes | NOT RUN / NOT IMPLEMENTED | ห้ามเปลี่ยนเป็น PASS จากผล local เดิม |

Local logs อยู่ใน `test-results/planning-review/` ซึ่งไม่อยู่ใน Git delivery; record แต่ละ check มีผลที่สรุปข้างต้น ไม่ได้ถือ historical test counts เป็นผลใหม่ Dependencies ใช้ของติดตั้งอยู่ ไม่มี fresh install หรือ dependency vulnerability audit รอบนี้

## 3. Architecture alternatives และ decision matrix

คะแนน 1–5 เป็นการประเมินจากโค้ดและภาระ migration ไม่ใช่ benchmark; weights รวม 100

| เกณฑ์ / น้ำหนัก | A: adapter บน Trio controller | B: Hybrid extraction | C: clean shared-platform rewrite |
| --- | --- | --- | --- |
| ส่ง usable slices ทัน / 25 | 5 | 4 | 1 |
| shared contract จริง / 25 | 2 | 5 | 5 |
| authority/privacy / 20 | 2 | 4 | 4 |
| migration/reuse risk / 15 | 4 | 4 | 1 |
| maintainability / 10 | 2 | 4 | 4 |
| performance control / 5 | 3 | 4 | 4 |
| weighted score / 5 | 3.10 | **4.25** | 3.05 |

A เหมาะพิสูจน์ feasibility สั้น ๆ แต่ case branches/closures/local saves จะสะสมและ ACL retrofit ยาก; B มีค่า extract และ temporary adapter แต่ทำให้ tests เรียก interface เดียวกับผู้ใช้; C สะอาดใน diagram แต่เสี่ยงใช้เวลาสร้าง platform มากกว่าส่งงานจริง การเลือก B ต้องผ่าน M1 proof slice ก่อน หากต้อง rewrite Canvas เพื่อทำให้สำเร็จให้กลับมา revise

```diagram architecture
Browser: React Flow + Table/Surface views
        ↓ typed intents / authorized projections ↑
Living Runtime: manifest compiler → capability registry → binding scheduler
        ↓ domain commands / derived outputs ↑
Node authority: identity + membership + command policy + revision CAS
        ↓ one transaction: state + revision + events + outbox
PostgreSQL ←→ projection dispatcher → WebSocket clients
        ↘ private object store: quarantined sources / immutable exports
Model job → constrained changeset → validate/simulate → human approval
```

Diagram นี้เป็น target ไม่ใช่ current deployment Public generated JavaScript execution ไม่อยู่ใน R1; local Component Lab คงเป็นแหล่งเรียนรู้แยกจาก hosted path

### Module interfaces ที่จะพัฒนา

| Module / seam | Interface และหน้าที่ | สิ่งที่ซ่อนภายใน / reuse |
| --- | --- | --- |
| ManifestCompiler | `compile(manifest, registry, policy) → ExecutablePlan \| Diagnostics` | schema validation, reference/type/permission checks, DAG ordering; ไม่มี side effects |
| LivingRuntime | `mount(plan, projection)`, `dispatch(intent)`, `suspend/resume/dispose` | bindings, render lifecycle, pending/error state; reuse Canvas adapter |
| DomainEngine | `decide(state, command, context) → Decision` | pure deterministic validation/calculation; domain adapters invoice/physics/encounter |
| CommandAuthority | `execute(authSession, command) → Ack \| Rejection` | actor derives from verified session, authz, CAS, idempotency, transaction |
| EvolutionService | `propose`, `simulate`, `validate`, `approve`, `activate` | immutable changesets and proof chain; reuse old fingerprint concept, not local approval authority |
| WorkspaceRepository | load projection, transactional mutate, append events | durable SQL, state versions, event cursor; fake/in-memory adapter for tests and SQL adapter are real variations |
| ArtifactService | initiate/finish upload, parse, read/export | quota, private access, immutable hashes, quarantine and worker lifecycle |
| ModelGateway | propose constrained patch, cancel/status | provider timeout/cost cap/structured output; no authority to activate or call arbitrary tools |

Keep one repository/build until actual deployment requires another package. Proposed placement: `src/runtime/`, `src/capabilities/{invoice,teaching,encounter}/`, `server/`, `shared/contracts/`, `tests/{contract,integration,e2e}/`; these directories are **not created in this session** Legacy components remain reachable behind explicit routes during migration

## 4. Typed manifest, bindings และ event contracts

Draft handoff schema เป็น starting vocabulary เท่านั้น ต้องแก้ artifact mismatch, role ambiguity, missing required input resolution, no event payload schema และ missing lifecycle/version constraints ก่อนใช้ หลักฐานและตัวอย่างอยู่ใน Audit §3

| Contract | Required fields / invariant |
| --- | --- |
| Workspace | opaque ID, tenant/guest scope, epoch, topology, schemaVersion, stateRevision, activeRuleRevision, participants policy |
| Surface | stable ID, owner membership, topology role, layout, projection policy; owner ไม่ได้มาจาก client self-declaration |
| Component | stable ID, surfaceId, capabilityRef+exact version, rendererRef, behaviorRef, stateSchemaRef, input/output schema refs, action refs, lifecycle version |
| Binding | source `{componentId,port}`, destination `{componentId,port}`, schema IDs, transformRef allowlist, freshness/revision policy; no dotted-string parsing ambiguity |
| EvidenceRef | immutable content hash, artifactId, page/row/range, parser version, reviewed extraction revision; no arbitrary URL/file path execution |
| Command | commandId UUID, workspaceId, epoch, expectedStateRevision, expectedRuleRevision, actionType/version, payload, correlationId; server adds actor/timestamp |
| Event | eventId, internal sequence, actor, causation commandId, correlationId, before/after revisions, typed payload, policy version, audience; client gets projection-specific cursor |
| Capability | versioned schemas, trusted reducer/renderer, allowed host actions, limits, fixtures, tests, license/provenance, maturity |

Compiler checks in order: JSON structure → IDs unique/references exist → registry version supported → every required input resolved exactly once/defaulted → output/input compatibility → acyclic compute graph → action/event payload schema → permission flow → state version/migration availability → resource budget. Reject entire candidate on failure; show object/port/error recovery, keep Active running

Computed bindings form a DAG. Event reactions are commands handled separately; no uncontrolled event→event recursion. Pin library/renderer versions; a changed semantic version requires compatibility test and explicit adapter. Data classified private may only enter same-or-narrower authorized projection; an adapter cannot widen scope. `visibility:"shared"` in client JSON never declassifies data

Example intended binding: `invoice.reconcile.exceptions@ReviewItemV1[] → invoice.review.items@ReviewItemV1[]`. Physics outputs `PhysicsModelV1` to text/scene/graph. Player input emits `SubmitActionV1` to server authority; server emits `PublicEncounterV1`, not engine internals, to player views

Lifecycle: initialize validated snapshot → mount trusted renderer → update immutable projection → suspend animation while hidden → resume from current projection → dispose listeners/workers/audio/URL handles. One failed component gets an error surface and retry/restore; error boundary never marks its downstream outputs current

## 5. Authority, persistence และ collaboration

```diagram topology
Invoice:  Owner desk ── private workspace / evidence / revisions
Teaching: Teacher board ── authorized lesson → Learner A + Learner B
          Teacher feedback ← private answers from each learner
D&D:     Player A table ↔ Session authority ↔ Player B table
                             ↕
                         DM table
          DM secrets remain in the DM projection only
```

### Identity and action policy (Tier A proposal)

เปิด URL แล้วสร้าง guest actor+workspace ผ่าน server; ใช้ opaque Secure HttpOnly SameSite cookie และ server-side session record อายุ 24 ชั่วโมง ต่ออายุได้แต่สูงสุด 7 วัน; ไม่ให้ผู้ใช้กรอก API key Teacher/DM/owner เชิญสมาชิกด้วย single-use opaque invite อายุ 10 นาที แลกเป็น session cookie ผ่าน POST แล้วลบ invite จาก address bar; เก็บ invite hash เท่านั้น ไม่ log query/token

Invite ระบุ workspace/epoch/role และ seat ฝั่ง server เสมอ ห้ามรับ actor/role จาก request body เป็น identity ไม่มี public room listing และรหัส room อย่างเดียวไม่ใช่ authorization การรู้ URL ไม่ให้สิทธิ์อ่าน workspace อื่น; guest mode ไม่อ้างว่าเป็น enterprise identity อายุ24ชั่วโมงคือ idle timeout โดยมี absolute lifetime7วัน ตรงกับ Blueprint

| Action/resource | Owner (Invoice) | Teacher | Learner | DM | Player |
| --- | --- | --- | --- | --- | --- |
| Read own authorized table | allow in own membership | allow | allow own/shared projection | allow | allow own/public |
| Import evidence / reconcile | allow | deny | deny | deny | deny |
| Change shared lesson / choose representations | deny | allow | deny; local exploration only | deny | deny |
| Submit learner answer | deny | teacher preview separate | own answer only | deny | deny |
| Read individual learner answers/private teaching notes | deny | allow class scope | own answer only; no teacher notes | deny | deny |
| Request game action | deny | deny | deny | adjudicate command | own character / legal turn |
| Read DM secrets | deny | deny | deny | allow own party | deny in payload and history |
| Approve/activate rule | Invoice owner | teacher lesson scope | deny | DM party scope | propose only |
| Reset workspace / invitations | own Invoice | own class | deny | own party | deny |

ทุก endpoint, file URL, reconnect snapshot, event replay และ export ตรวจ workspace membership + epoch + action + per-resource policy; UI guard เป็น feedback เท่านั้น WebSocket handshake ตรวจ Origin allowlist และ cookie; reject cross-site origin, revoked session และ oversize messages คำสั่งผ่าน CSRF protection และ HTTPS origin checks

### Atomic command transaction

1. Authenticate และ authorize; validate payload/limits ก่อน compute
2. Begin SQL transaction; lock workspace row; ตรวจ `(workspaceId,epoch,actor,commandId)` ใน idempotency record ก่อนตัดสิน conflict
3. Duplicate same canonical payload hash คืน Ack เดิม; same key/different payload คืน `IDEMPOTENCY_MISMATCH`; ตรวจ expected revisions เทียบค่าปัจจุบัน
4. Run deterministic reducer; persist new state, immutable event/revision, command Ack และ outbox ใน transaction เดียว; commit ก่อนตอบ accepted
5. Dispatcher ส่งเฉพาะ authorized projections อย่างน้อยหนึ่งครั้ง; client dedupe eventId/cursor ไม่ execute side effects ระหว่าง replay

หนึ่ง workspace เป็น calculation/ordering unit R1; presence/camera ใช้ lossy channel ไม่มี authority ต่อ HP/rules/answers เพิ่ม instance ภายหลังต้อง shared notification/backplane และ lease dispatcher ไม่พึ่ง memory room list อย่างเดียว สำหรับ R1 เริ่ม 1 app instance + durable DB; restart ห้ามสูญ accepted action

### Proposed storage model — specification only

| Table/object | Key/constraint | Retention/consistency |
| --- | --- | --- |
| workspaces | id; epoch; state_revision; active_rule_id | one authority row, CAS/row lock |
| memberships + sessions + invitations | workspace/epoch/actor unique; opaque secret hashes | cookie expiry/revoke; membership not in client manifest |
| snapshots | workspace/epoch/state_revision unique; schema_version; content_hash | state snapshot transactionally aligned with events |
| revisions + validations + approvals | immutable revision ID; candidate/proof hashes + scoped actor | approval cannot be reassigned to another candidate |
| commands + events + outbox | scoped command unique; ordered event seq; outbox delivery IDs | retries dedupe; replay after reconnect |
| sources + extractions + results | immutable artifact hash; parser/review/rule revisions | raw artifact never overwritten by corrected extraction |
| model_jobs | workspace/epoch + quota reservation + status | late/cancelled completion cannot activate |
| private object storage | generated key; no user-controlled paths | quarantine uploads, signed/authorized reads, TTL cleanup |

นี่เป็น schema design เท่านั้น ไม่สร้าง tables/migrations จริงใน planning. ก่อน persistent schema deployment ต้องประกาศ environment/operation/blast radius และรับ approval ตาม working agreements

Reconnect ส่ง opaque projection cursor; server ตรวจสิทธิ์ใหม่ทุกครั้งแล้วส่ง deltas หรือ full authorized snapshot พร้อม watermark ถ้า cursor หมดอายุ ห้ามส่ง full event log แล้วให้ client กรอง Private events ไม่ควรเปิดเผยจำนวนผ่าน shared sequence จึงใช้ cursor ของ projection คำสั่งค้างหลัง disconnect แสดง pending จนได้ Ack; retry commandId เดิมหลัง reload ได้

Default workspace TTL 7 วัน, session ตามด้านบน; UI บอกวันหมดอายุและมี export Reset โดย owner เพิ่ม epoch ใน transaction, seed sample snapshot ใหม่, invalidate old invites/pending jobs/old-epoch commands และ projection cursors ทุกอัน; file cleanup ใช้ durable job เก็บ minimal reset audit ไม่มีเนื้อหาเอกสารเก่า อย่าเรียก Reset ว่า deletion สำเร็จจน cleanup ตรวจครบ

Reset membership policy: remap เฉพาะ owner/teacher/DM ผู้สั่ง reset กับ current authenticated session ไป epoch ใหม่ใน transaction เดียว; revoke learner/player memberships และ sessions ที่ผูกกับ room เก่าทั้งหมด พร้อมปิด sockets. Peers ต้องได้ invite ใหม่จึงกลับเข้ามาได้ ไม่มีสิทธิ์สืบทอดโดยปริยาย Owner ใช้ cookie เดิมที่ชี้ stable authenticated principal และ server อัปเดต grant ไป epoch ใหม่ (role ไม่เปลี่ยน); เปลี่ยน role ต้อง rotate session. เก็บ scoped reset receipt ตาม stable owner actor + commandId + workspace/oldEpoch เพื่อคืน Ack เดิมเมื่อ response หายหลัง commit; receipt lookup ต้องตรวจ owner identity ปัจจุบันก่อน และไม่เปิดให้ old-epoch command อื่นผ่าน. Owner ได้ full new-epoch bootstrap; old cursor คืน `RESYNC_REQUIRED`, peers ได้ `MEMBERSHIP_REVOKED`. ทดสอบ reset ระหว่างอีกสอง clients offline, retry reset หลัง lost Ack, และ late model result ต้องไม่คืนสิทธิ์หรือ state เก่า

## 6. Verified Evolution Pipeline

```diagram evolution
Requested → Draft → Staged → Simulated → Validated → Approved → Active
                ↘ Invalid / Rejected          ↘ Stale / Expired
Active old revision remains usable until atomic activation commits
Rollback → new activation of compatible prior rule; never erase history
```

Immutable Candidate รวม baseRuleRevision, baseStateRevision, workspace epoch, sourceSetHash, normalized changeset, capability versions และ candidateHash; model explanation เป็น untrusted text ไม่ใช่ evidence ส่วน validation proof รวม candidateHash + inputSnapshotHash + testSuiteVersion/hash + seed + compiler version + migration check + result

Approve เป็นการบันทึก human decision ต่อ candidate/proof ที่ผ่านและอยู่ใน scope โดยยังไม่เปลี่ยน Active Activate เป็น separate command และต้องพบ durable `Approved` record ที่ยังไม่ revoked/expired โดย bind approvalId กับ candidateHash, proofHash, approvingActor, workspace/epoch และ action scope ตรงกันทั้งหมด; approvingActor ต้องยังมีสิทธิ์ ณ activation และผู้สั่ง Activate ต้องผ่าน current policy อีกครั้ง. Client flag/signature ที่ไม่ได้ออกโดย server ไม่ใช่หลักฐาน approval. ตรวจ record นี้พร้อม current identity, policy, epoch, base revisions, sourceSetHash และ proof hash ใน transaction เดียว; mismatch คืน `STALE_CANDIDATE` หรือ `APPROVAL_REQUIRED/REVOKED` และให้ re-simulate/revalidate/reapprove ตามสาเหตุ ไม่มี automatic rebase ของ financial rule

ระหว่าง simulate/validate ผู้ใช้ยังอ่านและทำงานบน Active ได้ หากงานเปลี่ยนจน baseStateRevision ต่างต้อง refresh candidate หลังการเล่น/สอน turn ล่าสุดก่อนอนุมัติ ใช้จุดพักสั้น ๆ ตอน activate แทน lock ทั้ง session ตลอดช่วง model call

Simulation ใช้ cloned immutable snapshot และ deterministic seed เดียวกันสำหรับ before/after ไม่ dispatch network/domain side effects. Activation เปลี่ยน rule pointer และ derived outputs เป็น revision ใหม่ รักษา component IDs, selection, scroll, pending local exploration ที่ compatible. Rollback เป็น new revision activation บน current compatible state; ไม่ย้อน HP/คำตอบ/ไฟล์หรือผลภายนอกโดยเงียบ ๆ ถ้า schema ย้อนกลับไม่ได้ต้องใช้ forward fix

### Bounded non-scripted proof ที่เลือก

เลือก Invoice rate/date changeset เป็น required live proof: ผู้ทดสอบให้ข้อความไทย/อังกฤษที่ไม่ตรงกับ authored phrases เช่น “โซนเหนือคิดเพิ่ม 7.50 ตั้งแต่วันที่ 20 ยกเว้นก่อนวันนั้น” ภายใต้ supported zone/rule ontology และแนบ structured reviewed source excerpt โมเดลส่ง JSON operations เช่น `setZoneBase`, `setWeightStep`, `setSurcharge`, `setEffectiveWindow`, `disableRule`; ห้าม JS/SQL/HTML/URL fetch หรือ package installs

Gateway มี allowlisted provider endpoint, server secret, 60s timeout, retry สูงสุด 1 ครั้งสำหรับ transient failure โดยไม่เกิน reserved cost; 5 requests/room/day และ global budget gate ที่ Owner ต้องอนุมัติ ไม่มี model call รอบ planning หาก timeout ให้ deterministic manual editor ต่อได้ แต่ต้องติดป้ายว่าครั้งนั้นไม่มี live AI proof

พิสูจน์หลัง implementation: ชุด holdout อย่างน้อย 10 คำขอใหม่จาก reviewer (5 valid changes, 3 ambiguous/unsupported, 2 adversarial prompt-injection) และ alternate CSV ที่ไม่ใช่ presentation fixture; valid ต้องได้ schema-correct meaningful patch ที่ผ่าน trusted independent tests ทุกตัวและเปลี่ยนผลคำนวณตาม oracle, ambiguous ต้องขอ clarification/refuse, adversarial ต้องไม่มีสิทธิ์ใหม่ บันทึก provider/model/version, request/candidate hash, latency, cost, pass/refusal โดย scrub prompts ก่อน public report การตอบสำเร็จหนึ่งครั้งเป็นขั้นต่ำการพิสูจน์ path แต่ readiness ต้องผ่านชุด safety cases ทั้งหมด

Manual configure, recipe composition และ model-proposed patch ต้องมี provenance labels ต่างกัน ใช้ cached replay ได้สำหรับ CI deterministic tests แต่ไม่ใช้แทน live non-scripted acceptance

Concrete composition proof: `setSurcharge` ที่ผ่าน approval ทำให้ trusted recipe compiler สร้าง versioned plan delta: เพิ่ม `surchargeSatang` column บนตารางเดิม และ bind `invoice.reconcile.surchargeExceptions@ReviewItemV1[]` ไป `invoice.review.items@ReviewItemV1[]` ผ่าน allowlisted merge adapter โดยไม่สร้าง separate app หรือให้ model เขียน port/ACL เอง Candidate hash และ validation proof ครอบคลุม derived plan delta/hash ด้วย. เมื่อ activate ต้องเห็นทั้ง expected amount ที่เปลี่ยน, column ใหม่ และ row click ที่เปิด evidence/review item ของแถวเดียวกัน; component ID, scroll และข้อมูลอื่นคงอยู่ตาม compatibility contract. ก่อน approval ต้องไม่เห็นผลนี้ใน Active; invalid type/private-flow binding ต้องไม่ activate. เพิ่ม assertion นี้ใน INV05/INV07 และ CORE02; การ composition นี้เป็น trusted recipe response ต่อ model-proposed rule ไม่ใช่ model-generated UI code

## 7. Invoice — complete end-to-end slice

R1 รับ shipment CSV + invoice text PDF ตาม documented template และ supporting rate-card/addendum text PDF หรือ structured reviewed excerpt. PDF extraction ไม่รับรองความจริง: preview page/selection → review normalization → immutable extraction revision. CSV-only เป็น fallback ที่เสนอได้ แต่ไม่ใช่การลด text-PDF requirement อัตโนมัติ

Limits ที่เสนอ: CSV ≤5 MiB/10,000 rows, PDF ≤10 MiB/20 pages; MIME+magic bytes+extension validation, timeout/worker resource caps, encrypted/scanned/unsupported PDF คืน actionable error; ไม่มี OCR. Upload quarantine private, no inline active content/scripts, parser never trusts document instructions; object key generated server-side. Parse before committing normalized rows; rejected uploadไม่เปลี่ยน Active dataset

### Domain rules and numeric oracle

- R1 currency THB only; amounts integer satang, weights integer grams; disallow NaN/negative/nonfinite/overflow; safe integer bound and totals explicit. No implicit FX or tax calculation: sample amountsเป็นยอดที่ระบุรวมภาษีแล้ว; unknown tax/currency → unresolved
- Exact normalized shipmentId match only; duplicate IDs → review; unmatched invoice/shipment stay unresolved, no fuzzy auto-match. Unicode/whitespace normalization recorded with source row, never silently merge distinct IDs
- 3 supported rule families: zone base, each-started-extra-kg charge, remote surcharge; effective windows local service date Asia/Bangkok with half-open `[from,to)` dates. Overlapping rules of same kind/scope rejected; no guessed precedence
- Formula `expectedSatang = base + ceil(max(0,weightGram-1000)/1000)*step + supportedSurcharge`. Missing weight/zone/evidence → `expected=null`, unknown reason; never coerce to zero. Delta = billed−expected only when known
- Example fixture: from 2026-10-15 base Bangkok 3500, regional 4500, step1000; before date Bangkok4000/regional5000. 1,100g Bangkok on15th =4500; billed5000 → delta+500. 1,000g on14th=4000. New surcharge750 on/after20th makes same 1,100g row5250, with dated reviewed evidence
- No future finding of “fraud”, payment approval, bank/ERP posting or regulatory assurance. Output is reconciliation evidence for a human

Evidence gap engine queries rule-source dependencies; outputs documentType, whyNeeded, affectedRecordIds, supported rule hypothesis, uncertainty, sourceRequirements, status `missing→suggested→provided→verified/rejected`. `provided` does not imply verified. Suggest rate card only where specific unknown surcharge/date/zone affects decision; group repeated rows into one request. Operator can reject hypothesis or disable unsupported rule through same verified path

| Test ID | Action | Acceptance oracle |
| --- | --- | --- |
| INV01 | fresh sample + alternate CSV and text PDF; column reorder | normalized records correct, row/page refs and hashes retained |
| INV02 | duplicate ID, missing required column/weight, unmatched row | specific errors; missing totals excluded/labeled unknown; no silent match |
| INV03 | remote surcharge lacks rate evidence | grouped gap and affected rows, not fraud/automatic correction |
| INV04 | add supported document and review extraction | status provided→verified only by human; Active unchanged |
| INV05 | propose add/modify/disable rate, simulate same data | exact before/after deltas; unrelated dates unchanged; surcharge candidate includes column/binding plan delta and hash per §6; Active remains unchanged |
| INV06 | invalid overlap/ambiguous clause/unsupported currency | validation blocked, current result preserved |
| INV07 | validate→approve→activate and stale source/revision race | current durable approval/proof activates atomically; surcharge column appears and row click opens matching review/evidence per §6; IDs/scroll preserved; stale gets409 |
| INV08 | export CSV+offline HTML then reload | result totals/rows/source and rule revisions identical; CSV formula injection escaped, HTML text escaped |
| INV09 | resume next dataset using approved rules | new run/source revision, no overwrite of old evidence/report |

## 8. Teaching — one teacher, two learners

One frictionless horizontal-cart lesson. Trusted pure model `a=F/m`, `v(t)=a*t`, `x(t)=0.5*a*t*t`, initial position/velocity0; SI units, F∈[0,20]N, m∈[0.5,10]kg, t∈[0,5]s. Nonfinite/m≤0 rejected. Use analytic solution evaluated from shared parameters/time epoch; no frame-count integration drift and no network broadcast each animation frame

Teacher chooses text/2D/graph/beginner/advanced per learner; no permanent learning style labels. Shared lesson state stores approved parameters and lessonRevision. Learner exploration is private sandbox with “local experiment” label and reset-to-teacher. Submitting answer carries questionId + lessonRevision + value/choice; mismatch returns stale question prompt, not grade against new parameters

| Test ID | Action | Acceptance oracle |
| --- | --- | --- |
| TEA01 | teacher opens lesson and 2 independent learner contexts join | own scoped projection; no shared browser storage shortcut |
| TEA02 | F10/m2 vs F10/m5 | a5 vs a2 in equation, scene labels, graph; t2 yields x10/v10 vs x4/v4 |
| TEA03 | change Force/Mass; switch beginner/advanced | all shared views reference same lesson revision; local experiments labeled separately |
| TEA04 | send different representations | selected learner only receives intended view; no reset of answer draft |
| TEA05 | learner wrong/correct answer | trusted rubric computes feedback; teacher receives response; learner cannot read peer answer/private notes |
| TEA06 | save teaching approach + reload/reconnect | representation choices, teacher note and authorized answers restored |
| TEA07 | unauthorized global edit / stale answer | server rejects and keeps state; UI explains next action |

## 9. D&D-style encounter — DM plus two connected tables

Use original simplified fantasy rules, no claim of complete official D&D. Reuse encounter reducer concepts but remove fixed story order as authority; player action requests validate current turn, owned character, target, AP, cooldown and rule version. Server commits RNG seed/die result with action; simulation uses recorded seed, never rerolls until desirable outcome

Bounded fixture: Mira10HP, Pip10HP, goblin6HP; enemy hit4, shield reduces2; exact attack/turn policy documented in fixtures. Revision1 shield self only, revision2 self or ally, revision3 cost1AP and once per actor turn. At start of own turn AP resets to2 and shield-use marker resets exactly once; disconnect does not reset resources. Rule change applies to next unresolved action, never rewrites committed damage. Simulation of recorded hit to Pip compares HP6→8 from same pre-hit state/seed; after activation future legal action uses same rule

Encounter phase contract: `turn.start → action.declared → reaction.open → action.resolved → turn.end`. Shield เป็น reaction ของเจ้าของ shield ต่อ declared hit ที่ยังไม่ resolved; consume AP จาก resource pool ล่าสุดของเจ้าของ ไม่ต้องเป็น acting attacker แต่ต้องอยู่ใน reaction window และ own character scope DM ปิด window/resolve เมื่อทุกฝ่ายตอบหรือ deadline ที่แสดงชัดหมดลง; server มี authoritative deadline เดียว เงื่อนไข once-per-own-turn เก็บ marker ตาม turn generation ของเจ้าของ shield การ activate rule ระหว่าง reaction window ทำให้ pending intents ต้อง revalidate ต่อ revision ใหม่ก่อน resolve; ไม่ย้อนผล hit ที่ commit แล้ว

| Test ID | Action | Acceptance oracle |
| --- | --- | --- |
| DND01 | DM+2 players join from separate contexts (and two devices for hosted gate) | server session connected; no simulated cursor counted as a real participant |
| DND02 | player requests action; duplicate/reordered command | one authoritative outcome; duplicate Ack, conflict refresh; animation follows commit |
| DND03 | inspect player traffic/reconnect/export | DM notes/enemy secrets/other private choices never appear |
| DND04 | propose ally target; simulate; DM validate/approve/activate | target control appears only after approved current revision; HP math exact |
| DND05 | propose cost/cooldown revision then repeat use | insufficient AP/second same-turn use rejected; legal own-turn reset once |
| DND06 | player attempts DM activation/spoof actor/subscribe forbidden scope | deny at server; no private event or state change |
| DND07 | simultaneous actions / disconnect after commit before Ack | retry yields same result; all allowed tables converge |
| DND08 | reload/reconnect with current party history | HP/turn/AP/rule revision restored; incompatible rollback blocked |

## 10. UX acceptance และ curated capabilities

Start with document/lesson/character table only. Objects appear on real ingestion/gap/representation/action needs. Preserve stable object IDs and spatial memory; Use/Arrange separation retained. Active/Draft/Simulation labels and comparison must work without color. Evidence click focuses exact row/page, Back returns to prior position. Camera follow optional; manual pan pauses it. On narrow screens use table switcher/focus mode with visible owner/role, not miniature unreadable canvas

Keyboard paths: import, select evidence, edit draft, run tests, approve, export, switch table, submit answer/action; visible focus; dialogs restore trigger focus; errors link to field; minimum contrast4.5:1 body and3:1 large/control; reduced motion retains all steps. Test 1440×900 and390×844 including actual interactions, not screenshot alone. No loading animation claims progress before a real job state exists

| Recipe | Shared implementation | Verification |
| --- | --- | --- |
| import.csv/text-pdf | ArtifactService + bounded parser adapter | invalid files, immutable refs, extraction review |
| evidence.table/review | common row/source navigation | no missing source; export precision |
| rule.simulate/evolve | EvolutionService + domain tests | candidate/proof/base mismatch and rollback |
| view.scene2d | trusted SVG/Canvas renderers with lifecycle | physics/game truth follows state, no hidden timer leaks |
| view.graph | existing Recharts via typed inputs | numeric graph equals model |
| lesson.assess | typed question/rubric/answer | role scope + stale lesson check |
| session.project | shared session authority / projection transport | private payload negative tests |
| persistence.export | immutable run/revision refs | reload/dedupe/export correctness |

Reuse existing React, TS, React Flow, Zustand, Recharts, Vitest/Playwright. Select PDF parser/schema validator/server libraries only after size/license/security review in implementation. Registry entries require schemas, fixture tests, permissions, limits, compatibility and license. Discovery/MCP/tool installation are out of hosted R1; curated≠automatically safe and popular≠verified

## 11. Milestones, dependencies และ estimate

Estimates derived from inspected gaps, expressed as focused engineer-days with existing tests available, not calendar promise. Assumption one full-stack engineer plus part-time independent QA/reviewer; deadline/team/hackathon rules unknown. Ranges exclude waiting for owner/provider access and production compliance work. Re-estimate after M1

```diagram roadmap
Approval + migration decision → M0 source baseline → M1 shared contracts
M1 → M2 authority/persistence/evolution → M3 Invoice
M2 → M4 Teaching + M5 D&D (parallel only with distinct owners)
M3 → M6 bounded model proof → M7 hosted verification → release review
```

| Milestone | Deliverable / owner role | Estimate | Exit criterion |
| --- | --- | --- | --- |
| M0 | source import provenance, lockfile/runtime/test baseline / lead | 1–2d | approved source lineage; clean clone reproducible; no credentials |
| M1 | executable contracts/compiler/registry/Canvas adapter / core | 3–5d | three minimal manifests load, one real binding each, negative contracts reject |
| M2 | guest membership, SQL transactions, events/projections, revisions / backend | 5–8d | two independent clients, restart recovery, stale/idempotency/privacy tests |
| M3 | Invoice ingestion→evidence→export→resume / full-stack | 4–7d | INV01–09 with alternate data/PDF + numeric oracle |
| M4 | physics model/teacher+2 learners / frontend+backend | 2–4d | TEA01–07 plus keyboard/narrow |
| M5 | authoritative encounter/DM+2 players / full-stack | 3–5d | DND01–08 including private traffic inspection |
| M6 | model gateway + constrained patch + holdout / AI/core | 2–4d | live non-scripted proof and adversarial set, budget/timeout controls |
| M7 | CI, preview, hosted E2E, recovery, documentation / release+QA | 3–5d | all hosted release gates + reproducible receipt, owner release approval |
| Total effort | 23–40 engineer-days before contingency | +25% risk reserve | roughly29–50 engineer-days planning range; not delivery date |

If available time is materially less: cut visual polish, optional domains within each case, parser breadth and general generation. Do not claim full R1 with fake multiplayer or no non-scripted proof. A staged Invoice-only checkpoint may be useful but requires owner agreement and must be labeled “pre-R1”, not substitute for the locked three-case contract

## 12. Acceptance gates และ failure matrix

| Gate / ID | Required failure scenario | Expected result / future proof |
| --- | --- | --- |
| CORE01 | invalid component input/unknown version/required input missing | compiler diagnostics, no partial activation |
| CORE02 | valid surcharge composition per §6; broken binding, cycle, incompatible type, private→shared flow | valid typed plan connects surchargeExceptions to review.items and changes existing surface; invalid plan rejected in full, Active unchanged |
| EV01 | failed validation / changed source / stale, missing, forged or revoked approval | cannot activate; server checks durable Approved record + exact proof/candidate; explicit refresh/reapproval |
| EV02 | two approvals/activations race | single state revision commit; loser409, no lost update |
| AI01 | model timeout/malformed output/injection/late result | budget released or charged consistently; no Active mutation; manual editor available |
| NET01 | disconnect before/after commit, reordered Ack | durable retry idempotent; authorized state converges |
| AUTH01 | actor spoof, cross-workspace ID, role escalation, export/replay leak | deny before payload assembly; no secret in browser caches/logs |
| FILE01 | corrupt/unsupported/large file, CSV formula injection | bounded reject/escaped output; no parser hang or unintended upload |
| GEN01 | unknown renderer / failed generated declaration | error surface; other components continue; no eval or unsafe JS |
| OPS01 | app crash, interrupted deploy/outbox delivery | last committed snapshot recoverable; duplicate events deduped |
| OPS02 | rollback prior app/rule/state schema incompatibility | compatible release restored; migration plan validated; no silent data rewind |
| UX01 | slow network, 390px, keyboard, reduced motion | loading/error/recovery usable; stable task context |

Performance targets (not measured SLAs): 20 concurrent rooms ×3 actors; p95 acknowledged non-model action<500ms and reconnect<3s on declared same-region test; maximum admitted10k invoice rows completes<3s on target server after parse; document parse<10s otherwise timeout; model separately measured with60s timeout; virtualize tables and cap active mounted objects at24 in R1. Record device/network/data size, memory, event latency and cost, then revise caps from load evidence

Hosted acceptance and operational matrix are in Blueprint; global tests must cover TLS, asset hash parity, API, no client secrets, refresh/deep links, session isolation, narrow viewport and all case IDs here. Local PASS is not hosted PASS. No post-deploy report created now because no deployment occurred; required future report pair and status ladder are specified there

## 13. Owner gate

Owner ต้องตัดสินใจสถาปัตยกรรม B, release scope/cuts, source migration history, hosting budget/provider/region, guest policy/retention และ live-model provider/budget ก่อน implementation. Deadline/hackathon rules และ source/license eligibility ยัง Unknown ดู [Open Decisions](TABLETOP_R1_OPEN_DECISIONS.md)

การอนุมัติเอกสารหรือการ merge planning PR ในอนาคตไม่ใช่คำสั่ง deploy โดยอัตโนมัติ Session นี้จบหลังส่ง planning review branch/PR; product code, CI และ application hosting รอคำสั่งรอบถัดไป
