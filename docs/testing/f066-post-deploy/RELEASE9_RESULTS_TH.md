# F066 — ผลตรวจหลัง deploy 9.0.0 และตรวจซ้ำ 9.0.1

วันที่ตรวจ: 23 ตุลาคม 2569 (Asia/Bangkok) · ข้อมูลสมมติในห้อง QA · [ชุด48เคส](cases.json) · [ผลอ้างอิง](expected.json)

ผล ณ9.0.1: **36 PASS / 1 FAIL / 10 BLOCKED / 1 SKIPPED_SCOPE** ครบ48เคสโดยไม่มีNOT_RUN เหลือPD027ที่กำลังแก้และเตรียม9.0.2 รายงานจะเพิ่มactualretestหลังdeploy

## รุ่นและขอบเขตหลักฐาน

- เริ่มตรวจบน **9.0.0 / 49f2dd7**, built_at2026-10-23T13:33:24Z จาก [PR249](https://github.com/Thanyers/tabletop/pull/249), [deploy39962089610](https://github.com/Thanyers/tabletop/actions/runs/39962089610) สำเร็จ
- แก้เคสที่พบด้วย [PR254](https://github.com/Thanyers/tabletop/pull/254) แล้วออก **9.0.1 / f2f1629**, built_at2026-10-23T14:56:01Z จาก [PR256](https://github.com/Thanyers/tabletop/pull/256), [deploy39973772263](https://github.com/Thanyers/tabletop/actions/runs/39973772263) สำเร็จ และตรวจ /version ซ้ำหลังทดสอบ ไม่ใช่การรันทุกเคสใหม่บน9.0.1
- เปิด **JavaScript และ Python**, profile tabletop-compute-1; Python standard library, pandas2.3.3, NumPy2.3.4, SciPy1.16.3, openpyxl3.1.5, python-dateutil2.9.0.post0 ใช้ได้จากexecutionจริง Polarsไม่ได้ติดตั้ง ไม่มีการติดตั้งเพิ่มระหว่างรัน
- PASSของ PD022/023/024/033/034/036/042 เป็น controlled local HTTP authority + isolate/Docker ในCI; ไม่ใช่ production fault injection ทั้ง7รหัสมี8ผลย่อยและ17executions (PD042แยกJS/Python)
- ผลดิบอยู่ใน ignored test-results/post-deploy/release9-20261023/results.json และไฟล์หลักฐานรายเคส; รายงานpublicนี้ตัดroom/accountIDsและข้อมูลเข้าสู่ระบบออก templateเดิมยัง48NOT_RUN และผลrelease8คงเป็นประวัติเดิม

## ผลที่ตรวจได้

การเริ่มโดยไม่มีไฟล์แล้วเติมCSVทำงานบนproduction กฎคอลัมน์คำนวณรับraw fieldsโดยไม่บังคับกรอกtotalที่ระบบคำนวณเอง JavaScript/Pythonเก็บsource/version/input/output bindingและประวัติrunไว้ เมื่อเปลี่ยนข้อมูลจะคำนวณใหม่และส่งผลให้metric/derived table/chartหรือโมดูลถัดไป ผลที่รับรองอิงtyped current runกับauthority readbackและค่าที่แสดงจริง

Replaceที่กฎอ้างแถวเดิมต้องเลือกฟิลด์ระบุตัวรายการและยืนยันก่อน ระบบจับคู่จากค่าที่ไม่ซ้ำแทนตำแหน่งแถว; ทดสอบสลับคะแนน4แถวได้13→19โดยIDและsource/versionเดิม หลักฐานแก้stale/typed output/cycle/fresh executionแยกอยู่ในlocal CI

## ผลรายเคส

| เคส | สิ่งที่ตรวจ | ผล | หลักฐาน/ขอบเขต |
| --- | --- | --- | --- |
| F066-PD-001 | ยืนยัน build และขอบเขต release ที่จะทดสอบ | **PASS** | รุ่นและ capability ตรง production; อ่าน9.0.1/f2f1629ซ้ำหลัง PATCH |
| F066-PD-002 | JavaScript capability ตรงกับสิ่งที่เปิดใช้ | **PASS** | 9.0.1: JS succeeded จริงและ Rules แสดง reusable calculations |
| F066-PD-003 | Python capability และ image พร้อมใช้งานจริง | **PASS** | Python imports/runs จริงครบรายการ; Run ใหม่บน9.0.1ได้8วัน |
| F066-PD-004 | ถามข้อมูลอย่างเดียวไม่แก้กฎหรือข้อมูล | **PASS** | ตอบ225จาก75+150; raw/program/revisionsคงเดิม |
| F066-PD-005 | เริ่มจากโจทย์โดยไม่มีไฟล์ แล้วเติมข้อมูลทีหลัง | **PASS** | เริ่มไม่มีไฟล์ raw0แถว; import raw2แถวแล้ว total75/150 รวม225 |
| F066-PD-006 | ถามเพิ่มเมื่อโจทย์ไม่พอและเก็บบริบทคำตอบ | **PASS** | ถามเพิ่ม1คำถาม/3ตัวเลือก; เลือกคำตอบเองแล้วได้ sales/form/สูตรที่ยังไม่มีแถว |
| F066-PD-007 | งานเล็กใช้สูตรและเปลี่ยนส่วนลดได้ | **PASS** | สูตร225 → ลด10%202.50 → ลด20%180 |
| F066-PD-008 | JavaScript คำนวณคะแนนเกมที่ไม่ได้ใช้ pandas | **PASS** | 9.0.1: Replaceสลับลำดับและเลือก identity; IDเดิมครบ4แถว ผล13→19 โค้ด/versionเดิม |
| F066-PD-009 | pandas เตรียมข้อมูลสิบขั้นพร้อมสรุปสาขา | **PASS** | pandas10ขั้น ยอด300 North200/South100 paid3; แก้เปอร์เซ็นต์จากfractionsเป็น66.67/33.33ก่อนผ่าน |
| F066-PD-010 | NumPy คำนวณหลายสถิติจาก input เดียว | **PASS** | NumPy n4/sum20/mean5/variance5/std2.236068; ใช้Rulesหลังแชทปฏิเสธรอบแรก |
| F066-PD-011 | SciPy ทำ linear regression และส่งผลให้หลายการ์ด | **PASS** | SciPy slope2/intercept1; x5ได้11→x6ได้13; รอบแรกถูกcitation guard ปฏิเสธแล้วจึงแก้ร่าง |
| F066-PD-012 | openpyxl และ dateutil ใช้ได้จริงภายในตัวรัน | **PASS** | openpyxl BytesIO write/read + dateutil; วันที่3รายการ ช่วง7→8วัน;9.0.1 explicit Run ใหม่สำเร็จ |
| F066-PD-013 | metric อ่านผล backend เดียวกับการ์ดคำนวณ | **PASS** | metricอ่านtyped JS result225→405; raw2แถว |
| F066-PD-014 | กราฟอ่าน derived table ไม่ค้างตัวเลขตัวอย่าง | **PASS** | pandas derived table/chart75+150→105+300 รวม225→405 |
| F066-PD-015 | join สอง inputs แล้วส่งตารางผล | **PASS** | pandas joinสองตาราง3แถว ได้100/75/80 รวม255; missing/duplicate0 |
| F066-PD-016 | module ต่อกันหลายขั้นและรันตามลำดับ | **PASS** | 9.0.1: A→B→C ได้225/202.50/216.68 →405/364.50/390.02; upstreamRunIdตรงรอบใหม่ programเดิม modeljobs4→4 |
| F066-PD-017 | หนึ่งโปรแกรมมีหลาย output และหลายการ์ด | **PASS** | JSหนึ่งmoduleส่ง3outputs: gross225/count2/mean112.5 ให้3metrics |
| F066-PD-018 | เปลี่ยนแหล่ง input โดยอ้างกฎให้ตรงใบ | **PASS** | 9.0.1: grossเปลี่ยนbindingไปsales_next ได้405; discountเดิมได้324; sourceเดิม/rawทั้งสองตารางไม่เปลี่ยน |
| F066-PD-019 | Replace input แล้วรันโปรแกรมเดิมโดยไม่เรียก AI | **PASS** | Replaceใช้source/versionเดิม inputHashใหม่; model-job IDsคงเดิม providerCalls UNVERIFIED |
| F066-PD-020 | reload และกลับเข้าห้องด้วยบัญชีเดิม | **PASS** | reloadและปิด/เปิดห้องเดิมได้405 พร้อมraw/program/currentrunsเดิม |
| F066-PD-021 | Append เป็นค่าเริ่มต้นและ Replace ต้องยืนยัน | **PASS** | Appendเริ่มต้น225→265; cancelไม่เปลี่ยนข้อมูล; ยืนยันReplaceแล้ว405 |
| F066-PD-022 | ข้อมูลเปลี่ยนระหว่างรัน ผลเก่าไม่เป็น current | **PASS** | local CI: staleผลเก่าไม่ถูกpromoteเป็นcurrentเมื่อข้อมูลเปลี่ยน |
| F066-PD-023 | runtime error ไม่ทำลาย input หรือแสดงผลเก่าว่าสด | **PASS** | local CI: runtime errorเก็บrawและไม่แสดงผลเก่าว่าสด |
| F066-PD-024 | กด Run ซ้ำขณะ module เดียวกันยัง pending | **PASS** | local CI: runซ้ำระหว่างpendingถูกกัน |
| F066-PD-025 | Rules อธิบายงานโดยไม่ต้องอ่าน source | **BLOCKED** | ยังไม่มีคนno-codeอิสระอ่านแล้วอธิบายกลับ; labelsไม่ใช่หลักฐานความเข้าใจ |
| F066-PD-026 | Advanced ดูภาษา version และ source ได้ตามสิทธิ์ | **PASS** | Advancedแสดงภาษา/version/profile/ports; sourceตรงauthority byte-for-byte |
| F066-PD-027 | Ask รายกฎได้คำตอบอ้างกฎที่เลือก | **FAIL** | 9.0.1: modeเป็นAskถูกต้อง แต่คำว่าตรงไหนถูกcanvas navigatorรับก่อนonSend เปิดRulesและไม่สร้างassistantjob; guardแก้แล้วเฉพาะlocal รอ9.0.2 |
| F066-PD-028 | Change this rule แก้เฉพาะกฎที่ระบุ | **PASS** | แก้เฉพาะdiscount10→20 ได้202.50→180; gross module/version/rawเดิม |
| F066-PD-029 | อ้างหลายการ์ด/กฎร่วมกันและไม่เกินห้ารายการ | **PASS** | อ้าง6รายการเหลือ5ล่าสุด; คำตอบอิง5รายการและไม่แก้ข้อมูล |
| F066-PD-030 | Rules บนจอแคบและใช้คีย์บอร์ด | **BLOCKED** | desktop keyboardผ่าน; วัด319/413pxไม่ล้น แต่ยังไม่ได้exact320px |
| F066-PD-031 | ข้อมูล numeric ผิดชนิดต้องไม่ import บางส่วน | **PASS** | numericผิดชนิดไม่importบางส่วน raw/revisions/225คงเดิม |
| F066-PD-032 | required input หายไม่กลายเป็นศูนย์ | **PASS** | required numericหายถูกreject ไม่แทนด้วย0 |
| F066-PD-033 | ชนิด output ไม่ตรงสัญญาถูกปฏิเสธ | **PASS** | local CI: outputผิดชนิดถูกrejectก่อนนำไปใช้ |
| F066-PD-034 | NaN/Infinity ไม่ถูกส่งเป็นค่าถูกต้องหรือ null ปลอม | **PASS** | local CI: NaN/Infinityถูกreject ไม่ปลอมเป็นnull |
| F066-PD-035 | ขอ library ที่ไม่ได้ติดตั้ง | **PASS** | 9.0.1: exactPolars conditional promptตอบprofileจริง/pandas fallback ไม่มีPolars; domain/revisionไม่เปลี่ยน |
| F066-PD-036 | วงจร dependencies ถูกกันก่อนเปิดใช้ | **PASS** | local CI: dependency cycleถูกกันก่อนactivate |
| F066-PD-037 | ผู้ดูที่ปิดสิทธิ์แก้กฎแก้ไม่ได้จริง | **BLOCKED** | มีบัญชีQAเดียว; ผู้ใช้สั่งคงBLOCKED ไม่ใช้สองแท็บแทนสองคน |
| F066-PD-038 | ดูผลได้แต่กดคำนวณไม่ได้เมื่อปิด data.compute | **BLOCKED** | มีบัญชีQAเดียว; ผู้ใช้สั่งคงBLOCKED ไม่ใช้สองแท็บแทนสองคน |
| F066-PD-039 | สองคนแก้ input แล้วทั้งคู่เห็นผลล่าสุดตรงกัน | **BLOCKED** | มีบัญชีQAเดียว; ผู้ใช้สั่งคงBLOCKED ไม่ใช้สองแท็บแทนสองคน |
| F066-PD-040 | ถอนสมาชิกระหว่าง actor-bound run | **BLOCKED** | มีบัญชีQAเดียว; ผู้ใช้สั่งคงBLOCKED ไม่ใช้สองแท็บแทนสองคน |
| F066-PD-041 | คนละบัญชีที่ไม่เคยได้รับสิทธิ์เข้าห้อง QA ไม่ได้ | **BLOCKED** | มีบัญชีQAเดียว; ผู้ใช้สั่งคงBLOCKED ไม่ใช้สองแท็บแทนสองคน |
| F066-PD-042 | แต่ละ execution ไม่ใช้ global state จากรอบก่อน | **PASS** | local CI: JSและPythonแยกexecution ไม่ใช้globalจากรอบก่อน |
| F066-PD-043 | Invoice เดิม: rate change และยอด155 | **SKIPPED_SCOPE** | hosted capabilityปิดlegacy upload; ไม่ใช้seedแทนcanonical155 |
| F066-PD-044 | Teaching เดิม: shared lesson กับ local experiment | **BLOCKED** | มีบัญชีQAเดียว; ผู้ใช้สั่งคงBLOCKED ไม่ใช้สองแท็บแทนสองคน |
| F066-PD-045 | Encounter เดิม: shield/HP/AP | **BLOCKED** | มีบัญชีQAเดียว; ผู้ใช้สั่งคงBLOCKED ไม่ใช้สองแท็บแทนสองคน |
| F066-PD-046 | ร้านกาแฟเดิม: กดจบงานทีละรายการ | **PASS** | กาแฟcommitted3→8/pending0/done2;9.0.1เพิ่มmetric+reloadยังครบ กดจบซ้ำไม่เพิ่มยอด; ไม่มีexplicit rejection message |
| F066-PD-047 | เกมแบ่งน้ำเดิม: turn และผลรวมคงที่ | **BLOCKED** | มีบัญชีQAเดียว; ผู้ใช้สั่งคงBLOCKED ไม่ใช้สองแท็บแทนสองคน |
| F066-PD-048 | เกมเดิม: server dice และ computed column | **PASS** | แก้ร่างเป็นone-use server rollในactionเดียวแล้วได้score7/computed12หลังreload; replayไม่ทอยใหม่ถูกกัน ยังเหลือpending fieldsที่ไม่ได้ใช้ |

## ความล้มเหลวเดิมและข้อจำกัดที่ยังต้องเห็น

- 9.0.0: PD008 Replaceทำให้fixed refsใช้ไม่ได้, PD016ร่างอ้างsourceที่ไม่มีจริง, PD027คำถามถูกตีเป็นedit และPD035คำถามlibraryถูกปฏิเสธ เก็บรอบแรกไว้แล้วตรวจซ้ำหลัง9.0.1 ไม่เปลี่ยนให้เป็นfirst-pass
- PD009ต้องแก้เปอร์เซ็นต์; PD010ใช้Rulesหลังแชทปฏิเสธ; PD011แก้citation/evidenceก่อนผ่าน; PD048แก้actionให้ใช้serverrollครั้งเดียวภายในactionเดียว ไม่มีการรับรองว่าAIร่างถูกตั้งแต่ครั้งแรกทุกโจทย์
- PD009trim behaviorยังUNVERIFIEDเพราะimportertrimก่อนส่งเข้าmodule แม้sourceมีstr.strip; PD048ยังมีpending fields/metricที่ไม่ได้ใช้ ไม่รับรองว่าล้างส่วนเกินสำเร็จ
- model-job IDsคงเดิมยืนยันได้ว่าไม่มีงานร่างใหม่ แต่ **providerCalls=UNVERIFIED** เมื่อไม่มีledgerฝั่งserver
- PD046พรีวิวฟอร์ม/คลิกที่ไม่เกิดApplyingไม่ใช่commit หลักฐานรอบจริงยืนยันaccepted actionsทีละรายการแล้วอ่านกลับ; การกดจบซ้ำยืนยันเพียงไม่เปลี่ยนข้อมูล/revisions ไม่มีexplicit rejection reason
- Full ui-gateของcandidate9.0.1ยัง **15PASS / 1FAIL / 4SKIP**: raw overlap detectorของปุ่มRulesนอกimporterยังFAIL ส่วนimporterที่280/320/390/414pxผ่านgeometry/payloadchecks ไม่สรุปว่าUIผ่านทุกข้อหรือคนno-codeเข้าใจแล้ว
- หลายบัญชี8เคสยังBLOCKEDตามผู้ใช้ และPD025ต้องhuman readback; ไม่ถือว่าสิทธิ์/หลายคนผ่านจากownerบัญชีเดียว Legacyupload PD043เป็นSKIPPED_SCOPE

## CI และ deployment

[Full release CI39971674579](https://github.com/Thanyers/tabletop/actions/runs/39971674579) ของcandidate d19c786: Node22.23.2; unit901passed/5skipped, Workers197passed, browserครบ3suites และreal local Worker Loader/Container2checksผ่าน Main f2f1629ใช้ผลfullCIจากtreeเดียวกันตามCI006แล้วproductiondeploy/smokeสำเร็จ

Staging16de683: [run39970589793](https://github.com/Thanyers/tabletop/actions/runs/39970589793) validationผ่าน แต่deployattempt1ล้มด้วยCloudflare internal errorหลังimageupload Retryเฉพาะfailedjobด้วยSHAเดิมattempt2ผ่านและ/versionตรงเป้าหมาย; ปิด[issue255](https://github.com/Thanyers/tabletop/issues/255)หลังตรวจผล สาเหตุภายในบริการยังไม่ยืนยัน ไม่มีการเรียกattempt1ว่าPASS

ในเครื่อง Node22.23.2: node scripts/check-f066-post-deploy-pack.mjs ผ่าน48definitions/15fixtures/38goldenchecks; ลิงก์localใหม่ของรายงาน3รายการและตาราง48แถวตรวจครบ; node scripts/build-release-notes.mjs อ่าน26releases/latest9.0.1/0unreleased; การตรวจpackนี้ไม่ใช่acceptance execution

Independent read-only review เทียบผลดิบ/CI/git treeแล้วไม่พบmaterial mismatchในขอบเขตรายงานที่ตรวจ; PD018มีtypedproofเพิ่มเติม; PD027มีrenderedregressionแดงก่อนแก้และเขียวหลังguard แต่ยังไม่ถือว่าhostedPASS

ไม่มีmanual SQL/schema migration หรือmanual deployในรอบนี้ Sceneแก้เฉพาะtest schedulingที่ผู้ใช้อนุญาตเพื่อปลดreleasegate โดยคงassertionsเดิม ไม่แก้production scene/camera

## งานติดตาม

เปิดเคสหลายบัญชีเมื่อมีQAactorแยกจริง, ให้คนno-codeอ่านRulesแล้วอธิบายinput/outputกลับ, ปิดexact320pxและrawui-gateFAILตามหลักฐาน Release Notesสร้างHTMLแล้วแต่agentนี้ไม่มีClaude Artifact tool: ให้Claudeเผยแพร่ทับ[ลิงก์เดิม](https://claude.ai/artifact/HohMBJcKQz2ujHmw6hqKQ8) ห้ามสร้างลิงก์ใหม่ ดู[ขั้นrelease](../../AGENT_OPERATIONS.md#5-ออก-release)
