# F061 — Landing page ตามเรื่องเล่า README

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของ | Codex |
| งาน | `F061-T1` ใน [PLAN](../../PLAN.md) |

## ทำไม

หน้าแรกยังบอกคุณค่าและภาพการใช้งานไม่ชัดเท่า README ที่ปรับแล้ว ผู้ใช้ขอปรับทั้งเนื้อหาและรูปให้เป็น landing page โดยห้ามแก้ฟีเจอร์อื่น

## ขอบเขต

- ปรับเฉพาะ `PublicWelcome.tsx`, `public-welcome.css` และภาพสำหรับหน้าแรก ถ้าต้องเพิ่ม
- รักษา props `children` / `headerAction`, กล่อง login/welcome เดิม, route, auth, demo และ callback ทั้งหมด
- ใช้โทนกระดาษอุ่น Manrope/Noto Sans Thai และ tokens เดิม; แสดงชัดว่าภาพใดเป็นแนวคิด/เดโม
- ไม่มี backend, schema, shared CSS tokens, SEO/i18n หรือการเปลี่ยนฟีเจอร์อื่น
- PR #180 เป็น draft สองภาษาแยกต่างหาก ไม่ดึงการแก้ auth/account ของ PR นั้นมารวม; งานนี้ปรับหน้าแรกตามคำสั่งใหม่

## ตรวจรับ

Build/typecheck, lint ไฟล์ที่แก้, public-file scan, หน้าแรก desktop/mobile/keyboard/reduced motion, ปุ่ม/anchor/login slot และ demo destination เดิม, ui-gate ก่อน/หลังพร้อมขอบเขต harness และ independent review

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | แยก presentation ที่หน้าแรก และใช้กล่อง account เดิมเป็น children โดยไม่แก้ไฟล์ account | รักษาขอบเขตฟีเจอร์และพฤติกรรมเดิม |
| 2026-10-23 | คงชุดสีและฟอนต์ตาม design.md; ใช้ภาพ SVG ใหม่ประกอบแนวคิดและภาพเดโมจริง พร้อมคำกำกับ | ทำให้คุณค่าจับต้องได้โดยไม่ใช้ภาพแนวคิดเป็นหลักฐาน runtime |

## ผลตรวจ (Node 22.23.2)

- `npm run build` และ `npm run build:cloudflare`: PASS (Worker dry-run เท่านั้น)
- `npx eslint src/tabletop/ui/PublicWelcome.tsx`, `git diff --check`, `node scripts/check-public-files.mjs`: PASS; scanner 650 files, findings ว่าง
- `node test-results/landing/homepage-browser.mjs`: PASS 4 กลุ่ม เป็น prefix ของชุด Workers browser เดิมบวกตรวจภาพและ overflow 280/320/414/1440; กล่อง Google, retry/error, anchor, demo และภาพสุดท้ายผ่าน บัญชี/config จำลองและ local Worker เท่านั้น สคริปต์และรายงานอยู่ในเครื่อง ไม่ commit
- ชุด `npm run test:cloudflare:browser`: **FAIL** หลังผ่าน 28 กลุ่ม รวม anonymous/signed-in landing, navigation, Google entry และ public demo; หยุดที่ `Table draft: River Race` เพราะ synthetic provider job ตอบ `MODEL_PROVIDER_HTTP_ERROR` จึงไม่มี `New rules added` ยังไม่ได้ยืนยันผลเทียบ control บน baseline ไม่มีการแก้ backend/test fixture นอกขอบเขต
- Independent review: PASS หลังเพิ่ม SVG เข้า candidate; props, account, routing, demo และ animation logic คงเดิม

### UI gate และขอบเขตหลักฐาน

ใช้ harness ที่ bundle/render/hydrate `AccountSignIn` และ `PublicWelcome` จริงพร้อม stylesheet ที่ใช้ ไม่ใช่ภาพออกแบบที่วาดแทน component; เป็น synthetic account fixture ไม่พิสูจน์ production/OAuth จริง

- คำสั่งก่อน/หลัง: `node <ui-gate>/gate.mjs test-results/landing/<before|after>.html --full --json`
- ก่อน: 9 PASS / 7 FAIL / 4 SKIP จาก 16 checks ที่วัดได้
- หลัง: 15 PASS / 1 FAIL / 4 SKIP จาก 16 checks ที่วัดได้ โดย render checks ทั้ง 13 ผ่าน รวม contrast states, axe, responsive, mobile-first, touch, keyboard และ reduced motion
- **ผล raw รวมยัง FAIL:** hardcodes ใน stylesheet ส่วนกลางที่ harness รวมไว้ (ไฟล์ที่ไม่แก้ในงานนี้) ไม่ยกระดับเป็น full PASS
- SKIP: theme refs (full harness run ไม่ส่ง theme), DTCG tokens/contrast-pairs (ไม่มี input), focus trap (หน้าไม่มี dialog target) ไม่นับเป็น PASS
- CSS หน้าแรกตรวจแยกด้วย `--static-only --theme=src/tabletop/ui/tabletop-tokens.css`: 4/4 PASS
- รายงานและภาพอยู่ใน `test-results/landing/`; ภาพจริงของหน้าแรกฉบับสุดท้ายอยู่ใน `homepage-browser/landing-hero.png` และ `landing-full.png`

ยังไม่ merge หรือ deploy งานนี้ และไม่มีการเรียก AI จริงหรือเขียนข้อมูล production
