# F077 — เรื่องเล่า Tabletop สำหรับหน้าเว็บ README และวิดีโอ

| | |
| --- | --- |
| สถานะ | `done` — round 10 / [PR #306](https://github.com/Thanyers/tabletop/pull/306), [release #309](https://github.com/Thanyers/tabletop/pull/309); production 9.1.4 / d09d2f2; deployment/smoke passed |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชัน | 9.1.4 — three-case hero rotation only; README, film and other page content unchanged |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว F077-T1 ถึง F077-T5 |

## ทำไม

หน้าแรกและ README อธิบายแนวคิดได้ แต่ความสามารถที่พิสูจน์แล้วเรื่องเริ่มจากข้อความ เติมข้อมูล ใช้วิธีคำนวณซ้ำ และแก้กฎเฉพาะใบยังไม่ปรากฏเด่น ผู้ใช้ขอแผนและร่างทั้งสามสื่อ พร้อมเปรียบเทียบของเดิม และวิดีโอจากโค้ดเท่านั้น

## ขอบเขต

รวม: แผนเรื่องเล่า ข้อความหน้าเว็บ TH/EN ที่เข้ากับส่วนประกอบเดิม README ฉบับร่าง storyboard/prompt และ Remotion animatic แยกจากแอปจริง

รวมเพิ่มเติมตามคำสั่งผู้ใช้รอบ5: นำหน้าเว็บร่างที่ยอมรับแล้วไปปรับในhomepage sourceจริง ใช้Englishเป็นค่าเริ่มต้น และใช้ElevenLabsสร้างเสียงหญิงที่กำกับอารมณ์ได้ผ่านkeyเฉพาะเครื่อง

รอบ 6 ผู้ใช้ยอมรับเรื่องและภาพ ขอเร่ง intro และบางช่วง พร้อมสั่งให้นำขึ้นเว็บเมื่อเสร็จ จึงรวม production release ตาม workflow ของ repo

รอบ 7: ผู้ใช้ให้ใช้ร่างกับ root README จริงเป็นภาษาอังกฤษ ปรับ hero ให้มีภาพที่สื่อความหมาย แสดงการปรับด้ามค้อน/เก้าอี้ให้เข้ากับคน และเอา README ออกจากทางเดินหน้าเว็บ หน้าเว็บต้องอธิบายและพาไปทดลองได้ในตัวเอง

ไม่รวม: โมเดลสร้างวิดีโอ หรืออ้างภาพจำลองเป็นผลการใช้ระบบจริง

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| 2026-10-24 | รอบ6: กระชับเวลาตามช่วง โดยคงเสียงหญิง บท ภาพ และจังหวะพิมพ์/ตรวจ/ใช้ที่ยอมรับ; นำขึ้นเว็บหลังผ่านการตรวจ | ผู้ใช้อนุมัติทิศทางรอบ5และขอเพิ่ม pace พร้อม release |
| F077-T1 | ตรวจของเดิมและ reference; ร่างสามสื่อพร้อม animatic | เอกสารครบ ลิงก์ถูกต้อง render สำเร็จ ตรวจภาพและเนื้อหา independent review |
| F077-T2 | Apply English README and improve homepage visual story | Hero shows a useful evolving table; physical additions visibly answer a person's need; no README navigation; language/auth/reduced-motion behavior retained |

## การตัดสินใจ

### Round 10 / F077-T5 — three hero GIF cases

User scope (26 October 2026): change only the homepage hero GIF area. Rotate three 18-second prompt-first cases: café sales (opens; concrete everyday value), existing physics learning, then adventure play (breadth beyond work). Preserve the accepted learning GIF bytes and its original animation style. Each new case types before adding a usable card, retains earlier cards and visibly uses a control. Add compact case selectors within the existing hero area; retain Pause/Resume and static posters with no automatic rotation under reduced motion. English and Thai stay aligned. README, film, other page sections and backend are outside scope.

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-24 | รอบ5: เล่าปากกา/ค้อน/เก้าอี้ที่ปรับเพื่อคน → ปัญหาsoftwareที่คนต้องปรับตาม → Tabletop → ตัวอย่าง; white/logo-only outro; voice conversationalกระตือรือร้น | ผู้ใช้ปฏิเสธintroเปิดcaseทันทีและเสียงเรียบ; referenceใหม่เน้นภาพตามความหมายและtimingคำพูด |
| 2026-10-24 | คงหน้าเว็บที่ผู้ใช้ยอมรับและตั้งEnglishเป็นbase; เก็บThai toggle | ผู้ใช้ยืนยันดีไซน์เว็บแล้ว ไม่เปลี่ยนlayoutต่อ |
| 2026-10-24 | รอบ 4 เพิ่มเสียงบรรยายอังกฤษและเสียงที่สัมพันธ์กับการกระทำ ปรับ pace และเปิดเรื่องด้วยการจดออร์เดอร์จริง | ผู้ใช้ไม่เข้าใจรูป tools และต้องการฟังเข้าใจโดยไม่อ่านทุกอย่าง; คำสั่งล่าสุดEnglish-firstและไม่จำกัด1นาที; ภาพยังสร้างจากโค้ด |
| 2026-10-24 | รอบ 3 เล่าคนขายที่ค่อย ๆ ขอปรับโต๊ะ: จดขาย → ปุ่มขายเร็ว → กราฟ → โปรโมชัน → แก้กฎ | ผู้ใช้ชี้ว่ารอบ 2 ยังไม่มีจังหวะพิมพ์และไม่เห็นเครื่องมือปรับให้เข้ากับคน; ทุกการเพิ่มต้องตามหลังคำขอและเห็นการใช้จริงในตัวอย่าง |
| 2026-10-24 | รอบ 2 ใช้บอร์ดเดียวค่อย ๆ เพิ่ม แก้ และแตกแขนงในคลิป 60s; ห้าม morph วัตถุ | ผู้ใช้ต้องการเห็นวิวัฒนาการของโต๊ะชัด ๆ และมีเวลาอ่านผล |
| 2026-10-24 | ใช้ mark/wordmark และ loader animation จาก repo; เปิดเรื่องด้วยเก้าอี้ ปากกา ค้อนที่แยกเป็นวัตถุ | รักษาอัตลักษณ์และขยายคำเปรียบเทียบให้เห็นเครื่องมือหลายแบบ |
| 2026-10-24 | หน้าเว็บร่างใช้บอร์ดที่กดเพิ่ม/แก้ได้เป็นภาพหลัก และย้ายเครื่องมือ review ลงชั้นรอง | ผู้ใช้เห็นว่าหน้าแรกของร่างเดิมน่าเบื่อ; ต้องให้ประโยชน์ปรากฏเป็นการกระทำ |
| 2026-10-24 | ใช้ Remotion/React/SVG และ deterministic frame timing | ผู้ใช้กำหนดให้ทำวิดีโอด้วยโค้ด ห้ามโมเดลสร้างวิดีโอ |
| 2026-10-24 | แยกสื่อร่างจากไฟล์ public ที่กำลังใช้ | ผู้ใช้ขอวางแผนและร่างเพื่อดูสามสื่อร่วมกัน |
| 2026-10-24 | เล่าเก้าอี้เป็นคำเปรียบเทียบที่ร่างใหม่ | ยังไม่พบต้นฉบับเรื่องเก้าอี้ใน source ที่ตรวจ |
| 2026-10-24 | แยกภาพอธิบายจากหลักฐานใช้งานจริง และ baseline ก่อนแข่งจากงานในวันแข่ง | รักษาความหมายของหลักฐานและกติกางาน |
| 2026-10-24 | ใช้เคสร้านกาแฟหนึ่งเรื่องเป็นแกน แล้วเปิดบริบทงาน/เรียน/เล่นตอนท้าย | เห็นเหตุและผลของข้อมูลใหม่/กฎใหม่บนโต๊ะเดิมได้เร็ว |

## ชุดส่ง review

[แผนและเปรียบเทียบของเดิม](../narrative/F077/README.md) · [หน้า preview](../narrative/F077/review.html) · [copy หน้าเว็บ](../narrative/F077/landing-copy.md) · [README ภาษาอังกฤษ](../../README.md) · [video brief/prompt](../narrative/F077/video-brief.md) · [ผลตรวจ](../narrative/F077/verification.md)

รอบ 6 ใช้บทอังกฤษเดิมแต่กระชับเป็น 93.2 วินาที: เครื่องมือปรับเพื่อคน → software friction → Tabletop → คนขายค่อย ๆ พิมพ์ขอเครื่องมือเพิ่มและใช้ต่อบนโต๊ะเดิม เสียงหญิง Laura เป็นทิศทางที่ผู้ใช้ยอมรับ โลโก้และ loader motion มาจาก repo; outro พื้นขาวและโลโก้เท่านั้น ภาพถ่ายมี credits/license; ไม่มี AI สร้างวิดีโอหรือภาพ

หน้า homepage จริงใช้ดีไซน์ที่ยอมรับและ English เป็นฐาน บอร์ดตัวอย่างทำงานใน browser โดยไม่เรียก AI หรือบันทึกข้อมูล runtime มีส่งคำขอ → Review → Apply ครบห้าบท; ข้อมูลเดิมและยอดที่ใช้อยู่ไม่เปลี่ยนระหว่างตรวจร่างส่วนลด รอบ 7 นำ README ภาษาอังกฤษไปใช้ใน root แล้ว

สถานะการตรวจและข้อจำกัดล่าสุดอยู่ใน [verification](../narrative/F077/verification.md) ผลของรอบ 4 เก็บเป็นประวัติ ไม่ใช่ผลรับรองรอบ 5

## Round 8 — bounded hero and image correction

The user explicitly limited visible edits to the hero animation/note/framing and the physical adaptation images. The new hero must type each request before its card appears, retain earlier cards, loop without a Play click, and have one flat canvas. Keep the existing README animation and accepted R6 film unchanged. Physical images must be realistic and show substantial individual fit (a hand-shaped hammer grip; a chair with seat/back/arm/foot supports), retaining the same object and person before/after. Generated image provenance and exact prompts live beside those image assets.

Round 8 candidate: 18-second EN/TH infinitely looping GIFs, typed request then experiment/controls/chart, flat background matching the homepage. A small Pause/Resume icon provides motion control while autoplay remains the default; reduced motion receives a poster. Node 22.23.2 build/typecheck, Worker dry-run and scoped lint pass. Browser changed groups and four-width visual readback pass; the complete 35-group suite and full release CI passed, and production 9.1.2 was verified. The independent source review confirms unchanged README/film/sales content.

## Round 9 — reading order and editorial cleanup

User scope: homepage and root README only; the accepted film stays unchanged. Establish what Tabletop does, show why tools should fit people, connect that to software friction, then demonstrate the same café table evolving through use. Broader work/learning/play examples follow; the film is an optional continuation near the end. Preserve the populated café start and all existing actions.

Remove repeated eyebrows and aphorisms, the THE IDEA callout, duplicated physical-example labels, LOCAL ILLUSTRATION and text-interpreted implementation notes. Keep one prepared-example disclosure next to the café heading. README moves the existing learning GIF into Learning, retains current capability qualifications and the exact AGPL section, and removes unrelated D&D/unrestricted-execution disclaimers.

Node22.23.2 build/typecheck, Worker dry-run, scoped lint, 13 README local references and unchanged-license check pass. CUA verifies order and no overflow at 280/320/414/1280. Stable-content readback is identical with reduced motion and the poster loads. Full offline UI gate: 13 measured PASS, 3 FAIL, 4 SKIP; failures are shared CSS literals, index-based parity after a motion control is removed, and the already-selected English button. These findings are retained, not marked PASS. Local browser suite: 35 groups; final-source full release CI passed. Public content is live; Container settings deployment remains incomplete (#291).
