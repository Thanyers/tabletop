# F061 — การ์ด Rules อ่านรู้เรื่อง + เส้น canvas ไม่ทับการ์ดหรือกันเอง

| | |
| --- | --- |
| สถานะ | `review` |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — เปลี่ยนหน้าตา canvas แต่ rollback ได้ด้วย git revert; ไม่มี migration/secret/binding |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F061-T1` |

## ทำไม

1. **การ์ด Rules อ่านไม่รู้เรื่องหลังร่างกฎเสร็จ** — เนื้อหาถูกซอยเป็น `<details>` ซ้อนกัน (`Data fields`, `Actions`, `Views`, `Data checks`, capability, assumptions, JSON editor) เปิดมาเห็นแต่ summary และต้องเดาว่ากฎข้อไหน "ทำอะไร กับตารางไหน" เงื่อนไขกับผลลัพธ์ถูกพิมพ์ติดกันเป็นกอง list ที่ไม่มีหัวกำกับ
2. **เส้นเชื่อมบน canvas วิ่งทับการ์ดและทับกันเอง** — canvas ของ Tabletop ยังใช้ `smoothstep` ของ React Flow ซึ่งไม่รู้จักการ์ดเป็นอุปสรรค และไม่รู้จักเส้นอื่นเลย เส้นจึงลอดใต้การ์ดและทับกันจนอ่านทิศทางไม่ออก
3. **กระดาษโน้ตควรวางทับเส้นได้** — post-it คือกระดาษที่วางอยู่บนโต๊ะ การบังคับให้เส้นอ้อมมันทุกใบทำให้ canvas รกโดยไม่จำเป็น

## สิ่งที่ผู้ใช้จะเห็น

- เปิดการ์ด Rules → เห็น `Actions · N` เปิดอยู่แล้ว แต่ละกฎอ่านเป็น 3 บรรทัด: **When** (เงื่อนไข + ข้อความเมื่อไม่ผ่าน) / **Then** (ค่าที่เปลี่ยน) / **Applies to** (ตาราง · ฟิลด์) ปิดท้ายด้วยว่าใครใช้ได้ · `Data checks` เปิดให้เห็นประโยคของ check + ตาราง/ฟิลด์ที่บังคับ · `Data fields` พับไว้เมื่อต้องดูชนิดข้อมูลจริง
- ตอนเป็นข้อเสนอ: บรรทัดบนสุดบอกการเปลี่ยนแปลง (`5 new rules · 4 new tables · 3 starting rows`) และมีป้าย `New`/`Edited`/`Removed` เฉพาะตอนแก้ของเดิม · หัวการ์ดขึ้น `Proposed, not active` · ปุ่ม `Apply to table` อยู่ใต้ข้อเสนอทันที
- เส้นบน canvas: ไม่อ้อมก็ต่อเมื่อเจอการ์ด — อ้อมทุกใบ **ยกเว้น post-it** · เส้นที่ออกจากการ์ดด้านเดียวกันแยกจุดยึดกัน · เส้นคู่ขนานแยกเลน ไม่ทับกัน · จุดตัดอ่านออกว่าใครอยู่บน (เส้นนอนทับเส้นตั้ง; เส้นตั้งเปิดช่องที่จุดตัด)
- การ์ดที่พับอยู่สรุปสั้น ๆ: `5 rules on 4 tables · open to read them.`

## ขอบเขต

**รวม:** การ์ด Rules (`table.rules`) ทั้งสถานะใช้งานและสถานะข้อเสนอ · การ route เส้นของ canvas Tabletop ทุกชนิดโต๊ะ · post-it เป็น obstacle แบบ crossable · label ของเส้นยังหลบการ์ดทุกใบ

**ไม่รวม:** ไม่เปลี่ยนสัญญา JSON ของ program/candidate · ไม่แตะ permission, turn order หรือการคำนวณ · ไม่ย้าย rules ไปหน้าจออื่น · ไม่ทำ routing แบบ reactive ต่อการซูม (เส้นคำนวณจากพิกัด canvas ไม่ใช่พิกัดจอ)

## ข้อเท็จจริงจากโค้ด (ตรวจ 2026-10-23)

- `src/tabletop/ui/TableCanvasObjects.tsx` — `TableRules` (การ์ด), `ProgramOverview` / `ActionDefinition` / `CollectionDefinition` (เนื้อหา), `ProposedRecords`
- `src/tabletop/ui/rules-summary.ts` (ใหม่) — `diffProgram` / `describeProgramDiff` / `ruleBadge` (เทียบ program ที่ใช้อยู่กับข้อเสนอ)
- `src/tabletop/ui/rules-card.css` (ใหม่) — สไตล์ของการ์ด ใช้ token `--tt-*`; ตัด override เก่าใน `calm-workspace.css` ออก
- `src/state/edge-routing.ts` — เพิ่ม `crossableIds`, `crossingGap`, `separationCost`, `portSpacing`, `laneSpacing`; เก็บ `bridges`/`crossesOver` ในผลลัพธ์
- `src/tabletop/ui/CanvasWorkspace.tsx` — เปลี่ยนเส้นจาก `smoothstep` เป็น `canvasConnection` ที่มาจาก router (fallback เป็น `smoothstep` เมื่อไม่มีเส้นทางปลอดภัย)
- `src/components/CanvasEdge.tsx` — รับ `color` / `haloColor` / `strokeWidth` จาก caller (halo = สีกระดาษ canvas)

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F061-T1 | การ์ด Rules + routing เส้น + เอกสาร | `npm run typecheck`, `npm test`, `npm run lint` (0 error), `npm run build`, `npm run test:r1:browser` (7), `npm run test:cloudflare:browser` (32) ผ่าน · ตรวจในเบราว์เซอร์จริง: 0 เส้นทับการ์ด, 0 คู่เส้นทับกัน, มี bridge ที่จุดตัด, การ์ดไม่ overflow ที่ 390px |

## คำถามเปิด

- ควรใช้กฎ "เส้นนอนอยู่บน" ต่อไป หรือให้เส้นที่สั้นกว่าอยู่บน? (ตอนนี้เลือกกฎเดียวเพื่อให้อ่านทิศทางได้สม่ำเสมอ)
- ต้องการให้ label ของเส้น (เช่น "Numbers") แสดงบน canvas ด้วยหรือไม่ — ตอนนี้ยังไม่แสดงเพื่อไม่ให้รก

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-23 | ใช้ `When / Then / Applies to` เป็นโครงเดียวของทุกกฎ | ผู้ใช้ถามว่า "มีกฎอะไร ทำงานยังไง apply กับอะไร" — สามคำถามนี้ตอบได้ในที่เดียว |
| 2026-10-23 | ข้อเสนออยู่บนสุด และซ่อนบรรทัดนับจำนวนเมื่อมีบรรทัดการเปลี่ยนแปลง | ลดข้อมูลซ้ำซ้อนบนการ์ดที่ยาวที่สุด |
| 2026-10-23 | post-it เป็น obstacle แบบ crossable (เส้นลอดใต้ได้) แต่ label ยังหลบ | ตรงกับกายภาพของกระดาษบนโต๊ะ และผู้ใช้ขอให้ยกเว้น post-it |
| 2026-10-23 | จุดตัดใช้กฎ "เส้นนอนอยู่บน" | กติกาเดียวทำให้อ่านทิศทางได้โดยไม่ต้องเดา |
| 2026-10-23 | ใส่ lane ระหว่างการ์ดเป็นพิกัด grid | เดิม grid มีแต่ขอบการ์ด ทำให้เส้นหลายเส้นถูกบังคับให้ใช้เลนเดียวกัน |
