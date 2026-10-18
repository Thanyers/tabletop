# tabletop. — R1 Critical Audit

18 ตุลาคม 2026 · Asia/Bangkok · **Planning review / implementation not approved**

คำแนะนำ: **Revise architecture details, reduce breadth, then proceed conditionally.** โค้ดเดิมมีประโยชน์จริงและ tests ผ่าน แต่ยังห่างจาก Tabletop R1 ในเรื่อง shared runtime, connected identities, durable authority และงาน Invoice ครบวงจร ความเสี่ยงหลักคือเรียก diagram/schema/local simulation ว่าเป็นระบบที่พร้อมใช้งานร่วมกัน

อ่าน [Master Plan](TABLETOP_R1_MASTER_PLAN.md) สำหรับ target contracts และ acceptance IDs; [Deployment Blueprint](TABLETOP_R1_DEPLOYMENT_BLUEPRINT.md) สำหรับ hosting/CI/operations; [Open Decisions](TABLETOP_R1_OPEN_DECISIONS.md) สำหรับ owner choices สถานะ Observed = ตรวจจริง; Derived = ข้ออนุมานจากหลักฐาน; Proposed = แผน; Unknown = ยังไม่มีหลักฐาน

## 1. Audit scope, method และ limits

- อ่าน addendum ล่าสุดและ handoff/Final ทั้ง 4 ไฟล์ รวม HTML 20 sections, schema/examples และ historical images 4 ภาพ; ภาพสามเดโมเดิมและภาพ concept ไม่ใช่หลักฐาน R1
- Source/UX evidence ผ่าน independent read-only agents สองสาย: `explore__runtime_evidence` และ `design_thinker__handoff_requirements`; main agent รวม architecture และตรวจ fresh baseline
- ใช้ GitHub REST ด้วยบัญชีเป้าหมายที่อนุญาต; ไม่ใช้ connector ของบัญชีเดิม; network access ผ่าน escalation ที่ได้รับอนุญาต ไม่มี secret ถูกใส่ใน report/log/remote URL
- TypeScript, 189 unit tests, 7 local lab tests, production build และ 9 current Canvas browser checks ผ่าน; first probe ที่ใช้ selector เก่าไม่ผ่านและถูกจำกัดเป็น harness failure โดยไม่มี product patch
- ไม่ทำ live model calls, hosted R1 E2E, dependency scanning แบบออนไลน์, load test, penetration test หรือการสำรวจผู้ใช้จริง; ไม่ให้ security certification จาก code review
- Public planning branch ยังไม่บรรจุ product source เพราะ user อนุญาตเฉพาะ planning docs; source references เป็น local snapshot evidence ไม่ใช่ runnable GitHub delivery

## 2. Current reality และ gap severity

| Area | Observed | Gap / implication | Priority |
| --- | --- | --- | --- |
| Canvas | ใช้จริง, Use/Arrange, source references, save/resume ผ่าน bounded browser tests | คงไว้; ลดการย้ายจุดโฟกัสที่ไม่เกี่ยวกับงาน | P1 UX |
| Verified local rules | fingerprint/evaluation gate ใน `src/trio/domain.ts:511`, `src/trio/domain.ts:678`, `src/trio/domain.ts:724` | ไม่มี server identity/atomic durable activation | P0 |
| Shared runtime | typed fixed RuleBook; local Canvas/reference links | ไม่มี manifest compiler, typed ports หรือ runtime semantic policy | P0 |
| Invoice | shipping rates และ fixture evidence | invoice ingestion/matching/gap/verified supporting source ใหม่ยังไม่ครบ | P0 |
| Teaching | reusable charts/state/UI | ไม่มี F=ma shared lesson/learner answer authority | P0 |
| D&D | deterministic local encounter, simulated participant | ไม่มี network room/server projection/role-negative proof | P0 |
| Persistence | localStorage per-case, lab export/import | accepted commands/revisions ไม่ durable ข้าม clients หรือ server restart | P0 |
| AI | local rhythm code-generation experiment | ไม่ใช่ bounded non-scripted Invoice evolution และไม่ใช่ safe public code execution | P0 release |
| Delivery | GitHub main มี README เท่านั้น | source migration provenance/CI/hosting ยังต้องวางขั้นตอน | P0 release |

Evidence anchors: `src/trio/TrioExperience.tsx:214,283,792,884`; `src/trio/creative/encounterModel.ts:14,165,215`; `scripts/component-lab/plugin.ts:337,402`; `src/lab/GeneratedFrame.tsx:37`; `README.md:17,25,27,49`. Source paths refer to the local audit snapshot.

## 3. Draft JSON contract findings

JSON parsing สำเร็จ แต่ยังไม่ได้ใช้ full Draft2020-12 validator ใน session นี้ ตารางนี้เป็น semantic review และ required negative tests ไม่ใช่การรายงาน schema test suite ผ่าน

| Finding / exact input evidence | Failure mode | Required repair in implementation | Acceptance |
| --- | --- | --- | --- |
| Schema `inputs/outputs` string maps and free `valueType`; lines 257–342, 384–423 | A typo or port mismatch can still look like valid config | schema registry, endpoint resolution and compatibility checks | CORE01/02 rejects unknown port/type |
| Invoice reads `artifact:invoice-pdf` but sources declare `artifact:invoice-001.pdf`; examples 73–78, 186–199 | Orphan evidence link; rule source cannot be reproduced | stable `ArtifactId` resolved from source registry; no bare refs | Missing source blocks stage |
| Invoice `activeRules` has no resolved binding to `ruleRevisions`; examples 64–68, 177–185 | Render/control may use different rules | Explicit host-owned active-rule input; resolve required inputs | Active output tied to one revision |
| Teaching answer route is visual→assessment, with no typed answer payload, graph route or feedback binding; examples 328–359, 393–423, 462–473 | View looks interactive, but answers/feedback are disconnected | typed `SubmitAnswer` command and scoped feedback projection | TEA04/05 |
| Teaching example has no text representation or teacher-selection command | Advertised representation switching is incomplete | Recipe includes text + 2D + graph and teacher-controlled view selection | TEA02/03 |
| Engine `actionRoles` allows DM only, but player routes require player; examples 587–619, 752–782 | Implementation either rejects all players or bypasses authority | Distinguish request-to-authority from engine mutation; endpoint policy is authoritative | DND02/06 |
| Public/private engine outputs share a broad string contract; examples 589–601; schema 290–313 | Private DM data could be sent, then hidden only in the UI | Classify output data and authorize projection before serialization | DND03 with wire inspection |
| Broad `activateRoles` repeats owner/teacher/DM, including Invoice; examples 79–90 | Role names can be mistaken for workspace membership | Session identity, workspace membership and action/resource policy | Cross-workspace activation denied |
| No idempotency/revision/causation envelope; schema 344–423 | Double actions, stale writes and unauditable retries | Command/event envelope, transaction and durable Ack | NET01/EV02 |
| Snapshot/event refs are opaque; schema 93–110; draft `$id=example.invalid` lines 2–5 | Structural validity can be mistaken for executable semantics | Versioned schema identity and explicit migration registry | Reload/unsupported-version tests |

“Schema valid” เป็นเพียง gate แรกในสามชั้น: shape → semantic plan → behavior/authorization ภายใต้ runtime. ห้ามใช้ TypeScript static types แทนการตรวจ untrusted network input.

## 4. Challenge the architecture

| Option | จุดแข็ง | Objection ที่รุนแรงที่สุด | Evidence/decision |
| --- | --- | --- | --- |
| A minimal adapter migration | Reuse ได้เร็วและย้ายไฟล์น้อย | Controller เดิมรับผิดชอบหลายเรื่อง; ทั้งสาม case อาจยังมี logic แยก พร้อม permission patch ครอบอยู่ | เหมาะกับ spike แต่ยังไม่รับเป็น R1 architecture หากไม่มี shared binding proof |
| B hybrid extraction | เก็บ UI/domain ที่ดีไว้; เพิ่ม authority/contract ทีละ slice | Temporary adapters เพิ่มความซับซ้อน; ขอบเขตอาจค่อย ๆ กลายเป็น rewrite | แนะนำโดยตั้ง M1 exit test และจำกัด module interface |
| C clean rewrite | Contracts สะอาดและอาจทดสอบได้ดีขึ้นในอนาคต | ทิ้ง working interactions; deadline ยังไม่ทราบ; เสี่ยงสร้าง platform แทนส่งงาน | Defer; ประเมินใหม่หาก M1 พิสูจน์ว่า adapter ทำไม่ได้ |

ข้อโต้แย้งต่อ B: “เรียกทุกอย่างว่า shared runtime แต่ reducer ยังเฉพาะโดเมน” เกณฑ์ตรวจคือ framework ร่วมต้องโหลด manifests ทั้งสามผ่าน compiler/registry/lifecycle/authority/evolution ชุดเดียวกัน โดย domain rules ยังต่างกันได้ หากสาม switch branches แค่ render หน้าของตัวเองและ edges ไม่ส่งข้อมูล ยังไม่ผ่าน

อีกข้อโต้แย้ง: “LLM แค่กรอกฟอร์มถือว่า living software หรือไม่” แผนจึงกำหนดให้ approved patch เปลี่ยนทั้ง behavior และ surface composition/binding จาก trusted recipes โดยรักษา state ไม่ใช่แค่พิมพ์ข้อความใหม่ แต่ยังไม่อ้าง arbitrary code generation

```diagram comparison
Reuse-only: current controller → case-specific states → fast but fragmented
Hybrid: existing Canvas → shared contracts/authority → three domain adapters
Rewrite: new platform + new UI + new domains → high simultaneous risk
Decision gate: real three-manifest binding test before broad implementation
```

## 5. Critical review by fourteen perspectives

| Lens | Strongest critique | Decision / measurable closure |
| --- | --- | --- |
| Product Strategy | สามตลาดอาจทำให้ audience ไม่ชัด | Invoice คือ hero; อีกสองเคสพิสูจน์ topology/runtime ไม่ใช่ roadmap สามธุรกิจ |
| UX/UI | Canvas อาจเพิ่มภาระ; ผู้ใช้อาจสับสน Active/Draft | Stable work object, meaningful focus และ keyboard/narrow flows; ผู้ใช้ใหม่ทำงานได้โดยไม่รู้ runtime vocabulary |
| System Architecture | Runtime ใหม่อาจเป็น abstractions ที่ไม่มี depth | Interfaces เล็ก, pure reducers; โหลดสาม manifests และทำ negative binding tests ก่อนขยาย |
| Security/Privacy | Guest role/hidden panel ไม่ใช่ authorization | Server-derived actor, workspace/epoch ACL, per-output projection และ traffic-negative tests |
| Performance | App 832.15 kB และหลาย objects อาจหน่วง | Measure budget, lazy case capabilities, table virtualization, no frame broadcast; ไม่เพิ่ม 3D |
| AI/Agent Architecture | Hardcoded parser/recorded response อาจถูกเรียก AI | Live holdout requests และ provenance label; model สร้าง patch เท่านั้น |
| Runtime Safety | iframe/CSP ไม่หยุด CPU/memory abuse | Hosted R1 ไม่มี arbitrary JS; trusted interpreter + limits; local Lab แยกชัด |
| Collaboration/Consistency | Duplicate/reordered actions/late approval อาจทำ HP หรือ bill ผิด | Transaction + CAS + idempotency + outbox + projection cursor; ทดสอบ network cut หลัง commit |
| Data Accuracy | Missing evidence อาจถูกมองเป็น zero หรือ fraud | Integer units, effective-date interval, typed unresolved reason และ independent oracle |
| Maintainability | Controller branches มากและ manifest version หลวม | Domain adapters และ versioned registry; fail closed เมื่อ unsupported version; ลบ adapter เมื่อ migrate ผ่าน |
| Testing | 189 local tests อาจทำให้เชื่อว่าทั้งระบบพร้อม | Proof matrix แยก local/hosted/negative/holdout; quarantine outdated selectors |
| Cost/Scalability | Public anonymous AI อาจถูกใช้เกินงบ | Reserved quota + global cap + limited TTL; วัด cost per verified change ไม่ใช่ per prompt |
| Deployment Operations | Static build ไม่ได้ให้ API/DB/WS | Same-origin Node + DB + object storage, release artifact parity และ cold-start/recovery test |
| Hackathon Judging | Impressive authored story อาจลองเองไม่ได้; prebuilt code อาจผิดกฎ | Hands-on interaction + alternate fixture, disclosed legacy และ eligibility gate ก่อนส่ง |

ไม่มี real user study รอบนี้ ความเห็น UX และ judging เป็น expert review/inference ไม่ใช่อัตราชนะหรือผลวิจัยผู้ใช้

## 6. Risk register

Likelihood/impact เป็น qualitative planning estimate. P0 ต้องปิดก่อน hosted R1; P1 ต้องมี mitigation และผู้รับความเสี่ยง; P2 เลื่อนได้ Owner ชื่อจริงยังไม่กำหนดจึงใช้ responsibility role

| ID | Risk / severity | Owner | Mitigation | Closure evidence |
| --- | --- | --- | --- | --- |
| R01 | Shared runtime is only a diagram / P0 high / high | core lead | Compiler + binding execution | CORE01/02 + 3 case bindings |
| R02 | Cross-room/DM/learner data leak / P0 high / high | security/backend | Allowlist projection before serialization | Forbidden HTTP/WS/replay/export assertions |
| R03 | Stale approval/activation race / P0 high / high | runtime/backend | Candidate/proof/base hash + CAS transaction | Simultaneous activation: one winner |
| R04 | Wrong invoice amount/date/tax / P0 medium / high | domain engineer | Exact numeric contract + unresolved state | INV02/05/06 alternate oracle |
| R05 | Duplicate game action / P0 high / high | backend | Durable idempotency Ack | Disconnect-after-commit; retry once |
| R06 | Missing persistence/corrupt migration / P0 medium / high | backend/release | Snapshots/events/versioned migrations | Restart/reload/restore with checksums |
| R07 | Unsafe hosted generation / P0 high / high | AI/security | No arbitrary JS; bounded DSL | Malicious patch cannot grant capability |
| R08 | Parser abuse/formula injection / P0 medium / high | ingestion/security | Size/MIME/quarantine/escaping | Malformed PDF/CSV fixture suite |
| R09 | AI cost abuse/timeout / P0 high / medium | release owner | Quota reservation + global budget | Concurrent requests never overspend; timeout fallback |
| R10 | Model tests validate their own mistake / P0 medium / high | QA/domain | Independent trusted tests + holdout | Expected results not generated by model |
| R11 | Lost context during evolution / P1 high / medium | frontend | Stable IDs/state compatibility | Edits retain work/turn/position |
| R12 | UI looks functional but binding is dead / P0 medium / high | core/QA | Behavioral contract tests | Changing port input updates verified output |
| R13 | Free host sleeps/DB expires / P1 high / high | release | Paid always-on plan within approved budget | Cold start/reconnect/stable review window |
| R14 | Wrong deployed assets/environment / P0 medium / high | release | Immutable artifact + environment-specific config | Hosted SHA/parity + build metadata |
| R15 | Source history unknown/secret publication / P0 medium / high | lead | Isolated docs branch + allowlist + provenance gate | Exactly 8 planning files; no source/secret |
| R16 | Deadline/prebuilt eligibility unknown / P0 unknown / high | owner | Confirm rules and team before commitment | Written eligibility/deadline decision |
| R17 | Entry bundle/narrow UX / P1 medium / medium | frontend | Split capability chunks + focus mode | p95/viewport/keyboard measurements |
| R18 | Privacy retention claim without cleanup / P1 medium / high | backend | TTL job + epoch reset + object cleanup | Authorized delete/revoke verification |
| R19 | License/trademark/ruleset rights / P1 unknown / medium | owner | Original fantasy rules, license inventory | Review before public promotion |
| R20 | Dependency vulnerabilities unknown / P1 unknown / high | release/security | Lockfile + audit + triage exceptions | Scan results reviewed; no unsupported clean claim |

## 7. Failure and recovery scenarios

| Trigger | What the user sees | Required internal result | Future test |
| --- | --- | --- | --- |
| invalid component input/binding | error at exact object / port, usable Active | no partial candidate plan | CORE01/02 |
| unsupported source PDF | explain supported format/manual excerpt | quarantine / reject, no automatic rule | FILE01/INV06 |
| missing evidence | “ต้องการ Rate Card สำหรับรายการเหล่านี้” | null expected amount + source requirement | INV03 |
| Model times out | Retry/manual editor; current work continues | Cancelled/expired job cannot activate | AI01 |
| Candidate changes after test | Checks become stale; approval is disabled with reason | Server also rejects forged approval | EV01 |
| Two clients change state | One is accepted; the other gets conflict + refresh | No silent last-write-wins for money/HP | EV02 |
| Socket breaks after commit | Pending state, then result on reconnect | Retry Ack with the same `commandId` | NET01 |
| Guessed room/actor/`exportID` | Access denied without private payload | Authorization before query/projection | AUTH01 |
| Generated declaration fails | Last working component remains | No `eval` or unknown renderer execution | GEN01 |
| Deployment interrupted | Previous ready release handles traffic | No half-migrated schema is exposed | OPS01 |
| App/rule rollback is incompatible | Explicitly block rollback and use forward fix | No destructive snapshot rewind | OPS02 |
| Owner resets while another client is offline | Session reset banner appears on reconnect | Reject old-epoch writes/jobs/invites | AUTH01/NET01 |

All expected results above are specifications; current R1 execution status is NOT RUN. Investigate harness failures separately from product failures. The current example is an outdated `trio-hub` selector; the current Canvas suite passed.

## 8. Scope cuts and residual risk

ตัดก่อน: unrestricted code generation/package discovery/MCP writes; OCR ทุกเอกสาร; full D&D/campaign; 3D/TTS/audio; general LMS; enterprise SSO/multitenancy UI; ERP/bank writes; broad physics; marketplace. เก็บ legacy music ไว้ใน source เมื่อ migration ได้รับอนุมัติ แต่ไม่ใช้เป็นหนึ่งใน three Tabletop cases.

ห้ามตัดโดยไม่ขอ owner เปลี่ยน release contract: real server collaboration, exact calculations, evidence review, Active/Draft separation, durable accepted state, private projection, three cases, live bounded non-scripted proof และ hosted post-deploy testing.

Residual risk ที่ยอมรับได้สำหรับ reviewable alpha เมื่อ owner อนุมัติ: anonymous pseudonyms แทน real identity, small room cap, single region/single app instance, bounded formats, TTL 7 days และ synthetic data only. สิ่งเหล่านี้ไม่ทำให้ระบบเป็น Production Ready และต้องแสดงขอบเขตใน UI/README.

## 9. Independent review and reconciliation ledger

Review process แยกสองช่วง: independent evidence/UX audit ก่อนเขียน และ independent review ของ stable planning candidate หลังเอกสารครบ ห้ามใช้คำว่า reviewed แล้วแทนการตรวจฉบับสุดท้าย.

| Finding | Reconciliation already applied | Closure location |
| --- | --- | --- |
| “สาม apps” risk | Shared compiler/registry/authority; three binding tests | Master §3–4, CORE01/02 |
| Draft schema not enforceable | Semantic validator, typed commands, scoped projections | Master §4–5 |
| Local gate is not identity | Server authorization, transaction and immutable proof | Master §5–6 |
| Non-scripted=P1 ambiguity | Make release blocker explicit | Master §1, §6 |
| Public generated code is unsafe | Declarative patch only; local Lab isolated | Master §3, §6 |
| Historical success is not fresh proof | Rerun baseline; state source/UI limits | Master §2 |
| Git root mismatch | Isolated clone from official main; docs-only allowlist | Submission Plan §2–3 |

Independent final-candidate review โดย `reviewer__planning_safety` และ closure pass วันที่ 2026-10-18 พบว่าฉบับแก้ไขพร้อมสำหรับ **documents-only planning PR** หลังแก้ wording และ test cross-references ด้านล่าง ไม่มี material architecture contradiction ที่ยัง block การส่งเอกสาร ผลนี้ไม่รับรอง product runtime/security หรืออนุมัติ implementation.

| Final review finding | Revision and closure evidence | Disposition |
| --- | --- | --- |
| Live proof mandatory ใน Master แต่ optional/off ใน Blueprint | Blueprint §2/§5/§11/§15: off เฉพาะก่อนอนุมัติ provisioning; live holdout เป็น R1 gate | Closed in plan |
| Activation ขาด durable approval predicate | Master §6/EV01 + Blueprint §5: exact Approved record, current authorization, same transaction; forged/revoked cases | Closed in plan |
| Reset membership/epoch และ lost Ack ไม่ชัด | Master §5 + Blueprint §5: retain owner current session, revoke peers, scoped reset receipt, resync | Closed in plan |
| Surface evolution proof ยังทั่วไป | Master §6, INV05/INV07/CORE02: surcharge column + typed review binding + plan hash + visible assertion | Closed in plan |
| Budget มีเพียงสูตร | Blueprint §11 + D05: proposed USD 100/month allocation; actual quote/owner cap เป็น provisioning blocker | Closed as explicit decision gate |
| Weighted score arithmetic | Master §3: option A = 3.10 | Corrected |
| Concatenated prose / ambiguous “Human-free” | Audit/Submission/Decisions spacing edited; judging row now says “Hands-on interaction” | Corrected |

Documentation QA: three standalone HTML files passed 39 browser checks covering embedded Markdown hash and complete rendered-text parity, local links/anchors, desktop and 390px overflow, TOC navigation, keyboard table/diagram interaction, copy/print handlers and offline operation with no HTTP requests or console errors. Copy was checked with a mock clipboard and print by intercepting its handler; this is not OS clipboard or printed-PDF visual certification. All application R1 acceptance tests remain planned, not run. Remaining owner decisions stay in Open Decisions and are not approvals.

## 10. Final recommendation for owner

อนุมัติได้เป็น **architecture baseline แบบมีเงื่อนไข** หลังยืนยัน Open Decisions ที่ block implementation. ไม่อนุมัติ full platform rewrite; ไม่ลดสาม topologies ให้เป็น simulation เพื่อให้ส่งทัน. ถ้า deadline สั้นกว่าประเมิน ให้เลือก staged pre-R1 checkpoint โดยระบุให้ชัดเจน.

Planning quality gate ไม่ใช่ application release gate การส่ง PR นี้ไม่เปลี่ยน main, ไม่ deploy แอป และไม่ให้สิทธิ์ใช้เงินจริง/เอกสารลูกค้า/ข้อมูลเด็กในระบบทดลอง.
