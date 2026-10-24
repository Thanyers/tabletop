# Tabletop — video brief, storyboard และ production prompt

สถานะ: **Draft 02 / concept film** · 60 วินาที · 1280×720 / 30fps · ภาษาไทยในภาพ · ทำด้วยโค้ดทั้งหมด · สถานะเสียงและผล render ดู [verification](verification.md)

[ดู MP4](media/tabletop-narrative-draft.mp4) · [poster](media/tabletop-narrative-poster.png) · [source/render](motion/README.md) · [references](references.md)

## แกนเรื่อง

เก้าอี้ช่วยให้เรานั่งคิด ปากกาช่วยให้ความคิดมีรูปร่าง ค้อนช่วยให้สิ่งที่คิดประกอบเป็นของจริง เครื่องมือที่ดีทำให้เราอยู่กับสิ่งที่อยากทำ และเมื่อสิ่งที่อยากทำเปลี่ยน เครื่องมือควรปรับตามได้

เล่าต่อด้วยร้านกาแฟเล็ก ๆ เพียงเคสเดียว: เริ่มจากคำขอ เห็นตารางและกฎให้ตรวจ เปิดใช้ แล้วค่อยเพิ่มผลสรุป กราฟ ข้อมูลรอบใหม่ และกฎส่วนลด ทุกชิ้นอยู่บนโต๊ะเดียวกัน โต๊ะเติบโตโดยไม่ล้างสิ่งที่สร้างไว้

เก้าอี้ ปากกา ค้อน เป็นคำเปรียบเทียบที่ร่างใหม่ ไม่ใช่ประวัติผู้ก่อตั้งที่ยืนยันแล้ว ภาพการใช้งานเป็นภาพอธิบายพร้อมข้อมูลตัวอย่าง ไม่ใช่การบันทึกคำขอ AI จริง

## Storyboard 60 วินาที

| เวลา | ภาพ / การกระทำ | ข้อความหลัก | การต่อภาพ |
| --- | --- | --- | --- |
| 0–9 | เก้าอี้เข้ามา ตามด้วยปากกาที่เพิ่มรอยเขียน และค้อนที่เพิ่มตะปู; วัตถุเดิมคงอยู่ | เครื่องมือที่ดี ให้เราอยู่กับสิ่งที่อยากทำ | วางเพิ่มทีละชิ้น; ไม่มีวัตถุเปลี่ยนชนิด ไม่มี morph |
| 9–14 | ข้อความ “ช่วยทำโต๊ะสรุปยอดขายวันนี้” อยู่บนพื้นที่ว่าง | เริ่มจากสิ่งที่อยากทำ | เลื่อนกรอบภาพเข้าสู่โต๊ะ; ให้เวลาอ่านคำขอ |
| 14–22 | ตารางกาแฟ/เค้กและช่องกรอกข้อมูลเข้ามาทีละใบ | เติมเครื่องมือที่งานต้องใช้ | เคลื่อนเข้า 12–18 frames แล้วพัก; การ์ดตั้งตำแหน่งถาวร |
| 22–29 | เพิ่มกฎยอดรวม มีช่วงตรวจข้อเสนอ แล้วกดใช้ | ตรวจ แล้วเปิดใช้ | กล้องเข้าใกล้กฎ; สถานะเปลี่ยนหลัง Apply เท่านั้น |
| 29–36 | ตัวเลข 225 และกราฟงอกจากกฎผ่านเส้นเชื่อม | ต่อผลลัพธ์ออกไป | เส้นวาดจาก source ไป output; ตาราง/กฎเดิมยังอยู่ |
| 36–42 | ราคา/จำนวนใหม่เข้าตาราง ยอดและกราฟเปลี่ยนเป็น 405 | ข้อมูลใหม่ ใช้วิธีคิดเดิม | เน้นเฉพาะเซลล์ที่เปลี่ยน แล้วส่งต่อไปผล |
| 42–50 | เลือกกฎส่วนลด ดูข้อเสนอ 10%→20% แล้วกดใช้ | เปลี่ยนกฎ เมื่อวิธีทำงานเปลี่ยน | ข้อเสนออยู่ข้างกฎเดิม ไม่แทนผลก่อนกดใช้ |
| 50–55 | แตกผลหลังลดเป็น 324; gross 405 คงอยู่ | โต๊ะเดิม ทำได้มากขึ้น | เพิ่มแขนงใหม่ แยกยอดก่อนลด/หลังลดชัดเจน |
| 55–58 | กล้องถอยให้เห็นภาพรวมบอร์ดเดียวที่สร้างมาตลอด | ค่อย ๆ เพิ่ม ค่อย ๆ ปรับ ค่อย ๆ เติบโต | ไม่รื้อบอร์ดหรือรีเซ็ตไปต้นเรื่อง |
| 58–60 | โลโก้/wordmark เดิม พร้อม CTA สั้น | tabletop. — เริ่มจากงานของคุณ | ใช้ motion ของ repo; end hold อ่านชื่อและที่ไปต่อ |

กรอบเวลาเป็น contract ของการผลิต จังหวะย่อยที่ปรับเพื่ออ่านทันต้องบันทึกไว้ใน motion README และรักษาความยาวรวม 60 วินาที ช่วง 14–58 ต้องใช้ world/canvas เดียว ไม่เป็นชุดสไลด์ที่ลบของเดิมออก

## ข้อมูลตัวอย่างเดียวกันทุกสื่อ

| ช่วง | Coffee | Cake | Gross | Discount | Net |
| --- | --- | --- | --- | --- | --- |
| ก่อนแก้ข้อมูล | 3 × 25 = 75 | 3 × 50 = 150 | 225 | ไม่แสดง | ไม่แสดง |
| หลังแก้ราคา/จำนวน | 3 × 35 = 105 | 6 × 50 = 300 | 405 | ไม่แสดง | ไม่แสดง |
| ก่อนแก้กฎ | ข้อมูลชุดเดิม | ข้อมูลชุดเดิม | 405 | 10% | 364.50 |
| หลังแก้กฎ | ข้อมูลชุดเดิม | ข้อมูลชุดเดิม | 405 | 20% | 324 |

ยอดเหล่านี้เป็นตัวอย่างที่คำนวณตรวจได้ ไม่ใช่ยอดร้านจริงหรือbusiness KPI การกำหนดCoffee/Cakeและลำดับนี้เป็นเรื่องที่แต่งเพื่อสื่อสาร รองรับความสามารถด้วยผลทดสอบรายเคสตาม [evidence](evidence.md) แต่ไม่ได้อ้างว่าร้านนี้เคยใช้ระบบจริง

## เสียงบรรยายที่เตรียมไว้ — ไทย

> เก้าอี้ ให้เรานั่งคิด ปากกา ให้ความคิดมีรูปร่าง ค้อน ช่วยให้มันเป็นจริง เครื่องมือที่ดีทำให้เราอยู่กับสิ่งที่อยากทำ แล้วถ้าซอฟต์แวร์ปรับตามงานเราได้ล่ะ? บอก Tabletop ว่าอยากทำอะไร เริ่มจากตาราง เติมวิธีคำนวณ ตรวจ แล้วเปิดใช้ ต่อเป็นตัวเลขสรุปและกราฟ เมื่อข้อมูลใหม่เข้ามา ใช้วิธีคิดเดิม เมื่อวิธีทำงานเปลี่ยน เลือกกฎที่ต้องแก้ ตรวจ แล้วใช้ต่อ ข้อมูลเดิมยังอยู่ เครื่องมือใหม่ค่อย ๆ งอกขึ้นบนโต๊ะเดียวกัน Tabletop เริ่มจากงาน ให้เครื่องมือโตไปด้วยกัน

เป็น script ที่ยังไม่บันทึกเสียง ต้องอ่านจับเวลาจริงก่อนนำเข้าคลิป ไม่อ้างว่าทดสอบเวลาเสียงแล้ว ข้อความในภาพควรสั้นกว่าเสียงเสมอ

## Voiceover draft — English

> A chair gives you a place to think. A pen gives an idea a shape. A hammer helps you build it. Good tools keep you close to what you want to do. What if software could adapt to your work, too? Tell Tabletop what you need. Start with a table. Add a calculation. Review it, then put it to use. Connect a total and a chart. New data, same calculation. A new plan? Change the rule. Review, apply, and keep going. The work stays. The tools grow. Tabletop. Start with your work.

แยก export ภาษาในรอบ final; ไม่ใส่สองเสียงทับกัน และไม่เปิดเสียงเองบนเว็บ

## กติกา motion และเสียง

- ใช้ logo/wordmark เดิมและแปลง loader animation จาก repo เป็น deterministic frame timing ตาม [asset map](references.md) ไม่ทำโลโก้ใหม่
- ใช้ translate, reveal mask, draw-on และ camera movement; ห้าม interpolate SVG path ให้เก้าอี้กลายเป็นโต๊ะ ปากกากลายเป็นค้อน หรือการ์ดกลายเป็นวัตถุอีกชนิด
- ช่วงเปลี่ยนภาพประมาณ 0.4–0.6s; ภาพที่มีคำอธิบายต้องมีเวลาอ่านหลัง transition อย่างน้อย 2.2s ตัวเลขสำคัญหยุดให้เห็นครบ
- วางข้อเสนอและผลที่ใช้อยู่ให้ต่างกัน ก่อน Apply ผลเดิมยังอยู่; หลัง Apply จึงเปลี่ยนผล
- ป้าย “ภาพอธิบาย · ข้อมูลตัวอย่าง” อ่านได้ตลอดคลิป ไม่มี loading ปลอมที่ตีความเป็น latency จริง
- เสียงประกอบทำจากโค้ดได้ แต่ต้องเบาและมีเจตนา ไม่ใส่ whoosh ทุกใบ ไม่คัดลอกเพลงจาก reference
- ElevenLabs เป็นทางเลือกสำหรับ TTS หลังเลือกเสียงที่มีสิทธิ์ใช้ รอบนี้ไม่ต้องใช้ key และไม่เรียก API เสียเงิน
- ภาพ 16:9 เป็น master; อย่าครอปเป็น 9:16 แล้วตัดข้อความสำคัญ การทำ portrait ต้องจัดภาพใหม่

## Production prompt สำหรับ coding agent

```text
Build a 60-second Tabletop product film with Remotion, React, SVG, CSS and local repository assets. Do not generate video or images with AI. Read the repository instructions and this brief. Preserve app runtime behavior and work only in the assigned draft media package.

The central idea is accumulation: a useful canvas grows around a person's work. Keep one spatially continuous board from 14s to 58s. Existing cards retain positions. Add new cards, change selected values or one selected rule, then branch new outputs. The camera may pan and zoom. Do not build a slide carousel.

Use the exact canonical Tabletop four-piece mark, round gold lower-right tile, lowercase tabletop. wordmark, and the loader animation in src/loading/loading-screen.css. Port its 2.4s tilt and 1.2s staggered tile pulses to frame math. Reuse existing showcase animation/motion where appropriate and record provenance. Do not reuse the incorrect all-square uppercase mark from Draft 01.

Opening 0–9s: introduce a chair, a pen and a hammer as separate objects. The pen adds a drawn mark, the hammer adds a nail, and the chair stays a chair. Keep prior objects. Transition to the canvas by a cut, mask or camera move. NO MORPH between objects, paths, logos or UI types.

Follow the 60s storyboard in this brief. Use readable Thai captions; avoid simultaneous paragraphs. Make entrances 12–18 frames with a purposeful ease, then hold the content. Existing brand motion has its original duration. The discount proposal is not applied until explicit review and apply.

Arithmetic is fixed: Coffee 3x25=75, Cake 3x50=150, total225. New data Coffee3x35=105 and Cake6x50=300, total405. Discount10% gives364.50; discount20% gives324. Gross405 remains unchanged when discount changes. Keep chart and table values consistent. The shop is fictional illustrative data.

Render at1280x720,30fps,1800frames,H.264. Every visual state must be deterministic from frame and props. No network calls during rendering, no wall-clock CSS animation, no invented performance numbers. Persistent readable label: ภาพอธิบาย · ข้อมูลตัวอย่าง. This is concept animation, not a product screen recording.

Deliver MP4, poster, eight MP4-derived stills, editable source, render script and asset provenance. Verify arithmetic, continuity, selected-rule before/after, readable safe areas, typography, duration and media playback. Report actual audio status and any skipped checks. Do not call paid voice APIs or copy a reference soundtrack. Keep current public page and root README unchanged until integration is requested.
```

## Proof clip แยกจาก film

คลิป 60–90 วินาทีจาก QA ต้องเริ่มห้องว่าง ส่ง prompt จริง ตรวจและเปิดใช้ เพิ่ม CSV เปลี่ยนข้อมูล รันวิธีคำนวณเดิม ขอแก้กฎเฉพาะใบ และ reload พร้อมอ่านผลกลับ ระบุช่วงที่ตัดหรือเร่งเวลา ไม่เติมผลสำเร็จที่ไม่เกิดจริงด้วย motion

ความสามารถมีหลักฐานรายเคสใน [evidence](evidence.md) แต่ยังต้องบันทึกเส้นเรื่องต่อเนื่องนี้ใหม่ ตัวเลขที่เปลี่ยนจากโค้ดใน film ไม่ใช่การทำ proof ขั้นนี้
