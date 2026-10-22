# Changelog

## Unreleased

- **ตั้งค่าหน้าจอของโต๊ะ:** เมนู … มีหัวข้อ Display ตั้งเส้นโยง Automatic / Show / Hide ให้ทุกคนในโต๊ะ (คำสั่ง `display.set`, สิทธิ์ `table.rename`) · ปุ่ม Connections ในเมนู Objects ใช้ค่าเดียวกัน
- คนที่เปิดหน้าค้างไว้จะเห็นแถบ "มีเวอร์ชันใหม่ (vX.Y.Z) รีเฟรชหน้าเพื่อใช้รุ่นล่าสุด" ภายใน ~5 นาทีหลัง deploy หรือทันทีที่กลับมาที่แท็บ ทั้ง staging และ production · กดรีเฟรชหรือไว้ทีหลังได้ ไม่รีเฟรชเอง ([F042](docs/features/F042-update-notice.md))

- **รถ/วัตถุวิ่งวนอัตโนมัติใน scene (F040, MINOR):** primitive `rect`/`circle`/`text` รับ `motion {axis,from,to,speed,loop?}` ได้ — host เลื่อนตำแหน่งจาก `from` ถึง `to` ด้วยความเร็ว `speed` หน่วยต่อวินาที แล้ววนกลับมาเริ่มใหม่ (หรือหยุดที่ `to` เมื่อ `loop:false`) · `speed` เป็น expression ได้ เช่นอ่าน `speed_mps` จาก record ที่สไลเดอร์เขียน ทำให้ "ปรับความเร็วตาม parameter" ทำงานจริง · มีปุ่ม Pause/Play ใต้ scene และถ้าเครื่องตั้ง reduced motion จะไม่เล่นอนิเมชัน · การเคลื่อนไหวเป็นฝั่ง client ไม่เขียน state/ไม่มี migration · โมเดลได้รับ MOTION ใน prompt guide พร้อมตัวอย่างรถ 10 เมตร ([F040](docs/features/F040-scene-motion.md))
- **แก้ assistant ตอบไม่ได้เพราะเพดาน response (F041, PATCH):** เดิม `MAX_RESPONSE_BYTES = 64 KiB` นับ **raw SSE** ซึ่งกิน ~294 bytes/token (วัดจริง 188 tokens = 55,890 bytes) ทำให้คำตอบไทยยาวแค่ ~200 tokens ก็ขึ้น `MODEL_PROVIDER_RESPONSE_TOO_LARGE` · ตอนนี้นับคำตอบที่ถอดแล้ว (256K ตัวอักษร) และกัน raw stream ที่ 16 MiB · assistant รับ output 32,768 tokens และ timeout 180s · ไม่มี schema/migration/secret ([F041](docs/features/F041-assistant-response-cap.md))

## 4.4.0 — 2026-10-22

MINOR: ส่งงานใหม่ได้ระหว่างที่การ์ดอื่นทำงาน — คำถามทำขนานกัน คำขอร่างกฎเข้าคิว และแก้การ์ดของคนสั่งค้าง "Preparing…" (F038) · ไม่มี migration/secret/binding ใหม่ · rollback กลับ v4.3.1 ได้ทันที (รุ่นเก่ากลับไปปิดปุ่ม Send ระหว่างรอ)

- **ส่งงานใหม่ได้ระหว่างที่การ์ดอื่นทำงาน (F038, MINOR):** ปุ่ม Send ไม่ถูกปิดระหว่างรอแล้ว · คำถามเริ่มทันทีและทำขนานกันได้ · คำขอร่างกฎที่ส่งตอนมีร่างอื่นกำลังทำขึ้นการ์ด "Rule draft · queued" แล้วเริ่มเองต่อจากร่างก่อนหน้า (ยกเลิกได้) · การ์ดของคนอื่นแสดงชื่อคนถามเป็นบรรทัดเล็กสีจางใต้หัวข้อ (เดิมต่อหน้าหัวข้อ) และข้อความรอบอกชื่อ ("<ชื่อ> is preparing a rule draft…") ให้เห็นว่ามีคนทำอยู่แล้ว และร่างของเราจะเข้าคิวต่อร่างของเขา · server ไม่ทิ้งคำตอบธรรมดาเมื่อโต๊ะเปลี่ยนระหว่างสร้างอีก (proposal ยังต้องตรงสถานะล่าสุด) · **แก้บั๊ก:** หน้าของคนสั่งไม่ค้าง "Preparing a rule draft…" อีกหลังร่างล้ม (เดิมหยุดเช็คสถานะที่ 60s ขณะที่ร่างใช้ได้ถึง 180s) และการ์ดร่างที่ล้มบอกรหัสจริงแทน `Code UNKNOWN` · ไม่มี schema/migration/secret · rollback ได้ทันที ([F038](docs/features/F038-parallel-requests.md))

## 4.3.1 — 2026-10-22

PATCH: แก้บริบทโน้ตของ assistant ที่ทำให้ทุกโต๊ะที่มีโน้ตตอบ `MODEL_PROVIDER_OUTPUT_REJECTED` ทันทีโดยไม่เรียกผู้ให้บริการ · ไม่มี schema/migration/secret ใหม่ · rollback กลับ v4.3.0 ได้

- **Assistant notes context (PATCH):** ตัวตรวจ notes ใช้ `strictObject` กับ note record ทั้งก้อน (มี `id`, `x`, `y`, `createdBy` ฯลฯ) ทำให้โต๊ะที่มีโน้ตอย่างน้อยหนึ่งใบถูกปฏิเสธก่อนเรียกผู้ให้บริการ — ตอนนี้ส่งเฉพาะ `text`/`color` พร้อม regression test ที่ใช้ record จริง

## 4.3.0 — 2026-10-22

MINOR: สิทธิ์ตาม role ต่อโต๊ะและต่อคน (F035) + คำขอร่างกฎของทุกคนในแชทและตำแหน่งการ์ดร่วม (F034-T3) + ข้อความล้มเหลว/เพดานงานของ assistant และเส้นเชื่อมบน canvas (#121) + ความคืบหน้าแบบ streaming ของ assistant (#124) · ไม่มี migration/secret/binding ใหม่ · rollback กลับ v4.2.0 ได้ทันที (รุ่นเก่าไม่อ่านข้อมูล role ที่เก็บใน state ของห้อง และไม่ใช้ตำแหน่ง `table.chat.*`) · ⚠️ หลัง deploy สมาชิกเดิมทุกโต๊ะได้สิทธิ์ทุกอย่างยกเว้นลบ/รีเซ็ตโต๊ะทันที

- **สิทธิ์ตาม role ต่อโต๊ะ (F035):** ทุกชนิดโต๊ะกำหนด role ให้แต่ละคนได้จากหน้าต่าง People (role ตั้งต้นตาม case หรือสร้างเองด้วยการติ๊กสิทธิ์) · คนที่ยังไม่ถูกกำหนดได้ **ทุกสิทธิ์ยกเว้นลบ/รีเซ็ตโต๊ะ** — สมาชิกที่เดิมทำได้น้อยจะเชิญคน เปลี่ยนชื่อ เอาคนออก ร่าง/อนุมัติกฎ ฯลฯ ได้ทันทีหลัง deploy · ไม่มีใครให้หรือลดสิทธิ์ของคนที่มีสิทธิ์เกินตัวเอง และไม่มีใครแตะเจ้าของได้ · ปุ่มในโต๊ะ (รวมการคุม encounter และ lesson) แสดงตามสิทธิ์จริง server ปฏิเสธเสมอถ้าไม่มีสิทธิ์ · เดโมยังนั่งผู้เรียน/ผู้เล่นใน role Learner/Player · ไม่มี SQL migration (เก็บใน state ของห้อง)
- คำขอร่างกฎของสมาชิกทุกคนขึ้นเป็นการ์ดในแชท (การ์ดของคนอื่นตอบคำถาม AI แทนไม่ได้) · สมาชิกเห็นการ์ด Rules ตั้งแต่ยังเป็นร่าง · ขยับการ์ดแชทหรือการ์ด Rules แล้วทุกคนเห็นตำแหน่งเดียวกัน ([F034](docs/features/F034-open-visibility.md) T3)
- การ์ดแชทไม่หลุดจอหลังส่งคำขอ: เมื่อ server รับคำขอแล้ว การ์ดเปลี่ยนเป็น id ร่วมและหน้าจอเลื่อนตามไป (#122)
- **Canvas (PATCH):** เส้นเชื่อมแสดงอัตโนมัติเมื่อโต๊ะมีเส้น และจำค่าที่ผู้ใช้เลือก (`localStorage`, ไม่เก็บใน workspace) — แก้อาการ "จุดต่ออยู่ครบแต่เส้นหาย" หลัง reload · โน้ต F037 วาดเป็นกระดาษโพสต์อิทเอง ไม่ถูกครอบด้วยการ์ดหัวข้อ/ปุ่ม Open/พื้นที่ขาวอีก · โน้ตถูก pin ตำแหน่งจากตัวโน้ต ไม่ถูก auto-layout ย้าย
- **Table assistant (PATCH):** ข้อความล้มเหลวระบุสาเหตุจริงและลงท้ายด้วย `(code …)` ทุกครั้ง (timeout, provider error, billing, interrupted, validation พร้อมเหตุผลสั้น ๆ) · **Worker เก็บรหัสจริงแล้ว** — เดิม catch รวมทุก error เป็น `ASSISTANT_FAILED` ทำให้สาเหตุหายถาวร · job ที่ล้มเหลวมี `failureCode`, `failureReasons`, `durationMs` ให้เทสอ่าน และการ์ดมี `data-request-id` / `data-failure-code` / `data-failure-reasons` / `data-duration-ms` · ไม่มี schema/migration/secret ใหม่
- **เพดานงาน assistant (PATCH):** timeout ของผู้ให้บริการ 30s → **120s**, output 1,024 → **8,192 tokens**, response body 24 → 64 KiB และ client poll 60s → 150s · แยก `finish_reason=length` เป็น `MODEL_PROVIDER_OUTPUT_TRUNCATED` (เดิมถูกกลืนเป็น invalid response) · การ์ดระหว่างรอแสดงเวลาที่ใช้เทียบเพดานทุกวินาที ไม่ดูเหมือนค้าง · ไม่มี schema/migration
- **Streaming progress (PATCH):** เรียกผู้ให้บริการแบบ SSE (`stream: true`, `stream_options.include_usage`) อ่าน chunk แล้วเขียน `progress {receivedChars, reasoningChars, updatedAt}` ลง job ทุก ~0.9s · client ที่ poll อยู่แล้วเห็นจำนวนตัวอักษรเพิ่มขึ้นระหว่างรอ · ยังประกอบ JSON ให้ครบก่อน validate/commit เหมือนเดิม · ถ้าผู้ให้บริการตอบ JSON ธรรมดาก็ยังใช้ fallback เดิมได้ · ไม่มี schema/migration

## 4.2.0 — 2026-10-22

MINOR: note card แบบ post-it บน canvas — สร้างจากปุ่มข้างช่องแชท ลากย้าย แก้ข้อความ เปลี่ยน 6 สี ขยาย/หด และลบได้ ทุกคนในโต๊ะเห็นร่วมกัน · โน้ตถูกส่งเป็นบริบทให้ AI ตอนถาม/ร่างกฎ · ไม่มี schema/migration/secret ใหม่ · rollback กลับ v4.0.0 ได้

- **Note card (F037):** เก็บใน `TableState.notes` แยกจาก program/records → รอดจากการแก้กฎ · คำสั่ง `table.addNote/updateNote/moveNote/removeNote` สำหรับ owner+participant · จำกัด 20 ใบ 500 ตัวอักษร 6 สี · ตำแหน่งเก็บในโน้ตเอง ไม่กิน 24 ช่องของ canvasLayout · มุมเหลี่ยม ไล่สี base→เข้ม เงาแบบกระดาษยก
- **โน้ตเป็นความรู้ให้ AI:** assistant ตรวจและปิดชื่อสมาชิก (redact) พร้อมนับไบต์ตามงบเดิม · rule draft ส่ง notes ไม่เกิน 20 ใบเข้า provider

## 4.0.0 — 2026-10-22

MAJOR: สมาชิกทุกคนเห็นทั้งโต๊ะและแชท AI ของกันและกัน (F034) + ปลดเพดานเงิน AI (F036) + People dialog ใช้ลิงก์เชิญ (F003-T5/T6) + เช็คเร็วบน dev (CI005) · ไม่มี schema/migration/secret ใหม่ · rollback โค้ดได้ แต่ข้อมูลที่เคยซ่อนจะถูกเห็นไปแล้ว

- **เปลี่ยนการมองเห็น (MAJOR):** สมาชิกทุกคนในโต๊ะเห็นข้อมูลโต๊ะครบทุกอย่าง (ร่างกฎ, โน้ต DM/ครู, ค่าทอยที่ยังไม่เปิด, คำตอบของผู้เรียนคนอื่น) และเห็นแชท AI ของทุกคนพร้อมชื่อผู้ถาม · ยืนยัน action ได้เฉพาะคนถาม · คนนอกโต๊ะยังอ่านไม่ได้ · **ข้อมูลที่เคยซ่อนบน environment ที่ deploy จะถูกเห็นย้อนหลัง** · กลับไปแบบเดิมได้ด้วย `VISIBILITY_POLICY = 'private'` ([F034](docs/features/F034-open-visibility.md))
- **ปลดเพดานเงินของ AI ทั้งหมด (F036):** ไม่มีการปฏิเสธงานเพราะงบอีกต่อไป — ทุกงานยังจอง/บันทึก/settle การใช้จริงลง ledger เพื่อวัดค่าจริงและ optimize · env งบยังอยู่ใน config แต่ไม่มีผลแล้ว · ไม่มี schema/binding/secret ใหม่ · ยังคงเพดานจำนวนงาน (50/ห้อง/วัน, 200/คน/วัน, 8 พร้อมกัน) และขอบเขต token
- POC: `AI_DAILY_BUDGET_MICRO_USD` / `AI_MONTHLY_BUDGET_MICRO_USD` = 0 หรือไม่ตั้ง = **ไม่จำกัดงบ** (ยังวัด usage) เพื่อไม่ให้เทสติด "budget reached" (F033)
- หน้าต่าง People ของโต๊ะข้อมูลเหลือแค่รายชื่อ ตัวนับ `N/7 members` ลิงก์เชิญใช้ซ้ำ และปุ่ม Remove · เอาส่วน AVAILABLE SEATS และคำเชิญครั้งเดียวต่อที่นั่งออก (โต๊ะสอนและโต๊ะเกม รวมถึง Node guest runtime ยังเชิญทีละที่นั่ง) · `/api/capabilities` บอก `inviteLinks` · คู่มือเชิญเพื่อนเขียนใหม่ ([F003](docs/features/F003-reusable-invite-link.md) T5–T6)
- CI: PR และ push เข้า `dev` รันเฉพาะเช็คเร็ว (lint, unit, typecheck, build, Worker tests) · browser suites ทั้งสามรันเฉพาะ release PR เข้า `main`, push เข้า `main` และ Run workflow เอง (CI005)

## 3.4.2 — 2026-10-21

PATCH: POC — ตั้ง AI budget เป็น 0/ไม่ตั้ง = ไม่จำกัดงบ (ยังวัด usage) ไม่ต้องชน "budget reached" ระหว่างเทส · ไม่มี schema/migration · rollback กลับ v3.4.1 ได้

- งบ AI แบบ 0/unset ถือเป็นไม่จำกัด; ค่าบวกยังคุมเพดานตามเดิม (F033)

## 3.4.1 — 2026-10-21

PATCH: การจองงบ AI ใช้เพดาน output จริง (16K) แทน 32K ทำให้ไม่ชน "budget reached" ก่อนเวลาอันควร · ไม่มี schema/migration · rollback กลับ v3.4.0 ได้

- AI ไม่ขึ้น "The configured AI budget has been reached" ก่อนที่ยอดใช้จริงจะใกล้เต็ม เพราะการจองต่อ request ใช้ min(max_tokens, 16,384) ขณะที่ settle ยังคิดตาม usage จริง (F032)

## 3.4.0 — 2026-10-21

MINOR: AI table generation ใช้ thinking + 32K output + compact schema guide + deadline 180s (F031), corpus หลายรอบ/stability (F029/F030) และ reliability ก่อนหน้า · ไม่มี schema/migration/secret ใหม่ · rollback กลับ v3.3.2 ได้ทันที

- AI ร่างกฎใช้ **thinking + 32K output + deadline 180s** และ prompt แบบ compact guide (5KB แทน schema 36KB): แนบไฟล์ได้มากขึ้น ร่างยากมีโอกาสผ่านมากขึ้น · reply ที่ถูกตัด (`finish_reason=length`) ถือเป็น repairable และ invalid JSON รายงานตำแหน่ง+บริบท · ช่วง repair ห้ามกลับไปถาม clarify (F031)
- corpus วัดผลได้หลายรอบ (`TABLE_CORPUS_ROUNDS`) พร้อมค่าความเสถียรต่อเคส — 3 รอบล่าสุด matched 29/30, reject 0, join ได้ draft 100% (F030)

## 3.3.2 — 2026-10-21

PATCH: ความน่าเชื่อถือของร่างกฎจาก AI — refresh race (F025), บังคับภาษาคำถาม clarify (F026), hint เมื่อ reject เพราะอ้างข้ามการ์ด (F027), fallback ตารางขั้นต่ำ (F028), golden corpus วัดผล (F029) · ไม่มี migration/secret/binding ใหม่ · rollback กลับ v3.3.1 ได้ทันที

- มี **golden corpus 10 โจทย์** วัดอัตรา draft/clarify/reject ได้จริง (baseline 9/10) ใช้เทียบก่อน/หลังแก้ทุกครั้ง (F029)
- ถ้าซ่อมร่างกฎ 3 รอบไม่ผ่าน ระบบจะลองครั้งสุดท้ายด้วย **ตารางขั้นต่ำ** (1 collection, ไม่มี canvas/join) ก่อน reject — เคส join ข้ามการ์ดที่เคยล้มผ่านที่ attempt 2 (F028)
- การ์ดร่างกฎไม่ขึ้น error หลอก ๆ "The table could not refresh: The table changed" อีก: ถ้า refresh แพ้ race กับ projection อื่น ระบบจะรอสั้น ๆ แล้วใช้ projection ล่าสุดให้เอง (F025)
- คำถาม clarify ถูกบังคับให้เป็น**ภาษาของคำขอ** (ไทย→ไทย, อังกฤษ→อังกฤษ): ถ้าโมเดลตอบภาษาปน ระบบจะซ่อมหนึ่งรอบแล้วจึงแสดง (F026)
- ข้อความ reject ที่เกิดจากการอ้างข้ามการ์ด/ข้าม collection จะบอกข้อจำกัดและทางเลือกให้ทันที (F027)

## 3.3.1 — 2026-10-21

PATCH: ซ่อมรอบซ่อมร่างกฎให้ลดความซับซ้อนเมื่อปัญหาเดิมวนซ้ำ (F024) · ไม่มี schema/migration/secret · rollback กลับ v3.3.0 ได้ทันที

- ร่างกฎที่ล้มซ้ำด้วยปัญหาเดิมจะถูกสั่งให้ **ลดความซับซ้อน** (ตัด action/view ที่ทำให้พัง) แทนการเติม reference ใหม่: เคสมังกร 3 หัว/มัดจำ 20% ที่เคยล้ม 3 รอบ ผ่านใน 2–3 รอบ (F024)

## 3.3.0 — 2026-10-21

MINOR: ฟีเจอร์ใหม่ 6 อย่าง (salvage การ์ดภาพผิดรูป, ตอบคำถาม AI ได้หลายข้อ/พิมพ์เอง, พิมพ์ระหว่างรอ AI, ข้อความ validation บอกชื่อ field, owner เตะสมาชิกได้, invite link ใช้ซ้ำ) · ไม่มี migration, secret หรือ binding ใหม่ · rollback กลับ v3.2.0 ได้ทันที

- ตารางยังเกิดขึ้นได้แม้การ์ดภาพ (scene/view) บางใบเขียนไม่ได้: ตัดเฉพาะ view ที่พังแทนการล้มทั้งร่าง พร้อมบอกโมเดลให้ omit view ที่เขียนไม่ได้และคงส่วนที่ผ่านแล้วไว้ตอนซ่อม (F023)
- การ์ดคำถามจาก AI เลือกได้หลายคำตอบ และมีตัวเลือก **Write my own answer** ให้พิมพ์คำตอบเอง แล้วกด **Send answer** ครั้งเดียว (เลือกข้อเดียวส่งข้อความเหมือนเดิม) (F022)
- ระหว่างรอร่างกฎหรือคำตอบจาก AI พิมพ์ข้อความถัดไปในช่องแชทได้ (ปุ่มส่งใช้ได้เมื่องานเดิมเสร็จ) ข้อความที่พิมพ์ระหว่างรอไม่หาย
- แก้ร่างกฎจาก AI ที่ล้มซ้ำด้วย "Field bounds do not match its type": ข้อความตรวจบอกชื่อ field และปัญหา (min/max ใช้ได้กับ number เท่านั้น, min ≤ max, choices ใช้ได้กับ text เท่านั้น) และคำสั่ง AI ระบุกฎนี้ตั้งแต่แรก
- เจ้าของโต๊ะข้อมูลเอาสมาชิกออกได้จากหน้าต่าง People (ยืนยันก่อน) · คนที่ถูกเอาออกหมดสิทธิ์อ่าน/สั่ง/รับข้อมูลสดทันที โต๊ะหายจาก My tables และกลับมาได้ด้วยคำเชิญใหม่เท่านั้น ([F003](docs/features/F003-reusable-invite-link.md) T1) ไม่มี migration
- ลิงก์เชิญของโต๊ะข้อมูลแบบใช้ซ้ำได้: เจ้าของกด **Turn on invite link** (หมดอายุ 1/7/30 วัน) ส่งลิงก์เดียวในกลุ่ม ใครล็อกอินแล้วกดก็ได้ที่นั่งว่างถัดไป สูงสุด 7 คน · สร้างลิงก์ใหม่หรือปิดได้ทันที · คนที่ถูกเอาออกใช้ลิงก์เดิมไม่ได้ · หน้าต่าง People แสดง `N/7 members` · เก็บเฉพาะ hash ของลิงก์ ([F003](docs/features/F003-reusable-invite-link.md) T3) ไม่มี migration ของ D1

## 3.2.0 — 2026-10-21

MINOR: การแก้กฎไม่ทำให้ canvas view หาย (F018) และการ์ด Rules บอกความสามารถ/ข้อจำกัดของโต๊ะ (F019) · ไม่มี migration, secret หรือ binding ใหม่ · rollback กลับ v3.1.0 ได้ทันที

- ขอแก้กฎบนโต๊ะเดิมแล้วการ์ด/metric/chart ที่มีอยู่ไม่หายอีกต่อไป: server merge view ที่ AI ไม่ส่งกลับมา (ของใหม่ชนะ, view ที่ bind ไม่ได้ถูกตัดทิ้ง, ไม่เกิน 12 views) (F018)
- การ์ด Rules มี **What this table can do**: ความสามารถที่ใช้ได้ + ขีดจำกัดจริง (6 collections · 12 fields · 100 rows/collection · 200 rows · 12 views · 6 computed columns) และ **Known gaps** 5 ข้อพร้อมทางไปต่อ · `/api/capabilities` เพิ่มข้อมูลชุดเดียวกันแบบ additive (F019)

## 3.1.0 — 2026-10-21

MINOR: ไม่มี migration, secret หรือ config ใหม่ · rollback ไป 3.0.0 ได้ทันที (คอลัมน์คำนวณเก็บนอก JSON ของกฎ รุ่นเก่าแค่ไม่แสดง) · ห้ามถอยต่ำกว่า 3.0.0 ตามหมายเหตุของ 3.0.0

- คอลัมน์คำนวณ: owner กำหนดสูตรต่อ collection (field + − × ÷ field/ตัวเลข) แล้วตารางแสดงค่าอัตโนมัติพร้อม badge "calculated" โดยไม่เรียก AI · เก็บนิยามใน state ไม่แตะ program schema จึง rollback ได้และไม่มี migration (F017)
- ร่างกฎที่ไม่ผ่านการตรวจแสดงสาเหตุจริงไม่เกิน 3 ข้อ (เช่น ต้องเก็บ field เดิม, เกินจำนวนแถว) แทนข้อความกลาง ([F016](docs/features/F016-validation-reasons.md)) ไม่เปลี่ยน API หรือข้อมูลที่เก็บ
- นำแถวข้อมูลเข้าตารางได้โดยตรง: การ์ด collection มี **Import rows** ให้วาง CSV หรือเลือกไฟล์ เห็น preview/จับคู่คอลัมน์ แล้ว import แบบ deterministic ไม่เรียก AI · ตรวจชนิด/required/choices/ช่วงค่า, เติม default, ตรวจ unique และเพดานแถวแบบ all-or-nothing (owner เท่านั้น; F015)

## 3.0.0 — 2026-10-21

MAJOR: กฎของโต๊ะข้อมูลเก็บ field ใหม่ (`action.creates` สร้างแถวใหม่, `field.default`) ที่ 2.2.0 อ่านไม่ได้ · ไม่มี SQL migration, secret หรือ config ใหม่ deploy เหมือนเดิม · **หลังมีโต๊ะที่ใช้กฎแบบใหม่แล้ว ห้าม rollback ไป 2.2.0 หรือต่ำกว่า** (การแก้กฎด้วย AI จะขึ้น "The current table state is invalid" และ action ที่สร้างแถวจะไม่สร้าง) · ถ้าต้องถอย ให้ออก hotfix บน 3.x หรือเปิด `TABLE_READ_ONLY`

- แก้ข้อความแจ้งเตือนเมื่อร่างกฎพร้อมแต่ตาราง refresh ไม่สำเร็จ ซึ่งเคยหายไปเพราะ poll รอบสุดท้ายล้างสถานะ error — ตอนนี้ปิด job ที่จบแล้วจะ refresh ครั้งเดียวต่อ job และปุ่ม **Retry table refresh** ขึ้นสม่ำเสมอ
- ต่อเติมโต๊ะข้อมูลผ่านแชทเดียวกันได้: ขอเพิ่มฟอร์ม ปุ่ม การ์ด หรือตารางว่าง; เพิ่มแถวจริงผ่าน typed create action พร้อมตรวจสิทธิ์/เงื่อนไขบน server; เพิ่ม field พร้อม default โดยรักษาข้อมูลเดิม ตรวจร่างแล้วกด **Apply to table** ครั้งเดียว ขั้นตอนแยกและ private preview ยังเปิดดูได้ ปรับขอบ ขนาด และการเลื่อนของการ์ด/ฟอร์ม ([F010](docs/features/F010-canvas-evolution.md)) ไม่มี SQL migration แต่ writer เก่าที่ไม่รู้จัก creates/default/build-request ใช้ rollback หลังบันทึกสัญญาใหม่ไม่ได้
- การ์ดบน Canvas: การ์ดแชทและการ์ดข้อเสนอ AI มี padding เท่าการ์ดอื่น (16px, มือถือ 12px) ไม่บังคับความสูง 156px ให้การ์ดแชท ปุ่มในการ์ดแชทกว้างตามข้อความ · บนจอ ≤760px หัวการ์ด ไอคอน และชื่อการ์ดเล็กลงจริง (เดิมกฎถูกทับ) และขอบข้าง 16px · ขนาดไอคอน/บรรทัด/ความกว้างปรับลง grid 4px
- การ์ดแชทระหว่างรอ AI: ไอคอนเป็น Sparkles มีวงแหวนหมุนรอบและหายใจเบา ๆ ข้อความสถานะอยู่กลางการ์ดพร้อมจุดเด้งและ shimmer · ผู้ที่ตั้ง reduced motion เห็นแบบนิ่ง
- CI: browser acceptance สามชุด (Node, Workers, generated) รันซ้ำอัตโนมัติ 1 ครั้งเมื่อล้ม เพราะ runner 2-core ทำให้ layout/timer race เป็นครั้งคราว · ถ้าล้มทั้งสองครั้ง step ยังแดงและ log ครั้งแรกยังอยู่ (CD002)
- ร่างกฎโต๊ะ: ถ้าโจทย์ยังไม่พอหรือวางข้อมูลแทนการแนบไฟล์ AI จะถามกลับเป็นคำถามเดียวพร้อมตัวเลือกคำตอบ 3 ข้อแทนการร่างที่ไม่ผ่านการตรวจ โต๊ะไม่เปลี่ยน · กดตัวเลือกแล้วส่งคำขอใหม่ทันทีโดยไม่ถามความยินยอมซ้ำ · job ที่จบโดยไม่มีร่างกฎไม่แสดงปุ่ม Review rules อีก ([F012](docs/features/F012-ai-clarifying-questions.md))

## 2.2.0 — 2026-10-21

MINOR: ไม่มี migration, secret หรือ config ใหม่ · rollback ได้ทันที (รุ่นเก่าจะกลับไปถามความยินยอม AI ทุกครั้ง) · รุ่นแรกที่ deploy ผ่าน pipeline CD001

- CI/CD: merge `release/X.Y.Z` เข้า `main` แล้ว pipeline สร้าง tag, รัน D1 migration (บันทึกจุดกู้คืนก่อน), deploy staging, ตรวจ smoke แล้ว deploy production ด้วย build เดียวกันอัตโนมัติ · ล้มแล้วหยุดและเปิด issue ไม่ rollback เอง ([CD001](docs/TEAM_HANDOFF_TH.md#deploy-อัตโนมัติ-cd001))
- แชทบนโต๊ะถามความยินยอมส่ง AI ครั้งเดียวต่อโต๊ะต่อคน ครอบทั้งร่างกฎและถามคำถาม และจำไว้ในเบราว์เซอร์แม้ reload · ไฟล์ที่เพิ่มทีหลังส่งไปกับคำขอร่างกฎครั้งถัดไปโดยไม่ถามซ้ำ · reset โต๊ะ เปิดโต๊ะอื่น หรือใช้บัญชีอื่นจะถามใหม่ (F013)

## 2.1.0 — 2026-10-20

MINOR: ไม่มี migration, secret หรือ config ใหม่ · rollback ได้ทันที (แท็บที่เปิดค้างด้วยโค้ดใหม่จะต่อ socket ซ้ำจนกว่าจะรีเฟรช)

- เห็นเมาส์ของคนอื่นบน Canvas พร้อมชื่อและสีประจำตัวแบบสด ส่งผ่าน WebSocket เดิม ไม่เก็บลงฐาน · หายเมื่อออกนอก Canvas หรือไม่ขยับ 10 วินาที ([F009](docs/features/F009-live-cursors.md)) ไม่มี migration
- หน้า `/new`: ปุ่มข้อความ **Start empty with your own files** เปลี่ยนเป็นการ์ดใบที่สี่ **Start empty** เรียงคู่กับการ์ดตัวอย่าง (เส้นประ) ([F001](docs/features/F001-guided-table-start.md))
- ไฟล์บนโต๊ะข้อมูลเป็นของทั้งโต๊ะ: สมาชิกที่ถูกเชิญเห็นการ์ด Files และอ่านเนื้อหาได้ทันที ตำแหน่งการ์ดใช้ร่วมกันเหมือนการ์ดอื่น · สมาชิกเพิ่มไฟล์ได้ (คลิปหนีบ, การ์ด Files, ลากวาง) แต่ลบได้เฉพาะเจ้าของ · ไฟล์ของสมาชิกไม่ล้างร่างของเจ้าของ · ร่างกฎ ประวัติร่าง และ quotation ยังเป็นของเจ้าของ · แชทถาม AI ยังไม่ส่งไฟล์ ([F008](docs/features/F008-shared-table-files.md)) ไม่มี migration

## 2.0.0 — 2026-10-20

MAJOR: JSON ของกฎและ Canvas รองรับ expression และมุมมองใหม่; หลังเขียนข้อมูลแบบใหม่นี้ ห้ามใช้ `v1.1.0` หรือต่ำกว่าเป็น writer เพื่อ rollback ให้ใช้ build ที่อ่านสัญญาใหม่นี้ได้พร้อม `TABLE_READ_ONLY=true` แล้วแก้ไปข้างหน้า ไม่มี SQL migration, secret, binding หรือ dependency ใหม่ ผู้ใช้อนุมัติเลขรุ่นและ staging → ทดสอบ Google สองบัญชี → production ในรอบนี้; ผล hosted acceptance และ deployment ต้องยืนยันแยกก่อนส่ง production

- แก้ฟอร์มที่เปลี่ยนเทิร์น: การกรอกข้อมูลแสดงผลทดลองได้ แต่สิทธิ์ ปุ่มยืนยัน ตัวเลือก record และ inputs ที่ส่งต้องอิงสถานะที่บันทึกแล้ว จึงไม่ปิดปุ่มของผู้เล่นก่อนกดยืนยันรายการ

- โต๊ะข้อมูลเริ่มด้วย Canvas ว่างและช่องแชทแถวเดียวที่ขยายได้ห้าแถว แนบไฟล์หรือเริ่มจากข้อความได้ คำตอบเป็นการ์ดส่วนตัว; เปิด Rules → Edit rules เพื่อแก้กฎผ่านช่องเดิม พร้อมยินยอมตามข้อมูลที่ส่งและตรวจร่างก่อนเปิดใช้ ([F006](docs/features/F006-chat-first-table.md)) ไม่มี migration หรือการเปลี่ยน provider
- ตำแหน่งการ์ดเป็นของทั้งโต๊ะ: Rules ที่เปิดใช้แล้ว, Actions, ตาราง, มุมมองที่ AI สร้าง, People และ History อยู่ที่เดียวกันทุกเครื่องและย้ายตามกันแบบสด · ผังเริ่มต้นและการ์ดใหม่ถูกบันทึกให้ทุกคน · ลากคนละการ์ดพร้อมกันลองส่งใหม่เมื่อยังไม่มีใครย้ายใบเดียวกัน · Files, คำตอบแชทและ Rules ที่ยังเป็นเพียงร่างแรกอยู่ในมุมมองส่วนตัว ([F007](docs/features/F007-shared-card-layout.md))
- แก้การบันทึกตำแหน่งการ์ดพื้นหลังที่ทำให้ช่องแชทและปุ่มส่งถูกล็อก; แยกออกจากสถานะคำสั่งเล่น โดยยังตรวจตำแหน่งเวอร์ชันล่าสุดและกันผลตอบรับข้ามห้อง
- เจ้าของตั้งชื่อโต๊ะได้จากปุ่มดินสอข้างชื่อที่แถบด้านบน (1–100 ตัวอักษร · Enter บันทึก · Esc ยกเลิก) · สมาชิกเห็นชื่อใหม่ทันทีและใน My tables · ชื่อที่ตั้งเองมาก่อนชื่อจากกฎของโต๊ะข้อมูล · คำสั่ง `workspace.rename` ผ่านการตรวจสิทธิ์/revision/คำสั่งซ้ำเหมือนคำสั่งอื่น ไม่มี migration ([F002](docs/features/F002-rename-table.md))
- เริ่มจากข้อความหรือไฟล์ ให้ AI ร่างภาพ เครื่องมือและสูตรใหม่บน Canvas ด้วย bounded expression runtime; เพิ่ม scene, chart, metric, form, slider, toggle และการลากวัตถุ
- ทดลองร่างส่วนตัวก่อนเปิดใช้; คำสั่งที่ใช้จริงยังตรวจสิทธิ์ เทิร์น revision และ commit แบบ atomic
- จัดการ์ดตามความสัมพันธ์และขนาดจริง รักษาตำแหน่งที่คนลากไว้ และบันทึก shared layout แยกจากสถานะการเล่น
- ส่งข้อมูลปัจจุบันให้ AI เมื่อแก้กฎ พร้อมการซ่อมผลลัพธ์แบบจำกัดงบ; ค้นบทสนทนาเก่าที่เกี่ยวข้องในขอบเขตผู้ถาม/โต๊ะ/epoch
- ใช้ JSON state เดิม ไม่มี SQL migration หรือ dependency ใหม่ ดู [contract และข้อจำกัด](docs/GENERATIVE_CANVAS_RUNTIME.md); สถานะ hosted ให้ยึด [Deployment](docs/DEPLOYMENTS.md)
- F006 เปลี่ยนแชท island ของโต๊ะข้อมูลที่เพิ่มใน F001-T8/T9 เป็นช่องแชทด้านล่างที่ไม่ย่อ; โต๊ะตัวอย่าง invoice / teaching / encounter ยังใช้หน้าร่างกฎ AI เดิม โค้ด island เก็บไว้แต่ไม่ได้ต่อกับหน้าโต๊ะปัจจุบัน

## 1.1.0 — 2026-10-20

MINOR: ฟีเจอร์ใหม่ฝั่งหน้าเว็บ ไม่มี migration, schema, secret, binding หรือการเปลี่ยนงบ AI · rollback กลับ `v1.0.0` ได้ทันที · config deploy ไม่ต้องแก้ (path ลึกใช้ SPA fallback ของ Worker ที่มีอยู่)

- หน้าเริ่มโต๊ะใหม่ที่ `/new`: คำถาม "What should we start with?" · การ์ดโต๊ะสำเร็จรูป 3 ใบ (Invoice check, Physics lesson, Shared encounter) · ช่องพิมพ์ที่สร้างโต๊ะข้อมูลว่างและเก็บข้อความไว้ในช่องร่างกฎ (ยังไม่เรียก AI) · ปุ่มเริ่มโต๊ะว่างด้วยไฟล์ตัวเอง · หน้าแรกและเมนูด้านบนพามาหน้านี้ ([F001](docs/features/F001-guided-table-start.md) T1–T2)
- แต่ละหน้ามี URL ของตัวเอง: รายการโต๊ะ `/` · โต๊ะ `/t/<id>` · ลิงก์เชิญ `/join#invite=...` · รีโหลดอยู่โต๊ะเดิม ปุ่ม back/forward ใช้ได้ และยังไม่ล็อกอินจะกลับโต๊ะเดิมหลังล็อกอิน · URL โต๊ะไม่ใช่สิทธิ์ เซิร์ฟเวอร์ยังตรวจสมาชิกทุกคำขอ คนนอกเห็นข้อความเดียวกับโต๊ะที่ไม่มีอยู่ · `/new` คือหน้าเริ่มโต๊ะใหม่ ([F004](docs/features/F004-url-paths.md))
- **แก้:** workbench ของ invoice / physics / encounter ไม่เรียก React hook หลัง return แบบมีเงื่อนไขแล้ว (กัน React error "Rendered fewer hooks" ถ้าชนิดข้อมูลเปลี่ยนใน component เดิม) · ผู้ใช้ไม่เห็นอะไรเปลี่ยน
- **CI/dev:** เพิ่ม ESLint (`npm run lint`) เข้า CI ห้าม `any` ที่เขียนเอง ห้าม `@ts-ignore` และบังคับกฎของ React hooks · เพิ่ม pre-commit hook (husky + lint-staged) ที่รัน `check-public-files` และ lint ไฟล์ที่ stage · `check-public-files` ไม่ crash เมื่อเจอ nested repository แล้ว แต่รายงานเป็น finding แทน · ไม่เปลี่ยน behavior ของแอป ([CONTRIBUTING → Lint](CONTRIBUTING.md#lint))

## 1.0.0 — 2026-10-20

release แรกที่ติด tag ตามรูปแบบ `vMAJOR.MINOR.PATCH` · โค้ดแอปตรงกับ `524d9cc` ที่รันบน production และ staging อยู่แล้ว ([Deployment](docs/DEPLOYMENTS.md)) ส่วนที่ต่างจากนั้นมีแค่เอกสารและ CI · จากรุ่นนี้ไป `main` รับเฉพาะ `release/*` และ `hotfix/*` ส่วนงานใหม่เข้า `dev` ตาม [AGENTS.md](AGENTS.md)

- หน้าแรกก่อนล็อกอินอธิบายแนวคิดของ Tabletop พร้อมลิงก์เดโม โดยไม่เปลี่ยน auth, ห้อง, กฎ หรือ storage ดู [Public welcome](docs/PUBLIC_WELCOME_ACCEPTANCE.md)
- เพิ่ม `AGENTS.md` (กติกา branch/CI/release/hotfix ที่คนและ AI ใช้ร่วมกัน), `spec.md`, `MEMORY.md`, `CLAUDE.md` · CI รันเมื่อ push เข้า `dev` ด้วย
- เพิ่ม `GET /version` ทั้ง Worker และ Node ตอบ `{"version","sha","built_at"}` จาก `version.json` ที่ build เขียนไว้คู่กับไฟล์เว็บ จึงไม่ต้องแก้คำสั่ง deploy · `version` มาจาก git tag `vX.Y.Z` ของ commit ที่ build; ถ้าไม่มี tag จะเป็น `0.0.0-dev` · ไฟล์ที่ไม่มีหรือรูปแบบผิดตอบ 404
- **operator:** config deploy ต้องมี `/version` ใน `assets.run_worker_first` (เพิ่มใน `wrangler.jsonc` แล้ว) ไม่อย่างนั้น `/version` จะได้หน้า `index.html` แทน · build มีไฟล์เพิ่ม 1 ไฟล์และ `built_at` ทำให้ build สองครั้งจาก source เดียวกันได้ไฟล์นี้ต่างกัน

## 2026-10-20 — Calm Canvas

- เอา Use/Arrange ออก ลากหัวการ์ดได้ตลอด และเปิดเครื่องมือจาก Objects บน Canvas
- ปรับสี สัดส่วน ตัวอักษรและปุ่มเป็นชุดเดียวกัน ให้ความรู้สึกชิ้นส่วนบนโต๊ะ; ลดคำอธิบาย กรอบซ้อน และเครื่องมือซ้ำ
- เลือก record แล้วทำรายการต่อได้ตรงนั้น พร้อมล้างค่าที่ติดจาก record ก่อนหน้า; แสดงชื่อคนแทนรหัสที่รู้จัก
- ช่องแชทอยู่ใน Canvas พับประวัติได้ และต้องยินยอมใหม่เมื่อเปลี่ยนไฟล์/หลักฐานหรือส่ง AI อีกครั้ง
- เล่น Helpdesk จากไฟล์ใหม่ด้วย AI จริงจนจบสามงาน ผ่านสองบัญชีจำลอง และตรวจ auto demo ทั้งสามแบบพร้อมรับช่วงด้วยมือ ดู [ผลทดสอบและขอบเขต](docs/CALM_CANVAS_ACCEPTANCE.md) และ [ระบบภาพ](docs/CALM_CANVAS_DESIGN.md)

## 2026-10-19 — Canvas flow and Helpdesk checks

- เพิ่มสีและไอคอนตามบทบาทของวัตถุ เส้นลูกศรและแถบความสัมพันธ์ที่กดตามได้ พร้อม motion เมื่อ revision เปลี่ยนและการรองรับ reduced motion
- แสดงความคืบหน้า Draft → Simulate → Validate → Approve → Activate และขอบเขตผลตรวจบิลที่มี/ขาดหลักฐานให้ชัดขึ้น แก้พื้นที่ Canvas และแถบเครื่องมือจอแคบ
- required action text ปฏิเสธข้อความว่างและเว้นวรรคล้วน โดยยังเก็บข้อความที่ใช้ได้ตามที่ผู้ใช้กรอก
- เล่น Helpdesk จากไฟล์ใหม่ด้วย DeepSeek จริงจนจบสามงาน ผ่านสองบัญชีจำลองบน local รวมรับงาน ส่งตรวจ อนุมัติ เปิดกลับ และปิดแท็บกลับมาเล่นต่อ ดู [ผลและวิธีทดสอบซ้ำ](docs/CANVAS_HELPDESK_ACCEPTANCE.md)

## 2026-10-19 — team handoff

- เพิ่มคู่มือภาษาไทยสำหรับผู้เล่นและผู้พัฒนา ภาพหน้าจอ public demo ไฟล์ตัวอย่างสามโจทย์ และดัชนี deployment เอกสารเปลี่ยนได้โดยไม่ deploy แอปใหม่
- รวม implementation และเอกสารเข้า `main` ผ่าน [PR #2](https://github.com/Thanyers/tabletop/pull/2) แล้ว และปรับวิธี clone/ส่ง PR ให้เริ่มจาก main

## 2026-10-19 — prepared demo art (`f1725c8`)

- เพิ่มภาพรถและฉาก terrain ที่เตรียมไว้ให้ public interactive demo โดยคงการคำนวณ การเล่น และ pause/takeover เดิม
- ตรวจ staging และ production พร้อมไฟล์เว็บตรงกัน 131 ไฟล์ ดู [Deployment](docs/DEPLOYMENTS.md)

## 2026-10-19 — file-driven shared Canvas (`ba29062`)

- เพิ่ม Shared data table จากไฟล์ข้อความด้วยกฎแบบข้อมูล, reviewed AI drafts, multiplayer และ resume
- เพิ่มแชทส่วนตัวข้าง Canvas, บริบทล่าสุดแบบจำกัด และ action preview ที่ต้อง Confirm
- ตรวจสามโจทย์ด้วย Google สองบัญชีจริงบน staging และส่ง production พร้อม migration 0002 ที่รักษาข้อมูลเดิม ดู [acceptance](docs/GENERIC_TABLE_ACCEPTANCE.md)

## 2026-10-18 — initial Cloudflare alpha

- เปิด Google login, saved rooms, invitations, DeepSeek draft jobs และ durable budget ledger สำหรับสาม workflow เดิม ดู [บันทึกรุ่นแรก](docs/CLOUDFLARE_RELEASE.md)

- **F037 (ยังไม่ครบ — UI ยังไม่ทำ):** note card แบบ post-it เก็บใน `TableState.notes` แยกจาก program · คำสั่ง `table.addNote/updateNote/moveNote/removeNote` (ทุกสมาชิก) · จำกัด 20 โน้ต 500 ตัวอักษร 6 สี · ไม่ bump rule/data revision
