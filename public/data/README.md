# Synthetic demo data

These files contain fictional Northstar examples for the local Living Canvas demo. They do not represent customer, employee, or production data. The runtime seed and the September/October asset CSV files each contain the same deterministic 96 asset rows, with period-specific dates and ledger entries. Both periods are ready for full-size browser import.

`assets-2026-09.csv` and `assets-2026-10.csv` use the ordered fields `rowId`, `assetId`, `description`, `category`, `acquisitionDate`, `inServiceDate`, `cost`, `usefulLifeMonths`, `method`, `accumulatedDepreciation`, `recordedMonthlyDepreciation`, `glAccount`, and `department`. Amounts are decimal currency units. An empty acquisition or service date represents a missing value. Dates use `YYYY-MM-DD`.

`ledger-2026-09.csv` and `ledger-2026-10.csv` use `id`, `assetId`, `period`, `account`, and `amount`. Periods use `YYYY-MM`. `policy.json` follows the shared `Policy` fields. `equipment.csv` follows the shared `Equipment` fields: `id`, `name`, `category`, `owner`, `warrantyUntil`, `condition`, and `location`.

The September rows include FA-001, an ฿18,000 laptop with a ฿500 v2 ledger amount, and FA-008, which has no acquisition date. October includes a newly in-service vehicle row, so its data differs from September. The CSV-safe invalid-cost fixture for ROW-020 uses `-1` because CSV requires a finite numeric value; the in-app seed uses `NaN` for this row to exercise non-finite save/restore handling. Both values are rejected by depreciation calculation and produce the same reconciliation totals. CSV import accepts quoted commas and escaped quotes. CSV export prefixes formula-like string cells with an apostrophe.

