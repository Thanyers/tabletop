# Host verification (F080)

ผลตรวจ host จริงด้วย `scripts/verify-host.mjs` — สคริปต์นี้ **ไม่ล็อกอินและไม่เขียนอะไร** จึงพิสูจน์ได้เฉพาะพื้นผิวที่ไม่มี session

## ผลล่าสุด

- host: `https://tabletop-staging.ptchrr.workers.dev` (staging ที่ deploy จาก pipeline เอง)
- deployed sha: `15fe74d`
- ผล: **9 PASS / 0 FAIL / 2 SKIPPED**

```
﻿PASS    worker answers /healthz - status 200
PASS    health body is json - parsed
PASS    reports the deployed revision - sha 15fe74d
PASS    serves the app shell at / - 200 text/html
PASS    serves the room route /s/:id - 200 text/html
PASS    refuses /api/workspaces/11111111-1111-4111-8111-111111111111 without a session - status 401
PASS    refuses /api/workspaces/11111111-1111-4111-8111-111111111111/space/recap without a session - status 401
PASS    refuses /api/workspaces/11111111-1111-4111-8111-111111111111/space/export?source=11111111-1111-4111-8111-111111111111&grant=g&port=p without a session - status 401
PASS    refuses /api/session without a session - status 401
SKIPPED a signed-in member reaches the room and its joined data - needs a session
SKIPPED revoke/export/action behave on this host - needs a session

host https://tabletop-staging.ptchrr.workers.dev · sha 15fe74d · 9 PASS / 0 FAIL / 2 SKIPPED
```

## อ่านผลอย่างไร

**ผ่าน (พิสูจน์ได้โดยไม่มี session):** Worker ตอบ · health เป็น JSON · รายงาน revision ที่รันจริง · เสิร์ฟ app shell ที่ `/` · **เสิร์ฟ route ห้องที่ `/s/:id`** · route ใหม่ทั้งหมด (`space/recap`, `space/export`) **มีอยู่จริงและปฏิเสธด้วย 401 ไม่ใช่ 404** · `/api/session` ปฏิเสธ

**SKIPPED (ไม่นับเป็นผ่าน):** สมาชิกที่ล็อกอินเข้าไปถึงห้องและข้อมูล joined · พฤติกรรม revoke/export/action บน host — ทั้งคู่ต้องมี session

## วิธีรันซ้ำ

```bash
node scripts/verify-host.mjs --url https://<host>
```

สคริปต์คืน exit code 1 ถ้ามี FAIL ใด ๆ จึงใช้เป็น gate ได้

## สิ่งที่ยังต้องทำเพื่อปิด gate hosted

1. มีบัญชีที่ล็อกอิน host ได้ → รัน 12 ข้อใน [staging-verification.md](staging-verification.md)
2. บันทึกผลใน `acceptance.json` ของรายการที่อ้าง hosted (/`environment` ต้องแยกจาก local)
