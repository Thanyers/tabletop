<!-- Hallmark · pre-emit critique: P5 H4 E4 S5 R4 V4. These scores assess this audit document, not product usability. -->
# Tabletop UX audit — 19 ตุลาคม 2026

**ข้อสรุป:** ความรู้สึกว่าแอปเครียด ใช้ยาก และข้อความเยอะ มีสาเหตุจากโครงสร้างจริง ผู้ใช้ต้องจัดการโหมด กล่อง เครื่องมือ และขั้นตอนภายในระบบก่อนทำงานที่ต้องการ การเพิ่มภาพหรือปรับสีอย่างเดียวจึงแก้ไม่พอ

**ทิศทางที่แนะนำ:** คง Canvas เป็นพื้นที่หลัก มีช่องพิมพ์เบา ๆ ที่เห็นเสมอ ลากหัวกล่องได้ทันที ทำรายการข้างข้อมูล และเปิดรายละเอียดกฎเมื่อจำเป็น ทุกอย่างยังเปิดผ่าน container บน Canvas ได้ ผู้เล่นยังเลือกและยืนยันการเล่นเอง

รอบนี้ตรวจและบันทึกเท่านั้น ยังไม่ได้แก้ UI, commit, merge หรือ deploy

## ห้าจุดที่ควรแก้ก่อน

1. เลิกสวิตช์ **Use / Arrange**: ลากหัวกล่องเพื่อย้าย ลากพื้นเพื่อเลื่อน กดเนื้อหาเพื่อใช้
2. ลดทางเลือกซ้ำ: ไม่ต้องมี Open ทุกกล่อง + รายชื่อกล่องด้านล่าง + Flow + Focus หลายจุดพร้อมกัน
3. วางช่องพิมพ์ไว้ใกล้งานเสมอ แทนการให้หา Ask AI หรือเลื่อนผ่านคำอธิบายและเครื่องมือก่อน
4. ให้เลือก ticket แล้วทำรายการต่อได้ตรงนั้น แทนการเลือก ticket ซ้ำในห้าฟอร์ม
5. ลดข้อความของระบบ กรอบซ้อน และศัพท์เทคนิค ให้ข้อมูลของผู้ใช้กับสิ่งที่จะทำต่อเด่นที่สุด

## ขอบเขตและหลักฐาน

ตรวจจาก source `07f93cf50cbf2492de1bd12d4386e676dd1e6cad` บน `main`; production ที่ตรวจใช้ source `6216eb3a601f0bcadc1ff10d49c9116991b83069` ซึ่งเป็นรุ่นแอปเดียวกันก่อน commit เอกสาร

| เส้นทาง | สิ่งที่ตรวจ | ระดับหลักฐาน |
| --- | --- | --- |
| Production / Encounter เจ้าของโต๊ะ | เปิดกล่อง, Use/Arrange, ลากหัวกล่อง, เลื่อน Canvas, เมนูโต๊ะ, ขนาดปุ่ม | เล่น UI จริงและอ่าน DOM; ไม่กดคำสั่งเกม |
| Production / Auto demo ฟิสิกส์ | ภาพรวม, container, แถบเล่น/รับช่วงต่อ, กราฟ/ฉาก/ไฟล์ | ตรวจ UI ของเดโมที่เล่นจบและรับช่วงต่อไว้แล้ว; ไม่เรียก AI |
| Staging / River Race สมาชิก | สิทธิ์ที่แสดง, แชท, ตาปัจจุบัน, หน้าจอ 390 × 844 | ตรวจ UI/DOM จริง; ไม่ส่งข้อความหรือทำรายการ |
| Local / Office Helpdesk เจ้าของ | Chat, Change rules, ไฟล์เดิม, Tickets, ฟอร์มทั้งห้า | UI จริงจากผลทดสอบเดิม ข้อมูลสมมติ; ไม่แนบไฟล์ใหม่หรือแก้ ticket |
| เริ่มโต๊ะ, เชิญคน, กลับมาเล่นต่อ, Invoice, lifecycle, error states | โครงสร้างและเงื่อนไขการแสดงผล | อ่าน source; ไม่ได้ทำทุกเส้นทางซ้ำใน audit นี้ |

ภาพและตัวเลขอยู่ใน `test-results/ux-audit-2026-10-19/` ซึ่งถูก ignore โดย Git ภาพหน้าบัญชีจริงเก็บเฉพาะในเครื่อง เอกสารนี้ไม่ใส่ชื่อ/อีเมลบัญชีจริงหรือ credential

การตรวจนี้เป็น UX review พร้อมทดลอง interaction โดยผู้ตรวจ ไม่ใช่ผลทดสอบผู้ใช้ใหม่ ไม่ได้วัดเวลาเทียบ Claude Code/ChatGPT และไม่ใช่การรับรอง security หรือ accessibility ทั้งระบบ

### ข้อเท็จจริงที่วัดได้

- Production Encounter ขนาด 1652 × 853 มี control 33 รายการที่กรอบตัดกับ viewport ตัวเลขนี้รวมรายการที่อาจถูกกล่องอื่นบัง จึงไม่ใช่จำนวนปุ่มที่กดได้สะดวกจริงทั้งหมด
- Canvas เริ่มที่ scale ประมาณ 0.794: ชื่อกล่อง CSS 14px เหลือขนาดภาพประมาณ 11.1px; ปุ่ม Open ประมาณ 41 × 28.6px, Use/Arrange สูง 27px, zoom 26 × 26px
- ลากหัวกล่อง 40 × 20px ใน Use: **กล่องไม่ขยับ แต่ Canvas เลื่อน**; ใน Arrange: กล่องขยับและ Canvas อยู่ที่เดิม ยืนยันความขัดแย้งที่ผู้ใช้รู้สึกได้จริง
- Staging ที่ 390 × 844 ไม่มี root horizontal overflow ในภาพที่ตรวจ แต่ช่องพิมพ์เริ่มที่ y ≈ 1272px ต่ำกว่าขอบหน้าจอแรก และยังมีพื้นที่เลื่อนซ้อนใน assistant
- Local Helpdesk ที่ 1549 × 800 ช่องพิมพ์เริ่ม y ≈ 677px: แค่โหมดว่างก็ต้องผ่านหัวข้อ ปุ่มลัด สถานะตา และกล่องประวัติก่อน ยังไม่รวม consent/ปุ่มส่งด้านล่าง

## Findings — major

Severity ต่อไปนี้ใช้จัดลำดับงาน UX ไม่ใช่ระดับช่องโหว่ระบบ ชื่อ Tell บางส่วนใช้ Hallmark เช่น Card-in-card / Eyebrow on every section; ส่วน Mode error และภาระในการเลือกเป็นคำอธิบาย interaction เพิ่มเติม

### M01 — ต้องจำโหมดก่อนลาก

**Tell:** Mode error · **หลักฐาน:** ทดลองลากจริงตามข้างต้น; [CanvasWorkspace.tsx:593](../src/tabletop/ui/CanvasWorkspace.tsx#L593), [TabletopApp.tsx:693](../src/tabletop/TabletopApp.tsx#L693)

**ผล:** ท่าทางเดียวกันให้ผลต่างกัน คนต้องคิดถึงเครื่องมือแทนสิ่งที่อยากทำ เดโมยังเริ่มด้วย `arrange` แต่โต๊ะจริงเริ่ม `use` ทำให้สิ่งที่เรียนมาไม่ตรงกัน

**แก้:** ย้ายกล่องด้วยหัวกล่อง/handle ได้ตลอด เลื่อนด้วยพื้นว่าง เนื้อหาภายในยังคลิก/เลือกข้อความได้ พร้อมวิธีย้ายโดยไม่ต้องลาก

### M02 — ย่อทั้งโต๊ะจนตัวหนังสือและปุ่มเล็ก

**Tell:** Density through scaling · **หลักฐาน:** DOM measurement; [canvas-visual-flow.css:34](../src/tabletop/ui/canvas-visual-flow.css#L34), [tabletop.css:91](../src/tabletop/ui/tabletop.css#L91)

**ผล:** มีพื้นที่ว่าง แต่สิ่งที่ต้องอ่านกลับเล็ก ปุ่มควบคุมหลายจุดสูงเพียง 25–29px การ zoom ไม่ควรเป็นเงื่อนไขก่อนอ่านงานหลัก

**แก้:** เปิดงานหลักในขนาดอ่านได้ก่อน ลดเนื้อหาใน overview และตั้งเป้าปุ่มงานหลักสูง 40–44px; ไม่ใช้ fit-all เพื่อบีบทุกฟอร์มให้เล็กลง

### M03 — เปิดสิ่งเดียวกันได้หลายทางจนเลือกไม่ถูก

**Tell:** Duplicate navigation · **หลักฐาน:** [CanvasWorkspace.tsx:637](../src/tabletop/ui/CanvasWorkspace.tsx#L637), [TableAssistant.tsx:588](../src/tabletop/ui/TableAssistant.tsx#L588), [TabletopApp.tsx:695](../src/tabletop/TabletopApp.tsx#L695)

**ผล:** Open บนกล่อง, dock รายชื่อ, Flow, Focus, Canvas/Focus และทางลัดใน assistant แข่งกัน โดยเฉพาะเมื่อยังไม่รู้ว่ากล่องไหนสำคัญ

**แก้:** ให้ตัวกล่องเป็นทางหลัก; รวมค้นหา/รายการกล่อง/จัดมุมมองไว้ในเมนูเดียว และเปิดเส้นเชื่อมเมื่อเลือกดูความสัมพันธ์

### M04 — ช่องพิมพ์ไม่ใช่จุดเริ่มที่หาเจอง่าย

**Tell:** Buried primary action · **หลักฐาน:** ภาพ Helpdesk และ mobile; [TableAssistant.tsx:477](../src/tabletop/ui/TableAssistant.tsx#L477), [TabletopApp.tsx:696](../src/tabletop/TabletopApp.tsx#L696)

**ผล:** Generic table มี rail เต็มชุด ส่วนโต๊ะเฉพาะทางมี Ask AI; ความสามารถเริ่มคุยไม่สม่ำเสมอ และคำว่า Ask AI ให้ความรู้สึกเป็นเครื่องมือแยกจากโต๊ะ

**แก้:** ใช้ช่องพิมพ์กระชับบนพื้นที่โต๊ะอย่างสม่ำเสมอ เช่น “อยากทำอะไรกับโต๊ะนี้?” แนบไฟล์จากตรงนั้นได้ และให้คำตอบชี้ไปที่ container ที่เกี่ยวข้อง ประวัติขยายอ่านได้เมื่อขอ

### M05 — คำอธิบายขอบเขตและขั้นเตรียมส่งแย่งพื้นที่งาน

**Tell:** Repeated explanatory copy · **หลักฐาน:** [TableAssistant.tsx:453](../src/tabletop/ui/TableAssistant.tsx#L453), [TableAssistant.tsx:480](../src/tabletop/ui/TableAssistant.tsx#L480), [TableAssistant.tsx:490](../src/tabletop/ui/TableAssistant.tsx#L490)

**ผล:** มีทั้งคำอธิบายแชท สถานะตา ป้ายประวัติ ความเป็นส่วนตัว consent และข้อความว่า AI ไม่ทำรายการแทน ขณะเดียวกันปุ่มส่งปิดได้จากหลายสาเหตุ

**แก้:** แสดงสรุปบริบท/การส่งข้อมูลสั้นหนึ่งจุด พร้อมรายละเอียดและ consent ที่ยังชัดเจน; อธิบายเหตุที่ส่งไม่ได้ตรงช่องพิมพ์ และย้ำการยืนยันเฉพาะตอนมีข้อเสนอ action

### M06 — งานหนึ่งชิ้นกระจายอยู่คนละกล่องกับคำสั่ง

**Tell:** Form-first interaction · **หลักฐาน:** Helpdesk มีห้าฟอร์มและเลือก ticket ซ้ำ; [TableCanvasObjects.tsx:177](../src/tabletop/ui/TableCanvasObjects.tsx#L177), [TableCanvasObjects.tsx:218](../src/tabletop/ui/TableCanvasObjects.tsx#L218), [TableCanvasObjects.tsx:241](../src/tabletop/ui/TableCanvasObjects.tsx#L241)

**ผล:** ดู ticket แล้วต้องไปกล่อง Actions เลือก ticket ใหม่ อ่าน Requirements และหาคำสั่งที่ใช้ได้ ทุกคำสั่งมีน้ำหนักใกล้กันแม้ไม่เข้ากับสถานะปัจจุบัน

**แก้:** เลือกแถว/ชิ้นงานแล้วแสดงคำสั่งตามสถานะและสิทธิ์ พร้อมค่าจากรายการนั้น เหตุผลที่ทำไม่ได้เปิดดูใกล้ปุ่ม; server ยังตรวจทุกครั้ง

### M07 — เปิดกล่องแล้วกล้องขยับตามทุกครั้ง

**Tell:** Unrequested camera movement · **หลักฐาน:** [CanvasWorkspace.tsx:350](../src/tabletop/ui/CanvasWorkspace.tsx#L350), [CanvasWorkspace.tsx:358](../src/tabletop/ui/CanvasWorkspace.tsx#L358)

**ผล:** Open/Close ผูกกับ fitView ทำให้ตำแหน่งที่เพิ่งจำหรือจัดไว้เปลี่ยน การเปิดอ่านรายละเอียดกับการสั่งพาไปหาวัตถุควรแยกกัน

**แก้:** เปิดรายละเอียดโดยรักษากล้อง; เลื่อนเท่าที่จำเป็นเมื่อวัตถุอยู่นอกจอ และให้ “ไปที่กล่อง” เป็นคำสั่งชัดเจน พร้อมกลับมุมมองเดิม

### M08 — ต้องจำแนกชนิดโต๊ะก่อนบอกความต้องการ

**Tell:** Implementation vocabulary before intent · **หลักฐาน source:** [TabletopApp.tsx:753](../src/tabletop/TabletopApp.tsx#L753), [TableAssistant.tsx:546](../src/tabletop/ui/TableAssistant.tsx#L546)

**ผล:** เริ่มด้วย Invoice/Physics/Encounter/Shared data table และเจ้าของโต๊ะใหม่เข้า Change rules ก่อน คนที่มีไฟล์กับโจทย์ทั่วไปต้องเดาว่าอยู่หมวดไหน

**แก้:** เริ่มจากไฟล์หรือคำบอกงานใน Canvas ว่าง ให้ตัวอย่างเป็นตัวช่วยเลือก และเปิด Rules container เมื่อมีร่างให้ตรวจ ไม่บังคับเลือกศัพท์ภายในก่อนเริ่ม

### M09 — ขั้นตอนตรวจความถูกต้องถูกยกมาเป็นงานของผู้เล่น

**Tell:** Process exposed as product · **หลักฐาน source:** [WorkbenchShared.tsx:47](../src/tabletop/ui/WorkbenchShared.tsx#L47), [WorkbenchShared.tsx:69](../src/tabletop/ui/WorkbenchShared.tsx#L69)

**ผล:** Draft/Simulate/Validate/Approve/Activate, hash และ revision ทำให้แก้กติกาเหมือนจัดการ release ซอฟต์แวร์

**แก้:** ใน Rules container ให้เห็น “เปลี่ยนอะไร / กระทบอะไร / ผลลองเป็นอย่างไร” แล้วใช้คำสั่งตามเจตนา เช่น “ตรวจการเปลี่ยนแปลง” และ “ใช้กฎนี้” ลำดับการตรวจ สิทธิ์ การอนุมัติ และประวัติในระบบต้องคงอยู่

### M10 — หน้าจอแคบย่อหน้าคอมพิวเตอร์ลงมา

**Tell:** Desktop layout compressed to mobile · **หลักฐาน:** ภาพ 390 × 844 และตำแหน่งช่องพิมพ์; [tabletop.css:1260](../src/tabletop/ui/tabletop.css#L1260), [tabletop.css:1292](../src/tabletop/ui/tabletop.css#L1292)

**ผล:** กล่องถูกตัด ต้องเลื่อนแนวนอนใน Flow/dock และเลื่อนซ้อนใน assistant; อ่านสถานะกับพิมพ์สั่งงานไม่ได้ในมุมมองเดียว

**แก้:** บนมือถือให้เห็นกล่องที่กำลังใช้เต็มพื้นที่ พร้อมช่องพิมพ์ติดขอบล่างและรายการกล่องแบบย่อ; มีพื้นที่เลื่อนหลักเดียว โดยยังรักษาตำแหน่งใน Canvas

### M11 — เดโมมีเครื่องมือกำกับมากกว่าสิ่งที่กำลังสาธิต

**Tell:** Competing controls · **หลักฐาน UI และ [InteractiveDemo.tsx:152](../src/tabletop/demo/InteractiveDemo.tsx#L152), [InteractiveDemo.tsx:162](../src/tabletop/demo/InteractiveDemo.tsx#L162)

**ผล:** Play, Next, Take over, Reset, เปลี่ยนโจทย์/คน, ถาดไฟล์, เพิ่ม container, Flow, dock และ export อยู่พร้อมกัน ภาพรถ/แผนภาพช่วยแล้ว แต่ถูกล้อมด้วยเครื่องมือ

**แก้:** ช่วงเล่นอัตโนมัติเด่นแค่ “พัก” / “ลองเอง” กับสิ่งที่กำลังเปลี่ยน; หลังรับช่วงต่อซ่อน transport ที่ใช้ไม่ได้ ย้ายตัวเลือกผู้สาธิต ขั้นถัดไป และ export ไปเมนูรอง เดโมยังซื่อสัตย์ว่าไม่เรียก AI จริง

### M12 — ทุก component ถูกตกแต่งเหมือนแผงตั้งค่าที่สำคัญเท่ากัน

**Tell:** Card-in-card; Eyebrow on every section · **หลักฐานภาพ:** Helpdesk chat/rules/actions และ public demo; [tabletop.css:1250](../src/tabletop/ui/tabletop.css#L1250), [tabletop.css:1292](../src/tabletop/ui/tabletop.css#L1292), [canvas-visual-flow.css:35](../src/tabletop/ui/canvas-visual-flow.css#L35)

**ผล:** กรอบ/พื้นอ่อน/ไอคอน/ป้ายตัวพิมพ์ใหญ่ซ้ำหลายชั้น ข้อมูลจริงและงานหลักเด่นไม่พอ โทนสีอ่อนอย่างเดียวไม่ได้ทำให้ผ่อนคลาย

**แก้:** หนึ่ง container มีหัวข้อชัดหนึ่งชุดและกรอบหลักชั้นเดียว ตัดป้ายเทคนิคที่ซ้ำชื่อ ใช้ accent เฉพาะสิ่งที่กำลังทำ และให้รูป/ข้อมูล/ผลการเล่นกินพื้นที่มากกว่า chrome

## Findings — minor

### m01 — ภาษาและชื่อเรียกไม่สม่ำเสมอ

**Tell:** Inconsistent vocabulary · **Where:** [TableAssistant.tsx:566](../src/tabletop/ui/TableAssistant.tsx#L566), [TabletopApp.tsx:694](../src/tabletop/TabletopApp.tsx#L694)

ไทย/อังกฤษ/ศัพท์ภายในสลับกัน เช่น container, active rules, seat, data r15, No turn is set แม้เป็น Helpdesk ที่ไม่ใช้ตา

**แก้:** เลือกภาษาของ UI ให้สม่ำเสมอ ใช้ชื่อจากงานจริง และไม่แสดงสถานะตาในโต๊ะที่ไม่มี turn order

### m02 — การกลับมาทำต่อยังสื่อความเป็นโปรเจกต์ไม่ชัด

**Tell:** Hidden continuity · **Where:** [TabletopApp.tsx:675](../src/tabletop/TabletopApp.tsx#L675), [TabletopApp.tsx:678](../src/tabletop/TabletopApp.tsx#L678)

กลับโต๊ะเดิมได้ แต่ซ่อนในเมนูชื่อโต๊ะ ขณะที่ Connected กับ revision ไม่ได้บอกว่างานล่าสุดถูกเก็บแล้วหรือไม่

**แก้:** ใช้ชื่อโปรเจกต์/โต๊ะเด่น มี “โต๊ะล่าสุด” กับสถานะการบันทึกที่อิง server acknowledgement จริง คงชื่อและสมาชิกเดิมเมื่อกลับมา ห้ามใช้ Connected แทนคำยืนยันว่าบันทึกสำเร็จ

### m03 — diagram อธิบายระบบมากกว่าช่วยตัดสินใจ

**Tell:** Diagram without task hierarchy · **Where:** [CanvasWorkspace.tsx:573](../src/tabletop/ui/CanvasWorkspace.tsx#L573), [canvas-visual-flow.css:117](../src/tabletop/ui/canvas-visual-flow.css#L117)

เส้น feeds / Active rule revision มีประโยชน์ตอนตรวจ lineage แต่ Helpdesk ต้องการเห็นว่างานใดติดอนุมัติและใครทำต่อมากกว่า

**แก้:** ใช้ความสัมพันธ์เฉพาะสิ่งที่เลือก; เสริมภาพสถานะงานหรือผลการเปลี่ยนแปลงที่คำนวณจากข้อมูลจริง การเคลื่อนไหวต้องสื่อเหตุการณ์จริงและรองรับ reduced motion

## ลำดับงานที่แนะนำ

| รอบ | เป้าหมาย | ถือว่าจบเมื่อ |
| --- | --- | --- |
| A — กดและลากได้ตรงใจ | M01, M02, M07 | ย้ายหัวกล่องแล้วกดเนื้อหาต่อได้โดยไม่เปลี่ยนโหมด; กล้องไม่กระโดด; อ่านงานหลักได้โดยไม่ zoom ก่อน |
| B — เริ่มและทำงานได้ทันที | M04, M06, M08, M10 | เปิดโต๊ะ → แนบไฟล์/พิมพ์ → ตรวจร่าง → เลือกรายการ → ทำ action ได้; มือถือไม่ต้องหา composer |
| C — ลดความเครียดของหน้า | M03, M05, M09, M12 | เหลือจุดเริ่มและงานหลักชัดเจน; รายละเอียดกฎ/การส่งข้อมูลยังหาได้; ไม่ซ้ำสถานะ/คำเตือนหลายชั้น |
| D — เดโมและความต่อเนื่อง | M11, m01–m03 | ดูเดโม → รับช่วงต่อ → ชวนคน → ปิด/กลับมาโต๊ะเดิม เข้าใจได้จากหน้าเดียว |

เป้าสำหรับตรวจรอบหน้า: ลดข้อความแนะนำของระบบบนหน้าทำงานแรกอย่างน้อยครึ่งหนึ่งเมื่อเทียบ viewport และ state เดิม โดยไม่นับเอกสาร/ข้อมูลผู้ใช้; ปุ่มหลัก 40–44px; ตัวเนื้อหางานหลักราว 14–16px ที่ขนาดใช้งานจริง ตัวเลขเหล่านี้เป็นเป้าหมายออกแบบ ยังไม่ได้ทำหรือทดสอบสำเร็จ

### สิ่งที่ต้องรักษาไว้ระหว่างแก้

- ไฟล์ กฎ ร่าง รายการ ผลลัพธ์ ประวัติ และเชิญคน เปิดผ่าน container ใน Canvas ได้ ไม่แยกการทำงานหลักไปอีกเว็บหรือเหลือแชทอย่างเดียว
- คนเลือกและยืนยันการเล่นเอง AI อธิบายหรือเตรียม action ให้ตรวจได้ ไม่เล่นแทนต่อเนื่อง
- การย้าย/ย่อ/เปิดกล่องไม่เปลี่ยนข้อมูลธุรกิจหรือข้อมูลของผู้เล่นคนอื่น
- สิทธิ์เจ้าของ/สมาชิก, turn, rule validation, approve/activate, stale proposal checks และความเป็นส่วนตัวของไฟล์/แชทยังทำงานครบ
- ไม่สื่อว่าแชททั้งหมดถูกส่งเป็น context: ปัจจุบัน source ระบุส่งได้สูงสุดหก exchange ล่าสุดภายใน 16 KiB; ประวัติที่เก็บไว้กับ context ของคำขอเป็นคนละเรื่อง

### ตรวจรับหลังมีการแก้จริง

ให้คนที่ไม่รู้โครงสร้างระบบลองสามโจทย์: Helpdesk, เอกสาร/ข้อมูลทั่วไปที่สร้างใหม่ และเกมร่วมกัน โดยไม่บอกชื่อปุ่มล่วงหน้า ทดสอบไฟล์ใหม่ → AI จริง → ตรวจร่าง → ใช้กฎ → เล่นด้วยมือ → สองบัญชีเห็นผลตรงกัน → ปิดและกลับมาต่อ ตรวจมือถือ 390px, keyboard, touch และวิธีย้ายวัตถุโดยไม่ลากด้วย รอบนี้ยังไม่ได้ทำการตรวจรับรุ่นแก้ UX ดังกล่าว

## วิธีตรวจและข้อจำกัด

- **OBSERVED:** ภาพและการกด/ลากที่ระบุ, DOM geometry, ขนาด viewport จริง; temporary viewport override ถูก reset แล้ว
- **SOURCE REVIEWED:** entry, invite, resume UI, lifecycle, conditional empty/error/disabled states; ไม่อ้างว่ากด error ทุกชนิดจริง
- **STATIC GATE:** 2 PASS / 2 FAIL จากไฟล์ตัวอย่างสามไฟล์: theme refs และ native-select ผ่าน; hardcoded styling และกฎ lint เรื่อง em dash ไม่ผ่าน ข้อหลังเป็นความเห็นด้านรูปแบบของเครื่องมือ ไม่ใช่หลักฐานว่า UX เสียหรือแอปมี emoji ปัญหา
- **SKIPPED:** render gate แบบ headless, axe, contrast audit, full keyboard/screen-reader/touch suite, performance profiling, external novice-user study; ไม่มีการรับรอง WCAG จากผลรอบนี้
- การตรวจ UI ไม่ส่ง AI request, ไม่สร้าง/แก้ห้องหรือ ticket, ไม่แก้ schema/credential และไม่ deploy มีเพียงการเปิด/ปิดกล่อง เปลี่ยนโหมด และทดลอง layout ในเบราว์เซอร์

เกณฑ์อ้างอิง: ลดสิ่งที่แข่งกับงานและใช้ภาษาของผู้ใช้ตาม [NN/g usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/); ปุ่ม 25–29px ไม่ได้แปลว่าผิด WCAG อัตโนมัติ เพราะ [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) มีเกณฑ์ขนาด/ระยะห่างและข้อยกเว้น ส่วน [WCAG 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements) กำหนดทางเลือกแบบ pointer ที่ไม่ต้องลาก ซึ่งควรออกแบบและทดสอบเพิ่มเติม ไม่อ้างว่ามีหรือผ่านแล้ว

**0 critical · 12 major · 3 minor**
