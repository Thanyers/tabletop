# F066 — วิธีทำงานที่เก็บไว้ใช้ซ้ำ และ Rules ที่แก้ได้บนโต๊ะ

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | Codex |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F066-T*` |

## ทำไม

ผู้ใช้ต้องสร้างวิธีทำงานจากเจตนา เช่น เตรียมข้อมูล Excel หลายขั้นตอน แล้วใช้วิธีเดิมกับข้อมูลชุดใหม่ได้โดยไม่เรียก AI ซ้ำ Rules จึงหมายถึงความสามารถของโต๊ะ หนึ่งโปรแกรมรองรับหลายกฎและหลายการ์ดได้ ไม่ผูกจำนวนกฎกับจำนวนไฟล์โค้ด

## สิ่งที่ผู้ใช้จะเห็น

1. Rules อธิบายว่างานทำอะไร ใช้ข้อมูลอะไร และได้ผลที่ไหน ด้วยชื่อและภาษาที่คนทำงานหรือเล่นเกมเข้าใจ
2. อ้างกฎเฉพาะข้อในแชทเพื่อขอแก้ได้ และเปิด Advanced เพื่อดูรายละเอียดโปรแกรม/สูตร
3. วิธีคำนวณเก็บเป็นรุ่นกับโต๊ะ เมื่อข้อมูลเปลี่ยนใช้โปรแกรมเดิมคำนวณใหม่ ผลเชื่อมกลับมาที่การ์ด
4. เปิดโต๊ะใหม่อีกครั้งยังเห็นนิยาม รุ่น ข้อมูลที่ใช้ และผล/สถานะการรัน ไม่ใช้ browser session เป็นแหล่งความจริง

## ขอบเขตและแบบที่เลือก

- ต่อจาก table runtime และ Room authority เดิม เก็บนิยามและประวัติในข้อมูลห้องโดยหลีกเลี่ยง persistent SQL schema change
- แยกโปรแกรมที่สร้างออกจากการ deploy แอป มี contract ข้อมูลเข้า/ออก รุ่น และขอบเขตทรัพยากร
- ตัวรันแยกจากสิทธิ์เขียนข้อมูลห้อง ผลต้องผ่านการตรวจและผูกกับ revision ต้นทางก่อนใช้ ไม่ให้ผลเก่าทับข้อมูลใหม่
- ใช้ Cloudflare isolated execution สำหรับ generated code; ทดสอบเส้นทางรันจริงเมื่อ runtime ในเครื่องรองรับ รายงานขอบเขต Python/pandas และ hosted provisioning ตามหลักฐาน
- สูตรและ actions เดิมยังใช้ได้ Rules แสดงภาพรวมร่วมกันและมี Advanced
- ไม่ release/deploy โดยอัตโนมัติจากงานนี้ ไม่เปลี่ยน production schema หรือ credential

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F066-T1 | contracts, persistent definitions/runs และ revision links | reload/reconnect, isolation, stale result และ permission tests |
| F066-T2 | isolated runner, generation/invocation และการคำนวณซ้ำ | ใช้โปรแกรมเดิมกับข้อมูลสองชุดโดยไม่เรียก AI ซ้ำ; failure ไม่ทำลายผลเดิม |
| F066-T3 | Rules card, Advanced, per-rule chat references | อ่านแบบ no-code, keyboard/mobile, specific reference ผ่าน server context |
| F066-T4 | integration, browser proof, independent review, เอกสาร | typecheck/lint/unit/Worker/build และ acceptance ที่เกี่ยวข้องผ่านจริง |
| F066-T5 | เทสต์ Rules capability หลังเพิ่ม compute | UI แสดงจำนวนตรงกับ endpoint และมี reusable calculations พร้อม gap ที่ยังมีจริง |
| F066-T6 | เตรียม post-deploy acceptance หลายกรณี | มี prompt/ขั้นตอน/input/expected/evidence และผลตั้งต้น NOT_RUN; ไม่รันทดสอบ hosted ในงานเตรียม |
| F066-T9 | รักษา default ช่องใหม่และปรับ deployment acceptance fixtures | domain25/25; generative4rooms/8calls, Workers35checks/37calls; รอ pipeline/hosted |
| F066-T8 | เปิด engines บน hosted แก้เคสไม่ผ่าน และ deploy/ทดสอบซ้ำ | pipeline เปิด runtime จริง, CSV ไม่บังคับค่าที่คำนวณ, คำถาม library ตอบตาม capability; multi-account BLOCKED |
| F066-T7 | ตรวจ JavaScript/Python และทดสอบหลัง release 8 | ยืนยันรุ่นจริง, actual/evidence และ PASS/FAIL/BLOCKED รายเคส; ไม่อ้าง readiness จาก capability flag อย่างเดียว |

## ติดตาม release 9

F066-T8 ทำผล acceptance ต่อใน `docs/F066-release9-acceptance` พร้อมนำ main กลับ dev: production **9.0.0 / 49f2dd7** deploy สำเร็จจาก [PR #249](https://github.com/Thanyers/tabletop/pull/249), [pipeline 39962089610](https://github.com/Thanyers/tabletop/actions/runs/39962089610) ประกาศ JS/Python profile `tabletop-compute-1` แล้ว การตรวจ production แบบล็อกอินและใช้ AI ยังอยู่ระหว่างดำเนินการ; staging rehearsals และ local controlled cases แยกจาก production PASS หลายบัญชี 8 เคสคง BLOCKED ตามผู้ใช้

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | ผู้ใช้อนุญาตเปิด Workers Paid และยอมรับค่าใช้บริการผ่าน checkout; pipeline เติม compute profile จากโค้ดหลังตรวจ private config | config ที่ GitHub secret เดิมยังไม่เปิด engines; คง identity/budget/credentials และตรวจ capability/execution แยกกัน |
| 2026-10-23 | ใช้ทิศทาง Rules = ความสามารถที่เก็บไว้ใช้ซ้ำ ตามที่เจ้าของสั่งให้ implement หลังคุย concept | ไม่ลด Rules เหลือสูตรคอลัมน์ และไม่ต้องขออนุมัติแนวคิดเดิมซ้ำ |
| 2026-10-23 | หนึ่งโปรแกรมรองรับหลายกฎ/การ์ด; execution session แยกจาก room และ browser session | รักษาการใช้ซ้ำ ความต่อเนื่อง และสิทธิ์ในโต๊ะ |
| 2026-10-23 | ตรวจ PR #205 (patch), #207 (research) ก่อนแก้; แยกไฟล์ใหม่และรักษา integration points | ลดการชนกับงานที่กำลังทำ ไม่ merge งานคนอื่นโดยปริยาย |
| 2026-10-23 | งานที่ authority รับแล้วอยู่กับ room+actor และอยู่ต่อหลัง cookie หมดอายุ/revoke | alarm/restart ใช้กติกาเดียวกัน; ตรวจ membership/permission/epoch ก่อนและหลังเสมอ ไม่เก็บ session credential ใน run |
| 2026-10-23 | ใช้ capability block เดียวกันใน endpoint, provider และ AI context meter หลังรวม F067 | ตัวเลขก่อนส่งนับ engine/profile/libraries ที่ host เปิดจริง; research/repair/reference context ที่เพิ่มบน server ตรวจเพดานซ้ำตอนส่ง |
| 2026-10-23 | ผู้ใช้ย้ำขอบเขตเฉพาะ compute/Rules; หยุดการไล่ scene/camera และคืนโค้ดทดลองทั้งหมด | แยกสถานะยังไม่ release ออกจาก browser failure ของส่วนอื่น ไม่ขยายงานของผู้ใช้ตามทุก failure ในชุดรวม |

## ผลตรวจ

รายละเอียด contract, ขอบเขต และ operator setup อยู่ใน [REUSABLE_COMPUTE](../REUSABLE_COMPUTE.md)

### F066-T8 — candidate เปิด runtime และแก้ผลไม่ผ่าน

ผู้ใช้อนุญาต deploy และให้คงหลายบัญชีเป็น BLOCKED เปิด Workers Paid ผ่าน checkout ตามการยืนยันของผู้ใช้แล้ว API Containers อ่านได้ แต่ยังไม่มี container application ก่อน deploy

Node 22.23.2: deployment profile/smoke regression **8/8** ผ่าน; Python image dry-run build ผ่าน ไม่ deploy จากเครื่อง ชุดเต็ม CI [run 39932319011](https://github.com/Thanyers/tabletop/actions/runs/39932319011) fast-checks ผ่านพร้อม Linux Worker Loader/Container API **2 checks / 4 executions**: JavaScript 10→42 และ Python ใช้ pandas/numpy/scipy/openpyxl/dateutil 10→42 ไม่มี credentials ใน fixture ผลนี้เป็น emulator ไม่ใช่ hosted acceptance รอบก่อนจับ `Invalid container instance type` จาก `basic` จึงเปลี่ยนเป็น `standard-1` แล้วผ่าน

PD005: เพิ่ม `TableProgram.computedColumns` สำหรับสูตร numeric AST ของกฎ; CSV รับเฉพาะ stored fields ส่วนสูตรคำนวณใน projection จาก authority ชุดเดียวกับ F055 การ promote field เดิมใช้ ID/collection เดิมและค่าที่เก็บไว้ต้องตรงสูตร ตรวจ candidate ทั้งก้อนจึงแก้ metric/invariant ที่อ้าง total เดิมพร้อมกันได้ ไม่ยอมลบ field อื่นหรือทับค่าประวัติ ย้อนกลับไป stored field ได้เมื่อค่าที่เก็บไว้ยังตรงสูตรปัจจุบันเท่านั้น; guard ป้องกัน default กลบค่าที่หาย สูตรเพิ่มเองแยกจากสูตรใน program เพื่อไม่ให้ rollback ฟื้นสูตรที่ถูกยกเลิก ตัวแก้ตารางแสดงสูตรจากกฎอ่านอย่างเดียวและชี้ Rules → Calculated fields → Change this rule; manual save รักษา IDs/สูตรของ collection อื่น

PD035: assistant ได้ `computeCapabilities` ชุดเดียวกับ host และคำถามเรื่องความพร้อมตอบจาก capability โดยตรง ไม่เรียก provider/จองงบ/แก้ตาราง มี guard ให้คำขอสร้างงานทั้งภาษาไทย/อังกฤษและคำถามที่ขอสร้างต่อยังเข้า provider ตามเดิม ทดสอบ Polars/GeoPandas แยกจาก pandas โดยไม่แอบติดตั้ง package payload จริงที่ production ปฏิเสธใน release 8 ไม่ถูกเก็บไว้ จึงยืนยันได้เฉพาะ rejection path และการป้องกันใหม่

ผล local ก่อน sync dev: Node22.23.2 unit **845/5 skipped**, CF **177/177**, build/typecheck/lint0errors110warnings ผ่าน Controlled HTTP authority + explicit disposable PGlite + real JS isolate/Docker **7 cases / 17 executions** ผ่าน: PD022 current435/oldrunstale/pendingmetricnull, PD023/033/034ปฏิเสธfailure/type/Infinityโดยrawไม่เปลี่ยนและmetricไม่ใช้ผลเก่า, PD024กันrunซ้ำ, PD036กันcycle/0executions, PD042counter1ทั้ง3รอบแยกJS/Python Results ใน ignored `test-results/post-deploy/compute-controlled-local/results.json`; ไม่เรียก hosted หรือ AI

UI harness interactions และความกว้าง280/320/390/414pxผ่าน Full ui-gate รอบ fixtureใหม่ **16/17 measured,3SKIP** มี raw FAIL overflow detectorนับ controlsใน native detailsที่ปิดอยู่; วัดปุ่มที่แสดงจริงหลังเปิดทั้งสอง sections ที่320/414pxได้0overlaps เก็บ rawผลใน ignored `test-results/f066-t8-ui-gate.txt` ไม่แทน FAIL ด้วย PASS Independent review ปิด P2 ย้อนกฎที่เก็บยอดเก่าด้วย guard และยืนยันใหม่; ไม่เหลือ P1/P2 ใน scopeตรวจ

หลัง sync dev@bae156d (เก็บงาน image/record picker ของทีมครบ): unit **871 passed/5 skipped**, CF **184/184**, typecheck/build/Worker dry-run ผ่าน รอ CI/pipeline/hosted acceptance; รายงาน release 8 ด้านล่างเป็นผลก่อนแก้ ไม่แก้ย้อนหลังเป็น PASS หลายบัญชีคง BLOCKED ตามผู้ใช้

### F066-T7 — ผลหลัง deploy 8.0.0

[รายงานรายเคส](../testing/f066-post-deploy/RELEASE8_RESULTS_TH.md): production/staging ตอน preflight ตรง **8.0.0 / 89a604e** แต่ `runtimes: []`, `pythonLibraries: []` จึงยังไม่พร้อมทั้ง JavaScript/Python ตาม scope ที่ผู้ใช้ขอตรวจ ประเมิน 48 เคสเป็น **7 PASS / 4 FAIL / 36 BLOCKED / 1 SKIPPED_SCOPE**; 29 เคสติด engine ไม่ได้เริ่ม execution ไม่มีการนับผลสูตรเดิมแทน generated compute

รันบนเว็บจริงด้วยข้อมูลสมมติ: ถามยอดไม่เปลี่ยนข้อมูล225, clarificationหนึ่งคำถาม/สามตัวเลือกและทำต่อได้, สูตรส่วนลด225→202.50→180, refsสูงสุด5, กาแฟ3→8/pending0หลังเพิ่มmetricและreload, server2d6=3+4→score7/score+5=12และreloadคงเดิม ร่างแรก no-file/file-later ติด total required; คำถามเรื่องPolarsจบด้วย MODEL_PROVIDER_OUTPUT_REJECTED จึงไม่ผ่าน ยังมีข้อจำกัดมือถือ/humanreadback/หลายบัญชีและlegacyuploadที่รายงานตามจริง

หลักฐานดิบอยู่ ignored `test-results/post-deploy/release8-20261023/`; ไม่มี IDs จริงหรือภาพส่วนตัวในรายงานสาธารณะ ตรวจชุดเตรียมด้วย Node22.23.2: 48definitions/15fixtures/38goldenchecks ผ่าน ผลนี้ไม่ใช่จำนวน runtime PASS งานตรวจนี้ไม่แก้ runtime/config, SQL/schema, credentials หรือสั่ง deploy

### F066-T6 — เตรียมทดสอบหลัง deploy

[ชุดทดสอบพร้อมใช้](../testing/f066-post-deploy/README_TH.md) มี 48 เคส / 8 กลุ่ม / P0 12 เคส, CSV สมมติ 15 ไฟล์, ผลอ้างอิง และแบบบันทึกผลทุกเคสเป็น **NOT_RUN** ครอบคลุม chat, JavaScript/Python และ libraries, การเชื่อม input/output, rerun/continuity, Rules/ref/Advanced, type/error, สิทธิ์/หลายคน และเคสเดิม ผู้ใช้จะสั่งเริ่มทดสอบหลัง release/deploy อีกครั้ง; งานนี้ไม่เปลี่ยน runtime และไม่ทดสอบ hosted

ตรวจการเตรียมด้วย Node **22.23.2**: `node scripts/check-f066-post-deploy-pack.mjs` ผ่าน **48 case definitions / 15 fixtures / 38 golden arithmetic checks**, ยืนยัน template **48 NOT_RUN**, **0 network requests**; `npx eslint scripts/check-f066-post-deploy-pack.mjs`, `node scripts/check-public-files.mjs` และ `git diff --check` ผ่าน ตัวตรวจอ่านไฟล์อย่างเดียว ไม่ถือเป็นผล acceptance ของแอป เคส fault/timing แยก local/staging และกรณี engine/legacy route ที่ไม่อยู่ใน intended scope ต้องลง SKIPPED_SCOPE พร้อมเหตุผล

### หลักฐาน runtime ก่อนงานเตรียม T6

หลัง #208 รวมเข้า `dev@2f741d7` ชุด PR validation ผ่าน แต่ full CI พบ Workers fixture ยังตรวจ capability count/copy เดิม และ generated-scene drag ได้พิกัดไม่ตรงเป้า แก้เฉพาะ capability assertions ที่สัมพันธ์กับฟีเจอร์นี้ใน F066-T5 / #220: capability unit 3/3, scoped lint และ Cloudflare browser 33 checks / 37 synthetic provider calls / 0 browser errors ผ่าน ผู้ใช้ให้หยุดการไล่ scene/camera นอกขอบเขตและคืนโค้ดทดลองแล้ว จึงไม่อ้างว่า full CI รอบนั้นผ่านทั้งหมด ฟีเจอร์ยังไม่ได้ release และ hosted Python ยังต้อง provision ตาม runtime contract

ตรวจด้วย Node **22.23.2**, Docker Engine **29.9.2** และข้อมูลสมมติเท่านั้น:

- Provider จริงสร้าง Python/pandas module ได้หนึ่งเคส ร่างก่อนหน้าหนึ่งครั้งถูก validator ปฏิเสธ จึงไม่อ้างว่าสร้างได้สำเร็จทุกครั้ง
- ใช้ source ที่ AI สร้างใน authority + PGlite + Docker จริง: ผล **225 → 405** เมื่อแทนแถวต้นทาง, runner 2 ครั้ง, ไม่เรียก provider ตอนคำนวณซ้ำ
- ปิด/เปิด server ใช้ฐานเดิมกับ session เดิมแล้วอ่านโปรแกรม/ข้อมูล/ผลกลับได้; browser เปิด metric ได้ **405** และ reload ยังอ่านผลเดิม; Rules ยาวเลื่อนอ่านในการ์ดและ owner เปิด source ใน Advanced ได้แม้ local AI ปิด รวม acceptance **8 checks**
- Python integration **4/4**: pandas ใช้ซ้ำ, standard image libraries, ไม่มี network/host credential, ทิ้ง generated logs จำนวนมากโดยไม่เก็บใน host memory
- UI focused **47/47**, actual component browser interactions ผ่าน: Ask/Change references หลายข้อ, สิทธิ์แก้/ดู, Advanced/source, เปลี่ยนภาษาแบบขอร่าง, run ที่ถูกปฏิเสธ, ยืนยัน replace และปิด import บน derived table
- UI-gate **16/16 measured PASS**, **4 SKIPPED**: theme refs, token schema/contrast pairs และ focus trap ไม่มี input/selector; ไม่ถือเป็น PASS ตรวจ viewport 280/320/390/414 และดูภาพ desktop/mobile แล้ว
- `wrangler deploy --dry-run` ทั้ง default และ config Python opt-in ผ่าน พร้อม build image; ไม่ได้ provision หรือ execute Python บน hosted Cloudflare

ชุดรวมหลัง sync `dev@fa5efe4`: unit **818 passed / 5 skipped**, Cloudflare **170/170**, lint **0 errors / 107 warnings**, typecheck/build/Worker dry-run และบูต Worker จริง (`/healthz`, `/api/capabilities`) ผ่าน; public-file scan 0 findings; audit ไม่มี high/critical แต่มี moderate dev-test advisories เดิม 2 รายการ Independent review ไม่เหลือ P1/P2 ในขอบเขตตรวจ browser regression รวมผ่าน: Cloudflare **32 checks**, Generative Canvas **8 checks** ผลทดสอบและภาพดิบอยู่ใน ignored `test-results/` ไม่ใช่ข้อมูล production

## คำสั่งตรวจที่ทำซ้ำได้

```powershell
npm test
npm run test:cloudflare
npm run build
npm run build:cloudflare
$env:TABLETOP_COMPUTE_DOCKER_TEST='1'
npx vitest run server/compute-python.integration.test.ts
node scripts/build-f066-rules-harness.mjs
node tests/ui/f066-rules-browser.mjs
```

UI-gate ต้องใช้ skill ที่ติดตั้งในเครื่องและรันกับ `tests/ui/f066-rules.html --full` ส่วน real-provider proof ใช้ `TABLETOP_CREDENTIAL_FILE` ที่ไม่อยู่ใน Git แล้ว `node --import tsx scripts/compute-live-local.mjs`; จากนั้นรัน `scripts/compute-runtime-local.mjs` แบบเดียวกัน ไม่มีการ deploy

### F066-T9 — ค่าเริ่มต้นและ deployment acceptance

ช่องใหม่ที่ optional และมี default ต้องเติมค่าให้แถวเดิมเหมือนเดิม; แยก guard ย้อนสูตรที่ต้องรักษาค่าประวัติและห้าม default กลบค่าที่ไม่ตรง มี red→green regression ของ discount=10 และ domain tests 25/25 ผ่าน รวม required/default/rollback; typecheck/scoped lint ผ่านบน Node22.23.2 และ independent review ไม่มี P1/P2

F075@f79b45f คืนชื่อแถวที่ไม่มี text ให้มี ID เช่น 0 · team-south จึงคง assertion ชื่อเดิมและเพิ่มตรวจ selected record ID และ strict assistant mock ให้รับ computeCapabilities พร้อมตรวจ disabled engine profile ของ fixture คง privacy assertions ทั้งหมด Local browser ก่อน sync dev ล่าสุด: generative 4 rooms/8 synthetic calls/0 errors; Workers 35 checks/37 synthetic calls/0 errors ผลนี้ไม่ใช่ hosted acceptance

### F066-T10/T11 — release gate และ actual hosted runtime

ผู้ใช้อนุญาตแก้เฉพาะสาเหตุของ generated-scene case ที่บล็อก deploy โดยคง assertions ทุกข้อ งานต่อใน PR #252 ก่อนรวมกลับ release #249 ไม่ขยายไปแก้ scene/camera ทั่วไป

Staging dev4c4ce93 deploy ผ่านแล้วและประกาศ JS/Python พร้อม libraries ทั้งห้า; actual AI สร้างสอง modules กับ raw value10 ได้ JavaScript metric42ปรากฏ แต่ Python บันทึก COMPUTE_UNAVAILABLE ซ้ำ22ครั้ง inputเดิมและเคยมี queued/runningค้าง จึงยังไม่ถือว่า hosted Pythonพร้อม นโยบายแก้: failureของ inputเดิมไม่ควร autoqueueซ้ำทุกalarm; explicit Run เป็นทาง retry และ diagnostics บอกเฉพาะ guard reasonโดยไม่ใส่ identifiers/credentials

เคส no-file แยกห้องบน staging ผ่าน: เริ่มraw salesว่าง, program.computedColumns total=quantity×unit_price, CSVสองแถวมีเฉพาะraw fields; authorityอ่านกลับ dataRevision1/ruleRevision1, raw2แถวไม่มีtotal และ computedValues75/150; metric225, quantity8, chart2points ไม่ใช้ engine ผลนี้เป็น staging ไม่แทน production acceptance

Candidate PR #252: Python runnerรับgetContainer providerและresolveเมื่อถึงคิวexecutionแทนconstructor; regressionจำลองcontainerไม่มีตอนสร้างrunnerแต่มีตอนrunเป็นred→green รองรับcontainer objectเดิมและรักษาserial/destroy/noInternet/timeout ExplicitRunยังretryได้หลังfailure; runner/Room68/68และorchestrator6/6ผ่าน, typecheck/lintผ่านบนNode22.23.2 ยังไม่ยืนยันว่าgetterแก้existingRoomบนplatformจนกว่าจะretestหลังpipeline

FreshRoomหลังdeploy: actual Python imports pandas/numpy/scipy/openpyxl/dateutil; raw10→10+10, outputs42→82, succeededทั้งสองrunsและinputHashเปลี่ยน; source/version/ruleRevision1คงเดิม modeljob1รายการIDเดิม จึงรายงาน NO_NEW_MODEL_JOB; providerCalls UNVERIFIEDเพราะไม่มีserverledger

Scene gateเป็นtest scheduling raceที่พิสูจน์ได้: บังคับfocusfitก่อนdownทำให้pointermiss/0actions/ค่าคง20,10; normalfixtureหยุดclockไว้75msหลังfocusclickก่อนrealpointerdown(<90ms focusthreshold) แล้วresume ตรวจพิกัด40,20ภายใน±0.001, oneaction, independentshadowและcameraเดิมครบ Fulllocal4rooms8syntheticcalls0errorsผ่าน ไม่มีproduction scene/camera edits Independentreviewไม่มีP1/P2; ปรับfailurediagnosticให้อ่านด้วยshadowownerแทนcafeowner

APIอ้างอิง: [Cloudflare Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/) และ [Scheduling Policies](https://developers.cloudflare.com/containers/configuration/scheduling-policy/) ยืนยันnamedimage/startcontract; ไม่ใช้metadatareadyแทนactualexecution
