# Risk-targeted pre-merge integration gates

Pull requests into `dev` still run the existing fast checks. A small set of additional integration checks runs only when the changed paths touch the area those checks cover. The full browser suites and compute acceptance keep their existing triggers: pushes to `dev`, PRs into `main`, pushes to `main`, and manual runs. The existing `main` result-reuse decision is unchanged.

## Path selection

`.github/workflows/validate.yml` gives the planner the base and head commit SHAs from the pull request event. It resolves both commits, then reads `git diff --name-status -z --find-renames <base>...<head>`, matching the pull request's merge-base diff. Missing commits, an unavailable merge base, malformed Git output, or a failed diff fail the planning job. No failed lookup is converted into an empty change list.

The pure `selectIntegrationGates(paths)` function has explicit input. Missing, empty, or malformed paths select every added gate as a safe default. Unknown application paths and changes to the gate planner, its workflow, or package metadata also select every gate. Only explicitly known documentation-only paths produce no extra gate. A real non-empty change list selects these checks:

| Changed paths | Added check |
| --- | --- |
| `cloudflare/`, `server/providers/`, `shared/`, `src/shared/`, `src/tabletop/shared/`, `src/tabletop/domain/`, `src/tabletop/runtime/`, or `wrangler.jsonc` | Build and boot the actual `worker-build/index.js` artifact, then check `/healthz`, `/readyz`, and `/api/capabilities` in Miniflare. |
| F066 Rules/Chat harness files, `scripts/build-f066-rules-harness.mjs`, and the composer/reference paths it imports | Run the existing `tests/ui/f066-rules-browser.mjs` harness. |
| Compute-named source/test paths or `compute/` | Run the focused shared/domain/UI/server compute tests and the Cloudflare compute-runner tests. A change under `compute/` also runs the existing Workers Container API smoke. |
| Gate planner/workflow/package changes or an otherwise unclassified path | Run all added gates as the safe default. |

The name-status parser includes deleted paths and both old and new paths for renames/copies, so moving a risky file cannot silently avoid its gate. Documentation-only changes continue through the existing fast checks without an extra integration job.

## Worker startup check

The focused Worker job runs `npm run build` and `npm run build:cloudflare` (Wrangler dry-run only), then boots that artifact with Miniflare. It uses local D1 storage and applies the tracked SQL migrations; Durable Objects use synthetic SQLite storage. It supplies a local HTTPS origin, disables web search, omits provider/OAuth credentials, and rejects outbound requests. The health routes do not log in, create a workspace, or call AI.

`scripts/integration-gate-worker-startup.test.mjs` is the red proof: it passes a malformed Worker module to the same startup gate and requires the gate to reject it. The path-selector tests cover positive and negative cases, deletion and rename records, missing inputs, and unavailable PR base/head/diff data.

## Local commands and limits

```powershell
node --test scripts/integration-gate-plan.test.mjs scripts/integration-gate-worker-startup.test.mjs
npm run build
npm run build:cloudflare
node scripts/integration-gate-worker-startup.mjs
```

The Worker check proves that the built module starts and its unauthenticated health/readiness/capability probes work with synthetic local bindings. It does not prove hosted binding configuration, login or authorization behavior, external provider availability, Container API execution, deployment, or production behavior. The focused F066 browser harness checks its existing fixture interactions; it does not replace the full browser acceptance suites.
