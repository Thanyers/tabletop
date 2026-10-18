# Tabletop R1

Tabletop R1 is a local-first, server-authoritative workspace for shipment invoice reconciliation, physics lessons, and a cooperative tabletop encounter. Rule changes follow a review path: propose a change, simulate it, validate it, approve it, then activate it as a new revision.

## Start locally

Use Node.js 22.23.2 and npm. The local server listens on `127.0.0.1:4310` and stores its PGlite database and private source objects beneath `server/.data/` by default.

```powershell
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:4310>. Read [Local development](docs/LOCAL_DEVELOPMENT.md) for data paths, imports, sample sources, and production boundaries. The `.env.example` file is a reference; the server does not load `.env` automatically.

For team review, follow the [three-workflow demo guide](docs/R1_DEMO_GUIDE.md), inspect the [implementation boundaries](docs/R1_ARCHITECTURE.md), and read the [Cloudflare release candidate](docs/CLOUDFLARE_RELEASE.md). The Cloudflare implementation runs in a local Workers emulator; resource creation, hosted Google login, live AI acceptance, and production deployment remain pending.

## What is available

- Invoice reconciliation uses exact satang and gram rules. New shipment or invoice imports replace that active dataset; source records, saved runs, and approved rates remain available.
- Teaching and encounter rules are deterministic and run on the server. Manual rule editing and the approval workflow do not depend on AI.
- The legacy single-user demo remains opt-in at `/?legacy-demo=1`.
- Example evidence files are in [`public/samples/r1/`](public/samples/r1/): `shipments.csv`, `invoice.csv`, `invoice.pdf`, `rate-card.txt`, and `rate-card.pdf`.

Uploaded evidence starts as **provided**. A person must review and verify a source before it can support a reconciliation rule. Review the source and its effective dates before comparing invoices or proposing a change.

## Capability boundaries

The Cloudflare runtime includes Google sign-in, persistent account membership, My tables/resume, private multiplayer projections, DM pause/resume, and an admin metadata panel. Closing a browser or expiring a login does not delete a saved Cloudflare room. The local Node runtime retains its original guest-session and seven-day workspace behavior.

DeepSeek Flash is connected to authenticated Cloudflare jobs through a durable reservation ledger. An owner, teacher, or DM can consent to a bounded request and receive a draft; simulation, validation, human approval, and activation remain separate. Configured daily/monthly budgets are required and default to zero. Local browser tests use a synthetic provider; the separate [provider verification](docs/AI_PROVIDER_VERIFICATION.md) records earlier bounded live API checks. The Node guest runtime keeps AI disabled.

Public uploads remain disabled on Cloudflare until private R2 storage and scanning are integrated. The invoice sample case, manual verified-source review, deterministic calculations, and exports remain available. Local Node development supports the existing private filesystem uploads.

The [production setup](docs/PRODUCTION_SETUP.md) uses Workers Static Assets/API, one SQLite Durable Object per room, D1 identity/session/directory records, and a separate Billing Durable Object. No Render or Supabase service is required. The included Dockerfile packages the alternate Node/PostgreSQL runtime and has not been deployed. See [local development](docs/LOCAL_DEVELOPMENT.md) for both test paths and [release scope](docs/CLOUDFLARE_RELEASE.md) for provisioning, costs, and remaining acceptance checks.

`docs/source-baseline.json` records the approved local source snapshot. It is provenance for this checkout, not imported Sites history or a production release record.
