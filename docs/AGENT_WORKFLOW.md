# เริ่มงานด้วยกติกา dev ล่าสุดอัตโนมัติ

[AGENTS.md](../AGENTS.md) คือกติกากลาง Hooks/plugins เรียก [agent-startup.mjs](../scripts/agent-startup.mjs) ก่อนเริ่มงาน ส่งกติกาจาก commit ของ dev ที่เพิ่ง fetch เข้าบริบท ไม่ต้องพิมพ์สั่ง agent ให้อ่านใหม่ทุกงาน

## ทำงานอย่างไร

1. เริ่ม session หรือส่งงานใหม่ในแชทเดิม → adapter เรียกตัวกลาง
2. ตรวจว่า origin เป็น repo Tabletop → fetch เฉพาะ dev → pin SHA → อ่าน AGENTS จาก SHA นั้น
3. ส่ง receipt ชื่อ checkout/branch/HEAD/dev, ฐานงานตาม dev หรือยัง, งานค้าง และกติกาฉบับเต็มเข้าบริบทก่อนโมเดลเริ่มทำงาน
4. Agent ใช้กติกาปัจจุบันจัด branch/รวม dev และส่ง PR ตาม AGENTS การ fetch ของ hook ไม่ใช่การ merge โค้ด

ตัวกลางไม่ checkout, reset, stash, stage, commit หรือเปลี่ยนไฟล์งาน เช็ค failed/timeout ให้ UNVERIFIED พร้อมข้อจำกัด ไม่ replay กติกาเก่าแล้วอ้างว่าสดใหม่ ใช้ Git credential ที่มีอยู่แล้วแบบไม่เปิด prompt และไม่แสดง URL/credential จาก error

## รับใช้ครั้งแรก

ดึง dev ที่มี F064 แล้วเปิด session ใหม่จาก checkout ของ Tabletop มี Node และ Git พร้อมใช้งาน Codex/Claude อาจให้ยอมรับ workspace หรือ hooks ครั้งแรกตามระบบของตัวเอง การยอมรับนี้เป็นครั้งแรกของเครื่อง/นิยาม hook ไม่ใช่การสั่งให้อ่านกติกาซ้ำทุกงาน ห้ามข้ามระบบ trust

สำหรับ DeepSeek ให้รันครั้งเดียวใน checkout:

```sh
npm run agents:setup
```

ตัวติดตั้งใช้ runtime DeepSeek ที่ติดตั้งอยู่ ประกอบ plugin ไว้ใน DSH home และเพิ่มเฉพาะบล็อก Tabletop ใน home-level cordis.patch.yml ซึ่งทุก profile โหลดร่วมกัน เก็บแถวเดิมไว้ ตรวจการ import plugin ด้วย SDK จริงและตรวจ composed config ก่อนเปิดใช้ ไม่ติดตั้ง SDK อีกชุด ไม่แก้ profile/package ของแอป และไม่ปิดแอปที่กำลังทำงาน การตั้งค่าซ้ำไม่เพิ่มแถวซ้ำ เปิด session ใหม่ให้ loader รับการตั้งค่า

ถ้า Codex เปิด workspace โฟลเดอร์แม่ที่มีหลาย checkout ใช้ตัวติดตั้งพร้อม `--workspace <โฟลเดอร์แม่>` ครั้งเดียว จะเพิ่มเฉพาะ hook ของ Tabletop โดยรักษา hook อื่นไว้ โหมดนี้กำหนดให้โฟลเดอร์แม่นั้นเป็น workspace ของ Tabletop; งานโปรเจกต์อื่นให้เปิดจาก repo ของตัวเอง Receipt ระบุว่าเป็น checkout อ้างอิงที่ใช้ fetch แล้ว agent ต้องเลือก/ตรวจ checkout งานจริงก่อนเขียน

## Native adapters

| Harness | จุดเรียก | ความถี่ |
| --- | --- | --- |
| Codex | [.codex/hooks.json](../.codex/hooks.json), เปิด feature ใน [.codex/config.toml](../.codex/config.toml) | SessionStart (startup/resume/clear/compact/fork) + UserPromptSubmit |
| Claude Code | [.claude/settings.json](../.claude/settings.json), direct Node argv | SessionStart + UserPromptSubmit; CLAUDE import AGENTS ยังคงอยู่ |
| OpenCode | [.opencode/plugins/tabletop-startup.js](../.opencode/plugins/tabletop-startup.js) | ทุก chat.message แล้ว inject ก่อน model dispatch; compact รับกติกาใหม่ด้วย |
| DeepSeek Harness | [native plugin template](../tools/deepseek-startup/index.js) + DSH home patch จากตัวติดตั้ง | awaited agent/pre-step ของขั้นแรกในทุก turn ที่มีข้อความผู้ใช้; ส่ง context ใน request เดียวกัน ไม่รอรอบถัดไป |

DeepSeek plugin ตรวจ repo ก่อน fetch จึงไม่ส่งกติกา Tabletop เข้าบริบทโปรเจกต์อื่น ส่วน OpenCode ใช้ native project plugin directory เพื่อเรียกตัวกลางเท่านั้น ไม่เก็บกติกาคัดลอกไว้ใน .opencode

## ขนาด context และขอบเขตหลักฐาน

Claude จำกัด additionalContext ที่ 10,000 ตัวอักษร จึงย้ายรายละเอียด CI/release/deploy/admin ไป [AGENT_OPERATIONS](AGENT_OPERATIONS.md) โดยคงหัวข้อ/ลิงก์และข้อบังคับให้อ่านตามงานไว้ใน AGENTS มี test กัน AGENTS โตเกินงบ; ถ้า runtime พบเกินงบจริงจะรายงาน POLICY_CONTEXT_TOO_LARGE แทนการอ้างว่าอ่านครบ Codex ตั้ง additionalContextLimit เป็น 0 และส่งเฉพาะข้อมูลที่สคริปต์ควบคุม

ทดสอบตัวกลางและ adapter ด้วย Git fixture ที่ไม่ต่อ GitHub จริง ทั้ง dev เปลี่ยนระหว่างงาน, staged/unstaged/untracked ค้าง, remote ใช้ไม่ได้, กติกาหาย, ข้ามโปรเจกต์อื่น, สอง hook events, OpenCode/DeepSeek pre-model injection, การตั้งค่าซ้ำ และ publication gate เฉพาะไฟล์ที่อนุญาต CI รัน `npm run test:agents` ทุก PR

การทดสอบ callback/JSON และ native plugin import ไม่แทนการยืนยัน model request จริงบนเครื่องสมาชิกทุกคน ดูหลักฐานและข้อจำกัดรอบนี้ใน [F064](features/F064-agent-startup-hooks.md)

## เอกสารต้นทาง

ตรวจ 2026-10-23:

- [Codex hooks](https://learn.chatgpt.com/docs/hooks): project hooks, trust, events และ additionalContextLimit
- [Claude Code hooks](https://code.claude.com/docs/en/hooks): project settings, direct executable args, events และงบ context
- [OpenCode plugins](https://opencode.ai/docs/plugins/), [released v1.19.4 hook types](https://github.com/anomalyco/opencode/blob/v1.19.4/packages/plugin/src/index.ts): project plugin discovery และ pre-model callbacks
- [DeepSeek time-context plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/time-context/src/index.ts): awaited pre-step context
- [DeepSeek profile layers](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md), [app boot](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.md): home-level patch และ absolute module paths
