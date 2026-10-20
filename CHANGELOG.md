# Changelog

## Unreleased

- **แก้:** workbench ของ invoice / physics / encounter ไม่เรียก React hook หลัง return แบบมีเงื่อนไขแล้ว (กัน React error "Rendered fewer hooks" ถ้าชนิดข้อมูลเปลี่ยนใน component เดิม) · ผู้ใช้ไม่เห็นอะไรเปลี่ยน
- **CI/dev:** เพิ่ม ESLint (`npm run lint`) เข้า CI ห้าม `any` ที่เขียนเอง ห้าม `@ts-ignore` และบังคับกฎของ React hooks · เพิ่ม pre-commit hook (husky + lint-staged) ที่รัน `check-public-files` และ lint ไฟล์ที่ stage · `check-public-files` ไม่ crash เมื่อเจอ nested repository แล้ว แต่รายงานเป็น finding แทน · ไม่เปลี่ยน behavior ของแอป ([CONTRIBUTING → Lint](CONTRIBUTING.md#lint))

## 1.0.0 — 2026-10-20

release แรกที่ติด tag ตามรูปแบบ `vMAJOR.MINOR.PATCH` · โค้ดแอปตรงกับ `524d9cc` ที่รันบน production และ staging อยู่แล้ว ([Deployment](docs/DEPLOYMENTS.md)) ส่วนที่ต่างจากนั้นมีแค่เอกสารและ CI · จากรุ่นนี้ไป `main` รับเฉพาะ `release/*` และ `hotfix/*` ส่วนงานใหม่เข้า `dev` ตาม [AGENTS.md](AGENTS.md)

- หน้าแรกก่อนล็อกอินอธิบายแนวคิดของ Tabletop พร้อมลิงก์เดโม โดยไม่เปลี่ยน auth, ห้อง, กฎ หรือ storage ดู [Public welcome](docs/PUBLIC_WELCOME_ACCEPTANCE.md)
- เพิ่ม `AGENTS.md` (กติกา branch/CI/release/hotfix ที่คนและ AI ใช้ร่วมกัน), `spec.md`, `MEMORY.md`, `CLAUDE.md` · CI รันเมื่อ push เข้า `dev` ด้วย
- เพิ่ม `GET /version` ทั้ง Worker และ Node ตอบ `{"version","sha","built_at"}` จาก `version.json` ที่ build เขียนไว้คู่กับไฟล์เว็บ จึงไม่ต้องแก้คำสั่ง deploy · `version` มาจาก git tag `vX.Y.Z` ของ commit ที่ build; ถ้าไม่มี tag จะเป็น `0.0.0-dev` · ไฟล์ที่ไม่มีหรือรูปแบบผิดตอบ 404
- **operator:** config deploy ต้องมี `/version` ใน `assets.run_worker_first` (เพิ่มใน `wrangler.jsonc` แล้ว) ไม่อย่างนั้น `/version` จะได้หน้า `index.html` แทน · build มีไฟล์เพิ่ม 1 ไฟล์และ `built_at` ทำให้ build สองครั้งจาก source เดียวกันได้ไฟล์นี้ต่างกัน

## 2026-10-20 — Calm Canvas

- เอา Use/Arrange ออก ลากหัวการ์ดได้ตลอด และเปิดเครื่องมือจาก Objects บน Canvas
- ปรับสี สัดส่วน ตัวอักษรและปุ่มเป็นชุดเดียวกัน ให้ความรู้สึกชิ้นส่วนบนโต๊ะ; ลดคำอธิบาย กรอบซ้อน และเครื่องมือซ้ำ
- เลือก record แล้วทำรายการต่อได้ตรงนั้น พร้อมล้างค่าที่ติดจาก record ก่อนหน้า; แสดงชื่อคนแทนรหัสที่รู้จัก
- ช่องแชทอยู่ใน Canvas พับประวัติได้ และต้องยินยอมใหม่เมื่อเปลี่ยนไฟล์/หลักฐานหรือส่ง AI อีกครั้ง
- เล่น Helpdesk จากไฟล์ใหม่ด้วย AI จริงจนจบสามงาน ผ่านสองบัญชีจำลอง และตรวจ auto demo ทั้งสามแบบพร้อมรับช่วงด้วยมือ ดู [ผลทดสอบและขอบเขต](docs/CALM_CANVAS_ACCEPTANCE.md) และ [ระบบภาพ](docs/CALM_CANVAS_DESIGN.md)

## 2026-10-19 — Canvas flow and Helpdesk checks

- เพิ่มสีและไอคอนตามบทบาทของวัตถุ เส้นลูกศรและแถบความสัมพันธ์ที่กดตามได้ พร้อม motion เมื่อ revision เปลี่ยนและการรองรับ reduced motion
- แสดงความคืบหน้า Draft → Simulate → Validate → Approve → Activate และขอบเขตผลตรวจบิลที่มี/ขาดหลักฐานให้ชัดขึ้น แก้พื้นที่ Canvas และแถบเครื่องมือจอแคบ
- required action text ปฏิเสธข้อความว่างและเว้นวรรคล้วน โดยยังเก็บข้อความที่ใช้ได้ตามที่ผู้ใช้กรอก
- เล่น Helpdesk จากไฟล์ใหม่ด้วย DeepSeek จริงจนจบสามงาน ผ่านสองบัญชีจำลองบน local รวมรับงาน ส่งตรวจ อนุมัติ เปิดกลับ และปิดแท็บกลับมาเล่นต่อ ดู [ผลและวิธีทดสอบซ้ำ](docs/CANVAS_HELPDESK_ACCEPTANCE.md)

## 2026-10-19 — team handoff

- เพิ่มคู่มือภาษาไทยสำหรับผู้เล่นและผู้พัฒนา ภาพหน้าจอ public demo ไฟล์ตัวอย่างสามโจทย์ และดัชนี deployment เอกสารเปลี่ยนได้โดยไม่ deploy แอปใหม่
- รวม implementation และเอกสารเข้า `main` ผ่าน [PR #2](https://github.com/Thanyers/tabletop/pull/2) แล้ว และปรับวิธี clone/ส่ง PR ให้เริ่มจาก main

## 2026-10-19 — prepared demo art (`f1725c8`)

- เพิ่มภาพรถและฉาก terrain ที่เตรียมไว้ให้ public interactive demo โดยคงการคำนวณ การเล่น และ pause/takeover เดิม
- ตรวจ staging และ production พร้อมไฟล์เว็บตรงกัน 131 ไฟล์ ดู [Deployment](docs/DEPLOYMENTS.md)

## 2026-10-19 — file-driven shared Canvas (`ba29062`)

- เพิ่ม Shared data table จากไฟล์ข้อความด้วยกฎแบบข้อมูล, reviewed AI drafts, multiplayer และ resume
- เพิ่มแชทส่วนตัวข้าง Canvas, บริบทล่าสุดแบบจำกัด และ action preview ที่ต้อง Confirm
- ตรวจสามโจทย์ด้วย Google สองบัญชีจริงบน staging และส่ง production พร้อม migration 0002 ที่รักษาข้อมูลเดิม ดู [acceptance](docs/GENERIC_TABLE_ACCEPTANCE.md)

## 2026-10-18 — initial Cloudflare alpha

- เปิด Google login, saved rooms, invitations, DeepSeek draft jobs และ durable budget ledger สำหรับสาม workflow เดิม ดู [บันทึกรุ่นแรก](docs/CLOUDFLARE_RELEASE.md)
