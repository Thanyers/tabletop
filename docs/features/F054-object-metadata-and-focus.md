# F054 — เวลาและที่มาของการ์ด + ปุ่มพาไปหาการ์ดบน Objects panel

| | |
| --- | --- |
| สถานะ | `review` — v1 ครบ (ข้อมูล + UI + unit/browser evidence) เหลือ browser suite ของ repo |
| เจ้าของฟีเจอร์ | lead (AI) |
| เวอร์ชันที่คาด | **MINOR** — เพิ่ม field เสริมแบบ optional ใน state, ไม่มี migration; rollback แล้วเวลาใหม่หายแต่โต๊ะยังทำงาน (ตัดสินด้วย "deploy แล้ว rollback ทันทีได้ไหม") |
| งานในกระดาน | `F054-T1`…`T8` (เพิ่มแถวใน [PLAN.md](../../PLAN.md) แล้ว) |
| ภาพดีไซน์ | [F054-objects-panel.html](../previews/F054-objects-panel.html) · [desktop, Created · newest](../previews/F054-objects-panel-desktop.jpg) / [Canvas order](../previews/F054-objects-panel-canvas-order.jpg) / [mobile](../previews/F054-objects-panel-mobile.jpg) |
| ภาพจากแอปจริง | [panel 3 actions](../previews/F054-panel-3actions.jpg) · [desktop focus](../previews/F054-desktop-focus.jpg) · [mobile focus](../previews/F054-mobile-focus.jpg) · [280px](../previews/F054-panel-280.jpg) |

## ทำไม

Objects panel ด้านซ้ายของ canvas เป็นทางเดียวที่ใช้หาและเปิดการ์ดได้ครบทุกใบ (`src/tabletop/ui/CanvasWorkspace.tsx:1540-1564`) แต่ตอนนี้แถวบอกแค่ชื่อกับสถานะซ่อน/แสดง ไม่ตอบคำถามที่คนใช้โต๊ะถามจริง:

1. **การ์ดนี้มาจากไหน** — AI draft, ไฟล์ที่อัปโหลด, โน้ตของเพื่อน, หรือระบบสร้างให้
2. **สร้างเมื่อไร แก้ล่าสุดเมื่อไร** — เพื่อหา "ของใหม่" ในโต๊ะที่มีได้ถึง 24 การ์ด (`src/tabletop/runtime/index.ts:40-49`)
3. **ไปดูการ์ดนั้นเฉย ๆ ได้ไหม** — วันนี้คลิกแถวแล้วได้ทั้งเปิด/ขยายการ์ด ปิด panel และย้ายกล้องพร้อมกัน (`CanvasWorkspace.tsx:798-824`) จึงไม่มี action "พากล้องไปดู" ที่ไม่เปิดการ์ดทับบริบทเดิม และ `Previous view` มีช่องเดียว (`:585, :810`)

ข้อจำกัดที่ทำให้เรื่องนี้ไม่ใช่แค่เพิ่มข้อความ: `PlanNode` ไม่มีเวลาเลย (`runtime/index.ts:12, :159`) เวลาที่มีจริงมีเฉพาะ notes, sources, revisions, chat และ activity (`shared/table-contracts.ts:9, :34`; `shared/contracts.ts:33, :38`) และการแก้โปรแกรมของ AI **แทนที่โปรแกรมทั้งก้อน** (`domain/table.ts:258`) พร้อม bump rule revision เดียว (`domain/evolution.ts:274-280`) ถ้าไม่ diff รายการ์ด การ์ดทุกใบจะดู "อัปเดตพร้อมกัน" ซึ่งไม่จริง

## สิ่งที่ผู้ใช้จะเห็น

1. **บนการ์ดทุกใบ** มีบรรทัด meta เล็กใต้ชื่อ เช่น `AI · Mali · 12 Oct → 2h ago`, `MALI · created 12 Oct`, `SYSTEM · since 12 Oct`; hover/โฟกัสแสดง tooltip เวลาเต็มและผู้เกี่ยวข้อง
2. **โน้ต** แสดงเวลาในบรรทัดผู้เขียนท้ายกระดาษ (`Mali · 5m ago`); **การ์ดแชท** แสดงเวลาใต้ชื่อผู้ถาม
3. **Objects panel** แต่ละแถวเป็น 2 บรรทัด (ชื่อ + meta) มีปุ่ม **"ไปที่การ์ด"** (crosshair) ต่อแถว และมี **Sort** 4 แบบ: `Created · newest` (ค่าเริ่มต้น), `Updated · newest`, `Canvas order`, `Created · oldest` — จำค่าที่เลือกไว้ต่อโต๊ะ
4. **กดปุ่มไปที่การ์ด** = select + fit การ์ดให้เห็นทั้งใบ โดย**ไม่ขยายการ์ด**; บน desktop panel ยังเปิดอยู่ (ขยับกล้องไปยังพื้นที่ว่างด้านขวาของ panel), บนจอแคบ panel พับเก็บแล้วคืน focus ให้ปุ่ม Objects
5. **กดชื่อแถว** ยังทำงานเหมือนเดิม: เปิด/ขยายการ์ด + ย้ายกล้อง + ปิด panel
6. การ์ดที่ไม่มีหลักฐานเวลาแสดง `not recorded` ไม่เดา; ค่าที่อนุมานจาก revision แสดง `~` หรือ `since rN`

## ขอบเขต

**รวม:** คง **Objects panel เดิม** (popover 320px ใต้ปุ่ม Objects, `Previous view`, `Connections` อยู่เหมือนเดิม) แล้วเพิ่มความสามารถเข้าไปในแถวเดิม · `TableState.cardMeta` แบบ optional + schema + projection · จุดเขียน meta ตอน activate/command ที่มนุษย์สั่ง · ตัว resolve/backfill จากหลักฐานเดิม · meta line บนการ์ด plan/auxiliary/note/chat · แถว panel + sort + ปุ่มพาไป · a11y (aria, live region, focus return, keyboard, reduced motion) · unit + browser tests · เอกสาร

**ไม่รวม:** สร้าง panel/dock ใหม่หรือเปลี่ยน popover เป็น dock ถาวร · เปลี่ยนความกว้าง/ตำแหน่ง/trigger ของ panel เดิม · filter/search/group by day · drag reorder หรือ multi-select ในลิสต์ · ประวัติแก้ไขรายการ/undo · timestamp ระดับ field หรือ row · การแก้ F007 shared layout · การอ้าง authenticated identity ในกรณีที่ projection ซ่อนข้อมูล

## ข้อเท็จจริงจากโค้ด (ตรวจ 22 ต.ค. 2026)

| เรื่อง | หลักฐาน |
| --- | --- |
| Objects panel + แถว list | `CanvasWorkspace.tsx:1540-1564`, `objectTitles` `:1460-1463`, hidden `:547-578` |
| พฤติกรรมคลิกแถวเดิม | `CanvasWorkspace.tsx:798-824` (เปิด + select + ปิด panel + focus), effect รอ geometry `:826-907`, คืน focus `:883` |
| `Previous view` ช่องเดียว | `CanvasWorkspace.tsx:585`, ตั้งค่า `:810`, ปุ่ม `:1552` |
| Modal/panel เป็น overlay ไม่ดัน canvas | `canvas-visual-flow.css:52-63, :89-105`; panel กว้าง `min(320px, …)` |
| แถว/ปุ่ม/ขนาด | `canvas-visual-flow.css:128-143`; `calm-workspace.css:363-374` (ปุ่มตา 32×32, แถว 42px) |
| `PlanNode` ไม่มีเวลา | `runtime/index.ts:12` (type), `:159` (factory), id ของการ์ด `:165-214` |
| AI แทนที่โปรแกรมทั้งก้อน | `domain/table.ts:258`; revision ใหม่ `domain/evolution.ts:234-235, :274-280`; เก็บ 20 revisions `:278` |
| พฤติกรรม preserve views (F018) | `domain/table.ts:249-252`, `runtime/generative/preserve.ts:12-33` |
| projection | `domain/projections.ts:19-29` (open = clone ทั้งก้อน), `:37-42` (private ตัด candidate/revisions ของ participant) |
| การเก็บ state | `cloudflare/room-repository.ts:87-92` (JSON ใน DO SQLite), `:183-202` (อ่านจริงแค่ `kind`), `server/schema.sql:32-46` (JSONB) → ไม่ต้อง D1/Postgres migration ถ้าเพิ่ม field ใน JSON |
| เวลาที่มีอยู่จริง | `TableSource.createdAt` `shared/table-contracts.ts:9`; `TableNote.createdAt/updatedAt/createdBy` `:34`; `RevisionRecord.activatedAt/actorId` `shared/contracts.ts:38`; chat `createdAt` `ui/useTableChat.tsx:586`; activity `table-contracts.ts:44` |
| note move ไม่แตะ updatedAt | `domain/table.ts:466-472` |
| test ที่ผูกกับพื้นที่นี้ | `runtime/runtime.test.ts:14-16, :23`; `domain/projections.test.ts:38, :58, :86`; browser test ids `tests/*.mjs` |
| ไม่มีเทสต์ unit ที่ mount `CanvasWorkspace` | grep ไม่พบ; พฤติกรรม panel พิสูจน์ด้วย browser suite เท่านั้น |

## การออกแบบข้อมูล

### ทำไมต้อง persist ไม่ใช่ derive อย่างเดียว

derive จาก `revisions` อย่างเดียวไม่พอ เพราะ (1) participant ใน private projection ไม่ได้รับ `revisions` (`projections.ts:37-42`) (2) เก็บแค่ 20 revisions ล่าสุด (`evolution.ts:278`) การ์ดที่เก่ากว่านั้นจะไม่มีวันสร้าง (3) ถึง derive ได้ก็ต้อง diff program อยู่ดี เพราะโปรแกรมถูกแทนทั้งก้อน. localStorage ก็ไม่ใช่คำตอบ เพราะ scope ต่อ actor/epoch (`ui/canvas-layout-scope.ts:11-13`) และหายเมื่อเปลี่ยนเครื่อง/รีเซ็ต epoch.

### รูปแบบที่เสนอ

```ts
export interface CanvasCardMeta {
  createdAt: number;       // ms epoch จาก server (ctx.now)
  updatedAt: number;       // >= createdAt เสมอ
  createdBy?: string;      // actorId (ไม่ใช่ชื่อที่ display)
  updatedBy?: string;
  origin: 'ai' | 'human' | 'system' | 'demo';
  revision?: number;       // rule revision ที่สร้าง/แก้ล่าสุด (program cards)
  source: 'recorded' | 'inferred';
}

// TableState (shared/table-contracts.ts) — เก็บนอก TableProgram
cardMeta?: Record<string, CanvasCardMeta>; // <= 48 keys, <= 12 KiB
```

- key = canvas node id เดียวกับ runtime (`table.rules`, `table.actions`, `table.collection.<id>`, `table.view.<id>`, `table.sources`, `table.note.<id>`) ไม่ใช้ title เพราะ title เปลี่ยนได้
- เก็บนอก `TableProgram` เหมือน `notes` / `canvasLayout` / `computedColumns` → ไม่แตะ strict program schema (`domain/table.ts:48-64`), ไม่กระทบ `planDelta` / `candidate.hash` (`evolution.ts:69-81`) และไม่กิน budget 64 KiB ของโปรแกรม (`table.ts:212`)
- schema validation: timestamp เป็น safe integer, `updatedAt >= createdAt`, `origin` enum, key ตรงกับ id ที่มีจริง, prune key ที่ไม่มีในการ์ดปัจจุบัน, cap 48/12 KiB

### จุดเขียน meta (ที่เดียวต่อ mutation)

| คำสั่ง | เขียนอะไร | ที่เขียน |
| --- | --- | --- |
| `evolve.activate` / `evolve.autoApply` | diff program เก่า/ใหม่รายการ์ด; ใหม่ → created=updated, แก้ → updated, ไม่เปลี่ยน → ไม่แตะ, หาย → ลบ key | `domain/evolution.ts:246-283` (`nextStateWithChange`) หลังได้ `next.program` |
| `evolve.removeItem` | ลบ key ของ action/invariant/view/collection ที่ถอด + update `table.rules` | `domain/evolution.ts:443-462` |
| add/remove source | `table.sources` created/updated, `origin:'human'`, `createdBy/updatedBy` | `domain/table.ts:480-500` |
| note add/edit/delete | mirror `note.createdAt/updatedAt/createdBy` (ไม่เก็บซ้ำซ้อนถ้าไม่จำเป็น) | `domain/table.ts:433-477` |
| reset | ล้าง `cardMeta` | reset path |
| chat card | ใช้ `card.createdAt` / job `createdAt` ของ client โดยไม่ลง state | `ui/useTableChat.tsx:582-593` |
| people / history / ai | created = `view.createdAt`; updated = max(activity, revision, member change) แบบ inferred | resolver |

**ห้าม stamp ใน `applyTableChange`** เพราะมันเป็น simulator/preview (`evolution.ts:134`) และ validation เรียกซ้ำ/เทียบผลแบบ canonical (`evolution.ts:208-214`) การเขียนเวลาตรงนั้นจะทำให้ผล simulation ไม่ deterministic และ candidate hash ไม่ตรง. ให้ stamp เฉพาะตอน activation และ command ที่มนุษย์สั่ง

**ไม่ bump โดยเด็ดขาด:** drag/resize (`updateLayout`), pin/unpin, layer, hide/show, open/close, select, camera move, save, lens/interaction mode. รายการนี้ต้องมี comment ในโค้ดและ test กัน drift

### Backfill/ตัวอ่าน (read-only)

`resolveCardMeta(state, view, auxiliary)` ใช้ลำดับ:

1. `state.cardMeta[id]` ถ้ามี
2. note → `note.createdAt/updatedAt/createdBy`; source → `source.createdAt`; chat → `card.createdAt` (หรือ job)
3. program cards → timeline จาก `state.revisions` (`activatedAt` + `snapshot.program`) + `state.program` ปัจจุบัน; signature = `canonicalJson` ของ descriptor ของ id นั้น (view/collection/action/rules) ± สร้าง = revision แรกที่พบ, แก้ = revision ล่าสุดที่ signature เปลี่ยน
   - ถ้า revision แรกที่เก็บไว้ไม่ใช่ r1 → `source:'inferred'` และแสดง `since rN` แทนการอ้างเวลาสร้างที่แน่นอน
4. system cards → created = `view.createdAt` (`since`), updated = เวลาล่าสุดจาก activity/revision
5. ไม่มีหลักฐาน → `undefined` → UI แสดง `not recorded`

resolver ต้อง deterministic และไม่เขียน state ระหว่างอ่าน; การ persist ค่า inferred เกิดตอน command ถัดไป (`ensureCardMeta`) เพื่อไม่ให้ read path กลายเป็น write

### Version / rollback

- **MINOR**: เพิ่ม optional field, ไม่มี migration, ไม่ต้องแตะ D1/Postgres
- rollback: client รุ่นเก่าไม่รู้จัก field นี้และไม่ล้ม (อ่าน state เป็น JSON, `mapWorkspace` ตรวจแค่ `kind`); อย่างแย่ที่สุดคือเวลาใหม่หายและ UI ถอยไปใช้ inferred
- `stateHash` เปลี่ยนเมื่อมี meta (คำนวณใหม่ทุกครั้ง, `server/authority.ts:401`) — ต้องเช็คว่าไม่มี cursor/เทสต์ที่ pin ค่า hash นี้ (แผน T1)
- ไม่บันทึกชื่อคนแบบถาวรใน meta: เก็บ `actorId` แล้ว resolve ชื่อจาก `view.members` ตอนแสดง (เหมือน `NoteCard`) — แสดงชื่อจริงตามที่เลือกไว้ แต่ไม่ duplicate ข้อมูลชื่อลง state

### AI origin ที่แม่นขึ้น (เฟส 2, ยังไม่รวมใน v1)

**วันนี้แยกไม่ได้** ว่าการ์ดโปรแกรมมาจากเส้นทางไหน เพราะทุกทางจบที่ `applyTableChange` เหมือนกันและ revision เก็บแค่ `actorId` ของคนที่ activate:

| เส้นทาง | หลักฐานที่มี | สิ่งที่ยังไม่รู้ |
| --- | --- | --- |
| AI auto-apply (F039) | `evolve.autoApply`, candidate.createdBy | AI ถูก apply อัตโนมัติหรือคนกด |
| AI draft แล้วมีคน approve | `evolve.activate`, revision.actorId | ใครเป็นคนขอ AI vs คนอนุมัติ |
| คน paste โปรแกรม JSON | `TableCanvasObjects.tsx:175-183` | ข้อความถูกร่างโดย AI หรือคน |
| คนลบ rule ทีละรายการ | `evolve.removeItem` | อยู่ใน revision เดียวกันแต่ต่างเจตนา |
| rollback | `evolve.rollback` | ย้อนไปใช้ของเก่า ไม่ใช่ของใหม่ |

**v1 ทำอะไรได้อย่างซื่อสัตย์:** แสดง `AI · <ชื่อผู้ apply> · created/updated` และ tooltip ว่า `AI-drafted rules, applied by <name> · r7` — ไม่เขียนว่า "AI เขียนเอง" หรือ "AI อนุมัติเอง" เพราะไม่มีหลักฐาน

**ถ้าต้องการแยกจริง (เฟส 2):**
1. เพิ่ม optional provenance นอก candidate hash: `RevisionRecord.origin?: 'assistant-auto' | 'assistant-reviewed' | 'human-paste' | 'human-remove' | 'rollback'`, `jobId?`, `askedBy?`
2. ตั้งค่าจาก server เท่านั้น: AI commit path (`cloudflare/room.ts:1389-1426`, autoApply `:1458,1492-1515`), paste (`TableCanvasObjects.tsx:175-183`), remove (`evolution.ts:443-462`), rollback (`:325-330`)
3. `cardMeta` copy ค่า origin/detail ที่ resolve แล้ว (จำเป็นเพราะ private projection ไม่ส่ง revisions ให้ participant)
4. UI แสดงเฉพาะ tooltip/detail เพิ่ม ไม่เพิ่มบรรทัดบนการ์ด; ตัวอย่าง: `AI draft, applied automatically by Mali · r7` / `AI draft reviewed and approved by Mali · r7` / `Program pasted by Mali · r7`
5. ต้นทุน: แตะ command/contract + room + tests; ไม่มี migration; ต้องเช็ค `stateHash` และ hash ของ candidate

**ข้อเสนอ:** ทำ v1 ก่อน (เวลา + ที่มาแบบที่พิสูจน์ได้) แล้วค่อยเพิ่ม T8 เมื่อมีคำถามจริงจากผู้ใช้ ว่า "อันนี้ AI ทำเองหรือคนทำ" — งานนี้ไม่ควรเดาแทนระบบ

## UX spec

### แถวใน Objects panel

- สูง ~54px: บรรทัด 1 ชื่อ 13px/650 (ellipsis), บรรทัด 2 meta 10.5px mono สี `--tt-muted` (#667268 บน `--tt-card-surface` ผ่าน WCAG AA ตามที่วัดใน preview)
- meta copy (ค่าเริ่มต้น: แสดงชื่อคน):
  - แก้แล้ว: `AI · Mali · 12 Oct → 2h ago` = สร้าง 12 Oct, แก้ล่าสุด 2h ago โดย Mali
  - ไม่เคยแก้: `MALI · created 12 Oct`
  - ระบบ: `SYSTEM · since 12 Oct`
  - ไม่มีหลักฐาน: `AI · not recorded`
  - อนุมาน: `~2h ago · since r5`
- ชื่อคน: token เป็นชื่อสมาชิกสำหรับการ์ดที่มนุษย์สร้าง (โน้ต/ไฟล์) และเป็น `AI` + ชื่อผู้ apply สำหรับการ์ดโปรแกรม; resolve จาก `view.members` ด้วย `actorId` (เหมือน `NoteCard`) — ถ้าถูกถอดออกแสดง `Member`/`former member`, ถ้าเป็นตัวเองแสดงชื่อจริงและ tooltip ต่อท้าย `(you)`; ชื่อยาวตัดด้วย ellipsis
- origin token: `AI` (moss), ชื่อคน (blue), `SYSTEM`/`DEMO` (muted) — 9.5px/600 ไม่เพิ่ม palette ใหม่
- ปุ่มต่อแถว: `row-main` (เปิดการ์ด), crosshair (ไปที่การ์ด), eye (ซ่อน/แสดง) — ทั้งสามมี aria-label เฉพาะและ title
- current: พื้น `#edf6f1`, inset border, `aria-current="location"`; hidden: opacity .55 + italic + eye-off
- tooltip (title) เต็ม: `Created 12 Oct 2026, 14:05 by Mali · Updated 22 Oct 2026, 18:42 by Mali · revision 7`
- ที่ 320px ข้อความ meta ต้องไม่ล้น: ใช้รูปแบบข้างบน (ไม่เกิน ~30 ตัวอักษร) และปล่อย ellipsis เฉพาะชื่อยาวมาก

### Sort

- control: label `Sort` + native `<select>` (เหมือน select ที่แอปใช้อยู่; ถ้า design system ไม่รับ native select ให้ใช้ listbox ของแอป)
- ตัวเลือกเรียงตามลำดับ: `Created · newest` (**ค่าเริ่มต้น**), `Updated · newest`, `Canvas order`, `Created · oldest`
- comparator: timestamp desc/asc, tie-break ด้วยลำดับผังเดิมแล้ว id; stable (การ์ดที่สร้างวันเดียวกันจะคงลำดับผังเดิม)
- เก็บที่ `tabletop:r1:canvas-sort:<workspaceKey>` (แบบเดียวกับ hidden/seen) — ค่าที่ไม่ถูกต้องถอยไป `Created · newest`
- เปลี่ยน sort แล้วไม่ animate การสลับ, คง focus ที่แถวเดิม (key = id), announce `Sorted by created, newest first` ผ่าน live region
- "Newest" ที่ผู้ใช้เลือก = **`Created · newest`** (สร้างล่าสุดก่อน); ค่า `Updated` ยังเลือกได้เมื่อต้องการดูของที่เพิ่งถูกแก้
- ผลข้างเคียงที่ต้องรู้: AI draft ที่เพิ่งสร้างจะขึ้นบนสุดเสมอ แม้ถูกซ่อนอยู่; การ์ดที่สร้างวันเดียวกันเรียงตามผังเดิม

### ปุ่ม "ไปที่การ์ด"

- icon: crosshair (`Focus`/`LocateFixed`), 32×36 (แตะง่าย ≥24px ตาม WCAG 2.5.8), aria-label `Go to <title>`
- **desktop >760px**: select การ์ด + fit เข้า safe area ด้านขวาของ panel (panel overlay อยู่ซ้าย) โดยไม่ขยายการ์ดและไม่ปิด panel
  - safe insets: ซ้าย = ขอบขวา panel + 12, บน = 64 (แถบ tools), ขวา/ล่าง = 12
  - zoom = `clamp(min(1.15, freeW/(w+2p), freeH/(h+2p)), 0.3, 1.15)`; `setViewport` duration 220 (0 เมื่อ reduced motion)
  - คง DOM focus ไว้ที่ปุ่มใน panel เพื่อกดดูการ์ดถัดไปได้ต่อ
  - announce `Moved to <title>`; ถ้า fit ไม่สำเร็จภายในเวลาที่กำหนด announce `Card is not ready yet`
- **mobile <=760px**: ปิด panel ก่อน (ไม่ให้ panel บังการ์ด), fit เต็ม canvas, คืน focus ให้ปุ่ม Objects เหมือนพฤติกรรมเดิม
- การ์ดที่ถูกซ่อน: ปลดซ่อนก่อนแล้วรอ layout (reuse `requestOpenObjectFocus` ด้วย `requireOpened:false`) ค่อย fit; ไม่ขยายการ์ด
- การ์ดที่ไม่อยู่ใน `visibleNodeIds`: วันนี้ไม่ถูก list เลย; ถ้าอนาคต list ให้ disabled พร้อมเหตุผล ไม่ใช่คลิกแล้วเงียบ
- ตั้ง `previousView` ก่อนย้ายกล้อง เพื่อให้ `Previous view` ย้อนกลับได้ (ยังเป็นช่องเดียว; ห้ามอ้างว่ามี back stack)
- คลิกชื่อแถว: คงของเดิม (เปิด + focus + ปิด panel)

### Meta บนการ์ด

- วางใน `.tt-canvas-node__identity` ใต้ชื่อ 1 บรรทัด; auxiliary ที่มี `subtitle` (ผู้ถามแชท) ให้ subtitle อยู่เหนือ meta
- โน้ต: เติมเวลาในบรรทัดผู้เขียนท้ายกระดาษ ไม่เพิ่มบรรทัดใหม่
- typography 10.5px mono, muted; ellipsis + tooltip เต็ม; ไม่มีสี/ไอคอนเพิ่มนอกจาก origin token
- เวลาสัมพัทธ์อัปเดตทุก 60 วินาทีผ่าน clock store ตัวเดียว (เฉพาะ meta component subscribe) ไม่ re-render body ทั้งการ์ด; ไม่ผูกกับ `prefers-reduced-motion`
- absolute format ด้วย `Intl.DateTimeFormat(undefined, …)` และ relative ด้วย `Intl.RelativeTimeFormat(undefined, { numeric:'auto' })` (repo ไม่มี i18n map; ใช้ locale ของเบราว์เซอร์แบบเดียวกับ `toLocaleString` ที่มีอยู่)

### Copy

`Objects`, `Previous view`, `Connections`, `Sort`, `Canvas order`, `Updated · newest`, `Created · newest`, `Created · oldest`, `Go to card`, `Show/Hide from canvas`, `not recorded`, `since rN`. ภาษา tool chrome เป็นอังกฤษตาม panel เดิม; วันที่เป็น localized

## Edge cases

| # | กรณี | พฤติกรรมที่ต้องการ |
| --- | --- | --- |
| 1 | โต๊ะเก่าไม่มี `cardMeta` | ใช้ inferred จาก revisions/source/note/chat; ถ้า revision เก่าถูก prune แสดง `since rN` ไม่แต่งเวลาสร้าง |
| 2 | participant ใน private projection | `revisions` ถูกตัด แต่ meta ที่ persist ยังอยู่ → แสดงเวลาได้; ถ้าไม่มี meta → `not recorded` |
| 3 | AI แก้โต๊ะโดยยังเก็บ view เดิม (F018) | signature ไม่เปลี่ยน → `updatedAt` ไม่ขยับ |
| 4 | AI เปลี่ยนชื่อ view เดียว | เฉพาะ view นั้นขยับ; rules/actions ขยับเฉพาะเมื่อ content เปลี่ยน |
| 5 | แถวข้อมูลใน collection เปลี่ยน | ไม่ bump meta ของการ์ด collection (data freshness มี `dataRevision` แยก); ระบุใน tooltip ถ้าต้องการ |
| 6 | ลาก/ย่อ/ขยาย/pin/layer/hide/open/select/camera/save | ไม่ bump |
| 7 | activation เปลี่ยนโปรแกรมทั้งก้อน | diff ตอน activate เท่านั้น; simulation ไม่เขียน meta |
| 8 | `removeItem` | ลบ meta ของสิ่งที่ถอด, update `table.rules`; การ์ดอื่นไม่ขยับ |
| 9 | reset | ล้าง meta; epoch ใหม่ |
| 10 | อัปโหลด/ลบไฟล์ | `table.sources` created/updated; เวลารายไฟล์ยังอยู่ในเนื้อการ์ด |
| 11 | ย้าย/ย่อโน้ต | `note.updatedAt` ไม่เปลี่ยนตาม domain → meta ไม่ขยับ |
| 12 | การ์ดแชท pending → job accepted (id เปลี่ยน) | อ่าน id จากแถวสดตอนคลิก; เวลาใช้ job `createdAt`; ระหว่าง pending แสดง `just now` |
| 13 | การ์ดถูกซ่อน + sort | ยังอยู่ในลิสต์; ปุ่มไปที่การ์ดปลดซ่อนให้ |
| 14 | การ์ดนอก `visibleNodeIds` | ยังไม่ list; อนาคตถ้า list ต้อง disabled + เหตุผล |
| 15 | โน้ตไม่มี editor ให้ "open" | คลิกชื่อ = select/focus (ไม่มีการขยาย); ปุ่มไปที่การ์ดจึงมีประโยชน์ที่สุด |
| 16 | การ์ดสูง/กว้างมาก | fit clamp 0.3 อาจ crop; ใช้ `Previous view` กลับ; ไม่สัญญาว่าเห็นครบ 100% |
| 17 | การ์ด 0-size/ยังไม่ mount | retry แบบเดิม ~5.8s แล้วมี announce แทนการเงียบ |
| 18 | panel บังการ์ด | safe-area fit บน desktop; จอแคบปิด panel ก่อน fit |
| 19 | เปลี่ยน sort ขณะแถวมี focus | คง focus ที่การ์ดเดิมหลังสลับ + announce |
| 20 | เวลาในอนาคต/clock skew | clamp เป็น `just now`; absolute ใช้เวลาจาก server; chat time เป็น client |
| 21 | locale/timezone | Intl ตามเบราว์เซอร์; absolute มีปี; ไม่ hardcode `th-TH` |
| 22 | สมาชิกถูกถอดแต่ยังเป็น createdBy | แสดง `former member` หรือ `Member`; ไม่เดาชื่อ |
| 23 | meta โตเกิน | prune ตาม id ปัจจุบัน, cap 48/12 KiB, ทิ้ง entry ผิดรูป |
| 24 | rollback ไป client เก่า | field ถูกเมิน; เวลาใหม่หายแต่โต๊ะทำงาน |
| 25 | ความหมาย "AI" | program cards = AI draft path; actor = คนที่ apply ไม่ใช่ผู้เขียน; ห้ามเขียนว่า AI เขียนเองถ้าไม่มีหลักฐาน |
| 26 | practice/demo | นาฬิกาจำลอง + label `DEMO`; ห้ามแสดงเป็นเวลาจริง |
| 27 | AI-origin ที่แม่นขึ้น | ต้องบันทึก origin ตอน job/command (เฟส 2) ไม่ใช่เดาจาก revision |

**ความเสี่ยงเรียงตามอันดับ:** (1) stamp ใน simulation ทำให้ validation/hash พัง (2) replace ทั้งก้อนแล้ว bump ทุกใบ (3) projection ซ่อนข้อมูล (4) sort กระโดด/focus หาย (5) panel บัง/ฟิต crop

## งาน

| ID | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| T1 | `cardMeta` model + schema + prune/cap + เขียนตอน activation/removeItem/source/note/reset | unit: สร้าง/แก้/ไม่แก้ตาม matrix, simulation ไม่เขียน, candidate hash ยังผ่าน, state round-trip |
| T2 | backfill resolver + projection tests | legacy state ไม่มี meta → inferred ถูกต้อง; private participant ยังเห็น meta; unknown → `not recorded`; deterministic |
| T3 | panel metadata + sort + persistence | comparator unit; sort 4 แบบถูกต้อง stable; ค่าเสียหายถอย default; recurrent focus คงอยู่ |
| T4 | ปุ่มไปที่การ์ด + safe-area fit + reduced motion | browser: fit การ์ด, ไม่ขยาย, panel เปิดค้าง desktop, ปิด mobile, คืน focus, hidden un-hide |
| T5 | meta line บนการ์ด plan/aux/note/chat + relative clock + a11y | อ่านด้วย SR ได้, tooltip เต็ม, เวลาไม่ค้าง, contrast ผ่าน, ไม่ re-render body |
| T6 | browser regression | testids เดิมไม่พัง; เพิ่ม `go-to-canvas-*`, `sort-canvas-objects`; mobile 390×844; keyboard/Escape |
| T7 | docs + PLAN + spec + verification record | อัปเดต `spec.md` สถานะปัจจุบัน, `PLAN.md` แถวงาน, `docs/DECISIONS`/feature doc, บันทึกคำสั่งและเลขผลตรวจจริง |
| T8 (หลัง v1) | AI origin provenance: `RevisionRecord.origin` + job link | tooltip แยก auto/reviewed/pasted/rollback; tests + ไม่มี migration |

**ไฟล์ hotspot:** `src/tabletop/ui/CanvasWorkspace.tsx` (ใหญ่สุด), `src/tabletop/domain/table.ts`, `src/tabletop/domain/evolution.ts`, `src/tabletop/domain/projections.ts`, `src/tabletop/shared/table-contracts.ts`, CSS 2 ไฟล์, `tests/*-browser.mjs`

## สถานะงานและหลักฐาน (22 ต.ค. 2026)

| งาน | สถานะ | หลักฐาน |
| --- | --- | --- |
| T1 | review | `src/tabletop/domain/table-card-meta.ts` + `TableState.cardMeta`; stamp ที่ activation/removeItem/source เท่านั้น; 21 unit tests |
| T2 | review | resolver จาก revisions/source/note/chat; legacy backfill test; private participant ยังเห็น meta |
| T3 | review | panel row สองบรรทัด + sort 4 แบบ + localStorage; unit sort/label 20 tests |
| T4 | review | ปุ่ม `go-to-canvas-*`: desktop panel เปิดค้าง + safe-area fit; mobile ปิด panel + fit การ์ดเป้าหมาย + คืน focus |
| T5 | review | meta บนหัวการ์ด plan/aux, เวลาในโน้ต, เวลาแชทจาก `card.createdAt`; clock 60s ตัวเดียว |
| T6 | deferred | ตาม CI005 browser suite ของ repo รันตอน release PR; PR นี้ใช้ UI Lab/Chrome ตรวจ flow (1280/390/280/320/414) |
| T7 | doing | เอกสาร + PLAN + spec + CHANGELOG; commit/push pending |

**Commits:** `b4fb4df` (plan + previews) · `1d9893e` (backend data layer) · UI commit ตามหลังเอกสารนี้

**ผลตรวจจริง (Node v22.23.2):**
- `npm run typecheck` → exit 0
- `npm test` → **88 passed | 1 skipped (89)**, **651 passed | 1 skipped (652)**, 58.31s
- `npx vitest run src/tabletop/domain/table-card-meta.test.ts` → 21/21
- `npx vitest run src/tabletop/ui/canvas-card-meta.test.ts` → 20/20
- backend agent: `npm run test:cloudflare` → 127/127 (ก่อน UI)
- UI Lab/Chrome: 1280×900, 390×844, sweep 280/320/414; desktop panel เปิดค้าง การ์ดอยู่ขวา panel (free area 344→1268), ไม่ expand, focus ที่ปุ่ม Go to; mobile panel ปิด + fit การ์ด + focus `Objects`; การ์ดซ่อน unhide+fit; sort จำค่า; title click เดิม; ไม่มี horizontal overflow ที่ 280/320/414

**ยังไม่ได้ตรวจ:** browser suites ของ repo, reduced-motion emulation, chat card meta กับ AI จริง (AI ปิดในเครื่อง), Deleted section กับ server รุ่นใหม่ — ระบุใน PR

## Tests / verification

- [x] `npm run typecheck` → exit 0
- [x] `npm test` → 651 passed / 1 skipped (652), 88 files passed / 1 skipped
- [x] targeted: `table-card-meta.test.ts` 21/21 · `canvas-card-meta.test.ts` 20/20
- [x] `npm run test:cloudflare` → 127/127 (backend layer, before UI)
- [x] `npm run build` และ `npm run build:cloudflare` (dry-run) → ผ่าน (มี chunk-size warning เดิม)
- [ ] repo browser suites (`tests/*-browser.mjs`) — T6; ใช้ UI Lab/Chrome ตรวจ flow แทนแล้ว
- [x] preview gate: `ui-gate --full docs/previews/F054-objects-panel.html` → **14/16 measured, 4 skipped**; 2 fail เป็น deliberate: hardcoded values ใน mock (production ใช้ token) และ one-sided accent border ซึ่งเป็น design system เดิม (`canvas-visual-flow.css:2-15`)

## คำถามเปิด

1. การเปลี่ยนข้อมูลใน collection (row) ควรนับเป็น "updated" ของการ์ดหรือไม่ (v1 เลือกไม่นับ)
2. อนาคตจะเปลี่ยน panel เป็น dock ถาวรหรือไม่ (นอก scope ของ F054)
3. T8 AI-origin (auto vs reviewed vs pasted) จะทำต่อเมื่อมีคำถามจริงจากผู้ใช้

## การตัดสินใจ

| วันที่ | การตัดสินใจ | เหตุผล |
| --- | --- | --- |
| 2026-10-22 | persist `cardMeta` นอก program แบบ optional + inferred fallback | private projection ตัด revisions; program replace ทั้งก้อน; ไม่ต้อง migration |
| 2026-10-22 | stamp ตอน activation/command เท่านั้น | simulation ถูกเรียกซ้ำและต้อง deterministic |
| 2026-10-22 | ไม่ bump จาก spatial/look actions | "updated" ต้องหมายถึงเนื้อหา ไม่ใช่การลากการ์ด |
| 2026-10-22 | ปุ่มไปที่การ์ดไม่ขยายการ์ด + คง panel เปิดบน desktop | ตอบโจทย์ "ไปดูเฉย ๆ" และไล่ดูหลายการ์ดได้เร็ว |
| 2026-10-22 | **คง Objects panel เดิม 320px** ไม่สร้าง panel/dock ใหม่ | มีอยู่แล้วและทำงานดี; งานนี้คือเพิ่ม meta/sort/focus เข้าไปในแถวเดิม |
| 2026-10-22 | default sort = **`Created · newest`** | ผู้ใช้ระบุ "Newest created"; เห็นการ์ดที่เพิ่งเกิดก่อน |
| 2026-10-22 | แสดงชื่อสมาชิกจริงใน meta (เก็บเป็น `actorId`) | ผู้ใช้ขอให้แสดง; ชื่อ resolve จาก `view.members` และ fallback `Member` |
| 2026-10-22 | tool chrome อังกฤษ + วันที่ localized | ตาม panel เดิมและรูปแบบ `toLocaleString` ที่มีอยู่ |
| 2026-10-22 | แสดง meta บนการ์ดทุกใบแบบบรรทัดเดียวจาง ๆ | ตรงกับคำขอ "visible ตัวเล็ก ๆ" โดยไม่รบกวนงาน |
| 2026-10-22 | AI origin ละเอียดเป็น **T8 หลัง v1** | v1 ส่งเวลา+ที่มาที่พิสูจน์ได้ก่อน; ห้าม UI เดา auto/reviewed |

## ภาคผนวก: ทางเลือกที่พิจารณาแล้วไม่เลือก

- **-derive อย่างเดียวไม่ persist**: ฟรีและไม่แตะ schema แต่ผู้ใช้ private จะไม่เห็นเวลาและประวัติถูก prune
- **timestamp ใน `TableProgram`**: ทำให้ `planDelta`/candidate hash เปลี่ยน, กิน budget โปรแกรม, โมเดลอาจ echo กลับมา
- **client localStorage first-seen**: ง่าย แต่เป็น "ครั้งแรกที่เบราว์เซอร์นี้เห็น" ไม่ใช่เวลาจริงของโต๊ะ
- **ฝังเวลาใน `applyTableChange`**: เสี่ยง validation hash ไม่ตรง (ห้าม)
- **native select**: เลือกใช้เพราะแอปใช้ select อยู่หลายจุด; ถ้า design system บังคับ listbox ให้เปลี่ยนเป็น combobox ของแอป
