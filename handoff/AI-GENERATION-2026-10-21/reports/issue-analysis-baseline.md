# Live eval — issue analysis (2026-10-21T13-32-33-284Z)

Run: `result-2026-10-21T13-32-33-284Z.json` · cases 20 · requests 41 · cost $0.065226

## Corrected issue taxonomy

| category | count | share |
| --- | ---: | ---: |
| invalid-json | 9 | 39.1% |
| scoped-record | 3 | 13.0% |
| unknown-record-field | 3 | 13.0% |
| aggregate-row-variable | 3 | 13.0% |
| unknown-scalar-variable | 1 | 4.3% |
| shadowing | 1 | 4.3% |
| list-field-choices | 1 | 4.3% |
| scene-text-number | 1 | 4.3% |
| preserve-records | 1 | 4.3% |
| **total** | **23** | 100% |

The harness's built-in classifier put most issues in `schema-other`; this post-hoc pass separates invalid JSON, unknown record fields, scoped-record mistakes, aggregates, preservation and list-field mistakes.

## Invalid JSON (the dominant repairable failure)

- **join** — outcome clarify, attempts 2, invalid-JSON attempts: 1
- **cafe-sliders** — outcome clarify, attempts 2, invalid-JSON attempts: 1
- **light-shadow** — outcome draft, attempts 2, invalid-JSON attempts: 1
- **water-two-seats** — outcome draft, attempts 4, invalid-JSON attempts: 1
- **loan-formula** — outcome reject, attempts 4, invalid-JSON attempts: 1, 2, 3, 4
- **chart-metric** — outcome reject, attempts 4, invalid-JSON attempts: 1

The provider message for these is only `Return a complete JSON object, without Markdown.` — it does not include the parse position or the nearby text, so the model has nothing to repair against.

## Clarify used as an escape hatch after a failed attempt

- **dragon** — returned a question on attempt 2 (expected draft)
- **join** — returned a question on attempt 2 (expected draft)
- **cafe-sliders** — returned a question on attempt 2 (expected draft)

The production prompt says: "If repair issues show you cannot build a valid table, ask instead." That turns a repairable rule error into a user round-trip.

## Recommendations ranked by expected impact (to be tested, not assumed)

1. **Host-side bounded JSON repair before validation** — an offline probe (`json-repair-probe.mjs`) shows that a naive append-only closer fix repairs only 5/25 invalid replies and none pass the domain validator, so this needs an insert-at-error repair with a retry bound, still validated by zod afterwards.
2. **Better parse diagnostics in the repair turn** — include the parse position and a short excerpt (max 400 chars) instead of the generic sentence; loan-formula repeated the same structural error in 4/4 attempts with no positional feedback.
3. **Restrict clarify to attempt 1** — once a repair is present, force a simplified draft instead of asking.
4. Then schema/one-shot prompt work (see B) and two-phase (C).

## Raw issue strings

```json
[
  {
    "caseId": "deposit",
    "attempt": 1,
    "category": "scoped-record",
    "issue": "Expression field access must use a scoped record."
  },
  {
    "caseId": "deposit",
    "attempt": 2,
    "category": "scoped-record",
    "issue": "Expression field access must use a scoped record."
  },
  {
    "caseId": "deposit",
    "attempt": 3,
    "category": "scoped-record",
    "issue": "Expression field access must use a scoped record."
  },
  {
    "caseId": "dragon",
    "attempt": 1,
    "category": "unknown-record-field",
    "issue": "An action refers to an unknown record field."
  },
  {
    "caseId": "join",
    "attempt": 1,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "shift-roster-csv",
    "attempt": 1,
    "category": "aggregate-row-variable",
    "issue": "Aggregate predicates and values need a row variable."
  },
  {
    "caseId": "shift-roster-csv",
    "attempt": 2,
    "category": "aggregate-row-variable",
    "issue": "Aggregate predicates and values need a row variable."
  },
  {
    "caseId": "shift-roster-csv",
    "attempt": 3,
    "category": "aggregate-row-variable",
    "issue": "Aggregate predicates and values need a row variable."
  },
  {
    "caseId": "cafe-sliders",
    "attempt": 1,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "light-shadow",
    "attempt": 1,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "water-two-seats",
    "attempt": 1,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "water-two-seats",
    "attempt": 2,
    "category": "unknown-record-field",
    "issue": "An action refers to an unknown record field."
  },
  {
    "caseId": "water-two-seats",
    "attempt": 3,
    "category": "unknown-record-field",
    "issue": "An action refers to an unknown record field."
  },
  {
    "caseId": "loan-formula",
    "attempt": 1,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "loan-formula",
    "attempt": 2,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "loan-formula",
    "attempt": 3,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "loan-formula",
    "attempt": 4,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "chart-metric",
    "attempt": 1,
    "category": "invalid-json",
    "issue": "Return a complete JSON object, without Markdown."
  },
  {
    "caseId": "chart-metric",
    "attempt": 2,
    "category": "unknown-scalar-variable",
    "issue": "Expression refers to an unknown scalar variable."
  },
  {
    "caseId": "chart-metric",
    "attempt": 3,
    "category": "shadowing",
    "issue": "Expression variable names cannot shadow an existing binding."
  },
  {
    "caseId": "chart-metric",
    "attempt": 4,
    "category": "list-field-choices",
    "issue": "ยอดขายรายวัน: สาขา is a list field; only text fields can have choices."
  },
  {
    "caseId": "basket-en",
    "attempt": 1,
    "category": "scene-text-number",
    "issue": "Scene text expressions must return text."
  },
  {
    "caseId": "evolve-cafe",
    "attempt": 1,
    "category": "preserve-records",
    "issue": "A rule edit must preserve current records; initialRecords must be empty."
  }
]
```
