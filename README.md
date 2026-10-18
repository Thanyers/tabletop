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

For team review, follow the [three-workflow demo guide](docs/R1_DEMO_GUIDE.md), inspect the [implementation boundaries](docs/R1_ARCHITECTURE.md), and read the [local verification report](docs/R1_LOCAL_VERIFICATION.md). This is a **Local Verified implementation candidate**; hosting and live-model acceptance remain open.

## What is available

- Invoice reconciliation uses exact satang and gram rules. New shipment or invoice imports replace that active dataset; source records, saved runs, and approved rates remain available.
- Teaching and encounter rules are deterministic and run on the server. Manual rule editing and the approval workflow do not depend on AI.
- The legacy single-user demo remains opt-in at `/?legacy-demo=1`.
- Example evidence files are in [`public/samples/r1/`](public/samples/r1/): `shipments.csv`, `invoice.csv`, `invoice.pdf`, `rate-card.txt`, and `rate-card.pdf`.

Uploaded evidence starts as **provided**. A person must review and verify a source before it can support a reconciliation rule. Review the source and its effective dates before comparing invoices or proposing a change.

## Capability boundaries

A server-side DeepSeek Flash adapter has passed a bounded synthetic API check; see [provider verification](docs/AI_PROVIDER_VERIFICATION.md). It is not yet connected to the app's model endpoint, which remains disabled until authenticated dispatch and durable cost accounting are integrated. Public uploads are disabled in production mode until a scanner and a durable private object store are selected and integrated. Local development uses a private filesystem object store for fixture and manual testing.

The Dockerfile packages the current Node/PostgreSQL implementation; it is not a deployed release. That runtime requires an external PostgreSQL database, an explicit schema migration, an HTTPS public origin, and an operator-managed host. The revised [production setup proposal](docs/PRODUCTION_SETUP.md) uses Cloudflare Workers, per-room Durable Objects, D1, and private R2, with account-based resume and runtime secrets. It records the required runtime/storage port and revised costs; the Cloudflare implementation and resource provisioning are still pending.

`docs/source-baseline.json` records the approved local source snapshot. It is provenance for this checkout, not imported Sites history or a production release record.
