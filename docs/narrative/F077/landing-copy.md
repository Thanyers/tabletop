# หน้าเว็บ — copy draft TH / EN

ใช้กับโครง `PublicWelcome` เดิมตาม [แผน](README.md) ข้อความในตารางคือ copy สำหรับผู้ชม; หมายเหตุการจัดวางไม่ขึ้นหน้าเว็บ

## Header และ Hero

| ส่วน | ไทย | English |
| --- | --- | --- |
| Header note | พื้นที่สำหรับงาน การเรียนรู้ และการเล่น | A place for work, learning, and play |
| Eyebrow | TABLETOP · เริ่มจากเรื่องของคุณ | TABLETOP · START WITH YOUR WORK |
| H1 | เริ่มจากงาน ให้เครื่องมือโตไปด้วยกัน | Start with your work. Let your tools grow. |
| Promise | บอกโจทย์ แล้วให้ AI ช่วยร่างตาราง แบบฟอร์ม ปุ่ม กราฟ และวิธีคำนวณบนโต๊ะเดียวกัน คุณตรวจและเปิดใช้ แล้วปรับต่อได้เมื่องานเปลี่ยน | Describe what you want to do. AI helps draft tables, forms, buttons, charts, and calculations on one canvas. Review them, put them to use, and adapt them as your work changes. |
| Support | เริ่มจากข้อความได้เลย เพิ่มข้อมูลเมื่อพร้อม | Start with words. Add data when you are ready. |
| Primary CTA | เริ่มโต๊ะของคุณ | Start your table |
| Secondary CTA | ดูเรื่องราวใน 60 วินาที | Meet Tabletop in 60 seconds |
| Video caption | ภาพเคลื่อนไหวอธิบายแนวคิด · ข้อมูลตัวอย่าง | Concept animation · illustrative data |
| Video alt / poster | เก้าอี้ ปากกา และค้อนวางเพิ่มทีละชิ้น ก่อนตัดเข้าสู่โต๊ะยอดขายที่ค่อย ๆ เพิ่มและปรับเครื่องมือ | A chair, pen, and hammer arrive one by one, followed by a sales canvas that gains tools and adapts to data and rules. |

Hero รอบ 2 ใช้บอร์ดตัวอย่างที่กดเพิ่ม/แก้ได้ และวาง film เป็น section ถัดไป ไม่จำกัดเป็น poster ข้างข้อความ จัดH1เป็น2–3บรรทัดตามพื้นที่ ไม่บังคับ line break ในจอแคบ Bodyจำกัดความกว้างอ่านง่าย ปุ่มหลักใช้ `primaryHref` เดิม ปุ่มรองเชื่อม `#tabletop-film` ที่ sectionวิดีโอใหม่ ไม่ผูกกับproviderหรือรุ่นrelease

## Why — เก้าอี้ ปากกา ค้อน

| ส่วน | ไทย | English |
| --- | --- | --- |
| Eyebrow | เครื่องมือที่พอดี | TOOLS THAT FIT |
| H2 | เครื่องมือที่พอดี ให้คุณอยู่กับสิ่งที่อยากทำ | Good tools keep you close to what you want to do. |
| Body | เก้าอี้ให้เรานั่งคิด ปากกาให้ความคิดมีรูปร่าง ค้อนช่วยให้มันเป็นจริง เราอยากให้ซอฟต์แวร์ช่วยให้เราอยู่กับงานตรงหน้าแบบนั้น และปรับต่อได้เมื่องานเปลี่ยน | A chair gives you a place to think. A pen gives an idea a shape. A hammer helps you build it. We want software to keep you close to your work, and adapt as that work changes. |
| Bridge | แต่งานเปลี่ยนได้ เครื่องมือจึงควรมีที่ให้ปรับตาม | Work changes. The tools should have room to change with it. |
| Belief | เครื่องมือที่ดีที่สุด คือเครื่องมือที่คุณไม่ต้องคิดถึงมัน | The best tool is the one you don't have to think about. |

ใช้ภาพเก้าอี้ ปากกา ค้อน SVG ที่ค่อย ๆ เพิ่มเข้ามาตาม motion โดยไม่มี morph; วางเป็นแถว editorial สั้น ไม่ทำเป็นภาพheroใหญ่จนคนเข้าใจว่าเป็นเว็บเฟอร์นิเจอร์ เรื่องนี้เป็นคำเปรียบเทียบที่ร่างใหม่ ไม่ติดป้ายว่าเป็นประวัติผู้ก่อตั้ง

## Process — 3 ขั้น

H2 TH: **เริ่มใช้ แล้วค่อยปรับให้เข้ากับงาน**

H2 EN: **Put it to work. Make it fit.**

| ขั้น | ไทย | English |
| --- | --- | --- |
| 01 | **บอกสิ่งที่อยากทำ** — เริ่มจากคำถามหรือโจทย์ของคุณ ยังไม่ต้องมีไฟล์ | **Describe your work** — Start with a question or a task. No file required. |
| 02 | **ตรวจ แล้วลงมือใช้** — ให้ AI ร่างเครื่องมือและกฎ ตรวจและปรับก่อนเปิดใช้ | **Review and use** — Let AI draft tools and rules. Check and adjust them before applying them. |
| 03 | **เปลี่ยนไปพร้อมงาน** — เพิ่มข้อมูล ใช้วิธีคำนวณเดิม หรือขอแก้กฎบนโต๊ะที่ใช้อยู่ | **Adapt as you go** — Add data, reuse a calculation, or change a rule on the table you already use. |

## ตัวอย่างหลัก — หนึ่งโต๊ะ สองการเปลี่ยนแปลง

H2 TH: **วันนี้สรุปยอดขาย พรุ่งนี้ลองส่วนลดแบบใหม่**

H2 EN: **Today's sales. Tomorrow's new discount.**

| ช่อง | ไทย | English |
| --- | --- | --- |
| Intro | ร้านเล็กเริ่มด้วย “ช่วยสรุปยอดขายวันนี้” แล้วเติมข้อมูลกาแฟและเค้ก เมื่อราคาหรือจำนวนเปลี่ยนก็ใช้วิธีคำนวณเดิม เมื่อต้องการลองส่วนลดใหม่ก็ขอปรับกฎเฉพาะจุด | A small shop starts with “Help me track today's sales.” Add coffee and cake sales. Reuse the calculation when prices or quantities change. Adjust one rule to try a new discount. |
| Data change | **225 → 405** เปลี่ยนข้อมูลแล้วใช้วิธีคำนวณที่เก็บไว้ ตัวเลขสรุปและกราฟใช้ผลรอบใหม่ | **225 → 405** Change the data and reuse the saved calculation. The total and chart reflect the new result. |
| Rule change | **ส่วนลด 10% → 20%** ถามกฎที่เลือก แล้วขอเปลี่ยนเฉพาะวิธีคิดส่วนลด | **10% → 20% discount** Ask about a rule, then request a change to that calculation. |
| Outcome | ยอดก่อนลด 405 ยังเท่าเดิม ยอดหลังลดเปลี่ยนจาก 364.50 เป็น 324 | The gross total stays 405. The discounted total changes from 364.50 to 324. |
| Caption | ตัวอย่างประกอบคำอธิบาย · การร่างและแก้กฎต้องตรวจและเปิดใช้ | Illustrative example · review and apply drafted rules and changes. |

เว้นวรรคตัวเลขใน UIตามlocale; เนื้อหาข้างบนไม่ใช่live widgetอ่านproduction เลือกทำแผนภาพหรือภาพจากmotionพร้อมcaption ภายหลังแทนได้ด้วยคลิปจริงที่ตรวจreadbackแล้ว

## Use cases — คงความกว้างของผลิตภัณฑ์

| ส่วน | ไทย | English |
| --- | --- | --- |
| H2 | ทุกโต๊ะมีเหตุผลของมัน | Every table has a reason to exist. |
| Work | **โต๊ะสำหรับงาน** — วางรายการ วิธีคำนวณ และผลลัพธ์ไว้ด้วยกัน เพื่อดูว่าอะไรเปลี่ยนและเพราะอะไร | **A table for work** — Keep records, calculations, and results together so you can see what changed and why. |
| Learning | **โต๊ะสำหรับเรียนรู้** — เปลี่ยนแรงหรือมวล แล้วเห็นผลจากการทดลอง | **A table for learning** — Change force or mass and see what happens in an experiment. |
| Play | **โต๊ะสำหรับเล่น** — เห็นกติกา ลำดับตา และผลจากการตัดสินใจในเกมร่วมมือ | **A table for play** — Follow rules, turns, and the effects of decisions in a cooperative game. |
| Demo CTA | ลองเดโมที่เตรียมไว้ | Try the prepared demo |
| Demo note | เดโมที่เตรียมไว้ · ข้อมูลและผู้เล่นจำลอง · ไม่เรียก AI | Prepared demo · simulated data and players · no AI call |

คงภาพPhysics/Encounterเดิมและลิงก์ `/demo` จริง ไม่ตั้งลิงก์แยกที่ยังไม่มีroute Invoiceอธิบายเป็นงานตัวอย่าง ไม่สัญญาOCR/PDFหรือการตรวจเอกสารทุกชนิด

## Final CTA

| ส่วน | ไทย | English |
| --- | --- | --- |
| H2 | มีเวลามากขึ้นกับสิ่งที่สำคัญ | More time for what matters. |
| Body | เริ่มจากเรื่องของคุณ แล้วปรับโต๊ะให้เข้ากับสิ่งที่กำลังทำ | Bring your work to the table. Keep shaping it as you go. |
| CTA | เริ่มโต๊ะของคุณ | Start your table |
| Scope | เครื่องมือทำงานภายในส่วนประกอบและระบบคำนวณที่รองรับ สิ่งที่ AI ร่างอาจต้องปรับก่อนใช้ | Tools work within supported components and compute runtimes. AI drafts may need adjustment before use. |
| Thesis | Work defines what software becomes. | Work defines what software becomes. |

คงข้อความauth/welcome/errorเดิม; TH/ENในแผนนี้ครอบเฉพาะpublic narrative วิดีโอรอบ 2 ใช้ TH เป็นหลัก; เสียง/ซับ EN เป็น export แยกใน final
