# ส่งมอบ Tabletop ให้ทีมวิศวกรรม

สำหรับทีมที่รับช่วงพัฒนา: อ่าน [product.md](../product.md) เมื่อจำเป็นต้องเข้าใจเหตุผล ผู้ใช้ และขอบเขตผลิตภัณฑ์ จากนั้นเริ่มที่ [สถานะ deployment ล่าสุด](DEPLOYMENTS.md) เพื่อยืนยัน source และ environment ใช้ [CONTRIBUTING](../CONTRIBUTING.md) ตั้งเครื่องและรันในเครื่อง แล้วเปิดเอกสาร design/acceptance ที่ตรงกับส่วนที่จะแก้

## สถานะและลำดับงาน

รุ่นแอปที่ตรวจล่าสุดคือ `c9d3bf0` จาก PR #6, ตรวจ deployment เมื่อ 20 ตุลาคม 2026 รายละเอียด URL, Worker version, resource และหลักฐานปัจจุบันอยู่ใน [DEPLOYMENTS](DEPLOYMENTS.md); อัปเดตข้อมูลนั้นหลังตรวจ release รุ่นถัดไปแล้ว

ลำดับงานที่ควรทำต่อ:

1. **ปิดช่องว่างด้านความพร้อมให้บริการ:** ทดสอบโทรศัพท์จริงและสองอุปกรณ์, วัด concurrency/DO duration และซ้อมกู้ D1 + Room + Billing ให้สอดคล้องกันบนข้อมูลจำลอง
2. **กำหนดความต่อเนื่องระยะยาว:** วาง retention/export/delete และแนวทางเมื่อถึงเพดาน assistant jobs 500 รายการต่อห้อง; ปัจจุบันยังไม่มีการค้นหรือสรุปบทสนทนาย้อนหลังอัตโนมัติ
3. **พัฒนาคำสั่งภาษาธรรมชาติ:** ทำให้จับคู่คำขอกับ action ได้ดีขึ้น โดยยังให้คนตรวจข้อเสนอและยืนยัน และตรวจ role/turn/revision ก่อน commit; ไม่มีการเล่นหลายตาอัตโนมัติโดยปริยาย

รายการนี้เป็นลำดับแนะนำสำหรับทีม เอกสารไม่ได้ยืนยันว่าเป็นงานที่เริ่มแล้วหรืออนุมัติให้เปลี่ยน production

## แผนที่โค้ด

| งาน | จุดเริ่มต้น |
| --- | --- |
| เปิดโต๊ะ, session และ API client | [`TabletopApp.tsx`](../src/tabletop/TabletopApp.tsx), [`client.ts`](../src/tabletop/client.ts) |
| Canvas, objects และตัวแสดงข้อมูล | [`CanvasWorkspace.tsx`](../src/tabletop/ui/CanvasWorkspace.tsx), [`CanvasObjectContent.tsx`](../src/tabletop/ui/CanvasObjectContent.tsx), [`TableCanvasObjects.tsx`](../src/tabletop/ui/TableCanvasObjects.tsx) |
| แชท, rule proposal และ consent | [`TableAssistant.tsx`](../src/tabletop/ui/TableAssistant.tsx), [`AIProposal.tsx`](../src/tabletop/ui/AIProposal.tsx), [`table-assistant-contracts.ts`](../src/tabletop/shared/table-assistant-contracts.ts) |
| schema และ interpreter ของ Shared data table | [`table-contracts.ts`](../src/tabletop/shared/table-contracts.ts), [`domain/table.ts`](../src/tabletop/domain/table.ts) |
| สิทธิ์, คำสั่ง และ state ที่เป็น authority | [`server/authority.ts`](../server/authority.ts), [`cloudflare/room.ts`](../cloudflare/room.ts), [`room-repository.ts`](../cloudflare/room-repository.ts) |
| Worker, auth และ room directory | [`cloudflare/index.ts`](../cloudflare/index.ts), [`cloudflare/`](../cloudflare/) |
| AI provider, consent, budget และ recovery | [`cloudflare/ai.ts`](../cloudflare/ai.ts), [`billing.ts`](../cloudflare/billing.ts) |
| การตรวจ domain และ browser flow | [`domain/table.test.ts`](../src/tabletop/domain/table.test.ts), [`room.test.ts`](../cloudflare/room.test.ts), [`generic-table-browser.mjs`](../tests/generic-table-browser.mjs) |

สำหรับ flow เริ่มต้นและชุดคำสั่งตรวจ ให้ใช้ [CONTRIBUTING](../CONTRIBUTING.md) เป็นหลัก Node `npm start` เหมาะกับ UI/domain และปิด AI; Cloudflare emulator ใช้ fixture จำลอง; staging ใช้ตรวจ integration ที่ local ยืนยันไม่ได้ ส่วน [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md) อธิบายความต่างของแต่ละ runtime

## ภาพรวมสถาปัตยกรรมและขอบเขต

- **Browser/React Canvas** แสดงข้อมูลตาม projection ที่ server อนุญาตและส่งคำสั่ง; state ใน browser ไม่ตัดสินสมาชิก สิทธิ์ หรือผลของ action
- **Worker + D1** จัดการ Google identity, session, CSRF, rate limits และ directory สำหรับ My tables; directory ใช้ค้นหาห้อง ไม่ใช่ authority ของสมาชิก
- **Room Durable Object** เป็น state ถาวรต่อห้อง รวมสมาชิก/คำเชิญ, revision, receipts, rules, events และ assistant jobs; domain ฝั่ง server ตรวจ role, seat, turn และเงื่อนไขก่อน commit แบบ atomic
- **AI adapter + Billing Durable Object** ส่งเฉพาะข้อมูลที่ผู้ใช้ยินยอมในขอบเขตที่กำหนด จอง/settle งบ และตรวจ structured output; โมเดลไม่ได้ให้สิทธิ์ อนุมัติกฎ หรือ execute code
- **ความเป็นส่วนตัว:** source files และ draft rules เป็นของเจ้าของ, conversation เป็นของผู้ถาม, active rules/records เป็นข้อมูลร่วม อย่าส่ง private content เพิ่มเพียงเพื่อจัดหน้า UI

D1 และ Room DO ไม่ได้อยู่ใน transaction เดียวกัน การ sync directory ใช้ ordered outbox; WebSocket ส่ง authorized snapshots และ resync เมื่อ reconnect จึงอย่าตั้งสมมติฐานว่า event จะถูกส่งครั้งเดียวเสมอ รายละเอียด auth และ projection อยู่ใน [R1 architecture](R1_ARCHITECTURE.md); contract และข้อจำกัดของ table อยู่ใน [Generic table design](GENERIC_TABLE_DESIGN.md)

## สิ่งที่ทดสอบแล้ว

- [รุ่นที่ deploy](DEPLOYMENTS.md) อ้าง source `c9d3bf0` / PR #6; staging และ production ใช้ source tree เดียวกัน และไฟล์เว็บ 130 ไฟล์ตรงกับ build ที่ตรวจ
- [CI ของรุ่นล่าสุด](https://github.com/Thanyers/tabletop/actions/runs/39358949964) ผ่าน unit/SQL 309 รายการ, Cloudflare 65, Component Lab 7, browser checks, build และ public/secret scans; fixture ใน CI ไม่ได้เรียก Google หรือ AI provider จริง
- Staging ผ่านการเล่น River Race ด้วย Google สองบัญชีจริงและกลับเข้าห้องเดิมหลังปิด/เปิดแท็บ; production ตรวจอ่านและกลับเข้า Encounter Table เดิมได้หลัง deploy โดยข้อมูลและกฎเดิมยังอยู่
- [Calm Canvas acceptance](CALM_CANVAS_ACCEPTANCE.md) บันทึกการเล่น local ของ Helpdesk ด้วย AI จริงและบัญชีจำลองสองคน แยกจากหลักฐาน Google สองบัญชีบน staging
- `SKIPPED`: automated axe/full contrast/screen-reader audit, การใช้นิ้วบนโทรศัพท์จริง และกรณี invoice เปลี่ยนระหว่างหลักฐานสองชิ้น
- ยังไม่มีหลักฐาน load/soak, restart recovery หรือการกู้ D1 + Room + Billing ทั้งระบบ การกลับเข้าห้องเดิมและการทดสอบ local ไม่ยืนยันความพร้อมทุกกรณี

ใช้ [Calm Canvas design](CALM_CANVAS_DESIGN.md) สำหรับพฤติกรรม Canvas และ [Calm Canvas acceptance](CALM_CANVAS_ACCEPTANCE.md) สำหรับรายละเอียดของ candidate ล่าสุด ส่วนการทดสอบข้าม scenario และ migration อยู่ใน [Generic table acceptance](GENERIC_TABLE_ACCEPTANCE.md)

## ส่งรุ่นใหม่และกู้คืน

1. ก่อน deploy ให้ operator ตรวจ target environment, Worker/source, bindings, migration state และ readiness จาก [DEPLOYMENTS](DEPLOYMENTS.md); รับสิทธิ์และ config ผ่านเจ้าของระบบ
2. การเขียนฐานข้อมูลต้องอนุมัติ scope ก่อน โดยระบุ environment/table, operation, predicate/record scope, จำนวนแถวที่คาด (หรือ `Unknown`) และ transaction/rollback; ทำและตรวจเฉพาะ scope เดิม
3. Migration ที่อยู่ใน Git ไม่ได้อนุญาตให้รันกับฐานถาวร และห้ามใช้ provisioning รุ่นแรกซ้ำกับ environment ที่มีข้อมูลแล้ว
4. เมื่อมี `table` data แล้ว อย่าถอยไป Worker ที่รองรับเพียงสามชนิดเดิม หากต้องหยุด write ให้ใช้ build ที่เข้ากันได้พร้อม `TABLE_READ_ONLY=true`, ตรวจ job ที่ค้าง และทำ recovery ไปข้างหน้า ตาม [compatible recovery](GENERIC_TABLE_ACCEPTANCE.md#compatible-recovery-build)
5. หลัง release ตรวจ `GET /version` ว่า `sha` ตรงกับ commit ที่ส่ง (config deploy ต้องมี `/version` ใน `assets.run_worker_first`) แล้วตรวจ asset parity และ resume ตาม scope ที่อนุมัติ แล้วอัปเดต [Deployment](DEPLOYMENTS.md) ด้วย source, version และหลักฐานที่ไม่มี credential หรือข้อมูลผู้ใช้

ไม่มี deploy step ใน CI อย่าใส่ secret, account/session evidence หรือ operator receipts ใน Git; หลักฐานที่ระบุตัวตนและ runtime config อยู่ใน ignored local `test-results/` และต้องส่งต่อโดยเจ้าของระบบ
