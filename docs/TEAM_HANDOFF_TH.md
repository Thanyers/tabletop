# ส่งมอบ Tabletop ให้ทีมวิศวกรรม

สำหรับทีมที่รับช่วงพัฒนา: อ่าน [product.md](../product.md) เมื่อจำเป็นต้องเข้าใจเหตุผล ผู้ใช้ และขอบเขตผลิตภัณฑ์ จากนั้นเริ่มที่ [สถานะ deployment ล่าสุด](DEPLOYMENTS.md) เพื่อยืนยัน source และ environment ใช้ [CONTRIBUTING](../CONTRIBUTING.md) ตั้งเครื่องและรันในเครื่อง แล้วเปิดเอกสาร design/acceptance ที่ตรงกับส่วนที่จะแก้

## สถานะและลำดับงาน

รุ่นที่บันทึกว่า deploy ล่าสุดคือ `v1.0.0` / `ce2c50e` เมื่อ 20 ตุลาคม 2026 ดู [DEPLOYMENTS](DEPLOYMENTS.md) สำหรับ source/build และหลักฐานของ staging/production โดยตรง

**รุ่นรวม `dev` อยู่ที่ `ce6d69b`**: F005 จาก [PR #24](https://github.com/Thanyers/tabletop/pull/24), การตั้งชื่อโต๊ะ F002 จาก [PR #29](https://github.com/Thanyers/tabletop/pull/29), แชท F006 จาก [PR #30](https://github.com/Thanyers/tabletop/pull/30) และตำแหน่งการ์ดร่วม F007 จาก [PR #31](https://github.com/Thanyers/tabletop/pull/31) merge แล้วและผ่าน CI หลัง merge สูตร/ภาพ ตัวควบคุม การลากใน scene ทดลองร่างส่วนตัว และการค้นบทสนทนาเก่าแบบจำกัดยังอยู่ครบ อ่าน [Generative runtime](GENERATIVE_CANVAS_RUNTIME.md) สำหรับ contract และ [spec.md](../spec.md) สำหรับสถานะระบบ

`main` เป็น release branch และเป็นหน้าที่ GitHub เปิดโดยปริยาย ประวัติ merge ชุดนี้อยู่บน `dev` จนกว่าจะผ่านขั้น release; #30 เป็น PR เดิมที่ทีมเปิดไว้แล้ว Codex รับช่วงต่อ ชื่อผู้เปิด PR จึงยังเป็นของทีม แต่ commits การรวมและแก้ไขอยู่ใน [ประวัติ #30](https://github.com/Thanyers/tabletop/pull/30/commits)

## เล่นรุ่นไหน ที่ไหน

ตรวจ public endpoints ล่าสุด **20 ตุลาคม 2026 เวลา 19:36 น. (Asia/Bangkok)** ด้วยการอ่านอย่างเดียว:

| ที่เล่น | รุ่น / สิ่งที่ตรวจแล้ว | วิธีเริ่ม |
| --- | --- | --- |
| [Production](https://tabletop.ptchrr.workers.dev/) | `1.0.0` / `ce2c50e`; version, health, readiness และ capabilities ตอบ 200, AI เปิด, โต๊ะไม่ถูกพักการแก้ไข | Google login → Start with your files → นำไฟล์ที่รองรับเข้า → ตรวจและเปิดใช้กฎ → เล่นบน Canvas → Invite; บัญชีเดิมกลับมาเปิดโต๊ะเดิมได้ |
| [Public demo](https://tabletop.ptchrr.workers.dev/demo) | เดโมที่เตรียมไว้ในรุ่น production; กดเล่นจริงซ้ำเวลา 19:44 น. ผ่านโต๊ะว่าง → เพิ่มการ์ด → เล่น/พัก → ลองเอง | ไม่ต้องล็อกอิน เลือกเรื่อง รอการ์ดปรากฏ แล้วกดพัก/ลองเอง |
| [Staging](https://tabletop-staging.ptchrr.workers.dev/) | ยังเป็น `1.0.0` / `ce2c50e`; endpoints ชุดเดียวกันตอบ 200 และ AI เปิด | ใช้ตรวจ hosted/OAuth; **ยังไม่ได้ลงรุ่นรวมใหม่** |
| `dev` ในเครื่อง | `ce6d69b`; Generative Canvas, แชทใหม่, ตั้งชื่อ และผังร่วมผ่านชุดทดสอบ local/CI | ตั้งเครื่องตาม [CONTRIBUTING](../CONTRIBUTING.md); Node local ปิด AI, ชุด Workers/Generative acceptance ใช้ provider และบัญชีจำลอง การใช้ AI จริงต้องมี config local ของ operator |

ผล endpoint บอกเวอร์ชันและความพร้อมของบริการ ณ เวลาตรวจ ไม่ใช่หลักฐานว่าได้เล่นสองบัญชีจริงหรือทดสอบ AI ใหม่บน Cloudflare ในรอบนี้ รายละเอียด production ยึด [DEPLOYMENTS](DEPLOYMENTS.md); การนำไฟล์ของโต๊ะทั่วไปกับ upload ของ Invoice เป็นคนละ capability

รอบ public demo ใช้ browser ใหม่โดยไม่มีบัญชี: เลือกทดลองแรงและมวล กดขั้นบน Canvas ให้การ์ดค่อย ๆ เกิด ตรวจว่า Play เดินต่อและ Pause หยุด จากนั้นรับช่วงเอง เปลี่ยน F=12 N, m=3 kg, t=2 s แล้วกด Update lesson ได้ระยะ 8 m ตามสูตร ไม่มี API request, cookie, WebSocket หรือ uncaught browser error จึงไม่มี paid AI call และไม่แก้ห้องจริง หลักฐานนี้ครอบคลุมเดโมที่เตรียมไว้ ไม่ใช่การสร้างกฎใหม่ด้วย AI หรือ multiplayer บน hosted build ใหม่

## งานทีมและสิ่งที่แก้ตอนรวม

ตรวจ commits ของทีม 17 รายการในช่วงทำงานขนานกันแล้ว ทั้งหมดเป็นส่วนหนึ่งของประวัติ `ce6d69b` การคงประวัติไม่ได้หมายความว่าทุก implementation คงเดิม: แชท island ถูกแทนสำหรับโต๊ะทั่วไปตาม F006 ที่ผู้ใช้อนุมัติ โดยไม่ลบเครดิตหรือเขียนประวัติทีมทับ

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

ทั้ง [CI ก่อน merge ของ `665ef56`](https://github.com/Thanyers/tabletop/actions/runs/39420499206) และ [CI หลัง merge ของ `ce6d69b`](https://github.com/Thanyers/tabletop/actions/runs/39421576811) ผ่านทุกขั้นบน Node `22.23.2`; tree หลัง merge ตรงกับ candidate ที่ตรวจแล้ว

| การตรวจ | ผล |
| --- | --- |
| Unit / local SQL | 376/376 |
| Workers / D1 / Room / Billing | 71/71 |
| Node browser | 7/7; ไม่มี uncaught errors |
| Worker multiplayer / แชท / สิทธิ์ / recovery | 25/25; ไม่มี uncaught errors |
| Generated Canvas | cafe, shadow, water และโจทย์คำนวณใหม่ ผ่าน private trial, actual button/slider/scene drag, เพิ่มการ์ดหลังแก้กฎ, shared layout และ reload; 8 intercepted provider calls, ไม่มี browser errors หรือ external requests |
| Build / Worker dry-run / secret scans / dependency audit | ผ่าน; lint 0 errors และ warnings เดิม 101 รายการ |

**AI จริง:** ใช้แอป `97ecd98` ก่อนรวม F007 ไม่เกิน 6 คำขอรวมสามเรื่อง: cafe คำนวณ 3 → 8 และเพิ่มการ์ดโดยเก็บงานเดิม, shadow ตรวจเรขาคณิตแยกได้ 80 → 70 พร้อม pointer drag, water สองบัญชีจำลองผลัดกันเล่นและรักษาน้ำรวม 100 หลัง reload ส่วนรุ่นรวมสุดท้ายใช้คำตอบ AI จำลองเพื่อทดสอบซ้ำ ผลนี้ไม่แทน Google สองบัญชีจริงบน hosted build ใหม่ ดู [F006 acceptance](features/F006-chat-first-table.md#ผลตรวจรุ่นรวม) สำหรับขอบเขตและไฟล์หลักฐาน local ที่ ignored

## สิ่งที่ต้องตัดสินใจก่อนส่งรุ่นนี้

1. **เคาะ release version:** เสนอ `2.0.0` ตามกฎ rollback ของ F005 เพราะห้องที่บันทึก expression/canvas ใหม่ต้องใช้ compatible writer; ยังไม่ได้อนุมัติเลขหรือสร้าง tag
2. **อนุมัติรอบ hosted ของรุ่นใหม่:** เตรียม release branch/PR ตาม [AGENTS](../AGENTS.md#5-ออก-release), ใช้ staging ก่อนแล้วตรวจ Google สองบัญชีจริง การเชิญ/เล่น/แก้กฎ/กลับมาเล่นต่อ และ recovery ก่อนส่ง build เดียวกันไป production
3. **ขอบเขตกลุ่มทดสอบ:** คง Workers Free และงบ AI เดิมได้สำหรับรอบเล็ก; ก่อนเปิด beta กว้างต้องปิดช่องว่างอุปกรณ์จริง, load และ recovery ด้านล่าง ไม่จำเป็นต้องย้าย hosting หรือเลือกโมเดลใหม่เพื่ออัปเดตเอกสารรอบนี้

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
- **ความเป็นส่วนตัว:** source files สมาชิกทุกคนอ่านได้ (เจ้าของเท่านั้นเพิ่ม/ลบ), draft rules เป็นของเจ้าของ, conversation เป็นของผู้ถาม, active rules/records เป็นข้อมูลร่วม อย่าส่ง private content เพิ่มเพียงเพื่อจัดหน้า UI

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

ไม่มี deploy step ใน CI อย่าใส่ secret, account/session evidence หรือ operator receipts ใน Git; หลักฐานที่ระบุตัวตนและ runtime config อยู่ใน ignored local `test-results/` และต้องส่งต่อโดยเจ้าของระบบ
