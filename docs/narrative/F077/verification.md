# F077 — ผลตรวจชุดร่างรอบ 2

24 ตุลาคม 2026 · Node.js 22.23.2 · ขอบเขต: เอกสาร หน้าร่าง และสื่ออธิบาย ไม่ใช่การรับรอง production runtime

## ผลรอบ 2

| การตรวจ | ผล | หลักฐาน / ขอบเขต |
| --- | --- | --- |
| คำนวณตัวอย่าง | PASS 5/5 | 3×25+3×50=225; 3×35+6×50=405; net ที่ 10% เป็น202.50/364.50; net ที่20% เป็น324 |
| ลิงก์ภายใน | PASS 75/75 | ตรวจปลายทาง Markdown และ HTML href/src/poster/srcset ด้วย Python pathlib; ไม่รวม URL ภายนอก |
| Prose review | PASS ในขอบเขตตรวจ | แก้ alt ที่ยังบอกว่าเก้าอี้แปลงเป็นโต๊ะ; แยก concept/proof และ baseline/งานแข่งไว้เหมือนเดิม |
| UI gate | PASS 16/16 measured; SKIP 4 | 13 render checks ผ่าน รวม contrast, 280/320/414px overflow, axe, targets, reduced motion, keyboard, clipping, media และ interaction; อีก3static checksผ่าน; theme-variable resolution, DTCG tokens, semantic token pairs และ dialog focus trap ไม่ได้รันเพราะไม่มี theme/tokens argument หรือ dialog selector |
| Browser: ลำดับการใช้ | PASS | ใช้10%แล้ว net202.50; เปลี่ยนข้อมูลได้gross405/net364.50; Review20%ยังไม่เปลี่ยนผล; Apply20%ได้net324/gross405; กฎเดิมยังเห็นเป็นประวัติ |
| Browser: ย้อนขั้น/โฟกัส | PASS | หลัง Apply10% โฟกัสไปขั้นเปลี่ยนข้อมูล; หลัง Apply20% ไปหัวข้อผลลัพธ์; ย้อนขั้น2แล้วยังรายงาน20%/324ถูกต้อง; ปุ่ม Apply10% ไม่กลับมาเอง |
| Browser: ภาษา/animationเดิม | PASS ในขอบเขตตรวจ | สลับTH/ENแล้วข้อมูลและสถานะยังเดิม; กดเล่น GIFเดิมใช้assetในrepoและหยุดกลับเป็นposter; aria labels เปลี่ยนตามภาษา |
| Logo/source reuse | PASS source review | ใช้ mark4ชิ้น/วงกลมทองและlowercasewordmark; film port loader timingเป็นframes; เว็บใช้keyframes/easing/delayเดิมแบบเล่นเข้าเพียงหนึ่งรอบ2.4sและหยุดเมื่อreduced-motion |
| JavaScript syntax | PASS | `node --check docs/narrative/F077/review.js`; JSXผ่านการbundle/renderจริง |
| ESLint เฉพาะไฟล์ร่าง | SKIPPED BY CONFIG | เรียก4ไฟล์แล้วrootESLintรายงานignoredทั้ง4; ไม่ตีความexit0เป็นlint4ไฟล์ผ่าน |
| Render / metadata | PASS | H.264, 60.00s, 1280×720, 30fps, 1,800 decoded frames; MP4 2,099,183 bytes ไม่มีaudio stream; FFmpeg decodeครบexit0; posterและ8stillsดึงจากMP4สุดท้าย |
| Browser: final MP4 | PASS playback / seek NOT VERIFIED | เบราว์เซอร์อ่านduration60s/1280×720; กดเล่นแล้วเวลาเดินจาก0.22ถึง17.74s และหยุดได้; media errorเป็นnull; keyboard seekไม่ได้เปลี่ยนเวลา จึงไม่นับว่าเลื่อนเวลาผ่าน |
| Independent review รอบ2 | CLOSED 5/5 findings | ปิด4web findingsและ1motion timing findingจากsource; reviewerไม่ได้ตรวจMP4สุดท้ายซ้ำ; ผู้ทำmotionตรวจ8stillsและmainตรวจ4criticalstillsจากไฟล์สุดท้าย |
| Motion dependency audit | PASS | `npm audit --audit-level=high` ในแพ็กเกจmotionรายงาน0 vulnerabilities; ไม่แก้dependenciesแอปหลัก |
| Production proof clip | NOT RUN | มีแผนแยกในvideo-brief.md; filmไม่ใช่screen recordingของคำขอAI |
| Human comprehension | NOT RUN | ยังไม่มีคนใหม่ดูแล้วตอบคำถามความเข้าใจ |
| Voiceover / subtitle tracks | NOT PRODUCED | script TH/ENเตรียมไว้; MP4เงียบ ไม่เรียกAPIเสียง |
| App runtime regression | NOT RUN LOCALLY | ไม่มีการแก้sourceแอป, rootREADME, auth หรือbackend |

Full UI gate เรียก `node <ui-gate-skill>/gate.mjs docs/narrative/F077/review.html --full` (pathของskillขึ้นกับเครื่อง) เก็บผลterminalจริงในignored `test-results/f077/ui-gate-full.log` ผล16/16เฉพาะรายการที่วัดไม่ใช่20/20 และไม่ใช่ผลตัดสินความสวย

ภาพหน้าร่างตรวจผ่านเบราว์เซอร์ที่เปิดบนlocalhost ไม่ใช้ภาพpreviewแทนการทดสอบstate ผลscreen captureเก็บแยกในignored test-results ไม่เผยแพร่ข้อมูลเครื่องหรือบัญชี

Final MP4 SHA-256: `9198e8852be7998441f81873c11adb1a26bdc9e55ac2f7f345ca969a2bf1fc34`

## ประวัติและ CI

รอบแรกเป็นMP4เงียบ36s SHA-256 `6d381e728b1c0c7df216cad126f66532230969be6a9b22f7932019a4aa60cef0` พร้อมหน้ารวม4panels; ผลmobile/fullUIgateรอบนั้นเป็นSKIPPED รอบ2แทนที่สื่อดังกล่าวด้วยfilm60sและหน้าร่างใหม่ ผลตรวจรอบแรกไม่ถูกนับเป็นการตรวจรอบ2

[CI run 40066679080](https://github.com/Thanyers/tabletop/actions/runs/40066679080) ของร่างแรกcommit `dfdaf14` มี `local-validation` FAIL จากdependency auditของrootpackageเดิม เช่นเดียวกับ [runตอนจองงาน](https://github.com/Thanyers/tabletop/actions/runs/40064265190) (4 moderate / 3 high) ซึ่งเกิดก่อนเพิ่มmotion package งานนี้ไม่แก้rootdependencies และยังคงเป็นdraft PR; ผลCIของcommitที่ส่งล่าสุดต้องดูจาก [PR259](https://github.com/Thanyers/tabletop/pull/259)

ตรวจ `node scripts/check-public-files.mjs`, `npx tsx server/changelog.ts check` และ `git diff --check` ก่อนcommit โดยไม่ข้ามhook

คำว่าPASSอ้างเฉพาะขอบเขตแต่ละแถว ไม่ครอบหลายบัญชี ความปลอดภัย หรือผลการใช้งานจริงของผลิตภัณฑ์
