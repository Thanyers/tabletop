# Table request byte budget

Generated: 2026-10-21T13:42:35.268Z

Measured with `serializeChangeRequest` through a recording fetch. No model call was made.

## Constants (from `server/providers/deepseek-changes.ts`)

| Constant | Value |
| --- | --- |
| MAX_CHANGE_REQUEST_BYTES | 64,000 |
| MAX_TABLE_INPUT_BYTES | 48,000 |
| MAX_TABLE_FILE_BYTES (per source) | 32,768 |
| max sources | 4 |
| max_tokens (table replies) | 8192 |

## Verification

| Check | Expected | Actual | Verdict |
| --- | --- | --- | --- |
| system prompt chars (captured from provider) | 47149 | 47149 | PASS |
| captured system prompt equals prompt-dump/system-prompt.txt | identical | identical | PASS |
| user JSON re-serialized equals the captured user message | identical | identical | PASS |
| empty-table request body bytes | 54040 | 54040 | PASS |
| segment model reproduces the captured body | identical | identical | PASS |
| generated body bytes equal measureDeepSeekChangeRequest (all accepted sweep rows) | 0 mismatches | 0 mismatches | PASS |
| MAX_CHANGE_REQUEST_BYTES matches source text | 64000 | 64000 | PASS |
| MAX_TABLE_INPUT_BYTES matches source text | 48000 | 48000 | PASS |
| MAX_TABLE_OUTPUT_TOKENS matches request body max_tokens | 8192 | 8192 | PASS |
| TABLE_FILE_BYTES matches source text | 32768 | 32768 | PASS |
| cafe records fixture passes tableRecordsSchema | valid | valid | PASS |
| five sources are rejected as invalid input (sources max 4) | MODEL_PROVIDER_INPUT_INVALID | MODEL_PROVIDER_INPUT_INVALID | PASS |
| reference prompt is the captured Thai prompt | same as captured.json cases[0] | same | PASS |

## Body budget split (empty table, no sources)

| Part | Bytes | Share |
| --- | --- | --- |
| Envelope (model, stream, max_tokens, response_format, thinking, tool_choice, JSON framing) | 221 | 0.41% |
| System message content (JSON-escaped, includes quotes) | 53,681 | 99.34% |
| User message content (JSON-escaped, includes quotes) | 138 | 0.26% |
| **Total body** | **54,040** | 100% |

- System prompt: 47,149 raw chars; 53,681 bytes once JSON-escaped (+6,532 bytes of escaping).
- Headroom under the 64,000-byte cap with an empty table: **9,960 bytes**.
- The reference prompt is the captured Thai prompt: 18 chars, 54 UTF-8 bytes.

## 1 source, no program

| Total source bytes | Sources | Bytes/source | User JSON bytes | Request body bytes | Headroom | Over 48,000 user / 64,000 body | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 (0 KB) | 0 | 0 | 122 | 54,040 | 9,960 | no / no | accepted |
| 2,048 (2 KB) | 1 | 2,048 | 2,223 | 56,153 | 7,847 | no / no | accepted |
| 4,096 (4 KB) | 1 | 4,096 | 4,271 | 58,201 | 5,799 | no / no | accepted |
| 6,144 (6 KB) | 1 | 6,144 | 6,319 | 60,249 | 3,751 | no / no | accepted |
| 8,192 (8 KB) | 1 | 8,192 | 8,367 | 62,297 | 1,703 | no / no | accepted |
| 9,216 (9 KB) | 1 | 9,216 | 9,391 | 63,321 | 679 | no / no | accepted |
| 9,728 (9.5 KB) | 1 | 9,728 | 9,903 | 63,833 | 167 | no / no | accepted |
| 10,000 (10,000 B) | 1 | 10,000 | 10,175 | 64,105 | -105 | no / yes | rejected: body > 64,000 |
| 10,240 (10 KB) | 1 | 10,240 | 10,415 | 64,345 | -345 | no / yes | rejected: body > 64,000 |
| 12,288 (12 KB) | 1 | 12,288 | 12,463 | 66,393 | -2,393 | no / yes | rejected: body > 64,000 |
| 16,384 (16 KB) | 1 | 16,384 | 16,559 | 70,489 | -6,489 | no / yes | rejected: body > 64,000 |
| 32,768 (32 KB) | 1 | 32,768 | 32,943 | 86,873 | -22,873 | no / yes | rejected: body > 64,000 |

## 2 sources, no program

| Total source bytes | Sources | Bytes/source | User JSON bytes | Request body bytes | Headroom | Over 48,000 user / 64,000 body | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 (0 KB) | 0 | 0 | 122 | 54,040 | 9,960 | no / no | accepted |
| 2,048 (2 KB) | 2 | 1,024 | 2,277 | 56,219 | 7,781 | no / no | accepted |
| 4,096 (4 KB) | 2 | 2,048 | 4,325 | 58,267 | 5,733 | no / no | accepted |
| 6,144 (6 KB) | 2 | 3,072 | 6,373 | 60,315 | 3,685 | no / no | accepted |
| 8,192 (8 KB) | 2 | 4,096 | 8,421 | 62,363 | 1,637 | no / no | accepted |
| 9,216 (9 KB) | 2 | 4,608 | 9,445 | 63,387 | 613 | no / no | accepted |
| 9,728 (9.5 KB) | 2 | 4,864 | 9,957 | 63,899 | 101 | no / no | accepted |
| 10,000 (10,000 B) | 2 | 5,000 | 10,229 | 64,171 | -171 | no / yes | rejected: body > 64,000 |
| 10,240 (10 KB) | 2 | 5,120 | 10,469 | 64,411 | -411 | no / yes | rejected: body > 64,000 |
| 12,288 (12 KB) | 2 | 6,144 | 12,517 | 66,459 | -2,459 | no / yes | rejected: body > 64,000 |
| 16,384 (16 KB) | 2 | 8,192 | 16,613 | 70,555 | -6,555 | no / yes | rejected: body > 64,000 |
| 32,768 (32 KB) | 2 | 16,384 | 32,997 | 86,939 | -22,939 | no / yes | rejected: body > 64,000 |

## 1 source + program + records

| Total source bytes | Sources | Bytes/source | User JSON bytes | Request body bytes | Headroom | Over 48,000 user / 64,000 body | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 (0 KB) | 0 | 0 | 4,198 | 58,918 | 5,082 | no / no | accepted |
| 2,048 (2 KB) | 1 | 2,048 | 6,299 | 61,031 | 2,969 | no / no | accepted |
| 4,096 (4 KB) | 1 | 4,096 | 8,347 | 63,079 | 921 | no / no | accepted |
| 6,144 (6 KB) | 1 | 6,144 | 10,395 | 65,127 | -1,127 | no / yes | rejected: body > 64,000 |
| 8,192 (8 KB) | 1 | 8,192 | 12,443 | 67,175 | -3,175 | no / yes | rejected: body > 64,000 |
| 9,216 (9 KB) | 1 | 9,216 | 13,467 | 68,199 | -4,199 | no / yes | rejected: body > 64,000 |
| 9,728 (9.5 KB) | 1 | 9,728 | 13,979 | 68,711 | -4,711 | no / yes | rejected: body > 64,000 |
| 10,000 (10,000 B) | 1 | 10,000 | 14,251 | 68,983 | -4,983 | no / yes | rejected: body > 64,000 |
| 10,240 (10 KB) | 1 | 10,240 | 14,491 | 69,223 | -5,223 | no / yes | rejected: body > 64,000 |
| 12,288 (12 KB) | 1 | 12,288 | 16,539 | 71,271 | -7,271 | no / yes | rejected: body > 64,000 |
| 16,384 (16 KB) | 1 | 16,384 | 20,635 | 75,367 | -11,367 | no / yes | rejected: body > 64,000 |
| 32,768 (32 KB) | 1 | 32,768 | 37,019 | 91,751 | -27,751 | no / yes | rejected: body > 64,000 |

## 2 sources + program + records

| Total source bytes | Sources | Bytes/source | User JSON bytes | Request body bytes | Headroom | Over 48,000 user / 64,000 body | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 (0 KB) | 0 | 0 | 4,198 | 58,918 | 5,082 | no / no | accepted |
| 2,048 (2 KB) | 2 | 1,024 | 6,353 | 61,097 | 2,903 | no / no | accepted |
| 4,096 (4 KB) | 2 | 2,048 | 8,401 | 63,145 | 855 | no / no | accepted |
| 6,144 (6 KB) | 2 | 3,072 | 10,449 | 65,193 | -1,193 | no / yes | rejected: body > 64,000 |
| 8,192 (8 KB) | 2 | 4,096 | 12,497 | 67,241 | -3,241 | no / yes | rejected: body > 64,000 |
| 9,216 (9 KB) | 2 | 4,608 | 13,521 | 68,265 | -4,265 | no / yes | rejected: body > 64,000 |
| 9,728 (9.5 KB) | 2 | 4,864 | 14,033 | 68,777 | -4,777 | no / yes | rejected: body > 64,000 |
| 10,000 (10,000 B) | 2 | 5,000 | 14,305 | 69,049 | -5,049 | no / yes | rejected: body > 64,000 |
| 10,240 (10 KB) | 2 | 5,120 | 14,545 | 69,289 | -5,289 | no / yes | rejected: body > 64,000 |
| 12,288 (12 KB) | 2 | 6,144 | 16,593 | 71,337 | -7,337 | no / yes | rejected: body > 64,000 |
| 16,384 (16 KB) | 2 | 8,192 | 20,689 | 75,433 | -11,433 | no / yes | rejected: body > 64,000 |
| 32,768 (32 KB) | 2 | 16,384 | 37,073 | 91,817 | -27,817 | no / yes | rejected: body > 64,000 |

## Effective maximum source bytes under the current cap

| Scenario | Max total source bytes | Bytes/source | Body at max | User JSON at max | Headroom | First rejected size |
| --- | --- | --- | --- | --- | --- | --- |
| 1 source, no program | **9,895** | 9,895 | 64,000 | 10,070 | 0 | 9,896 bytes (rejected: body > 64,000) |
| 2 sources, no program | **9,829** | 4,914 / 4,915 | 64,000 | 10,058 | 0 | 9,830 bytes (rejected: body > 64,000) |
| 1 source + program + records | **5,017** | 5,017 | 64,000 | 9,268 | 0 | 5,018 bytes (rejected: body > 64,000) |
| 2 sources + program + records | **4,951** | 2,475 / 2,476 | 64,000 | 9,256 | 0 | 4,952 bytes (rejected: body > 64,000) |

## Records cost (cafeQueueChange.program, no sources)

- `tableRecordsSchema` accepts the fixture: yes.
- Records JSON: 192 bytes for 3 rows.
- User JSON with records {}: 4,008 bytes; with 3 rows: 4,198 bytes (+190); with 62 rows: 8,968 bytes (+4,770 for 59 more rows).

## Notes

- Source rows use one ASCII "a" per byte, so JSON escaping adds no bytes; dense files with quotes, backslashes or newlines cost up to 2 bytes per character.
- Thai/UTF-8 source text costs 3 bytes per character, so the effective character budget is about one third of the byte budget.
- Two-source rows split the total evenly across two sources; each source must be at least one character.
- The 48,000-byte user-JSON limit (MAX_TABLE_INPUT_BYTES) is checked before the 64,000-byte body limit (MAX_CHANGE_REQUEST_BYTES).
