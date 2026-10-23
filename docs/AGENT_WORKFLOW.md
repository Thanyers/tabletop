# ทำงานร่วมกันหลาย harness

[`AGENTS.md`](../AGENTS.md) คือกติกากลาง รวมขั้นเริ่ม/รับช่วงงาน การ sync dev, การรวม Markdown และ PR/release ใช้ขั้นในไฟล์นั้นทุกครั้งที่เริ่มหรือรับช่วงงาน

## กติกาใหม่ต้อง release ไหม

ไม่ต้อง release เว็บ: merge PR กติกาเข้า `dev` แล้วใช้ checkout ที่มี commit นั้นและอ่านกติกาใหม่ งานปกติแตกจาก `origin/dev` และส่ง PR กลับ `dev`; การ release เว็บเป็นอีกขั้นตาม AGENTS §5

clone ที่ค้างบน `main`, tag หรือ branch เก่าจะยังมีไฟล์เก่า และ session ที่เปิดค้างอาจยังถือบริบทเดิม ต้อง fetch/sync และอ่านใหม่ก่อนทำต่อ การมีไฟล์บน GitHub ไม่ได้พิสูจน์ว่า agent บนเครื่องอื่นได้อ่านแล้ว

## จุดอ่านกติกา

ตรวจเอกสารต้นทาง 2026-10-23; ตารางนี้อธิบาย loader ที่มีเอกสารรองรับ ไม่ใช่ผลทดสอบบนเครื่องสมาชิกทุกคน

| Harness | จุดอ่านใน repo นี้ | เมื่อกติกาเปลี่ยน |
| --- | --- | --- |
| Codex | `AGENTS.md` ในลำดับจาก repo root ถึง working directory | สร้างชุดคำสั่งตอนเริ่ม run/session; หลัง sync ให้เริ่ม session ใหม่หรือสั่งให้อ่านไฟล์ปัจจุบันก่อนทำต่อ ตรวจ override และขนาด context ถ้ากติกาหาย |
| Claude Code | `CLAUDE.md` import `@AGENTS.md` โดยตรง แล้วเพิ่มข้อเฉพาะ Claude ด้านล่าง | หลัง sync เริ่ม session ใหม่ ตรวจ `/context` ว่ามีไฟล์กติกา ไม่อาศัยเพียงประโยคว่า “ไปอ่าน AGENTS” |
| OpenCode | `AGENTS.md` ของโปรเจกต์; `CLAUDE.md` เป็น fallback เมื่อไม่มี AGENTS | หลัง sync เริ่ม session ใหม่จาก checkout งาน หรือให้อ่านไฟล์ปัจจุบันก่อนทำต่อ ตรวจว่าไม่ได้เริ่มในโฟลเดอร์อื่น |
| DeepSeek Harness (`dsh`) | plugin `dsh-agent-instructions` อ่าน `AGENTS.md` และ `CLAUDE.md`; `dsh-base` เปิดให้ตามค่าเริ่มต้น | custom profile อาจปิด plugin ได้; resume จะทบทวน baseline ส่วนการแก้ไฟล์ภายนอกไม่มี watcher จึงเริ่ม session ใหม่หรืออ่านกติกาผ่าน filesystem tool ให้ refresh ก่อนทำต่อ |

DeepSeek Harness ไม่ตีความ `@path` import แต่โหลด `AGENTS.md` โดยตรงอยู่แล้ว จึงไม่ต้องมี `DEEPSEEK.md` หรือคัดลอกกติกาอีกฉบับ การใช้โมเดล DeepSeek ผ่าน harness อื่นให้ยึดวิธีโหลดของ harness นั้น

## ตรวจว่า agent พร้อมเริ่มจริง

Agent ต้องรายงาน checkout, branch, HEAD, `origin/dev` และผล sync ตาม AGENTS โดยอ้างผลคำสั่งที่เพิ่งตรวจ แล้วบอกได้ว่างานปกติส่งเข้า branch ไหนและ Markdown conflict ต้องรวมอย่างไร ถ้าตอบได้เพียงชื่อไฟล์ ยังไม่ใช่หลักฐานว่าใช้กติกาล่าสุด

สำหรับ session เก่าที่ยังไม่เคยได้กติกานี้ ให้เริ่ม session ใหม่ใน checkout ที่ sync แล้ว หรือสั่ง:

> อ่าน AGENTS.md ปัจจุบัน ตรวจ origin/dev ล่าสุด และทำขั้นก่อนเริ่มหรือรับช่วงงานให้ครบ ก่อนแก้ไฟล์ต่อ รักษางานค้างใน checkout ไว้

นี่คือกติกาที่ agent ต้องทำตาม ไม่ใช่ hook ที่บังคับการทำงานทุก harness โดยตัวมันเอง ต้องแยก “รองรับจุดอ่านตามเอกสาร” จาก “เห็นหลักฐานว่า session นี้ทำตามแล้ว” และคง PR/checks ตาม AGENTS เหมือนเดิม

## เอกสารต้นทาง

- [Codex: Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code: Share one file with other coding tools](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools)
- [OpenCode: Rules](https://opencode.ai/docs/rules/)
- [DeepSeek Harness: agent-instructions package](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md)
