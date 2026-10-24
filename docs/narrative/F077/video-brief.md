# Tabletop film — เครื่องมือค่อย ๆ ปรับให้เข้ากับคุณ

Draft 03 · 60 วินาที · Remotion/React/SVG/CSS · ไม่มีโมเดลสร้างวิดีโอ · [หลักฐานและขอบเขต](evidence.md)

## แกนเรื่องที่แก้

รอบ 2 แสดงการ์ดเพิ่มและตัวเลขเปลี่ยน แต่ยังไม่มีเหตุจากคนใช้ รอบ 3 ต้องเห็น **คนเจอความต้องการ → พิมพ์คำขอ → ส่ง → เห็นร่าง → ตรวจ/ใช้ → ลงมือใช้เครื่องมือที่ปรับแล้ว** วนต่อบนโต๊ะเดิม

ตัวเอกคือคนขายกาแฟและเค้ก เขาไม่ได้รู้ตั้งแต่แรกว่าต้องการ dashboard หรือระบบโปรโมชัน เขาเริ่มจากจดขาย พอใช้แล้วจึงรู้ว่าตรงไหนควรปรับ ซอฟต์แวร์ค่อย ๆ กลายเป็นเครื่องมือของเขาผ่านคำขอเหล่านั้น

ชื่อและตัวเลขร้านเป็นเรื่องสมมติ ภาพเป็น authored concept animation; ไม่ใช่ recording หรือสัญญาว่า AI จะสร้างทุกคำขอได้ในเวลาตามคลิป

## ลำดับ 60 วินาที

| เวลา | ความต้องการของคน | ข้อความที่เห็นพิมพ์ | การเปลี่ยนที่เห็นและการใช้ |
| --- | --- | --- | --- |
| 0–5s | เครื่องมือควรพอดีกับคนและงาน | เกริ่นสั้น: เครื่องมือที่ดี ต้องพอดีกับคุณ | เก้าอี้ ปากกา ค้อนแยกชิ้นอยู่ร่วมกัน เติมเบาะ/รอยเขียน/ตะปู ไม่มี morph; เชื่อมเข้าโต๊ะของคนขาย |
| 5–14s | อยากเริ่มจดขาย | ช่วยทำโต๊ะจดขายกาแฟกับเค้ก | พิมพ์ → ส่ง → ร่าง/ตรวจ/ใช้ → ตาราง 2 รายการและยอด225ปรากฏ; ยังไม่มีปุ่มขายหรือกราฟ |
| 14–28s | ลูกค้าเยอะ กรอกไม่ทัน | เพิ่มปุ่มขาย กดครั้งเดียวเพิ่มจำนวน | ปุ่มกาแฟ+1/เค้ก+1งอกข้างตารางหลังตรวจ/ใช้; กดกาแฟหนึ่งครั้ง จำนวน3→4 ยอด225→250 ให้เห็นว่าเครื่องมือใหม่ช่วยจุดที่ติด |
| 28–38s | อยากรู้ว่าอะไรขายดี | เพิ่มกราฟยอดขายแยกตามสินค้า | พิมพ์ → ส่ง → ตรวจ/ใช้ → กราฟงอกจากข้อมูลเดิม กาแฟ100/เค้ก150 ตารางและปุ่มยังอยู่ |
| 38–46s | จะลองโปรช่วงบ่าย | เพิ่มส่วนลด 10% | ขอวิธีคิดเพิ่ม → ตรวจ/ใช้ → การ์ดกฎและยอดสุทธิ225 โดยยอดก่อนลด250ไม่เปลี่ยน |
| 46–55s | อยากลองโปรแรงขึ้น | เปลี่ยนกฎนี้เป็น 20% | เลือกการ์ดส่วนลดก่อนพิมพ์ → ร่าง20%แยกจาก10%ที่ใช้อยู่ → ตรวจ/ใช้ → ยอดสุทธิ200 ข้อมูลและกราฟยังเดิม |
| 55–58s | ได้โต๊ะที่เข้ากับวิธีขายของตัวเอง | เริ่มจากจดขาย ค่อย ๆ ปรับจนพอดีมือ | พักให้เห็นโต๊ะเดียวครบ: ตาราง ปุ่ม กราฟ กฎ ผลลัพธ์; ย้อนให้จำว่าทุกชิ้นมีเหตุจากคำขอ |
| 58–60s | พร้อมเริ่มเรื่องของตัวเอง | tabletop. · เครื่องมือที่ค่อย ๆ ปรับให้เข้ากับคุณ | โลโก้เดิมและ URL พักอ่าน ไม่เปิดฉากใหม่ |

เวลาย่อยจริงอยู่ใน [motion README](motion/README.md) ให้เวลาคนอ่านคำขอที่พิมพ์ครบอย่างน้อย0.6–1s และดูผลหลังใช้ประมาณ1.5s ถ้าแน่นให้ตัดคำและกราฟิกเสริม ห้ามตัดเหตุจากคนหรือทำให้ส่งคำขอกับผลเกิดพร้อมกัน

## สิ่งที่ต้องเห็น ไม่ใช่แค่ข้อความบอก

1. มีช่องพิมพ์และ cursor; ข้อความค่อย ๆ ปรากฏเป็น grapheme ภาษาไทย ไม่ตัดสระ/วรรณยุกต์ออกจากตัวอักษร
2. คำขอแต่ละช่วงเปลี่ยนจริง มี Send และสถานะร่าง/ตรวจ/ใช้ แยกจากการพิมพ์
3. การ์ดใหม่ยังไม่เกิดก่อนส่ง และผลที่ใช้อยู่ไม่เปลี่ยนก่อน Apply
4. ปุ่มขายที่เพิ่งขอต้องถูกกด แล้วจำนวนและยอดเปลี่ยนจากข้อมูลเดียวกัน นี่คือจังหวะที่คนเห็นว่าได้เครื่องมือไว้ใช้ ไม่ใช่แค่ภาพหน้าจอเพิ่ม
5. ตารางและปุ่มเดิมยังอยู่เมื่อขอกราฟ ต่อด้วยกฎส่วนลด กรอบ/ตำแหน่งคงที่เท่าที่พื้นที่ภาพรองรับ
6. ตอนแก้20%ต้องชี้กฎที่เลือก พร้อมคง10%ที่ทำงานอยู่จนกดใช้; หลังใช้gross250ยังอยู่ แต่net225→200
7. ข้อความบอกปัญหาของคนสั้นและมาก่อนคำขอ เช่น “ลูกค้าเยอะ กรอกไม่ทัน” ห้ามแทนด้วยชื่อfeature เช่น “Action system”

## ตัวเลขชุดเดียว

| จังหวะ | กาแฟ | เค้ก | ก่อนลด | กฎที่ใช้ | สุทธิ |
| --- | --- | --- | --- | --- | --- |
| เริ่ม | 3×25=75 | 3×50=150 | 225 | ไม่มี | ไม่แสดง |
| กดกาแฟ+1 | 4×25=100 | 3×50=150 | 250 | ไม่มี | ไม่แสดง |
| เพิ่ม10%แล้วใช้ | เดิม | เดิม | 250 | 10% | 225 |
| กำลังเสนอ20% | เดิม | เดิม | 250 | ยัง10% | 225; preview200แยกชัด |
| ตรวจแล้วใช้20% | เดิม | เดิม | 250 | 20% | 200 |

หน้าเว็บให้กดขายได้หลายครั้ง จึงคำนวณจากจำนวนจริงในหน้า ตัวเลข250/225/200เป็นเส้นเรื่องมาตรฐานเมื่อกดกาแฟหนึ่งครั้ง ไม่บังคับทับข้อมูลคนทดลอง

## บทพากย์ไทยที่เตรียมไว้

> เครื่องมือที่ดี ต้องพอดีกับคุณ แล้วซอฟต์แวร์ล่ะ? เริ่มจากเรื่องเล็ก ๆ อยากมีโต๊ะจดขายกาแฟกับเค้ก พิมพ์บอก ตรวจ แล้วเริ่มใช้ พอลูกค้าเยอะ กรอกไม่ทัน ก็ขอปุ่มขาย กดครั้งเดียว รายการกับยอดก็เปลี่ยน อยากรู้ว่าอะไรขายดี ขอกราฟเพิ่มจากข้อมูลเดิม ช่วงบ่ายอยากลองโปร ก็เพิ่มส่วนลดสิบเปอร์เซ็นต์ ลองแล้วอยากเปลี่ยนเป็นยี่สิบ เลือกกฎนั้น ขอแก้ ตรวจ แล้วใช้ต่อ ตารางเดิมยังอยู่ เครื่องมือค่อย ๆ เข้ากับวิธีทำงานของคุณ Tabletop

ยังไม่บันทึกเสียงและยังไม่จับเวลาการอ่านจริง คลิปส่งรอบนี้เงียบ ต้องเข้าใจเรื่องได้จากภาพและข้อความโดยไม่พึ่งเสียง

## English voiceover draft

> Good tools fit the person using them. What about software? Start small: a table for coffee and cake sales. Type what you need. Review it and put it to work. The shop gets busy. Entering every sale is too slow. Ask for a sales button. One tap updates the quantity and total. Want to know what sells? Add a chart from the same data. Try an afternoon offer with ten percent off. Want to make it twenty? Select that rule, request the change, review it, and apply. Your work stays. Your tools keep fitting you better. Tabletop.

## Production prompt

```text
Revise the existing Tabletop Remotion film to 60 seconds. Code every frame with React, SVG and CSS. No AI-generated video or images. Use the original repository logo geometry, lowercase wordmark, loader timing and existing opening objects. No morphing.

Tell a person-led story, not a feature carousel. A fictional coffee seller starts with a simple sales table, discovers friction while using it, and types follow-up requests that change the SAME workspace. For every beat show need → typing with a visible caret → Send → draft → review/apply → use/result. Keep completed request text visible long enough to read. Segment Thai by grapheme. A new tool cannot appear before its request. A proposed rule cannot change applied results before Apply.

Follow the exact requests and arithmetic in this brief. The major adaptation is quick-sale buttons requested because the seller cannot keep typing during a rush. Show the new Coffee+1 button being clicked once, changing quantity3→4 and gross225→250. Then request a per-item sales chart. Next request a10%discount (net225), then select that rule and type a request for20% (net200). Gross250 and prior rows/chart/buttons remain. Render source-derived values consistently; no arbitrary rolling numbers.

Keep a readable composer or conversation rail throughout the working sequence. The expanded composer guides attention to what the person asks, then settles as the precise board object changes. Each scene has one causal action. Preserve existing card positions; new objects grow into available space. Keep text legible at720p. Use restrained transitions and pauses, not simultaneous motion everywhere.

1280x720,30fps,1800frames,H.264,silent. Persistent small disclosure: ภาพอธิบาย · ข้อมูลตัวอย่าง. No productAPI, paidvoice, or model call. Deliver edited source,MP4,poster,eightMP4-derivedstills and an explicit timeline. Inspect request/result pairs and the coffee-button click, not only finalboards. FinalwebsiteandrootREADMEremainunchanged.
```

## ตรวจความเข้าใจจากภาพ

เมื่อหยุดหลังแต่ละช่วง ผู้ตรวจต้องตอบจากเฟรมได้ว่า คนติดอะไร พิมพ์อะไร สิ่งใดเปลี่ยน และใช้แล้วได้อะไร ตรวจคู่เฟรมคำขอ/ผลอย่างน้อย5คู่ รวมเฟรมก่อนและหลังกดกาแฟ และก่อน/หลังApply20% การตรวจนี้เป็นการตรวจโดยทีมผู้ทำ ไม่แทนการทดสอบคนใหม่

## Proof clip แยกจาก film

เส้นเรื่องนี้ต้องบันทึกจากผลิตภัณฑ์จริงต่างหากก่อนอ้างเป็น runtime proof: ห้องใหม่ → promptจริง → ตรวจ/ใช้ → ขอaction → กดและอ่านผลกลับ → ขอchart → ขอdiscount → เลือกกฎแก้ → reloadตรวจผล ไม่มีการเติมผลสำเร็จด้วยmotion หากruntimeทำไม่ได้ต้องรายงาน ไม่ใช้conceptแทนผลจริง
