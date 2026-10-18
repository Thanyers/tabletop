# Tabletop production setup and resume plan

วันที่ 18 ตุลาคม 2026 ตามเวลา Asia/Bangkok แผนนี้เสนอการเปิดให้ทีมที่ได้รับเชิญเล่นผ่านอินเทอร์เน็ต มีบัญชีสำหรับกลับมาเล่นต่อ หน้าผู้ดูแล และ AI จริงตามที่เจ้าของระบบเลือกแล้ว สถานะ infrastructure คือ **Proposed** ยังไม่ได้สร้างบริการ hosting หรือเริ่มค่าสมาชิก ฟังก์ชันบัญชี แอดมิน และ AI ในหน้าแอปด้านล่างยังไม่ได้เชื่อมต่อครบ

เจ้าของระบบให้ใช้ DeepSeek และบันทึก `DEEPSEEK_KEY` ในไฟล์ local เดิมแล้ว การตรวจ credential กับ `GET /models` ของ DeepSeek ผ่าน HTTP 200 และเห็น `deepseek-flash` กับ `deepseek-v4-pro` การตรวจนี้ยืนยันการเข้าถึง API ไม่ใช่ผลทดสอบคุณภาพหรือโหลดของแอป ดูผลทดสอบเพิ่มเติมที่ [AI provider verification](AI_PROVIDER_VERIFICATION.md)

## ระบบที่เสนอ

ใช้ Render รัน Node HTTP และ WebSocket พร้อมหน้าเว็บจาก origin เดียว และใช้ Supabase Pro สำหรับ PostgreSQL กับระบบยืนยันตัวตน เลือก Singapore เมื่อทั้งสองบัญชีมี region นี้ให้สร้างได้ ใช้ Google sign-in ผ่าน Supabase Auth เป็นค่าแนะนำ ผู้เล่นเข้าด้วยบัญชีแล้วรับคำเชิญเข้าโต๊ะ เก็บสิทธิ์และสถานะเกมที่เซิร์ฟเวอร์

เริ่มด้วย Node หนึ่ง instance ขนาด 1 CPU / 2 GB และ Supabase หนึ่ง Micro project เป็นขนาดตั้งต้นสำหรับทดสอบทีมเล็ก ยังไม่ใช่ผล load test หรือระบบ HA ผู้เล่นใน Tabletop ไม่นับเป็นผู้ดูแลบัญชี Render ใช้ Render workspace แบบ Hobby ได้เมื่อมีผู้ดูแล hosting คนเดียว

Cloudflare ไม่ใช่ข้อกำหนดของทางนี้ จึงยังไม่ต้องสร้าง Cloudflare key ใช้ URL HTTPS ที่ hosting ให้ก่อน ระบบ multiplayer และการ resume ไม่ต้องเรียก AI ส่วนการอัปโหลดไฟล์สาธารณะยังต้องมี private storage และงานตรวจไฟล์ก่อนเปิดใช้

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

เพิ่ม Pause/Resume ที่ DM ควบคุมและบันทึกระยะเวลาที่เหลือของ reaction อย่างชัดเจน ปัจจุบันตัวจับเวลา 30 วินาทียังเดินต่อเมื่อ browser ปิด การกลับมาหลังหมดเวลาจึงไม่เปิดสิทธิ์ react ย้อนหลัง ต้องทดสอบการ pause, reconnect และ deploy ระหว่าง action ก่อนเปิดจริง

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

สมมติว่ามี production app หนึ่ง instance, Supabase หนึ่ง project และผู้ดูแล Render คนเดียว ราคาหน่วยเป็น USD ก่อนภาษีและค่าธรรมเนียมบัตร ค่า AI แยกตามจำนวน token ด้านล่าง ยังไม่รวมรับไฟล์สาธารณะ

| รายการ | แผน | USD ต่อเดือน |
| --- | --- | ---: |
| Render workspace | Hobby ผู้ดูแล 1 คน | 0 |
| Node และ WebSocket | 1c-2g เดิมเรียก Standard | 25 |
| PostgreSQL และ Auth | Supabase Pro พร้อม Micro 1 project | 25 |
| **รวมฐาน** | | **50** |

ราคา Render อ้างอิง [Pricing](https://render.com/pricing) และชื่อขนาดจาก [Compute plans](https://render.com/docs/compute-plans) ส่วนเงื่อนไข workspace ดู [Platform features](https://render.com/docs/platform-features-by-plan) Supabase Pro รวมเครดิต compute 10 USD ที่ครอบคลุม Micro หนึ่ง project มี database disk 8 GB และ daily backup เก็บ 7 วัน ตาม [Supabase pricing](https://supabase.com/pricing)

Render Hobby รวม outbound bandwidth 5 GB ต่อเดือน ส่วนเกินคิด 0.15 USD ต่อ GB ตาม [Outbound bandwidth](https://render.com/docs/outbound-bandwidth) เมื่อปริมาณส่วนอื่นยังอยู่ในโควตา:

- 10 GB billable outbound จาก Render: 50 + (10 - 5) x 0.15 = **50.75 USD**
- 100 GB billable outbound จาก Render: 50 + (100 - 5) x 0.15 = **64.25 USD**

เสนอวงเงิน infrastructure **60 USD ต่อเดือน** และ AI **10 USD ต่อเดือน** รวมวงเงินวางแผน **70 USD หรือประมาณ 2,450 บาท** ที่อัตราตั้งงบ 35 บาทต่อ USD อัตรานี้เป็นสมมติฐาน ไม่ใช่อัตราแลกเปลี่ยนปัจจุบันหรืออัตราที่บัตรจะเรียกเก็บ วงเงินยังไม่ได้รับอนุมัติ และไม่ใช่ hard cap ของ hosting ต้องตั้งการแจ้งเตือนและโควตาที่รองรับจริง

ถ้าต้องให้หลายคนเข้าหน้าจัดการ Render ใช้ Pro workspace เพิ่ม 25 USD ทำให้ฐานเป็น **75 USD ต่อเดือน** ทางประหยัดใช้ Node 0.5c-512mb เดิมเรียก Starter ที่ 7 USD รวมฐาน **32 USD** แต่ต้องวัดหน่วยความจำและทดสอบก่อนลดขนาด

งบนี้ไม่รวม domain ที่ซื้อเอง, อีเมลส่งออกหากเลือก email login, malware scanning, backup เพิ่มเติม, project ทดสอบที่เปิดค้าง และส่วนเกินโควตาของแต่ละบริการ Supabase daily backup ไม่ได้หมายถึงกู้ได้ทุกวินาที และไม่ครอบคลุมไฟล์ใน object storage ตาม [Database backups](https://supabase.com/docs/guides/platform/backups) ส่วน [Spend Cap](https://supabase.com/docs/guides/platform/cost-control) ไม่ครอบคลุมค่าใช้จ่ายทุกประเภท ต้องตรวจรายการที่คุมได้ก่อนใช้งาน

### ค่า AI ที่ใช้ตั้งงบ

ราคา `deepseek-flash` ต่อ 1M tokens จาก [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/):

| รายการ | Off-peak USD | Peak USD |
| --- | ---: | ---: |
| Input cache miss | 0.15 | 0.30 |
| Input cache hit | 0.003 | 0.006 |
| Output รวม reasoning เมื่อเปิด thinking | 0.60 | 1.20 |

Peak ตามเวลาไทยคือ 08:00–11:00 และ 13:00–17:00 จันทร์–ศุกร์ ยกเว้นวันหยุดจีน นอกนั้นเป็น off-peak ใช้ราคา peak และไม่คิดส่วนลด cache ในการตั้งเพดานไว้ก่อน

ตัวอย่าง non-thinking หนึ่งคำขอมี input 3,000 + output 500 tokens ไม่มี retry ไม่มี tools และไม่นับรูปภาพ: ค่าใช้จ่าย **0.00075–0.00150 USD ต่อคำขอ**

| จำนวนคำขอต่อเดือน | ค่า AI USD | รวมฐาน hosting 50 USD | บาทที่ 35 บาท/USD |
| ---: | ---: | ---: | ---: |
| 1,000 | 0.75–1.50 | 50.75–51.50 | 1,776.25–1,802.50 |
| 6,000 | 4.50–9.00 | 54.50–59.00 | 1,907.50–2,065.00 |
| 10,000 | 7.50–15.00 | 57.50–65.00 | 2,012.50–2,275.00 |

จำนวน token เป็นสมมติฐานของ workload ไม่ใช่ผลวัดทุก workflow และไม่ใช่ใบเรียกเก็บจาก provider ข้อความยาว reasoning ภาพ และ retry เพิ่มค่าใช้จ่าย ต้องเก็บ usage จริง โดยไม่ log ข้อความหรือ key

ก่อนเปิดใช้จริง ต้องมี cost ledger ถาวรแยกจากข้อมูล model job ที่ถูกล้างเมื่อ Reset โต๊ะ เก็บ reservation แบบ atomic ตามราคาสูงสุดและขอบเขต token, ตัดยอดตาม usage และเก็บ reservation ไว้เมื่อ timeout ไม่ทราบยอด เพื่อไม่คิดว่า abort ทำให้ provider หยุดคิดเงิน ตั้งเพดานรายวัน/เดือน โควตาต่อผู้ใช้และโต๊ะ และ concurrency limit ที่เซิร์ฟเวอร์ ตัว gateway ปัจจุบันยังมีเพียง daily reservation ใน job JSON จึงยังไม่รับรองเพดานงบ production

DeepSeek หักจาก balance; [Balance API](https://api-docs.deepseek.com/api/get-user-balance/) ใช้ตรวจ availability ได้ แต่ไม่พบเพดานค่าใช้จ่ายราย key/โต๊ะในเอกสารที่ตรวจ การเติมเครดิตหรือใช้ key เดียวกับแอปอื่นจึงไม่เท่ากับเพดานงบ Tabletop

## Key อยู่ที่ไหนเมื่อขึ้นระบบจริง

```text
Browser ── session / คำขอ ──> Tabletop server ── DEEPSEEK_KEY ──> DeepSeek
GitHub  ── source / build ──> Hosting           ↑ runtime secret
```

GitHub เก็บ source และชื่อ configuration ที่ไม่มีค่า credential ตอนรันจริง hosting ใส่ค่า secret ให้ process ฝั่งเซิร์ฟเวอร์ จึงรันได้แม้ไม่มี key ใน repository ไม่ต้องส่ง key ให้ผู้เล่น หรือใส่ `VITE_DEEPSEEK_KEY` ใน frontend

- ทางที่เสนอ: ใส่เฉพาะ `DEEPSEEK_KEY` ใน [Render Environment/Secrets](https://render.com/docs/configure-environment-variables) ของบริการ Tabletop แอปอ่านจาก environment ตอนรัน
- ถ้าเลือก Cloudflare Worker เป็น AI backend: ใส่ค่าใน [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) แล้วให้ Worker เรียก DeepSeek หน้าเว็บแบบ static อย่างเดียวไม่สามารถเก็บ key ที่ใช้เรียกจาก browser ให้เป็นความลับได้ การใช้ Cloudflare เป็น DNS/CDN ไม่ย้าย key จาก Node server ไป Worker ให้อัตโนมัติ
- ไม่อัปโหลด `.env.deploy.local` ทั้งไฟล์ขึ้น hosting เพราะมี GitHub credential ด้วย ส่งเฉพาะชื่อ/ค่าที่บริการนั้นจำเป็นต้องใช้ ไม่ติดตั้ง GitHub PAT เป็น environment ของเกม
- CI สำหรับ build/test ใช้ mock และ canary ไม่มี production AI key ไม่ต้องนำ DeepSeek key ไปใส่ GitHub Actions หาก deploy ตั้ง runtime secret ที่ hosting โดยตรง
- `.env*` ถูก Git/Docker ignore ยกเว้น `.env.example` ที่เป็นค่าว่าง เพิ่ม `.dev.vars*` เผื่อ Worker local การสแกนปัจจุบันไม่พบค่า credential ใน 304 reachable Git blobs และไฟล์ build 228 ไฟล์ ขอบเขตคือประวัติที่เครื่องนี้มีและ build ที่ตรวจ ไม่ครอบคลุม log หรือสำเนานอกโครงการ

คำขอ AI สาธารณะยังต้องผ่าน session, role, Origin/CSRF และ quota ก่อนถึง provider การซ่อน key อย่างเดียวไม่ป้องกัน endpoint ถูกใช้เกินงบ

## สิ่งที่เจ้าของระบบเตรียม

1. บัญชี Render และ Supabase พร้อมวิธีชำระเงิน ติดตั้งและเชื่อมต่อบริการทั้งสองกับ Codex หากเลือกใช้ connector ความสามารถที่ทำได้ต้องตรวจหลังเชื่อมต่อจริง
2. อนุญาต Render GitHub App ให้เข้าถึง repository **Thanyers/tabletop** เท่านั้น หาก deploy จาก private Git repository โดยตรง การมี GitHub token ในเครื่องไม่ทำให้ Render ได้สิทธิ์นี้อัตโนมัติ ดู [Git provider integration](https://render.com/docs/git-provider)
3. อีเมลบัญชีที่จะเป็นแอดมิน และวงเงินรายเดือนที่อนุมัติ ไม่ต้องส่ง password หรือ key ลงแชต
4. สำหรับ Google login สร้าง OAuth client ชนิด Web application ใน project สำหรับ Tabletop หลังทราบ origin จริงและ Supabase callback URL แล้ว ต้องใช้ Client ID และ Client Secret ตาม [Google login configuration](https://supabase.com/docs/guides/auth/social-login/auth-google) ไม่ต้องให้ Google Cloud service account หรือสิทธิ์ owner ทั้งบัญชี

มีไฟล์ `.env.production-setup.local` ที่ root ของ checkout สำหรับใส่ค่าที่ connector ทำแทนไม่ได้ ไฟล์นี้ถูก Git ignore และแอปไม่โหลดอัตโนมัติ ส่วน `DEEPSEEK_KEY` ใช้จากไฟล์ `.env.deploy.local` เดิมที่ parent workspace ตามที่เจ้าของบันทึกไว้ ไม่คัดลอกไปอีกไฟล์หรือส่งขึ้น Git การตรวจ setup รายงานเฉพาะชื่อและสถานะพร้อมใช้

หาก connector ไม่ครอบคลุมการตั้งค่าที่จำเป็น ใช้ credential เฉพาะงานดังนี้:

| บริการ | Credential สำรอง | ขอบเขต |
| --- | --- | --- |
| Render | API key จาก Account Settings | ใช้ workspace Tabletop โดยเฉพาะ ตรวจขอบเขตในหน้าสร้าง key เพราะเอกสารเก่าและใหม่ระบุขอบเขตต่างกัน ไม่มีสิทธิ์ราย action ที่ยืนยันได้ |
| Supabase | Scoped Personal Access Token | จำกัด organization/project Tabletop และเลือกเฉพาะสิทธิ์ตามงาน หลีกเลี่ยง Legacy token ที่ครอบคลุมทุก project |
| PostgreSQL runtime | URL/credential ของ runtime role | เฉพาะ private schema และคำสั่งที่แอปต้องใช้ ไม่มี DDL เก็บเป็น `DATABASE_URL` ที่ hosting |
| PostgreSQL migration | URL/credential ของ migration role แยก | ใช้เฉพาะรอบ apply migration ที่อนุมัติ ไม่ส่งให้ game process; ถอนสิทธิ์เมื่อจบโดยขออนุมัติตามขอบเขต |
| Google login | OAuth Client ID และ Client Secret | Web client ของ Tabletop และ redirect URL ที่ลงทะเบียน |
| DeepSeek | `DEEPSEEK_KEY` ที่ให้แล้ว | เรียก model ฝั่งเซิร์ฟเวอร์ ไม่ใช้เป็นสิทธิ์ deploy; ไม่มีการหมุนหรือเปลี่ยนขอบเขต key |

หน้า [Render API keys](https://dashboard.render.com/u/settings/api-keys), [Render key scope](https://render.com/tutorials/render-cli-power-user/auth-and-workspaces), [Supabase tokens](https://supabase.com/dashboard/account/tokens) และ [Supabase permission scopes](https://supabase.com/docs/guides/platform/personal-access-tokens) เป็นจุดตั้งค่าที่ใช้อ้างอิง สิทธิ์สำหรับ project ที่มีอยู่จะเริ่มจาก Project Settings และ Auth Config แบบ Read-write, Database และ Migrations ตามการติดตั้งที่อนุมัติ, API Keys/Logs/Backups แบบ Read เพิ่มสิทธิ์สร้าง project เฉพาะเมื่อให้สร้างใน organization เป้าหมาย การมี token ไม่ถือเป็นการอนุมัติให้เปลี่ยน billing หรือฐานข้อมูลอื่น

Supabase PAT ไม่ได้ส่งมอบหรือจำกัด PostgreSQL password โดยอัตโนมัติ โค้ดปัจจุบันใช้ `pg.Pool` และ migration ใช้ connection string โดยตรง จึงต้องเตรียม runtime กับ migration URL แยกกันตาม role จริง ไม่อ้างสิทธิ์ PAT ว่าเป็นตัวจำกัด SQL ที่ใช้ database credential

## งานก่อนเปิดให้ทีมเข้า

1. เพิ่มบัญชีผู้ใช้ การรับคำเชิญหลังล็อกอิน My tables, Resume, การคืนที่นั่งโดย DM และหน้า admin เปลี่ยนการเก็บโต๊ะให้แยกจากอายุ session โดยรักษา local demo เดิม
2. เตรียม migration สำหรับฐานข้อมูลใหม่เฉพาะ Tabletop เก็บตารางเกม/session ใน private schema ที่ไม่ถูกเปิดผ่าน Supabase Data API ใช้ runtime role จำกัดสิทธิ์ แยกจาก migration role และทดสอบว่าผู้เล่นอ่านข้อมูลตรงข้ามการตรวจสิทธิ์ของเซิร์ฟเวอร์ไม่ได้
3. แก้การจำกัดคำขอหลัง reverse proxy ให้แยกผู้เล่นได้อย่างถูกต้อง ตรวจ TLS ของ PostgreSQL และเลือก direct/session-pooler connection ตาม network ที่ใช้จริง ดู [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
4. ทดสอบ container, persistent PostgreSQL, session rotation, logout/revocation, user/DM/admin isolation, เปิด browser ใหม่, เปลี่ยนเครื่อง, reconnect และคำสั่งซ้ำ รวมถึง DM pause และการเก็บโต๊ะข้ามอายุ login
5. เชื่อม DeepSeek adapter กับ authenticated jobs และ draft dispatch แบบ atomic ที่ตรวจ epoch/revision/role อีกครั้ง เพิ่ม UI แสดงข้อมูลที่จะส่งและการยินยอม ขยาย schema จาก invoice ไป teaching/encounter และแยก narration ที่แก้ state ไม่ได้ เชื่อม cost ledger และ update Docker packaging ก่อนเปิด model capability
6. ทดสอบ holdout ทั้งสาม workflow, prompt injection, invalid JSON, duplicate/reset/cancel/restart, 402/429/503, quota concurrency และ latency จาก hosting จริง ตรวจข้อตกลงการใช้ข้อมูลของ [DeepSeek Open Platform](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) ก่อนใช้ข้อมูลลูกค้า ขณะนี้ทดสอบด้วยข้อมูลสังเคราะห์ ไม่ถือว่า API stateless หมายถึงไม่มี retention/training
7. ก่อนสร้างบริการคิดเงินและ apply schema ให้แสดงบัญชี target, region, รายการบริการ, ราคาฐาน, migration diff และแผน rollback ที่แน่นอน ฐานข้อมูลใหม่ต้องไม่มีข้อมูลธุรกิจเดิม หากพบข้อมูลเดิมต้องหยุดตรวจ scope อีกครั้ง
8. Deploy commit ที่ผ่าน CI ตั้ง HTTPS และ `/readyz` ตรวจไฟล์ที่ serve เทียบกับ build ทดสอบแยกเครื่องจริง และทดลอง backup/restore ก่อนเปิดคำเชิญให้ทีม เก็บ release ก่อนหน้าเพื่อ rollback โดยไม่ย้อนทับการเล่นใหม่

PR ปัจจุบันยังเป็น local candidate การทำตามแผนนี้ไม่รวมการ merge PR อัตโนมัติ เจ้าของอนุมัติให้รวม AI จริงใน milestone นี้แล้ว แต่การมี key และ provider adapter ยังไม่ใช่การเปิด AI ในหน้าแอป ยังไม่เปิด public uploads และไม่รับรอง production จนกว่างาน integration กับ hosted verification ข้างต้นผ่าน
