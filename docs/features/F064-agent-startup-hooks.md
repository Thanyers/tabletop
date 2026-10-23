# F064 — โหลดกติกา dev ล่าสุดอัตโนมัติ

| | |
| --- | --- |
| สถานะ | `review` — [PR #202](https://github.com/Thanyers/tabletop/pull/202) |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | เครื่องมือพัฒนา ไม่ต้อง release เว็บ |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F064-T1` |

## ทำไม

F063 ระบุกติกาเริ่มงานไว้แล้ว แต่ยังต้องพึ่ง agent จำไปตรวจเอง ผู้ใช้ต้องการให้ Codex, Claude Code, OpenCode และ DeepSeek Harness ตรวจ dev และรับกติกาปัจจุบันเองเมื่อเริ่มงาน โดยไม่สั่งซ้ำ

## สิ่งที่ผู้ใช้จะเห็น

จุดเริ่มงานเรียกสคริปต์กลางเพื่อ fetch `origin/dev`, อ่าน `AGENTS.md` จาก SHA ที่เพิ่งตรวจ และส่งเข้าบริบท agent พร้อมสถานะ branch/ฐานงาน ถ้าติดต่อ remote ไม่ได้ต้องรายงานว่าไม่ยืนยันความสด ไม่แสดงสถานะผ่านจากข้อมูลเก่า

## ขอบเขต

**รวม:** สคริปต์กลาง, native hook/plugin adapters, วิธีติดตั้ง/ตรวจความพร้อมครั้งเดียวตามความสามารถของแต่ละ harness, tests ด้วย Git fixture และคำแนะนำรับช่วงงาน

**ไม่รวม:** checkout/merge/reset/stash/commit งานค้างอัตโนมัติ, สิทธิ์หรือ credential ใหม่, โค้ดฟีเจอร์เว็บ, deploy

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | โหลด dev และกติกาอัตโนมัติ | ตรวจ adapter ตาม schema จริง; fixture พิสูจน์กติกาเปลี่ยน/dirty worktree/network fail; lint และ CI ผ่าน; ระบุขอบเขต runtime ที่ตรวจได้จริง |

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | fetch/read แบบไม่เปลี่ยน working tree และใช้สคริปต์กลาง | รับกติกาใหม่ได้แม้มีงานค้าง โดยไม่รวมโค้ดหรือรบกวนงานคนอื่นเงียบ ๆ |
| 2026-10-23 | Codex/Claude ใช้ SessionStart + UserPromptSubmit, OpenCode ใช้ chat.message/pre-model, DeepSeek ใช้ awaited pre-step | ครอบคลุม session ใหม่และงานใหม่ในแชทเดิม โดย context เข้าก่อน request แรกของงาน |
| 2026-10-23 | ย้ายรายละเอียด AGENTS §3/5/6/9 ไป AGENT_OPERATIONS และคง anchors/ข้อบังคับอ่าน | Claude additionalContext จำกัด 10,000 ตัวอักษร; root AGENTS เหลือ 8,921 ตัวอักษร และมี test กันขนาดกลับมาเกิน |
| 2026-10-23 | DSH ใช้ home patch อ้างอิง plugin ที่ประกอบจาก source + SDK ของ runtime ที่ติดตั้งจริง | profile เป็นอิสระต่อกัน; home patch ครอบคลุมทั้งหมดโดยไม่แก้/หยุด Desktop และไม่โหลด SDK อีก instance |
| 2026-10-23 | Publication gate ยกเว้นเฉพาะ 4 ไฟล์ native adapters ที่ระบุชื่อ | ไม่เปิดเผย harness state อื่น และตรวจ secret ในไฟล์ที่ยกเว้นเหมือนเดิม |

## ผลตรวจ

Node 22.23.2:

- `npm run test:agents`: 14 passed / 2 SKIPPED (POSIX file modes และ symlink บน Windows) — Git fixture ใช้ local bare remote; ทดสอบ fresh/refreshed dev, dirty/staged/untracked, remote หาย, policy หาย, repo อื่น, JSON events, native PowerShell command/Claude argv ใน path มีช่องว่างและ cwd เป็น subdirectory, OpenCode dispatch, DeepSeek first human request, context budget, publication allowlist, setup idempotence, failed-update preservation และการรักษา co-hooks
- `npm run lint`: 0 errors, warnings เดิม; `git diff --check` และ public-file scan ผ่าน
- `npm run agents:setup -- --workspace <workspace-parent>`: ผ่านและรันซ้ำผ่าน เครื่องนี้ติดตั้ง DSH home patch และ local parent-workspace Codex hooks แล้ว ไม่เขียน credential หรือแก้ plugin/profile เดิม
- DeepSeek Harness 0.2.1-rc.2: ทดสอบ import adapter ด้วย SDK จริงผ่าน native Electron Node runtime และ compose config ของ profile ที่มีอยู่ โดยไม่เริ่ม session/model หรือปิด Desktop

ข้อจำกัด: ยังไม่ได้เปิด model request จริงครบทั้งสี่ harness บนเครื่องสมาชิกทุกคน; Codex/Claude ต้องผ่าน native workspace/hook trust ครั้งแรก มีเฉพาะ Codex และ DeepSeek ที่ตรวจ installed runtime ได้ในเครื่องนี้ การตรวจ schema ของ profile shared ทั้งชุดพบข้อผิดพลาด carrier ของ plugin เดิมที่ไม่เกี่ยวกับ F064 จึงใช้ native module-import smoke + config composition เฉพาะส่วนที่ต้องพิสูจน์ ไม่อ้างว่า schema profile ทั้งชุดผ่าน

Runtime/browser แอป: **SKIPPED** ในเครื่อง เพราะไม่เปลี่ยนฟีเจอร์เว็บ; required CI ของ PR ต้องผ่านก่อน merge ไม่ deploy
