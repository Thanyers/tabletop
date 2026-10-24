# F077 — ผลตรวจชุดร่าง

24 ตุลาคม 2026 · Node.js 22.23.2 · ขอบเขต: เอกสารและสื่อร่าง ไม่ใช่การรับรอง production runtime

| การตรวจ | ผล | หลักฐาน / ขอบเขต |
| --- | --- | --- |
| คำนวณตัวอย่าง | PASS 4/4 | Coffee/Cake ได้ 225 และ 405; ส่วนลด 10% และ 20% ได้ 364.50 และ 324 |
| ลิงก์ภายในเอกสาร/หน้า review | PASS 53/53 | ตรวจปลายทาง Markdown และ href/src/poster ด้วย Python pathlib; ไม่รวม URL ภายนอก |
| Independent prose review | PASS ในขอบเขตตรวจ | ไม่พบข้อขวางการ review; เพิ่มข้อสังเกตเอกสาร GENERIC_TABLE_DESIGN ที่ยังตามหลังความสามารถปัจจุบันใน evidence.md |
| Render / file metadata | PASS | Remotion render และ ffprobe: H.264, 36.0s, 1280×720, 30fps, ไม่มี audio stream; poster และ 8 scene stills |
| Independent motion review | PASS ในขอบเขตตรวจ | ไม่พบ P1/P2 ใน source/timing/arithmetic/MP4; ตรวจ path และ execFile ของขั้นดึงภาพนิ่งแล้ว; main ตรวจภาพฉาก 6 ที่ดึงจาก MP4 เห็นป้ายและมาตราส่วนครบ |
| Motion dependency audit | PASS | override เฉพาะแพ็กเกจ motion ให้ zod เป็น 4.6.6 ตาม [advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5); `npm audit --audit-level=high` รายงาน 0 vulnerabilities; ไม่แก้ dependency ของแอปหลัก |
| Browser: หน้า review | PASS | สลับ 4 panels, ภาษา TH/EN ของ landing และ details ของ README ได้; ตรวจ desktop ไม่มี horizontal overflow |
| Browser: media | PASS | browser อ่าน duration 36s / 1280×720 ไม่มี media error; การกดเล่นทำให้เวลาเคลื่อนจาก 0 ไป 15.08587s และเลื่อน scrubber ไปท้ายคลิปที่ 36s ได้ |
| Production proof clip | NOT RUN | มีแผนแยกใน video-brief.md; animatic ไม่ใช่หลักฐานว่าคำขออิสระสร้างสำเร็จ |
| Mobile / full UI gate | SKIPPED | รอบนี้ตรวจ desktop review artifact; ต้องตรวจ 280/320/414px และ accessibility ในรอบ integration |
| Human comprehension | NOT RUN | ยังไม่มีคนใหม่ดูแล้วตอบคำถามความเข้าใจ |
| Voiceover / subtitle tracks | NOT PRODUCED | มี script TH/EN; MP4 รอบนี้เงียบ ไม่มี API เสียง |
| App runtime regression | NOT RUN LOCALLY | ไม่มีการแก้ source ของแอป; CI ของ PR ตรวจตามนโยบาย repository |
| CI ตอนจองงาน `4da1fc1` | FAIL | [run 40064265190](https://github.com/Thanyers/tabletop/actions/runs/40064265190) หยุดที่ dependency audit ของ root package เดิม: 4 moderate / 3 high; commit นั้นแก้เฉพาะ PLAN และ feature record ยังไม่มี motion package; F077 ไม่แก้ root dependencies และยังไม่พร้อม merge |

ใช้คำสั่ง `npm run render --prefix docs/narrative/F077/motion` สำหรับ render; `node scripts/check-public-files.mjs`, `npx tsx server/changelog.ts check` และ `git diff --cached --check` ก่อน commit ดูผล render และ independent media review ใน feature record

ภาพนิ่งชุดส่งมอบดึงจาก MP4 ด้วย bundled FFmpeg เพื่อให้ตรงกับคลิป แทนเส้นทาง renderStill ที่ให้ผลป้ายบนภาพไม่สม่ำเสมอในบางครั้ง MP4 SHA-256: `6d381e728b1c0c7df216cad126f66532230969be6a9b22f7932019a4aa60cef0`

คำว่า PASS ในหน้านี้อ้างเฉพาะขอบเขตของแต่ละแถว ไม่ครอบหลายบัญชี ความปลอดภัย หรือผลการใช้งานจริงของผลิตภัณฑ์
