# Local development and runtime boundaries

The built Tabletop R1 candidate runs as one local Node server. For frontend development, run Vite and the API as two local processes; Vite serves the UI and forwards same-origin API and WebSocket traffic to the loopback API server. Both workflows are local only and do not provision a hosted environment.

## Requirements and first start

- Node.js 22.23.2 (the container candidate uses the matching `node:22.23.2-bookworm-slim` base image)
- npm, included with Node.js

From the repository root, install the locked dependencies, build the UI and typecheck the project, then start the server:

```powershell
npm ci
npm run build
$env:TABLETOP_ENV = 'local'
$env:HOST = '127.0.0.1'
$env:PORT = '4310'
$env:TABLETOP_DATA_DIR = (Join-Path (Get-Location) 'server\.data')
npm start
```

The server prints its listening URL. Open <http://127.0.0.1:4310>. Stop it with Ctrl+C. The `.env.example` file documents the same local values, but no dotenv loader is configured; export variables in the shell or set them in the process manager that launches Node.

## Two-process frontend development

Use this flow when editing the UI while exercising real sessions, uploads, commands, and live updates. Start the API in one PowerShell window from the repository root:

```powershell
$env:TABLETOP_ENV = 'local'
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = '4310'
$env:TABLETOP_DATA_DIR = (Join-Path (Get-Location) 'server\.data')
if ($env:DATABASE_URL) { throw 'Local mode refuses DATABASE_URL; unset it before continuing.' }
npm run dev:api
```

In a second window, start the UI:

```powershell
npm run dev
```

Open <http://127.0.0.1:5173>. Vite binds to `127.0.0.1` and proxies `/api/**`, including WebSocket upgrades, to `http://127.0.0.1:4310`. The proxy keeps `changeOrigin: false`, so the browser's `Host` and `Origin` continue to identify the UI origin and pass the server's same-origin checks. Keep both processes on loopback; do not use `--host 0.0.0.0` or expose the development UI to a LAN.

On Windows, `scripts/start-local.ps1` starts the built app in the current terminal. It locates `node.exe` and the npm CLI beside that Node installation, so it does not rely on a possibly stale `npm.ps1`/`npm.cmd` shim. It does not install packages or provision services. For the two-process development flow, run `scripts/start-local.ps1 -Mode api` and `scripts/start-local.ps1 -Mode ui` in two terminals. Stop each process with Ctrl+C.

## Local state and boundaries

By default, `TABLETOP_DATA_DIR` is the repository's `server/.data` directory. The bootstrap keeps the PGlite database at `server/.data/postgres` and local private source objects at `server/.data/objects`. Set `TABLETOP_DATA_DIR` to another writable local directory to move both stores together. These paths are outside the static `dist/` root and must not be served as web assets.

Local mode binds only to `127.0.0.1`; do not expose it to a LAN or public network. The data directory is development state, not a managed backup service. Stop the server before copying it for a local backup.

`/healthz` reports that the process is answering. `/readyz` also checks database readiness. Both are local service checks and do not prove business acceptance or hosted readiness.

## Use the invoice sample files

The sample files are served from `public/samples/r1/` and are linked in the invoice workbench:

- [Shipment rows](../public/samples/r1/shipments.csv)
- [Invoice rows as CSV](../public/samples/r1/invoice.csv)
- [Invoice document as PDF](../public/samples/r1/invoice.pdf)
- [Rate card as text](../public/samples/r1/rate-card.txt)
- [Rate card as PDF](../public/samples/r1/rate-card.pdf)

From an invoice workspace, import the shipment sample and invoice sample, then review the source records before using them in a comparison. The PDF examples are text PDFs that use the supported R1 template. Scanned or encrypted PDFs are not supported.

An uploaded item is recorded as **provided**, not verified. Open the source, check its contents, and explicitly verify it before relying on it. A new shipment CSV replaces the current shipment rows; a new invoice CSV or PDF replaces the current invoice lines. Source records, saved reconciliation runs, and the currently approved rate rules are retained. Finish reviewing a period before importing the next period, because imports do not append rows.

The seeded invoice case includes a remote surcharge evidence gap. Compare only what is supported by reviewed sources. Use the evolution controls to propose a rule change, simulate the before-and-after results, run the server checks, approve the candidate, and activate it. Activation creates a new rule revision. Rollback is also a new revision; it does not erase history or rewind saved runs.

Teaching and encounter cases use their deterministic server rules and can be explored without a model provider. The old single-user demo is separate and only opens when the URL includes `?legacy-demo=1`.

## Model and upload status

The Node guest runtime keeps its model endpoint disabled. The Cloudflare runtime connects DeepSeek Flash to authenticated jobs, consent, and a durable budget ledger. See the Cloudflare checks below and [provider verification](AI_PROVIDER_VERIFICATION.md) for separate bounded live API evidence. Keep `DEEPSEEK_KEY` in an ignored local file or server secret; never prefix it with `VITE_` or include it in a browser build.

Local mode currently accepts the supported CSV and text-PDF inputs into a private filesystem object store for development. Production mode rejects public upload requests with `UPLOAD_SERVICE_NOT_CONFIGURED` until a scanner and durable private object store are selected and wired into the application. The container candidate does not add those services. Do not treat the local parser or filesystem store as an upload-security or production-storage service.

## Production-mode contract

Production mode is a deployment candidate that requires all of the following to be provisioned and configured by an operator:

- `TABLETOP_ENV=production`
- `NODE_ENV=production`
- `HOST=0.0.0.0` inside a container or the specific trusted interface chosen by the operator
- `PORT` matching the hosting platform's listener (the candidate defaults to `4310`)
- `DATABASE_URL` for an external PostgreSQL service
- `PUBLIC_ORIGIN` set to the exact HTTPS origin used by browsers, with TLS terminated by the hosting edge or reverse proxy
- A private writable `TABLETOP_DATA_DIR` if private local objects are enabled later

Production startup does not apply database migrations; it requires the configured PostgreSQL schema to be ready. The explicit migration entrypoint is `node --import tsx server/migrate.ts --environment production`. A database owner must approve the target database, schema operation, scope, and recovery plan before anyone runs it. Do not run that command against a shared or production database as part of ordinary startup.

The [Cloudflare candidate](CLOUDFLARE_RELEASE.md) uses a separate Workers entrypoint and D1/SQLite Durable Object repositories, reusing the shared domain and frontend. R2 and public uploads remain deferred. No resource or cost approval follows from a local test. The alternate Node container still expects an HTTPS reverse proxy and external PostgreSQL.

The included `Dockerfile` is a multistage, non-root container candidate with a built-in Node health check. It defaults to production mode, so it will stop at startup until the production environment and required values are supplied. It has not been deployed, and its presence does not mean production readiness.

## Cloudflare local checks

Run the same locked Node dependencies from this checkout:

```powershell
npm run build
npm run test:cloudflare
npm run build:cloudflare
npm run test:cloudflare:browser
```

The Workers test suite creates disposable local D1/SQLite databases and synthetic Google signatures. The browser test starts its own loopback Workers emulator, synthetic account sessions, and simulated DeepSeek response. It exercises actual account UI, invitations, multiplayer, admin metadata, consent, draft-only AI, and logout/resume. It makes no paid provider requests and does not prove the configured Google client works on the eventual hosted URL. The browser defaults to installed Edge on Windows; set `BROWSER_CHANNEL=chromium` where Playwright Chromium is installed, as CI does.

`npm run build:cloudflare` is a dry run; it writes an ignored bundle to `worker-build/`. The D1 ID in `wrangler.jsonc` is intentionally a placeholder, and both AI budgets default to zero. Normal tests do not load the operator credential file.

For manual emulator development, initialize only the local database with `npx wrangler d1 migrations apply DB --local`, then `npm run dev:cloudflare`. This binds to `http://127.0.0.1:8787` and overrides the public origin accordingly. Manual Google sign-in requires a separately registered loopback callback and local bindings; the automated fixture is the supported no-credential test path. Never add `--remote` to a routine local migration. Production provisioning requires the explicit scope in the release document.
