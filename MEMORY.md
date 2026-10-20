# MEMORY.md — Tabletop

บันทึกบทเรียนและกับดักของโปรเจกต์นี้ (เฉพาะโปรเจกต์ ไม่ใช่ global) · รูปแบบ: **what happened / root cause / correct behavior**
"correct behavior" ต้องเป็นสิ่งที่ทำได้ทันที ไม่ใช่ความรู้สึก · ห้ามใส่ secret, ID จริง หรือข้อมูลผู้ใช้ — repo นี้ public

## Lessons

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
