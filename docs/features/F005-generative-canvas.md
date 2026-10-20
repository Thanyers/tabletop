# F005 — Generative Canvas

| | |
| --- | --- |
| สถานะ | `review` — [PR #24](https://github.com/Thanyers/tabletop/pull/24), local implementation/acceptance ผ่าน |
| เจ้าของฟีเจอร์ | Codex; runtime, renderer, layout แบ่ง ownership และ main รวมผล |
| เวอร์ชันที่คาด | เสนอ MAJOR ตามเกณฑ์ rollback: ห้องที่บันทึก AST ใหม่ต้องใช้ compatible writer; รอคนเคาะเลข release |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F005-T1` |

## ทำไม

Canvas เดิมสร้างตารางและกฎได้ แต่ยังสร้างภาพ เครื่องมือ และสูตรใหม่จากโจทย์ไม่ได้ ผู้ใช้ต้องการลงมือทดลอง เล่นร่วมกัน และกลับมาแก้ต่อ โดยคงหน้าตาและวิธีเปิดเครื่องมือเดิม

## สิ่งที่ผู้ใช้จะเห็น

ข้อความหรือไฟล์ → AI ร่าง scene/controls/chart/metric และสูตร → ทดลองร่างส่วนตัว → ตรวจและเปิดใช้ → กด/ลาก/ปรับค่า → ชวนคนอื่น → แก้ร่างใหม่โดยเก็บข้อมูลและตำแหน่งเดิม

## ขอบเขต

รวม bounded expression runtime, generated views, private trial, action authority, AI repair, semantic incremental layout, shared geometry และ bounded conversation retrieval

ไม่รวม redesign, arbitrary JavaScript sandbox, shared simulation clock, image generation, schema migration, starter chooser ของ F001, rename ของ F002 หรือลิงก์เชิญใหม่ของ F003

ใช้ existing JSON room persistence และ disposable local databases ไม่มี persistent schema/cloud resource mutation ในขั้นพัฒนา ผู้ใช้สั่งเริ่มและใช้ agents เมื่อ 2026-10-20; ลงกระดานทีมเมื่อรวม `dev` ที่เพิ่ม PLAN หลังเริ่มงานไปแล้ว

## ข้อเท็จจริงจากโค้ด

Contract, source map, ข้อจำกัด และ recovery: [GENERATIVE_CANVAS_RUNTIME](../GENERATIVE_CANVAS_RUNTIME.md) · แผนเดิม: [GENERATIVE_CANVAS_PLAN_TH](../GENERATIVE_CANVAS_PLAN_TH.md) · ผลตรวจปัจจุบัน: [GENERATIVE_CANVAS_ACCEPTANCE](../GENERATIVE_CANVAS_ACCEPTANCE.md)

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | รวม runtime/renderer/layout/AI/authority และทดสอบก่อนส่ง review | unit/SQL + Cloudflare, build/Worker dry run, browser เล่นสามโจทย์ใหม่และสูตรนอก catalog, AI จริง, two actors/reload/edit/layout, independent review, public scan |

## ผลส่ง review

Node `22.23.2`: unit/SQL 354/354, Cloudflare 71/71, Component Lab 7/7, Node browser 7/7, Worker browser 20/20 และ generated browser สี่เรื่อง/แปดร่างผ่าน; AI จริงผ่านร้านกาแฟ แสง–เงา และเกมแบ่งน้ำบน local Worker โดยไม่แก้ platform ตามชื่อโจทย์ ผลล้มเหลวก่อนหน้าเก็บไว้ด้วย ไม่ใช่ first-attempt success rate

build/typecheck/Worker dry run และ public/client scans ผ่าน; lint 0 errors/104 warnings ดูขอบเขตทั้งหมดใน [acceptance](../GENERATIVE_CANVAS_ACCEPTANCE.md) สอง actor ในรอบนี้เป็นบัญชีจำลอง; Google สองบัญชีจริง, hosted performance, hidden evaluation และ full recovery ยังเป็น gate ก่อนเปิด beta ทั่วไป ไม่มีการ merge/deploy จากงานนี้

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-20 | ใช้ AST ที่ไม่มี host IO แทนการรัน JavaScript ของโมเดลใน host | ได้สูตรและพฤติกรรมใหม่พร้อมตรวจชนิด ขอบเขตการคำนวณ และ atomic action |
| 2026-10-20 | layout revision แยกจาก gameplay revision | การขยับการ์ดไม่ควรทำให้คำสั่งเล่นหรือ draft หมดอายุ |
| 2026-10-20 | trial ใช้สำเนาส่วนตัว และ history จำกัด actor/room/epoch | ทดลองได้โดยไม่แก้ห้องจริงหรือเผยแพร่บทสนทนาส่วนตัว |
