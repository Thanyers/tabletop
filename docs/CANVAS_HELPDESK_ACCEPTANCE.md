# Canvas และ Office Helpdesk: ผลทดสอบ 19 ตุลาคม 2026

รุ่นนี้ปรับการอ่าน Canvas และแก้ required action text ที่เคยยอมรับข้อความว่างหรือเว้นวรรคล้วน ไม่เปลี่ยน schema, OAuth, secrets, งบ AI หรือรูปแบบโปรแกรมของโต๊ะ ดูรุ่นที่เปิดใช้อยู่ที่ [Deployment](DEPLOYMENTS.md)

## สิ่งที่เปลี่ยนบน Canvas

- สีและไอคอนแยกเอกสาร กฎ การคำนวณ ผลลัพธ์ และการกระทำ
- เส้นมีหัวลูกศร พร้อมแถบความสัมพันธ์ที่กดโฟกัสวัตถุปลายทางได้ รวมเส้นซ้ำจากทางที่ย่อไว้
- motion เกิดเมื่อ data/rule revision เปลี่ยน และเคารพ prefers-reduced-motion
- ขั้นตอน Draft → Simulate → Validate → Approve → Activate แสดงสถานะร่างแยกจากกฎที่กำลังใช้
- ผลตรวจบิลแสดงส่วนที่มีหลักฐาน ส่วนที่ต้องตรวจ และส่วนที่คำนวณไม่ได้ โดยไม่แทน Unknown ด้วยศูนย์
- แก้ Canvas ที่เสียพื้นที่บนจอ tablet และตำแหน่งแถบเครื่องมือบนจอแคบ ตรวจ DOM ที่ 780 และ 481 พิกเซลแล้ว ยังไม่ยืนยันต่ำกว่า 430 พิกเซล

## Helpdesk จากไฟล์ใหม่

ทดสอบผ่านหน้าแอปจริงบน Cloudflare emulator local ด้วยเจ้าของและสมาชิกจำลองคนละเบราว์เซอร์ ผู้ใช้เลือกไฟล์ในหน้าแอปเองหลังเครื่องมืออัปโหลดถูกปฏิเสธ จากนั้น Codex พิมพ์คำขอ ตรวจร่าง เปิดใช้ เชิญสมาชิก และกดเล่นทั้งสองฝั่ง ไม่ได้ใช้ authored fixture เป็นผล AI หรือส่งคำสั่งเล่นตรงผ่าน API

DeepSeek ตอบ model `deepseek-flash` จริงหนึ่งครั้ง ใช้ 3,538 input + 1,833 output = 5,371 tokens เวลา provider 6,024 ms ไม่ใช่เวลารอรวมบนหน้าจอ โปรแกรม Active ตรงกับผล provider ทั้งชุด ตรวจเทียบก่อนเก็บรายงานแล้ว

| สิ่งที่ตรวจ | ผลและขอบเขต |
| --- | --- |
| ไฟล์ → AI → กฎ | 1 collection, 5 actions, 3 starting records ผ่าน Simulate/Validate/Approve/Activate เป็น r1 |
| Printer | สมาชิก claim → submit → เจ้าของ approve → reopen; assignee/note ถูกล้าง จากนั้นเจ้าของรับและปิดงานรอบใหม่ |
| Wi-Fi | สมาชิก claim → submit พร้อมหมายเหตุ → เจ้าของ approve |
| Access | รับขณะ blocked ถูกปฏิเสธ; เจ้าของ authorize → สมาชิก claim/submit → เจ้าของ approve ไม่มีการเปลี่ยนสิทธิ์ IT จริง |
| รับงานซ้ำ | server ปฏิเสธ โดยไม่เปลี่ยนข้อมูล |
| ส่งแทน assignee | แม้เป็นเจ้าของก็ส่งแทนผู้รับงานไม่ได้ server ปฏิเสธ |
| หมายเหตุว่าง | HTML required กันไว้ก่อนส่ง เป็นหลักฐานเฉพาะฟอร์ม |
| หมายเหตุเว้นวรรคล้วน | server ปฏิเสธ `TABLE_INPUT` ผ่านฟอร์มจริง |
| อนุมัติก่อนส่งตรวจ | server ปฏิเสธสถานะที่ยังไม่เป็น review |
| คำสั่งเฉพาะเจ้าของ | สมาชิกไม่มีปุ่ม approve/reopen/authorize เป็นหลักฐานเฉพาะ UI ในรอบนี้ |
| กลับมาเล่นต่อ | ปิดแท็บสมาชิกและเปิดแท็บใหม่ กลับห้องเดิมพร้อม Access ที่รอตรวจและหมายเหตุเดิม แล้วอนุมัติต่อจนจบ |
| ผลสุดท้าย | ทั้งสองบัญชีเห็นสามงานเป็น done ตรงกัน data r15; การกระทำสำเร็จ 14 ครั้ง server rejection ที่คาดไว้ 5 ครั้ง |

AI เตือนคลาดเคลื่อนว่าระบบไม่รองรับการปฏิเสธหมายเหตุเว้นวรรคล้วน แต่ required action text ของ runtime ปฏิเสธได้จริงและทดสอบแล้ว จึงต้องอ่าน assumptions และหลักฐานก่อนเปิดใช้ แม้โปรแกรมจะผ่าน structural checks คอลัมน์ assignee ยังแสดงรหัสสมาชิกภายใน ยังไม่ได้แปลงเป็นชื่อบนตาราง

หลักฐานละเอียดและภาพจาก local อยู่ใน ignored `test-results/office-helpdesk/` ไม่เผยแพร่ raw runtime/account evidence ใน GitHub การทดสอบนี้ไม่ใช่หลักฐานของ Google สองบัญชีจริง, server restart recovery, load test หรือ production acceptance

## วิธีทำซ้ำ

สร้างไฟล์ UTF-8 ชื่อ `helpdesk-policy.md` ด้วยข้อมูลสมมตินี้:

```text
# Office Helpdesk — synthetic acceptance case

This is made-up office data for testing. No real employee or customer is involved.
One shared queue contains three tickets. The room owner is the dispatcher and final reviewer. Participants are technicians.

Tickets start with an empty assignee and completion note:
- printer: Fix floor-2 printer, status=open, requiresApproval=false.
- wifi: Diagnose meeting-room Wi-Fi, status=open, requiresApproval=false.
- access: Prepare access request, status=blocked, requiresApproval=true.

Use one tickets collection with title, status, assignee, completionNote and requiresApproval fields. Use stable record identifiers printer, wifi and access. Status is one of open, blocked, in_progress, review or done. Assignee stores the acting member identity, not a typed display name.

Actions:
1. Claim ticket: owner or participant may claim an open ticket with requiresApproval=false. Set assignee to the acting member and status to in_progress. A claimed ticket cannot be claimed again.
2. Submit for review: only the ticket's assignee may submit an in_progress ticket. Require a nonempty completion note, save it and set status to review.
3. Approve completion: only the owner may approve a ticket in review. Set status to done without changing the assignee or note.
4. Reopen ticket: only the owner may reopen a done ticket. Set status to open and clear assignee and completionNote.
5. Authorize blocked ticket: only the owner may authorize a blocked ticket requiring approval. Set requiresApproval=false and status=open. It may then be claimed normally.

Do not add autonomous actions, turn order, scenario-name special cases, unsupported external systems, or pretend that approving the access ticket actually grants real IT access. It only changes this synthetic queue.
```

1. สร้าง Shared data table แล้วแนบไฟล์จากหน้า Canvas
2. ใน Change rules ขอให้สร้างสามงานและห้าคำสั่งครบตามไฟล์ ใช้ acting member เป็น assignee และมี required completion note ยืนยันการส่งข้อมูลให้ provider
3. อ่านกฎ สิทธิ์ เงื่อนไข ผลเปลี่ยนแปลง แถวเริ่มต้นและ source evidence ก่อน Simulate → Validate → Approve → Activate
4. เจ้าของกด Invite เลือก Member 1 แล้วให้บัญชีที่สองเปิดลิงก์ใช้ครั้งเดียว ภายในเวลาที่กำหนด
5. เล่นตามตารางผลทดสอบ ตรวจข้อมูลจากทั้งสองฝั่ง และปิดแท็บสมาชิกระหว่างงานรอตรวจเพื่อทดสอบกลับมาเล่นต่อ

คำสั่งและถ้อยคำจาก AI อาจต่างกันแต่ละรอบ ผลที่ยอมรับต้องรักษาเงื่อนไขจากไฟล์ ไม่ใช่ผ่านเพียงเพราะมีปุ่มครบห้าปุ่ม
