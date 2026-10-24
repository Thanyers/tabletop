# Repository conformance

`server/authority.ts` is shared, while persistence is implemented by `SqlWorkspaceRepository` for the Node runtime and `RoomRepository` for Cloudflare Durable Objects. This suite makes their shared command and transaction guarantees executable before repository refactors.

## What the suite checks

The same seven scenarios run against both adapters:

1. An exact retry returns the original acknowledgement and receipt, with no second event or outbox row.
2. Reusing a command ID with a changed payload returns `IDEMPOTENCY_MISMATCH` and writes nothing.
3. Of two different commands using the same expected revision, exactly one commits; the other returns `STALE_REVISION`.
4. An error raised after the authority callback has staged or issued its commit leaves workspace state, snapshot, event, receipt, and outbox unchanged.
5. A duplicate outbox key forces a late persistence failure. The workspace state and all preceding commit records roll back together.
6. A command carrying an earlier workspace epoch returns `STALE_EPOCH` without writing.
7. A command from a revoked member returns `MEMBERSHIP_REVOKED` without writing.

The scenario module depends on the structural test adapter contract and shared command/view types. Each entrypoint invokes the real `CommandAuthority`; it does not replace the repositories with in-memory fakes. The Node suite creates a new PGlite memory database and applies the local schema to it. The Cloudflare suite creates an isolated Room Durable Object through the Workers test runtime and inspects that object's SQLite rows.

The revoked-member fixture seeds a valid member row in the disposable database, then revokes it through the real repository transaction. That isolates the authority's membership check without making the Node guest-session flow match Cloudflare identity authentication.

## Run the focused suites

```powershell
npm test -- server/repository-conformance.test.ts
npm run test:cloudflare -- cloudflare/repository-conformance.test.ts
```

These checks are local-only. They do not use production credentials, make remote writes, or apply a persistent migration. A passing suite establishes the listed repository/authority invariants; it does not establish hosted authentication equivalence or production acceptance.
