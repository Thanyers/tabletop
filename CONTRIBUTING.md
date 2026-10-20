# ร่วมพัฒนา Tabletop

เริ่มจาก [README](README.md) สำหรับเรื่องเล่าสาธารณะ, [product.md](product.md) สำหรับเหตุผล/ผู้ใช้/ขอบเขตผลิตภัณฑ์, [วิธีใช้](docs/USER_GUIDE_TH.md) และ [ภาพรวมระบบ](docs/TEAM_HANDOFF_TH.md) แล้วทดลองสิ่งที่กำลังจะเปลี่ยนก่อนแก้โค้ด

## Checkout และ runtime

`dev` คือ branch รวมงาน ส่วน `main` ใช้สำหรับ release ที่ tag `vX.Y.Z` เท่านั้น ดู [สถานะ release](docs/DEPLOYMENTS.md) สำหรับ commit ที่เปิดใช้อยู่ และ [AGENTS.md](AGENTS.md) สำหรับขั้นตอน branch, release และ hotfix ที่คนและ AI ใช้ร่วมกัน ให้สร้าง branch งานของตัวเองจาก `dev`:

```powershell
git clone --branch dev https://github.com/Thanyers/tabletop.git
cd tabletop
git switch -c feat/your-change
npm ci
npm run build
npm start
```

ใช้ Node.js **22.23.2** ให้ตรงกับ CI (package กำหนดขั้นต่ำ 22.13.0) เปิด `http://127.0.0.1:4310` หรือ `/demo` หาก npm shim บน Windows เสีย ให้ใช้ Node/npm installation ที่ถูกต้อง; [Local development](docs/LOCAL_DEVELOPMENT.md) อธิบาย `scripts/start-local.ps1` สำหรับการเปิดแอปที่ build แล้ว

| Runtime | ใช้ทำอะไร | ข้อแตกต่าง |
| --- | --- | --- |
| Node `npm start` | พัฒนา UI/domain และ legacy import | PGlite/private local files, guest sessions, AI ปิด |
| Vite + `npm run dev:api` | แก้ UI พร้อม hot reload | Vite `5173` proxy API/WebSocket ไป `4310` |
| Cloudflare emulator/tests | ตรวจเส้นทางใกล้ production | Local D1/SQLite DO, synthetic OAuth/provider; ไม่ใช้ production keys |
| Hosted staging | ตรวจ integration ที่ local พิสูจน์ไม่ได้ | Google/DeepSeek จริงและ persistent data; ใช้ scope ที่ผู้ดูแลอนุมัติ |

`.env.example` เป็นตัวอย่างชื่อค่า Node ไม่ได้โหลด `.env` เองโดยอัตโนมัติ ส่วน `wrangler.jsonc` มี placeholder และงบ AI ศูนย์ ห้ามแทนค่าด้วย production secret ใน Git ดูวิธีตั้ง local state และ emulator ที่ [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md)

## ตรวจงาน

เลือกการตรวจตามส่วนที่เปลี่ยน การแก้ domain/authority/auth/AI ต้องตรวจผลสำเร็จ สิทธิ์ที่ต้องถูกปฏิเสธ conflict และ retry/recovery ด้วย ไม่ตรวจเพียงหน้าเปิดได้

```powershell
node scripts/check-public-files.mjs
npm run lint
npm test
npm run build
npm run test:cloudflare
npm run build:cloudflare
```

`build:cloudflare` เป็น **dry run** ไม่ deploy สำหรับ browser checks:

```powershell
npx playwright install chromium
$env:BROWSER_CHANNEL = 'chromium'
npm run test:r1:browser
npm run test:cloudflare:browser
```

Browser runners เปิด loopback fixture ของตัวเอง ใช้บัญชีและ provider จำลอง ไม่โทรหา Google/DeepSeek จริง หากใช้ shell อื่นให้ตั้ง environment variable ด้วย syntax ของ shell นั้น การรัน public persona suite พร้อมเก็บประวัติใช้ `npm run demo:auto` ตาม [AUTO_DEMO](docs/AUTO_DEMO.md)

### Lint

`npm run lint` (ESLint + typescript-eslint, config ที่ [`eslint.config.js`](eslint.config.js)) รันใน CI ก่อน unit tests · **error ทำให้ CI fail ส่วน warning ไม่** · typecheck (`strict`) ยังเป็นงานของ `npm run build`

| กฎ | ระดับ | เหตุผล |
| --- | --- | --- |
| `@typescript-eslint/no-explicit-any` | error | `strict` กันแค่ `any` ที่ TypeScript อนุมานเอง ไม่กัน `: any` / `as any` ที่เขียนเอง · ใช้ `unknown` แล้ว narrow หรือ zod แทน |
| `@typescript-eslint/ban-ts-comment` | error | ห้าม `@ts-ignore` / `@ts-nocheck` · `@ts-expect-error` ต้องมีเหตุผลอย่างน้อย 10 ตัวอักษร |
| `react-hooks/rules-of-hooks` | error | component ที่ต้อง return ก่อนตามชนิดข้อมูล ให้แยก guard ออกเป็น component นอก แล้วส่งค่าที่ narrow แล้วให้ component ใน (ดู `InvoiceWorkbench.tsx`) |
| eslint-disable ที่ไม่ได้ใช้ | error | กัน comment ปิดกฎค้างหลังแก้โค้ดแล้ว |
| กฎ recommended ที่เหลือ | error | ยกเว้นกฎที่มีของเดิมค้างตอนเริ่มใช้ lint ซึ่งตั้งเป็น warning ไว้ก่อน (ดูใน config) แล้วจะเลื่อนเป็น error เมื่อเคลียร์หมด |
| `no-control-regex` | off | sanitizer ตั้งใจลบอักขระควบคุม |

ตัวแปร/argument ที่ตั้งใจไม่ใช้ให้ขึ้นต้นด้วย `_` · ห้ามแก้ warning ของไฟล์อื่นปนในงานที่ไม่เกี่ยว เพราะจะชนกับงานที่แตะไฟล์นั้น

### Pre-commit hook

`npm ci` / `npm install` ติดตั้ง hook ของ [husky](https://typicode.github.io/husky/) ให้อัตโนมัติผ่าน script `prepare` · ก่อนทุก commit hook ([`.husky/pre-commit`](.husky/pre-commit)) จะรัน:

1. `node scripts/check-public-files.mjs` กับทั้ง repo
2. `lint-staged` → `eslint` เฉพาะไฟล์ `.ts/.tsx/.js/.mjs` ที่ stage ไว้ (ไม่ `--fix` ให้เอง)

hook เป็นด่านเสริมที่ข้ามได้ด้วย `git commit --no-verify` · ด่านที่บังคับจริงคือ check `local-validation` ใน CI · ถ้า hook ไม่ทำงานหลัง clone ให้รัน `npm run prepare` แล้วเช็คว่า `git config core.hooksPath` ได้ `.husky/_` · worktree ของเครื่องมือ AI ให้วางใต้ `.claude/worktrees/` (ignored แล้ว) ไม่อย่างนั้น `check-public-files` จะแจ้งว่าเป็น nested repository

CI ใน [validate.yml](.github/workflows/validate.yml) ยังตรวจ dependency advisories, Component Lab, secret canary ใน browser build และเก็บรายงาน มี repository permission แบบอ่านและไม่มี deployment step

## ส่งการเปลี่ยนแปลง

1. ทำ diff ให้ตรงงาน ระบุว่าเปลี่ยน behavior อะไรและผู้ใช้จะเห็นอะไร เก็บ schema/domain/API/UI ให้สอดคล้องกัน
2. คง server authority, private projections, explicit AI consent และ human confirmation ไม่เพิ่ม scenario-name switch เพื่อให้เคสตัวอย่างผ่าน
3. เพิ่มหรือปรับการตรวจที่ปกป้องพฤติกรรมที่เปลี่ยน การแก้เอกสารเล็กน้อยให้ตรวจลิงก์/ข้อเท็จจริงตามสัดส่วน ไม่จำเป็นต้องเขียน unit test เลียนแบบข้อความ
4. ก่อน commit ตรวจ `git status`, diff และ staged paths ใช้รายชื่อไฟล์ที่ตั้งใจส่ง ห้ามส่ง `.env*`, `.dev.vars*`, raw account/session evidence, private receipts หรือ state จาก `test-results/`, `.wrangler/`, `server/.data/`
5. เปิด PR เข้า `dev` พร้อมผลตรวจและข้อจำกัด แล้ว review ก่อน merge · `main` รับเฉพาะ `release/*` และ `hotfix/*` ตาม [AGENTS.md](AGENTS.md#2-branch)
6. อัปเดตคู่มือเมื่อเปลี่ยนขั้นตอนผู้ใช้หรือข้อจำกัด อัปเดต Deployment เฉพาะเมื่อ deploy และตรวจจริงแล้ว

ผู้ส่ง bug ควรระบุ URL/environment, เวลา, ขั้นตอน, ผลที่คาด/ผลที่เห็น, browser และภาพที่ลบข้อมูลส่วนตัวแล้ว ไม่แนบ token, invite link ที่ยังใช้ได้, cookie หรือข้อมูล source ส่วนตัว

การมีสิทธิ์ push ไม่ได้ให้สิทธิ์เปลี่ยน persistent schema/ข้อมูลของ deployment โดยอัตโนมัติ ขั้นตอน operator และการอนุมัติขอบเขตฐานอยู่ใน [ทีมพัฒนาต่อ](docs/TEAM_HANDOFF_TH.md#ส่งรุ่นใหม่และกู้คืน)
