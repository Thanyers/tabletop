# Auto demo ที่เก็บไว้ทดสอบและสาธิตซ้ำ

ผู้ที่ต้องการดูตัวอย่างผ่านหน้าแอปโดยไม่ล็อกอิน ใช้ [Auto demo](https://tabletop.ptchrr.workers.dev/demo) ได้ หน้าแอปคัดเฉพาะเรื่องราวและค่าตัวอย่างจาก archive ด้านล่าง ปุ่มเล่นในแอปไม่รันทดสอบใหม่หรือเรียก AI ส่วนไฟล์ในหน้านี้ยังเป็นหลักฐานฉบับเดิมสำหรับอ่านและทดสอบซ้ำ

รอบ `0926de9d-b570-4229-a6a9-3e10f5e2d7d8` รันวันที่ **19 ตุลาคม 2026 เวลา 05:17 น. Asia/Bangkok** ผ่าน **9 สถานการณ์ รวม 166 ข้อตรวจ**:

- [เปิดรายงานเล่นย้อนหลัง](0926de9d-b570-4229-a6a9-3e10f5e2d7d8/report.html)
- [อ่านผล JSON](0926de9d-b570-4229-a6a9-3e10f5e2d7d8/run.json)
- [คู่มือรันใหม่และ persona](../../../docs/AUTO_DEMO.md)
- [ประวัติเปิดกติกาจากห้องจริง](../../../docs/auto-demo/hosted-activation-2026-10-19.json)

รายงานเป็น HTML ในตัว เปิด offline ได้ หากเปิดจาก GitHub ให้ดาวน์โหลดไฟล์ก่อน หรือรันจากราก repository:

```powershell
npm run demo:auto:view -- --file handoff/Final/auto-demo/0926de9d-b570-4229-a6a9-3e10f5e2d7d8/report.html
```

แล้วเปิด `http://127.0.0.1:4311/` ปุ่มเล่น/หยุด/ก่อนหน้า/ถัดไป/เริ่มใหม่อ่านผลที่บันทึกไว้ ไม่ส่งคำสั่งใหม่ ไม่เรียก AI และไม่แก้ห้องจริง หากต้องการทดสอบโค้ดปัจจุบันใหม่ ใช้ `npm run demo:auto` ซึ่งสร้าง run ID ใหม่โดยรักษารอบเก่าไว้

## สิ่งที่รอบนี้ครอบคลุม

| Persona / โจทย์ | จำนวนข้อตรวจ | ผล |
| --- | ---: | --- |
| คุณอ้อม: บิลที่ยังขาดหลักฐาน | 9 | PASS |
| คุณนก: กติกาตามช่วงวันที่และส่งออก CSV | 23 | PASS |
| คุณก้อง: กติกาซ้อนและคำสั่งซ้ำ | 24 | PASS |
| ครูเมย์ / ฟ้า / ต้น: มุมมองและคำตอบแยกคน | 29 | PASS |
| ต้น: คำตอบจากโจทย์เก่าและคำสั่งที่เกินสิทธิ์ | 8 | PASS |
| ครูเมย์: มวลศูนย์ต้องไม่แทนค่าบทเรียนเดิม | 4 | PASS |
| DM วิน / Mira / Pip: ป้องกันเพื่อนด้วยโล่ | 24 | PASS |
| DM / ผู้เล่น: หยุดเกมและสิทธิ์เล่นต่อ | 19 | PASS |
| ครูเมย์: approval หมดอายุและทบทวนใหม่ | 26 | PASS |

## หลักฐานการตรวจและข้อจำกัด

- **PASS:** ใช้ Cloudflare Worker bundle กับ Miniflare D1/Room ที่สร้างใหม่ และตัวตนจำลองหลายคน ทดสอบครบสองรอบหลังแก้ assertions สุดท้าย โดยรอบก่อน `08e7e1b3-a8ce-46ee-a651-e63d19ae27a0` ยังคงอยู่ใน ignored local archive
- **PASS:** ผลที่บันทึกได้หลังอ่านใหม่, การแยกคำตอบ/มุมมองผู้เรียน, การลองคำสั่งซ้ำ และค่าภาพสถานะถูกตรวจโดย assertions; independent reviewer ตรวจการแก้ข้อค้นพบครบแล้ว
- **PASS:** หน้า replay แสดง 9 สถานการณ์ / 166 checks, กรองครบสามประเภท, เลือกสถานการณ์, เล่น/หยุด, ย้อน/ถัดไป, เริ่มใหม่, เลือกขั้นจาก timeline, แสดง expected rejection, ตัวเลขยอดเงิน/ฟิสิกส์/HP/AP และประวัติ hosted แยกจากผลจำลอง
- **PASS:** IAB แสดงรายงานที่ viewport กว้าง 304 CSS px โดยไม่มี horizontal overflow; ไม่พบ error/warning ใน console ที่อ่านหลัง interaction
- **PASS:** renderer ปฏิเสธการเขียนทับ report ที่มีอยู่ และ SHA-256 ของไฟล์เดิมไม่เปลี่ยน; การ render ผลรอบ setup ที่ล้มเหลวยังคงแสดงสถานะ failed
- **PASS:** local preview ตอบ GET/HEAD เฉพาะหน้า HTML, ตอบ 404 ต่อเส้นทางไฟล์อื่น และ 405 ต่อ POST; CSP ห้าม network connections
- **SKIPPED:** การทดสอบรอบนี้ไม่มี AI จริง, Google login จริง, production writes, hosted สองบัญชี, อุปกรณ์มือถือจริง หรือ recovery/rollback ของ production
- ข้อมูล Invoice มาจาก sample ในระบบ ไม่ได้ทดสอบ upload/parser; prompt ภาษาไทยเป็นเจตนาของ scenario ส่วนคำสั่งทดสอบเขียนไว้แน่นอน ไม่ใช่ข้อพิสูจน์ว่า AI สร้าง workflow อิสระได้

source ตอนรันคือฐาน commit `ddf93fc613f23388174fa38d5aab05a7cfd8af72` พร้อม working changes (`sourceDirty: true`) ของชุด auto demo ก่อน commit ส่งมอบ ไฟล์ JSON เก็บ catalog hash, runner hash และ Worker bundle hash เพื่อระบุสิ่งที่รันจริง รอบนี้ build/typecheck และ Worker dry-run bundle ผ่านก่อนรัน ไม่มีการ deploy runtime ใหม่

ไฟล์สองรายการนี้คัดลอก byte-for-byte จาก run archive และกำหนด LF ใน Git เพื่อรักษา hash:

| ไฟล์ | SHA-256 |
| --- | --- |
| `run.json` | `1137b7b657c058bfd40c34dd56fe9686ab0cf6d50d53dfeba4f25008536bc864` |
| `report.html` | `f0670254ff5f3222a8a555ba9fb051500398d5da61ac83cc11f239ab8e79379a` |

ห้องจริงเปิดกติกา r1 และตรวจหลัง reload แล้ว แต่บันทึก hosted เป็นเพียงสรุปเหตุการณ์ที่ตัดข้อมูลบัญชีออก ไม่ใช่ backup Room/D1 ทั้งระบบ ภาพของบัญชีจริงอยู่เฉพาะ ignored local evidence ไม่รวมในชุดเผยแพร่นี้
