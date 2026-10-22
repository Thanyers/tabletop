# ส่งมอบ Tabletop ให้ทีมวิศวกรรม

สำหรับทีมที่รับช่วงพัฒนา: อ่าน [product.md](../product.md) เมื่อจำเป็นต้องเข้าใจเหตุผล ผู้ใช้ และขอบเขตผลิตภัณฑ์ จากนั้นเริ่มที่ [สถานะ deployment ล่าสุด](DEPLOYMENTS.md) เพื่อยืนยัน source และ environment ใช้ [CONTRIBUTING](../CONTRIBUTING.md) ตั้งเครื่องและรันในเครื่อง แล้วเปิดเอกสาร design/acceptance ที่ตรงกับส่วนที่จะแก้

## สถานะและลำดับงาน

**ส่ง 2.0.0 ขึ้น production และ staging แล้ว** จาก annotated tag `v2.0.0` / `d93620d` ใน [PR #33](https://github.com/Thanyers/tabletop/pull/33) โดย [CI บน main](https://github.com/Thanyers/tabletop/actions/runs/39439056507) ผ่านก่อนสร้าง tag ดู [DEPLOYMENTS](DEPLOYMENTS.md) และ [ผลตรวจรุ่น 2.0](RELEASE_2_0_ACCEPTANCE.md) สำหรับเวลา source และขอบเขตจริง

รุ่นนี้รวม F005/#24, ตั้งชื่อ F002/#29, แชท F006/#30 และผังร่วม F007/#31 พร้อมแก้บั๊ก preview ที่เปลี่ยนเทิร์น ไม่มี SQL migration, secret, binding หรืองบใหม่ ประวัติทีมทั้ง 17 commits ยังอยู่ใน main งาน draft #34 (แชร์ไฟล์) และ #35 (การ์ดเริ่มโต๊ะว่าง) แยกจากรุ่นนี้

`main` และ tag ใช้อ้างอิง release ส่วน `dev` เป็นฐานทำงานถัดไป เอกสารสถานะล่าสุดอัปเดตผ่าน PR เข้า `dev` ตาม AGENTS.md การแก้เอกสารไม่ได้ deploy แอปอัตโนมัติ

## เล่นรุ่นไหน ที่ไหน

| ที่เล่น | รุ่น / วิธีเริ่ม |
| --- | --- |
| [Production](https://tabletop.ptchrr.workers.dev/) | 2.0.0/d93620d; Google login → สร้างโต๊ะที่/new → พิมพ์สิ่งที่จะทำในแชทด้านล่างหรือแนบไฟล์ → ยินยอม → ตรวจร่าง/ลองส่วนตัว → Check/Approve/Use → เล่นด้วย controlsบนCanvas → Invite → บัญชีเดิมเปิดโต๊ะเดิมต่อ |
| [Staging](https://tabletop-staging.ptchrr.workers.dev/) | buildเดียวกัน; ห้องทดสอบคาเฟ่/น้ำและข้อมูลเก่ายังคงอยู่ เข้าด้วยบัญชีที่เป็นสมาชิก ไม่เผยแพร่ invite ใน repo |
| [Public demo](https://tabletop.ptchrr.workers.dev/demo) | ไม่ต้องล็อกอิน; ลำดับ/ข้อมูลเตรียมไว้ การ์ดค่อยๆเกิด กดพัก/รับช่วงลองเอง; ไม่เรียก AIหรือสร้างห้องจริง |
| Local | checkout main/tag2.0.0 หรือ devล่าสุด, npm ci → npm run build → npm start; Node localมี guestและAIปิดโดยตั้งใจ ไม่ใช้ production keys |

### ถ้าไม่เห็นแชทในเครื่อง

ตรวจ branch และ `/version` ก่อน: `main` ก่อน #33 ยังเป็น 1.1.0 และไม่มี `TableChat` จาก #30 ส่วน `main` หลัง #33 มีแล้ว `npm start` อ่านไฟล์จาก `dist/` จึงต้อง build ใหม่หลังดึงโค้ด การรีเฟรช browser อย่างเดียวไม่สร้างไฟล์ใหม่

เปิด `/new` → การ์ด **Start empty** เพื่อทดสอบโต๊ะทั่วไป (`kind=table`) จะพบช่อง **Message** ด้านล่าง แม้ AI ปิดและส่งไม่ได้ ส่วน Invoice / Physics / Encounter ใช้ assistant เดิม และ Node local ซ่อนช่องเดิมเมื่อ `model.enabled=false` รอบนี้ตรวจได้ 1 ช่องในโต๊ะทั่วไปและ 0 ช่องใน Physics บน `5e69816` ยังไม่ทราบ branch/ชนิดโต๊ะที่เครื่องทีมเปิด จึงระบุสาเหตุเฉพาะเครื่องนั้นไม่ได้ แต่ไม่พบว่างานแชทถูก merge ทับ

เมื่ออยู่บน branch ที่ต้องการแล้ว ให้รัน `npm ci` → `npm run build` → `npm start` การใส่ key ใน `.env` ไม่ได้เปิด AI ให้ Node อัตโนมัติ ถ้าจะทดสอบ AI จริงให้ใช้ staging หรือ Workers local ตาม [Local development](LOCAL_DEVELOPMENT.md) เก็บ secrets และค่าฐานจริงออกจาก Git

## งานทีมและสิ่งที่แก้ตอนรวม

ตรวจ commits ของทีม 17 รายการในช่วงทำงานขนานกันแล้ว ทั้งหมดเป็นส่วนหนึ่งของประวัติ `v2.0.0` การคงประวัติไม่ได้หมายความว่าทุก implementation คงเดิม: แชท island ถูกแทนสำหรับโต๊ะทั่วไปตาม F006 ที่ผู้ใช้อนุมัติ โดยไม่ลบเครดิตหรือเขียนประวัติทีมทับ

| งานที่ทีมส่งมา | สิ่งที่คงไว้ / ต่อหรือแก้ตอนรวม |
| --- | --- |
| แผน F001–F004, กระดานงาน และ release notes `v1.1.0` | คงเอกสารและประวัติ; F003 ลิงก์เชิญใช้ซ้ำ/เอาสมาชิกออกยังเป็นแผน ไม่ใช่ฟีเจอร์ที่ส่งแล้ว |
| ESLint/pre-commit, React hooks และ server แยกต่อ browser scenario | คง safeguards และชุดตรวจเดิม; ปรับ browser flows ให้ตาม UI ปัจจุบันโดยไม่ข้าม hook หรือ force-click |
| URL แต่ละหน้าและหน้าเริ่ม `/new` | คง reload, back/forward และ sign-in return; ข้อความเริ่มต้นเข้าสู่แชทใหม่โดยยังไม่เรียก AI ก่อนยินยอม |
| แชท island / ย่อเมื่อว่าง (#28) | แก้ทางเปิดจาก Canvas ในรอบ F005; F006 ใช้แชทด้านล่างแทนในโต๊ะทั่วไป โค้ด `TableAssistant` เดิมไม่ได้ต่อกับหน้าโต๊ะปัจจุบัน |
| ตั้งชื่อโต๊ะ (#29) | คงสิทธิ์เจ้าของและการแสดงชื่อสด; รักษาชื่อที่คนตั้งไว้เมื่อ AI แก้กฎและเมื่อสมาชิก/เจ้าของรีโหลด |
| component แชท, การต่อขั้นแรก และช่องห้าบรรทัด (#30) | ต่อข้อความ/ไฟล์ → ร่าง → ทดลองส่วนตัว → review/เปิดใช้ → แก้กฎ; การ์ดคำตอบส่วนตัวและ Confirm action; consent ตรง payload, retry body เดิม และกู้ร่างหลัง refresh ล้มโดยไม่เรียก AI อีก |
| ตำแหน่งการ์ดร่วมและ initial layout (#31) | seed การ์ดที่เกิดภายหลัง/กลับมาใหม่, ส่ง moves ตามคิว, แยก table/epoch/actor, เก็บ Rules ก่อนเปิดใช้เป็นส่วนตัว และไม่ให้ผลตอบรับโต๊ะเก่าทับโต๊ะใหม่; บันทึก layout ไม่ล็อกแชทหรือปลด busy ของคำสั่งเล่น |

## หลักฐานรุ่นรวม

[CIก่อนmerge5e69816](https://github.com/Thanyers/tabletop/actions/runs/39435691102) และ [CIบนmaind93620d](https://github.com/Thanyers/tabletop/actions/runs/39439056507) ผ่าน Node22.23.2: unit376, Cloudflare71, Node browser7, Worker browser25, generated4เรื่อง/8checks, build/dry-run/scans; lint0errors/101warningsเดิม

รอบhostedใช้สองGoogle sessionsจริงบนstaging: คาเฟ่เริ่มจากข้อความ → ทดลองร่าง → เปิดใช้ → เล่น3/8 → เพิ่มRemaining0 → ชื่อ/ลากร่วม/แชทส่วนตัว/resume; เกมแบ่งน้ำแนบไฟล์ใหม่ → AIสร้างกฎ → สองบัญชีผลัดเทิร์นจบ65/20/15รวม100 → ปิดและกลับมา ทั้งสองห้องผ่านการพักwrites/AIแล้วเปิดคืน

บั๊กที่พบ: previewของformadvanceTurnล็อกsubmitก่อนส่งจริง แก้ให้visualspreviewแยกจากcommittedpermissions/bindingsและเพิ่มfail-closedguard; ทดสอบRED/GREENและreviewอิสระก่อนปล่อย ดู[ผลตรวจรุ่น2.0](RELEASE_2_0_ACCEPTANCE.md)สำหรับSHAแต่ละขั้นและSKIPPED ไม่อ้างว่าทุกขั้นhostedเล่นซ้ำบนcommitสุดท้าย

หลักฐานAIจริงในเครื่องรอบก่อนยังคงอยู่ใน[F006acceptance](features/F006-chat-first-table.md#ผลตรวจรุ่นรวม) ไม่ปนกับhostedสองบัญชีรอบนี้

## สิ่งที่ต้องตัดสินใจก่อนส่งรุ่นนี้

**ปิดการตัดสินใจของreleaseแล้ว:** ผู้ใช้อนุมัติ2.0.0, hostedสองบัญชี, main merge/tag และproduction; ไม่ต้องเลือกhosting/modelหรือเพิ่มkeysเพื่อเล่นรุ่นนี้

งานต่อที่ยังแยกจากrelease:

1. **งานใหม่ของทีม:** #34 แชร์ไฟล์ให้สมาชิก, #35 การ์ดเริ่มโต๊ะว่าง และ #37 live cursors ยังเป็น draft แยกจาก 2.0.0 ต้องตรวจ contract/สิทธิ์และ regression ก่อนรวม โดยเฉพาะ #34 เพราะ raw source ของ 2.0.0 ยังเป็นของเจ้าของ
2. **ก่อนbetaกว้าง:** โทรศัพท์/สองอุปกรณ์จริง, accessibilityทั้งชุด, concurrency/DOduration และกู้D1+Room+Billingให้ตรงกัน การพักwritesที่ซ้อมไม่แทนbackuprestore
3. **ความต่อเนื่องระยะยาว:** retention/export/delete และการถึง500assistantjobsต่อห้อง ปัจจุบันค้นบริบทจำกัดจาก100รายการล่าสุด เลือกได้ถึง6exchanges ยังไม่มีsummaryระยะยาวอัตโนมัติ
4. **คำสั่งภาษาธรรมชาติ:** จับคู่actionให้ดีขึ้นโดยคงhumanconfirmation/role/turn/revision ไม่เล่นหลายตาแทนผู้ใช้โดยปริยาย

รายการนี้เป็นงานแนะนำ ไม่ใช่ขยายscopeproductionโดยอัตโนมัติ

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
- **ความเป็นส่วนตัว:** source files สมาชิกทุกคนอ่านและเพิ่มได้ (เจ้าของเท่านั้นลบ), draft rules เป็นของเจ้าของ, conversation เป็นของผู้ถาม, active rules/records เป็นข้อมูลร่วม อย่าส่ง private content เพิ่มเพียงเพื่อจัดหน้า UI

D1 และ Room DO ไม่ได้อยู่ใน transaction เดียวกัน การ sync directory ใช้ ordered outbox; WebSocket ส่ง authorized snapshots และ resync เมื่อ reconnect จึงอย่าตั้งสมมติฐานว่า event จะถูกส่งครั้งเดียวเสมอ รายละเอียด auth และ projection อยู่ใน [R1 architecture](R1_ARCHITECTURE.md); contract และข้อจำกัดของ table อยู่ใน [Generic table design](GENERIC_TABLE_DESIGN.md)

## หลักฐานรุ่นก่อนหน้า

- [หลักฐาน UI ก่อนรอบนี้](PUBLIC_WELCOME_ACCEPTANCE.md) อ้าง source `9fbfdec`; staging และ production ใช้ source/build ชุดเดียวกันและไฟล์เว็บ 131 ไฟล์ตรงกับ build เป็นผลของรอบนั้น ส่วน source ที่กำลังให้บริการให้ยึด [DEPLOYMENTS](DEPLOYMENTS.md) และตารางด้านบน
- [CI ของรอบนั้น](https://github.com/Thanyers/tabletop/actions/runs/39368620190) ผ่าน unit/SQL, Cloudflare, Component Lab, browser checks, build และ public/secret scans; fixture ใน CI ไม่ได้เรียก Google หรือ AI provider จริง
- รอบนั้นตรวจข้อความใหม่และเปิดตัวอย่างเดิมครบทั้งสอง environment พร้อมกลับเข้า River Race บน staging และ Encounter บน production แบบอ่านอย่างเดียว ข้อมูลและกฎเดิมยังอยู่; การเล่น River Race ด้วย Google สองบัญชีจริงเป็นหลักฐานที่เก่ากว่า ไม่ใช่การตรวจ hosted build Generative ใหม่
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

deploy ทำโดย pipeline หลัง merge release เท่านั้น (AI merge เองได้ตาม [AGENTS.md §8](../AGENTS.md#8-ขอบเขตของ-ai)) (ดูหัวข้อถัดไป) อย่าใส่ secret, account/session evidence หรือ operator receipts ใน Git; หลักฐานที่ระบุตัวตนและ runtime config อยู่ใน ignored local `test-results/` และต้องส่งต่อโดยเจ้าของระบบ

## Deploy อัตโนมัติ (CD001)

merge PR `release/X.Y.Z` (หรือ `hotfix/X.Y.Z`) เข้า `main` แล้ว [`release-deploy.yml`](../.github/workflows/release-deploy.yml) ทำต่อเองจนจบ:

1. รอ check `local-validation` ของ merge commit บน `main` ผ่าน (`workflow_run`)
2. อ่านเลขจากชื่อ branch ใน merge commit และตรวจว่ามี `## X.Y.Z` ใน `CHANGELOG.md`
3. ตรวจ secret/variable ครบ และตรวจ config ทั้งสอง environment (ชื่อ Worker, `PUBLIC_ORIGIN`, D1 ID ไม่ใช่ placeholder, `/version` อยู่ใน `run_worker_first`)
4. สร้าง annotated tag `vX.Y.Z` บน merge commit (ถ้ามีอยู่แล้วต้องชี้ commit เดียวกัน)
5. build ครั้งเดียวจาก tag และตรวจ `dist/version.json`
6. staging: บันทึก D1 Time Travel bookmark → migration ที่ค้าง → deploy → smoke
7. production: ทำซ้ำด้วยไฟล์ build ชุดเดียวกัน → smoke
8. ล้มขั้นไหนก็หยุด เปิด issue "Deploy failed" และไม่ rollback อัตโนมัติ

### ตั้งค่าครั้งแรก (admin ของ repo + เจ้าของบัญชี Cloudflare)

1. สร้าง Cloudflare API token ที่ dashboard → My Profile → API Tokens ใช้สิทธิ์ระดับบัญชีเท่าที่จำเป็น: **Workers Scripts: Edit**, **D1: Edit**, **Account Settings: Read** และจำกัดเฉพาะบัญชีนี้
2. เตรียม config จริงของแต่ละ environment เป็น **JSON ล้วน ไม่มีคอมเมนต์** โดยเริ่มจาก `wrangler.jsonc` แล้วแก้ `name`, `vars.PUBLIC_ORIGIN`, เพดาน AI, `d1_databases[0].database_name` / `database_id` ให้ตรงกับ environment นั้น (ดูชื่อใน [DEPLOYMENTS](DEPLOYMENTS.md)) · `$schema` ลบออกได้ · **ลบ `limits` ออก** เพราะบัญชีนี้ใช้ Workers Free ซึ่งไม่รับ CPU limits (pipeline ตรวจให้) · path อย่าง `main` และ `assets.directory` ใช้แบบ relative เหมือนเดิม
3. ใส่ค่าใน GitHub (รันเองบนเครื่องผู้ดูแล อย่าวางค่าในแชทหรือไฟล์ที่ track):
   ```bash
   gh secret set CLOUDFLARE_API_TOKEN -R Thanyers/tabletop
   gh secret set CLOUDFLARE_ACCOUNT_ID -R Thanyers/tabletop
   gh secret set WRANGLER_CONFIG_STAGING -R Thanyers/tabletop < path/to/staging.json
   gh secret set WRANGLER_CONFIG_PRODUCTION -R Thanyers/tabletop < path/to/production.json
   gh variable set STAGING_URL -R Thanyers/tabletop --body https://tabletop-staging.ptchrr.workers.dev
   gh variable set PRODUCTION_URL -R Thanyers/tabletop --body https://tabletop.ptchrr.workers.dev
   ```
   ชื่อ Worker ค่าเริ่มต้นคือ `tabletop-staging` / `tabletop` เปลี่ยนได้ด้วย variable `STAGING_WORKER` / `PRODUCTION_WORKER`
4. Worker secrets (`GOOGLE_OAUTH_*`, `DEEPSEEK_KEY`, `TABLETOP_ADMIN_EMAIL`) อยู่บน Cloudflare อยู่แล้ว pipeline ไม่แตะ
5. workflow ที่ทำงานกับ `workflow_run` อ่านไฟล์จาก default branch (`main`) จึงเริ่มทำงานตั้งแต่ release ถัดไปหลัง CD001 เข้า `main`

### เมื่อ deploy ล้ม

- เปิด issue "Deploy failed" ที่ pipeline สร้าง ดูขั้นที่ล้มและลิงก์ run
- **ล้มก่อน production deploy:** production ยังเป็นรุ่นเดิม แก้แล้วรัน Actions → **Release deploy** → Run workflow ใส่ SHA ของ merge commit เดิม
- **ล้มหลัง production deploy (smoke ไม่ผ่าน):** ตัดสินใจว่าจะออก hotfix หรือ `npx wrangler rollback` ด้วยมือ · ห้าม rollback ไป writer ที่อ่านข้อมูลรุ่นใหม่ไม่ได้ (ดู Recovery ใน [DEPLOYMENTS](DEPLOYMENTS.md))
- **migration ทำข้อมูลเสียหาย:** ใช้ bookmark ใน summary ของ run: `npx wrangler d1 time-travel restore <database_name> --bookmark <bookmark>` (เป็นการเขียนฐาน ต้องขออนุมัติตาม [ส่งรุ่นใหม่และกู้คืน](#ส่งรุ่นใหม่และกู้คืน))
- บันทึกเวลาที่ล้ม (`job_started_at` ใน issue) และเวลาที่แก้ลง `MEMORY.md` → Deploy failures
