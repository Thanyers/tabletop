# Thinking-mode probe — six hard cases (2026-10-21)

Variant: copy of the production provider with `thinking: { type: "enabled" }`, table `max_tokens` 16,384, `MAX_OUTPUT_CHARS` 128,000, `MAX_RESPONSE_BYTES` 512,000, per-call timeout 90s. Harness deadline 90s. Everything else identical (same prompt, same validator, same repair loop).

| case | thinking mode (1 trial) | earlier 25s runs |
| --- | --- | --- |
| dragon | draft, attempt 1, 48.6s | clarify / draft (mixed) |
| join | draft, attempt 1, 52.2s | clarify in 3/3 current-prompt runs |
| chart-metric | draft, attempt 1, 47.0s | reject then draft |
| water-two-seats | draft, attempt 1, 60.4s | draft after 4 attempts |
| cafe-sliders | **error** at 70.6s (`MODEL_PROVIDER_RESPONSE_INVALID`) | clarify / reject / draft (mixed) |
| loan-formula | reject after 4 attempts, 69.6s (invalid JSON every attempt) | reject / draft (mixed) |

Result: **4/6 matched, 4 first-attempt drafts**, 9 requests, estimated cost $0.081, case P50 52.2s / P95 70.6s.

## Why the output cap matters now

Successful thinking drafts used **10,773 / 12,246 / 10,013 / 13,572 completion tokens**, with 8,425–11,458 reasoning tokens. All four exceed the current 8,192-token cap, so under the production setting they would have been cut at 8,192 (`finish_reason="length"`) and returned as invalid JSON.

`cafe-sliders` failed at the provider layer after 70.6s. The likely cause is a non-`stop` finish (length or resource) at the 16,384 cap; the provider rejects any `finish_reason !== "stop"` (`deepseek-changes.ts:456`). A 32K/64K cap and an explicit `finish_reason="length"` repair hint are the next fixes.

## Provider facts (DeepSeek API docs, fetched 2026-10-21)

- Models: `deepseek-flash` (DeepSeek-V4.1-Flash-1017) and `deepseek-v4-pro`; **context 1M tokens**, **max output 384K tokens**.
- `max_tokens`: 1–393,216. Default **8K in non-thinking mode**, **64K in thinking mode** (128K with `reasoning_effort=max`).
- JSON mode warning: when `finish_reason="length"`, the message content may be partially cut off, which produces invalid JSON.
- Thinking mode is the default unless disabled; the repo disables it.

Sources: https://api-docs.deepseek.com/api/create-chat-completion · https://api-docs.deepseek.com/zh-cn/quick_start/pricing

## What "make it work first" implies

1. Enable thinking (or make it a per-request choice), raise table `max_tokens` to 32K–64K, and raise `MAX_OUTPUT_CHARS` / `MAX_RESPONSE_BYTES` to match.
2. Raise the overall deadline to 90–120s (the job recovery in `room.ts` already treats 120s as interrupted) and make the UI show a long-running generation state.
3. Handle `finish_reason="length"` as its own repairable issue (or retry with a higher cap) instead of a generic invalid response.
4. Keep the compact guide for the input budget; thinking does not fix the 64 KB body cap.
5. Accept the cost for now: ~$0.02 per successful draft in this probe vs ~$0.007 baseline; revisit after quality is acceptable.
