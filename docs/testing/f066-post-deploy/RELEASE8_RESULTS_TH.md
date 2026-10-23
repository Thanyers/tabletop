# F066 — ผลตรวจหลัง deploy 8.0.0

ตรวจวันที่ 2026-10-23 (Asia/Bangkok) · เป้าหมายหลัก production **8.0.0 / 89a604e** · ข้อมูลสมมติในห้อง QA ใหม่ · [ชุดทดสอบ](README_TH.md)

**JavaScript และ Python ยังไม่พร้อมใช้บนเว็บ** ทั้ง production และ staging ตอน preflight รายงาน `compute.runtimes: []` และ `pythonLibraries: []` แม้ build จะมีโค้ด reusable compute แล้ว ระบบยังใช้ expression/actions เดิมได้ ผลนี้ไม่ใช่การพิสูจน์ว่า Python image ถูก provision แล้วหรือไม่มีอยู่

## ผลรวม

ตรวจซ้ำหลังรอบ UI: production ยังเป็น **8.0.0 / 89a604e** ส่วน staging เปลี่ยนเป็น **0.0.0-dev / c1125ea** ระหว่างงาน ทั้งสองยังรายงาน runtimes ว่าง ผล UI ทั้งหมดในรายงานนี้รันบน production8.0.0; staging ใช้ตรวจ capability แบบอ่านอย่างเดียว ไม่เอาผล dev มาปนกับ release8 หลักฐานรุ่นตามเวลาที่ตรวจอยู่ใน ignored `preflight-end.json`

| สถานะ | จำนวน | ความหมาย |
| --- | ---: | --- |
| PASS | 7 | ทำขั้นตอนและอ่านค่าจริงตามขอบเขตที่บันทึก |
| FAIL | 4 | พบ engine/คำตอบ/ผลไม่ตรงเกณฑ์ |
| BLOCKED | 36 | เงื่อนไขหรือหลักฐานไม่ครบ ไม่ได้นับว่ารันผ่าน |
| SKIPPED_SCOPE | 1 | legacy upload ไม่เปิดใน hosted scope |
| NOT_RUN | 0 | ไม่มีเคสค้างโดยไม่ระบุเหตุผล |

นี่คือการประเมินสถานะครบ 48 เคส ไม่ใช่การรัน 48 เคสสำเร็จ: generated-code cases ที่ต้องใช้ engine ไม่ได้เริ่ม execution และ fault/timing ไม่ถูก inject บน production

## สิ่งที่รันจริง

- **PD-001:** GET /version ตอน preflight เริ่มตรงกับ merge ของ release8 ทั้งสอง environment; preflight แยก intended JavaScript+Python จาก observed runtimes ว่าง
- **PD-004:** ข้อมูลสองแถว quantity/price =3×25 และ5×30 คำถามอย่างเดียวตอบ75+150=225; raw rows/data revision1 และ active rule revision1 ไม่เปลี่ยน หลักฐานเป็น UI state + history readback ไม่ใช่ database audit
- **PD-006:** โจทย์กำกวมได้หนึ่งคำถาม/สามตัวเลือกก่อน activation รอบเก็บหลักฐานเพิ่มมีทั้งตัวเลือกเช็กลิสต์และคำตอบเองเรื่อง quantity×unit_price ถูกเลือกอยู่ จึงได้ทั้งตารางงานและยอดขาย ไม่อ้างว่าเลือกคำตอบเองอย่างเดียว มี snapshot ก่อนส่งคำตอบ/หลังสร้าง และ preview mapping product→สินค้า/รายการ ก่อนนำเข้าสองแถวได้ metric225; sale_id/branch ถูก ignore เพราะส่วนยอดขายใช้เพียงชื่อรายการ/จำนวน/ราคา
- **PD-007:** ใช้สูตรจริงได้225→202.50 เมื่อส่วนลด10%; เปลี่ยนส่วนลดของแต่ละรายการเป็น20% ได้180เมื่อครบสองรายการ; raw rows ยืนยันส่วนลด20ทั้งคู่; reloadยัง180 ไม่ใช้ generated-code engine
- **PD-029:** เลือกกฎร่วมกับการ์ดจนห้ารายการ แล้วเพิ่มรายการที่หก; chip เก่าสุดหลุด เหลือห้ารายการล่าสุด คำตอบอ้าง sales/total-sales/sale-count/sales-by-branch/entry-form ตรงกับที่เลือก ห้องทดสอบนี้ยัง raw0/rule revision2
- **PD-046:** นำเข้าespresso3นาที/tea5นาที กดจบแยกกันได้3→8; กดจบงานเดิมซ้ำไม่สะสมเพิ่ม ขอ AI เพิ่ม metric งานค้าง แล้ว reloadยังสองรายการ done, นาที8 และค้าง0
- **PD-048:** รอบเก็บหลักฐานเพิ่มเริ่มscore0: server roll2d6 ได้หน้า3/4 รวม7ก่อนใช้ผล; ใช้ผ่าน Actionsแล้วคะแนน7 และคอลัมน์score+5=12; ผลถูกล้างและปุ่มส่งปิดจนมีผลทอยใหม่; reloadยัง7/12 (รอบก่อนหน้าที่ได้9/14เก็บไฟล์ไว้แยก ไม่ใช้แทนpre/postrollหลักฐานรอบนี้) ไม่ได้ทดสอบ forged-token replay หรืออ้างว่าครบ security negative cases

## สิ่งที่ไม่ผ่าน

1. **PD-002/003 — engine availability:** ทั้งสอง environment ไม่ประกาศ JavaScript/Python ตามที่ตั้งใจทดสอบ [บันทึก deploy](../../DEPLOYMENTS.md) ระบุว่า config ที่ pipeline ใช้ยังไม่มี COMPUTE_LOADER และ TABLE_COMPUTE_PYTHON ส่วน [capability source](../../../cloudflare/index.ts) อ่านจาก binding/flag จริง ไม่ใช่ดูว่ามี source code แล้วหรือไม่
2. **PD-005 — intent-first / file-later:** ร่างแรกเริ่มว่างได้ แต่สร้าง total เป็น required input; CSVมาตรฐานที่มีbranch/product/quantity/unit_price ถูกปฏิเสธสองแถวด้วย “ยอดรวม is required.” หลังขอแก้เก็บเป็นรอบแยก ร่างใหม่ใช้สูตรในmetricได้แต่ยังรักษาfieldrequiredเดิมไว้ จึงยังimportไฟล์เดิมไม่ได้ ไม่ลบผลรอบแรกทิ้ง
3. **PD-035 — library explanation:** คำถามว่าใช้Polarsแทนpandasได้จริงไหม/มีlibraryหรือไม่ จบด้วย MODEL_PROVIDER_OUTPUT_REJECTED ไม่มีคำอธิบายหรือfallbackที่ใช้งานได้ ไม่ใช่หลักฐานว่าระบบลองรันPolarsหรือติดตั้งpackage และไม่ได้อ้างว่าบอทแกล้งคำนวณสำเร็จ

## ขอบเขตที่ยังพิสูจน์ไม่ได้

- **29 เคส** ติด engine ที่ต้องใช้; รวม source/version/derived wiring, no-AI rerun, stale/error/timing, typed outputs และ fresh execution ต้องรันใหม่เมื่อเปิด runtime แล้ว ผลสูตรเดิมข้างบนใช้แทนผลเหล่านี้ไม่ได้
- **PD-025:** เห็นชื่อ/คำอธิบาย/input/ปลายทางก่อนAdvanced แต่ยังไม่มี no-code human readback จึงไม่ยืนยันว่าเด็กหรือคนไม่ได้เขียนโปรแกรมเข้าใจ; ห้องแรกยังมีข้อความเรื่องCSV/requiredที่ชวนสับสน
- **PD-030:** วัด viewport320×800 และdocument width320ได้ KeyboardเปิดAdvanced, PageDown, Ask/Changeและกลับcomposerได้ แต่ภาพ/ตำแหน่งการ์ดหลังเปลี่ยนviewportตรวจซ้ำไม่สม่ำเสมอ ภาพบางรอบอยู่นอกจอ จึงBLOCKED ไม่อ้างmobilePASSหรือสรุปว่าเป็นproductbugจากautomationเพียงอย่างเดียว คืนviewportแล้ว ไม่มีforce-clickหรือแก้scene/camera
- **PD-037/041/044/045/047:** ผู้ใช้ยืนยันว่ายังไม่มีบัญชีทดสอบที่สองและให้บันทึกBLOCKED มี authenticated QA actor เพียงหนึ่งคน จึงยังตรวจ Viewer, outsider, teacher/learner, encounter หรือผลัดturnไม่ได้; สองแท็บบัญชีเดียวไม่ใช้แทนหลายactor
- **PD-043:** เปิดpreparedInvoiceได้ แต่hosted legacy uploadปิด จึงข้ามcanonicalrate-change155ตามเงื่อนไขในcase การเปิดseed4แถวไม่ใช่ผลของเคส155
- ไม่มีการอ้าง0providercallsหรือpersistentcomputeจากผลexpression และไม่มีการเปลี่ยนruntime/config, SQL/schema, credentials หรือdeployจากเครื่องในงานตรวจนี้

## หลักฐานและการทำซ้ำ

Actual/evidenceอยู่ในignored `test-results/post-deploy/release8-20261023/`: `results.json` ครบ48รายการ, `preflight.json`, UI snapshots, screenshots และลิงก์ห้องQA เก็บเฉพาะในเครื่อง ไม่ใส่account/room/session IDs, cookies, tokens หรือภาพที่มีข้อมูลส่วนตัวลงrepoสาธารณะ Templateของชุดเตรียมยัง48NOT_RUNตามเดิม

ตัวตรวจชุดเตรียม `node scripts/check-f066-post-deploy-pack.mjs` ผ่าน48definitions/15fixtures/38goldenchecks บนNode22.23.2; ผลนี้แยกจากacceptanceข้างบน ไม่เพิ่มจำนวนPASSของแอป

ก่อนรอบถัดไป operatorต้องเปิดCOMPUTE_LOADERสำหรับJS และPython flag+Room containers/imageตาม[contract](../../REUSABLE_COMPUTE.md) แล้วdeployผ่านpipeline จากนั้นตรวจcapabilityและรันจริงทั้งสองภาษา อนุมัติการเปลี่ยนconfig/credentialเป็นงานแยก ไม่เปลี่ยนเพียงflagแล้วนับว่าพร้อม

## รายเคส

| Case | ชื่อ | ผล | เหตุผล/ขอบเขต |
| --- | --- | --- | --- |
| F066-PD-001 | ยืนยัน build และขอบเขต release ที่จะทดสอบ | **PASS** | Build identity matches release merge; engine readiness evaluated separately in002/003. |
| F066-PD-002 | JavaScript capability ตรงกับสิ่งที่เปิดใช้ | **FAIL** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-003 | Python capability และ image พร้อมใช้งานจริง | **FAIL** | ต้องใช้ python; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-004 | ถามข้อมูลอย่างเดียวไม่แก้กฎหรือข้อมูล | **PASS** | Question-only path; before/after raw values, data revision1 and active rule revision1 unchanged. |
| F066-PD-005 | เริ่มจากโจทย์โดยไม่มีไฟล์ แล้วเติมข้อมูลทีหลัง | **FAIL** | First generated schema requires the total input; canonical CSV without total is rejected. Later repair was kept separate and did not remove that requirement. |
| F066-PD-006 | ถามเพิ่มเมื่อโจทย์ไม่พอและเก็บบริบทคำตอบ | **PASS** | Evidence rerun has one clarification question and three substantive choices before activation. Checklist and own sales answer are both selected; generated tool preserves the sales answer plus a task table. Explicit product→สินค้า/รายการ mapping prepares2 rows and computes225. No claim only the own answer was selected. |
| F066-PD-007 | งานเล็กใช้สูตรและเปลี่ยนส่วนลดได้ | **PASS** | Expressions remain usable with runtimes disabled. Discount is per record: set both records to20%; no generated-code engine used. |
| F066-PD-008 | JavaScript คำนวณคะแนนเกมที่ไม่ได้ใช้ pandas | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-009 | pandas เตรียมข้อมูลสิบขั้นพร้อมสรุปสาขา | **BLOCKED** | ต้องใช้ python; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-010 | NumPy คำนวณหลายสถิติจาก input เดียว | **BLOCKED** | ต้องใช้ python; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-011 | SciPy ทำ linear regression และส่งผลให้หลายการ์ด | **BLOCKED** | ต้องใช้ python; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-012 | openpyxl และ dateutil ใช้ได้จริงภายในตัวรัน | **BLOCKED** | ต้องใช้ python; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-013 | metric อ่านผล backend เดียวกับการ์ดคำนวณ | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-014 | กราฟอ่าน derived table ไม่ค้างตัวเลขตัวอย่าง | **BLOCKED** | ต้องใช้ python; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-015 | join สอง inputs แล้วส่งตารางผล | **BLOCKED** | ต้องใช้ python; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-016 | module ต่อกันหลายขั้นและรันตามลำดับ | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-017 | หนึ่งโปรแกรมมีหลาย output และหลายการ์ด | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-018 | เปลี่ยนแหล่ง input โดยอ้างกฎให้ตรงใบ | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-019 | Replace input แล้วรันโปรแกรมเดิมโดยไม่เรียก AI | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-020 | reload และกลับเข้าห้องด้วยบัญชีเดิม | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-021 | Append เป็นค่าเริ่มต้นและ Replace ต้องยืนยัน | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-022 | ข้อมูลเปลี่ยนระหว่างรัน ผลเก่าไม่เป็น current | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution · fault/timing จำกัดlocal/staging |
| F066-PD-023 | runtime error ไม่ทำลาย input หรือแสดงผลเก่าว่าสด | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution · fault/timing จำกัดlocal/staging |
| F066-PD-024 | กด Run ซ้ำขณะ module เดียวกันยัง pending | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution · fault/timing จำกัดlocal/staging |
| F066-PD-025 | Rules อธิบายงานโดยไม่ต้องอ่าน source | **BLOCKED** | HUMAN_COMPREHENSION_UNVERIFIED: labels/relationships observed, but no independent no-code person readback. Initial sales room also has contradictory CSV assumptions. |
| F066-PD-026 | Advanced ดูภาษา version และ source ได้ตามสิทธิ์ | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-027 | Ask รายกฎได้คำตอบอ้างกฎที่เลือก | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-028 | Change this rule แก้เฉพาะกฎที่ระบุ | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-029 | อ้างหลายการ์ด/กฎร่วมกันและไม่เกินห้ารายการ | **PASS** | Mixed rule/card references show newest five when the sixth is added. Question answer identifies the five selected cards; rule revision2/raw data0 unchanged in the QA room. |
| F066-PD-030 | Rules บนจอแคบและใช้คีย์บอร์ด | **BLOCKED** | MOBILE_VISUAL_VERIFICATION_INCOMPLETE:320x800/document-width320, keyboard Advanced/Ask/Change and composer focus verified, but card framing was not reproducible after repeated viewport changes. Screenshots later show the card outside viewport; do not infer full mobile pass from DOM/keyboard checks. |
| F066-PD-031 | ข้อมูล numeric ผิดชนิดต้องไม่ import บางส่วน | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-032 | required input หายไม่กลายเป็นศูนย์ | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-033 | ชนิด output ไม่ตรงสัญญาถูกปฏิเสธ | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution · fault/timing จำกัดlocal/staging |
| F066-PD-034 | NaN/Infinity ไม่ถูกส่งเป็นค่าถูกต้องหรือ null ปลอม | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution · fault/timing จำกัดlocal/staging |
| F066-PD-035 | ขอ library ที่ไม่ได้ติดตั้ง | **FAIL** | Assistant question about actual Polars availability returned MODEL_PROVIDER_OUTPUT_REJECTED; no usable explanation/fallback. This is a chat failure, not evidence a Polars execution was attempted or supported. |
| F066-PD-036 | วงจร dependencies ถูกกันก่อนเปิดใช้ | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution · fault/timing จำกัดlocal/staging |
| F066-PD-037 | ผู้ดูที่ปิดสิทธิ์แก้กฎแก้ไม่ได้จริง | **BLOCKED** | ยังมีบัญชีQAเดียว; ไม่ใช้สองแท็บแทนหลายactor |
| F066-PD-038 | ดูผลได้แต่กดคำนวณไม่ได้เมื่อปิด data.compute | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-039 | สองคนแก้ input แล้วทั้งคู่เห็นผลล่าสุดตรงกัน | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution |
| F066-PD-040 | ถอนสมาชิกระหว่าง actor-bound run | **BLOCKED** | ต้องใช้ javascript; runtimes ว่าง จึงไม่เริ่ม execution · fault/timing จำกัดlocal/staging |
| F066-PD-041 | คนละบัญชีที่ไม่เคยได้รับสิทธิ์เข้าห้อง QA ไม่ได้ | **BLOCKED** | ยังมีบัญชีQAเดียว; ไม่ใช้สองแท็บแทนหลายactor |
| F066-PD-042 | แต่ละ execution ไม่ใช้ global state จากรอบก่อน | **BLOCKED** | ต้องใช้ javascript/python; runtimes ว่าง จึงไม่เริ่ม execution · fault/timing จำกัดlocal/staging |
| F066-PD-043 | Invoice เดิม: rate change และยอด155 | **SKIPPED_SCOPE** | Hosted legacy upload is disabled per capability. Prepared Invoice opened with seed data, but that is not the canonical155 rate-change run. |
| F066-PD-044 | Teaching เดิม: shared lesson กับ local experiment | **BLOCKED** | ยังมีบัญชีQAเดียว; ไม่ใช้สองแท็บแทนหลายactor |
| F066-PD-045 | Encounter เดิม: shield/HP/AP | **BLOCKED** | ยังมีบัญชีQAเดียว; ไม่ใช้สองแท็บแทนหลายactor |
| F066-PD-046 | ร้านกาแฟเดิม: กดจบงานทีละรายการ | **PASS** | Imported espresso3/tea5, completed separately3→8 minutes; repeat completion leaves8 and data revision3 unchanged. Added pending-count metric through AI rule edit; reload retains both done rows, minutes8 and pending0. |
| F066-PD-047 | เกมแบ่งน้ำเดิม: turn และผลรวมคงที่ | **BLOCKED** | ยังมีบัญชีQAเดียว; ไม่ใช้สองแท็บแทนหลายactor |
| F066-PD-048 | เกมเดิม: server dice และ computed column | **PASS** | Evidence rerun reset score0; visible server roll3+4=7 before applying, then score7/score+5=12. Roll clears and submit disables without a fresh roll. Reload preserves7/12. Original9/14 files retained separately. No forged-token replay performed. |
