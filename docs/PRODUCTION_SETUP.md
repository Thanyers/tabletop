# Tabletop production setup and resume plan

วันที่ 18 ตุลาคม 2026 ตามเวลา Asia/Bangkok แผนนี้เสนอการเปิดให้ทีมที่ได้รับเชิญเล่นผ่านอินเทอร์เน็ต มีบัญชีสำหรับกลับมาเล่นต่อ หน้าผู้ดูแล และ AI จริงตามที่เจ้าของระบบเลือกแล้ว สถานะ infrastructure คือ **Proposed** ยังไม่ได้สร้างบริการ hosting หรือเริ่มค่าสมาชิก ฟังก์ชันบัญชี แอดมิน และ AI ในหน้าแอปด้านล่างยังไม่ได้เชื่อมต่อครบ

เจ้าของระบบให้ใช้ DeepSeek และบันทึก `DEEPSEEK_KEY` ในไฟล์ local เดิมแล้ว การตรวจ credential กับ `GET /models` ของ DeepSeek ผ่าน HTTP 200 และเห็น `deepseek-flash` กับ `deepseek-v4-pro` การตรวจนี้ยืนยันการเข้าถึง API ไม่ใช่ผลทดสอบคุณภาพหรือโหลดของแอป ดูผลทดสอบเพิ่มเติมที่ [AI provider verification](AI_PROVIDER_VERIFICATION.md)

## ระบบที่เสนอ: Cloudflare เป็น infrastructure หลัก

ตามคำถามล่าสุดของเจ้าของระบบ เปลี่ยนข้อเสนอหลักเป็น **Workers + Durable Objects + D1 + R2** ไม่ต้องใช้ Render หรือ Supabase ที่เสนอไว้ก่อนหน้า ทางเดิมสะดวกเพราะใช้ Node/PostgreSQL ปัจจุบันต่อได้และมีระบบ Auth สำเร็จรูป แต่ Supabase ไม่ใช่ข้อจำกัดทางเทคนิคของ Tabletop ทาง Cloudflare ต้องย้ายชั้น runtime และ persistence อย่างตั้งใจ สถานะยังเป็นแผน ยังไม่มี Worker หรือฐานข้อมูลบน Cloudflare ที่สร้างแล้ว

| งาน | บริการและขอบเขตที่เสนอ |
| --- | --- |
| หน้าเว็บและ API | Workers Static Assets กับ Worker ที่ origin เดียว ตรวจ session, Origin/CSRF, สิทธิ์ และโควตา |
| ห้อง multiplayer | SQLite-backed Durable Object หนึ่งตัวต่อโต๊ะ เป็นเจ้าของ state, สมาชิก/บทบาท, คำเชิญ, revision, command receipts และเหตุการณ์ของโต๊ะ |
| การส่งสถานะทันที | WebSocket Hibernation API ใน Durable Object ส่งเฉพาะข้อมูลที่ผู้เล่นคนนั้นมีสิทธิ์เห็น |
| บัญชีและการกลับมาเล่น | D1 เก็บบัญชี, session ที่เก็บเฉพาะ hash ของ token, การเพิกถอน และดัชนี My tables/admin |
| ไฟล์ส่วนตัว | R2 Standard แบบ private ผ่าน Worker binding ตรวจสิทธิ์จากโต๊ะก่อนอ่าน/เขียน; เพิ่ม quarantine/scanning ก่อนเปิด public upload |
| AI | Worker เรียก DeepSeek โดยใช้ Worker Secrets; Billing Durable Object แยกเป็นผู้คุม reservation/usage ถาวร |

ข้อมูลใน [SQLite-backed Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) อยู่ต่อเมื่อ process พักหรือผู้เล่นปิด browser ส่วน [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) ช่วยพัก object ขณะที่ connection ยังเปิดได้ ต้องโหลด state จาก storage ใหม่เมื่อปลุกขึ้นมา ห้ามใช้ตัวแปรในหน่วยความจำเป็นที่เก็บเกมหลัก

**สิทธิ์ของโต๊ะตัดสินที่ Room Durable Object เท่านั้น** D1 เก็บดัชนีสำหรับค้นหาและแสดงรายการ ซึ่งอาจตามหลังการเปลี่ยนสมาชิกได้ จึงใช้ดัชนีนี้อนุญาตให้เข้าโต๊ะไม่ได้ การ commit ใน DO กับ [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/) เป็นคนละขอบเขต transaction; ใช้ outbox ที่บันทึกพร้อม state, idempotent delivery และการตรวจซ่อมดัชนี ไม่อ้างว่ามี transaction เดียวครอบคลุม DO/D1/R2 ทุกคำสั่งยังต้องตรวจ revision และป้องกันคำสั่งซ้ำ รวมถึงหลัง reconnect หรือ retry

ดัชนี My tables เก็บเฉพาะ opaque references สำหรับค้นหา ชื่อโต๊ะ รายชื่อสมาชิก และข้อมูลส่วนตัวต้องอ่านจาก Room DO หลังตรวจสมาชิกหรือสิทธิ์ support ปัจจุบันแล้ว เพื่อไม่ให้รายการสมาชิกเก่าที่ยังตามมาไม่ทันเปิดเผย metadata หลังถอนสิทธิ์ การลบ/ถอนสิทธิ์ต้องส่ง tombstone ไปซ่อมดัชนีด้วย

การตรวจ session เฉพาะตอนเปิด WebSocket ไม่พอ: Room DO ต้องตรวจ session hash, expiry และ revocation จาก D1 primary เมื่อกลับจาก hibernation ก่อนใช้งาน connection, ทุกข้อความที่รับ และก่อนส่ง projection ส่วนตัวแต่ละครั้ง พร้อมตรวจสมาชิกจาก state ของห้อง ใช้ primary read ตาม [D1 Sessions/read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/) ไม่ใช้ replica/cache ที่อาจยังไม่เห็น logout หากตรวจไม่ได้ให้หยุดรับคำสั่ง/ส่งข้อมูลส่วนตัวและปิด connection ที่หมดอายุหรือถูกเพิกถอน socket attachment เป็นเพียงข้อมูลอ้างอิง ไม่ใช่หลักฐานสิทธิ์ ต้องทดสอบ logout ขณะที่ socket พักและขณะที่ผู้เล่นคนอื่นส่งเหตุการณ์ด้วย คำสั่งที่ผ่านการตรวจและ commit ไปแล้วไม่ถูกย้อนกลับด้วย logout

Google sign-in ทำใน Worker ผ่าน OAuth/OIDC แล้วออก session ของ Tabletop ได้ บัญชีถาวรผูกกับ issuer และ subject ที่ตรวจสอบแล้ว ไม่ใช่อีเมลที่ browser ส่งมา ต้องตรวจ state/nonce/PKCE, issuer/audience/signature, cookie และการเพิกถอนตาม [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) ฟีเจอร์ login, My tables และสิทธิ์แอดมินยังต้องทำในแอป Cloudflare ไม่ได้เพิ่มสิ่งเหล่านี้ให้อัตโนมัติเพียงสร้าง D1

[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/) ใช้บัญชี Google ทั่วไปเป็นด่านเข้าให้ทีมได้ แต่ไม่แทนสมาชิกและบทบาทในเกม แผนหลักใช้ app-managed login เพื่อรองรับผู้เล่นทั่วไปและ guest ตามนโยบายในอนาคต หากเพิ่ม Access ให้ admin/team preview ต้องใช้การป้องกันระดับ hostname สำหรับ WebSocket ตาม [ข้อจำกัด Workers Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) ไม่ใส่ Worker-level Access แล้วถือว่า WebSocket จะใช้ได้ทันที

เริ่มจาก HTTPS URL ที่ Cloudflare ให้ได้ แล้วค่อยผูก domain ของทีม ส่วน DeepSeek และ Google ยังคงเป็นผู้ให้บริการ AI/identity ภายนอก ไม่มีฐานข้อมูลหรือ app hosting แยกจาก Cloudflare ตามแผนนี้

### ขอบเขตที่ต้องย้ายจากโค้ดปัจจุบัน

React UI และกฎคำนวณที่แยกจาก infrastructure ใช้ต่อได้ ส่วน Node HTTP/`ws`, PostgreSQL transactions/row locks, filesystem และ PDF child process ต้องมี adapter ใหม่ ไม่ใช่เปลี่ยน connection string แล้ว deploy ได้ทันที ดู [runtime ปัจจุบัน](R1_ARCHITECTURE.md)

Workers มี [filesystem แบบ virtual](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/) และ `child_process` ไม่ใช่ Linux process ที่ใช้งานได้ครบ จึงต้องพอร์ต PDF parsing ให้มีขอบเขตเวลา/หน่วยความจำที่ทดสอบแล้ว หรือใช้ [Cloudflare Container](https://developers.cloudflare.com/containers/concepts/architecture/) เฉพาะ parser หากจำเป็น ค่า Container ไม่รวมในฐานด้านล่างและ disk ไม่ใช่ที่เก็บถาวร ยังไม่เลือก Container เป็นเส้นทางหลัก ส่วน Hyperdrive เป็นตัวเชื่อมฐานข้อมูล ไม่ได้ทำให้ PostgreSQL เดิมกลายเป็นฐานข้อมูลที่ Cloudflare host ให้

## เมื่อปิดเว็บแล้วกลับมา

| เหตุการณ์ | โค้ด local ปัจจุบัน | พฤติกรรมที่เสนอสำหรับ prod |
| --- | --- | --- |
| ปิดแท็บหรือปิด browser ปกติ | ข้อมูลที่เซิร์ฟเวอร์รับแล้วอยู่ในฐานข้อมูล cookie ยังอยู่ตามอายุ | ผู้เล่นเป็น offline โต๊ะและตัวละครยังอยู่ |
| เปิด browser เดิม | กลับโต๊ะเดิมได้เมื่อ session ไม่ idle เกิน 24 ชั่วโมง ไม่เกิน hard expiry 7 วัน และโต๊ะยังไม่หมดอายุ | กลับโต๊ะล่าสุดหรือเลือกจาก My tables |
| session หมดอายุ | idle 24 ชั่วโมงหรือ hard expiry 7 วัน; guest ใหม่ไม่สามารถยึดตัวละครเดิมคืนด้วยตนเอง | ล็อกอินอีกครั้งแล้วได้สมาชิกและตัวละครเดิม |
| เปลี่ยนเครื่อง ล้าง cookie หรือปิด private browsing | ยังไม่มี account recovery ที่เชื่อถือได้ | ล็อกอินบัญชีเดิมแล้วกด Resume |
| เปิดหลายแท็บหรือหลายเครื่องด้วยบัญชีเดียว | ยังไม่มีบัญชีข้ามเครื่อง | ทุกเครื่องเป็นผู้เล่นคนเดิม คำสั่งซ้ำและข้อมูลเก่าต้องถูกตรวจที่เซิร์ฟเวอร์ |
| ครบ 7 วันนับจากสร้างโต๊ะ | โต๊ะหมดอายุและมีการล้างเนื้อหา | โต๊ะที่บันทึกไม่หมดอายุเพราะ login session หมดอายุ เก็บจนเจ้าของลบตามนโยบาย retention ที่แสดงให้เห็น |
| ผู้ดูแลต้องช่วยเหลือ | ไม่มี admin console รวมทุกโต๊ะ | ดูเจ้าของโต๊ะ สมาชิก สถานะ และประวัติการจัดการได้ |

Session สำหรับเข้าเว็บต้องแยกจากข้อมูลโต๊ะและสมาชิกโดยเด็ดขาด ผูกสมาชิกกับรหัสบัญชีถาวรจากผู้ให้บริการที่ตรวจสอบแล้ว การหมดอายุหรือเพิกถอน session ทำให้ต้องล็อกอินใหม่ แต่ไม่ลบเกม การปิดแท็บไม่ทำให้ผู้เล่นอื่นหลุดจากโต๊ะ

การ Resume คืน **สถานะล่าสุดที่เซิร์ฟเวอร์บันทึกแล้ว** ไม่ย้อนเวลาให้ผู้เล่นหนึ่งคน หากคนอื่นเล่นต่อระหว่างที่หลุด ผู้กลับมาจะเห็นผลล่าสุด ข้อความที่ยังไม่ได้ส่งหรือฟอร์มที่ยังไม่ได้บันทึกไม่อยู่ในคำรับรองนี้

เพิ่ม Pause/Resume ที่ DM ควบคุมและบันทึกระยะเวลาที่เหลือของ reaction อย่างชัดเจน ปัจจุบันตัวจับเวลา 30 วินาทียังเดินต่อเมื่อ browser ปิด การกลับมาหลังหมดเวลาจึงไม่เปิดสิทธิ์ react ย้อนหลัง สำหรับ Cloudflare เก็บ deadline ใน DO SQLite และใช้ [alarm](https://developers.cloudflare.com/durable-objects/api/alarms/) ปลุกเพื่อประมวลผล แต่ตรวจ deadline จากเวลาฝั่งเซิร์ฟเวอร์ทุกครั้งที่รับคำสั่งด้วย เพราะ alarm อาจมาช้าและส่งซ้ำได้ หนึ่ง DO มี alarm slot เดียว จึงเก็บคิวงานที่ถึงกำหนดและตั้งเวลางานถัดไป ไม่ใช้ interval ที่ทำให้ทุกห้องตื่นตลอดเวลา ต้องทดสอบ pause, hibernation, reconnect, duplicate alarm และ deploy ระหว่าง action ก่อนเปิดจริง

บัญชีแอดมินเริ่มต้นผูกกับบัญชีที่ยืนยันตัวตนแล้วของเจ้าของระบบ อีเมลในไฟล์ตั้งค่าเป็นเพียงข้อมูลสำหรับ bootstrap ไม่ใช่สิทธิ์ที่ browser สามารถประกาศเอง หน้าผู้ดูแลแสดงรายการโต๊ะและสมาชิก ส่วนการเปิดเนื้อหาส่วนตัวเพื่อ support ต้องมีสิทธิ์ เหตุผล และ audit log แยกจากบทบาท DM

## ใช้ AI ที่ส่วนไหน

เลือก **DeepSeek-V4.1-Flash-1017 ผ่าน API `deepseek-flash`** เป็นตัวเริ่มต้นตามความต้องการของเจ้าของระบบ เอกสาร [First API call](https://api-docs.deepseek.com/) และ [ประกาศ 17 ตุลาคม](https://api-docs.deepseek.com/news/news261017/) ยืนยันว่า alias นี้ให้บริการรุ่นดังกล่าว ณ วันที่ตรวจ ไม่ใช่การ pin รุ่นถาวร ต้องบันทึกชื่อที่ตอบกลับและรันชุดทดสอบซ้ำเมื่อผู้ให้บริการเปลี่ยนรุ่น

| ส่วนของ Tabletop | ทางที่เสนอ | ผู้ตัดสินผลจริง |
| --- | --- | --- |
| แปลงข้อความเป็นข้อเสนอกฎ invoice/physics/encounter | Flash แบบ non-thinking ส่งข้อมูลที่จำเป็นและรับ JSON ที่จำกัดรูปแบบ | schema, domain validation, การทดลอง และเจ้าของโต๊ะอนุมัติ |
| คำบรรยาย DnD หรือสรุปเหตุการณ์ | Flash แบบ non-thinking จำกัดความยาว ใช้เหตุการณ์ที่ยืนยันแล้ว | ผลลูกเต๋า เทิร์น HP/AP มาจากเซิร์ฟเวอร์ |
| คำใบ้และคำอธิบาย physics | Flash อธิบายผลที่โค้ดคำนวณแล้ว | โค้ดคำนวณสมการและคะแนน; learner ไม่ได้รับเฉลย/ข้อมูลของคนอื่น |
| CSV และ PDF ที่มีข้อความ | parser ก่อน แล้วส่งเฉพาะ excerpt ที่ผู้ใช้ตรวจแล้วเมื่อขอข้อเสนอ | การคำนวณเงินใช้ integer satang และหลักฐานที่ตรวจแล้ว |
| ภาพ/เอกสารสแกน | Flash รองรับ vision แต่ยังไม่เปิดทางนี้ใน R1 ปัจจุบัน | ผลอ่านเป็นข้อมูลรอตรวจ; ต้องทดสอบ OCR และ private upload ก่อน |
| session, สมาชิก, สิทธิ์, multiplayer, dice, ตัวจับเวลา | ใช้โค้ดและฐานข้อมูล | เซิร์ฟเวอร์ ไม่ต้องเสียค่า AI |

ยังไม่มีเหตุผลจากผลทดสอบของแอปที่จะบังคับใช้หลาย provider ตั้งแต่แรก เริ่ม Flash แล้ววัด schema success, ความถูกต้อง, เวลา และต้นทุน หากงานยากไม่ผ่าน ให้ผู้ใช้แก้ข้อเสนอหรือร้องขอรอบคิดเพิ่มแบบมีเพดาน ไม่สลับไปโมเดลแพงหรือส่งข้อมูลต่อไปอีก provider โดยอัตโนมัติ

Flash ไม่ได้ถูกที่สุดทุกกรณี: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) มี Standard short-context input/output 0.10/0.50 USD ต่อ 1M tokens ต่ำกว่า Flash แบบ cache miss ทั้ง peak และ off-peak แต่ยังไม่มีผลทดสอบคุณภาพเทียบกันในแอปนี้ จึงเสนอ Luna เป็นตัวเปรียบเทียบภายหลังเท่านั้น ไม่ต้องเตรียม OpenAI key ตอนนี้ ส่วน Flash มีราคาสำหรับ cached input ต่ำมาก จึงต้องเปรียบเทียบด้วย usage จริงด้วย

[JSON output](https://api-docs.deepseek.com/guides/json_mode/) ไม่แทนการตรวจความหมายหรือสิทธิ์ในเซิร์ฟเวอร์ Adapter รอบนี้ใช้ Chat Completions JSON mode และ schema ของแอป ส่วน [Responses API](https://api-docs.deepseek.com/api/create-response/) มี JSON Schema ให้ประเมินเป็นทางต่อยอด ฟีเจอร์ [vision](https://api-docs.deepseek.com/guides/vision/) ไม่ใช่หลักฐานความแม่นยำ OCR ของเอกสารจริง

## ค่าใช้จ่ายรายเดือน

ราคาหน่วยเป็น USD ก่อนภาษีและค่าธรรมเนียมบัตร ตรวจวันที่ 18 ตุลาคม 2026 **ฐาน Cloudflare Workers Paid เริ่มที่ 5 USD ต่อเดือนต่อ account** เมื่อการใช้บริการยังอยู่ใน allocation ของแต่ละบริการ คิดส่วนเกินตามจริง ไม่ใช่แพ็กเกจเหมาจ่ายไม่จำกัด และ quota ของ account อาจถูกใช้โดย project อื่นด้วย

| รายการ | ที่รวมในฐาน/โควตาฟรีต่อเดือน | ส่วนเกิน USD |
| --- | --- | --- |
| [Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/) | 10M dynamic requests, 30M CPU-ms; static assets ไม่มีค่า request | 0.30/1M requests; 0.02/1M CPU-ms |
| [Durable Objects compute](https://developers.cloudflare.com/durable-objects/platform/pricing/) | 1M billable requests, 400,000 GB-s | 0.15/1M requests; 12.50/1M GB-s |
| DO SQLite | 25B rows read, 50M rows written, 5 GB-month | 0.001/1M reads; 1/1M writes; 0.20/GB-month |
| [D1](https://developers.cloudflare.com/d1/platform/pricing/) | 25B rows read, 50M rows written, 5 GB | 0.001/1M reads; 1/1M writes; 0.75/GB-month |
| [R2 Standard](https://developers.cloudflare.com/r2/pricing/) | 10 GB-month, 1M Class A, 10M Class B | 0.015/GB-month; 4.50/1M A; 0.36/1M B; R2 egress ฟรี |

ตัวอย่างทีมเล็ก: 5 โต๊ะ โต๊ะละ 3 คน เปิดวันละ 4 ชั่วโมง 30 วัน และคนละ 2 ข้อความต่อนาที จะได้ 216,000 incoming WebSocket messages หรือ 10,800 DO billable requests ตามอัตรา 20:1 ยังต้องนับ handshake, HTTP/RPC และ alarm เพิ่ม สมมติ dynamic Worker requests รวมไม่เกิน 1M และ CPU เฉลี่ยไม่เกิน 10ms, DO requests รวมไม่เกิน 100,000, DO duration รวมไม่เกิน 300,000 GB-s, แต่ละฐานอ่าน/เขียนไม่เกิน 10M/1M rows และใช้ storage DO 1 GB, D1 1 GB, R2 5 GB พร้อม R2 operations ไม่เกิน 100,000 A/1M B จะยังอยู่ในฐาน **5 USD** นี่คือ scenario ที่ใช้ตั้งงบ ไม่ใช่ผล load test

ต้องวัด **เวลาที่ DO active จริง** ไม่ใช้ CPU time ของ Worker แทน duration: ถ้า 5 ห้อง active ตลอด 4 ชั่วโมง/วัน จะใช้ 276,480 GB-s ก่อนรวมงานอื่น ส่วน 10 ห้องในเงื่อนไขเดียวกันใช้ 552,960 GB-s เกิน allocation 152,960 GB-s ซึ่ง Cloudflare ปัดส่วนเกินขึ้นเป็น 1M GB-s คิด **เพิ่ม 12.50 USD** ตามหน่วยบิล การใช้ hibernation และปล่อยให้ห้องพักเมื่อไม่มีงานจึงเป็นข้อกำหนดของ implementation งานรอ network หรือ timer ที่ค้างอยู่ก็อาจกันไม่ให้พักได้

เสนอวงเงินวางแผนสำหรับรอบทีมเล็ก **infrastructure 10 USD + AI 10 USD = 20 USD/เดือน ประมาณ 700 บาท** ที่อัตราตั้งงบ 35 บาทต่อ USD ตัวเลขนี้แทนข้อเสนอ 70 USD ของโครงสร้างเดิม อัตราแลกเปลี่ยนเป็นสมมติฐาน วงเงินยังไม่ได้รับอนุมัติ และ **ไม่ใช่ hard cap ของ Cloudflare** ต้องวัด duration/usage, จำกัด requests/CPU/storage และแจ้งเตือนก่อนเพิ่มจำนวนโต๊ะหรือเปิดสาธารณะ

งบนี้ไม่รวม domain ที่ซื้อเอง, Container/parser/scanning, อีเมลส่งออก, paid Access, backup เพิ่มเติม และบริการหรือส่วนเกินที่ไม่ได้อยู่ใน scenario ข้างต้น ต้องทดลองกู้คืน DO, D1 และ R2 ให้สอดคล้องกัน ไม่มีการรับรอง backup ของทั้งแอปจากการมี storage ถาวรเพียงอย่างเดียว

### ค่า AI ที่ใช้ตั้งงบ

ราคา `deepseek-flash` ต่อ 1M tokens จาก [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/):

| รายการ | Off-peak USD | Peak USD |
| --- | ---: | ---: |
| Input cache miss | 0.15 | 0.30 |
| Input cache hit | 0.003 | 0.006 |
| Output รวม reasoning เมื่อเปิด thinking | 0.60 | 1.20 |

Peak ตามเวลาไทยคือ 08:00–11:00 และ 13:00–17:00 จันทร์–ศุกร์ ยกเว้นวันหยุดจีน นอกนั้นเป็น off-peak ใช้ราคา peak และไม่คิดส่วนลด cache ในการตั้งเพดานไว้ก่อน

ตัวอย่าง non-thinking หนึ่งคำขอมี input 3,000 + output 500 tokens ไม่มี retry ไม่มี tools และไม่นับรูปภาพ: ค่าใช้จ่าย **0.00075–0.00150 USD ต่อคำขอ**

| จำนวนคำขอต่อเดือน | ค่า AI USD | รวมฐาน Cloudflare 5 USD | บาทที่ 35 บาท/USD |
| ---: | ---: | ---: | ---: |
| 1,000 | 0.75–1.50 | 5.75–6.50 | 201.25–227.50 |
| 6,000 | 4.50–9.00 | 9.50–14.00 | 332.50–490.00 |
| 10,000 | 7.50–15.00 | 12.50–20.00 | 437.50–700.00 |

จำนวน token เป็นสมมติฐานของ workload ไม่ใช่ผลวัดทุก workflow และไม่ใช่ใบเรียกเก็บจาก provider ข้อความยาว reasoning ภาพ และ retry เพิ่มค่าใช้จ่าย ต้องเก็บ usage จริง โดยไม่ log ข้อความหรือ key

ก่อนเปิดใช้จริง ต้องมี cost ledger ถาวรแยกจากข้อมูล model job ที่ถูกล้างเมื่อ Reset โต๊ะ แผน Cloudflare ใช้ Billing Durable Object แยกหนึ่งตัวต่อ deployment บันทึก reservation แบบ atomic ตามราคาสูงสุดและขอบเขต token ก่อนเรียก provider ใช้ job ID เดิมป้องกันจองซ้ำ ตัดยอดตาม usage และเก็บ reservation ไว้เมื่อ timeout ไม่ทราบยอด เพื่อไม่คิดว่า abort ทำให้ provider หยุดคิดเงิน การคืนผลเข้า Room DO ต้องตรวจ job/epoch/revision อีกครั้ง เพราะเป็นคนละ transaction ตั้งเพดานรายวัน/เดือน โควตาต่อผู้ใช้และโต๊ะ และ concurrency limit ที่เซิร์ฟเวอร์ ตัว gateway ปัจจุบันยังมีเพียง daily reservation ใน job JSON จึงยังไม่รับรองเพดานงบ production

DeepSeek หักจาก balance; [Balance API](https://api-docs.deepseek.com/api/get-user-balance/) ใช้ตรวจ availability ได้ แต่ไม่พบเพดานค่าใช้จ่ายราย key/โต๊ะในเอกสารที่ตรวจ การเติมเครดิตหรือใช้ key เดียวกับแอปอื่นจึงไม่เท่ากับเพดานงบ Tabletop

## Key อยู่ที่ไหนเมื่อขึ้นระบบจริง

```text
Browser ── session / คำขอ ──> Cloudflare Worker ── DEEPSEEK_KEY ──> DeepSeek
GitHub  ── source / build ──> Worker deployment     ↑ Worker Secret
```

GitHub เก็บ source และชื่อ configuration ที่ไม่มีค่า credential ตอนรันจริง Cloudflare ใส่ secret ให้ Worker ผ่าน binding เช่น `env.DEEPSEEK_KEY` จึงรันได้แม้ไม่มี key ใน repository ไม่ต้องส่ง key ให้ผู้เล่น หรือใส่ `VITE_DEEPSEEK_KEY` ใน frontend

- ทางที่เสนอ: ใส่เฉพาะ `DEEPSEEK_KEY` ใน [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) ของ Tabletop แล้วฉีดเข้า provider ที่ฝั่งเซิร์ฟเวอร์ หน้าเว็บ static อย่างเดียวไม่สามารถเก็บ key ที่เรียกจาก browser ให้เป็นความลับได้
- ไม่อัปโหลด `.env.deploy.local` ทั้งไฟล์ขึ้น hosting เพราะมี GitHub credential ด้วย ส่งเฉพาะชื่อ/ค่าที่บริการนั้นจำเป็นต้องใช้ ไม่ติดตั้ง GitHub PAT เป็น environment ของเกม
- CI สำหรับ build/test ใช้ mock และ canary ไม่มี production AI key ไม่ต้องนำ DeepSeek key ไปใส่ GitHub Actions หาก deploy ตั้ง runtime secret ที่ hosting โดยตรง
- `.env*` ถูก Git/Docker ignore ยกเว้น `.env.example` ที่เป็นค่าว่าง เพิ่ม `.dev.vars*` เผื่อ Worker local การสแกนปัจจุบันไม่พบค่า credential ใน 304 reachable Git blobs และไฟล์ build 228 ไฟล์ ขอบเขตคือประวัติที่เครื่องนี้มีและ build ที่ตรวจ ไม่ครอบคลุม log หรือสำเนานอกโครงการ

คำขอ AI สาธารณะยังต้องผ่าน session, role, Origin/CSRF และ quota ก่อนถึง provider การซ่อน key อย่างเดียวไม่ป้องกัน endpoint ถูกใช้เกินงบ

## สิ่งที่เจ้าของระบบเตรียม

1. บัญชี Cloudflare ที่จะใช้ พร้อม Account ID และวิธีชำระเงินสำหรับ Workers Paid/R2 เริ่มจาก `workers.dev` จึงยังไม่ต้องซื้อ domain หรือให้สิทธิ์ DNS การมีบัญชีหรือ token ยังไม่ใช่การอนุมัติเริ่มค่าสมาชิก
2. Cloudflare API token เฉพาะ account เป้าหมายตามตารางด้านล่าง หรือเข้าสู่ระบบ Wrangler ในเครื่อง ไม่ต้องใช้ Global API Key ไม่ต้องให้สิทธิ์ billing และไม่ต้องสมัคร Render/Supabase
3. อีเมลบัญชีที่จะเป็นแอดมิน และวงเงินรายเดือนที่อนุมัติ ไม่ต้องส่ง password หรือ key ลงแชต
4. สำหรับ Google login สร้าง OAuth client ชนิด Web application ของ Tabletop หลังทราบ HTTPS origin จริงและ callback ของแอปแล้ว ใช้ Client ID และ Client Secret ตาม [Google OIDC setup](https://developers.google.com/identity/openid-connect/openid-connect) ไม่ต้องให้ Google Cloud service account หรือสิทธิ์ owner ทั้งบัญชี หากจำกัด consent screen เป็น Testing ให้เพิ่มผู้เล่นที่ต้องทดสอบตามข้อกำหนดของ Google

มีไฟล์ `.env.production-setup.local` ที่ root ของ checkout สำหรับ `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, ข้อมูล OAuth, อีเมลแอดมิน และวงเงินที่อนุมัติ ไฟล์นี้ถูก Git ignore และแอปไม่โหลดอัตโนมัติ ช่อง Render/Supabase เก่าที่มีอยู่อาจเว้นว่างไว้ ส่วน `DEEPSEEK_KEY` ใช้จากไฟล์ `.env.deploy.local` เดิมที่ parent workspace ตามที่เจ้าของบันทึกไว้ ไม่คัดลอกไปอีกไฟล์หรือส่งขึ้น Git การตรวจ setup รายงานเฉพาะชื่อและสถานะพร้อมใช้

แบ่งสิทธิ์รอบสร้าง resource ออกจาก deploy ประจำ ไม่ติดตั้ง token ของผู้ดูแลเป็น secret ในเกม:

| งาน | สิทธิ์ที่ต้องใช้ | ขอบเขต |
| --- | --- | --- |
| สร้าง Worker ครั้งแรก | Workers product-level `Admin` | account เป้าหมายเท่านั้น; ถ้าเจ้าของสร้าง Worker ไว้แล้ว ใช้แถวถัดไป |
| Deploy/ตั้ง Worker Secrets ของ Worker ที่มีแล้ว | Workers `Editor` | จำกัด Worker ของ Tabletop; DO ใช้สิทธิ์ของ Worker ที่ประกาศมัน |
| สร้าง/จัดการ D1 และ apply migration | `D1 Write` | เฉพาะรอบและฐานข้อมูลที่อนุมัติ; บางหน้าจอจำกัดได้เพียง account จึงต้องตรวจ scope ก่อนใช้ |
| สร้าง/จัดการ private R2 bucket | `Workers R2 Storage Write` | เฉพาะรอบและ bucket ที่อนุมัติ; runtime ใช้ Worker binding ไม่ต้องสร้าง S3 key |
| Domain ภายหลัง | `Workers Routes Write`; `DNS Write` เฉพาะหากต้องแก้ DNS | เฉพาะ zone ที่เลือก ยังไม่ขอในรอบ `workers.dev` |
| Google login | OAuth Client ID และ Client Secret | Web client ของ Tabletop และ redirect URL ที่ลงทะเบียน |
| DeepSeek | `DEEPSEEK_KEY` ที่ให้แล้ว | เรียก model ฝั่งเซิร์ฟเวอร์ ไม่ใช้เป็นสิทธิ์ deploy; ไม่มีการหมุนหรือเปลี่ยนขอบเขต key |

ชื่อสิทธิ์อ้างอิง [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/), [DO permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/) และ [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) ณ วันที่ตรวจ การ deploy Worker ที่มี bindings ไม่ต้องให้ token เข้าจัดการ D1/R2 โดยตรงเพิ่ม หากไม่ได้ทำ migration หรือจัดการ bucket ในรอบนั้น ตรวจ token กับ resource จริงก่อนใช้ ไม่ขยายสิทธิ์หรือเปลี่ยน credential โดยอัตโนมัติ การผูก Custom Domain ยังมีข้อจำกัดกับ per-Worker roles จึงต้องตรวจ scope ใหม่เมื่อเลือก domain

## งานก่อนเปิดให้ทีมเข้า

1. เพิ่ม Workers entrypoint กับ Static Assets และ Room/Billing DO แยก storage ตามหน้าที่ พอร์ต PostgreSQL row-lock/transaction เป็น DO SQLite transaction โดยรักษา command receipt, epoch/revision, audit และ visibility invariants ให้ผ่านชุดทดสอบเดิม
2. เตรียม D1/DO schema migration สำหรับ resource ใหม่เฉพาะ Tabletop และ outbox/reconciliation สำหรับดัชนี D1 กับ lifecycle ของ R2 ห้ามให้ browser เรียกฐานข้อมูลหรือ bucket ข้าม authority; resource/schema ยังไม่ถูกสร้างจริง
3. เพิ่ม Google login/session, รับคำเชิญหลังล็อกอิน, My tables, Resume, การคืนที่นั่งโดย DM และ admin เปลี่ยน retention ของโต๊ะแยกจาก session โดยรักษา local demo เดิม ตรวจ session/revocation สำหรับทั้ง HTTP และ WebSocket รวมถึงขณะ connection เปิดค้าง
4. ทดสอบ Workers runtime จริงใน local emulator และ staging, user/DM/admin isolation, CSRF/Origin, rate limit ที่แยกบัญชี/โต๊ะ/IP จาก edge ที่เชื่อถือได้, hibernation, alarm ที่มาช้า/ซ้ำ, pause, reconnect, duplicate command, logout และการเก็บโต๊ะข้ามอายุ login เปิดคนละ browser/เครื่องแล้วต้องกลับตัวละครเดิมได้
5. เชื่อม DeepSeek adapter กับ authenticated jobs และ draft dispatch แบบ atomic ภายใน Room DO ที่ตรวจ epoch/revision/role อีกครั้ง เพิ่ม UI แสดงข้อมูลที่จะส่งและการยินยอม ขยาย schema จาก invoice ไป teaching/encounter แยก narration ที่แก้ state ไม่ได้ และเชื่อม Billing DO ที่จองงบก่อน network call ก่อนเปิด model capability
6. ทดสอบ holdout ทั้งสาม workflow, prompt injection, invalid JSON, duplicate/reset/cancel/restart, 402/429/503, quota concurrency และ latency จาก hosting จริง ตรวจข้อตกลงการใช้ข้อมูลของ [DeepSeek Open Platform](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) ก่อนใช้ข้อมูลลูกค้า ขณะนี้ทดสอบด้วยข้อมูลสังเคราะห์ ไม่ถือว่า API stateless หมายถึงไม่มี retention/training
7. พอร์ต private storage ไป R2 และเลือก PDF runtime ที่ทดสอบข้อจำกัดแล้ว ถ้า parser/scanning ยังไม่ผ่าน ให้ capability ระบุว่าใช้ไม่ได้ตามจริง ไม่เปิด public uploads ด้วยการมี bucket อย่างเดียว วัด load และค่าใช้จ่ายรวม Worker/DO/Billing DO/D1/R2 จาก staging
8. ก่อนสร้างบริการคิดเงินและ apply schema ให้แสดง account/resource เป้าหมาย, location/jurisdiction ที่รองรับจริง, รายการบริการ, ราคาฐาน, migration diff และแผน rollback ที่แน่นอน ฐานข้อมูลใหม่ต้องไม่มีข้อมูลธุรกิจเดิม หากพบข้อมูลเดิมต้องหยุดตรวจ scope อีกครั้ง
9. Deploy commit ที่ผ่าน CI ตั้ง HTTPS และ `/readyz` ตรวจไฟล์ที่ serve เทียบกับ build ทดสอบแยกเครื่องจริง และทดลอง backup/restore ให้ state/ดัชนี/file references สอดคล้องกันก่อนเปิดคำเชิญ เก็บ release ก่อนหน้าและใช้ migration ที่รองรับ rollback ของโค้ดโดยไม่ย้อนทับการเล่นใหม่

PR ปัจจุบันยังเป็น local candidate การทำตามแผนนี้ไม่รวมการ merge PR อัตโนมัติ เจ้าของอนุมัติให้รวม AI จริงใน milestone นี้แล้ว แต่การมี key และ provider adapter ยังไม่ใช่การเปิด AI ในหน้าแอป ยังไม่เปิด public uploads และไม่รับรอง production จนกว่างาน integration กับ hosted verification ข้างต้นผ่าน
