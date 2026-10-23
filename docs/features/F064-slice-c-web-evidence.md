# F064 สไลซ์ C — ผลค้นเว็บเป็นหลักฐานของโต๊ะ (ออกแบบ)

| | |
| --- | --- |
| สถานะ | `design` — เอกสารเท่านั้น ยังไม่ลงโค้ด |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | MINOR — เพิ่มฟิลด์ optional ใน source + คำสั่งใหม่ ไม่มี SQL migration |
| งานในกระดาน | [PLAN.md](../../PLAN.md) แถว `F064-T11` |
| ต่อจาก | [F064](F064-web-search.md) สไลซ์ A (progress) + สไลซ์ B (Sources บนการ์ด) · [F039](F039-auto-apply-rules.md) (ขั้นตรวจ/auto-apply) |

## ทำไม

สไลซ์ B ทำให้ผู้ใช้ **เห็น** ว่า research ใช้แหล่งไหน (`<details>Sources (N)</details>`) แต่แหล่งเหล่านั้นยังเป็นแค่ข้อมูลแสดงผล — ถ้าผู้ใช้อยากให้ตารางอ้างอิงข้อเท็จจริงจากเว็บจริง ๆ ต้องดาวน์โหลด/คัดลอกเนื้อหาเองแล้ว `table.import` เป็นไฟล์ก่อน ซึ่งขัดกับเจตนา "ค้นเว็บเป็นเรื่อง native"

สไลซ์ C คือขั้นที่ทำให้ผลค้น **กลายเป็นหลักฐานของโต๊ะได้** ภายใต้กติกาเดิม: หลักฐานทุกชิ้นต้องอ้าง source ที่อยู่บนโต๊ะ และ quote ต้องเป็นข้อความจริงจาก source นั้น

## ข้อเท็จจริงจากโค้ด (2026-10-23, `dev` `e287288`)

| ชั้น | สภาพปัจจุบัน | หลักฐาน |
| --- | --- | --- |
| evidence contract | `program.evidence: { sourceId, quote }[]` ≤20, `quote` 1–500 ตัวอักษร | `src/tabletop/shared/table-contracts.ts:25`, `src/tabletop/domain/table.ts:119` |
| กติกา evidence | ไม่มี source ⇒ evidence ต้องว่าง · มี source ⇒ evidence ต้องไม่ว่าง และทุก quote ต้องเป็น substring ของ `source.text` | `src/tabletop/domain/table.ts:418-421` |
| table source | `TableSource { id, filename, text, sha256, createdAt }` — **ไม่มี status/kind/url** | `src/tabletop/shared/table-contracts.ts:12` |
| เพดาน source | ≤4 แหล่ง, ไฟล์ละ ≤32 KiB, รวม ≤64 KiB, ชื่อไฟล์ต้องลงท้าย `.csv/.json/.txt/.md` | `src/tabletop/domain/table.ts:17-18,284,881-882` |
| คำสั่งที่มี | `table.import` (`files.add`, owner+participant) · `table.removeSource` (`files.remove`, owner) — ห้ามลบ source ที่ revision ยังอ้าง | `src/tabletop/domain/table.ts:879-909` |
| permission | แค็ตตาล็อกมี `files.add`/`files.remove` แต่ **ไม่มี `files.verify`** | `src/tabletop/shared/permissions.ts:14,29-30` |
| invoice (แบบอย่าง) | source มี `status: provided\|verified\|rejected` + `invoice.reviewSource` owner-only + โควตา 20 | `src/tabletop/shared/contracts.ts:43`, `src/tabletop/domain/invoice.ts:370-402` |
| draft input | ส่ง `sources: {id, filename, text}` (เฉพาะที่ยังไม่ถูกอ้าง) + `importedSources` แบบไม่มี text | `src/tabletop/shared/table-draft-input.ts:33-51` |
| apply | `TableChange = { kind, program, initialRecords }` — **ไม่มีช่อง sources** ⇒ AI เพิ่ม source เองไม่ได้ | `src/tabletop/shared/table-contracts.ts:31` |
| prompt | system prompt สั่งตรง ๆ ว่า *"never put web sources into program.evidence"* | `server/providers/deepseek-changes.ts:555` |
| command allowlist | คำสั่ง table ที่รับได้ระบุที่ `server/authority.ts:82`; event ของ `table.import` เก็บแค่ `sourceId/filename/sha256` ไม่เก็บ text | `server/authority.ts:82,972-980` |
| lifecycle | `evolve.simulate/validate/activate` ทุกขั้นเรียก `applyTableChange` ซ้ำ ⇒ source ที่ถูก reject ภายหลังจะทำให้ activate ล้ม | `src/tabletop/domain/evolution.ts:134-137,159-161,248` |
| snapshot | `sources` ถูกคัดลอกลงทุก revision snapshot (`state TEXT`) ⇒ source text โตเท่าจำนวน revision | `cloudflare/room-repository.ts:118,335-355` |

### ปัญหาของข้อสมมติใน handoff

handoff เขียนว่า "`applyTableChange`: รับ `webSources` เป็น source ประเภท `provided` (ต้องรอคนกดยืนยัน `verified` ก่อนใช้เป็น evidence)" — แต่ของจริงขัดกันสองจุด:

1. `TableChange` ไม่มีช่อง `sources` และกติกา evidence บังคับว่า quote ต้องอยู่ใน source **ที่อยู่บนโต๊ะแล้ว** ⇒ ร่างเดียวจะอ้าง web source ที่เพิ่งเกิดตอน apply ไม่ได้
2. ถ้าเพิ่ม source เป็น `provided` แล้วให้ evidence อ้างได้ทันที ก็เท่ากับข้ามขั้น verify; ถ้าให้อ้างไม่ได้ ร่างนั้นก็จะถูกตีกลับด้วย `TABLE_EVIDENCE` ทุกครั้ง

⇒ สไลซ์ C ต้อง **แยกการเพิ่มแหล่งออกจาก apply** และใช้ "ร่างถัดไป" เป็นจุดที่อ้างได้ หลังแหล่งผ่านการยืนยันแล้ว

## ข้อเสนอ (Recommended)

### สัญญาที่เปลี่ยน

`TableSource` เพิ่มฟิลด์ optional (ไฟล์เดิมไม่ต้องแก้ ยังอ่านได้):

```ts
export interface TableSource {
  id: string; filename: string; text: string; sha256: string; createdAt: number;
  /** F064 C: absent = a file the room imported (trusted as today). */
  origin?: 'web';
  /** F064 C: only web sources carry a review status; files keep today's implicit trust. */
  status?: 'provided' | 'verified' | 'rejected';
  /** F064 C: provenance shown on the source card and used for dedupe. */
  url?: string; publishedAt?: string | null; authority?: number; query?: string;
}
```

- `text` ของ web source = ระเบียนที่ประกอบจากผลค้น (ไม่ใช่ summary ดิบก้อนเดียว):
  `title + "\n" + url + "\n" + publishedAt + "\n" + "authority N" + "\n" + summary`
- กติกา evidence เพิ่ม: source ที่ `origin === 'web'` ต้อง `status === 'verified'` จึงถูกอ้างได้ (ไฟล์เดิมไม่เปลี่ยน)
- เพื่อกัน "quote ที่เป็นแค่ URL": สำหรับ web source quote ต้องเป็น substring ของ `title + "\n" + summary` เท่านั้น (ไม่ใช่ URL/วันที่/authority)

### คำสั่งใหม่ (domain)

| คำสั่ง | payload | สิทธิ์ | กติกา |
| --- | --- | --- | --- |
| `table.addWebSources` | `{ jobId }` | `files.add` (owner+participant) | worker อ่าน research จาก job เอง (client ปลอมไม่ได้) · dedupe ด้วย `url` ที่ normalize แล้ว · เพิ่มเป็น `status:'provided'` · ใช้เพดาน source เดิม (≤4/≤32 KiB/≤64 KiB) · touch `table.sources` cardMeta |
| `table.reviewWebSource` | `{ sourceId, status: 'verified' \| 'rejected' }` | owner (ตามแบบ invoice) | เปลี่ยนได้เฉพาะ source `origin:'web'` ที่ `status:'provided'` · rejected ยังอยู่บนโต๊ะแต่ถูกตัดจาก AI input และอ้างไม่ได้ |

### ลำดับการใช้งาน (flow)

```
research (สไลซ์ A/B) → draft card แสดง Sources (N)
   → [Add to table sources]  (ผู้ใช้กด)  → source เกิดสถานะ provided
   → [Verify] (owner)                    → verified
   → ผู้ใช้ขอร่างใหม่ → tableDraftInput ส่งเฉพาะ web source ที่ verified
   → AI เขียน evidence ที่อ้าง web-N → applyTableChange ตรวจ status + quote
```

- `tableDraftInput` กรอง web source: ส่งเฉพาะ `verified` (provided/rejected ถูกตัดออกจาก AI input เพื่อไม่ให้โมเดลอ้างข้อความที่ยังไม่ตรวจ)
- ร่างเดิม (ก่อน verify) **ไม่ถูกแก้ย้อนหลัง** — ถ้าต้องการ citation ต้องขอร่างใหม่ (ระบุใน UI)
- auto-apply (F039) ไม่ auto-verify: web source ต้องมีคนกด verify เสมอ

### Feature switch

`TABLE_WEB_EVIDENCE=off` ปิดสองคำสั่งใหม่ (worker ตอบ `TABLE_WEB_EVIDENCE_DISABLED`) และซ่อนปุ่มบนการ์ด — แยกจาก `TABLE_WEB_SEARCH` เพื่อให้ research ยังทำงานได้ระหว่างทยอยเปิดใช้

## UI ที่มีอยู่และจุดที่จะแตะ

| จุด | ไฟล์ (โดยประมาณ) | สิ่งที่จะเพิ่ม |
| --- | --- | --- |
| Files card (`table.sources`) | `src/tabletop/ui/TableCanvasObjects.tsx:104-127` (`TableSources`, `SourceCard`) | badge `provided/verified/rejected` + บรรทัด url/วันที่/authority และปุ่ม **Verify / Reject** เฉพาะ source `origin:'web'` (ลอกรูปแบบจาก invoice `src/tabletop/ui/WorkbenchShared.tsx:194`) |
| Rules card — evidence | `src/tabletop/ui/TableCanvasObjects.tsx:371-372` (`ProgramOverview`) | ใช้ `filename` เป็นตัวระบุแหล่ง; web source ตั้งชื่อไฟล์ให้อ่านได้ (`web-<host>-<n>.md`) และโชว์ไตเติลในลิสต์ |
| การ์ดร่างที่จบแล้ว | `src/tabletop/ui/useTableChat.tsx` (~1049-1068, สไลซ์ B) | ปุ่ม **Add to table sources** ใน `.tt-card-cta` + ข้อความยืนยันแบบเดียวกับ `TabletopApp.tsx:639` ("…was added… Review the source before using it in a rule change.") |
| callback | `useTableChat.tsx` (`UseTableChatOptions`, `ChatCardContent`) + `src/tabletop/TabletopApp.tsx:515` (`runCommand`) | `onAddSources(jobId)` → `runCommand('table.addWebSources', { jobId })`; ปุ่ม disabled ระหว่าง `busy` (busy key = ชื่อคำสั่ง) |
| สถานะรอ | `TableSources` | แสดง "N provided · N verified" ใกล้หัวการ์ด; ไม่มี auto-verify |

ข้อควรระวัง: หมายเลขบรรทัดใน `useTableChat.tsx` ขยับบ่อย (F070 เพิ่งเพิ่ม) — อ่านไฟล์จริงก่อนแก้

## สิทธิ์ · โควตา · ความเป็นส่วนตัว

- **สิทธิ์:** เพิ่มแหล่ง = `files.add` (เหมือน import) · ยืนยัน/ปฏิเสธ = owner ใน C1 (ไม่เพิ่ม permission ใหม่) — ถ้าต้องการให้ editor ยืนยันได้ ค่อยเพิ่ม `files.verify` ในรอบถัดไป
- **โควตา:** ใช้เพดานเดิม (≤4 แหล่ง, ≤32 KiB/แหล่ง, ≤64 KiB รวม) — web source 1 แหล่ง ≈ 1–2 KB (summary ≤800 ตัวอักษร) จึงไม่ทำให้เพดานรวมตึงขึ้นมาก แต่ 4 แหล่งคือข้อจำกัดจริงที่ผู้ใช้จะรู้สึก ⇒ วัดผลก่อนตัดสินใจขยาย
- **redaction:** title/url/query/summary ต้องผ่าน `redactString` + `createIdentityReplacements` **ก่อน** clamp และก่อนเก็บลง source text (ชุดเดียวกับ F045/F050) · URL ต้องผ่าน `safeExternalUrl()` ทั้งตอนเก็บและตอนอ่าน
- **ขนาด:** summary ≤800, title ≤200, url ≤500, query ≤180 (ใช้ค่าที่มีใน `model-job-progress.ts`)

## งาน (ยังไม่เริ่ม)

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| F064-T12 | contract + domain: ฟิลด์ optional, คำสั่ง `table.addWebSources`/`table.reviewWebSource`, กติกา evidence, แทน literal 4 ด้วย `MAX_TABLE_SOURCES`, guard ห้าม reject source ที่ revision อ้าง, เปิดคำสั่งใน `server/authority.ts:82` | unit: provided อ้างไม่ได้, verified อ้างได้, quote ต้องอยู่ใน title+summary, เพดาน/dedupe, reject ที่ถูกอ้างถูกบล็อก |
| F064-T13 | worker: สร้าง source จาก job (อ่าน job ฝั่ง server), redaction, `TABLE_WEB_EVIDENCE=off`, event payload ไม่มี text | worker test: client ปลอม jobId ไม่ได้, ไม่หลุดชื่อ/ID, switch ปิด, `room_events` ไม่มี text |
| F064-T14 | UI: ปุ่ม Add to sources + badge/ปุ่ม verify-reject + ข้อความสถานะ | unit view-model + browser scenario add→verify→cite |
| F064-T15 | draft input + prompt: ส่งเฉพาะ verified web source, แก้บรรทัด "never put web sources into program.evidence" ให้ตรงกติกาใหม่ | unit: provided/rejected ไม่ถึง provider; prompt ยังอยู่ใต้ 20,000 ตัวอักษร |
| F064-T16 | docs/spec/changelog + ผลตรวจจริง | ผลตรวจระบุใน spec |

## ทางเลือกที่พิจารณา

| ทางเลือก | ผล | ทำไมไม่เลือก |
| --- | --- | --- |
| A. ให้ `applyTableChange` รับ `webSources` แล้วอ้างได้ทันทีในร่างเดียว | ง่ายที่สุด | ข้ามกติกา "ต้อง verified ก่อน"; ถ้าบังคับ verified จะตีกลับทุกครั้ง ⇒ ใช้งานไม่ได้จริง |
| B. เก็บ source ไว้ใน job แยกจากโต๊ะ แล้วให้ evidence อ้าง job source | ไม่แตะ `TableSource` | ผิด invariant "evidence อ้างได้เฉพาะ source บนโต๊ะ" และ revision ย้อนหลังจะอ้างสิ่งที่ไม่มีใน snapshot |
| C (เลือก) | เพิ่ม source จาก job แบบ explicit + verify + ร่างถัดไปอ้างได้ | คงกติกา evidence เดิม, rollback ง่าย, ไม่ต้อง migration |
| D. ไม่ทำ (คงแสดงอย่างเดียว) | ไม่มีความเสี่ยง | ไม่ตอบโจทย์ "ผลค้นเป็นหลักฐานของโต๊ะ" |

## ความเสี่ยง

- **แหล่งปลอม/ผิด**: URL ผ่าน `safeExternalUrl` แต่เนื้อหาอาจไม่ตรง — quote ต้องมาจาก summary จริงและมีคนกด verify; ไม่มี auto-verify
- **เพดาน 4 แหล่ง**: web source แย่งที่กับไฟล์ที่ผู้ใช้อัปโหลด — ต้องวัดก่อนขยาย หรือเพิ่มโควตาเฉพาะ web (เป็นการเปลี่ยนกติกา ต้องให้เจ้าของผลิตภัณฑ์ตัดสิน)
- **quote ที่อ่อน**: ถ้าอนุญาตให้ quote URL/วันที่ จะได้ "หลักฐาน" ที่ไม่ใช่ข้อความ ⇒ จำกัด quote ให้อยู่ใน title+summary
- **แหล่งถูกลบ/แก้ภายหลัง**: source เก็บ snapshot ณ วันค้น ไม่ตามเว็บจริง — ต้องระบุวันที่ค้น (`createdAt`) บนการ์ด
- **reject หลังอนุมัติ**: ถ้า source ที่ revision อนุมัติแล้วถูก reject ภายหลัง `evolve.validate/activate` จะล้มกลางทาง ⇒ ต้องบล็อก reject เมื่อ active/retained revision อ้าง source นั้น (mirror guard ของ `table.removeSource` ที่ `table.ts:900-905`)
- **ขนาด snapshot**: `sources` ถูกคัดลอกลงทุก revision snapshot ⇒ source text ที่โตขึ้นจะทำให้ snapshot โตตาม (เพดาน program 64 KiB ไม่นับ source แต่ `state TEXT` ของ snapshot โต) — ต้องวัดก่อนเพิ่มจำนวนแหล่ง
- **ต้นทุน**: research ที่มีอยู่แล้วไม่มีค่าใช้จ่ายเพิ่ม; การเพิ่ม source เป็น local command

## คำถามที่ต้องให้เจ้าของผลิตภัณฑ์ตัดสิน (ก่อนลงโค้ด)

1. **ใครยืนยันได้**: owner เท่านั้น (แนะนำ, ตามแบบ invoice) หรือ editor ด้วย (`files.verify` ใหม่)
2. **เพดาน source**: คง 4 แหล่งเดิม (แนะนำ) หรือแยกโควตา web
3. **แหล่งที่ถูก reject**: เก็บไว้ให้เห็น (แนะนำ) หรือลบทิ้งอัตโนมัติ
4. **ร่างเดิม**: ยอมรับว่าต้องขอร่างใหม่หลัง verify (แนะนำ) หรือต้องการปุ่ม "แนบ citation เข้ากับร่างเดิม" (ซับซ้อนกว่า)

## ผลตรวจ (เอกสารเท่านั้น)

ไม่มี runtime change — ตรวจด้วย `node scripts/check-public-files.mjs`, `git diff --check`, `npx tsx server/changelog.ts check` และตรวจว่าไม่มี marker/unmerged · ไม่แตะ `spec.md` เชิงพฤติกรรม (มีเพียงบรรทัดชี้ว่าเอกสารออกแบบอยู่ที่ไฟล์นี้) · ไม่มี migration/secret/binding
