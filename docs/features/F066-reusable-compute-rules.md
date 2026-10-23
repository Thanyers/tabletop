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
| F066-T8 | เปิด engines บน hosted แก้เคสไม่ผ่าน และ deploy/ทดสอบซ้ำ | pipeline เปิด runtime จริง, CSV ไม่บังคับค่าที่คำนวณ, คำถาม library ตอบตาม capability; multi-account BLOCKED |
| F066-T7 | ตรวจ JavaScript/Python และทดสอบหลัง release 8 | ยืนยันรุ่นจริง, actual/evidence และ PASS/FAIL/BLOCKED รายเคส; ไม่อ้าง readiness จาก capability flag อย่างเดียว |

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
