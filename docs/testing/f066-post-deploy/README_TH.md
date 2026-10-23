# F066 — ชุดทดสอบหลัง release/deploy

สถานะ: **เตรียมแล้ว / acceptance ยัง NOT_RUN ทั้ง 48 เคส** · วันที่เตรียม 2026-10-23 · ฐาน fixture/contract dev@910b0a3; sync เอกสารกับ dev@91fad1d แล้ว (ไม่ใช่ target ของรอบ hosted)

ผลรอบจริงแยกจาก template: [หลัง deploy 8.0.0](RELEASE8_RESULTS_TH.md) — 7 PASS / 4 FAIL / 36 BLOCKED / 1 SKIPPED_SCOPE; ไม่ใช่ 48 เคสที่รันสำเร็จ นิยามและ template ด้านล่างคงสถานะ NOT_RUN สำหรับเริ่มรอบใหม่

ชุดนี้เตรียมตามคำขอผู้ใช้สำหรับรันภายหลัง ไม่ใช่คำสั่งให้ release/deploy หรือเริ่มทดสอบ hosted ตอนนี้ เริ่มรอบจริงเมื่อผู้ใช้สั่งหลังมี release เป้าหมายแล้ว ครอบคลุม reusable compute/Rules และการเล่นเคสเดิม; ไม่รวมการไล่แก้ scene drag/camera นอกขอบเขต

## ไฟล์พร้อมใช้

- [cases.json](cases.json): รายการ 48 เคส พร้อม precondition, prompt, steps และ assertions
- [fixtures/](fixtures/): CSV สมมติ 15 ไฟล์ ทุกไฟล์เล็กกว่าเพดานและไม่มีข้อมูลธุรกิจจริง
- [expected.json](expected.json): ผลอ้างอิงที่คำนวณแยกจากคำตอบของ AI
- [results-template.json](results-template.json): สำเนาไปเก็บใน ignored test-results/post-deploy/<run>/ ก่อนเริ่ม แล้วบันทึก actual/evidence ตามจริง ไม่แก้ template เป็นผลจริงหรือ commit room/session identifiers
- [controlled-faults.json](controlled-faults.json): source ตัวอย่างสำหรับกรณีผิดรูปใน local/staging เท่านั้น ไม่มีสคริปต์ที่เรียก production หรือสั่ง deploy อัตโนมัติ

## ก่อนเริ่มรอบจริง

1. ยืนยัน URL/environment, /version และ tag/commit ที่ operator คาดหวัง หากไม่ตรงให้ BLOCKED ไม่ใช้การเปิดหน้าได้เป็นหลักฐานแทน
2. ระบุ engine ที่ release ตั้งใจเปิดไว้ล่วงหน้า JS-only หรือ JS+Python; Python ต้องมีทั้ง capability และ image ที่รันจริงได้ หากตั้งใจเปิดแต่หายให้ FAIL preflight และ BLOCKED dependent cases ถ้าไม่ได้ตั้งใจเปิดให้ SKIPPED_SCOPE รายเคส ไม่ถือว่า Python ผ่าน
3. ผู้ทดสอบใช้บัญชีทดสอบที่ได้รับสิทธิ์และสร้างห้องใหม่ชื่อ QA_F066_<run>_<case> แยก browser profiles เมื่อทดสอบหลายคน; สองแท็บ profile เดียวกันไม่ใช่สองบัญชี ห้ามใช้ห้องงานจริง/ข้อมูลจริง เก็บ IDs และ evidence จริงเฉพาะ ignored artifacts
4. แต่ละเคสเริ่ม input ชุดใหม่ตาม precondition อย่าให้ค่า405จากเคสก่อนหลุดไปเป็น baseline225ของเคสถัดไป ใช้สิทธิ์ที่ตั้งจริง ไม่ตัดสินจากชื่อ owner/participant เพราะระบบตั้งสิทธิ์กว้างได้
5. รัน P0 ก่อน (12 เคส) แล้วเคส engines/links/rerun/Rules ที่อยู่ใน release scope ต่อด้วยสิทธิ์และเคสเดิม; local-or-staging ให้แยกรอบจาก production hosted UI ไม่ทำ failure/timing injection บน production
6. ไม่ปิด safeguards หรือเพิ่มสิทธิ์บัญชีจริงเพื่อให้เคสผ่าน หาก timing/access/legacy upload ไม่พร้อม ให้ลงเหตุผล BLOCKED หรือ SKIPPED_SCOPE ตาม intended scope และรายงานจำนวนที่ข้ามเสมอ

## หลักตัดสินและหลักฐาน

- PASS ต่อเมื่อทำครบทุกขั้นและมี actual+evidence ของ assertions; FAIL เมื่อพบผลไม่ตรง; BLOCKED เมื่อเงื่อนไขไม่พร้อม; SKIPPED_SCOPE เมื่อไม่ได้อยู่ในขอบเขต release ที่ตกลง; ยังไม่ทำคือ NOT_RUN
- ตัวเลขเทียบ expected.json; เงินใช้ integer satang/half-up 2 ตำแหน่ง ตัวเลขสถิติใช้ absolute tolerance1e-6 วันที่ระบุชัดว่า ISOหรือday-first กรณีสุ่มตรวจช่วง/ผลserverแทนเดาหน้าลูกเต๋า
- AI ตอบว่าทำเสร็จ, ร่างผ่าน schema, HTTP200 หรือ screenshotอย่างเดียว ไม่ใช่หลักฐานว่ารันโปรแกรมถูก ต้องดู current compute run + input/revisions + authoritative result เท่าที่ผู้ทดสอบมีสิทธิ์ และเทียบค่าบนการ์ด
- แยก AI draft complete จาก compute succeeded; failed/stale ต้องไม่ถูกแสดงเป็นผลปัจจุบัน เก็บข้อผิดพลาดตามจริง ไม่สั่ง AI แก้จนผ่านแล้วลบผลรอบแรก
- การยืนยัน rerun ไม่เรียก AI: เปรียบเทียบ model-job IDs ก่อน/หลัง และถ้าจะอ้าง0 provider callsต้องมี server logs/ledger ที่มีสิทธิ์ตรวจ Browser networkมองไม่เห็น provider callsของbackendทั้งหมด ถ้ามีแค่jobcountให้รายงาน NO_NEW_MODEL_JOB และ providerCalls=UNVERIFIED
- เก็บภาพdesktop/mobile, input snapshot, module/version/bindings, runId/status/inputHash, revisions และผลอ่านกลับตามจำเป็น ลบ/ปิดบัง cookies,tokens,credentialsก่อนเก็บ/แชร์ ห้ามนำค่าจริงขึ้นrepo
- แต่ละเคสเริ่มห้องใหม่หรือระบุเคสก่อนหน้าชัดเจน; AppendและReplaceเป็นคนละการกระทำ ตารางderivedให้แก้rawinputแทนimportผลตรง
- visibilityของโต๊ะปัจจุบันเป็นopen ห้ามใช้ข้อความprivacyจากคู่มือR1เก่ามาอ้างว่าซ่อนsource/คำตอบ/โน้ตระหว่างสมาชิกได้ การปิดAdvancedในUIไม่ใช่ขอบเขตความลับ

## ความพร้อมสำหรับเคสควบคุมจังหวะ

PD-022/024/040 เป็นเคสมีเงื่อนไขใน local/staging; ชุดนี้ไม่ได้ติดตั้ง timing harness ให้ ก่อนรัน operator ต้องเตรียม QA runner ที่พักการส่งผลกลับ authority ได้และมีเหตุการณ์ started/runId ชัดเจน แนวทางมีอยู่ใน [orchestrator test](../../../server/table-compute-orchestrator.test.ts) กรณี “marks an in-flight result stale”: runner แจ้ง started แล้วรอ promise ก่อนคืนผล ไม่ใส่ delay/infinite loop ใน generated source หรือปรับ production

ขั้นตอน operator: 1) ยืนยันเครื่องมือและช่องทางปล่อยผลใน QA environment 2) เริ่ม run และเก็บหลักฐาน queued/running พร้อม input revision 3) ทำการเปลี่ยน input/กด Run ซ้ำ/ถอนสมาชิกตามเคส 4) ปล่อยผลและอ่านสถานะหลังจบ 5) ปิด QA timing control หลังรอบ ถ้าเครื่องมือไม่มีให้ BLOCKED (reason=TIMING_TOOL_UNAVAILABLE); ถ้ามีแต่จับช่วงไม่ได้ให้ BLOCKED (reason=TIMING) การรัน unit test เดิมไม่ใช้แทนผล acceptance นี้

เพดาน PD-029 ตรวจจาก [MAX_CHAT_CARD_REFERENCES](../../../src/tabletop/ui/canvas-object-finder.ts) และ [ตัวสะสม reference](../../../src/tabletop/ui/useTableChat.tsx): สูงสุดห้ารายการรวมการ์ด/กฎ การเพิ่มทีละรายการเก็บห้ารายการล่าสุด จึงตรวจ chips/context จริงโดยไม่ตั้งเกณฑ์ว่าต้องมี popup เตือน

## ผลอ้างอิงสำคัญ

| งาน | ผลที่ต้องได้ |
| --- | --- |
| sales v1 → v2 → v3 | 225 → 405 → 435 |
| Append40เข้าชุดv1 | 265 และ3แถว |
| discount10% + VAT7% | 225 → 202.50 → 216.68; 405 → 364.50 → 390.02 |
| pandas10ขั้น | raw6แถว; kept3; North200/South100; รวม300 |
| JavaScriptคะแนนเกม | 13 → 19 |
| NumPy | mean5, population variance5, std≈2.2360679775 |
| SciPy | slope2, intercept1, predictionที่5=11 |
| openpyxl/dateutil | ช่วงวันที่7 → 8วัน |
| join orders/products | 100+75+80=255 |
| เคสเดิม | Invoice155, Teaching4/10m, EncounterHP8/AP1→2, cafe3→8, water65+35=100 |

## รายการเคส

ผลตั้งต้นทุกเคสคือ NOT_RUN; คำว่า expected ด้านล่างเป็นเกณฑ์ทดสอบ ไม่ใช่ผลที่สังเกตแล้ว

### A — ก่อนเริ่มและเส้นทางแชท

#### F066-PD-001 — ยืนยัน build และขอบเขต release ที่จะทดสอบ

- Priority: P0 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: ได้รับ URL และ expected git tag/commit จาก release operator
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) อ่าน /version และ /api/capabilities แบบ read-only → 2) เทียบ build identity กับ release record; จด engine ที่คาดว่าจะเปิดก่อนเริ่ม
- Expected: version ตรงเป้าหมาย; ถ้าไม่ตรงให้ BLOCKED ทั้งรอบ ไม่ใช้หน้าที่โหลดได้เป็นหลักฐานว่า build ถูก · แยก intended scope: JS-only หรือ JS+Python ไว้ในผลรอบนี้

#### F066-PD-002 — JavaScript capability ตรงกับสิ่งที่เปิดใช้

- Priority: P0 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ผ่าน 001 และ release ตั้งใจเปิด JavaScript
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) อ่าน compute.profile/runtimes จาก capability endpoint → 2) ตรวจ Rules > What this table can do และลองเคส 008
- Expected: profile เป็น tabletop-compute-1 และ runtimes มี javascript · UI มี Reusable calculations; ต้องมีผลรันจริงจาก 008 จึงยืนยัน execution ไม่ใช่ตรวจ flag อย่างเดียว

#### F066-PD-003 — Python capability และ image พร้อมใช้งานจริง

- Priority: P1 · Scope: hosted-ui · Engine: python · Status: **NOT_RUN**
- ก่อนเริ่ม: operator ระบุว่า release นี้ตั้งใจเปิด Python; ถ้าไม่เปิดให้ SKIPPED_SCOPE
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) อ่าน runtimes/pythonLibraries → 2) ทำเคส 009–012; ตรวจผลและ source ที่ใช้ package จริง
- Expected: มี python และรายการ pandas/numpy/scipy/openpyxl/dateutil ตาม profile · flag มีแต่รันไม่ได้เป็น FAIL provisioning; เคส Python ที่ตามมาเป็น BLOCKED ไม่ใช่ PASS

#### F066-PD-004 — ถามข้อมูลอย่างเดียวไม่แก้กฎหรือข้อมูล

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ใหม่ มี raw sales ตาม sales-v1.csv; quantity/unit_price เป็น number; input ของการคำนวณผูก collection sales
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ข้อความพร้อมส่ง: “ยอดรวมตอนนี้เท่าไร และคิดอย่างไร ขอคำอธิบายอย่างเดียว”
- ขั้นตอน: 1) จด raw rows, rule/data revision และ active program ก่อนถาม → 2) ส่งคำถามแล้วอ่านคำตอบ; เทียบสถานะหลังตอบ
- Expected: คำตอบอธิบาย 225 จาก 75+150 · ไม่มีการแก้ raw rows, active rule หรือสร้าง compute module ใหม่
- Oracle: [expected.json](expected.json) → `sales.initial`

#### F066-PD-005 — เริ่มจากโจทย์โดยไม่มีไฟล์ แล้วเติมข้อมูลทีหลัง

- Priority: P0 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ว่าง ไม่แนบไฟล์ตอนส่งโจทย์
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ข้อความพร้อมส่ง: “สร้างเครื่องมือยอดขายเปล่า มี branch, product, quantity, unit_price และยอดรวม ฉันจะนำข้อมูลเข้าทีหลัง ไม่ต้องใส่ข้อมูลสมมติแทนข้อมูลฉัน”
- ขั้นตอน: 1) รอร่างและการเปิดใช้; ดู assumptions/ชนิด fields → 2) นำ sales-v1.csv เข้า raw sales แล้วดูผล
- Expected: เริ่มเครื่องมือได้จาก intent และไม่มีการสร้างยอดจริงปลอมขึ้นมา · หลังนำเข้าข้อมูลยอดเป็น 225 และ raw rows 2 แถว
- Oracle: [expected.json](expected.json) → `sales.initial`

#### F066-PD-006 — ถามเพิ่มเมื่อโจทย์ไม่พอและเก็บบริบทคำตอบ

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ว่าง
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ข้อความพร้อมส่ง: “ช่วยทำเครื่องมือให้หน่อย”
- ขั้นตอน: 1) หาก AI ถามเพิ่ม ให้เลือกตัวเลือกหรืออธิบายว่าต้องการเครื่องมือยอดขาย quantity × unit_price → 2) รอเครื่องมือที่ใช้ได้ ตรวจว่าคำตอบอ้างกลับคำถามเดิมถูก
- Expected: เมื่อถามเพิ่มมีคำถาม/ตัวเลือกที่ตอบได้ และไม่เปิดกฎที่เดาโดยไม่มีโจทย์ · แสดงคำถามเดียวพร้อม3ตัวเลือกก่อนสร้างกฎ; หลังตอบบริบทไม่หาย ถ้าเดาเปิดเครื่องมือจากโจทย์นี้ก่อนถามให้FAILและเก็บหลักฐาน

### B — สูตร ภาษา และ libraries

#### F066-PD-007 — งานเล็กใช้สูตรและเปลี่ยนส่วนลดได้

- Priority: P0 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ใหม่ มี raw sales ตาม sales-v1.csv; quantity/unit_price เป็น number; input ของการคำนวณผูก collection sales
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ข้อความพร้อมส่ง: “เพิ่มยอดหลังส่วนลด โดยเริ่มส่วนลด 10% และปรับเปอร์เซ็นต์ได้ งานนี้ใช้สูตรที่มีได้”
- ขั้นตอน: 1) ดูยอด 225 และหลังส่วนลด 202.50 → 2) ปรับส่วนลดเป็น 20% แล้วดูยอด 180
- Expected: สูตรผูกข้อมูลและตัวควบคุมจริง ไม่คัดลอกตัวเลขสำเร็จลง literal · ไม่มีเหตุให้บังคับเปิด Python สำหรับสูตรง่ายนี้
- Oracle: [expected.json](expected.json) → `sales.initial`

#### F066-PD-008 — JavaScript คำนวณคะแนนเกมที่ไม่ได้ใช้ pandas

- Priority: P0 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA มี scores: player=text, score=number
- ข้อมูล: [scores-v1.csv](fixtures/scores-v1.csv), [scores-v2.csv](fixtures/scores-v2.csv)
- ข้อความพร้อมส่ง: “ใช้ JavaScript standard library เก็บโปรแกรมคะแนนเกม: นำคะแนนสูงสุดสองคนมารวม แสดงผู้ได้คะแนนสูงสุดและผลรวม เปลี่ยนคะแนนแล้วคำนวณใหม่; อย่าเรียก npm”
- ขั้นตอน: 1) นำ scores-v1.csv เข้าแล้วดูผล 13 → 2) Replace ด้วย scores-v2.csv แล้วดูผล 19; ตรวจ source และ run ใหม่
- Expected: เป็น javascript module ที่รันสำเร็จตาม profile · raw score rows ไม่ถูก reorder/แก้ค่าจากการ sort ในโปรแกรม; ผล 13 → 19
- Oracle: [expected.json](expected.json) → `game`

#### F066-PD-009 — pandas เตรียมข้อมูลสิบขั้นพร้อมสรุปสาขา

- Priority: P0 · Scope: hosted-ui · Engine: python · Status: **NOT_RUN**
- ก่อนเริ่ม: raw transactions เก็บทั้ง 6 แถว; transaction_id ไม่ตั้ง unique เพราะต้องทดสอบ dedupe ในผล derived
- ข้อมูล: [transactions.csv](fixtures/transactions.csv)
- ข้อความพร้อมส่ง: “ใช้ Python/pandas เก็บวิธีทำงาน 10 ขั้น: trim ข้อความ, normalize ชื่อสาขาเป็น North/South, normalize status เป็นตัวเล็ก, ตรวจ numeric, parse ISO date, dedupe transaction_id, กรอง paid, คิด quantity × unit_price, group/sort ยอดสาขา, คิดสัดส่วนและส่งยอดรวมกับตารางสาขา อย่าแก้ raw rows”
- ขั้นตอน: 1) เปิดใช้แล้วตรวจ source/inputs/output schema และ run สำเร็จ → 2) เทียบยอด/จำนวน/ลำดับสาขากับ expected.json; ดู raw 6 แถวยังอยู่
- Expected: เหลือรายการ paid ที่ไม่ซ้ำ 3 รายการ ยอดรวม 300; North=200, South=100 · ลำดับ North/South และสัดส่วน 66.67/33.33; raw records ไม่ถูกลบหรือแก้
- Oracle: [expected.json](expected.json) → `clean`

#### F066-PD-010 — NumPy คำนวณหลายสถิติจาก input เดียว

- Priority: P1 · Scope: hosted-ui · Engine: python · Status: **NOT_RUN**
- ก่อนเริ่ม: collection vector.value เป็น number
- ข้อมูล: [vector.csv](fixtures/vector.csv)
- ข้อความพร้อมส่ง: “ใช้ Python/NumPy คำนวณ count, sum, mean, population variance และ population standard deviation (ddof=0) จาก vector ส่งเป็นหลาย outputs ให้การ์ด”
- ขั้นตอน: 1) ตรวจ source import numpy และโค้ดใช้ข้อมูล input → 2) เทียบทั้งห้าค่ากับ oracle ภายใน tolerance 1e-6
- Expected: count=4, sum=20, mean=5, variance=5, std≈2.2360679775 · เป็น run สำเร็จจริงและชนิดผล number ไม่ใช่ข้อความ
- Oracle: [expected.json](expected.json) → `numpy`

#### F066-PD-011 — SciPy ทำ linear regression และส่งผลให้หลายการ์ด

- Priority: P1 · Scope: hosted-ui · Engine: python · Status: **NOT_RUN**
- ก่อนเริ่ม: collection statistics มี numeric x,y
- ข้อมูล: [statistics.csv](fixtures/statistics.csv)
- ข้อความพร้อมส่ง: “ใช้ scipy.stats.linregress กับ x,y ในข้อมูล แสดง slope, intercept และ prediction เมื่อ x=5 โดยให้ input x ใหม่ปรับได้”
- ขั้นตอน: 1) ตรวจ source ใช้ scipy จริงและรันสำเร็จ → 2) ตรวจค่า slope/intercept และเปลี่ยน prediction input จาก 5 เป็น 6
- Expected: slope=2, intercept=1; prediction 11 → 13 · ไม่สร้างคำตอบตายตัวและไม่เรียกเว็บเพื่อคำนวณ
- Oracle: [expected.json](expected.json) → `scipy`

#### F066-PD-012 — openpyxl และ dateutil ใช้ได้จริงภายในตัวรัน

- Priority: P1 · Scope: hosted-ui · Engine: python · Status: **NOT_RUN**
- ก่อนเริ่ม: raw dates มี event_id/date_text เป็น text
- ข้อมูล: [dates-v1.csv](fixtures/dates-v1.csv), [dates-v2.csv](fixtures/dates-v2.csv)
- ข้อความพร้อมส่ง: “ใช้ openpyxl สร้าง workbook ในหน่วยความจำจาก rows แล้วอ่านกลับ ใช้ dateutil: ISO ใช้ isoparse; รูปวัน/เดือน/ปีอื่นให้ dayfirst=True แสดงวัน ISO และช่วงวันมากสุด-น้อยสุด ไม่ต้องสร้างไฟล์ดาวน์โหลด”
- ขั้นตอน: 1) ตรวจ source เรียกทั้งสอง library จริง → 2) นำ dates-v1 แล้ว Replace dates-v2 และเทียบวัน/ช่วงวัน
- Expected: วันที่ v1 เป็น 2026-10-01/03/08 และ span=7; v2 ลงท้าย 09 และ span=8 · ผลต่อการ์ดเป็นค่าหรือตารางตาม contract; ไม่ใช้การไม่มี download เป็น FAIL ของเคสนี้
- Oracle: [expected.json](expected.json) → `dates`

### C — input/output และการเชื่อมการ์ด

#### F066-PD-013 — metric อ่านผล backend เดียวกับการ์ดคำนวณ

- Priority: P0 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ใหม่ มี raw sales ตาม sales-v1.csv; quantity/unit_price เป็น number; input ของการคำนวณผูก collection sales
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-v2.csv](fixtures/sales-v2.csv)
- ข้อความพร้อมส่ง: “สร้างเครื่องมือยอดขายจาก sales คำนวณ quantity × unit_price ต่อแถวและรวมยอด มีการ์ดยอดรวมและตารางต้นทาง ค่าต้องคำนวณจาก input จริง ไม่ใส่คำตอบตายตัว ใช้ JavaScript module และเชื่อม output gross กับ metric”
- ขั้นตอน: 1) ตรวจ total ใน compute card, metric และ authoritative readback → 2) Replace เป็น v2 แล้วเทียบทุกจุดอีกครั้ง
- Expected: ทั้งสามจุดเป็น 225 แล้วเป็น 405 จาก current run เดียวกัน · เก็บค่าใน UI และ readback ที่ผู้ทดสอบมีสิทธิ์: module/version, input binding, data/rule revision, runId/status/inputHash; ห้ามเก็บ cookie/token
- Oracle: [expected.json](expected.json) → `sales.replaced`

#### F066-PD-014 — กราฟอ่าน derived table ไม่ค้างตัวเลขตัวอย่าง

- Priority: P1 · Scope: hosted-ui · Engine: python · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ใหม่ มี raw sales ตาม sales-v1.csv; quantity/unit_price เป็น number; input ของการคำนวณผูก collection sales
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-v2.csv](fixtures/sales-v2.csv)
- ข้อความพร้อมส่ง: “ใช้ pandas สรุปยอดตามสาขาเป็น derived table และผูก bar chart จากตารางนั้น ให้แสดงจำนวนจริงทุกครั้งที่ sales เปลี่ยน”
- ขั้นตอน: 1) ดู bars North75/South150 → 2) Replace v2 แล้วดู bars North105/South300 เทียบ underlying derived rows
- Expected: กราฟและตารางตรงกันและรวมได้ 225 → 405 · source sales ไม่ถูกเขียนทับ
- Oracle: [expected.json](expected.json) → `sales.replaced`

#### F066-PD-015 — join สอง inputs แล้วส่งตารางผล

- Priority: P1 · Scope: hosted-ui · Engine: python · Status: **NOT_RUN**
- ก่อนเริ่ม: สอง raw collections products/orders; product_id join แบบ one-to-many ที่ระบุไว้
- ข้อมูล: [products.csv](fixtures/products.csv), [orders.csv](fixtures/orders.csv)
- ข้อความพร้อมส่ง: “ใช้ pandas join orders กับ products ตาม product_id ตรวจว่าทุกรายการมีราคา สร้าง derived order totals และ metric ยอดรวม ห้ามแทนราคาที่ไม่พบด้วยศูนย์”
- ขั้นตอน: 1) ผูกสอง inputs ให้ถูก collection → 2) ตรวจสามบรรทัดและยอดรวม รวมทั้ง raw collections หลังรัน
- Expected: ผลต่อบรรทัด 100/75/80 รวม 255 · มี lineage จากทั้งสอง input และ raw collections เดิมไม่เปลี่ยน
- Oracle: [expected.json](expected.json) → `joined`

#### F066-PD-016 — module ต่อกันหลายขั้นและรันตามลำดับ

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ใหม่ มี raw sales ตาม sales-v1.csv; quantity/unit_price เป็น number; input ของการคำนวณผูก collection sales
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-v2.csv](fixtures/sales-v2.csv)
- ข้อความพร้อมส่ง: “สร้าง 3 modules: A gross sales; B รับ output A แล้วลด 10%; C รับ B แล้วเพิ่ม VAT สมมติ 7% ปัด half-up 2 ตำแหน่ง ส่งแต่ละผลให้ metric คนละใบ”
- ขั้นตอน: 1) ตรวจ bindings A → B → C และ run lineage → 2) Replace v2 แล้วดูผลทุกใบ
- Expected: 225 → 202.50 → 216.68; หลังเปลี่ยนเป็น 405 → 364.50 → 390.02 · B/C ไม่ใช้ upstream run เก่าเป็นผลปัจจุบัน
- Oracle: [expected.json](expected.json) → `sales.replaced`

#### F066-PD-017 — หนึ่งโปรแกรมมีหลาย output และหลายการ์ด

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ใหม่ มี raw sales ตาม sales-v1.csv; quantity/unit_price เป็น number; input ของการคำนวณผูก collection sales
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ข้อความพร้อมส่ง: “เก็บโปรแกรมเดียว มี helper functions ได้ คืน gross, rowCount, meanLineAmount ให้สาม metrics ไม่ต้องแยกเป็นหนึ่งสคริปต์ต่อหนึ่งการ์ด”
- ขั้นตอน: 1) เปิด Advanced ตรวจหนึ่ง module/สาม output bindings → 2) เทียบค่าของทั้งสามการ์ดกับ run เดียวกัน
- Expected: gross225, rowCount2, meanLineAmount112.5 · ไม่มีการเรียก AI หนึ่งครั้งต่อการ์ดเมื่อคำนวณซ้ำ
- Oracle: [expected.json](expected.json) → `sales.initial`

#### F066-PD-018 — เปลี่ยนแหล่ง input โดยอ้างกฎให้ตรงใบ

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: สอง collections ชื่อ sales/current และ sales_next; ข้อมูล 225 และ 405 ตามลำดับ
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-v2.csv](fixtures/sales-v2.csv)
- ข้อความพร้อมส่ง: “เลือก Change this rule ของ module ยอดรวม: เปลี่ยน input ไป sales_next เท่านั้น โดยไม่เปลี่ยนสูตรหรือข้อมูลตารางเดิม”
- ขั้นตอน: 1) ก่อนแก้บันทึก module version/binding และสอง collections → 2) ขอแก้ผ่านกฎรายข้อ แล้วตรวจ binding/version/current result
- Expected: input ย้ายตามคำขอ ผล405; raw สอง collections ไม่เปลี่ยน · source/version ของ module อื่นที่ไม่เกี่ยวไม่ถูกแก้; ไม่อ้างว่าการแนบไฟล์ใหม่ทำให้ binding เก่าเปลี่ยนเอง
- Oracle: [expected.json](expected.json) → `sales.replaced`

### D — คำนวณซ้ำและความต่อเนื่อง

#### F066-PD-019 — Replace input แล้วรันโปรแกรมเดิมโดยไม่เรียก AI

- Priority: P0 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ใช้ห้อง QA ที่สร้างจากเคส 013 สำเร็จแล้ว หรือสร้างใหม่ด้วยโจทย์เดียวกัน; ทุกเคสเริ่ม sales-v1.csv ใหม่ยกเว้นระบุไว้
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-v2.csv](fixtures/sales-v2.csv)
- ขั้นตอน: 1) จด module source/version, model-job list และ compute run ก่อนเปลี่ยน → 2) นำ v2 เข้า raw sales ด้วย Replace และยืนยัน แล้วรอ current result
- Expected: 225 → 405; source/version เดิม, run/inputHash ใหม่, raw 2 แถวตาม v2 · ไม่มี model job ใหม่; การอ้าง 0 provider calls ต้องมี server/ledger evidence ตามคู่มือ
- Oracle: [expected.json](expected.json) → `sales.replaced`

#### F066-PD-020 — reload และกลับเข้าห้องด้วยบัญชีเดิม

- Priority: P0 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA ที่เคส 019 ผ่านและผล current405
- ข้อมูล: [sales-v2.csv](fixtures/sales-v2.csv)
- ขั้นตอน: 1) reload หน้า จากนั้นปิดแท็บและเปิด URL ห้องเดิมอีกครั้ง → 2) ตรวจนิยาม/ข้อมูล/current result และประวัติ run
- Expected: โปรแกรม รุ่น binding raw rows และผล405ยังอยู่ · ไม่เกิด AI draft ใหม่เพียงเพราะ reload; ถ้า runtime กู้ interrupted run ให้แยกจากการสร้างโปรแกรมใหม่
- Oracle: [expected.json](expected.json) → `sales.replaced`

#### F066-PD-021 — Append เป็นค่าเริ่มต้นและ Replace ต้องยืนยัน

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ใช้ห้อง QA ที่สร้างจากเคส 013 สำเร็จแล้ว หรือสร้างใหม่ด้วยโจทย์เดียวกัน; ทุกเคสเริ่ม sales-v1.csv ใหม่ยกเว้นระบุไว้
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-append.csv](fixtures/sales-append.csv), [sales-v2.csv](fixtures/sales-v2.csv)
- ขั้นตอน: 1) นำ sales-append.csv เข้าโดย Append: ต้องรวมเป็น 3 แถว → 2) เปิด Replace v2 แล้ว Cancel: สถานะไม่เปลี่ยน จากนั้นทำ Replace และยืนยัน
- Expected: 225 → 265 หลัง Append; Cancel คง265; ยืนยัน Replace ได้405และ2แถว · ไม่มีการทับข้อมูลจากการเปิด preview อย่างเดียว
- Oracle: [expected.json](expected.json) → `sales.appendedToInitial`

#### F066-PD-022 — ข้อมูลเปลี่ยนระหว่างรัน ผลเก่าไม่เป็น current

- Priority: P1 · Scope: local-or-staging · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ใช้เครื่องมือควบคุม timing ใน local/staging เท่านั้น; ต้องพิสูจน์ว่ารัน v2 ยังไม่จบตอนรับ v3; ต้องมี local/staging QA runner ที่หยุดก่อนส่งผลกลับ authority และแจ้ง runId/started ได้; pack นี้ไม่ได้ติดตั้ง timing harness ให้ หากไม่มีให้ BLOCKED (reason=TIMING_TOOL_UNAVAILABLE)
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-v2.csv](fixtures/sales-v2.csv), [sales-v3.csv](fixtures/sales-v3.csv)
- ขั้นตอน: 1) เริ่มจาก225 เปลี่ยนเป็นv2 แล้วรับv3ขณะ run v2 ค้าง → 2) ปล่อยงานจบและอ่าน run statuses/input revisions กับทุกการ์ด
- Expected: ผลสุดท้าย435จาก v3; run v2 เก่าเป็น stale หรือถูกปฏิเสธตาม authority · ถ้าจับช่วง in-flight ไม่ได้ ให้ BLOCKED (reason=TIMING) ไม่รายงาน PASS จากการแก้สองครั้งตามลำดับ
- Oracle: [expected.json](expected.json) → `sales.latest`

#### F066-PD-023 — runtime error ไม่ทำลาย input หรือแสดงผลเก่าว่าสด

- Priority: P1 · Scope: local-or-staging · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: local/staging QA room; มีผล225แล้ว ใช้ controlled-faults.json แบบ throw-error เพิ่ม module version ผ่าน Advanced ที่ได้รับสิทธิ์
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ขั้นตอน: 1) เปิดใช้ version ที่ throw แบบจำกัด แล้ว Run หนึ่งครั้ง → 2) ดู failure, raw rows และการแสดงผลก่อนหน้า
- Expected: run ใหม่ failed มีข้อความที่เข้าใจได้; raw rows ยังเดิม · 225 เดิมถ้าแสดง ต้องระบุเป็นผลก่อนหน้า และไม่มีการเรียก AI ซ่อมเอง
- Oracle: [expected.json](expected.json) → `sales.initial`

#### F066-PD-024 — กด Run ซ้ำขณะ module เดียวกันยัง pending

- Priority: P1 · Scope: local-or-staging · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: local/staging ใช้ timing control ที่ระบุช่วง queued/running ได้; ไม่ใช้ infinite loop หรือ load test; ต้องมี local/staging QA runner ที่หยุดก่อนส่งผลกลับ authority และแจ้ง runId/started ได้; pack นี้ไม่ได้ติดตั้ง timing harness ให้ หากไม่มีให้ BLOCKED (reason=TIMING_TOOL_UNAVAILABLE)
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ขั้นตอน: 1) จด pending runId แล้วกด Run ซ้ำขณะงานนั้นยังทำอยู่ → 2) ปล่อยงานจบและอ่าน history/command result
- Expected: ไม่มีงาน pending ซ้ำสำหรับ module เดียวกัน; UI disable หรือ server ปฏิเสธอย่างชัดเจน · ผลสุดท้าย225; ถ้าไม่พิสูจน์ช่วง pending ให้ BLOCKED (reason=TIMING)
- Oracle: [expected.json](expected.json) → `sales.initial`

### E — Rules สำหรับคนใช้ทั่วไป

#### F066-PD-025 — Rules อธิบายงานโดยไม่ต้องอ่าน source

- Priority: P0 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA มียอดรวม/derived table ที่ทำงานแล้ว
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ขั้นตอน: 1) เปิด Rules ในมุมมองเริ่มต้น → 2) ผู้ทดสอบชี้ชื่อกฎ วัตถุประสงค์ input output และการ์ดปลายทางจากข้อความที่แสดง
- Expected: เข้าใจเส้นทางข้อมูลได้ก่อนเปิด Advanced; ชื่อเป็นภาษาคนใช้ · บันทึกข้อสงสัยของคนทดสอบตามจริง; แค่มี labels ไม่ถือว่าผ่าน human comprehension โดยอัตโนมัติ

#### F066-PD-026 — Advanced ดูภาษา version และ source ได้ตามสิทธิ์

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ผู้ทดสอบมี rules.draft และมี module ทำงานแล้ว
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ขั้นตอน: 1) เปิด Advanced ของ module → 2) เทียบภาษา/profile/version/source/ports กับนิยามที่ authority เก็บ
- Expected: ข้อมูลตรงกันและ source ไม่บังการใช้งานปกติเมื่อพับ · การซ่อน source ทาง UI ไม่ถูกอ้างว่าเป็น privacy boundary ภายใต้ open visibility

#### F066-PD-027 — Ask รายกฎได้คำตอบอ้างกฎที่เลือก

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: มีกฎยอดรวมและกฎส่วนลดคนละข้อ
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ข้อความพร้อมส่ง: “กด Ask ที่กฎส่วนลด แล้วถาม: กฎนี้รับอะไรและเปลี่ยนผลตรงไหน”
- ขั้นตอน: 1) ตรวจ reference chip และส่งคำถาม → 2) อ่านคำตอบแล้วเทียบ raw rows/program/revisions
- Expected: คำตอบอ้างกฎส่วนลดที่เลือก ไม่สลับเป็นยอดรวม · ไม่มีการแก้กฎหรือข้อมูลจากการถามอย่างเดียว

#### F066-PD-028 — Change this rule แก้เฉพาะกฎที่ระบุ

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: มี module gross และ discount10%; บันทึก IDs/versions/source ก่อนเริ่ม
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ข้อความพร้อมส่ง: “เลือก Change this rule ของ discount แล้วขอเปลี่ยนเป็น 20% เท่านั้น”
- ขั้นตอน: 1) ส่งคำขอจาก reference chip แล้วรอการตรวจร่าง → 2) เทียบ source/versions และ outputs ก่อน/หลัง
- Expected: ผลหลังส่วนลด225เป็น180; grossยัง225 · module ที่แก้เพิ่ม version; modules/raw data ที่ไม่เกี่ยวคงเดิม และ downstream ที่ผูกมันคำนวณตามใหม่
- Oracle: [expected.json](expected.json) → `sales.initial`

#### F066-PD-029 — อ้างหลายการ์ด/กฎร่วมกันและไม่เกินห้ารายการ

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA มี objects/rules อย่างน้อยหกรายการ; เพดานปัจจุบันมาจาก MAX_CHAT_CARD_REFERENCES ใน src/tabletop/ui/canvas-object-finder.ts
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ข้อความพร้อมส่ง: “เลือกอ้างกฎ/การ์ดห้ารายการแล้วขออธิบายความสัมพันธ์ ไม่แก้ข้อมูล”
- ขั้นตอน: 1) ดู chips ว่าตรงกับสิ่งที่เลือกทั้งห้า → 2) เพิ่มรายการที่หกทีละรายการ: chip เก่าสุดหลุดออก เหลือห้ารายการล่าสุด; ตรวจว่า prompt/context ตรงกับ chips ไม่มี ref แอบแฝง
- Expected: รวม card/rule references ไม่เกิน5; การเพิ่มทีละรายการเก็บห้ารายการล่าสุดตาม useTableChat.tsx ไม่บังคับว่าต้องมีข้อความเตือน · คำถามอ้างสิ่งที่เลือกจริง และไม่มี state mutation

#### F066-PD-030 — Rules บนจอแคบและใช้คีย์บอร์ด

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: ห้อง QA มี Rules ยาว; browser viewport 320px และ desktop ที่ใช้จริง
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) เปิด/เลื่อน Rules และ Advanced ด้วยคีย์บอร์ด → 2) เข้าถึง Ask/Change และกลับ composer ได้; ดูจอ320px
- Expected: อ่านและเลื่อนเนื้อหาได้ ปุ่มไม่ถูกบัง และไม่มี page-level horizontal overflow · ไม่ใช้ force-click; เคสนี้ไม่รวม scene drag/camera investigation

### F — ชนิดข้อมูลและผลผิดรูป

#### F066-PD-031 — ข้อมูล numeric ผิดชนิดต้องไม่ import บางส่วน

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ใช้ห้อง QA ที่สร้างจากเคส 013 สำเร็จแล้ว หรือสร้างใหม่ด้วยโจทย์เดียวกัน; ทุกเคสเริ่ม sales-v1.csv ใหม่ยกเว้นระบุไว้
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-invalid.csv](fixtures/sales-invalid.csv)
- ขั้นตอน: 1) จด raw rows/revisions แล้วนำ sales-invalid.csv เข้า raw sales → 2) ตรวจ preview/errors และผลหลังส่งถ้าระบบยอมให้ลอง
- Expected: not-a-number ไม่ถูกเงียบแปลงเป็น0; การนำเข้าถูกปฏิเสธพร้อมเหตุผล · แถว s3 ที่ถูกต้องในไฟล์เดียวกันไม่หลุด commit แค่บางส่วน; total/rawยัง225
- Oracle: [expected.json](expected.json) → `sales.initial`

#### F066-PD-032 — required input หายไม่กลายเป็นศูนย์

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: sales.quantity เป็น required; ไม่กำหนด default0
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv), [sales-missing.csv](fixtures/sales-missing.csv)
- ขั้นตอน: 1) จด baseline แล้วนำไฟล์ที่ quantity ว่างเข้า → 2) ตรวจการแจ้งเตือนและ raw rows หลังลอง
- Expected: missing quantity ถูกระบุว่าไม่ครบ; ไม่สร้างผลเหมือนรับ quantity0 สำเร็จ · ไม่มี partial commit หรือแทนข้อมูลดีเดิมโดยไม่แจ้ง

#### F066-PD-033 — ชนิด output ไม่ตรงสัญญาถูกปฏิเสธ

- Priority: P1 · Scope: local-or-staging · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: local/staging: controlled-faults wrong-output-type; declared total=number แต่ codeคืนtext
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) เปิดใช้ controlled module ตาม procedure แล้ว Run → 2) เทียบ declared output, actual run status และ metric
- Expected: run failed/invalid output; ไม่แสดง text เป็น numeric result สำเร็จ · program อื่นและข้อมูลต้นทางไม่ถูกแก้

#### F066-PD-034 — NaN/Infinity ไม่ถูกส่งเป็นค่าถูกต้องหรือ null ปลอม

- Priority: P1 · Scope: local-or-staging · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: local/staging: controlled-faults non-finite-number; total declarednumber
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) Run module ที่คืน Infinity แล้วดูสถานะ → 2) ถ้าทดสอบ Pythonเพิ่ม ให้แยกผลของ float NaN เป็น subcaseที่มีevidenceจริง
- Expected: output ไม่ผ่าน finite JSON contract; run failed · ไม่มี metric อ้างสำเร็จด้วย0/nullจากการแปลงแบบเงียบ

#### F066-PD-035 — ขอ library ที่ไม่ได้ติดตั้ง

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: จดรายการ capabilities ของ release ก่อนเริ่ม
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ข้อความพร้อมส่ง: “อยากใช้ Polars ที่นี่ ถ้าเครื่องไม่มีให้บอกข้อจำกัดและใช้ engine/library ที่มีทำยอดขายแบบเดียวกัน ห้ามติดตั้งเพิ่มระหว่างรัน”
- ขั้นตอน: 1) ส่งโจทย์และดูคำอธิบาย/source/runtime ที่เลือก → 2) ถ้ามีโปรแกรมถูกสร้างให้ตรวจ runจริงและผลจาก sales fixtureเมื่อใช้
- Expected: ไม่อ้างว่าติดตั้งหรือใช้ Polars สำเร็จทั้งที่ไม่อยู่ใน image · อาจเสนอทางเลือกที่มีจริงหรือแจ้งข้อจำกัด; runtime failureต้องแสดงตรงตามจริง ไม่อ้างว่าคำนวณเสร็จ

#### F066-PD-036 — วงจร dependencies ถูกกันก่อนเปิดใช้

- Priority: P1 · Scope: local-or-staging · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: local/staging QA room มีโปรแกรมดีเดิม; ผู้ทดสอบแก้ candidate ผ่าน Advanced ที่ได้รับสิทธิ์
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) สร้าง candidate A รับ B และ B รับ A โดยใช้schemaปัจจุบัน → 2) ลองตรวจ/เปิดใช้ แล้วอ่าน active program/revision
- Expected: เกิดข้อความ cycle/rejected ก่อนเรียก runner; ไม่มีร่างวงจรกลายเป็น active · active program/ข้อมูลดีเดิมคงอยู่

### G — สิทธิ์และขอบเขตการรัน

#### F066-PD-037 — ผู้ดูที่ปิดสิทธิ์แก้กฎแก้ไม่ได้จริง

- Priority: P0 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: สร้าง QA member แยกbrowser; ปิด rules.draft/rules.approve ผ่าน permission UI ในห้องQA; อย่าอิงชื่อ role เพราะ defaultอาจให้สิทธิ์กว้าง
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ข้อความพร้อมส่ง: “ในบัญชีผู้ดู ลองขอเปลี่ยนกฎ”
- ขั้นตอน: 1) ตรวจว่า UI ไม่ให้เริ่มแก้ และลองคำขอที่รองรับตามบัญชีนั้น → 2) ownerตรวจ active program/revisions หลังลอง
- Expected: ผู้ไม่มีสิทธิ์แก้กฎไม่ทำให้กฎเปลี่ยน แม้เรียก actionเดิมที่ยังได้รับสิทธิ์ได้ · หากตั้ง test permissionไม่ได้ให้BLOCKED_SETUP ไม่สรุปจากคำว่าparticipant

#### F066-PD-038 — ดูผลได้แต่กดคำนวณไม่ได้เมื่อปิด data.compute

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: QA memberได้รับอ่านห้องแต่ data.compute=false; ownerมีสิทธิ์และผล225แล้ว
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ขั้นตอน: 1) memberอ่านผล225แล้วลองmanualRun → 2) ownerตรวจ run historyก่อน/หลังและผลเดิม
- Expected: ผลอ่านได้ตามvisibilitypolicy แต่memberเริ่มrunที่ไม่ได้รับสิทธิ์ไม่ได้ · ไม่มี pendingrunใหม่จากคำขอที่ถูกปฏิเสธ
- Oracle: [expected.json](expected.json) → `sales.initial`

#### F066-PD-039 — สองคนแก้ input แล้วทั้งคู่เห็นผลล่าสุดตรงกัน

- Priority: P1 · Scope: hosted-ui · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: ownerกับmemberแยกsessionและมีdata.writeตามscope QA
- ข้อมูล: [sales-v1.csv](fixtures/sales-v1.csv)
- ขั้นตอน: 1) Aเปลี่ยน s1.unit_price เป็น35; Bเปลี่ยน s2.quantityเป็น10ในช่วงใกล้กัน → 2) ถ้าเจอconflictให้refreshแล้วretryอย่างชัดเจนจนทั้งสองค่าถูกรับ จากนั้นอ่านทั้งสองจอ
- Expected: ไม่มีการสูญหายเงียบ; conflict/การretryบันทึกไว้ตามจริง · สถานะสุดท้ายสอดคล้องกัน s1=105,s2=300,total405จากcurrentrevision
- Oracle: [expected.json](expected.json) → `sales.replaced`

#### F066-PD-040 — ถอนสมาชิกระหว่าง actor-bound run

- Priority: P1 · Scope: local-or-staging · Engine: javascript · Status: **NOT_RUN**
- ก่อนเริ่ม: local/staging: moduleรับactor/seatจากhost, memberมีสิทธิ์รัน; มีtimingcontrolพิสูจน์inflightได้; ต้องมี local/staging QA runner ที่หยุดก่อนส่งผลกลับ authority และแจ้ง runId/started ได้; pack นี้ไม่ได้ติดตั้ง timing harness ให้ หากไม่มีให้ BLOCKED (reason=TIMING_TOOL_UNAVAILABLE)
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) memberเริ่มrun แล้วownerถอนสมาชิกในQAroomก่อนจบ → 2) ปล่อยรันจบและลองเปิด/รันใหม่จากsessionสมาชิกเดิม
- Expected: สมาชิกที่ถูกถอนเข้าห้อง/เริ่มrunใหม่ไม่ได้ · ผลเก่าไม่commitเป็นcurrentในบริบทสมาชิกที่ถูกถอน และไม่สลับไปใช้ownerโดยเงียบ; จับinflightไม่ได้ให้BLOCKED (reason=TIMING)

#### F066-PD-041 — คนละบัญชีที่ไม่เคยได้รับสิทธิ์เข้าห้อง QA ไม่ได้

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: มีQAroomกับผู้ทดสอบบัญชีอื่นแยกbrowserที่ไม่เป็นสมาชิก ไม่มีการใช้ห้องธุรกิจจริง
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) ลองเปิด URL QAroomด้วยบัญชีนอกห้อง → 2) ตรวจข้อความและnetworkresponseโดยไม่บันทึกcookie/token
- Expected: ไม่คืนข้อมูลโปรแกรม/source/rowsของQAroomให้คนนอก · เจ้าของยังใช้ห้องได้ตามปกติ; ไม่ใช้การซ่อนปุ่มอย่างเดียวเป็นหลักฐานauthz

#### F066-PD-042 — แต่ละ execution ไม่ใช้ global state จากรอบก่อน

- Priority: P1 · Scope: local-or-staging · Engine: javascript, python · Status: **NOT_RUN**
- ก่อนเริ่ม: local/staging: controlled-faults fresh-counter ที่ไม่เปลี่ยนinput และเก็บตัวนับในprocessเท่านั้น; ทดสอบแยกengineที่เปิด
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) manualRunต่อเนื่อง3ครั้งที่จบทีละรอบ โดยเก็บrunIds → 2) เทียบ outputและengine/sourceversionของแต่ละรอบ
- Expected: ทั้งสามรอบคืน counter=1 จากisolate/containerใหม่ · ไม่มีstateข้ามรอบ; ถ้าengineไม่อยู่ในrelease scopeให้SKIPPED_SCOPEรายengine

### H — เคสเดิม

#### F066-PD-043 — Invoice เดิม: rate change และยอด155

- Priority: P0 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: มีprepared Invoiceและsample/evidence ที่route/environmentนั้นรองรับ; legacyuploadถ้าปิดตามcapabilityให้SKIPPED_SCOPE hostedและเก็บไว้รันlocalตามคู่มือเดิม
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) ใช้syntheticsamplesของpreparedInvoice; verify evidenceเมื่อflowกำหนด → 2) ตั้งremote surcharge750satang เริ่ม2026-10-20 ทุกzone แล้วSimulate/Validate/Approve/Activateตามflowเดิม
- Expected: total155.00ตรงbilled; rows52.50/62.50/40.00 · save/reloadยังตรง; ไม่มีcomputeใหม่แทรกในการเปลี่ยนrateเดิม
- Oracle: [expected.json](expected.json) → `legacy`

#### F066-PD-044 — Teaching เดิม: shared lesson กับ local experiment

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: prepared Physics lesson, teacherกับlearnerแยกbrowser; ตั้งsharedforce10Nและtime2sให้ชัดก่อนเริ่ม ไม่อิงseedที่อาจเปลี่ยน
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) teacherเปลี่ยนsharedmassเป็น5kg: position4m → 2) learnerทดลองlocalmass2kg: position10m แล้วrefreshดูsharedlesson
- Expected: localexperimentไม่เขียนทับsharedmass5/position4 · ไม่ใช้ข้อความprivacyเก่ามาตัดสิน; visibilityปัจจุบันเป็นopenและห้องใช้ข้อมูลสมมติเท่านั้น
- Oracle: [expected.json](expected.json) → `legacy`

#### F066-PD-045 — Encounter เดิม: shield/HP/AP

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: prepared Shared encounter; DM/Mira/Pipแยกbrowserและตั้งpermissionsตามflowที่จะเล่น
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) เปิดกฎshield ally/cost1AP/once-per-turn; DM Hit Pip, Mira Shield Pip, DM Resolve hit → 2) ตรวจHP/AP แล้วEnd turnและreload
- Expected: Pip8/10HP; Mira1APหลังshieldและ2APเมื่อendturn · การคำนวณ/turnเดิมไม่ต้องสร้างPythonmodule; ไม่อ้างprivacyจากguideเก่าภายใต้openpolicy
- Oracle: [expected.json](expected.json) → `legacy`

#### F066-PD-046 — ร้านกาแฟเดิม: กดจบงานทีละรายการ

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: QAโต๊ะกาแฟผ่านDSLเดิม มีespresso3นาทีและtea5นาที; บันทึกschemaก่อนเพิ่มcompute
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ข้อความพร้อมส่ง: “สร้างคิว espresso 3 นาที และ tea 5 นาที ปุ่มจบงานทีละรายการสะสมเวลาที่ใช้จริง ใช้ actions/สูตรเดิมได้”
- ขั้นตอน: 1) กดจบespressoแล้วtea → 2) ขอเพิ่มmetricจำนวนงานค้างและreload
- Expected: เวลาสะสม3แล้ว8นาที จำนวนค้างสุดท้าย0 · รายการที่จบแล้วไม่ถูกลบจากคำขอเพิ่มmetric และกดซ้ำไม่คิดงานเดิมซ้ำ
- Oracle: [expected.json](expected.json) → `legacy`

#### F066-PD-047 — เกมแบ่งน้ำเดิม: turn และผลรวมคงที่

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: QAเกมแบ่งน้ำ100หน่วย สมาชิกสองคนแยกsession ใช้actionตรวจturnเดิม
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ข้อความพร้อมส่ง: “สร้างเกมแบ่งน้ำรวม100 สองคนผลัดกันส่งน้ำ มีน้ำคงเหลือและน้ำส่งแล้ว ห้ามส่งเกินที่เหลือ”
- ขั้นตอน: 1) คนแรกส่ง20 คนถัดไปส่ง15 → 2) ลองส่งผิดturnและเกินน้ำที่เหลือ แล้วreload
- Expected: เหลือ65 ส่งแล้ว35 ผลรวม100; คำขอผิดไม่เปลี่ยนข้อมูล · turnและค่าที่แชร์ตรงกันทั้งสองจอ
- Oracle: [expected.json](expected.json) → `legacy`

#### F066-PD-048 — เกมเดิม: server dice และ computed column

- Priority: P1 · Scope: hosted-ui · Engine: ตามโจทย์/ไม่บังคับ runner · Status: **NOT_RUN**
- ก่อนเริ่ม: QAเกมเดิมเริ่มscore0 มีroll2d6ที่serverรับรอง และcomputedcolumn score+5; ใช้serverroll actionเดิม
- ข้อมูล: ตาม precondition; ไม่มี fixture file เพิ่ม
- ขั้นตอน: 1) ทอย2d6เก็บผลserver แล้วใช้rollนั้นบวกscoreครั้งเดียว → 2) ตรวจcomputedcolumnและลองใช้rollเดิมซ้ำก่อนreload
- Expected: diceแต่ละหน้า1..6, sum2..12; scoreเท่าผลserverและcomputed=score+5 · rollเดิมไม่ถูกใช้ซ้ำ; reloadยังตรงserverและไม่มีclient-generatedเลขมาแทนผลserver

## สรุปรอบทดสอบที่จะกรอกภายหลัง

บันทึก tag/commit/URL/เวลา, planned vs observed engines, จำนวน PASS/FAIL/BLOCKED/SKIPPED_SCOPE/NOT_RUN, ข้อผิดพลาดพร้อมcaseIDและevidence; แยก first attemptกับผลหลังแก้ และสรุปเฉพาะscopeที่ทำจริง ห้ามเปลี่ยนผลlocalเก่ามาเป็นผลhostedรอบนี้

## ตรวจความครบของชุดเตรียม

จาก root repo รัน `node scripts/check-f066-post-deploy-pack.mjs` ได้แบบ read-only/offline ตรวจ IDs, template NOT_RUN, fixture references/limits และ golden arithmetic; ผล checker ไม่ใช่ acceptance PASS ของ48เคส

อ้างอิง contract: [REUSABLE_COMPUTE](../../REUSABLE_COMPUTE.md), [feature F066](../../features/F066-reusable-compute-rules.md), [เคส R1 เดิม](../../R1_DEMO_GUIDE.md), [Generative acceptance เดิม](../../GENERATIVE_CANVAS_ACCEPTANCE.md) เอกสารเก่าเป็นbaselineเฉพาะรอบนั้น ให้ใช้capabilities/visibilityปัจจุบันตอนทดสอบจริง
