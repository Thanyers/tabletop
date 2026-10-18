# tabletop. — R1 Open Decisions

18 ตุลาคม 2026 · Asia/Bangkok · **คำตอบยัง Pending; recommendation ไม่เท่ากับ approval**

ใช้รายการนี้เพื่ออนุมัติ baseline แล้วเริ่ม Implementation Session แยกต่างหาก ไม่ต้องตอบเพื่อให้เผยแพร่เอกสารรอบนี้ เพราะเจ้าของอนุญาต planning commit/push ไว้แล้ว

| ID / owner | Decision | Recommended default | Alternatives / trade-off | Gate |
| --- | --- | --- | --- | --- |
| D01 Owner + lead | Runtime architecture | Hybrid extraction; reuse Canvas/domain tests; shared compiler/authority | Adapter-only เร็วแต่พิสูจน์ runtime ยาก; rewrite เสี่ยงเวลา | ก่อน M1 |
| D02 Owner | R1 acceptance + cuts | 3 playable cases, Invoice ครบ, live bounded proof, real sessions; cuts ตาม Master§11 | Invoice-only checkpoint ได้ถ้าเรียก pre-R1 และอนุมัติเปลี่ยน milestones | ก่อนเริ่ม |
| D03 Owner | Hackathon rules/deadline/team | ขอ official rules, วันและเวลาส่ง, จำนวนคนและ available effort | ยังไม่สมมติว่าใช้ prebuilt code/AI/generated assets ได้ | ก่อนรับ calendar commitment/submit |
| D04 Owner + lead | Source migration/provenance | Import approved local snapshot into official repo ในรอบ implementation พร้อม provenance และ license review | Preserve historical Sites history ผ่านแผน migration เฉพาะ; ห้าม force push/rewrite | ก่อน M0 source push |
| D05 Owner + release | Hosting provider/region/budget | Same-origin Node + Postgres + private object store; เสนอ paid Render app และ planning ceiling USD 100/month ก่อนภาษี/FX | Railway/Cloudflare เป็น alternative; ceiling เป็น allocation ไม่ใช่ quote ต้องตรวจ actual plan/backup/scan/model costs แล้วอนุมัติก่อนใช้เงิน | ก่อน provisioning |
| D06 Owner + security | Guest collaboration policy | Scoped guest cookie: 24h idle, 7d maximum; one-use invite 10 min; 3 actors per room | Login เพิ่ม complexity; open room code อย่างเดียวไม่พอ | ก่อน M2 |
| D07 Owner | Retention/reset | Workspace TTL 7d; clear UI; epoch reset + cleanup verification; synthetic data only | Retention สั้นลด risk แต่ review ซ้ำยาก; ยาวขึ้นเพิ่ม ops/cost | ก่อน M2 |
| D08 Owner + AI lead | Live model provider/model/budget | Server-only key; bounded JSON patch; 5 jobs per room per day; 60-second timeout; global cap | Manual fallback ยังมีประโยชน์แต่ใช้แทน live proof ไม่ได้ | ก่อน M6/live calls |
| D09 Owner + domain | Invoice contract | THB integer satang; 3 rate families; text PDF template + CSV; no FX/tax calculation | CSV-only เป็น scope change ที่ต้องอนุมัติ; defer general OCR | ก่อน M3 |
| D10 Owner + teaching lead | F=ma lesson/rubric | Frictionless cart, SI units, F 0–20, m 0.5–10, t 0–5; teacher control | Wider physics หรือ learner classification ไม่อยู่ใน R1 | ก่อน M4 |
| D11 Owner + game lead | Original encounter rules | DM + 2 players; self → ally shield → 1 AP/once per own turn; no official assets | Full D&D rules/licenses เลื่อนไปหลัง R1 | ก่อน M5 |
| D12 Owner + release | Public exposure/promote | Preview สำหรับ bounded review; separate public production approval | Documentation-only Pages preview ทำภายหลังได้หากต้องการ | ก่อน hosting/promotion |
| D13 Owner + release | Persistent schema operations | Explicit environment/table/migration/rollback review | General implementation approval ไม่ข้าม structural-change gate | ก่อน DB migration |
| D14 Owner | Release reviewer/on-call/contact | ระบุชื่อผู้รับผิดชอบ go/no-go และ incident | หากไม่มี owner รับ operational risk ให้จำกัด review window | ก่อน M7 |

## Decisions already resolved by the latest request

- Official target คือ `https://github.com/Thanyers/tabletop`; ใช้บัญชีเป้าหมายจาก credential ที่ตรวจแล้ว ไม่ใช้บัญชีเดิม.
- Latest planning destination คือ `handoff/Final/planning-review`; จัดทำ Markdown 5 ไฟล์และ HTML 3 ไฟล์ตามชื่อที่ระบุ.
- รอบนี้ commit/push เฉพาะ planning documents บน review branch; เปิด PR หากสิทธิ์รองรับ; ไม่ merge `main`.
- ไม่แก้ product code, ไม่เพิ่ม dependencies, ไม่ติดตั้ง CI/CD, ไม่ deploy application และหยุดก่อน implementation.
- HTML ต้องอ่าน offline ได้และมีเนื้อหาเท่ากับ Markdown; ต้องมี architecture/topology/roadmap/matrices/tests.

## Recommended approval wording for the next session

เจ้าของสามารถระบุ “อนุมัติ D01/D02 และเริ่ม M0–M1 ตาม Master Plan revision ใน PR นี้” พร้อมคำตอบ D03/D04 ที่เกี่ยวข้อง การอนุมัติ milestone ต้นไม่ใช่ blanket approval ให้สร้าง production DB, เปิด paid services หรือ deploy public release.

หากต้องการอนุมัติหลาย milestones พร้อมกัน ให้ระบุ provider/region/budget/guest retention/live-model scope และ target environment ที่เลือกด้วย แล้วทีมใช้ baseline เดียวกันทั้ง implementation/tests/release.

## Unknowns retained deliberately

Hackathon official rules/deadline, ชื่อทีม/owner จริง, maximum budget, hosting account readiness, provider region/account quotas, domain/trademark/legal eligibility, live model availability และ public release policy ยังไม่ได้รับคำตอบ สิ่งเหล่านี้ไม่ใช่ failed tests และไม่ได้แปลว่าปิดงาน planning แล้ว.

อ่าน branch protection endpoint ด้วย token นี้ไม่ได้ (403); branch listing ระบุ unprotected และ rulesets ว่าง ณ snapshot ต้องตรวจ effective policy ใหม่ก่อน implementation PR/release โดยไม่ขอเพิ่ม permissions เพียงเพื่อทำ planning ให้ครบเกินจำเป็น.
