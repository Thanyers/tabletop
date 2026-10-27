# Local evidence run — 2026-10-26 (dev `a01875d`)

รัน browser drivers ทั้งชุด **บนเครื่องนี้** บน dev head `a01875d` เพื่อยืนยันว่าผลใน CI ไม่ได้มาจาก environment เฉพาะของ CI

## ผล

| driver | คำสั่ง | ผล |
|---|---|---|
| tool host (isolation) | `node scripts/build-tool-host-harness.mjs && node tests/ui/tool-host/browser.mjs` | **16 checks passed** |
| joined panel | `node scripts/build-tool-joined-harness.mjs && node tests/ui/tool-joined/browser.mjs` | **8 checks passed** |
| authoring panel (รวม AI route + EDIT-01 continuation) | `node scripts/build-tool-authoring-harness.mjs && node tests/ui/tool-authoring/browser.mjs` | **10 checks passed** |
| room shell (variant C + product screen ที่มี tool) | `node scripts/build-room-shell-harness.mjs && node tests/ui/room-shell/browser.mjs` | **7 checks passed** |

## หลักฐาน isolation ที่คัดมาตรง ๆ

```
PASS frame has no cookie/storage/network access
  cookie : blocked: SecurityError (sandboxed, no allow-same-origin)
  storage: blocked: SecurityError
  fetch  : blocked: TypeError: Failed to fetch
  origin : null
```

## ชุดทดสอบระดับอื่นบน commit เดียวกัน

| ระดับ | ผล |
|---|---|
| unit | **1221 passed / 5 skipped** (155 ไฟล์) |
| Worker tier | **325/325** (21 ไฟล์) |
| typecheck 3 config | ผ่าน |
| public scan | findings: [] |

## หมายเหตุ

- ตัวเลขพวกนี้เป็น **local run บนเครื่อง Windows 11 / Node v22.23.2** — CI รันชุดเดียวกันและเขียวที่ commit ที่ merge
- ยังไม่มี `.dev.vars` (DEEPSEEK_KEY) ⇒ paid AI ยัง **0 call / USD 0.00**
- `cancelled` บน dev run เป็นเรื่องปกติของ concurrency (ดู `MEMORY.md` 2026-10-26)
