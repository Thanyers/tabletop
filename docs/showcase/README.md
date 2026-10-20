# ภาพประกอบหน้าแรกของ Tabletop

ภาพชุดนี้ช่วยเล่าแนวคิดใน [README](../../README.md) แยกสื่ออธิบายออกจากภาพหน้าจอและผลทดสอบจริง

## ภาพเคลื่อนไหวจากโค้ด

[`tabletop-story.gif`](tabletop-story.gif) และ [ภาพนิ่ง](tabletop-story-poster.png) อธิบายลำดับไฟล์ → AI ร่างกฎ → คนตรวจและลงมือ → โต๊ะร่วมกัน ผ่านตัวอย่าง Helpdesk สมมติ เป็นแผนภาพที่สร้างด้วย Remotion ไม่ใช่การบันทึกหน้าแอปหรือหลักฐานว่า AI ร่างสำเร็จทุกครั้ง ชิ้นงานและคอลัมน์ในแผนภาพใช้สื่อความหมาย ไม่ใช่คำรับรองว่าแอปมีหน้าตา Kanban ตามภาพ

- สร้างวันที่ 20 ตุลาคม 2026 จาก React / SVG / CSS ไม่มีการเรียกโมเดลสร้างวิดีโอหรือ API ภาพระหว่าง render
- ขนาด 960×540, 12 fps, 144 frames / 12 วินาที เล่นทั้งหมดสามรอบแล้วหยุด
- สีอ้างอิง [Calm Canvas](../CALM_CANVAS_DESIGN.md); ฟอนต์ Manrope และ Noto Sans Thai จากแพ็กเกจ Fontsource
- ใช้ [Remotion 4.0.537](https://www.remotion.dev/docs/render-as-gif) และมี [source + lockfile](motion/) สำหรับแก้เนื้อหาและ render ซ้ำ แพ็กเกจนี้แยกจาก dependencies ของแอป

render จาก root ของ repo:

```powershell
npm ci --prefix docs/showcase/motion --ignore-scripts
npm run render --prefix docs/showcase/motion
```

เครื่องต้องมี Node.js ตาม [CONTRIBUTING](../../CONTRIBUTING.md) และ browser ที่ Remotion รองรับ ตัว renderer อาจดาวน์โหลด headless browser เมื่อยังไม่มี การ render ไม่ต้องใช้ GitHub, Cloudflare หรือ DeepSeek credentials

README เลือกภาพนิ่งเมื่อ browser ขอ reduced motion และมีลิงก์ภาพนิ่งให้เปิดโดยตรง

## ภาพจากแอปจริง

| ไฟล์ | ที่มา / ขอบเขต |
| --- | --- |
| [`../assets/calm-canvas.png`](../assets/calm-canvas.png) | Helpdesk รอบทดสอบ local วันที่ 20 ต.ค. ใช้ DeepSeek จริงและสองบัญชีจำลอง เล่นจบสามงาน; รายละเอียดใน [Calm Canvas acceptance](../CALM_CANVAS_ACCEPTANCE.md) |
| [`physics.png`](physics.png) | จับจาก public `/demo` บน production วันที่ 20 ต.ค. หลังเดโมแรงและมวลครบ 11 ขั้น เปิดฉากรถผ่าน Objects; ค่าที่เห็นคือ F=10 N, m=5 kg, t=2 s, x=4 m |
| [`encounter.png`](encounter.png) | จับจาก public `/demo` บน production วันที่ 20 ต.ค. หลังเดโมโล่ครบ 11 ขั้น เปิดกระดานผ่าน Objects; Pip เหลือ 8 HP, Mira เหลือ 1 AP |

ภาพหน้าจอเดโมตรงกับแอปรุ่น `c9d3bf0` ที่ระบุใน [Deployment](../DEPLOYMENTS.md) ใช้ข้อมูลและ persona สมมติทั้งหมด ภาพฉากที่เตรียมไว้มี [provenance เดิม](../DEMO_ART.md) ภาพหน้าจอไม่ได้เป็นหลักฐาน multiplayer ด้วยสองบัญชีจริงด้วยตัวเอง

ไม่ใช้ภาพจากห้องจริงที่มีข้อมูลบัญชีหรือ session ของผู้ใช้ใน README หลักฐานการเล่นสองบัญชีบน staging อ้างอิงจากรายงาน release โดยแยกจากสื่อชุดนี้
