# Tabletop production setup and resume

สถานะวันที่ 18 ตุลาคม 2026: **Cloudflare implementation candidate ในเครื่อง** มี Workers API/Static Assets, Room/Billing Durable Objects, D1, Google login, resume, multiplayer, admin metadata และ AI draft แล้ว ยังไม่ได้สร้าง resource บน Cloudflare, apply production schema, อัปโหลด secret หรือ deploy ระบบจริง ดู [ขอบเขตเปิดระบบและผลทดสอบ](CLOUDFLARE_RELEASE.md)

## ระบบที่ใช้

| งาน | บริการและพฤติกรรม |
| --- | --- |
| หน้าเว็บ/API | Workers Static Assets และ Worker ที่ origin เดียว |
| ห้องและสมาชิก | SQLite Durable Object หนึ่งตัวต่อห้อง เป็นผู้ตัดสิน state, role, revision, receipt และคำเชิญ |
| Multiplayer | WebSocket Hibernation ส่ง projection ตามสิทธิ์ และตรวจ session/revocation จาก D1 primary ก่อนส่งข้อมูลส่วนตัว |
| Google account/resume | D1 เก็บบัญชีถาวร, session hash และดัชนีห้อง; ตรวจ Google OIDC state/PKCE/nonce/signature/issuer/audience |
| Admin | ดู metadata ห้องและสมาชิก ไม่เปิด DM notes หรือคำตอบส่วนตัว |
| AI | DeepSeek Flash ฝั่งเซิร์ฟเวอร์ กับ Billing Durable Object จองงบก่อนเรียกและ settle usage แบบไม่ซ้ำ |
| อัปโหลดไฟล์ | ปิดไว้ใน Cloudflare จนกว่า private R2, scanning และ parser จะพร้อม; Node local ยังใช้ไฟล์ตัวอย่างได้ |

Supabase และ Render ไม่จำเป็นสำหรับทางนี้ สิทธิ์ของห้องตรวจที่ Room DO เสมอ ดัชนี D1 ใช้ค้นหาเท่านั้นและซ่อมผ่าน outbox ที่เรียงลำดับแล้ว ความล่าช้าของดัชนีต้องไม่เปิดสิทธิ์ให้ผู้ที่ถูกถอนออก

## ปิดเว็บแล้วกลับมา

- ปิดแท็บ: ห้องและข้อมูลที่เซิร์ฟเวอร์รับแล้วยังอยู่ ผู้เล่นอื่นเล่นต่อได้
- เปิดใหม่: กลับห้องล่าสุดหรือเลือก My tables; ถ้า cookie หมดอายุให้ล็อกอิน Google บัญชีเดิม
- เปลี่ยนเครื่องหรือล้าง cookie: Google บัญชีเดิมได้สมาชิกและที่นั่งเดิม ไม่ต้องใช้คำเชิญใหม่
- Logout: เพิกถอน session ของเครื่องนั้น ไม่ลบเกมหรือบัญชี
- Session: idle 24 ชั่วโมง / อายุสูงสุด 7 วัน; ห้อง Cloudflare ไม่หมดอายุเพราะ session หมดอายุ
- Pause: DM กดหยุดและบันทึกเวลาปฏิกิริยาที่เหลือ การปิด browser อย่างเดียวไม่ pause
- Reset: ล้างเนื้อหาเดิมในห้อง เพิ่ม epoch และถอนสมาชิกที่รับเชิญ เป็นการกระทำแยกจาก Logout

Resume คืนสถานะล่าสุด ไม่ย้อนเวลาให้ผู้เล่นที่หลุด และไม่รับประกันข้อความหรือฟอร์มที่ยังไม่ส่ง ตัว Node local เดิมยังเป็น guest และห้องหมดอายุ 7 วันตามเดิม ระบบลบบัญชี/นโยบาย retention ที่ผู้ใช้ปรับเองยังไม่อยู่ในรอบนี้

## AI ที่เปิดในรอบนี้

ใช้ `deepseek-flash` สร้างข้อเสนอที่มี schema สำหรับ invoice, teaching และ encounter ตามที่เจ้าของเลือก ผู้ใช้เห็นขอบเขตข้อมูลและกดยินยอมก่อนส่ง Invoice ใช้เฉพาะแหล่งข้อมูลที่ตรวจแล้วซึ่งผู้ใช้เลือก ไม่ส่งโน้ต DM, คำตอบส่วนตัว หรือประวัติทั้งห้อง

AI สร้างเพียง draft จากนั้นต้อง simulate, validate, อนุมัติ และ activate ตามขั้นตอน ระบบเกม คำนวณเงิน และตรวจสิทธิ์ยังเป็นโค้ด deterministic ไม่มีการรัน JavaScript ที่โมเดลเขียน

งบรายวัน/เดือนต้องเป็นค่าบวกจึงเปิด AI ค่าเริ่มต้นเป็นศูนย์ Billing DO กันงบก่อน network call, ป้องกัน dispatch ซ้ำ, คิด cache-hit ด้วย และเก็บเงินจองไว้เมื่อไม่รู้ผลลัพธ์แน่ชัด การจำกัดนี้ครอบคลุมเฉพาะการเรียกจาก Tabletop ไม่ครอบคลุม key เดียวกันที่นำไปใช้ที่อื่น

ผล live API ก่อนหน้านี้อยู่ใน [AI provider verification](AI_PROVIDER_VERIFICATION.md) ส่วน end-to-end ล่าสุดใน emulator ใช้คำตอบจำลอง ยังต้องตรวจ Google login และ AI จาก URL production จริง

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

## Credential และสิ่งที่ต้องอนุมัติ

ไฟล์ local เดิมที่เจ้าของใช้คือ `.env.deploy.local` ใน parent workspace ไม่อัปโหลดไฟล์นี้ทั้งไฟล์ ไม่คัดลอกค่าไปใน source หรือ frontend

| ชื่อ | การใช้ |
| --- | --- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | ใช้จากเครื่องผู้ดูแลสำหรับสร้าง resource/deploy ไม่ติดตั้งเป็น secret ของเกม |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | ส่งเป็น Worker Secrets ของ Tabletop |
| `TABLETOP_ADMIN_EMAIL` | bootstrap admin จาก Google account ที่ตรวจแล้วและ pin subject |
| `DEEPSEEK_KEY` | Worker Secret ใช้เรียก provider ฝั่งเซิร์ฟเวอร์ |
| `GITHUB_TOKEN` | ใช้ส่ง source ไป repository ที่ระบุ ไม่ส่งขึ้น Cloudflare |
| `APPROVED_MONTHLY_INFRA_BUDGET_USD`, `APPROVED_MONTHLY_AI_BUDGET_USD`, `APPROVED_MONTHLY_TOTAL_BUDGET_USD` | บันทึกวงเงินที่เจ้าของอนุมัติ ปัจจุบันยังไม่ได้รับอนุมัติ |

Target origin: `https://tabletop.ptchrr.workers.dev` และ Google Authorized redirect URI: `https://tabletop.ptchrr.workers.dev/api/auth/google/callback` ต้องตรงกันทุกตัว โค้ดและ credential readiness ผ่านการตรวจในเครื่อง แต่ยังไม่ได้ลองล็อกอิน Google จริงที่ URL นี้

GitHub เก็บโค้ดและชื่อ configuration Cloudflare ฉีด secret ให้ Worker ตอนรัน จึงไม่ต้องมี API key ใน GitHub หรือ `VITE_*` CI ใช้ synthetic credentials และไม่มีสิทธิ์ deploy ดู [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

รอบแรกต้องอนุมัติ resource/schema ใหม่และวงเงินตาม [release scope](CLOUDFLARE_RELEASE.md) ก่อน: Worker `tabletop`, D1 `tabletop-production`, และ SQLite DO `Room`/`Billing` ไม่แก้ฐานข้อมูลเดิม ไม่เปิด R2/upload ในรอบนี้ การมี API token ไม่ใช่หลักฐานว่า plan paid พร้อมหรืออนุมัติค่าใช้จ่ายแล้ว

Token ต้องจัดการ Worker เป้าหมายและ D1 ที่อนุมัติได้ ไม่ต้องให้สิทธิ์ DNS, Google service account, Global API Key หรือ billing เพื่อทดสอบและ deploy ที่ workers.dev หากต้องเปิด Workers Paid เจ้าของทำขั้นตอนชำระเงินใน Cloudflare ได้ ตรวจสิทธิ์ที่ใช้งานจริงก่อนทำ ไม่ขยายสิทธิ์ token อัตโนมัติ

หลังอนุมัติจึงสร้างฐานใหม่และ apply migration, ตั้ง secret ที่ host, deploy commit ที่ผ่าน CI, ตรวจ served assets/HTTPS, ให้เจ้าของล็อกอิน Google, ตรวจสองบัญชี/สองเครื่อง, AI จริงแบบจำกัดจำนวน และทดสอบ rollback/restore ก่อนถือว่าพร้อมใช้งานจริง ไม่มีการ merge PR อัตโนมัติ
