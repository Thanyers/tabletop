# Changelog

## Unreleased

- เพิ่มคู่มือภาษาไทยสำหรับผู้เล่นและผู้พัฒนา ภาพหน้าจอ public demo ไฟล์ตัวอย่างสามโจทย์ และดัชนี deployment เอกสารเปลี่ยนได้โดยไม่ deploy แอปใหม่

## 2026-10-19 — prepared demo art (`f1725c8`)

- เพิ่มภาพรถและฉาก terrain ที่เตรียมไว้ให้ public interactive demo โดยคงการคำนวณ การเล่น และ pause/takeover เดิม
- ตรวจ staging และ production พร้อมไฟล์เว็บตรงกัน 131 ไฟล์ ดู [Deployment](docs/DEPLOYMENTS.md)

## 2026-10-19 — file-driven shared Canvas (`ba29062`)

- เพิ่ม Shared data table จากไฟล์ข้อความด้วยกฎแบบข้อมูล, reviewed AI drafts, multiplayer และ resume
- เพิ่มแชทส่วนตัวข้าง Canvas, บริบทล่าสุดแบบจำกัด และ action preview ที่ต้อง Confirm
- ตรวจสามโจทย์ด้วย Google สองบัญชีจริงบน staging และส่ง production พร้อม migration 0002 ที่รักษาข้อมูลเดิม ดู [acceptance](docs/GENERIC_TABLE_ACCEPTANCE.md)

## 2026-10-18 — initial Cloudflare alpha

- เปิด Google login, saved rooms, invitations, DeepSeek draft jobs และ durable budget ledger สำหรับสาม workflow เดิม ดู [บันทึกรุ่นแรก](docs/CLOUDFLARE_RELEASE.md)
