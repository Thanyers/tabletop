# F077 — ผลตรวจรอบ 3

24 ตุลาคม 2026 · Node.js 22.23.2 · ขอบเขต: สื่อร่างและตัวอย่างในหน้า ไม่ใช่ production runtime

## เหตุที่ต้องแก้รอบนี้

ผู้ใช้ดูรอบ2แล้วระบุว่าไม่เห็นเครื่องมือปรับเข้ากับคนและไม่เห็นการพิมพ์คำขอต่อเนื่อง **เกณฑ์เรื่องเล่ารอบ2ไม่ผ่าน** แม้ผล UI gate 16/16 และตัวเลขจะผ่าน จึงไม่ใช้ผลตรวจเทคนิคอ้างว่าคนดูเข้าใจ

รอบ3เปลี่ยนเป็นความต้องการของคนขาย → พิมพ์ → ส่ง → ร่าง → ตรวจ/ใช้ → ลงมือใช้ แล้วขอปรับต่อบนโต๊ะเดิม

## ผลที่ตรวจใหม่

| การตรวจ | ผล | สิ่งที่ตรวจจริง |
| --- | --- | --- |
| เรื่อง/README | PASS ในขอบเขต independent prose review | ทุกการเพิ่มมีเหตุจากคน; ปุ่มขายถูกกดจริงในเรื่อง; chart/ruleต่อจากข้อมูลเดิม; ระบุภาพสมมติ |
| คำนวณตัวอย่าง | PASS 8/8 | gross225; coffee100; cake150; gross250;10%net225;20%net200; extraCakegross300;20%net240 |
| Browser 5 บท | PASS หลังแก้ | พิมพ์/ส่ง/ตรวจ/ใช้ครบ; คำขอส่งแล้วแสดงบนโต๊ะ; previewมีป้ายร่าง; ปุ่มขายยังdisabledก่อนApply; กดกาแฟ3→4ได้gross250; chart100/150 |
| Browser กฎและใช้ต่อ | PASS | Review20%ยังใช้10%net225/gross250; Applyแล้วใช้20%; กดเค้กเพิ่มต่อได้gross300/net240/chart100/200; ย้อนบท3ไม่ล้างกฎหรือข้อมูล |
| Browser ภาษา/หยุด/รีเซ็ต | PASS | หยุดพิมพ์แสดงคำขอครบเพื่อส่ง; สลับENระหว่างพิมพ์แปลpresetและรักษายอด/กฎ; resetหยุดtimerและคืนโต๊ะเริ่มต้น |
| Browser runtime error | RED → GREEN | พบdraft-summaryว่างแต่renderหาspanไทย/อังกฤษ ทำให้Send/Reviewthrow; เติมspanแล้วรันครบ5บทใหม่ ไม่พบconsoleerrorใหม่ในช่วงตรวจ |
| Independent source review | CLOSED 3/3 P2 | เปลี่ยนeditablepromptที่ผลไม่อ่านเป็นreadonlypreset; ไม่มีcustomtextถูกทับเมื่อเปลี่ยนภาษา; ปิดnull-queryในdraftsummary; motion sourceลำดับคำขอ/ผลและตัวเลขสอดคล้อง |
| Motion legibility review | แก้ตามภาพ preview | Mainพบคำขอเล็กเกินไปในภาพ1280×720 จึงขยายช่วงพิมพ์เป็นภาพหลักและแก้pointerซ้อนก่อนrenderสุดท้าย |
| Full UI gate รอบ3 | PASS 16/16 measured; SKIP 4 | รัน--fullหลังแก้sourceครบ:13render+3staticผ่าน; theme resolution, DTCG, token contrast, dialog focus trapข้ามเพราะไม่มีargument/selector; ผลจริงในignored test-results/f077/ui-gate-full.log |
| MP4 รอบ3 / decoded frames | PASS | H.264 60s/1280×720/30fps; full decode 1,800 frames; workerตรวจ8stills+poster; mainตรวจภาพคำขอปุ่มขาย/ผลคลิก/คำขอ10%/ข้อเสนอ20%/ใช้20%จากMP4; browserเวลา3.85→15.22sและerror=null; pause/seekรอบ3ไม่ยืนยัน |
| ลิงก์ภายใน | PASS 67/67 | Python pathlibตรวจMarkdown/HTML targets; excludeexternalURLs/node_modules/.remotion-bundle |
| Public files / changelog / whitespace | PASS | public scan0findings; changelog1fragment; git diff --checkผ่านก่อนcommit |
| JavaScript syntax | PASS | node --check review.js และmotion/render.mjs; JSXผ่านbundlepreview |
| ESLint draft coverage | SKIPPED BY CONFIG | rootESLintไม่ได้ครอบไฟล์draftทั้งหมด; hookไม่ใช่หลักฐานlintครบ |
| Human comprehension รอบ3 | NOT RUN | ยังไม่มีผลให้คนใหม่ดูแล้วเล่าเรื่องกลับ และยังไม่ได้รับuseracceptance |
| Actual product proof | NOT RUN | exact5requests/quick-sale/storyนี้ยังไม่ได้บันทึกจากproductจริง |
| เสียง | NOT PRODUCED | MP4เงียบ; เตรียมบทTH/ENไว้ ไม่เรียกAPIเสียง |

ตัวอย่างบนเว็บเป็นreadonlypresetที่เลือกบทแล้วเล่นเรื่องต่อ กดปุ่มขายได้จริงเฉพาะstateในหน้า ไม่ได้ตีความข้อความอิสระหรือเรียกAI ภาพวิดีโอสร้างจากโค้ดและข้อมูลสมมติทั้งหมด

## ขอบเขตเก่าและ CI

รอบ1เป็น36s; รอบ2เป็น60s hash `9198e8852be7998441f81873c11adb1a26bdc9e55ac2f7f345ca969a2bf1fc34` ผลเหล่านั้นไม่ใช่ผลตรวจartifactรอบ3

[CIรอบ2ของ31ac96f](https://github.com/Thanyers/tabletop/actions/runs/40068985937) failedที่ `Check dependency advisories` (4 moderate/3 high) ทำให้local-validationFAIL; งานนี้ไม่แก้rootdependenciesและคง [draft PR259](https://github.com/Thanyers/tabletop/pull/259) ผลcurrentheadต้องอ่านใหม่หลังpush ไม่มีmergeหรือdeploy

MP4 รอบ3: 1,395,144 bytes; SHA-256 `a3b7809a90f752a8a03822e5bd971ee16cba9f4496f35d1c4f136b6446ba77b0`. รวมMP4/poster/8stills 2,871,261 bytes.
