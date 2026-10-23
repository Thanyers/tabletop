# F061 — Landing page ตามเรื่องเล่า README

| | |
| --- | --- |
| สถานะ | `doing` |
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
