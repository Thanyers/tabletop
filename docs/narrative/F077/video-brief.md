# Tabletop — video brief, storyboard และ production prompt

สถานะ: **Draft 01 / concept animatic** · 36วินาที · 1280×720/30fpsในรอบร่าง · ภาษาในภาพEN · ไม่มีเสียง · ทำด้วยโค้ดทั้งหมด

[ดู MP4](media/tabletop-narrative-draft.mp4) · [poster](media/tabletop-narrative-poster.png) · [source/render](motion/README.md) · [แผนสามสื่อ](README.md)

## แกนเรื่อง

คนหนึ่งเปิดร้านเล็กและอยากรู้ยอดขาย เริ่มจากบอกสิ่งที่ต้องการ แล้วมีตาราง/แบบฟอร์ม/วิธีคำนวณให้ตรวจและใช้ เขาแก้ข้อมูล แล้วลองเปลี่ยนกฎส่วนลด โต๊ะเดิมจึงปรับไปพร้อมกับวิธีทำงาน

เก้าอี้คือภาพเปิดของเครื่องมือที่ทำให้เรามีสมาธิ จากนั้นให้การกระทำและผลที่เปลี่ยนเป็นคนเล่าเรื่อง งาน/เรียน/เล่นเป็นภาพเปิดความเป็นไปได้ตอนท้าย ไม่แข่งขันแย่งความสนใจกับเคสหลัก

## Storyboard 36 วินาที

| เวลา | ภาพ / การเคลื่อนไหว | ข้อความหลักในภาพ | สิ่งที่ต้องเข้าใจ |
| --- | --- | --- | --- |
| 0–4 | เส้นเก้าอี้เรียบ ๆ วาดขึ้น ที่นั่งขยายเป็นระนาบโต๊ะและCanvas | A good tool lets you focus. | เครื่องมือช่วยให้เราอยู่กับงาน |
| 4–7 | ครีมตัดเข้าเขียวเข้ม ข้อความใหญ่; file/chat/form ที่แยกกันขยับมาจัดระเบียบ | But work changes. | งานไม่ได้อยู่ในรูปเดิมเสมอ |
| 7–11 | กลับสู่โต๊ะว่าง พิมพ์ “Help me track today’s sales.” | Start with what you want to do. | เริ่มจากเจตนา ไม่ต้องหาไฟล์ก่อน |
| 11–16 | ตารางCoffee/Cake แบบฟอร์ม และกฎยอดรวมเข้ามาตามลำดับ; Review→Applyให้เห็นชัด | Shape it. Review it. Use it. | AIร่าง คนตรวจและเลือกใช้ |
| 16–22 | เติมข้อมูลตัวอย่าง ยอด225; แก้ราคาCoffeeและจำนวนCake ผลรวม405; กราฟอัปเดตตามค่า | New data. Same calculation. | วิธีคำนวณเดิมใช้กับข้อมูลใหม่ได้ |
| 22–27 | เน้นกฎส่วนลดใบเดียว10%→20%, มีreview/apply; gross405คงเดิม ยอดหลังลด364.50→324 | Change one rule. | เปลี่ยนวิธีทำงานเฉพาะจุดบนโต๊ะเดิม |
| 27–31 | โต๊ะเดิมคลี่เป็น3บริบท: ยอดขาย / แรงและมวล / turn-based play | For work. Learning. Play. | หลักคิดเดียวใช้ได้หลายบริบท |
| 31–36 | เว้นจังหวะ ตัวอักษรใหญ่บนเขียวเข้ม เครื่องหมายสี่ช่อง Tabletop และURL | Work defines what software becomes. | จำชื่อและหลักคิดพร้อมที่ไปลอง |

ล่างภาพตลอดคลิป: **Concept animation · illustrative data** ขนาดอย่างน้อย16pxที่720p เวลาคำนวณไม่แสดงloadingปลอมหรืออ้างว่าเป็นlatencyจริง ภาพนี้เป็นauthoringจากโค้ด ไม่ใช่recordingของAI

## ข้อมูลตัวอย่างเดียวกันทุกสื่อ

| ช่วง | Coffee | Cake | Gross | Discount | Net |
| --- | --- | --- | --- | --- | --- |
| ก่อนแก้ข้อมูล | 3 × 25 = 75 | 3 × 50 = 150 | 225 | ไม่แสดง | ไม่แสดง |
| หลังแก้ราคา/จำนวน | 3 × 35 = 105 | 6 × 50 = 300 | 405 | ไม่แสดง | ไม่แสดง |
| ก่อนแก้กฎ | ข้อมูลชุดเดิม | ข้อมูลชุดเดิม | 405 | 10% | 364.50 |
| หลังแก้กฎ | ข้อมูลชุดเดิม | ข้อมูลชุดเดิม | 405 | 20% | 324 |

ยอดเหล่านี้เป็นตัวอย่างที่คำนวณตรวจได้ ไม่ใช่ยอดร้านจริงหรือbusiness KPI การกำหนดCoffee/Cakeและลำดับนี้เป็นเรื่องที่แต่งเพื่อสื่อสาร รองรับความสามารถด้วยผลทดสอบรายเคสตาม [evidence](evidence.md) แต่ไม่ได้อ้างว่าร้านนี้เคยใช้ระบบจริง

## Voiceover draft — English

> A good tool lets you focus on your work. But work changes. Tell Tabletop what you want to do. Let AI help shape the tools, then review and use them. Add new data. Keep the calculation. When your plans change, change a rule on the same table. For work, learning, and play. Tabletop. Work defines what software becomes.

ประมาณ59คำ ตั้งเป้าอ่านจริง30–33วินาที เว้นช่วงภาพ/ท้าย3–6วินาที จังหวะสุดท้ายต้องปรับตามเสียงที่ได้จริง ไม่ยืดเสียงหรือเร่งคำจนอ่านไม่รู้เรื่อง

## Voiceover draft — ไทย

> เครื่องมือที่ดี ให้เรามีสมาธิกับงานตรงหน้า แต่งานเปลี่ยนได้ บอก Tabletop ว่าอยากทำอะไร ให้ AI ช่วยร่างเครื่องมือ แล้วตรวจและลงมือใช้ เติมข้อมูลใหม่ ใช้วิธีคำนวณเดิม เมื่อวิธีทำงานเปลี่ยน ก็ปรับกฎบนโต๊ะที่ใช้อยู่ สำหรับงาน การเรียนรู้ และการเล่น Tabletop — ให้เครื่องมือเติบโตไปพร้อมกับงานของคุณ

ทำเป็นอีกเสียง/อีกexport ไม่อ่านไทยและอังกฤษซ้อนใน36วินาที และไม่เปิดเสียงเองบนหน้าเว็บ

## จังหวะภาพและเสียง

- ใช้พื้นที่ว่างมากพอให้ข้อความใหญ่ทำงาน ตัดฉากสีเข้มเพียงช่วงfriction/end; ข้อมูลกราฟใช้สีตามบทบาทเดิม
- การเคลื่อนไหวหลักใช้match transformจากระนาบเก้าอี้→โต๊ะ→canvas; การ์ดเข้าเป็นลำดับของเหตุและผล ไม่สุ่มกระเด้ง
- เน้นผลรวมหนึ่งค่าต่อจังหวะ มีholdอ่านเลขและคำ ไม่ทำslideshowแปดฉากที่เข้าออกเหมือนกัน
- Final exportอาจมีเสียงclick/soft pulse/whooshที่สังเคราะห์ด้วยโค้ดหรือเสียงที่มีสิทธิ์ใช้ งดคัดลอกเพลงจากreference
- ElevenLabsใช้ได้เฉพาะTTSของscriptที่ตรวจแล้ว ผ่านkeyที่มีอยู่ในenvironment ไม่เขียนkeyลงsource/log; เลือกvoiceที่มีสิทธิ์ใช้ และอ่านdocs/ราคา ณ วันที่เรียกจริง รอบร่างนี้ไม่มีAPI callและค่าใช้จ่ายเสียง
- Renderfinal1920×1080/30fps; จัดsafeareaสำหรับ9:16เป็นงานถัดไป ไม่cropทิ้งข้อความจาก16:9

## Production prompt พร้อมใช้กับ coding agent

```text
Build a code-rendered Tabletop product film from this repository, not an AI-generated video.

Read AGENTS.md, design.md, docs/CALM_CANVAS_DESIGN.md and this brief. Work in an authorized feature branch. Preserve existing runtime behavior. You own only the approved media package and integration files listed in the task.

Purpose: Help a new viewer understand Tabletop as a canvas where tools and reusable calculations take shape around a person's work, can be inspected, and can change as the work changes. Keep the human in control. The story is a small pop-up coffee shop seeking today's totals and later adjusting a discount rule.

Make a 36-second 16:9 film with Remotion, React, SVG and CSS. Draft at1280x720, final at1920x1080, 30fps. Animation must be a deterministic function of frame/props. No setTimeout, random values, wall-clock animation, network calls during rendering, video-generation models, image-generation models, stock AI footage, copied reference assets, or fake screen recordings. Use a lockfile and repository-local assets.

Reference direction: oversized kinetic typography, airy white/cream scenes, brief saturated-color beats, simple geometric transformations, one focal numeric result, and a restrained final wordmark. Translate that rhythm to Tabletop's warm paper, forest green, dark ink and ochre, using Manrope/Noto Sans Thai. Do not copy the reference brand, violet palette, performance numbers, words or soundtrack. This must not look like eight identical template slides.

Exact narrative timings:
0-4: geometric chair → table plane → canvas. “A good tool lets you focus.”
4-7: forest interstitial; separate file/chat/form fragments align. “But work changes.”
7-11: empty canvas, prompt “Help me track today's sales.” No file gate. “Start with what you want to do.”
11-16: table, form and total rule take shape. Explicit Review→Apply→In use. “Shape it. Review it. Use it.”
16-22: data A has Coffee3x25=75 and Cake3x50=150, total225. Data B has Coffee3x35=105 and Cake6x50=300, total405. Table, two-bar chart and metric agree. “New data. Same calculation.”
22-27: change only discount10%→20% with review/apply, gross remains405, net364.50→324. “Change one rule.”
27-31: the same canvas expands into work / learning / play vignettes. Do not imply live multiplayer proof or arbitrary app generation. “For work. Learning. Play.”
31-36: Tabletop four-square mark, “Work defines what software becomes.”, tabletop.ptchrr.workers.dev. Hold long enough to read.

Persistent visible label: “Concept animation · illustrative data”. At least16px at720p. UI is authored explanatory artwork. Do not label it a live capture or claim observed generation latency. A real QA recording is a separate deliverable requiring actual actions/readback and sanitized footage.

Deliver a playable H.264 MP4, poster, eight scene stills, editable source, render script, asset provenance and review notes. Keep outputs small enough for repo policy. Include a static transcript. For final language variants, use the approved TH/EN scripts and timed subtitles, never both voiceovers at once. Silent draft must render without any API key. If ElevenLabs TTS is later requested, use an existing environment key without printing it, verify the selected voice/license and request parameters, and do not clone an unapproved voice.

Verify all arithmetic, scene boundaries, fonts, legibility, safe margins, transition continuity and final dimensions/duration. Inspect rendered frames, not source only. Test MP4 playback and seeking. Report silent/voiced status and any unverified parts precisely. Preserve existing public page until integration scope is approved.
```

## แผน proof clip แยกจาก motion

คลิป60–90วินาทีจากQAต้องเริ่มห้องว่าง ส่งpromptจริง ตรวจและเปิดใช้ เพิ่มCSV เปลี่ยนข้อมูล รันสูตร/โปรแกรมเดิม ขอแก้กฎเฉพาะใบ และreload พร้อมอ่านผลกลับจากระบบ ระบุช่วงที่ตัดหรือเร่งเวลา ไม่เติมผลสำเร็จที่ไม่ได้เกิดจริงด้วยmotion

ความสามารถดังกล่าวมีหลักฐานรายเคสแล้ว แต่ยังต้องบันทึกเส้นเรื่องนี้ต่อเนื่องใหม่ การใส่เลข225→405จากโค้ดในanimaticไม่ใช่การทำproofขั้นนี้
