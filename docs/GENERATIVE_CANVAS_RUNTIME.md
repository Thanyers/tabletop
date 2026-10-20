# Generative Canvas — สร้างเครื่องมือแล้วลงมือใช้บนโต๊ะ

สถานะ: candidate บน `feat/F005-generative-canvas` สำหรับตรวจและทดสอบก่อน release; ยังไม่ใช่ความสามารถที่ยืนยันบน production ดูผลตรวจใน [spec.md](../spec.md) และ [acceptance](GENERATIVE_CANVAS_ACCEPTANCE.md)

## วิธีใช้

1. เปิดโต๊ะเปล่าแล้วพิมพ์สิ่งที่อยากลอง แนบ CSV, JSON, TXT หรือ Markdown ได้ถ้ามีข้อมูลเริ่มต้น การพิมพ์ในโต๊ะเดิมไม่ได้สร้างห้องใหม่
2. ให้ AI ร่างเครื่องมือ ข้อมูลที่ส่งคือคำขอ กฎและข้อมูลปัจจุบัน และไฟล์ของเจ้าของที่แสดงใน consent หากไม่มีไฟล์ให้ใช้ตัวอย่างสมมติและแสดงข้อสมมติ
3. เปิด Rules บน Canvas เพื่อตรวจข้อมูล กฎ และภาพที่เสนอ ทดลองร่างบนสำเนาส่วนตัวก่อนอนุมัติ การทดลองไม่ส่งคำสั่งไปแก้ห้องจริง
4. Preview change → Check rules → Approve rules → Use these rules จากนั้นเล่นผ่านการ์ด ปุ่ม แบบฟอร์ม ตัวเลื่อน หรือวัตถุที่ลากได้บนฉาก
5. ชวนสมาชิกผ่าน Invite กฎและข้อมูลที่เปิดใช้แล้วเป็นของโต๊ะร่วมกัน กลับเข้าด้วยบัญชีเดิมเพื่อเล่นต่อ ไฟล์และร่างของเจ้าของ กับบทสนทนาส่วนตัวของแต่ละคนยังแยกกัน
6. เมื่อต้องการเปลี่ยนเครื่องมือ ให้บอก AI ในโต๊ะเดิม ตรวจร่างใหม่แล้วเปิดใช้ ข้อมูลที่เล่นไปแล้วและตำแหน่งการ์ดที่ลากไว้ยังอยู่

ตัวอย่างคำขอ: “ทำการทดลองแสงและเงาให้ลากหลอดไฟได้”, “สร้างภาพคิวร้านกาแฟพร้อมเวลารอและปุ่มเดินเวลา”, “ทำเกมร่วมมือแบ่งน้ำที่ผลรวมปริมาณน้ำไม่หายไป” ตัวอย่างเหล่านี้ไม่ใช่ชื่อ template ใน runtime

## ระบบที่เพิ่ม

| ส่วน | พฤติกรรม |
| --- | --- |
| ภาพและเครื่องมือ | `TableProgram.canvas` ประกอบ scene, chart, metric และ controls ด้วย descriptor ที่ตรวจได้ ใช้การ์ดและการเปิดเครื่องมือแบบเดิม |
| สูตรและพฤติกรรม | AST สำหรับสูตร ตัวแปร เงื่อนไข ตรีโกณมิติ aggregate/map/filter/reduce ใช้กับภาพและ action ได้ เกิดสูตรใหม่ได้โดยไม่เพิ่ม switch ตามชื่อโจทย์ |
| การเล่น | browser แสดงตัวอย่างระหว่างลาก แล้วส่ง action เมื่อปล่อย; server ตรวจสมาชิก บทบาท เทิร์น ค่าข้อมูล และ revision ก่อน commit |
| การแก้ร่าง AI | ตรวจโครงสร้างและความเข้ากันได้ ส่งข้อผิดพลาดพร้อมบางส่วนของคำตอบเดิมกลับไปแก้ สูงสุดสามครั้งในเวลา 25 วินาที จองและบันทึกค่าใช้จ่ายทุกครั้ง |
| การจัดวาง | ใช้ความสัมพันธ์ระหว่างข้อมูล/เครื่องมือ ขนาดการ์ดจริง กลุ่มที่เชื่อมกัน และตำแหน่งเดิม การ์ดใหม่เกิดใกล้สิ่งที่เกี่ยวข้อง; ตำแหน่งที่คนจัดไว้คงอยู่ |
| การขยับร่วมกัน | ตำแหน่ง shared cards บันทึกในห้องด้วย layout revision แยกจาก revision ของการเล่น จึงไม่ทำให้คำสั่งเล่นหรือการอนุมัติกฎหมดอายุเพราะมีคนลากการ์ด |
| การกลับมาทำต่อ | กฎ ข้อมูล ประวัติ และตำแหน่งที่ยืนยันแล้วอยู่ใน Room; กล้องและการเลือกวัตถุเป็นมุมมองส่วนตัว |
| บริบทสนทนา | ใช้ข้อมูลปัจจุบันร่วมกับบทสนทนาไม่เกินหกช่วง/16 KiB เลือกสี่ช่วงล่าสุดและค้นช่วงเก่าที่เกี่ยวข้องได้สูงสุดสองช่วงจาก 100 ช่วงล่าสุดของผู้ถามในโต๊ะเดียวกัน |

บทสนทนาเก่าเป็นข้อมูลประกอบ ไม่แทนสถานะปัจจุบันและไม่อนุญาตให้เล่นแทนผู้ใช้ การค้นใช้คำ/ชื่อที่ตรงกัน ยังไม่มี semantic search หรือการสรุปความจำโครงการอัตโนมัติ

## ขอบเขตที่บังคับจริง

- ไม่รัน JavaScript, HTML, dependency, URL หรือคำสั่งระบบที่โมเดลสร้าง สูตรเป็นข้อมูลที่ interpreter ของ Tabletop ประมวลผล
- สูงสุด 12 generated views และ 24 nodes รวมบน Canvas; scene รวมไม่เกิน 128 ชิ้น; expression depth 32 และ 512 expression nodes
- การประมวลผลหนึ่ง action และภาพรวมหนึ่ง Canvas จำกัด 10,000 evaluation steps และผลลัพธ์ 16 KiB พร้อมตรวจจำนวน ค่าตัวเลข และการอ้างอิง
- ปุ่มทุกปุ่มอ้าง action ที่ประกาศไว้ ห้าม renderer แก้ shared records ตรง ๆ; action ที่ผิดเงื่อนไขหรือสร้างผลลัพธ์ผิดขอบเขตไม่ commit
- schema ของ collection/field ที่เปิดใช้แล้วต้องคงเดิม รุ่นนี้เพิ่มหรือแก้ views/actions ได้ แต่ยังไม่ migrate schema หรือเพิ่มข้อมูลใหม่ผ่านร่างกฎ
- การเคลื่อนไหวเป็นภาพที่คำนวณตาม input และ transition; ยังไม่มี shared simulation clock, arbitrary animation timeline, arbitrary code sandbox, image generation, 3D หรือเกม real-time
- เพดานประวัติ assistant jobs ยังเป็น 500 ต่อห้อง ไม่ใช่การเก็บความจำไม่จำกัด และไม่มี retention/export/delete workflow ใหม่

## จุดต่อสำหรับทีม

| งาน | ไฟล์หลัก |
| --- | --- |
| สัญญาข้อมูลภาพและสูตร | [generative-contracts.ts](../src/tabletop/shared/generative-contracts.ts), [schema.ts](../src/tabletop/runtime/generative/schema.ts) |
| static checks และ interpreter | [validation.ts](../src/tabletop/runtime/generative/validation.ts), [evaluator.ts](../src/tabletop/runtime/generative/evaluator.ts) |
| atomic action/approval | [table.ts](../src/tabletop/domain/table.ts), [evolution.ts](../src/tabletop/domain/evolution.ts), [authority.ts](../server/authority.ts) |
| ภาพและการทดลองร่าง | [GeneratedCanvasObjects.tsx](../src/tabletop/ui/GeneratedCanvasObjects.tsx), [TableCanvasObjects.tsx](../src/tabletop/ui/TableCanvasObjects.tsx) |
| layout และ shared CAS | [canvas-layout.ts](../src/tabletop/ui/canvas-layout.ts), [domain/canvas-layout.ts](../src/tabletop/domain/canvas-layout.ts), [projection-cursor.ts](../server/projection-cursor.ts) |
| การสร้าง/ซ่อมด้วย AI | [ai.ts](../cloudflare/ai.ts), [provider adapter](../server/providers/deepseek-changes.ts) |
| ค้นบทสนทนาเก่า | [table-memory.ts](../cloudflare/table-memory.ts), [room-repository.ts](../cloudflare/room-repository.ts) |

ไม่มี dependency, secret, binding หรือ SQL migration ใหม่ใน candidate นี้ ใช้ optional fields ใน JSON state เดิม ข้อมูลเก่าที่ไม่มี canvas ยังเปิดได้ แต่หลังบันทึก expression/descriptor ใหม่แล้ว **อย่าถอยไปใช้โค้ด v1.0.0 เพื่อเขียนห้องเหล่านั้น** ใช้ build ที่อ่านสัญญาใหม่นี้ได้และพักการเขียนก่อนทำ recovery

รัน unit/build/Cloudflare ตาม [CONTRIBUTING](../CONTRIBUTING.md) แล้วรัน `npm run test:generative:browser` เพื่อทดสอบด้วยโมเดลและบัญชีจำลอง รุ่น Node ที่ตรวจคือ `22.23.2`

การทดสอบ AI จริงเป็น opt-in: ตั้ง `TABLETOP_CREDENTIAL_FILE` ให้ชี้ไฟล์ credential เดิมที่ไม่อยู่ใน Git และรัน `npm run test:generative:live` เฉพาะข้อมูลสมมติ จะใช้ local Worker/ฐานทดสอบกับ provider จริง สูงสุดหกคำขอและ ledger $0.20 ต่อรอบ ไม่ได้ยืนยัน Google login หรือประสิทธิภาพ hosted Workers Free
