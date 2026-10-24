# Tabletop — แผนและชุดร่างสามสื่อ

วันที่ 24 ตุลาคม 2026 · สถานะ: **draft สำหรับ review** · ฐาน source `9efebab0c4c9` · production ที่ตรวจในรอบรีวิว `9.0.2 / 8e2c7e1`

เปิด [หน้ารวมร่าง](review.html) เพื่อดูคลิปและข้อความ; [หน้าเว็บ TH/EN](landing-copy.md), [README ฉบับร่าง](readme-draft.md), [storyboard และ prompt ผลิตวิดีโอ](video-brief.md), [หลักฐานและขอบเขต](evidence.md)

ผลตรวจชุดร่างและสิ่งที่ยังไม่ตรวจอยู่ใน [verification](verification.md)

ชุดนี้ยังไม่แทนที่หน้าแรกหรือ README ที่เผยแพร่ ไม่มีการเรียกโมเดลสร้างวิดีโอ/ภาพ ไม่มีเสียงจาก API และไม่มี production mutation

## เรื่องเดียวที่ทั้งสามสื่อต้องส่งต่อ

**คุณมีงานที่อยากทำ → เครื่องมือควรพอดีกับงาน → บอกโจทย์ให้ Tabletop → ตรวจแล้วใช้ → เมื่อข้อมูลหรือวิธีทำงานเปลี่ยน ปรับต่อบนโต๊ะเดิม**

เก้าอี้เป็นคำเปรียบเทียบสั้น ๆ สำหรับเครื่องมือที่ช่วยให้คนมีสมาธิ ไม่ใช่เรื่องประวัติผู้ก่อตั้งที่ยืนยันแล้ว และไม่ใช่การเปลี่ยน Tabletop ให้เป็นผลิตภัณฑ์เกี่ยวกับเฟอร์นิเจอร์

Belief: **The best tool is the one you don't have to think about.**

Product thesis: **Work defines what software becomes.**

ข้อเสนอหน้าบ้าน: **เริ่มจากสิ่งที่อยากทำ ให้เครื่องมือค่อย ๆ พอดีกับงานของคุณ** / **Start with your work. Let the tools take shape.**

## บทบาทของแต่ละสื่อ

| สื่อ | ผู้ชมควรได้อะไร | จังหวะและรูปแบบ | สิ่งที่ไม่ยัดลงไป |
| --- | --- | --- | --- |
| หน้าเว็บ | รู้ในจอแรกว่าช่วยอะไร เห็นการเปลี่ยนแปลง แล้วเลือกลอง | Hero สั้น, วิดีโอกดเล่น, เรื่องเก้าอี้สั้น, 3 ขั้น, before/after ข้อมูล, งาน/เรียน/เล่น, CTA | ตาราง test/รุ่น library/บันทึก release |
| README | เข้าใจเหตุผล วิธีใช้ ขอบเขต และตามหลักฐานต่อได้ | Markdown อ่านเร็ว, poster ลิงก์วิดีโอ, รายการความสามารถ, วิธีเริ่ม 3 ขั้น, details ขอบเขต, ลิงก์เอกสารและ license | HTML layout ซับซ้อน, autoplay/audio, KPI ที่ไม่ได้วัด |
| วิดีโอ | จำภาพและหลักคิด เห็นว่าเครื่องมือเติบโตไปพร้อมงาน | 36s, 8 beats, typography ใหญ่, geometric continuity, ตัวเลขหนึ่งเรื่อง, end hold | วิธีใช้ทุกเมนู, รายชื่อ library, อ้างว่าเป็นการบันทึก AI ใช้งานจริง |

## ของเดิม → ร่างใหม่

| ด้าน | ของเดิมที่ตรวจ | ร่างใหม่ | เหตุผล |
| --- | --- | --- | --- |
| เปิดเรื่อง | Belief เป็น headline หลักทั้ง README/เว็บ | ประโยคบอกประโยชน์มาก่อน แล้วใช้ belief กับเก้าอี้ | ให้รู้ว่าผลิตภัณฑ์ทำอะไรตั้งแต่ต้น |
| ภาพ hero | SVG แนวคิด task table | ใช้ poster จากเรื่องเดียวกับวิดีโอ และปุ่มกดเล่น | ลดการมีหลายเรื่องที่คนต้องประกอบเอง |
| ที่มา | ช่าง/ครู/เพื่อนปรับเครื่องมือ; ไม่มีเก้าอี้ | เก้าอี้ 3 ประโยค → ซอฟต์แวร์ที่ปรับตามงาน | เพิ่มภาพจำโดยรักษาน้ำเสียง |
| เนื้อหาหลัก | Invoice / Physics / Encounter กระจายสามเรื่อง | ยอดขายหนึ่งเรื่องต่อเนื่องก่อน แล้วค่อยขยายสามบริบท | ทำให้เห็นกลไกที่เชื่อมความสามารถ |
| จุดเริ่มใน motion | วางไฟล์บทเรียนก่อน | พิมพ์โจทย์บนโต๊ะว่าง แล้วเพิ่มข้อมูลทีหลัง | ตรงกับ no-file-first ปัจจุบัน |
| ความสามารถ | ตาราง ปุ่ม กราฟ ฉาก | เพิ่มเก็บวิธีคำนวณไว้ใช้ซ้ำ, input→output, ถาม/แก้กฎเฉพาะใบ | ให้เห็นส่วนที่ลึกกว่าหน้าตา |
| สื่อเคลื่อนไหว | Remotion GIF 20s, 960×540, 12fps; ฟิสิกส์ 10→20N | Remotion MP4 draft 36s, 1280×720, 30fps; ยอด225→405/ส่วนลด10→20% | จังหวะคล่องและอ่านเลขได้; source แก้ต่อได้ |
| ความน่าเชื่อถือ | ภาพจำลอง + screenshots เดโมที่เตรียมไว้ | ยังคงป้าย provenance; แยกแผนบันทึกการใช้จริงไว้ใน evidence | ความสวยของ motion ไม่ใช่ผลพิสูจน์ runtime |
| ภาพเดโมเดิม | Physics/Encounter | เก็บไว้ช่วง use cases พร้อมคำกำกับเดิม | ไม่ทิ้งของที่ยังช่วยอธิบายประโยชน์ |

## รูปแบบที่ยืมจาก reference

ตรวจหน้า [Skillry](https://skillry.dev/ai-videos/opus-5-5/deedydas-252537) และ [prompt ต้นฉบับ](https://github.com/yihui-dev/awesome-opus5-5-videos/blob/main/prompts/deedydas-252537.md) เมื่อ 24 ต.ค. 2026: reference ยาว26วินาที; prompt สั้นและไม่ได้ระบุ shot list; remake ระบุ SVG/GSAP

เฟรมที่ตรวจเห็น typography ใหญ่เต็มภาพ, พื้นขาวโล่งสลับสีอิ่ม, ลายคำ/ข้อมูลเคลื่อนผ่านจุดสนใจ, ตัวเลขใหญ่บนแผ่นกลาง และจบด้วย wordmark ภาพทรงเรขาคณิต เราใช้หลักการลำดับสายตา/จังหวะ/ความต่อเนื่องนี้ แต่คงครีม เขียวเข้ม หมึก และฟอนต์ของ Tabletop ไม่คัดลอกโลโก้ ข้อความ ตัวเลข performance หรือเสียงของ reference การตรวจครั้งนี้ไม่ประเมิน soundtrack ของ reference

## การวางจริงในหน้าเว็บ

1. คง header, ตัวเลือก EN/ไทย, auth URLs, callbacks และช่อง signed-in เดิม
2. Hero สองคอลัมน์: H1+promise+CTA ซ้าย; poster/video ที่มี controls ขวา มือถือเรียงข้อความก่อนวิดีโอ
3. CTA หลักใช้ primaryHref เดิม; CTAรองเลื่อนไปวิดีโอ ไม่พาเข้าสู่ระบบก่อนรู้ว่าคืออะไร; ลิงก์เดโมเดิมอยู่ในส่วน use cases
4. Section เก้าอี้สั้นคู่ SVG chair; process3ขั้นใช้ copy ที่เตรียมไว้; เพิ่มตัวอย่างข้อมูลก่อน/หลังพร้อมคำว่า illustrative
5. คงภาพเดโมเดิมและป้ายข้อมูล/ผู้เล่นจำลอง; ปิดด้วย CTA ที่ลงมือได้
6. วิดีโอต้องไม่เล่นเสียงเอง; ใช้ poster+preload metadata; reduced motion เริ่มจากภาพนิ่งและกดเล่นเอง; subtitle track TH/EN ใน final

ไฟล์ที่ implementation phase จะเกี่ยวข้อง: `src/tabletop/ui/PublicWelcome.tsx`, `landing-copy.ts`, `public-welcome.css`, `docs/showcase/` และ README ที่ root ไม่มีเหตุผลให้แตะ auth/backend ในงานนี้

## แผนผลิตและตรวจรับ

| ช่วง | ผลงาน | เกณฑ์ผ่าน |
| --- | --- | --- |
| 1 — ชุดร่างนี้ | แผน, copyTH/EN, README, storyboard, production prompt, silent animatic | เรื่องและตัวเลขตรงกัน; ทุกภาพจำลองมีป้าย; renderจริง/เปิดเล่นได้ |
| 2 — ภาพและเสียง final | 1920×1080/30fps, versionTH/EN, subtitles, poster; optional12s web cut | อ่านข้อความทัน, โทนแบรนด์, ไม่มี flash, เสียงไม่กลบคำ, ตรวจเฟรม cut และหลัง pause |
| 3 — บันทึก proof | คลิปใช้แอปจริง60–90sในห้องQAที่ได้รับอนุญาต | no-file→review/apply→import→rerun→rule change→reload พร้อมreadback; ระบุช่วงตัด/เร่งเวลา |
| 4 — นำเข้าเว็บ/README | ใช้ copy/assetsที่ review แล้ว | mobile280/320/414, desktop, language parity, keyboard, links/auth unchanged, reduced motion/poster, media budget |
| 5 — judge companion | baselineก่อนงาน / ผลงานที่ทำระหว่างงาน / Codex evidence | มีcommit/PR/test/demoของงานใหม่; ไม่ตีความของเดิมว่าเป็นงานในวันแข่ง |

ไม่จำเป็นต้องรอ proof clip เพื่อ review copy/animatic แต่ห้ามเรียก animatic ว่า proof การสร้างสำเร็จจริง

## ขอบเขตเวทีประกวด

[Sea x OpenAI Regional Codex Hackathon Thailand](https://luma.com/39zve8ph) ระบุ Problem framing, build quality, depth of thinking, effective use of Codex เป็นเกณฑ์ และอนุญาตต่อยอดของเดิมแต่ตัดสินเฉพาะงานใหม่ที่ทำระหว่างงานอย่างมีนัยสำคัญ งานวันที่21พ.ย.2026 ความสามารถ9.0.2ที่ตรวจ23ต.ค.จึงเป็นbaseline

ข้อเสนอ: ชู AI-Native Products & Operations เป็นแกน หน้าเว็บและ README เล่าผลิตภัณฑ์ทั้งหมด ส่วน judge companion แสดงขอบเขตงานวันแข่งต่างหาก หลักฐานว่าใช้ Codex พัฒนาและ provider ที่รันในผลิตภัณฑ์เป็นคนละเรื่อง ห้ามเรียก Tabletop ว่า powered by Codex หากไม่มีหลักฐาน runtime รองรับ

## เรื่องที่ยังต้องเลือกก่อน final

- Voice: เริ่มด้วย English สำหรับคลิปหลักและซับไทย; เลือก voice ที่มีสิทธิ์ใช้ก่อนเรียก ElevenLabs ไม่ต้องใช้ key สำหรับ silent draft
- จังหวะของ animaticเป็นข้อเสนอ; ยังไม่มีผล human comprehension test ควรให้คนใหม่ดูแล้วตอบว่าได้เครื่องมืออะไร เปลี่ยนอะไรได้ และช่วงไหนเป็นภาพจำลอง
- ไม่อ้างวันแข่งมีการสร้างฟีเจอร์ใดไว้ล่วงหน้า จัด baselineและcommitที่เกิดจริงในวันนั้น
