# MEMORY.md — Tabletop

บันทึกบทเรียนและกับดักของโปรเจกต์นี้ (เฉพาะโปรเจกต์ ไม่ใช่ global) · รูปแบบ: **what happened / root cause / correct behavior**
"correct behavior" ต้องเป็นสิ่งที่ทำได้ทันที ไม่ใช่ความรู้สึก · ห้ามใส่ secret, ID จริง หรือข้อมูลผู้ใช้ — repo นี้ public

## Lessons

### 2026-10-27 — ใส่ class ของเมนูเดิมซ้ำเพื่อยืมสไตล์ แล้ว browser suite บน dev ล้ม 3 ชุด
- **What happened:** PR #405 ให้เมนู "ห้อง" ใหม่ใช้ `class="tt-table-options tt-room-menu"` เพื่อยืมสไตล์ popover · PR เข้า dev รันแค่ชุดเร็วจึงผ่าน · หลัง merge (`5e4d986`) browser suite node + Workers 1/2 + 2/2 ล้มด้วย `strict mode violation: locator('.tt-table-options') resolved to 2 elements` · CD007 ถอย staging กลับ `a127dc5` เอง และเปิด issue #406
- **Root cause:** เทสต์หาเมนู ⋯ ของโต๊ะด้วย `.tt-table-options` (`tests/cloudflare-browser.mjs`, `tests/generic-table-browser.mjs`, `tests/tabletop-r1.mjs`) · class ที่เทสต์ใช้เป็น selector จึงต้องมีอันเดียวในหน้า แต่ไม่ได้ `git grep` ใน `tests/` ก่อนนำ class ไปใช้ซ้ำ
- **Correct behavior:** ก่อนใส่ class เดิมให้ element ใหม่ ให้รัน `git grep -n "<class>" -- tests scripts` ถ้าเทสต์ใช้เป็น selector ให้ทำ class ของตัวเองแล้วคัดลอกสไตล์ · งาน UI ที่เปลี่ยน header/เมนูของโต๊ะ ให้รัน `npm run test:r1:browser` และ `TT_WORKERS_PART=1 npm run test:cloudflare:browser` ในเครื่องก่อน merge เพราะ PR เข้า dev ไม่รัน browser suite

### 2026-10-26 — สคริปต์พิมพ์แชทไปเขียนทับคำบรรยายรูปของผู้ใช้บน staging
- **What happened:** ตอนส่งข้อความเข้าแชทโต๊ะบน staging ด้วย `document.querySelector('textarea')` + native setter สคริปต์ไปเจอช่อง caption ของการ์ดรูป (F073) ก่อนช่องแชท แล้วกด Enter ทำให้คำบรรยายรูปที่ผู้ใช้แปะไว้ถูกบันทึกทับ · ค่าเดิมไม่มีใน log ต้องเดาจาก screenshot ว่าเป็นค่าว่างแล้วล้างกลับ
- **Root cause:** การ์ด note/รูปบน canvas ก็เป็น `<textarea>` และอยู่ก่อนช่องแชทใน DOM · selector กว้างเกินไป และไม่ได้อ่านค่าเดิมเก็บไว้ก่อนเขียน
- **Correct behavior:** เลือกช่องแชทด้วย `textarea:not(.tt-note__text)` แล้วเช็ค `placeholder === 'Ask, add something, or change this table'` ก่อนเขียน · ก่อนแตะข้อมูลบนโต๊ะที่คนอื่นใช้ ให้ดึง `/api/workspaces/<id>` เก็บ `notes` ไว้ใน scratchpad ก่อนเสมอ

### 2026-10-26 — run บน dev ขึ้น `cancelled` เป็นเรื่องปกติ ไม่ใช่ failure
- **What happened:** หลาย commit บน `dev` มี run ที่จบด้วย `cancelled` (เช่น `ad8930a`, `a400496`) ขณะที่ staging รายงาน sha เก่ากว่า ทำให้ดูเหมือน CI/deploy ค้าง
- **Root cause:** workflow ใช้ concurrency กลุ่มเดียว (CD002: run บน `dev` อาจกำลัง deploy staging รวม D1 migration) ⇒ merge ใหม่ทำให้ run เก่าถูกยกเลิก และ staging deploy ผูกกับ run ที่ชนะเท่านั้น
- **Correct behavior:** อ่านผลของ **commit ที่เป็น head** และดู run ล่าสุด ไม่ตีความ `cancelled` เป็นแดง; ถ้าจะยืนยัน deploy ให้เทียบ `/version` ของ staging กับ sha ของ dev แล้วรอ run ของ head จบ (rerun ด้วย SHA เดิมได้เมื่อจำเป็น)


### 2026-10-26 — dev CI แดงเพราะเทสต์เบราว์เซอร์เดิม flaky (ไม่ใช่ F080)
- **What happened:** run `40261590989` (commit `69ea166`, merge ของ F080-G2-02) จบด้วย `failure`; job `Account multiplayer and AI browser acceptance on Workers` ล้มที่ step 8 ด้วย `ExpectError: expect(locator).toHaveAttribute(expected) failed` สองครั้งติด (ล้มแล้ว retry ก็ล้ม) จึงทำให้ `local-validation` fail ตาม
- **Root cause:** เป็น flake ของ suite เบราว์เซอร์เดิม (account multiplayer / AI บน Workers) ไม่ใช่ไฟล์ที่ F080 เพิ่ม — commit ถัดไปบน `dev` (`4db0727`) มีโค้ดชุดเดียวกันและผ่าน
- **Correct behavior:** ก่อนสรุปว่า merge ทำให้ dev แดง ให้เปิด jobs ของ run (`gh api repos/.../actions/runs/<id>/jobs`) ดูว่าจบ job ไหน/step ใด แล้วดึง log ด้วย `gh api --allow-escape-sequences .../jobs/<jobId>/logs`; ถ้าเป็น `toHaveAttribute` ใน suite เบราว์เซอร์เดิม ให้ถือเป็น flake ที่ต้องเก็บ ไม่ใช่ rollback งานที่ merge แล้ว


### 2026-10-26 — Wait for rendered state before advancing an animation clock
- **What happened:** the local hero rotation check passed, but the first Linux release browser job saw sales instead of learning at its frozen-clock boundary. The decoded image could report complete before React processed its load state and installed the rotation timer. The authored adventure roll also initially showed a result without updating the named character's existing row; independent review caught that disconnect.
- **Root cause:** readiness was inferred from one lower-level signal rather than the state change under test; visual control output was checked without its linked table readback.
- **Correct behavior:** wait for decoded image readiness, drive the browser frames needed for React's load/effect work, then assert both sides of the 18-second interval with a documented frame tolerance. Inspect pre-action and resolved frames together: Mira's roll result and her table initiative must agree. Keep raw failed jobs and measured UI-gate limits in the evidence.

### 2026-10-26 — Shared CLI identity can change after preflight
- **What happened:** a merge attempt was denied because the active CLI account no longer matched the repository owner verified earlier in the turn. No merge occurred under that identity.
- **Root cause:** the shared CLI's active account changed between initial verification and the later write; the actor that changed it is unknown.
- **Correct behavior:** for GitHub writes, use a process-scoped token from the expected already-authenticated account, verify `gh api user` and the target repository immediately before writing, and let that process environment expire. Do not print the token or switch the shared default account.
### 2026-10-26 — บัญชี gh ที่ active ผิด ทำให้ merge ไม่ผ่าน (ไม่ใช่ ruleset)
- **What happened:** merge PR #305 และ #307 สำเร็จ แต่ PR #308 ถูกปฏิเสธด้วย `does not have the correct permissions to execute MergePullRequest`, REST merge ตอบ 404 และ `collaborators/.../permission` ตอบ 403 — ทั้งที่ `mergeStateStatus` เป็น CLEAN และ `local-validation` เขียว
- **Root cause:** `gh auth status` มีสองบัญชีในเครื่อง (Thanyers = งานส่วนตัว, Patcharrr = งานออฟฟิศ) และ active account เป็น **Patcharrr** ซึ่งมีสิทธิ์เพียง `pull` บน `Thanyers/tabletop` (`permissions.push = false`) ⇒ token ใช้ได้แต่ไม่มีสิทธิ์เขียน repo นี้
- **Correct behavior:** ก่อนเขียน repo นี้ ให้ `gh auth switch --user Thanyers` แล้ว `gh auth setup-git` และยืนยันด้วย `gh api repos/Thanyers/tabletop --jq .permissions.push` ต้องเป็น `true`; ถ้าเจอ "does not have the correct permissions" ให้สงสัยบัญชีก่อน ruleset และห้ามใช้ `--admin` หรือ force push เพื่อข้าม

### 2026-10-25 — Correct assets can still tell the story in the wrong order
- **What happened:** the homepage opened a café case and its film before explaining the tools-to-software idea; README opened a learning animation before that idea. Repeated authoring labels interrupted both.
- **Root cause:** sections were added where they were implemented instead of in the order a new reader needs them.
- **Correct behavior:** read the page as definition → reason/problem → concrete evolving case → broader uses → next action. Put each visual beside its subject, keep one clear sample disclosure, and remove production-process labels from the product story. Check actual DOM order and existing language/auth/demo contracts before release.


### 2026-10-24 — A thesis needs visible change, not generic object photos
- **What happened:** the public homepage left the hero without a visual, opened its example on an empty board, and used ordinary tool photos to explain personal adaptation. The user could not see what had changed to fit the person.
- **Root cause:** the copy described adaptation but the pictures only identified objects; navigation also sent visitors to README instead of completing the product story on the page.
- **Correct behavior:** show the need, the added grip/support/control, and its effect together. Put a meaningful Canvas visual in the hero, start examples with useful context, and keep README on GitHub as its own complete entry point. Check the rendered first viewport before calling the narrative ready.

### 2026-10-24 — Accepted homepage copy left stale browser assertions
- **What happened:** F077 passed fast PR checks but full dev/release validation failed while searching for the previous English homepage heading; the captured page showed the accepted new heading.
- **Root cause:** the homepage review covered behavior and local illustration but did not update the existing Workers browser contract for English/Thai copy and learning-story markup.
- **Correct behavior:** when landing copy or structure changes, search the existing browser suites for old strings/selectors, retain auth/language/navigation/reduced-motion assertions, and run the affected suite before release. Do not weaken assertions or change approved copy to satisfy an obsolete expectation.

### 2026-10-24 — Release-cut marker assumed LF line endings
- **What happened:** the release-cut script reported that CHANGELOG had no Unreleased heading on a Windows checkout, although the heading was present.
- **Root cause:** its exact marker includes an LF newline and the working file used CRLF.
- **Correct behavior:** before cutting on Windows, normalize only CHANGELOG line endings to LF, run the standard cut script, and verify the diff preserves all previously cut release sections. No release heading should be added manually as a workaround.

### 2026-10-24 — Fixing an unclear metaphor erased the product thesis
- **What happened:** replacing abstract tools with a cafe order-slip intro made F077 open on a use case and lost the original general story; technically valid TTS was judged flat by the user.
- **Root cause:** optimized local clarity and measured audio timing without preserving the concept-to-problem-to-reversal arc or evaluating spoken delivery.
- **Correct behavior:** establish tools adapting to people with recognizable additive examples, explain the software friction and Tabletop reversal, then show a case. Keep a separate delivery check for voice energy and naturalness; waveform checks cannot pass that criterion. Honor the explicit plain white/logo-only ending.

### 2026-10-24 — Intro เครื่องมือและคลิปเงียบยังสื่อไม่ครบ
- **What happened:** ผู้ใช้ไม่เข้าใจรูปเครื่องมือในintro F077และต้องอ่านทุกอย่างเองเพื่อเข้าใจคลิป
- **Root cause:** ใช้รูปสัญลักษณ์แทนการกระทำ และจัดเวลาให้ครบ60วินาทีก่อนมีเสียงเล่าเรื่อง
- **Correct behavior:** เปิดด้วยการใช้เครื่องมือและปัญหาที่มองเห็นได้ เขียนบทพูดก่อนจับเวลา ใช้เสียงจริงกำหนดจังหวะภาพและช่วงพักดูผล; ไม่บังคับความยาวเมื่อผู้ใช้ยกเลิกข้อจำกัดเวลา


### 2026-10-24 — UI gate ผ่านแต่ Send/Review ยัง throw
- **What happened:** F077หน้าpreviewผ่านgenericUIgate แต่flowหลายขั้นของSend/Reviewมีnull-queryก่อนอัปเดตคำขอและผล
- **Root cause:** HTMLdraft-summaryไม่มีspanภาษาไทย/อังกฤษที่renderคาดไว้; genericinteractiongateไม่ได้ทำครบห้าบท
- **Correct behavior:** ตรวจflowจริงตั้งแต่คำขอ→ส่ง→ตรวจ→ใช้และconsoleerrors พร้อมอ่านผลทุกช่วงหลังแก้; แยกผลfullUIgateออกจากscenarioacceptanceเสมอ

### 2026-10-24 — ภาพการ์ดเพิ่มไม่เท่ากับเรื่องเครื่องมือปรับเข้ากับคน
- **What happened:** ร่าง F077 รอบ 2 มีบอร์ดที่เพิ่มการ์ดและเปลี่ยนตัวเลข แต่ผู้ชมไม่เห็นว่าคนเจอปัญหาอะไรหรือพิมพ์ขอให้ปรับอย่างไร
- **Root cause:** วาง timeline จากรายการความสามารถและ transitions แทนเหตุการณ์ในชีวิตคนใช้; คำขอแรกค้างอยู่ ขณะที่การเปลี่ยนถัดไปเกิดเอง
- **Correct behavior:** ก่อนทำแต่ละ beat เขียนสี่ช่องให้ครบ: ปัญหาหรือความต้องการ / ข้อความที่คนพิมพ์ / การเปลี่ยนเครื่องมือหลังส่งและตรวจ / การลงมือใช้ที่เห็นผล โดยของเดิมยังอยู่ ตรวจเฟรมก่อนส่งและหลังใช้คู่กัน; ห้ามนับการเพิ่มการ์ดโดยไม่มีคำขอเป็นหลักฐานว่าเล่า evolution ชัดแล้ว
### 2026-10-24 — Optional skipped ancestors suppressed staging after successful validation
- **What happened:** dev `694d556` passed full validation, but staging was SKIPPED after F078-T3 added optional focused jobs upstream of the final validation job.
- **Root cause:** GitHub propagates skipped jobs through dependency chains; the downstream deployment condition had no explicit status function, so the default success evaluation suppressed it despite `local-validation` succeeding.
- **Correct behavior:** use explicit non-cancelled status evaluation together with push/dev and successful validation guards on staging. Verify the hosted staging job is successful and read back its exact source SHA; a successful overall validation run alone does not prove deployment.

### 2026-10-24 — Union merges retained conflicting task-status rows
- **What happened:** integrating parallel F078 PRs left repeated PLAN rows with both review and done states for the same task.
- **Root cause:** `merge=union` preserves independent additions but cannot reconcile task identity or newer status.
- **Correct behavior:** after each merge, list the task IDs touched by both branches, keep one authoritative active row per ID, and remove completed rows according to PLAN's board rule. Preserve completion evidence in spec, the feature document and PRs before committing.

### 2026-10-24 — Focused browser gate exposes an immediate prefill read race
- **What happened:** the new F078-T3 Linux gate sometimes read `Change this rule` immediately after requesting the exact runtime-switch prompt, while the same code passed other runs.
- **Root cause:** the test read the textarea before React applied the parent prefill effect. A fixture-only manual hold reproduced the old value and controlled release produced the exact requested prompt.
- **Correct behavior:** await the exact expected textarea value, then assert the full prompt; preserve reference/onSend/navigation checks. Keep the controlled red/release probe in the synthetic fixture, avoid arbitrary sleeps and do not change production behavior to repair harness timing.

### 2026-10-24 — npm peer resolver fails while adding narrow dependency overrides
- **What happened:** npm 10/11 threw an internal `edgesOut` error when regenerating the lockfile for compatible F078-T0 patches; the old lock remained unchanged.
- **Root cause:** the failure was inside npm's peer-set resolution; the exact internal cause is unverified. The same manifest resolved with npm 12.2.1.
- **Correct behavior:** use a scoped compatible npm invocation to regenerate the lock without global configuration changes, inspect changed package versions, then verify ordinary project `npm ci`, audit, unit/Worker tests and build before committing. Do not use broad `audit fix --force` or bypass the advisory gate.

### 2026-10-23 — คำถามอ้างกฎถูกค้นหาการ์ดรับไปก่อนส่ง
- **What happened:** Askรายกฎล้างข้อความแต่ไม่มีassistant job; exactคำถามลงท้ายตรงไหนเปิดRulesแทน
- **Root cause:** TableChat.submitเรียกcanvas object finderก่อนonSend และfinderตี WHERE_TH+aliasกฎเป็นnavigationโดยไม่ดูselected references; ไม่ใช่หลักฐานว่าproviderค้างหรือการทดสอบหลายแท็บเป็นสาเหตุ
- **Correct behavior:** ให้references/explicit Changeมีpriorityเหนือlocalnavigation ตรวจrenderedsubmit/onSendกับfinderจริงและfreshassistantGET ไม่ใช้composerclearเป็นหลักฐานว่าserverรับงาน; เก็บordinaryunreferencedopenrulesให้ทำงานเดิม

### 2026-10-23 — Cloudflare Containers prepare ตอบ internal error ชั่วคราว
- **What happened:** full validation ของ dev ผ่าน แต่ staging deploy หลังอัปโหลด image ล้มด้วย Cloudflare internal error
- **Root cause:** ยังไม่ยืนยันสาเหตุภายในบริการ; ไม่มีหลักฐานว่าเกิดจาก source/config ของ candidate
- **Correct behavior:** เก็บ run/attempt/ขั้นที่ล้ม แล้ว retry เฉพาะ failed deploy ด้วย SHA เดิมก่อนแก้ dependencies; run 39970589793 attempt2 ผ่านและ /version เป็น16de683 ปิด auto failure issue255หลังตรวจผลจริง ไม่เรียก attempt1 ว่าPASS

### 2026-10-23 — ฟอร์มบน canvas แสดงพรีวิวก่อน commit
- **What happened:** QA กรอกคิวกาแฟแล้วเห็นยอดพรีวิว3/5/8 แต่วัด GET ที่มีหนึ่งคำสั่งสำเร็จ จนเกือบสรุปว่าบันทึกหาย
- **Root cause:** form simulation เปลี่ยนภาพเมื่อกรอกข้อมูล และปุ่มที่ถูก clip นอกมุมมองอาจไม่ได้รับ click; ไม่มี positive acknowledgement ของทุก submit
- **Correct behavior:** ใช้ Objects เปิดและจัดการ์ดให้เห็นปุ่มจริง ตรวจ Applying→idle/Done และ fresh authority readback ทีละคำสั่งก่อนทำต่อ; พรีวิว/คลิกที่ไม่เกิดผลไม่ใช่หลักฐานว่า server รับคำสั่ง แล้วค่อยพิจารณา persistence defect จาก accepted response ที่สูญหาย


### 2026-10-23 — Replace เปลี่ยน row IDs ที่กฎยังอ้าง
- **What happened:** preview CSV ถูกต้องแต่ Replace ของโต๊ะคะแนนล้มเมื่อ controls อ้าง ID เก่า; รอบแก้แรกยังปิด Append และครอบคลุมเฉพาะ canvas
- **Root cause:** สร้าง ID ใหม่ทุกแถวโดยไม่รักษา identity ของรายการ และใช้ guard ร่วมสองโหมดโดยไม่ครอบ action expressions
- **Correct behavior:** ให้ผู้ใช้เห็นและยืนยันฟิลด์จับคู่ ตรวจ unique/nonempty ทั้งสองชุด สแกน fixed references ทั้ง program และ validate ก่อน commit; ต้องมี regression เรียงแถวใหม่, action-only/no-canvas, missing/duplicate แบบ atomic และ rendered Append ก่อนยืนยัน Replace

### 2026-10-23 — ตัวอย่าง prompt อ้าง source สมมติบนโต๊ะไม่มีไฟล์
- **What happened:** ร่าง SciPy และ DAG บน production ถูก citation validator ปฏิเสธเพราะ source ไม่มีจริง; การชี้แจงให้ evidence ว่างช่วยให้ SciPy สร้างต่อได้ แต่ยังไม่พิสูจน์ว่า prompt เป็นสาเหตุเดียว
- **Root cause:** prompt ทั่วไปบอกให้ evidence ว่างเมื่อไม่มีไฟล์ แต่ตัวอย่างท้ายข้อความยังมี source placeholder และ sample rows
- **Correct behavior:** ส่ง source-free guidance ตาม sources/importedSources จริง ใช้ตัวอย่าง evidence ว่าง/initialRecords ว่าง และเก็บ validator ปฏิเสธ citation ที่ไม่มีจริง; ทดสอบ prompt branch พร้อม actual retry หลัง deploy แยกจากรอบที่ล้ม

### 2026-10-23 — พิกัดเทสต์ลากหมดอายุระหว่าง pending focus
- **What happened:** CI scene dragไม่ถึง40/20แม้localผ่าน; forcedwindowยืนยันpointermoveโดนlightแต่focusfitก่อนdownทำให้downพลาด/0actions/ค่าคง20,10
- **Root cause:** เทสต์วัดgetScreenCTMก่อนpointerdownแต่ปล่อยfocus90msทำงานระหว่างคำสั่งbrowser ทำให้พิกัดscreenเก่าไม่ตรงฉาก
- **Correct behavior:** ใช้clockควบคุมpendingwindowก่อนrealdownและยืนยันevent-timehit/viewport; คงexactcoordinates/actioncount/independentshadow/cameraassertions และเก็บforcedredmodeเพื่อยืนยันrace ห้ามลดassertionsหรือแก้productioncameraจากสมมติฐาน

### 2026-10-23 — unavailable inputถูกautoqueueซ้ำทุกalarm
- **What happened:** actualstagingPythonสะสม22failedrunsของinputเดิมจนUIbusyและraweditชนrevision
- **Root cause:** orchestratorยกเว้นCOMPUTE_UNAVAILABLEจากfailedSameInputหลังจบdrain จึงqueueใหม่เมื่อมีscheduleรอบถัดไป
- **Correct behavior:** failureของinputHash/moduleversion/profile/data/rulerevisionเดิมต้องterminalสำหรับautorun; retryผ่านexplicitRunหรือinput/versionใหม่ และเพิ่มregressionเรียกscheduleหลายรอบแล้วยังมีหนึ่งrun

### 2026-10-23 — guard ย้อนสูตรทำให้ optional default ถูกข้าม
- **What happened:** ช่อง optional ใหม่ที่มี default ไม่เติมค่าให้แถวเดิมหลังเพิ่ม formula rollback guard
- **Root cause:** ใช้ validValue กับ undefined เพื่อข้ามแถวก่อนเติม default ทั้งที่ optional ยอมรับ undefined ได้
- **Correct behavior:** แยกสูตรที่คืนเป็น stored fieldเพื่อตรวจ historical equality แล้ว continue; ช่องใหม่ปกติต้องเติม declared default ทุกแถวและมี regression ของ optional/default บนข้อมูลเดิม

### 2026-10-23 — เพิ่ม assistant capability แต่ลืม strict mock ของ browser
- **What happened:** F066-T8 unit ผ่าน แต่ Workers browser ถาม Available rule แล้วได้ `MODEL_PROVIDER_HTTP_ERROR` เพราะ synthetic outbound fixture ปฏิเสธ request
- **Root cause:** เพิ่ม `computeCapabilities` ใน assistant context และปรับ unit assertion แล้ว แต่ `tests/cloudflare-browser.mjs` ยังตรวจ key set เดิม จึงกลายเป็น error ของ provider จำลอง
- **Correct behavior:** เมื่อแก้ provider payload ให้ค้น strict key assertions ใน unit และ browser fixtures พร้อมกัน เพิ่ม key และตรวจค่า capability จริงของ fixture โดยคง redaction/privacy assertions เดิม แล้วรัน Workers browser ก่อนอ้างว่าชุดรวมผ่าน
### 2026-10-23 — เปลี่ยนข้อความตัวเลือกใน UI แล้ว browser suite บน dev ล้ม staging เลยค้าง

- **what happened:** F075 เปลี่ยนข้อความ option ของช่อง "Choose a record" ผ่าน unit/CI เร็วของ PR แต่ `test:generative:browser` บน push เข้า `dev` ล้มที่ `toHaveText('0 · team-south')` (ได้ `"0"`) → ชุดเต็มไม่ผ่าน staging ไม่ deploy commit ต่อ ๆ ไป
- **root cause:** PR เข้า dev รันแค่เช็คเร็ว (ไม่มี browser suite) และผมเช็คแค่ว่าเทสต์มีข้อความเดิมอยู่ไหม โดยคิดเองว่าค่าสองแถวยังซ้ำกันตอนถึงบรรทัดนั้น ไม่ได้รันจริง
- **correct behavior:** แก้ข้อความที่ผู้ใช้เห็นเมื่อไหร่ ให้ `grep -rn "<ข้อความเดิม>" tests/*.mjs` แล้วรัน suite ที่เจอในเครื่องก่อน merge: `npm run build && npm run build:cloudflare && BROWSER_CHANNEL=chrome npm run test:generative:browser` (หรือ suite ที่เกี่ยว)

### 2026-10-23 — Docker สำเร็จแต่ Container API ปฏิเสธ instance
- **What happened:** build image และ Node/Docker integration ผ่าน แต่ Linux Workers Container API smoke ของ F066-T8 รัน Python ไม่ได้: `Invalid container instance type` ก่อนเริ่ม process
- **Root cause:** ใช้ `instance: 'basic'` จากรายการขนาดทั่วไปโดยไม่ได้รันผ่าน Durable Object API ของเวอร์ชันที่ล็อกไว้ ซึ่งรับชุดชื่อไม่เหมือนกัน
- **Correct behavior:** ใช้ `standard-1` ที่ API รองรับและรัน `node scripts/compute-cloudflare-local.mjs` ใน full CI บน Linux ก่อน deploy; แยกผล Docker, Workers emulator, capability และ hosted execution เสมอ ห้ามยก flag/build image เป็นหลักฐาน Python พร้อมใช้

### 2026-10-23 — การคลิกใน QA ต้องตรวจค่าหลัง action ที่ล้มเหลว
- **What happened:** ตอนเก็บหลักฐานคำถามเพิ่ม การเลือก checkbox บนการ์ดที่อยู่นอกมุมมองคืน error แต่มีตัวเลือกอื่นถูกเลือก เมื่อเก็บ snapshot พบว่าเช็กลิสต์กับคำตอบเองถูกส่งร่วมกัน จึงบันทึกรอบนั้นเป็น multi-answer ตามจริง ไม่อ้างว่าเลือกเฉพาะคำตอบเอง
- **Root cause:** ถือว่า action ที่ error ไม่เปลี่ยน UI และตรวจเพียงตัวเลือกเป้าหมาย หลัง layout ของการ์ดขยับ
- **Correct behavior:** ใช้ Objects เปิดการ์ดให้อยู่ในมุมมองก่อนเลือก; หลัง action ที่ error อ่านค่าของทุก checkbox ใหม่ เก็บ snapshot ของคำตอบ/ทุกค่าที่เลือกก่อน Submit และแยกหลักฐานก่อน/หลัง command ไม่ใช้ snapshot สถานะสุดท้ายแทนลำดับการทำงาน

### 2026-10-23 — staging deploy ที่ใช้ `workflow_run` ไม่ทำงานเพราะไฟล์ไม่อยู่บน default branch
- **What happened:** CD002 (#230) เพิ่ม `.github/workflows/staging-deploy.yml` แบบ `on: workflow_run` ของ Validate บน `dev` แต่ merge แล้วไม่มี run เลย และ `gh workflow run` ตอบ 404 "workflow … not found on the default branch"
- **Root cause:** GitHub เรียก workflow ที่ trigger ด้วย `workflow_run` (และ `workflow_dispatch`) จากไฟล์บน **default branch** เท่านั้น ซึ่งของ repo นี้คือ `main` · ไฟล์ใหม่ที่อยู่แค่ใน `dev` จึงไม่ถูกเรียกจนกว่าจะออก release
- **Correct behavior:** งานที่ต้องเริ่มจาก push เข้า `dev` ให้ใส่เป็น job ใน workflow ที่ trigger ด้วย `push` (เช่น `deploy-staging` ใน `validate.yml` ที่ `needs: local-validation`) · ก่อนพึ่ง `workflow_run`/`workflow_dispatch` ตรวจ `gh repo view --json defaultBranchRef` และยืนยันว่าไฟล์อยู่บน branch นั้นแล้ว
### 2026-10-23 — dropdown บน Windows เป็นกล่องดำขยายค้าง เพราะเมนู `<select>` ถูกวาดโดยหน้าต่าง OS
- **What happened:** ผู้ใช้กด `Sort` บน `/tables` แล้วมีกล่องดำโผล่และขยายจน browser ค้าง · เกิดกับ dropdown ทุกตัว · เครื่องที่ตั้ง display scaling 125%
- **Root cause:** ที่ scaling ≠ 100% Chromium ส่งเมนู `<select>` ให้หน้าต่าง OS แยกวาด ไม่ได้วาดในหน้า · วัดได้ว่า `select:matches(':open')` เป็น true แต่ `<option>` มี rect 0×0 และภาพที่ renderer วาดไม่มีเมนู ขณะที่ 100% เมนูอยู่ในหน้าและไม่มีอาการ
- **Correct behavior:** ให้ `@supports (appearance: base-select)` เปิด customizable select ใน `src/tabletop/ui/tabletop.css` (เมนูถูกวาดในหน้าเสมอ) และ **อย่า** ใส่ `min-inline-size: max-content` ให้ select ทั้งแอป — `min-width` ชนะ `max-width: 100%` ทำให้ select ใน card แคบล้น (วัดได้ 277.7 px ใน card 150 px) · ตรวจซ้ำด้วย harness ที่ `deviceScaleFactor` 1.25 และดู rect ของ `<option>` ว่าไม่เป็น 0

### 2026-10-23 — ขยายงาน compute/Rules ไปไล่ scene/camera หลัง merge
- **What happened:** หลังงานหลักผ่าน PR validation และรวม dev แล้ว ใช้เวลาตรวจ generated-scene drag failure ในชุดรวมต่อจนผู้ใช้ทักว่านอกเรื่อง
- **Root cause:** ถือว่าต้องแก้ทุก failure หลัง merge ทั้งที่ขอบเขตผู้ใช้คือ reusable compute/Rules และความพร้อมบนเว็บยังแยกจากสถานะ release
- **Correct behavior:** แยก failure ที่เกิดจากงานตนและ failure ส่วนอื่นก่อนลงมือ เก็บเทสต์ capability ที่งานตนเปลี่ยนให้ถูก รายงาน CI ส่วนอื่นตรงตามผลจริง และหยุดการแก้ runtime นอกขอบเขตเมื่อผู้ใช้ย้ำขอบเขต อย่าทำให้คำว่า feature ยังไม่ release กลายเป็นข้ออ้างเปิดงานแก้ส่วนอื่น

### 2026-10-23 — เพิ่ม compute capability แต่ browser ยังตรวจจำนวนและชื่อช่องว่างเดิม
- **What happened:** full CI หลัง #208 ล้มที่ Rules capability summary เพราะคาด 8 capabilities แต่ของจริงมี 9 และชื่อ gap ของ stored relations เปลี่ยนแล้ว
- **Root cause:** เพิ่มรายการ compute และแก้ copy หลัง browser suite ในเครื่องรอบก่อนหน้า แต่ไม่ได้ปรับ assertion สองจุดตามกัน
- **Correct behavior:** เทียบจำนวนบน UI กับ `/api/capabilities` และยืนยันรายการใหม่ `compute` กับข้อความ Reusable calculations โดยตรง พร้อมตรวจ gap ที่ยังมีจริง รัน browser suite หลังเปลี่ยน catalog/copy ที่ใช้ใน Rules ก่อน merge

### 2026-10-23 — มาตรวัด AI context ไม่รวม capability ที่ backend เติม
- **What happened:** หลังรวม F067 กับ reusable compute เทสต์ payload equality ใน CI ได้ 2,338 bytes แต่ UI helper นับ 2,236 bytes
- **Root cause:** ทั้งสองใช้ตัวสร้างส่วนโต๊ะร่วมกันแล้ว แต่ backend เติม `computeCapabilities` ภายหลังโดย UI ไม่ได้รับข้อมูลชุดนี้
- **Correct behavior:** ส่ง capability ที่เปิดจริงผ่าน endpoint ใช้ตัวสร้าง payload เดียวกันทั้ง provider และมาตรวัด รวม metadata ที่รู้ก่อนส่ง และคงเทสต์เทียบ bytes จริงไว้; research/repair ที่รู้ภายหลังให้ระบุขอบเขตและตรวจเพดานที่ backend หลัง merge งานที่แตะ contract เดียวกันต้องรันชุด Cloudflare อีกครั้งก่อน push

### 2026-10-23 — Browser harness ใช้ assets เก่าแล้ว build ลบไฟล์ระหว่างทดสอบ
- **What happened:** browser suite นำทางเข้าห้องใหม่แล้วได้ HTTP response failure หลัง suite เริ่มผ่านหลายข้อ
- **Root cause:** สั่ง Vite build ระหว่าง Miniflare harness ยังทำงาน; asset manifest ของ process เดิมชี้ไฟล์ที่ build ใหม่ลบไป
- **Correct behavior:** รอ browser processes จบก่อนสร้าง `dist/worker-build` ใหม่ จากนั้นเริ่ม harness ใหม่กับ build ชุดเดียวที่คงที่จนจบ รัน browser suites ขนานกันได้เฉพาะเมื่อทุก suite อ่าน artifacts อย่างเดียว

### 2026-10-23 — Compute ผ่าน runner/unit แต่เส้นทางห้องจริงไม่เริ่มงาน
- **What happened:** โปรแกรมจาก AI รันใน container โดยตรงได้ แต่ authority ไม่จัดคิวหรือจบด้วย failure ก่อนเรียก runner
- **Root cause:** ช่วงแรกผูก durable job กับ HTTP session และส่งค่า CSRF ที่ hash แล้วเข้า raw-value comparison อีกครั้ง; mocks ไม่ตรวจ authentication จริง อีก race คือ schedule ทิ้ง wakeup ที่มาตอน drain กำลังจบ
- **Correct behavior:** ตรวจ session ตอนรับคำขอ; งานที่รับแล้วใช้ actor/membership/permission/epoch ที่ตรวจใหม่ก่อนรันและก่อน commit ตาม [durable-job policy](docs/REUSABLE_COMPUTE.md) ไม่เก็บ token ใน run ทดสอบผ่าน HTTP authority จริงรวม restart/alarm และเก็บ dirty flag เพื่อ drain อีกครั้งเมื่อมีสถานะเปลี่ยนระหว่างงานกำลังรัน หากใช้ raw-value hash helper ใน request path ต้องส่ง raw token ไม่ใช่ hash
### 2026-10-23 — F066 merge แล้ว Worker บูตไม่ขึ้น ทั้งที่ unit test และ CI ผ่าน
- **What happened:** หลัง #212 merge emulator ล้มตอน start ด้วย `Uncaught ReferenceError: TABLE_AI_INPUT_BYTES is not defined` · `test:cloudflare` 158/158 และ CI เขียว
- **Root cause:** ค่าคงที่ระดับ module (`MAX_CHANGE_REQUEST_BYTES = TABLE_AI_INPUT_BYTES + …` ใน provider, `MAX_INPUT_TOKENS` ใน billing) อ่าน export จาก `domain/table.ts` ซึ่งอยู่ในวงจร import ของ bundle Worker จึงยังไม่ถูกตั้ง · vitest โหลด module คนละลำดับ และ CI ของ PR เข้า `dev` ไม่บูต Worker (ชุด browser ถูก skip)
- **Correct behavior:** ค่าคงที่ที่ module อื่นอ่านตอนโหลด ให้อยู่ใน leaf module ที่ไม่ import อะไร (เช่น `src/tabletop/shared/ai-request-limits.ts`) · หลังแก้ไฟล์ใต้ `cloudflare/` หรือ `server/providers/` ให้บูต Worker จริงก่อนเปิด PR: `npm run dev:cloudflare` แล้วรอเห็น `Ready on http://127.0.0.1:8787` (หรือดู terminal ของ emulator ที่รันอยู่ว่า reload แล้วไม่มี `✘ [ERROR]`)

### 2026-10-23 — DSH plugin นอก linked profile หา SDK ไม่พบ และ hook context อาจตัดกติกาท้ายไฟล์
- **What happened:** absolute module จาก home patch import `@deepseek-ai/dsh-llm` แบบ bare ไม่สำเร็จ; AGENTS เดิมยาวเกินงบ additionalContext ของ Claude
- **Root cause:** module นอก linked package ไม่ร่วม peer resolution ของ profile และ Claude ส่ง context เกิน 10,000 ตัวอักษรเป็น preview
- **Correct behavior:** รัน `npm run agents:setup` เพื่อใช้ SDK instance ของ runtime ที่ติดตั้งจริงและตรวจ import/composition ก่อนเปิดใช้; รัน `npm run test:agents` เพื่อกัน AGENTS โตเกินงบ เก็บรายละเอียดปฏิบัติการที่ [AGENT_OPERATIONS](docs/AGENT_OPERATIONS.md) ตาม pointer ใน AGENTS

### 2026-10-23 — ตรวจ UI แล้วฟิลด์ใหม่ไม่ขึ้น ทั้งที่ typecheck/build ผ่าน เพราะพอร์ต 4310 เป็นของ checkout อื่น
- **What happened:** เปิด Playwright ตรวจหน้า `/tables` หลังเพิ่ม `createdAt`/`updatedAt`/`updatedBy` แล้ว `/api/session` ยังคืนเฉพาะ id/title/kind/role · log ของ server ที่เพิ่งสตาร์ทมี `EADDRINUSE` แต่ตรวจ `/api/capabilities` ได้ 200 จึงดูเหมือนปกติ
- **Root cause:** มี process `node --import tsx server/bootstrap.ts` จากอีก checkout จับ `127.0.0.1:4310` อยู่ก่อน (สร้าง 09:04) · `vite.config.ts` proxy `/api` ไป 4310 ตายตัว จึงคุยกับโค้ดเก่า ไม่ใช่โค้ดที่เพิ่งแก้ · อีกสองกับดักที่เจอพร้อมกัน: Playwright ใน repo คาด chromium รุ่นที่ไม่ติดตั้ง (ใช้ `channel:'msedge'`) และ `waitUntil:'networkidle'` timeout กับ Vite dev เพราะ HMR websocket
- **Correct behavior:** ก่อนตรวจ UI ให้รัน `Get-NetTCPConnection -LocalPort 4310 -State Listen` แล้วดู `OwningProcess`/`CreationDate` ว่าเป็น process ของเราหรือไม่ · ถ้าไม่ใช่ ให้สตาร์ท server แยกด้วย `startTabletopServer({ port, dataDir, staticDir: 'dist' })` (หรือ `TABLETOP_PORT` ถ้ามี) บนพอร์ตอื่น แล้วยิง Playwright ตรงที่พอร์ตนั้น ไม่ผ่าน Vite · ใช้ `chromium.launch({ channel: 'msedge' })` และ `waitUntil: 'domcontentloaded'` + `waitForSelector` แทน `networkidle`

### 2026-10-22 — browser test ที่หาการ์ดด้วย "ชื่อการ์ด" แดงทั้งที่แอปถูก
- **What happened:** หลัง merge `dev` (1f21aeb "tidy titles of referenced chat cards") browser suite แดงที่ `requestClarifyingQuestion`: `expect(questionArticle).toHaveCount(0)` ได้ 1 · ดูเหมือน "การ์ดคำถามไม่ถูกแทนหลังตอบ" แต่ตรวจ DOM + localStorage พบว่าการ์ดเก่าถูก dismiss จริง (`dismissed: [<job เดิม>]`) เหลือการ์ดใบเดียวคือ job ใหม่
- **Root cause:** `chatCardTitle` ตัดชื่อการ์ดเหลือ **บรรทัดแรก** ของ prompt หลัง 1f21aeb · การ์ดคำถาม ("Make a shift table.") กับการ์ดคำตอบ (prompt เดิม + คำถาม clarify + คำตอบ) จึงมีชื่อเดียวกัน ⇒ locator `getByRole('article', { name: 'Make a shift table.' })` ไปจับการ์ดใบใหม่ ไม่ใช่ใบเก่า
- **Correct behavior:** หาการ์ดแชทด้วย id ไม่ใช่ชื่อ — เอา job id จาก response ของ `POST /model` แล้วใช้ `article[data-canvas-object="table.chat.<jobId>"]` (ตรงกับ `sharedChatCanvasId`) · ถ้าต้องตรวจชื่อการ์ด ให้ assert `aria-label` แยกเป็นข้อของมันเอง · ก่อนสรุปว่าเป็น regression ของแอป ให้ dump DOM/localStorage/`GET /model` ก่อน 1 รอบ (ตามที่ทำในงานนี้) แล้วเทียบ baseline

### 2026-10-22 — การ์ดที่ auto-apply แล้ว "หายเงียบ" แม้เทสต์ผ่านหมด
- **What happened:** ผู้ใช้รายงานว่าหลังร่างกฎผ่านทุกขั้นและถูกเปิดใช้ การ์ดหายไปเฉย ๆ ทั้งที่ `npm test`/`test:cloudflare`/browser suite เขียวหมด · สาเหตุคือ #156/#157 ตั้งใจเอาการ์ดออก (`isFinishedResult` → `displayCards`) แล้วแทนด้วยแถบ "New rules added" 15 วินาที แต่แถบนั้นถูกยิงจาก effect ที่ต้อง "เห็นการ์ดตอน phase sending/waiting" ก่อน — ถ้าการ์ดจบเร็วจนไม่เคยRender สถานะรอ หรือหน้านั้นเพิ่งเปิด/เป็นสมาชิกคนอื่น การ์ดจะถูกกรองออกโดยไม่มีแถบแทน
- **Root cause:** การลบ element ออกจาก UI (filter) ผูกกับสัญญาณทดแทน (notify) คนละเงื่อนไข: filter ใช้ `isFinishedResult(card)` ส่วน notify ต้องมี `watchedCardsRef.has(card.id)` · เทสต์ยืนยันแค่ "การ์ดหาย" + "แถบโผล่" ในเส้นทางที่ดูสถานะรอทัน จึงไม่จับเส้นทางที่การ์ดจบก่อนถูกRender
- **Correct behavior:** เวลาจะซ่อน/ลบการ์ดด้วย filter ให้ผูกสัญญาณทดแทนด้วยเงื่อนไขที่กว้างกว่าเสมอ เช่น `createdAt >= mountedAt` (การ์ดที่เกิดหลังเปิดหน้า = ต้องแจ้ง) ไม่ใช่เฉพาะใบที่เคยเห็นสถานะรอ · และเขียนเทสต์ของเส้นทาง "จบเร็ว/เปิดหน้าทีหลัง" แยกอีกใบ · ตรวจด้วย `BROWSER_CHANNEL=msedge npm run test:cloudflare:browser`

### 2026-10-22 — release 5.1.0: ปัญหาที่ dev ไม่เห็นเพราะ browser suite รันแค่ตอน release
- **What happened:** release PR #152 ล้ม 2 เรื่องที่ merge เข้า dev ไปแล้วโดยไม่มีใครเห็น (1) #144 เอาป๊อปอัป "Move … without dragging" ออกแต่ browser suite ยังกด (2) เคส F038 ล้มบน CI เพราะการ์ดคำขอร่างกฎของสมาชิกหาย — เป็นบั๊ก server จาก F034-T3: `runModelJob` สร้าง `initialData` ไม่มี `prompt` แล้ว commit/finish เขียนทับ `data` ทั้งก้อน ร่างที่เสร็จจึงไม่มี prompt และ client ทิ้งการ์ดหลัง reload
- **Root cause:** CI005 รัน browser suite แค่ PR เข้า `main` · บั๊ก (2) ซ่อนอยู่เพราะในเครื่องและใน CI ของ 4.4.0 สมาชิก reload ทันตอนงานยัง running (แข่งเวลา) · งานที่เขียนทับ `data` ด้วย object ใหม่ทิ้ง field ที่ `reserve*` เคยเก็บ
- **Correct behavior:** PR ที่เปลี่ยน UI ที่ browser suite ใช้ (ปุ่ม/ป้าย/role) ให้รัน `npm run test:cloudflare:browser` ในเครื่องก่อน merge เข้า dev · เทสต์ "สมาชิกเห็นการ์ด" ให้ตรวจหลัง reload ด้วย ไม่ใช่แค่ตอน running · ถ้าเทสต์ผ่านในเครื่องแต่ล้มบน CI ให้ลอง `CI=true BROWSER_CHANNEL=chromium` + CPU throttle (`Emulation.setCPUThrottlingRate`) ก่อนสรุปว่า flaky · update/finish ที่เขียน `data` ใหม่ทั้งก้อน ต้องพก field ที่ reserve เก็บไว้ (เช่น `prompt`) ไปด้วย

### 2026-10-22 — แถบแจ้งเตือนที่ auto-apply กฎมีปุ่มที่ header บังการคลิก
- **What happened:** หลัง merge #156/#157 การ์ดที่ auto-apply แล้วกลายเป็นแถบ `.tt-notice--success` พร้อมปุ่ม **View rules** · browser suite คลิกปุ่มไม่ผ่าน 30 วินาที Playwright ฟ้องว่า `<a href="/demo">` จาก `header.tt-topbar` intercepts pointer events แล้ว element detached (แถบหมดอายุ) · ผู้ใช้ที่คลิกจริงจะกดไม่ติดใน viewport 1280×720 เช่นกัน
- **Root cause:** `.tt-topbar` (z-index 30) อยู่เหนือ `.tt-notice` (z-index 26) ใน stacking ของ layout `height:100dvh; overflow:hidden` และแถบถูกวาดในตำแหน่งที่ header ทับจุดคลิก · ปุ่มที่เพิ่งเพิ่มทำให้แถบเป็น interactive ครั้งแรก จึงเพิ่งเจอ
- **Correct behavior:** อย่า force-click ปิดบั๊ก · ในเทสต์ให้ยืนยันว่าแถบและปุ่มมีอยู่จริง แล้วเปิดการ์ด Rules ผ่านเมนู Objects แทน (`openCanvasObject(owner, 'table.rules')`) พร้อมรายงานเจ้าของ #156 · เวลาจะแก้จริง ให้ยก `.tt-notice` เป็น `position: relative; z-index: 40` (หรือย้ายแถบออกจากพื้นที่ header) แล้วรัน `BROWSER_CHANNEL=msedge npm run test:cloudflare:browser` ให้ผ่าน 2 รอบติด

### 2026-10-22 — browser suite แดงที่ check หนึ่งทั้งที่ branch งานไม่เคยแตะไฟล์นั้น
- **What happened:** `npm run test:cloudflare:browser` ล้มที่ check เดียวกันติดกัน 2 รอบ (`expected 'Draft ready for review'` ระหว่างทดสอบ AI proposal ของ encounter) ทั้งที่ F045 ไม่ได้แตะ `src/tabletop/ui/AIProposal.tsx` หรือ `tests/cloudflare-browser.mjs` · รัน suite บน tree สะอาด (`git stash -u` → build ใหม่) ก็ล้มที่ check เดียวกัน ⇒ เป็นสถานะของ `dev` ไม่ใช่ regression ของ branch
- **Root cause:** expectation รอสถานะชั่วคราว "Draft ready for review" ซึ่งเกิดเฉพาะเมื่อ job `completed` มาถึง client ก่อน auto-apply ของ F039 ปรากฏใน projection — เป็นการแข่งกันของเวลา (poll 1.2s vs WebSocket push) ไม่ใช่สัญญาที่แน่นอน · F039 เคยรายงาน 27 PASS บน Node 26.3.1 แต่บน Node 22.23.2 + msedge สถานะนี้ไม่เกิดเลย
- **Correct behavior:** เมื่อ browser suite แดง ให้รัน baseline ก่อนสรุปว่าเป็นงานเรา: `git stash push -u -m baseline && npm run build && npm run build:cloudflare && BROWSER_CHANNEL=msedge npm run test:cloudflare:browser; git stash pop` · แล้วแก้ expectation ให้ตรวจสถานะที่เกิดจริง (เช่น `dm.locator('.tt-ai-proposal__job strong')` → `Rules in use`) ไม่ใช่ลบ assertion · ห้ามสรุปว่า "flake" ถ้ายังไม่ได้เห็น baseline

### 2026-10-22 — `npm run lint` รันไม่ได้เพราะ node_modules ไม่ครบ (ไม่ใช่โค้ดผิด)
- **What happened:** ทั้ง Lead และ subagent เจอ `ERR_MODULE_NOT_FOUND: @eslint/js` จาก `eslint.config.js` แล้วเกือบรายงานว่า "lint รันไม่ได้" ทั้งที่ `@eslint/js` อยู่ใน `package.json` แล้ว
- **Root cause:** checkout นี้มี `node_modules` ไม่ครบ (ติดตั้งบางส่วน) · `npm run typecheck`/`npm test` ยังทำงานเพราะไม่ต้องใช้ ESLint
- **Correct behavior:** ก่อนข้าม lint ให้เช็ค `Test-Path node_modules/@eslint/js` · ถ้าไม่มี รัน `npm install --no-audit --no-fund` แล้วยืนยัน `git status --short package-lock.json` ต้องว่าง (lock ไม่เปลี่ยน) จากนั้นจึงรัน `npm run lint` และรายงานจำนวน error/warning จริง

### 2026-10-22 — เอกสารฟีเจอร์บอก "rollback ได้" แต่รุ่นเก่า parse ข้อมูลใหม่ไม่ผ่าน
- **What happened:** F040 doc เขียนว่า rollback ได้เพราะ "รุ่นเก่าไม่รู้จัก `motion` แต่ยังเปิดโต๊ะได้" ตอนตัด release จึงเกือบออกเป็น 4.5.0 (MINOR)
- **Root cause:** schema canvas/program เป็น `z.strictObject` — รุ่นเก่าเจอ key ใหม่แล้วปฏิเสธทั้งก้อน (`runtime/index.ts` ไม่แสดง canvas, `table-assistant.ts`/`ai.ts` ตอบ "The active table rules are invalid")
- **Correct behavior:** ก่อนตั้งเลข release ที่เพิ่ม field ใน state ที่บันทึกไว้ ให้รัน `git grep -n strictObject <tag ล่าสุด> -- src/tabletop/runtime/generative/schema.ts src/tabletop/domain/table.ts` แล้วดูว่า schema ที่รับ field ใหม่เป็น strict ไหม · ถ้า strict = รุ่นเก่าอ่านข้อมูลใหม่ไม่ได้ → MAJOR (เหมือน F005, 5.0.0)

### 2026-10-22 — release PR ล้มเพราะรันเทสต์ในเครื่องไม่ครบทุกขั้นของ CI
- **What happened:** release/4.3.0 (PR #125) ล้มที่ `demo:auto:run` (persona demos 2 ฉากคาดว่าผู้เรียน/ผู้เล่นจะถูกปฏิเสธ แต่ F035 ให้สิทธิ์ค่าเริ่มต้นแล้ว) · ก่อนหน้านั้น #120 merge เข้า dev โดยไม่ได้รัน browser suites จน `test:cloudflare:browser` บน dev พัง (แก้ใน #122)
- **Root cause:** ตรวจในเครื่องแค่ lint/unit/Cloudflare/browser 3 ชุด แต่ `validate.yml` มี `demo:auto:run`, `npm audit`, component-lab, `check-client-secrets` ด้วย · และ PR เข้า `dev` รันเฉพาะเช็คเร็ว (CI005) browser suites จึงไม่จับให้
- **Correct behavior:** ก่อนเปิด release PR ให้รันครบทุก step ของ `.github/workflows/validate.yml` ในเครื่อง: `npm audit --audit-level=high && npm run lint && npm test && node --import tsx --test scripts/component-lab/component-lab.test.ts && npm run build && node scripts/check-client-secrets.mjs && npm run test:cloudflare && npm run build:cloudflare && npm run demo:auto:run && npm run test:r1:browser && npm run test:cloudflare:browser && npm run test:generative:browser` · และ merge `origin/main` เข้า release branch ใหม่ทุกครั้งที่ main ขยับก่อน merge release · PR เข้า `dev` ไม่ต้องรันชุดเต็ม (ผู้ใช้สั่ง 2026-10-22 เพราะทำให้งานช้า) ยอมให้ regression ไปเจอตอน release

### 2026-10-21 — arm failure ครั้งเดียวใน browser test ไม่พอ เพราะแอป refresh ได้หลายครั้ง
- **What happened:** หลังแก้ CD003 (dedupe + sticky error) CI ยังล้ม `Community equipment` ด้วย `workspaceRefreshRequests=2` — GET ครั้งแรกถูก synthetic failure แต่ครั้งที่สองสำเร็จและล้าง error
- **Root cause:** route interception แบบ fail ครั้งเดียวพึ่งจำนวน refresh ที่แน่นอน; แอปมี refresh จาก POST response, poll และ retry
- **Correct behavior:** fail ทุก refresh จนกว่าเทสต์จะเห็น error UI แล้วค่อย `failRefresh = false` ก่อนกด Retry; assert แบบ `>=` ไม่ผูกจำนวนครั้ง

### 2026-10-21 — ข้อความ "refresh failed" หายเพราะ poll ที่จบแล้วล้าง pollError
- **What happened:** browser test `Community equipment` ล้มไม่คงที่; การ์ดขึ้น "A rule draft is ready" แทน "The rule draft is ready, but the table could not refresh."
- **Root cause:** `pollModelOnce` patch `pollError: undefined` ทุกครั้ง รวมถึง poll ที่ job settled แล้ว ทำให้ poll ที่มาถึงช้ากว่าการ refresh failure ล้าง error ที่เพิ่งตั้ง
- **Correct behavior:** เมื่อ job settled (completed/complete) ห้ามล้าง `pollError`; ล้างเฉพาะระหว่าง queued/running หรือเมื่อ Retry refresh สำเร็จ; รัน `npm test`, `npm run test:cloudflare`, `npm run test:cloudflare:browser`

### 2026-10-21 — browser acceptance บน CI ล้มเป็นครั้งคราว (layout/timer race)
- **What happened:** PR #55 ล้ม 3 รอบติดที่จุดต่างกัน (generative private preview ไม่อยู่ใน viewport, draft-refresh failure ของ generic table) ทั้งที่ dev CI ของ suite เดียวกันผ่าน และ test ในเครื่องผ่าน
- **Root cause:** runner 2-core ทำให้การรอ layout/animation ในเทสต์ไม่คงที่; ไม่ใช่ logic ของ branch ที่แก้
- **Correct behavior:** `validate.yml` รัน browser 3 ชุดซ้ำ 1 ครั้งเมื่อล้ม; ถ้ายังล้มให้ถือว่าแดงจริงและไล่จาก log ครั้งแรก; อย่าปิด step หรือใช้ `--no-verify` เพื่อให้ผ่าน

### 2026-10-20 — การบันทึกตำแหน่งพื้นหลังต้องไม่ล็อกแชท
- **What happened:** แชทพร้อมส่งและ AI เปิดอยู่ แต่หลังขยับการ์ด textarea กับ Send ถูกปิดจนผลบันทึกตำแหน่งกลับมา
- **Root cause:** `canvas.layout` ใช้ busy state เดียวกับคำสั่งเล่น ทั้งที่มีคิวและ revision แยกอยู่แล้ว; ผลตอบรับของ layout ยังอาจล้าง busy ของคำสั่งอื่น
- **Correct behavior:** ให้ layout ไม่ตั้งหรือล้าง foreground busy และคง queue/CAS/scope guards เดิม; รัน `npm run build`, `npm run build:cloudflare`, `npm run test:cloudflare:browser` โดยกรณี regression ต้องค้าง ACK ที่เซิร์ฟเวอร์รับแล้ว ตรวจว่า Send เปิด consent ได้ และ Cancel ไม่ส่งคำขอ AI

### 2026-10-20 — Browser harness ต้องเดินตามมุมมองปัจจุบันของ Canvas
- **What happened:** หลังรวมผังร่วม เทสต์วัดการซูมระหว่างที่ระบบยังบันทึกผังเริ่มต้น; เทสต์ Retry พยายามกดการ์ดที่พ้นจอหลังเปิดวัตถุอื่น และเทสต์ Reset กดปิดเมนูที่เปิดอยู่แล้ว
- **Root cause:** สมมติว่าผังเริ่มต้นจบแล้ว การ์ดเดิมยังอยู่ในจอ และเมนูเริ่มปิดเสมอ; ชื่อดิบ `Shared Table` อาจต่างจากชื่อโปรแกรมที่ผู้ใช้เห็น
- **Correct behavior:** รอ shared positions ก่อนเก็บ baseline, เปิดการ์ดผ่าน Objects, ตั้งสถานะเมนูตามที่อ่านได้จริง และใช้ชื่อโต๊ะที่แสดง; คง full-domain equality, zero-mutation, explicit consent และ retry payload assertions แล้วรัน `npm run test:cloudflare:browser` กับ `npm run test:generative:browser`

### 2026-10-20 — ผังร่วมต้องรองรับโต๊ะว่างและไม่เผยร่างส่วนตัว
- **What happened:** การจัดผังครั้งเดียวจำว่าเสร็จก่อนมี shared card หรือก่อนตอบรับ ทำให้การ์ดที่เพิ่มทีหลังไม่ถูกแชร์; Rules ก่อนเปิดใช้ถูกอนุญาตให้มี geometry ร่วมทั้งที่เนื้อหาร่างเป็นของเจ้าของ
- **Root cause:** ใช้ room key เป็นตัวจบการ seed แทนผลยืนยันรายวัตถุ และเลือก shared ID โดยไม่ดูว่ากฎเปิดใช้แล้วหรือยัง
- **Correct behavior:** seed เฉพาะ shared cards ที่ยังไม่มีตำแหน่งตาม scope ปัจจุบันและผลยืนยัน; เก็บ Rules ก่อนเปิดใช้เป็นส่วนตัวทั้ง UI/authority/projection แล้วรัน `npx vitest run src/tabletop/domain/canvas-layout.test.ts`, `npm run test:cloudflare:browser` และ `npm run test:generative:browser` บน bundle เดียวกัน

### 2026-10-20 — Retry แชทต้องใช้คำขอเดิม และผล refresh ต้องตรงกับผู้ใช้ปัจจุบัน
- **What happened:** การส่งที่ไม่ทราบผลอาจเกิดก่อน revision เปลี่ยน และ projection ที่โหลดช้าอาจกลับมาหลัง reset หรือเปลี่ยนผู้ใช้
- **Root cause:** ใช้ command ID เดิมแต่สร้าง body จาก view ใหม่ หรือเทียบเพียง room ID ก่อนติดตั้งผลโหลด ไม่พอสำหรับ idempotency และการแยกข้อมูล
- **Correct behavior:** เก็บ request snapshot ในหน่วยความจำเพื่อ retry ด้วย body เดิม; ตรวจ room/epoch/actor/role/seat และลำดับ projection ก่อนใช้ผล refresh แล้วรัน `npx vitest run src/tabletop/ui/table-chat-state.test.ts` กับ `npm run test:cloudflare:browser`

### 2026-10-20 — เทสต์แชทใหม่ต้องตรวจขอบเขตข้อมูลจริงและ Canvas ว่าง
- **What happened:** เทสต์เดิมคาดคำว่า current table และ ReactFlow ตั้งแต่โต๊ะว่าง ขณะที่ UI ระบุ active rules/records/turn และยังไม่มี node; copy ฝั่งถามโต๊ะบอก recent ทั้งที่ดึงข้อความเก่าที่เกี่ยวข้องได้
- **Root cause:** นำสมมติฐานจากแชทเก่ามาใช้กับ F006 และสรุป context scope ไม่ตรงกับตัวเลือกความจำ
- **Correct behavior:** ตรวจชื่อไฟล์จริง, การรวม/ไม่รวมประวัติ, การใช้บทสนทนาเก่าที่เกี่ยวข้อง และขอบเขต Canvas ก่อนมี node; รัน `npm run build`, `npm run build:cloudflare`, `npm run test:cloudflare:browser`, `npm run test:generative:browser` ตามลำดับ โดยไม่ใช้ force-click หรือเปลี่ยนผลธุรกิจที่คาด

### 2026-10-20 — ทุกทางเข้า Assistant ต้องกางแชทที่ย่ออยู่ได้
- **What happened:** หลังรวมแชท island ปุ่ม Write a message บน Canvas พยายามโฟกัส textarea ที่ซ่อนอยู่และไม่เปิดแชทกลับมา
- **Root cause:** ปุ่มไอคอนใช้ expand handler แต่ปุ่มบนการ์ดใช้เฉพาะ DOM focus
- **Correct behavior:** ใช้ expand/focus handler ร่วมกันทั้งสองทางเข้า แล้วรัน `npm run test:cloudflare:browser` ให้ผ่านกรณีเปิดจาก Objects หลังแชทย่อ; ห้ามปิด idle ทั้งหมดเพื่อให้กรณีนี้ผ่าน

### 2026-10-20 — Browser acceptance ต้องตรวจการลงมือใช้ ไม่ใช่แค่เห็นร่าง
- **What happened:** ร่าง generated views ผ่าน schema และแสดงภาพได้ แต่การทดลองส่วนตัวเคยเปิดเฉพาะภาพ และปุ่มที่ส่งค่าเดิมซ้ำถูกกันหลังคำสั่งแรก
- **Root cause:** renderer ยังไม่ได้รับ local command adapter สำหรับ draft; duplicate guard ผูกกับค่า input โดยไม่ดู revision ของข้อมูลหลังคำสั่งสำเร็จ
- **Correct behavior:** ใช้สำเนา draft กับ local authority ตรวจว่ากด/ลาก/รีเซ็ตได้โดยไม่มี `table.act` ไปยังห้องจริง แล้วรัน `npm run test:generative:browser`; ต้องมีการกดปุ่มเดิมสองครั้งและตรวจค่าที่เปลี่ยนจริง

### 2026-10-20 — สูตรที่ AI สร้างต้องมี error ที่ซ่อมได้และ oracle แยก
- **What happened:** โมเดลส่งจำนวน operand ผิดสำหรับสูตร binary, ส่งตัวเลขให้ scene text และกฎแบ่งน้ำที่อ่านยอดทีมแรกค้างไว้เมื่อทีมที่สองเล่น
- **Root cause:** ข้อผิดพลาดไม่ระบุ operation/arity ที่ต้องการ และคำแนะนำมีตัวอย่าง fixed record โดยไม่แยกจาก selected record ใน action; schema ผ่านได้แม้ความหมายธุรกิจยังผิด
- **Correct behavior:** ระบุ operation/arity, แยก text/number และ `selectedField`/`recordField`; รัน `GENERATIVE_CASE=water npm run test:generative:live` ใน disposable fixture ที่ตั้ง credential source ไว้ แล้วตรวจสองตาต่อเนื่องด้วยสูตรอิสระโดยไม่เปลี่ยนค่าที่คาดตามคำตอบโมเดล

### 2026-10-20 — การ fit กล้องต้องรอ geometry หลังขยายการ์ด
- **What happened:** หลังแก้กฎและเปิด Actions กล้องพาไปตำแหน่งเก่า ปุ่มอยู่พ้นขอบจอ แม้กฎและข้อมูลถูกต้อง
- **Root cause:** การขยายการ์ดเปลี่ยนความสูงและเรียก incremental layout หลังคำสั่ง fit; การรอเพียงสอง animation frames ไม่รับประกันว่าขนาดกับตำแหน่งนิ่ง
- **Correct behavior:** ใช้คำขอ focus ครั้งเดียวที่รอ geometry นิ่งและยกเลิกเมื่อคนลาก/เลื่อนเอง แล้วรัน `npm run build`, `npm run build:cloudflare`, `npm run test:cloudflare:browser` ตามลำดับ ห้ามใช้ force-click เพื่อปิดผลล้มของปุ่มที่อยู่นอกจอ

### 2026-10-20 — ตัวเลขถูกไม่ได้แปลว่าภาพที่ AI สร้างถูก
- **What happened:** ฉากแสง–เงาคำนวณ metric ถูก แต่ endpoint ของเส้นเงาใช้พิกัดหลอดไฟ; live pointer test อ่านตำแหน่งก่อนการ์ดกับกล้องนิ่งจึงพลาดวัตถุ
- **Root cause:** acceptance ตรวจเฉพาะ metric และใช้ visible เป็นเงื่อนไขเริ่มลาก ทั้งที่ geometry ยังเปลี่ยนได้
- **Correct behavior:** ตรวจ endpoint ของ scene ด้วยสูตรอิสระก่อน/หลัง action, รอ bounds นิ่งและใช้ hit-test ก่อนลาก; รัน `GENERATIVE_CASE=shadow npm run test:generative:live` ใน disposable fixture พร้อม credential source แล้วเก็บทุก failure ห้ามแก้ output ให้ตรงคำตอบเอง

### 2026-10-20 — ข้อความ handoff ในแชทเก่ากว่า repo
- **What happened:** ข้อความส่งต่องานบอกให้เริ่มจาก `feat/tabletop-r1` (draft PR), deploy `f1725c8`, commit ล่าสุด `bed5881` แต่ repo จริง PR #2 merge เข้า `main` แล้ว ตามด้วย PR #3–#7 และ prod รัน `c9d3bf0`
- **Root cause:** ข้อความเขียนก่อนรอบ merge/deploy ถัดไป และ hardcode SHA ไว้
- **Correct behavior:** ก่อนเชื่อสถานะจากแชท ให้รัน `git log --oneline --merges main | head` และอ่าน `docs/DEPLOYMENTS.md` · ถ้าไม่ตรง ให้ยึด repo แล้วบอกผู้ใช้

### 2026-10-20 — npm 11 ข้าม install scripts
- **What happened:** `npm ci` เตือนว่า `esbuild`, `workerd`, `fsevents` มี install scripts ที่ยังไม่อยู่ใน `allowScripts` · build และ `npm start` ยังผ่าน
- **Root cause:** npm 11.16 ไม่รัน lifecycle scripts ที่ยังไม่อนุมัติ · CI ใช้ `npm ci --ignore-scripts` อยู่แล้วจึงไม่เห็นผลต่าง
- **Correct behavior:** ถ้า `npm run dev:cloudflare` / `test:cloudflare` พังเรื่อง binary ของ `workerd` ให้ลอง `npm approve-scripts workerd` (หรือ `npm rebuild workerd`) ก่อนไล่โค้ด

### 2026-10-20 — Node รุ่นในเครื่องไม่ตรง CI
- **What happened:** เครื่องนี้ใช้ Node v26.3.1 ส่วน CI pin 22.23.2 · build ผ่าน แต่ผลอาจต่างจาก CI
- **Root cause:** ไม่มี `.nvmrc` / `.node-version` บังคับรุ่น
- **Correct behavior:** ระบุรุ่น Node ในรายงานผลตรวจทุกครั้ง · ถ้าผล local ต่างจาก CI ให้สลับไป 22.23.2 ก่อนสรุปว่าเป็นบั๊ก

### 2026-10-20 — `test:cloudflare:browser` พังด้วย ENOENT `worker-build/index.js`
- **What happened:** รัน `npm run test:cloudflare:browser` ตรง ๆ แล้วได้ `ENOENT ... worker-build/index.js` · ถึงแก้ตรงนั้นแล้ว เทสต์ก็ยังจะเปิด `msedge` ซึ่งไม่มีบน Mac เครื่องนี้
- **Root cause:** เทสต์ใช้ Worker ที่ bundle แล้วจาก `npm run build:cloudflare` (CI รันขั้นนี้ก่อนเสมอ) และตั้งเบราว์เซอร์เริ่มต้นเป็น `msedge` เพราะผู้พัฒนาเดิมใช้ Windows
- **Correct behavior:** รัน `npm run build && WRANGLER_SEND_METRICS=false npm run build:cloudflare` ก่อน แล้วรัน `BROWSER_CHANNEL=chrome npm run test:cloudflare:browser` (มี Google Chrome อยู่แล้ว ไม่ต้องติดตั้ง Playwright browser) · `build:cloudflare` เป็น dry run จะขึ้นข้อความ `--dry-run: exiting now`

### 2026-10-20 — Windows checkout เปลี่ยน bytes ของ release build
- **What happened:** preflight พบ static text และ raw-import bundles ต่างจาก build เดิมทั้งที่ source ไม่ต่าง จึงหยุดก่อนส่ง Worker
- **Root cause:** Git บน Windows ตั้ง `core.autocrlf=true`; checkout เป็น CRLF ขณะที่ Git blobs เป็น LF และ cached index อาจรายงาน modified หลังคืน blob bytes แม้ diff เนื้อหาว่าง
- **Correct behavior:** เริ่ม release checkout ใหม่ด้วย `git clone -c core.autocrlf=false --branch v1.0.0 https://github.com/Thanyers/tabletop.git release-clean` แล้วตรวจ `git status --porcelain` และ `git ls-files --eol` ก่อน build รอบนี้ตรวจ tracked blobs/index และสร้าง build ใหม่จน output ต่างเฉพาะ `version.json`; ไม่มี failed live deployment

### 2026-10-20 — ทดสอบ Google login ในเครื่องต้องใช้ emulator ไม่ใช่ `npm start`
- **What happened:** ผู้ใช้หาปุ่มกลับไปล็อกอินบน `localhost:4310` ไม่เจอ
- **Root cause:** Node runtime (`npm start`) ไม่มี `/api/auth/status` จึงเป็น guest เสมอ · ล็อกอิน Google มีเฉพาะ Worker · emulator ตอบ `ORIGIN_REJECTED` ถ้าเปิดผ่าน `localhost` เพราะ `PUBLIC_ORIGIN` คือ `http://127.0.0.1:8787` · ไม่มี OAuth client จะได้ `503 LOGIN_UNAVAILABLE`
- **Correct behavior:** `npm run build` → `npx wrangler d1 migrations apply DB --local` (ห้าม `--remote`) → ใส่ `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` ใน `.dev.vars` (ignored) โดย OAuth client ต้องมี redirect URI `http://127.0.0.1:8787/api/auth/google/callback` → `npm run dev:cloudflare` → เปิด `http://127.0.0.1:8787` เท่านั้น

### 2026-10-20 — `pkill -f` ปิดเซิร์ฟเวอร์ของคนอื่นไปด้วย
- **What happened:** ปิดเซิร์ฟเวอร์ทดสอบของตัวเองที่ `:4319` ด้วย `pkill -f "node --import tsx server/bootstrap.ts"` แล้วเซิร์ฟเวอร์ preview `:4310` ของผู้ใช้หยุดไปด้วย
- **Root cause:** ทุกเซิร์ฟเวอร์ Node ของโปรเจกต์รันด้วยคำสั่งเดียวกัน · `pkill -f` จับตามข้อความคำสั่ง ไม่ใช่ตาม port
- **Correct behavior:** ปิดตาม port เท่านั้น: `kill $(lsof -tiTCP:<port> -sTCP:LISTEN)` · เซิร์ฟเวอร์ที่เปิดผ่าน browser pane ให้ปิดด้วย `preview_stop`

### 2026-10-20 — หลาย session ใช้โฟลเดอร์ repo เดียวกัน
- **What happened:** session อื่นสลับ checkout ไป `chore/eslint-husky` และแก้ `node_modules` ระหว่างที่งานนี้รออยู่ · commit ของงานนี้ไปลงผิด branch และ emulator ที่รันจากโฟลเดอร์หลักล้มเพราะหา `zod` ไม่เจอ
- **Root cause:** หลาย agent ทำงานในโฟลเดอร์เดียวกันพร้อมกัน
- **Correct behavior:** ทำงานใน worktree ของตัวเอง: `git worktree add .claude/worktrees/<ชื่อ> -b <branch> origin/dev` แล้ว `npm ci --ignore-scripts` ในนั้น · ก่อน commit ทุกครั้งรัน `git branch --show-current` ให้แน่ใจว่าเป็น branch ของงานนี้

### 2026-10-20 — `check-public-files` crash `EISDIR` เมื่อมี worktree ซ้อนใน repo
- **What happened:** ตอนทดสอบ pre-commit hook สคริปต์ throw `EISDIR` ทำให้ commit ไม่ได้ทุกครั้ง
- **Root cause:** `git ls-files --others` รายงาน git worktree/repo ที่ไม่ได้ track (เช่น `.claude/worktrees/<name>/`) เป็น entry เดียวที่เป็นโฟลเดอร์ สคริปต์เลย `readFileSync` โฟลเดอร์
- **Correct behavior:** วาง worktree ของ AI ไว้ใต้ `.claude/worktrees/` (ignored แล้ว) · ถ้า `check-public-files` แจ้ง `Nested repository must be ignored or reviewed` ให้ย้ายหรือเพิ่ม path นั้นใน `.gitignore` · ห้ามใช้ `git commit --no-verify` เพื่อข้าม

### 2026-10-20 — แก้ไฟล์ผิด worktree เพราะ cwd ของ shell ไม่ได้อยู่ที่คิด
- **What happened:** สร้าง worktree ใหม่ด้วย `git worktree add … && cd <ใหม่>` ในคำสั่งหนึ่ง แล้วคำสั่งถัดไปแก้ไฟล์ด้วย path แบบ relative · cwd จริงกลับไปอยู่ worktree เดิม (preview) การแก้ UI จึงไปอยู่ผิด branch ส่วน commit ของ branch ใหม่มีแค่เทสต์ · browser test จับได้ทีหลัง
- **Root cause:** ไม่ได้ตรวจว่าไฟล์ที่แก้อยู่ branch ไหนก่อน commit และเชื่อ `git commit` ว่าได้ของครบ
- **Correct behavior:** ทุกคำสั่งที่แก้ไฟล์ขึ้นต้นด้วย `cd <worktree-absolute-path> &&` ในคำสั่งเดียวกัน · ก่อน commit รัน `git -C <worktree> diff --stat` แล้วเทียบกับไฟล์ที่ตั้งใจแก้ · ถ้ารายการไม่ตรงห้าม commit

### 2026-10-20 — Generated form preview advances the turn before submission
- **What happened:** Hosted two-account staging acceptance found that filling a turn-advancing generated form disabled its submit button before any command reached the shared table. The other account correctly retained the committed state.
- **Root cause:** Generated controls used the speculative preview state for availability, record options and input bindings; that state already contained the next seat. A local metric preview is not evidence of a committed command.
- **Correct behavior:** Use committed state and bindings for interactions while rendering preview values separately. Run `npm run build && npm run build:cloudflare && npm run test:generative:browser`, then verify a real form submit, both actors' shared records, history and reload on staging before promotion.

### 2026-10-20 — New-table browser test opens the picker before creation finishes
- **What happened:** Sync CI run `39440392308` timed out clicking the previous table after creating a blank one. The menu item was detached while Playwright waited for it to stabilize; release/main CI on the same source had passed.
- **Root cause:** `createWorkspace` sets the visible workspace before awaiting `refreshSession`, then closes the picker in `finally`. The browser helper treated a URL and empty Canvas as creation completion and could open the picker before that final close.
- **Correct behavior:** Dismiss any old creation notice, then wait for the fresh ready notice and collapsed picker before returning from the creation helper. Keep the normal click and URL assertion. Run `npm run build:cloudflare && npm run test:cloudflare:browser` without sleeps, force clicks or weakened assertions.

### 2026-10-20 — Chat visibility differs by branch and local table kind
- **What happened:** A teammate reported no chat after pulling code locally; their exact branch and table kind were not available.
- **Root cause:** Pre-release `main` lacked F006, `npm start` serves the existing `dist`, and legacy examples hide their composer when Node local reports AI disabled. The current generic table still shows its new composer, disabled when AI is unavailable.
- **Correct behavior:** Check `git branch --show-current` and `/version`, then run `npm run build && npm start`. Open `/new` and choose **Start empty with your own files** to verify the generic table. Use staging or the documented Worker setup for real AI; adding a key to Node `.env` does not enable it.

### 2026-10-20 — Generated numeric forms silently fail native validation
- **What happened:** An invoice form accepted a number in the declared range but clicking Add invoice sent no table command. Browser readback showed `min=0.01`, empty `step`, value `651`, and `validity.stepMismatch=true`.
- **Root cause:** Generated numeric inputs omitted `step`, so HTML applied its default step of 1 from the fractional minimum. The regular table action form already used `step="any"`.
- **Correct behavior:** Keep generated numeric inputs consistent with the numeric contract and check native validity before submission. Run `npm run build && npm run build:cloudflare && node scripts/canvas-evolution-local.mjs --auto`; require a real form POST and persisted row, not a successful field fill or speculative preview.

### 2026-10-20 — Data actions and structural requests share one composer
- **What happened:** Owner requests to add a form or missing create action were sent to the action-only assistant; a broad routing fix then also caught “Change invoice status in this table to paid.”
- **Root cause:** The old interpreter had updates but no typed record creation; matching the word “table” anywhere with “change” confused data changes with program changes.
- **Correct behavior:** Route clear UI/construction requests to the builder, leave data requests on the confirmation path, and offer an owner-only builder handoff for ambiguous requests with the actor/table/epoch consent retained by F013. Run `npx vitest run src/tabletop/ui/table-build-intent.test.ts src/tabletop/domain/table-record-actions.test.ts`.

### 2026-10-21 — Generic card sizing broke legacy demo geometry
- **What happened:** F010's first CI run failed the seven-session and public-demo overlap assertions after wider cards and growing bodies were applied globally. The generated Invoice fixture itself passed.
- **Root cause:** Legacy examples use their established card dimensions; their geometry does not follow the measured layout used by generic tables. Reaching a later CI step also did not prove earlier independent steps passed.
- **Correct behavior:** Scope the new card rules to `data-workspace-kind="table"`, preserve legacy dimensions, and read actual job/step conclusions. Run `npm run build && npm run build:cloudflare`, then `npm run test:r1:browser`, `npm run test:cloudflare:browser`, and `node scripts/canvas-evolution-local.mjs --auto`. All three browser checks passed locally after the scope fix (7, 25, and 10 checks).

### 2026-10-21 — สั่ง Release deploy ซ้ำทั้งที่มีคนรันสำเร็จไปแล้ว
- **What happened:** หลังแก้ config ของ CD001 ผมสั่ง `gh workflow run release-deploy.yml -f sha=f29e799…` ตามที่ผู้ใช้ยืนยัน แต่เจ้าของ repo รันสำเร็จไปแล้วตั้งแต่ 01:27Z · พอเห็นจึงสั่ง cancel แต่ไปถึงหลัง job จบ ผลคือ deploy code เดิมซ้ำอีกรอบ (ไม่มีผลต่อผู้ใช้ แต่ `built_at` และ Worker version เปลี่ยน)
- **Root cause:** ไม่ได้เช็คสถานะปัจจุบันก่อนสั่ง action ที่ deploy · คำยืนยันของผู้ใช้อิงข้อมูลที่ผมรายงานไว้ก่อนหน้า ซึ่งเก่าไปแล้ว
- **Correct behavior:** ก่อน `gh workflow run release-deploy.yml` ทุกครั้ง รัน `gh run list -R Thanyers/tabletop --workflow release-deploy.yml --limit 3` และ `curl -s <url>/version` ของทั้งสอง environment · ถ้ามีรอบของ SHA นั้นสำเร็จแล้วหรือ `/version` ตรง tag แล้ว ให้หยุดและแจ้งผู้ใช้แทนการรัน

### 2026-10-21 — push โค้ดที่ typecheck ไม่ผ่านเพราะดูแค่ผลเทสต์
- **What happened:** แก้ `cloudflare/model-failure.ts` ใน F016 แล้วรัน `npm run test:cloudflare` ผ่าน 85/85 จึง commit + push · แต่ `tsc -p tsconfig.cloudflare.json` แจ้ง `TS18046: 'value' is of type 'unknown'` ซึ่ง CI จะล้มที่ขั้น typecheck
- **Root cause:** vitest ตัด type ทิ้งตอนรัน จึงไม่จับ type error · pre-commit hook รันแค่ ESLint ไม่รัน `tsc`
- **Correct behavior:** ก่อน commit ทุกครั้งที่แก้ `.ts` ให้รัน `npm run typecheck` (ครอบทั้ง app, server และ cloudflare) และอ่านผลก่อน `git commit` · ห้ามถือว่าเทสต์ผ่านแปลว่า type ผ่าน

### 2026-10-21 — แก้ conflict แล้วภาษาไทยใน PLAN.md / CHANGELOG.md กลายเป็นตัวอักษรเพี้ยน
- **What happened:** merge commit แก้ conflict (b2df1e2 สำหรับ #73, 1218fef สำหรับ #75) บันทึก PLAN.md และ CHANGELOG.md ใหม่ทั้งไฟล์แบบ double-encoded (UTF-8 → อ่านเป็น Windows-874 → เขียนเป็น UTF-8 อีกรอบ) ภาษาไทยกลายเป็น "เธเธญเธฅ…" 82 + 61 บรรทัด แล้วหลุดเข้า `dev` ผ่าน #75/#77 · `main`/3.2.0 ไม่โดน
- **Root cause:** เครื่องมือหรือ editor ที่ใช้แก้ conflict อ่านไฟล์ด้วย encoding ภาษาไทยของ Windows ไม่ใช่ UTF-8 · CI ไม่ตรวจ encoding ของเอกสาร
- **Correct behavior:** หลังแก้ conflict ใน `.md` ทุกครั้ง รัน `git diff --cached -- '*.md' | grep -cE 'เธ|โ€'` ต้องได้ 0 ก่อน commit · ตั้ง editor/เครื่องมือให้อ่านเขียน UTF-8 · ถ้าเจอแล้ว ซ่อมโดยแปลงกลับ (Windows-874 → bytes → UTF-8) และเทียบกับเวอร์ชันก่อนเสีย ไม่แก้ทีละบรรทัดด้วยมือ

### 2026-10-25 — `jsonWithinBudget` ปฏิเสธ object ที่มีค่า `undefined` (พลาดซ้ำสองที่ในงานเดียว)
- **What happened:** `shared/json-budget.ts` ใช้กันค่าที่ไม่น่าเชื่อถือจาก wire และถือ `undefined` เป็นค่าที่ใช้ไม่ได้ · ใน F080 ผมใช้มันตรวจ tool package ที่สร้างใน TS ซึ่งเขียน optional field ที่ไม่ใช้เป็น `undefined` → ได้ `PACKAGE_BUDGET` ทั้งที่ package ถูกต้อง · แล้วพลาดซ้ำที่ bridge: host ตอบ `code: undefined` กลับเข้า frame ทำให้ `parseToolHostMessage` คืน `BRIDGE_TOO_LARGE` และ frame ไม่เคยได้ผลลัพธ์ (อาการคือ UI ค้าง ไม่มี error)
- **Root cause:** ตรวจ "JSON view" ด้วยฟังก์ชันที่ออกแบบสำหรับ JS object ดิบ · `JSON.stringify` ตัด `undefined` ออก แต่ `jsonWithinBudget` เรียกซ้ำบน object จริง
- **Correct behavior:** ก่อนเรียก `jsonWithinBudget` กับค่าที่ประกอบในโปรแกรม ให้ probe ด้วย `JSON.parse(JSON.stringify(value))` (ใน `try/catch`) แล้วค่อยส่งค่าเดิมให้ schema · ฝั่งผู้ส่ง ให้ละ optional field ที่เป็น `undefined` ออกแทนการส่งไป (`...(x === undefined ? {} : { x })`) · เขียน test ที่มี optional field เป็น `undefined` ทั้งสองทาง

### 2026-10-25 — sandboxed iframe รันโมดูลที่ compile แล้วไม่ได้ถ้า CSP ไม่มี `'unsafe-eval'`
- **What happened:** F080 สร้าง srcdoc + `sandbox="allow-scripts"` + CSP `default-src 'none'; script-src 'unsafe-inline'` แล้ว mount package ด้วย `new Function(...)` → เบราว์เซอร์บล็อก "Evaluating a string as JavaScript violates ... 'unsafe-eval'" และ UI แสดงเฉพาะ fallback error
- **Root cause:** CSP ของ frame ต้องอนุญาต eval ถ้าจะ instantiate โมดูลที่ compile มาเป็นข้อความ · และ `frame-ancestors` ที่ส่งทาง `<meta>` ถูกเพิกเฉย (มี console warning)
- **Correct behavior:** ใส่ `'unsafe-eval'` ใน `script-src` ของ **frame CSP เท่านั้น** (ไม่ใช่ของ host) เพราะ frame มี opaque origin ไม่มีคุกกี้/สตอเรจ/เน็ตเวิร์กอยู่แล้ว และอย่าใส่ `frame-ancestors` ใน meta · เก็บ `TOOL_SANDBOX_CSP` ไว้ที่ `ui/tool-sandbox/document.ts` ที่เดียว

### 2026-10-25 — `Add-Content`/`Set-Content` ใน PowerShell เขียนทับไฟล์ไทยทั้งไฟล์เป็น double-encoded
- **What happened:** ระหว่าง F080 ผมเพิ่มหัวข้อ decision ด้วย `Add-Content` แล้วแก้ประโยคด้วย `(Get-Content -Raw) -replace … | Set-Content` · ไฟล์ `decisions.md` ทั้งไฟล์ (20305 bytes) กลายเป็น UTF-8 ที่ decode ไม่ผ่าน (243 U+FFFD) และหลุดเข้า commit `607ece0` · ตรวจพบเพราะ `read` tool ฟ้อง `invalid UTF-8 text`
- **Root cause:** cmdlet เหล่านี้ decode ไฟล์เดิมด้วย assumed encoding (ANSI/Windows-874 สำหรับไทย) แล้ว encode ใหม่ทั้งไฟล์ → ข้อความไทยเดิมพังทั้งไฟล์ ไม่ใช่แค่บรรทัดที่แก้ · เป็นคลาสเดียวกับ incident 2026-10-21 แต่รอบนี้มาจาก cmdlet ไม่ใช่ editor
- **Correct behavior:** ห้ามใช้ `Set-Content`/`Add-Content`/`Out-File` กับไฟล์ที่มีภาษาไทย · ใช้ `edit`/`write` tool หรือ `node -e "fs.writeFileSync(path, text, 'utf8')"` เท่านั้น · หลังแก้เอกสารไทยทุกครั้ง ให้รันสแกน UTF-8 (strict decoder) + มาร์กเกอร์ mojibake (`เธ|โ€`) ก่อน commit · ถ้าพังแล้ว ให้กู้เวอร์ชันที่ยัง valid จาก `git show <sha>:<path>` ด้วย `fs.writeFileSync` (ไม่ผ่าน shell redirection) แล้วเขียนใหม่ทั้งบล็อกด้วย tool

## Deploy failures

### 2026-10-25 — v9.1.3 Worker published before Container settings finished
- **What happened:** [run 40132004027](https://github.com/Thanyers/tabletop/actions/runs/40132004027), [issue #291](https://github.com/Thanyers/tabletop/issues/291), started `2026-10-24T20:56:21Z` and failed at production-deploy at `2026-10-24T20:59:44Z`. Wrangler reported that the Worker version was deployed but Durable Object-managed Container application settings could not finish. Production already reported `9.1.3 / 4748689`; health/readiness/capabilities returned 200. Smoke was SKIPPED, so this was a partial deployment rather than a successful run.
- **Root cause:** observed failure is incomplete Container settings application after Worker publication. The underlying platform cause is not established; this release changed homepage/README copy and no compute configuration.
- **Correct behavior:** retry Release deploy through `workflow_dispatch` with the same full main SHA, as the run log and recovery procedure prescribe. Do not deploy locally, move the tag, change secrets, or infer completion from `/version` alone. The same-SHA retry [run 40132413721](https://github.com/Thanyers/tabletop/actions/runs/40132413721) failed at the same stage at `2026-10-24T21:04:27Z`; smoke and GitHub Release publication remained SKIPPED. Keep #291 open and record partial publication. After two identical failures, obtain a concrete platform diagnosis before retrying again; do not expand a homepage/README task into backend/configuration changes. Full deployment/compute readiness was UNVERIFIED at that snapshot. **Closure 2026-10-26:** replacement 9.1.4 / d09d2f2 [run 40256468104](https://github.com/Thanyers/tabletop/actions/runs/40256468104) passed Worker/Container settings and workflow smoke; production version/health/readiness/capabilities read back correctly and #291 closed. The old failure cause remains unknown; this closure does not establish actual compute execution acceptance.

### 2026-10-20 — CD001 รอบแรก: staging deploy ถูกปฏิเสธเพราะ CPU limits บน Workers Free
- **What happened:** Release deploy ของ v2.2.0 ([run 39464889970](https://github.com/Thanyers/tabletop/actions/runs/39464889970), issue #49) ล้มที่ขั้น Staging — deploy เวลา 2026-10-20T17:19:20Z (job เริ่ม 17:18:20Z) ด้วย `CPU limits are not supported for the Free plan [code: 100328]` · staging/production ยังเป็น 2.0.0 ไม่มีผลต่อผู้ใช้ · แก้ secret config เวลา 2026-10-20T19:18:30Z · deploy สำเร็จทั้ง staging/production ด้วย SHA เดิมเวลา 2026-10-21T01:27Z ([run 39527338589](https://github.com/Thanyers/tabletop/actions/runs/39527338589)) และ issue #49 ปิดเวลา 01:33Z
- **Root cause:** config ใน GitHub secrets สร้างจาก `wrangler.jsonc` ใน repo ซึ่งมี `"limits": {"cpu_ms": 50}` แต่บัญชีจริงเป็น Workers Free · config ของ operator เดิมไม่มี key นี้ · `wrangler deploy --dry-run` ไม่ตรวจข้อจำกัดของ plan
- **Correct behavior:** ก่อนตั้ง `WRANGLER_CONFIG_*` ให้เทียบกับ Worker ที่ deploy อยู่จริงใน dashboard (Settings → Variables/Bindings/Runtime) และลบ `limits` ออกเมื่อเป็น Free · `npx tsx server/release-deploy.ts check-config <file> <worker> <origin>` ตอนนี้ปฏิเสธ `limits` แล้ว

ใช้แทน phak Deploy Fail Log (ดู [CLAUDE.md](CLAUDE.md)) · บันทึก: เวลาที่ fail (จาก log), environment, อาการ/สาเหตุ, เวลาที่แก้, อ้างอิงเหตุการณ์คล้ายกันก่อนหน้า

_(ยังไม่มี)_
