# F078-T3a — Preserve staging after skipped focused ancestors

| | |
| --- | --- |
| สถานะ | `done` ([PR #265](https://github.com/Thanyers/tabletop/pull/265), merge `d374e70`) |
| เจ้าของฟีเจอร์ | Codex |
| เวอร์ชันที่คาด | PATCH — CI scheduling only |
| งานในกระดาน | [PLAN](../../PLAN.md) แถว F078-T3a |

## ทำไม

After F078-T3 merged at `694d556`, full dev validation passed but staging was SKIPPED. The optional focused PR jobs are intentionally skipped on dev, and GitHub applies skipped results through the downstream dependency chain unless the downstream job has an explicit status expression.

## ขอบเขต

Only the staging job's status condition and its owning documentation. Preserve push-to-dev and successful `local-validation` guards, staging configuration checks, deployment smoke, and all production boundaries. No runtime, schema, binding or credential change.

## หลักฐานก่อนแก้

Run [40074892319](https://github.com/Thanyers/tabletop/actions/runs/40074892319) is a push to dev at `694d556d99fee42340f28d65ab78e8dc7540aa00`: full browser jobs and `local-validation` succeeded, focused jobs and `Deploy tabletop-staging` were skipped. A read-only assertion requiring successful validation AND successful staging returned nonzero on this exact run.

GitHub documents the transitive skip behavior under [job dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds). Hosted job selection is the correct integration seam; a local condition-string assertion would not establish that the Actions scheduler runs the job.

## Acceptance

- [x] Staging has explicit non-cancelled status evaluation after validation, instead of the implicit transitive success guard. Hosted confirmation is recorded below.
- [x] PR/manual/main events, cancelled runs and failed validation remain ineligible for staging by the preserved explicit guard.
- [x] Latest PR `local-validation` passed before merge; final dev full validation and staging succeeded, with version readback at that merge SHA.
- [x] Production version/main stayed unchanged; no new architecture refactor started before handoff.

Hosted closing evidence (2026-10-24): dev run [40075882571](https://github.com/Thanyers/tabletop/actions/runs/40075882571) finished success with `Deploy tabletop-staging` **success** for merge `d374e7051350237354d2055982cc383040c8e402`; the three focused PR-only jobs stayed **SKIPPED** by design and are not counted as passes. `/version` readback returned staging `0.0.0-dev / d374e70` (`built_at` `2026-10-24T07:59:41Z`) and production `9.0.2 / 8e2c7e1`. Remote `main` remained `8e2c7e1`.

## Verification

Node `v22.23.2` / npm `11.0.0`: clean `npm ci` passed, audit 0. YAML AST comparison passed: the only semantic workflow change is adding `!cancelled()` to the staging condition; needs, event/ref/success guards, all other jobs and deployment steps are unchanged. Gate planner/startup red-proof tests 13/13, public scan 829/0, changelog 6 fragments and whitespace checks passed. Application/browser checks are SKIPPED locally for this workflow-only fix; required PR CI and full dev CI supply their actual results.

The real hosted assertion against run 40074892319 returned nonzero with `validation=success`, `deploy=skipped`. Event/ref mismatch and unfinished validation were ruled out by run/job metadata. The explicit status function addresses the documented transitive-skip behavior. Local AST/tests do not emulate the Actions scheduler, so final hosted validation AND successful staging with exact version readback are still required. No local deploy or production change.
