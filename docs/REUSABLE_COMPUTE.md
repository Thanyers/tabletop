# Reusable compute — วิธีคำนวณที่เป็นของโต๊ะ

เอกสารนี้เป็น contract ของ reusable compute สถานะ implementation และผลตรวจอยู่ใน [F066](features/F066-reusable-compute-rules.md) และ [spec.md](../spec.md) ผลตรวจ production ของรุ่น 9.0.0 อยู่ใน [Release 9 results](testing/f066-post-deploy/RELEASE9_RESULTS_TH.md); รุ่นที่กำลังให้บริการดู [Deployments](DEPLOYMENTS.md)

## แนวคิดและการใช้งาน

Rules คือความสามารถของโต๊ะ หนึ่งโปรแกรมอาจมี helper หลายฟังก์ชัน ให้ผลหลายอย่าง และเลี้ยงหลายการ์ด จำนวนสคริปต์จึงไม่ใช่จำนวนกฎ ผู้ใช้บอกงาน เช่น “ทำความสะอาดข้อมูล รวมยอดรายสาขา แล้วแสดงกราฟ” AI เตรียมวิธีทำงานครั้งแรก เมื่อเปิดใช้แล้วข้อมูลใหม่เรียกโปรแกรมเดิม ไม่เรียก AI เพื่อคำนวณแต่ละครั้ง

Rules แสดงชื่อ วัตถุประสงค์ ข้อมูลที่ใช้ ชนิดข้อมูล ผลลัพธ์ สถานะ และผู้รัน ปุ่ม **Ask** และ **Change this rule** เลือกกฎเฉพาะข้อเข้าแชทได้; **Advanced** แสดงภาษา รุ่น bindings และ source ผู้ไม่มีสิทธิ์ร่างกฎถามได้ แต่แก้หรือเปิด source ผ่าน UI ไม่ได้ การซ่อน source บน UI ไม่ใช่ขอบเขตความลับระหว่างสมาชิก: room projection ยังใช้ visibility policy ของโต๊ะ

การนำเข้าแถวในตารางรองรับ CSV และแผ่นแรกของ Excel (`.xlsx`) แสดง preview ก่อนส่ง **Append** เป็นค่าเริ่มต้น; **Replace** ต้องยืนยันและแทนเฉพาะแถวของ collection ที่เลือกแบบ atomic ตารางที่รับผลคำนวณไม่รับการ import ตรง แก้ที่ข้อมูลต้นทางแล้วคำนวณใหม่

ถ้ากฎหรือ controls อ้างแถวแบบเจาะจง หน้า Replace ให้เลือก **Keep linked rows matched by** และแสดงฟิลด์จับคู่ก่อนยืนยัน ค่าของฟิลด์ต้องเป็นข้อความที่ไม่ว่างและไม่ซ้ำทั้งข้อมูลเก่าและใหม่ รายการที่ตรงกันเก็บ row ID เดิมแม้สลับลำดับ; รายการใหม่ได้ ID ใหม่ ถ้าขาดรายการที่กฎยังอ้าง หรือการจับคู่กำกวม จะปฏิเสธทั้งชุดโดยไม่เปลี่ยนข้อมูลหรือ revision ไม่จับคู่ตามตำแหน่งแถว ส่วน Append ยังเพิ่มแถวได้ตามเดิม

คำสั่ง `table.importRows` เพิ่ม optional `identityField` เฉพาะ `mode:'replace'` ตรวจสิทธิ์/ฟิลด์/ชนิด/ความไม่ซ้ำที่ authority และตรวจ references ทั้ง actions กับ canvas ก่อน commit เมื่อไม่มี fixed references การแทนที่โดยไม่ส่งฟิลด์นี้ยังใช้พฤติกรรมเดิม ไม่มีการเปลี่ยน schema ฐานข้อมูล

Ask รายกฎที่ถามว่า “กฎนี้รับอะไรและเปลี่ยนผลตรงไหน” เป็นคำถามอ่านอย่างเดียว; Change this rule และคำสั่งแก้ที่ระบุชัดยังเปิดโหมดร่าง คำถามความพร้อมของ library แบบมีเงื่อนไขอ่าน runtime profile โดยตรง และคำสั่งห้ามติดตั้งไม่กลบคำสั่งสร้างงานที่ตามมา โต๊ะที่ไม่มีไฟล์ใช้ `evidence:[]`; ตาราง ข้อมูล library และ research links ไม่ถือเป็นไฟล์หลักฐาน ตัวตรวจยังปฏิเสธ source ที่ไม่มีจริง

## เลือกวิธีประมวลผล

| งาน | ตัวประมวลผล |
| --- | --- |
| คณิตศาสตร์ เงื่อนไข aggregate/map/filter/reduce ที่ contract เดิมทำได้ | bounded expression หรือสูตรเดิม |
| อัลกอริทึมเล็ก กฎเกม การแปลงข้อมูลที่ใช้ standard library | JavaScript ใน isolate |
| ทำความสะอาดหลายขั้น join/groupby สถิติ หรือเตรียม workbook | Python ใน container |

Prompt ใช้ operations, dependencies และภาระงานประกอบการเลือก ไม่ตัดสินจากจำนวนแถวอย่างเดียว และเลือกได้เฉพาะ `computeCapabilities` ที่ host เปิดจริง ไม่อ้างว่ารองรับภาษา/แพ็กเกจอื่น ไม่ติดตั้งแพ็กเกจตอนรัน

Host ส่ง engine/profile/libraries ที่เปิดอยู่ผ่าน `/api/capabilities` และใช้ข้อมูลชุดเดียวกันประกอบคำขอร่างกฎกับการนับ AI context ก่อนส่ง ส่วน research, repair และ context ของ card/rule references ที่ server ขยายเพิ่มภายหลังไม่รวมในตัวเลขก่อนส่ง; backend ตรวจเพดานคำขอรวมอีกครั้งเสมอ

Profile `tabletop-compute-1` เตรียม Python 3.12, pandas 2.3.3, numpy 2.3.4, scipy 1.16.3, openpyxl 3.1.5 และ python-dateutil 2.9.0.post0 ไว้ใน image ที่ pin base digest และ dependency versions การเปลี่ยน profile ต้องรักษา lineage ของนิยามและผลเดิม

## Contract และการเชื่อมการ์ด

- `TableProgram.compute = {version:1, modules:[...]}` เก็บชื่อ คำอธิบาย ภาษา source รุ่น และ typed input/output ports รุ่นต้องเพิ่มเมื่อพฤติกรรมหรือสัญญา ports เปลี่ยน
- Input ผูกกับ literal, collection, source, ผลของ module อื่น, actor role/seat หรือ provenance ที่ประกาศไว้ host เป็นผู้ resolve ข้อมูล; generated code ไม่มีอำนาจอ่านห้องเอง
- JavaScript export `default function compute(inputs)`; Python มี `def compute(inputs)` คืน object ที่ key ตรง output IDs ค่าต้องเป็น finite JSON ตามชนิดที่ประกาศ ตารางคืน `{columns,rows}`
- `computeResult` อ่าน scalar output ใน metric/สูตรของ canvas; table output ผูก collection เพื่อแสดงบนตาราง/กราฟหรือส่งต่อ module อื่น ใช้ DAG รวมทั้ง direct output และ collection dependencies ปฏิเสธวงจรและผู้เขียนตารางซ้ำ
- ผลเป็น derived overlay ไม่เขียนทับ `records` ต้นทาง ตรวจชนิด schema และ required/range/choice constraints ของตารางปลายทางด้วย ผู้ใช้กด action แก้ derived rows ตรงไม่ได้
- ผลต้องตรง module version, runtime profile, data/rule revisions และ upstream run ที่ยังใช้ได้ ถ้าข้อมูลเปลี่ยนขณะรัน ผลนั้นเป็น stale การ์ดผลเก่าระบุว่าเป็นผลก่อนหน้า; ผู้ใช้ไม่ควรเห็นผลเก่าเป็นค่าปัจจุบัน

## ห้อง บัญชี และ execution session

นิยาม ข้อมูล และ `computeRuns` อยู่ใน JSON ของ Room/Node repository เดิม ไม่เพิ่ม SQL table หรือ migration browser session เก็บเพียงการมองและการเลือก; การเปิดห้องอีกครั้งอ่านนิยามกับผลจาก authority

หนึ่ง execution เป็น stateless isolate/container ใหม่ ไม่เก็บตัวแปรหรือไฟล์ใช้ร่วมกับรอบถัดไป run record เก็บ ID, module version/profile, actor/role/seat, สถานะ, เวลา, input hash, revisions, source IDs และ upstream run IDs การอัปโหลดไฟล์และการแก้ raw collection มี provenance ผู้เขียนล่าสุดจากคำสั่งจริง ถ้าข้อมูลเก่าไม่มีที่มา แสดงว่าไม่ทราบ ไม่สร้างชื่อผู้เขียนขึ้นมา

Authority เป็นผู้จัดคิว `queued → running → succeeded/failed/stale` และตรวจสมาชิก สิทธิ์ epoch และความสดก่อนและหลังรัน Client ส่งได้เพียง `table.compute.run {moduleId}` ส่ง queue/update หรือปลอมผลเองไม่ได้ การเปลี่ยนข้อมูล/เปิดห้องกลับมาจัดงานที่ต้องรันตาม dependency; Cloudflare ใช้ `waitUntil` และ alarm สำหรับ recovery งาน interrupted ต้อง resolve และตรวจ input ใหม่ก่อน retry

คำขอต้องผ่าน web-session authentication ตอนรับ แต่เมื่อรับแล้ว job เป็นของโต๊ะและ actor ไม่ผูกอายุ cookie: ปิดแท็บ, session หมดอายุ หรือ revoke web session ไม่ยกเลิกงานที่รับแล้ว การถอนสมาชิก/สิทธิ์ หรือเปลี่ยน epoch หยุดสิทธิ์รันและ commit ไม่มีการเก็บ session token หรือ token hash ใน run record; alarm จึงใช้กติกาเดียวกับการรันปกติ

รันอัตโนมัติเริ่มในบริบทเจ้าของ ถ้า module รับ actor role/seat ให้ใช้ผู้ขอรันล่าสุดต่อไปและตรวจสิทธิ์สมาชิกใหม่ ห้ามแทนด้วยบริบทเจ้าของทันทีหลังสมาชิกกดรัน ถ้าสมาชิกนั้นไม่มีสิทธิ์แล้วไม่แทนตัวผู้รันโดยเงียบ

ประวัติ bounded 24 รายการ เก็บงานที่ยังไม่จบไว้ และ trim เฉพาะ terminal history ปฏิเสธการขอซ้ำระหว่าง module เดียวกันยังทำอยู่ ไม่ใช่ durable job queue หรือ audit archive แบบไม่จำกัด

## ขอบเขต execution

| ส่วน | ขอบเขต |
| --- | --- |
| นิยาม | สูงสุด 12 modules, 8 inputs/outputs ต่อ module, source 24 KiB ต่อ module |
| ข้อมูล | input/output ต่อรอบ 64 KiB; ตารางผลไม่เกิน 500 แถว/32 columns; wire transport 512 KiB |
| JavaScript | fresh Worker Loader isolate, ไม่มี app bindings/secrets, ปิด outbound network, subrequests 0, hosted CPU 1,000 ms และ wall 30 วินาที |
| JavaScript ใน Node local | workerd/Miniflare แยกต่อรอบ; hard wall 2 วินาที เพราะ local runtime ไม่บังคับ hosted CPU limit แบบเดียวกัน |
| Python ใน Node local | Docker ไม่มี host mount/host env, network none, read-only root, user 10001, 512 MiB/1 CPU/32 processes และ temporary filesystem |
| Python ใน Cloudflare | Room-managed container image `compute`, resources `standard-1` (4 GiB/0.5 vCPU), ปิดอินเทอร์เน็ต, user 10001, serialize ต่อห้อง, ทำลาย container ก่อน/หลังรัน, wall 30 วินาที |

Generated code ไม่ได้รับ DB, cookie, credential หรือสิทธิ์ commit ห้อง Python stdout/stderr ปกติถูกทิ้ง; คืนเพียง typed result ที่ตรวจแล้ว Failure ไม่แก้ข้อมูลต้นทางและไม่อ้างว่าคำนวณสำเร็จ Source/ผลยังต้องผ่าน review ความหมายของงาน: schema-valid ไม่ใช่หลักฐานว่าตรรกะธุรกิจถูกทุกกรณี

## ตั้งเครื่องและเตรียม release

Node local ใช้ Docker Desktop ที่กำลังทำงาน และ build image ครั้งแรกจาก root ของ repo:

```powershell
docker build --tag tabletop-compute:1 compute
$env:TABLETOP_COMPUTE_DOCKER_TEST='1'
npx vitest run server/compute-python.integration.test.ts
```

Cloudflare config ปกติประกาศ `worker_loaders` binding `COMPUTE_LOADER` สำหรับ JavaScript Python เป็น opt-in: รัน `node scripts/compute-config.mjs` เพื่อสร้าง config ทดสอบที่ไม่ track ใน `test-results/compute-config/wrangler.json` จากนั้นตรวจด้วย `wrangler deploy --dry-run --config ...` ได้โดยไม่ deploy

Pipeline เตรียม compute ผ่าน `server/compute-deploy-config.ts` หลังตรวจ private config ของ environment: เพิ่ม `worker_loaders.COMPUTE_LOADER`, `TABLE_COMPUTE_PYTHON="enabled"` และ Room `containers` แบบ `scheduling_policy:"durable_object"` พร้อม named image `images.compute.dockerfile` โดยไม่เปลี่ยนชื่อ Worker, origin, D1, budget หรือ credentials ตรวจ identity ซ้ำก่อน deploy และ smoke บังคับให้ประกาศทั้งสอง engine/profile/libraries ครบ

บัญชีต้องเปิด Workers Paid และ deploy token ต้องมีสิทธิ์ Containers/registry ที่จำเป็น ผู้ใช้อนุญาตเปิด Paid ในรอบ F066-T8 แล้ว; การมี flag ไม่ยืนยัน image provisioning หรือ execution ต้องรอ pipeline และ synthetic hosted run จริง ห้ามย้าย credentials ลง repo

ชุดเต็ม CI ใช้ `node scripts/compute-cloudflare-local.mjs` บน Linux เพื่อรัน Worker Loader และ Room-managed Container API กับข้อมูลสมมติ โดยไม่มี credentials; บน Windows คำสั่งนี้รายงาน SKIPPED/exit 2 เพราะ Wrangler ไม่รองรับ Containers local ใช้ Docker integration ของ Node ตรวจเครื่อง Windows แยกกัน

ไม่มี SQL migration แต่เป็น contract ใหม่และเพิ่ม runtime/bindings หลังห้องบันทึก `compute` แล้วต้องใช้ writer ที่อ่าน contract นี้ได้ พักการเขียนก่อน recovery ด้วย build เก่า ห้ามสรุปว่า rollback ทันทีได้เพียงเพราะ fields เป็น optional

## แผนที่ source และหลักฐาน

| เรื่อง | เจ้าของ |
| --- | --- |
| Schema, DAG, freshness, typed ports | `src/tabletop/shared/table-compute.ts` |
| Domain queue/result validation | `src/tabletop/domain/table.ts` |
| Scheduling, provenance, recovery | `server/table-compute-orchestrator.ts`, `server/authority.ts`, `cloudflare/room.ts` |
| Engines และ image | `server/compute-runner.ts`, `server/local-compute-isolate.ts`, `cloudflare/compute-runner.ts`, `compute/Dockerfile` |
| Prompt และ capabilities | `shared/compute-runtime-profiles.ts` ภายใต้ `src/tabletop`, `server/providers/table-schema-guide.ts`, `cloudflare/ai.ts` |
| Rule references ที่ server resolve | `src/tabletop/shared/table-rule-reference.ts` |
| Rules/compute/linked cards | `TableCanvasObjects.tsx`, `TableComputeModuleCard.tsx`, `RuleChatActions.tsx` ภายใต้ `src/tabletop/ui` |
| Synthetic real-provider proof | `scripts/compute-live-local.mjs` (opt-in existing ignored credentials), `scripts/compute-runtime-local.mjs` |
| UI harness | `tests/ui/f066-rules.*`; ผลและภาพอยู่ใน ignored `test-results/` |
