# changelog.d

งานแต่ละ PR เขียนบรรทัด changelog ของตัวเองเป็นไฟล์ในโฟลเดอร์นี้ **ไม่แก้ `CHANGELOG.md` ตรง ๆ** · PR ที่ทำขนานกันจึงไม่ชนกันที่ `CHANGELOG.md` อีก

- ชื่อไฟล์: `<ID>-<ชื่อสั้น>.md` เช่น `F069-landing-bilingual.md` (ตัวอักษร ตัวเลข `.` `_` `-` เท่านั้น)
- เนื้อหา: bullet `- ` หนึ่งข้อขึ้นไปแบบเดียวกับใต้ `## Unreleased` บรรทัดต่อให้เยื้องด้วยช่องว่าง · ห้ามมีหัวข้อ `#`
- ตรวจ: `npx tsx server/changelog.ts check` (CI รันให้ในเช็คเร็ว)
- ตอนออก release: `npx tsx server/changelog.ts cut X.Y.Z --summary "<MAJOR/MINOR/PATCH: เหตุผล · rollback ไปรุ่นไหนได้>"` รวมทุกไฟล์ (ใหม่ก่อนเก่า) และบรรทัดเก่าใต้ `## Unreleased` เข้าหัวข้อ `## X.Y.Z — วันที่` แล้วลบไฟล์ในโฟลเดอร์นี้ ([AGENT_OPERATIONS §5](../docs/AGENT_OPERATIONS.md#5-ออก-release))
