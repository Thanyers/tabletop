# F025 — การ์ด "draft พร้อม แต่ตาราง refresh ไม่ได้" (refresh race)

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | ทีม Tabletop |
| เวอร์ชันที่คาด | PATCH — ปรับพฤติกรรม refresh ฝั่ง client (ไม่มี schema/migration) |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F025-T1` |

## อาการ (เจอบน production 3.3.1)

เคสมังกร 3 หัว: ร่างเสร็จแล้ว แต่การ์ดขึ้น

> The rule draft is ready, but the table could not refresh: The table changed. Review its latest state and try again.

ผู้ใช้เห็น error ทั้งที่ draft อยู่พร้อม — กด Retry table refresh เองได้ แต่ไม่ควรต้อง

## ต้นเหตุ

`refreshWorkspaceProjection` (TabletopApp) ดึง projection 3 ครั้ง; ถ้าระหว่างนั้นมี refresh อื่น (เช่น จาก socket/poll) ทำให้ `projectionSequenceRef` เปลี่ยนทุกครั้ง `canApplyWorkspaceRefresh` จะเป็น false ทั้ง 3 รอบ → โยน `STALE_REVISION` → การ์ดแสดง pollError

## สิ่งที่เปลี่ยน

- เก็บ response ล่าสุดไว้ (`newest`) และเว้นจังหวะด้วย backoff **150/300/450 ms** (`draftRefreshBackoffMs`) ให้ projection อื่น settle
- ถ้าครบ 3 รอบแต่ยัง apply ไม่ได้ และ **scope ยังเดิม** (โต๊ะ/ที่นั่งไม่เปลี่ยน) → apply projection ล่าสุดแทนการโยน error
- ยังคง throw เมื่อ scope เปลี่ยนจริง (เปลี่ยนโต๊ะ/ที่นั่ง) เหมือนเดิม

## ผลกับผู้ใช้

- draft ที่พร้อมจะแสดงพร้อมตารางล่าสุด ไม่ขึ้น error หลอก ๆ จาก race
- ถ้าตาราง/ที่นั่งเปลี่ยนจริง ยังได้ error ตามเดิม

## ผลตรวจ (Node 22.23.2)

- unit: `table-chat-state.test.ts` เพิ่มเคส backoff (0/1/2 → 150/300/450)
- browser suite เดิม (`failDraftRefresh`) ยังต้องผ่าน: เมื่อ refresh **ล้มจริง** ยังแสดง error + Retry

## ข้อจำกัด

- เป็นการลด race ไม่ใช่ทำให้ sequential ทั้งหมด; ถ้า server เปลี่ยนข้อมูลระหว่างนั้น projection ใหม่สุดจะถูกใช้ (ถูกต้องตามพฤติกรรม)
