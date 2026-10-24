# F078-T3a — Preserve staging after skipped focused ancestors

| | |
| --- | --- |
| สถานะ | `doing` |
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

- [ ] Staging evaluates its explicit guard after successful validation even when optional ancestor jobs are skipped.
- [ ] PR/manual/main events and failed validation remain ineligible for staging.
- [ ] Latest PR `local-validation` passes before merge; final dev full validation and staging succeed, with version readback at that merge SHA.
- [ ] Production version/main stay unchanged; no new architecture refactor starts before handoff.

## Verification

Pending implementation and hosted confirmation. Record actual results before completion; retain the original run's staging result as SKIPPED.
