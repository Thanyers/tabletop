# ส่งมอบ Tabletop ให้ทีมวิศวกรรม

สำหรับทีมที่รับช่วงพัฒนา: อ่าน [product.md](../product.md) เมื่อจำเป็นต้องเข้าใจเหตุผล ผู้ใช้ และขอบเขตผลิตภัณฑ์ จากนั้นเริ่มที่ [สถานะ deployment ล่าสุด](DEPLOYMENTS.md) เพื่อยืนยัน source และ environment ใช้ [CONTRIBUTING](../CONTRIBUTING.md) ตั้งเครื่องและรันในเครื่อง แล้วเปิดเอกสาร design/acceptance ที่ตรงกับส่วนที่จะแก้

## สถานะและลำดับงาน

รุ่นที่บันทึกว่า deploy ล่าสุดคือ `v1.0.0` / `ce2c50e` เมื่อ 20 ตุลาคม 2026 ดู [DEPLOYMENTS](DEPLOYMENTS.md) สำหรับ source/build และหลักฐานของ staging/production โดยตรง

งานรุ่นถัดไปใน `dev` รวม F005 จาก [PR #24](https://github.com/Thanyers/tabletop/pull/24) และการตั้งชื่อโต๊ะ F002 จาก [PR #29](https://github.com/Thanyers/tabletop/pull/29) ส่วน [PR #30](https://github.com/Thanyers/tabletop/pull/30) ต่อช่องแชท F006 บนฐานเดียวกัน สูตร/ภาพ ตัวควบคุม การลากใน scene ทดลองร่างส่วนตัว shared semantic layout และการค้นบทสนทนาเก่าแบบจำกัดยังใช้ contract เดิม อ่าน [Generative runtime](GENERATIVE_CANVAS_RUNTIME.md) สำหรับ contract/วิธีใช้ และ [spec.md](../spec.md) สำหรับผลตรวจล่าสุด ห้ามถือว่างานใน `dev` ขึ้น production แล้ว

ลำดับงานที่ควรทำต่อ:

1. **ปิดช่องว่างด้านความพร้อมให้บริการ:** ทดสอบโทรศัพท์จริงและสองอุปกรณ์, วัด concurrency/DO duration และซ้อมกู้ D1 + Room + Billing ให้สอดคล้องกันบนข้อมูลจำลอง
2. **กำหนดความต่อเนื่องระยะยาว:** วาง retention/export/delete และแนวทางเมื่อถึงเพดาน assistant jobs 500 รายการต่อห้อง; candidate เพิ่มการค้นข้อความที่เกี่ยวข้องใน 100 รายการล่าสุด แต่ยังไม่มีการสรุปหรือค้นประวัติแบบไม่จำกัด
3. **พัฒนาคำสั่งภาษาธรรมชาติ:** ทำให้จับคู่คำขอกับ action ได้ดีขึ้น โดยยังให้คนตรวจข้อเสนอและยืนยัน และตรวจ role/turn/revision ก่อน commit; ไม่มีการเล่นหลายตาอัตโนมัติโดยปริยาย

รายการนี้เป็นลำดับแนะนำสำหรับทีม เอกสารไม่ได้ยืนยันว่าเป็นงานที่เริ่มแล้วหรืออนุมัติให้เปลี่ยน production

## แผนที่โค้ด

| งาน | จุดเริ่มต้น |
| --- | --- |
| เปิดโต๊ะ, session และ API client | [`TabletopApp.tsx`](../src/tabletop/TabletopApp.tsx), [`client.ts`](../src/tabletop/client.ts) |
| Canvas, objects และตัวแสดงข้อมูล | [`CanvasWorkspace.tsx`](../src/tabletop/ui/CanvasWorkspace.tsx), [`CanvasObjectContent.tsx`](../src/tabletop/ui/CanvasObjectContent.tsx), [`TableCanvasObjects.tsx`](../src/tabletop/ui/TableCanvasObjects.tsx) |
| แชท, rule proposal และ consent | โต๊ะข้อมูล: [`TableChat.tsx`](../src/tabletop/ui/TableChat.tsx), [`useTableChat.tsx`](../src/tabletop/ui/useTableChat.tsx), [`table-chat-consent.ts`](../src/tabletop/ui/table-chat-consent.ts); โต๊ะตัวอย่างเดิม: [`AIProposal.tsx`](../src/tabletop/ui/AIProposal.tsx); [`TableAssistant.tsx`](../src/tabletop/ui/TableAssistant.tsx) เก็บไว้เป็นโค้ดเดิมและไม่ได้ต่อกับหน้าโต๊ะปัจจุบัน; สัญญาร่วม: [`table-assistant-contracts.ts`](../src/tabletop/shared/table-assistant-contracts.ts) |
| schema และ interpreter ของ Shared data table | [`table-contracts.ts`](../src/tabletop/shared/table-contracts.ts), [`domain/table.ts`](../src/tabletop/domain/table.ts) |
| สิทธิ์, คำสั่ง และ state ที่เป็น authority | [`server/authority.ts`](../server/authority.ts), [`cloudflare/room.ts`](../cloudflare/room.ts), [`room-repository.ts`](../cloudflare/room-repository.ts) |
| Worker, auth และ room directory | [`cloudflare/index.ts`](../cloudflare/index.ts), [`cloudflare/`](../cloudflare/) |
| AI provider, consent, budget และ recovery | [`cloudflare/ai.ts`](../cloudflare/ai.ts), [`billing.ts`](../cloudflare/billing.ts) |
| การตรวจ domain และ browser flow | [`domain/table.test.ts`](../src/tabletop/domain/table.test.ts), [`room.test.ts`](../cloudflare/room.test.ts), [`generic-table-browser.mjs`](../tests/generic-table-browser.mjs) |
| Generated expressions, scenes และ controls | [`runtime/generative/`](../src/tabletop/runtime/generative/), [`GeneratedCanvasObjects.tsx`](../src/tabletop/ui/GeneratedCanvasObjects.tsx), [`generative-canvas-browser.mjs`](../tests/generative-canvas-browser.mjs) |
| ตำแหน่งร่วมกันและความจำบทสนทนา | [`domain/canvas-layout.ts`](../src/tabletop/domain/canvas-layout.ts), [`ui/canvas-layout.ts`](../src/tabletop/ui/canvas-layout.ts), [`table-memory.ts`](../cloudflare/table-memory.ts) |

สำหรับ flow เริ่มต้นและชุดคำสั่งตรวจ ให้ใช้ [CONTRIBUTING](../CONTRIBUTING.md) เป็นหลัก Node `npm start` เหมาะกับ UI/domain และปิด AI; Cloudflare emulator ใช้ fixture จำลอง; staging ใช้ตรวจ integration ที่ local ยืนยันไม่ได้ ส่วน [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md) อธิบายความต่างของแต่ละ runtime

## ภาพรวมสถาปัตยกรรมและขอบเขต

- **Browser/React Canvas** แสดงข้อมูลตาม projection ที่ server อนุญาตและส่งคำสั่ง; state ใน browser ไม่ตัดสินสมาชิก สิทธิ์ หรือผลของ action
- **Worker + D1** จัดการ Google identity, session, CSRF, rate limits และ directory สำหรับ My tables; directory ใช้ค้นหาห้อง ไม่ใช่ authority ของสมาชิก
- **Room Durable Object** เป็น state ถาวรต่อห้อง รวมสมาชิก/คำเชิญ, revision, receipts, rules, events และ assistant jobs; domain ฝั่ง server ตรวจ role, seat, turn และเงื่อนไขก่อน commit แบบ atomic
- **AI adapter + Billing Durable Object** ส่งเฉพาะข้อมูลที่ผู้ใช้ยินยอมในขอบเขตที่กำหนด จอง/settle งบ และตรวจ structured output; โมเดลไม่ได้ให้สิทธิ์ อนุมัติกฎ หรือ execute code
- **ความเป็นส่วนตัว:** source files และ draft rules เป็นของเจ้าของ, conversation เป็นของผู้ถาม, active rules/records เป็นข้อมูลร่วม อย่าส่ง private content เพิ่มเพียงเพื่อจัดหน้า UI

D1 และ Room DO ไม่ได้อยู่ใน transaction เดียวกัน การ sync directory ใช้ ordered outbox; WebSocket ส่ง authorized snapshots และ resync เมื่อ reconnect จึงอย่าตั้งสมมติฐานว่า event จะถูกส่งครั้งเดียวเสมอ รายละเอียด auth และ projection อยู่ใน [R1 architecture](R1_ARCHITECTURE.md); contract และข้อจำกัดของ table อยู่ใน [Generic table design](GENERIC_TABLE_DESIGN.md)

## หลักฐานรุ่นก่อนหน้า

- [รุ่นที่ deploy](DEPLOYMENTS.md) อ้าง source `9fbfdec`; staging และ production ใช้ source/build ชุดเดียวกัน ไฟล์เว็บ 131 ไฟล์ตรงกับ build และ `/version` รายงาน sha ตรงกัน
- [CI ของรุ่นล่าสุด](https://github.com/Thanyers/tabletop/actions/runs/39368620190) ผ่าน unit/SQL, Cloudflare, Component Lab, browser checks, build และ public/secret scans; fixture ใน CI ไม่ได้เรียก Google หรือ AI provider จริง
- รอบล่าสุดตรวจข้อความใหม่และเปิดตัวอย่างเดิมครบทั้งสอง environment พร้อมกลับเข้า River Race บน staging และ Encounter บน production แบบอ่านอย่างเดียว ข้อมูลและกฎเดิมยังอยู่; การเล่น River Race ด้วย Google สองบัญชีจริงเป็นหลักฐานของรอบก่อน ไม่ได้เล่นสองบัญชีใหม่ใน release นี้
- [Calm Canvas acceptance](CALM_CANVAS_ACCEPTANCE.md) บันทึกการเล่น local ของ Helpdesk ด้วย AI จริงและบัญชีจำลองสองคน แยกจากหลักฐาน Google สองบัญชีบน staging
- `SKIPPED`: automated axe/full contrast/screen-reader audit, การใช้นิ้วบนโทรศัพท์จริง และกรณี invoice เปลี่ยนระหว่างหลักฐานสองชิ้น
- ยังไม่มีหลักฐาน load/soak, restart recovery หรือการกู้ D1 + Room + Billing ทั้งระบบ การกลับเข้าห้องเดิมและการทดสอบ local ไม่ยืนยันความพร้อมทุกกรณี

ใช้ [Calm Canvas design](CALM_CANVAS_DESIGN.md) สำหรับพฤติกรรม Canvas และ [Calm Canvas acceptance](CALM_CANVAS_ACCEPTANCE.md) สำหรับหลักฐานของรุ่นนั้น ส่วนการทดสอบข้าม scenario และ migration อยู่ใน [Generic table acceptance](GENERIC_TABLE_ACCEPTANCE.md) ผลของ candidate ใหม่ต้องดู [Generative acceptance](GENERATIVE_CANVAS_ACCEPTANCE.md) แยกกัน

## ส่งรุ่นใหม่และกู้คืน

1. ก่อน deploy ให้ operator ตรวจ target environment, Worker/source, bindings, migration state และ readiness จาก [DEPLOYMENTS](DEPLOYMENTS.md); รับสิทธิ์และ config ผ่านเจ้าของระบบ
2. การเขียนฐานข้อมูลต้องอนุมัติ scope ก่อน โดยระบุ environment/table, operation, predicate/record scope, จำนวนแถวที่คาด (หรือ `Unknown`) และ transaction/rollback; ทำและตรวจเฉพาะ scope เดิม
3. Migration ที่อยู่ใน Git ไม่ได้อนุญาตให้รันกับฐานถาวร และห้ามใช้ provisioning รุ่นแรกซ้ำกับ environment ที่มีข้อมูลแล้ว
4. เมื่อมี `table` data แล้ว อย่าถอยไป Worker ที่รองรับเพียงสามชนิดเดิม หากต้องหยุด write ให้ใช้ build ที่เข้ากันได้พร้อม `TABLE_READ_ONLY=true`, ตรวจ job ที่ค้าง และทำ recovery ไปข้างหน้า ตาม [compatible recovery](GENERIC_TABLE_ACCEPTANCE.md#compatible-recovery-build)
   สำหรับ candidate Generative นี้ ไม่มี SQL migration/runtime dependency/secret/binding ใหม่ แต่ JSON ที่มี expression/canvas ใหม่ต้องใช้ build ที่อ่านสัญญาใหม่นี้ได้ โค้ด `v1.1.0` หรือต่ำกว่าไม่ใช่ compatible writer สำหรับห้องเหล่านั้น
5. หลัง release ตรวจ `GET /version` ว่า `sha` ตรงกับ commit ที่ส่ง (config deploy ต้องมี `/version` ใน `assets.run_worker_first`) แล้วตรวจ asset parity และ resume ตาม scope ที่อนุมัติ แล้วอัปเดต [Deployment](DEPLOYMENTS.md) ด้วย source, version และหลักฐานที่ไม่มี credential หรือข้อมูลผู้ใช้

ไม่มี deploy step ใน CI อย่าใส่ secret, account/session evidence หรือ operator receipts ใน Git; หลักฐานที่ระบุตัวตนและ runtime config อยู่ใน ignored local `test-results/` และต้องส่งต่อโดยเจ้าของระบบ
