# MEMORY.md — Tabletop

บันทึกบทเรียนและกับดักของโปรเจกต์นี้ (เฉพาะโปรเจกต์ ไม่ใช่ global) · รูปแบบ: **what happened / root cause / correct behavior**
"correct behavior" ต้องเป็นสิ่งที่ทำได้ทันที ไม่ใช่ความรู้สึก · ห้ามใส่ secret, ID จริง หรือข้อมูลผู้ใช้ — repo นี้ public

## Lessons

### 2026-10-20 — การบันทึกตำแหน่งพื้นหลังต้องไม่ล็อกแชท
- **What happened:** แชทพร้อมส่งและ AI เปิดอยู่ แต่หลังขยับการ์ด textarea กับ Send ถูกปิดจนผลบันทึกตำแหน่งกลับมา
- **Root cause:** `canvas.layout` ใช้ busy state เดียวกับคำสั่งเล่น ทั้งที่มีคิวและ revision แยกอยู่แล้ว; ผลตอบรับของ layout ยังอาจล้าง busy ของคำสั่งอื่น
- **Correct behavior:** ให้ layout ไม่ตั้งหรือล้าง foreground busy และคง queue/CAS/scope guards เดิม; รัน `npm run build`, `npm run build:cloudflare`, `npm run test:cloudflare:browser` โดยกรณี regression ต้องค้าง ACK ที่เซิร์ฟเวอร์รับแล้ว ตรวจว่า Send เปิด consent ได้ และ Cancel ไม่ส่งคำขอ AI

### 2026-10-20 — Browser harness ต้องเดินตามมุมมองปัจจุบันของ Canvas
- **What happened:** หลังรวมผังร่วม เทสต์วัดการซูมระหว่างที่ระบบยังบันทึกผังเริ่มต้น; เทสต์ Retry พยายามกดการ์ดที่พ้นจอหลังเปิดวัตถุอื่น และเทสต์ Reset กดปิดเมนูที่เปิดอยู่แล้ว
- **Root cause:** สมมติว่าผังเริ่มต้นจบแล้ว การ์ดเดิมยังอยู่ในจอ และเมนูเริ่มปิดเสมอ; ชื่อดิบ `Shared Table` อาจต่างจากชื่อโปรแกรมที่ผู้ใช้เห็น
- **Correct behavior:** รอ shared positions ก่อนเก็บ baseline, เปิดการ์ดผ่าน Objects, ตั้งสถานะเมนูตามที่อ่านได้จริง และใช้ชื่อโต๊ะที่แสดง; คง full-domain equality, zero-mutation, explicit consent และ retry payload assertions แล้วรัน `npm run test:cloudflare:browser` กับ `npm run test:generative:browser`

### 2026-10-20 — ผังร่วมต้องรองรับโต๊ะว่างและไม่เผยร่างส่วนตัว
- **What happened:** การจัดผังครั้งเดียวจำว่าเสร็จก่อนมี shared card หรือก่อนตอบรับ ทำให้การ์ดที่เพิ่มทีหลังไม่ถูกแชร์; Rules ก่อนเปิดใช้ถูกอนุญาตให้มี geometry ร่วมทั้งที่เนื้อหาร่างเป็นของเจ้าของ
- **Root cause:** ใช้ room key เป็นตัวจบการ seed แทนผลยืนยันรายวัตถุ และเลือก shared ID โดยไม่ดูว่ากฎเปิดใช้แล้วหรือยัง
- **Correct behavior:** seed เฉพาะ shared cards ที่ยังไม่มีตำแหน่งตาม scope ปัจจุบันและผลยืนยัน; เก็บ Rules ก่อนเปิดใช้เป็นส่วนตัวทั้ง UI/authority/projection แล้วรัน `npx vitest run src/tabletop/domain/canvas-layout.test.ts`, `npm run test:cloudflare:browser` และ `npm run test:generative:browser` บน bundle เดียวกัน

### 2026-10-20 — Retry แชทต้องใช้คำขอเดิม และผล refresh ต้องตรงกับผู้ใช้ปัจจุบัน
- **What happened:** การส่งที่ไม่ทราบผลอาจเกิดก่อน revision เปลี่ยน และ projection ที่โหลดช้าอาจกลับมาหลัง reset หรือเปลี่ยนผู้ใช้
- **Root cause:** ใช้ command ID เดิมแต่สร้าง body จาก view ใหม่ หรือเทียบเพียง room ID ก่อนติดตั้งผลโหลด ไม่พอสำหรับ idempotency และการแยกข้อมูล
- **Correct behavior:** เก็บ request snapshot ในหน่วยความจำเพื่อ retry ด้วย body เดิม; ตรวจ room/epoch/actor/role/seat และลำดับ projection ก่อนใช้ผล refresh แล้วรัน `npx vitest run src/tabletop/ui/table-chat-state.test.ts` กับ `npm run test:cloudflare:browser`

### 2026-10-20 — เทสต์แชทใหม่ต้องตรวจขอบเขตข้อมูลจริงและ Canvas ว่าง
- **What happened:** เทสต์เดิมคาดคำว่า current table และ ReactFlow ตั้งแต่โต๊ะว่าง ขณะที่ UI ระบุ active rules/records/turn และยังไม่มี node; copy ฝั่งถามโต๊ะบอก recent ทั้งที่ดึงข้อความเก่าที่เกี่ยวข้องได้
- **Root cause:** นำสมมติฐานจากแชทเก่ามาใช้กับ F006 และสรุป context scope ไม่ตรงกับตัวเลือกความจำ
- **Correct behavior:** ตรวจชื่อไฟล์จริง, การรวม/ไม่รวมประวัติ, การใช้บทสนทนาเก่าที่เกี่ยวข้อง และขอบเขต Canvas ก่อนมี node; รัน `npm run build`, `npm run build:cloudflare`, `npm run test:cloudflare:browser`, `npm run test:generative:browser` ตามลำดับ โดยไม่ใช้ force-click หรือเปลี่ยนผลธุรกิจที่คาด

### 2026-10-20 — ทุกทางเข้า Assistant ต้องกางแชทที่ย่ออยู่ได้
- **What happened:** หลังรวมแชท island ปุ่ม Write a message บน Canvas พยายามโฟกัส textarea ที่ซ่อนอยู่และไม่เปิดแชทกลับมา
- **Root cause:** ปุ่มไอคอนใช้ expand handler แต่ปุ่มบนการ์ดใช้เฉพาะ DOM focus
- **Correct behavior:** ใช้ expand/focus handler ร่วมกันทั้งสองทางเข้า แล้วรัน `npm run test:cloudflare:browser` ให้ผ่านกรณีเปิดจาก Objects หลังแชทย่อ; ห้ามปิด idle ทั้งหมดเพื่อให้กรณีนี้ผ่าน

### 2026-10-20 — Browser acceptance ต้องตรวจการลงมือใช้ ไม่ใช่แค่เห็นร่าง
- **What happened:** ร่าง generated views ผ่าน schema และแสดงภาพได้ แต่การทดลองส่วนตัวเคยเปิดเฉพาะภาพ และปุ่มที่ส่งค่าเดิมซ้ำถูกกันหลังคำสั่งแรก
- **Root cause:** renderer ยังไม่ได้รับ local command adapter สำหรับ draft; duplicate guard ผูกกับค่า input โดยไม่ดู revision ของข้อมูลหลังคำสั่งสำเร็จ
- **Correct behavior:** ใช้สำเนา draft กับ local authority ตรวจว่ากด/ลาก/รีเซ็ตได้โดยไม่มี `table.act` ไปยังห้องจริง แล้วรัน `npm run test:generative:browser`; ต้องมีการกดปุ่มเดิมสองครั้งและตรวจค่าที่เปลี่ยนจริง

### 2026-10-20 — สูตรที่ AI สร้างต้องมี error ที่ซ่อมได้และ oracle แยก
- **What happened:** โมเดลส่งจำนวน operand ผิดสำหรับสูตร binary, ส่งตัวเลขให้ scene text และกฎแบ่งน้ำที่อ่านยอดทีมแรกค้างไว้เมื่อทีมที่สองเล่น
- **Root cause:** ข้อผิดพลาดไม่ระบุ operation/arity ที่ต้องการ และคำแนะนำมีตัวอย่าง fixed record โดยไม่แยกจาก selected record ใน action; schema ผ่านได้แม้ความหมายธุรกิจยังผิด
- **Correct behavior:** ระบุ operation/arity, แยก text/number และ `selectedField`/`recordField`; รัน `GENERATIVE_CASE=water npm run test:generative:live` ใน disposable fixture ที่ตั้ง credential source ไว้ แล้วตรวจสองตาต่อเนื่องด้วยสูตรอิสระโดยไม่เปลี่ยนค่าที่คาดตามคำตอบโมเดล

### 2026-10-20 — การ fit กล้องต้องรอ geometry หลังขยายการ์ด
- **What happened:** หลังแก้กฎและเปิด Actions กล้องพาไปตำแหน่งเก่า ปุ่มอยู่พ้นขอบจอ แม้กฎและข้อมูลถูกต้อง
- **Root cause:** การขยายการ์ดเปลี่ยนความสูงและเรียก incremental layout หลังคำสั่ง fit; การรอเพียงสอง animation frames ไม่รับประกันว่าขนาดกับตำแหน่งนิ่ง
- **Correct behavior:** ใช้คำขอ focus ครั้งเดียวที่รอ geometry นิ่งและยกเลิกเมื่อคนลาก/เลื่อนเอง แล้วรัน `npm run build`, `npm run build:cloudflare`, `npm run test:cloudflare:browser` ตามลำดับ ห้ามใช้ force-click เพื่อปิดผลล้มของปุ่มที่อยู่นอกจอ

### 2026-10-20 — ตัวเลขถูกไม่ได้แปลว่าภาพที่ AI สร้างถูก
- **What happened:** ฉากแสง–เงาคำนวณ metric ถูก แต่ endpoint ของเส้นเงาใช้พิกัดหลอดไฟ; live pointer test อ่านตำแหน่งก่อนการ์ดกับกล้องนิ่งจึงพลาดวัตถุ
- **Root cause:** acceptance ตรวจเฉพาะ metric และใช้ visible เป็นเงื่อนไขเริ่มลาก ทั้งที่ geometry ยังเปลี่ยนได้
- **Correct behavior:** ตรวจ endpoint ของ scene ด้วยสูตรอิสระก่อน/หลัง action, รอ bounds นิ่งและใช้ hit-test ก่อนลาก; รัน `GENERATIVE_CASE=shadow npm run test:generative:live` ใน disposable fixture พร้อม credential source แล้วเก็บทุก failure ห้ามแก้ output ให้ตรงคำตอบเอง

### 2026-10-20 — ข้อความ handoff ในแชทเก่ากว่า repo
- **What happened:** ข้อความส่งต่องานบอกให้เริ่มจาก `feat/tabletop-r1` (draft PR), deploy `f1725c8`, commit ล่าสุด `bed5881` แต่ repo จริง PR #2 merge เข้า `main` แล้ว ตามด้วย PR #3–#7 และ prod รัน `c9d3bf0`
- **Root cause:** ข้อความเขียนก่อนรอบ merge/deploy ถัดไป และ hardcode SHA ไว้
- **Correct behavior:** ก่อนเชื่อสถานะจากแชท ให้รัน `git log --oneline --merges main | head` และอ่าน `docs/DEPLOYMENTS.md` · ถ้าไม่ตรง ให้ยึด repo แล้วบอกผู้ใช้

### 2026-10-20 — npm 11 ข้าม install scripts
- **What happened:** `npm ci` เตือนว่า `esbuild`, `workerd`, `fsevents` มี install scripts ที่ยังไม่อยู่ใน `allowScripts` · build และ `npm start` ยังผ่าน
- **Root cause:** npm 11.16 ไม่รัน lifecycle scripts ที่ยังไม่อนุมัติ · CI ใช้ `npm ci --ignore-scripts` อยู่แล้วจึงไม่เห็นผลต่าง
- **Correct behavior:** ถ้า `npm run dev:cloudflare` / `test:cloudflare` พังเรื่อง binary ของ `workerd` ให้ลอง `npm approve-scripts workerd` (หรือ `npm rebuild workerd`) ก่อนไล่โค้ด

### 2026-10-20 — Node รุ่นในเครื่องไม่ตรง CI
- **What happened:** เครื่องนี้ใช้ Node v26.3.1 ส่วน CI pin 22.23.2 · build ผ่าน แต่ผลอาจต่างจาก CI
- **Root cause:** ไม่มี `.nvmrc` / `.node-version` บังคับรุ่น
- **Correct behavior:** ระบุรุ่น Node ในรายงานผลตรวจทุกครั้ง · ถ้าผล local ต่างจาก CI ให้สลับไป 22.23.2 ก่อนสรุปว่าเป็นบั๊ก

### 2026-10-20 — `test:cloudflare:browser` พังด้วย ENOENT `worker-build/index.js`
- **What happened:** รัน `npm run test:cloudflare:browser` ตรง ๆ แล้วได้ `ENOENT ... worker-build/index.js` · ถึงแก้ตรงนั้นแล้ว เทสต์ก็ยังจะเปิด `msedge` ซึ่งไม่มีบน Mac เครื่องนี้
- **Root cause:** เทสต์ใช้ Worker ที่ bundle แล้วจาก `npm run build:cloudflare` (CI รันขั้นนี้ก่อนเสมอ) และตั้งเบราว์เซอร์เริ่มต้นเป็น `msedge` เพราะผู้พัฒนาเดิมใช้ Windows
- **Correct behavior:** รัน `npm run build && WRANGLER_SEND_METRICS=false npm run build:cloudflare` ก่อน แล้วรัน `BROWSER_CHANNEL=chrome npm run test:cloudflare:browser` (มี Google Chrome อยู่แล้ว ไม่ต้องติดตั้ง Playwright browser) · `build:cloudflare` เป็น dry run จะขึ้นข้อความ `--dry-run: exiting now`

### 2026-10-20 — Windows checkout เปลี่ยน bytes ของ release build
- **What happened:** preflight พบ static text และ raw-import bundles ต่างจาก build เดิมทั้งที่ source ไม่ต่าง จึงหยุดก่อนส่ง Worker
- **Root cause:** Git บน Windows ตั้ง `core.autocrlf=true`; checkout เป็น CRLF ขณะที่ Git blobs เป็น LF และ cached index อาจรายงาน modified หลังคืน blob bytes แม้ diff เนื้อหาว่าง
- **Correct behavior:** เริ่ม release checkout ใหม่ด้วย `git clone -c core.autocrlf=false --branch v1.0.0 https://github.com/Thanyers/tabletop.git release-clean` แล้วตรวจ `git status --porcelain` และ `git ls-files --eol` ก่อน build รอบนี้ตรวจ tracked blobs/index และสร้าง build ใหม่จน output ต่างเฉพาะ `version.json`; ไม่มี failed live deployment

### 2026-10-20 — ทดสอบ Google login ในเครื่องต้องใช้ emulator ไม่ใช่ `npm start`
- **What happened:** ผู้ใช้หาปุ่มกลับไปล็อกอินบน `localhost:4310` ไม่เจอ
- **Root cause:** Node runtime (`npm start`) ไม่มี `/api/auth/status` จึงเป็น guest เสมอ · ล็อกอิน Google มีเฉพาะ Worker · emulator ตอบ `ORIGIN_REJECTED` ถ้าเปิดผ่าน `localhost` เพราะ `PUBLIC_ORIGIN` คือ `http://127.0.0.1:8787` · ไม่มี OAuth client จะได้ `503 LOGIN_UNAVAILABLE`
- **Correct behavior:** `npm run build` → `npx wrangler d1 migrations apply DB --local` (ห้าม `--remote`) → ใส่ `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` ใน `.dev.vars` (ignored) โดย OAuth client ต้องมี redirect URI `http://127.0.0.1:8787/api/auth/google/callback` → `npm run dev:cloudflare` → เปิด `http://127.0.0.1:8787` เท่านั้น

### 2026-10-20 — `pkill -f` ปิดเซิร์ฟเวอร์ของคนอื่นไปด้วย
- **What happened:** ปิดเซิร์ฟเวอร์ทดสอบของตัวเองที่ `:4319` ด้วย `pkill -f "node --import tsx server/bootstrap.ts"` แล้วเซิร์ฟเวอร์ preview `:4310` ของผู้ใช้หยุดไปด้วย
- **Root cause:** ทุกเซิร์ฟเวอร์ Node ของโปรเจกต์รันด้วยคำสั่งเดียวกัน · `pkill -f` จับตามข้อความคำสั่ง ไม่ใช่ตาม port
- **Correct behavior:** ปิดตาม port เท่านั้น: `kill $(lsof -tiTCP:<port> -sTCP:LISTEN)` · เซิร์ฟเวอร์ที่เปิดผ่าน browser pane ให้ปิดด้วย `preview_stop`

### 2026-10-20 — หลาย session ใช้โฟลเดอร์ repo เดียวกัน
- **What happened:** session อื่นสลับ checkout ไป `chore/eslint-husky` และแก้ `node_modules` ระหว่างที่งานนี้รออยู่ · commit ของงานนี้ไปลงผิด branch และ emulator ที่รันจากโฟลเดอร์หลักล้มเพราะหา `zod` ไม่เจอ
- **Root cause:** หลาย agent ทำงานในโฟลเดอร์เดียวกันพร้อมกัน
- **Correct behavior:** ทำงานใน worktree ของตัวเอง: `git worktree add .claude/worktrees/<ชื่อ> -b <branch> origin/dev` แล้ว `npm ci --ignore-scripts` ในนั้น · ก่อน commit ทุกครั้งรัน `git branch --show-current` ให้แน่ใจว่าเป็น branch ของงานนี้

### 2026-10-20 — `check-public-files` crash `EISDIR` เมื่อมี worktree ซ้อนใน repo
- **What happened:** ตอนทดสอบ pre-commit hook สคริปต์ throw `EISDIR` ทำให้ commit ไม่ได้ทุกครั้ง
- **Root cause:** `git ls-files --others` รายงาน git worktree/repo ที่ไม่ได้ track (เช่น `.claude/worktrees/<name>/`) เป็น entry เดียวที่เป็นโฟลเดอร์ สคริปต์เลย `readFileSync` โฟลเดอร์
- **Correct behavior:** วาง worktree ของ AI ไว้ใต้ `.claude/worktrees/` (ignored แล้ว) · ถ้า `check-public-files` แจ้ง `Nested repository must be ignored or reviewed` ให้ย้ายหรือเพิ่ม path นั้นใน `.gitignore` · ห้ามใช้ `git commit --no-verify` เพื่อข้าม

## Deploy failures

ใช้แทน phak Deploy Fail Log (ดู [CLAUDE.md](CLAUDE.md)) · บันทึก: เวลาที่ fail (จาก log), environment, อาการ/สาเหตุ, เวลาที่แก้, อ้างอิงเหตุการณ์คล้ายกันก่อนหน้า

_(ยังไม่มี)_
