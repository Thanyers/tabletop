# MEMORY.md — Tabletop

บันทึกบทเรียนและกับดักของโปรเจกต์นี้ (เฉพาะโปรเจกต์ ไม่ใช่ global) · รูปแบบ: **what happened / root cause / correct behavior**
"correct behavior" ต้องเป็นสิ่งที่ทำได้ทันที ไม่ใช่ความรู้สึก · ห้ามใส่ secret, ID จริง หรือข้อมูลผู้ใช้ — repo นี้ public

## Lessons

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

## Deploy failures

ใช้แทน phak Deploy Fail Log (ดู [CLAUDE.md](CLAUDE.md)) · บันทึก: เวลาที่ fail (จาก log), environment, อาการ/สาเหตุ, เวลาที่แก้, อ้างอิงเหตุการณ์คล้ายกันก่อนหน้า

_(ยังไม่มี)_
