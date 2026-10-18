# tabletop. — R1 GitHub Submission Plan

18 ตุลาคม 2026 · Asia/Bangkok · **Planning documents delivery only**

Target: [Thanyers/tabletop](https://github.com/Thanyers/tabletop). Review branch: `docs/tabletop-r1-planning-review-2026-10-18`. Base main audit SHA: `1de3d7adfd3955df6a8892d17f7d55f9d25e839b`.

## 1. Authority and exact delivery boundary

Latest addendum explicitly authorizes commit/push planning documents and opening a review PR when permitted. It overrides the earlier handoff's no-commit instruction only for these documents. No merge, force push, source import, application deployment or infrastructure change is authorized this session

The eight allowed paths, all beneath `handoff/Final/planning-review/`, are:

1. [TABLETOP_R1_MASTER_PLAN.md](TABLETOP_R1_MASTER_PLAN.md)
2. [TABLETOP_R1_MASTER_PLAN.html](TABLETOP_R1_MASTER_PLAN.html)
3. [TABLETOP_R1_CRITICAL_AUDIT.md](TABLETOP_R1_CRITICAL_AUDIT.md)
4. [TABLETOP_R1_CRITICAL_AUDIT.html](TABLETOP_R1_CRITICAL_AUDIT.html)
5. [TABLETOP_R1_DEPLOYMENT_BLUEPRINT.md](TABLETOP_R1_DEPLOYMENT_BLUEPRINT.md)
6. [TABLETOP_R1_DEPLOYMENT_BLUEPRINT.html](TABLETOP_R1_DEPLOYMENT_BLUEPRINT.html)
7. [TABLETOP_R1_GITHUB_SUBMISSION_PLAN.md](TABLETOP_R1_GITHUB_SUBMISSION_PLAN.md)
8. [TABLETOP_R1_OPEN_DECISIONS.md](TABLETOP_R1_OPEN_DECISIONS.md)

No credentials, runtime mapping, source/build, logs, screenshots, raw uploaded files or legacy handoff are included. The HTML files embed their own styles/diagrams and contain the full corresponding Markdown content; they do not fetch third-party assets. Download an HTML file and open it locally to review offline; GitHub source view is not an HTML hosting service.

## 2. Repository inspection actually performed

| Check | Observed result | Limit |
| --- | --- | --- |
| Local project root | Not a Git working tree | Cannot claim current product branch or clean status |
| Historical `sites/living-canvas` | `main`, clean, `HEAD df2aac2`, no remotes | Separate lineage; no push from this checkout |
| Target identity | authenticated as Thanyers | credential value excluded from all reports |
| Target visibility | public | docs contain synthetic/technical content only |
| Existing remote history | One Initial commit on `main`; README only | No product source available remotely |
| Branch protection | Branch listing reports protected=false; no rulesets | Details endpoint returned 403; full policy Unknown |
| Actions/workflows | 0 workflows and 0 runs | No CI installed |
| Pages/deployments | `has_pages=false`, Pages GET 404, 0 deployment records | External host account state not audited |
| Permissions | Account repository permissions report push/admin | Effective write capability is confirmed only by an actual authorized push |

## 3. Isolated delivery approach

Because the project root is not Git and the Sites checkout has different history, clone only the explicit target into an ignored local publication workspace. Fetch `origin/main`, record its SHA, then create the planning branch from that commit. Copy only the eight reviewed files into the same project-relative path. Preserve the remote README and existing `main`/history.

Credential handling: read the already-authorized local credential in memory; scope authentication to GitHub child-process requests; disable fallback credential helpers for these requests; do not persist the token in remote/config, command arguments, logs, artifacts or history. Do not change global Git account/settings. Commit metadata uses a non-personal planning-author identity, not the other connected account.

Pre-commit gate:

1. Confirm clone root, branch, clean initial state, exact remote `https://github.com/Thanyers/tabletop.git`, and current `main` SHA.
2. Compare byte hashes of local final documents and publication copy; run HTML/Markdown parity and internal-link checks; review independent audit findings.
3. Scan candidate content for the exact current secret held in memory and for token/private-key/credential patterns; report only match counts/paths, never values. Scanning is best effort, not certification.
4. Stage the exact 8-path allowlist. Review `git diff --cached --name-only`, full stat and outgoing commit paths. Reject anything outside the allowlist or any change to the remote README.
5. Commit with message `docs: add Tabletop R1 architecture, audit and deployment plans`
6. Fetch `origin` again; if `main` moved, re-evaluate the base without overwriting the remote. Push only the new review branch, without force.
7. Verify remote HEAD SHA and all eight blob hashes; confirm this operation left the `main` SHA unchanged.
8. Open a review PR with a description covering problem, scope, validation, unknowns and owner decision gate. If PR permission fails, retain the branch and provide a compare link; do not automatically request broad token permissions.

These are delivery operations, not product implementation. Return the detailed post-publication receipt (commit SHA, branch URL and actual PR URL) in the final chat and GitHub metadata; do not invent it inside the document being committed.

## 4. Documentation preview decision

No existing Pages/workflow was found. Therefore this session does not enable Pages, add an Actions workflow or deploy HTML through another service. GitHub Markdown is reviewable in the PR, and HTML files are standalone downloads. A future documentation-only Pages pipeline is specified in the Deployment Blueprint and needs its own approved infrastructure change.

The old Procedural Sites publication is historical context. No source sync, Site version update, access change or deployment to that account is part of this delivery.

## 5. GitHub package after implementation approval

Planning branch is not a runnable application submission. Before a future R1 judging submission, publish approved product source with clear source provenance, then provide:

| Artifact | Required content | Gate |
| --- | --- | --- |
| README | What/try/run/verify/current limits; exact tested commands; no judge API key | Clean-clone check |
| Product/architecture docs | Shared runtime, topologies, contracts, alternatives and ADRs | Link actual modules and versions |
| Demo guide | Invoice hero; Teaching + 2 learners; DM + 2 players; reset/resume | Free manual interaction |
| Synthetic fixtures | Alternate invoice CSV/text PDF, lesson and encounter | No private data/license ambiguity |
| Proof matrix | Each claim → test/artifact/version/status | Distinguish authored/configured/composed/model-proposed |
| CI | Types/lint/unit/contracts/integration/E2E/build/scans | Pinned workflow permissions and review |
| Deployment receipt | Hosted URL, commit, artifact hash, environment and test results | Hosted E2E, not only build |
| Security/limits | Guest identity, scope, quotas, retention and sandbox limits | Private-event negative tests |
| Licenses/attribution | Dependencies, assets, prebuilt-source eligibility | Verify actual hackathon rules |
| Release/recovery | Release version, rollback runbook and owner contact | Rollback drill with data |

Do not include local credential files, `.git` from another checkout, `.openai`, caches, `node_modules`, generated logs or personal account data. Secret scanning must inspect both intended outgoing files and commit history, not only `.gitignore`.

## 6. Owner handoff

Review the Master Plan for architecture/scope, Critical Audit for risks, Deployment Blueprint for hosting/cost/operations and Open Decisions for approvals. Recommend approval only for named milestones after open blocking decisions are answered. Do not auto-merge the planning PR or start implementation because planning is complete.
