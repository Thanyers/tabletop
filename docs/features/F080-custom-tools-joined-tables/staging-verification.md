# Hosted (staging) verification for F080

เกณฑ์ของ Goal ห้ามใช้ผล local แทน hosted — เอกสารนี้คือชุดตรวจที่ต้องรันบน **staging ที่ deploy จาก pipeline** และผลต้องถูกบันทึกแยก environment

## 0. เงื่อนไขก่อนเริ่ม

- งาน F080 merge เข้า `dev` แล้ว (`25c85d5` เป็นต้นไป)
- deploy ไป staging สำเร็จผ่าน pipeline มาตรฐาน (ไม่ใช่จากเครื่อง)
- บันทึก **SHA ที่ staging รันอยู่** จากหน้า version/health ของระบบ (ไม่ใช้ SHA จากแชท)

## 1. ชุดตรวจด้วย API (รันด้วยบัญชีทดสอบ 2 บัญชี)

ทำเครื่องหมาย ✅/❌ พร้อมแนบ response ที่สำคัญ

| # | ตรวจ | คาดหวัง |
|---|---|---|
| 1 | สร้างห้อง + โต๊ะต้นทาง 2 ตัว ให้ grant เข้าห้อง | 201/200 |
| 2 | อ่าน projection ของแต่ละแหล่ง | 200 + rows + `sourceDataRevision` = revision ของต้นทาง |
| 3 | ให้เจ้าของต้นทาง import ไฟล์เพิ่ม แล้วอ่านใหม่ | 200 + `sourceDataRevision` **สูงขึ้น** |
| 4 | เรียก action ที่ grant เปิด | 200 + แถวปลายทางเปลี่ยนจริง |
| 5 | เรียก action เดิมซ้ำด้วย idempotency key เดิม | 200 + `duplicate: true` + revision เท่าเดิม |
| 6 | revoke ที่ต้นทาง แล้วอ่าน/export/action | **409** ทั้งสาม และไม่มี rows/ไฟล์ |
| 7 | ขอ projection ด้วย slug ห้องอื่น (workspace อื่นที่ใช้ slug ซ้ำ) | **404** |
| 8 | เรียก action ที่ grant ไม่ได้เปิด | **404** |
| 9 | export CSV | 200 + `content-type: text/csv` + `content-disposition` |
| 10 | recap | 200 + `headline` ที่ตรงกับความจริง (เปลี่ยน/ถอน) |
| 11 | เปิด `/s/:id` ใน browser ที่ลงชื่อเข้าใช้ | 200 + หน้าห้อง 3 คอลัมน์ (จอใหญ่) / 1 คอลัมน์ (มือถือ) |
| 12 | กดเลือกโต๊ะด้วยคีย์บอร์ด (Tab + Enter) | เปลี่ยนแถวที่เลือกได้ |

## 2. สิ่งที่ต้องจด

```
SHA บน staging:
วันที่/เวลา:
บัญชีที่ใช้ (บทบาทเท่านั้น ห้ามใส่ email):
ผล: ผ่าน __/12
ข้อที่ไม่ผ่าน + response ที่แนบ:
```

## 3. บันทึกกลับเข้า repo

แก้ `docs/features/F080-custom-tools-joined-tables/acceptance.json` เฉพาะรายการที่ระบุ environment เป็น hosted/staging (เช่น hosted item และรายการที่ต้องยืนยันบนของจริง):

```json
{
  "status": "PASS",
  "environment": "staging (deployed from dev via pipeline)",
  "sha": "<SHA ที่ staging รัน>",
  "evidence": "12/12 staging checks; <link to the run or the recorded responses>",
  "limitations": "<what staging still does not cover>"
}
```

## 4. สิ่งที่ทำให้ผลใช้ไม่ได้

- รันกับ `wrangler dev` ในเครื่องแล้วเรียกว่า staging
- ใช้ SHA ที่มาจากแชท/เอกสารแทนการอ่านจากระบบที่ deploy แล้ว
- ผ่านข้อ 1–12 แต่ไม่มี response/หลักฐานแนบ
- เอาเฉพาะข้อที่ผ่านมารายงาน (ต้องรายงานข้อที่ไม่ผ่านด้วย)

## 5. หลังผ่าน

เมื่อ staging ผ่านครบและ HUMAN-01 ผ่าน (ดู `human-01-protocol.md`) จึงเหลือเฉพาะ AI จริง (G1-01, EXEC-01, EDIT-01) ที่ต้องมี provider key — จากนั้น Goal จึงจะปิดได้
