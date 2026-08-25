# Inventory-ledger store decomposition

Status: **Candidate 4 — proposed, mandatory viability gate**
Source: [`inventoryLedgerStore.ts`](../../../convex/lib/inventoryLedgerStore.ts)

## Current module and interface

This is already a deep, high-value persistence module. Many production flows call
its small set of capabilities while it hides reference ownership, exact posting,
idempotency, balance projection, append-only writes, occupancy, reads,
reconciliation, and reversal.

Its central safety property is stronger than file organization: every ledger
write goes through this module using `TenantDocumentAccess`, and the tenant
boundary guard refuses ledger writes elsewhere.

The decomposition is therefore optional. Proceed only if internal organization
can improve locality without widening the interface or scattering write invariants.

## Stable external interface

Callers should continue to learn capabilities, not storage steps:

- post or replay a transaction;
- reverse a transaction;
- read transaction detail/history and balances;
- reconcile a bucket;
- map internal refusal to a public error.

No caller may receive direct access to header/line/balance write helpers,
idempotency records, reference resolution, or projection updates.

## Target seam

Keep `inventoryLedgerStore.ts` as the external interface and the only production
file allowed to insert or update ledger/balance rows. Extract only cohesive
read-only or pure implementation behind it:

```text
convex/lib/inventoryLedger/
  errors.ts
  canonical.ts
  records.ts
  reads.ts
  reconciliation.ts
```

The original store retains posting orchestration, reference validation, prior
balance reads, projection checks, ledger/balance/audit/idempotency writes,
handling-unit occupancy, and reversal orchestration through the posting path.

This preserves the existing static guard's single-writer file allowlist. If the
store remains too large after safe read-only extraction, stop; do not weaken the
guard merely to achieve a line-count target.

## Dependency category

Local-substitutable through the existing Convex/`convex-test` world and
`TenantDocumentAccess` seam. Do not introduce a second repository port: the
tenant document accessor is already the interface that substitutes storage in
tests while enforcing bounded, tenant-scoped access in production.

## Small-commit sequence

1. Record the current external export set and every production importer.
2. Add/confirm interface-level characterization for fresh posting, exact replay,
   argument conflict, cross-tenant references, negative balance, reversal,
   pagination, and reconciliation.
3. Extract public error mapping and canonical request/result construction as pure
   internal modules.
4. Extract immutable record mapping and read-only transaction/balance/history
   queries.
5. Extract read-only reconciliation logic while preserving platform pagination limits.
6. Reassess the remaining store. Keep posting and reversal together if separating
   them would expose internal write ordering or duplicate invariants.
7. Remove old internal tests only after equivalent behavior is covered through
   the external store interface.

## Verification

- Ledger unit/property tests, including random valid transaction sequences.
- Inbound, putaway, quality, transfer, fulfillment, production, count, opening
  stock, jobs, and storage-layout integration suites that post through the store.
- Ledger reversal/idempotency and tenant-isolation suites.
- Tenant-boundary negative controls proving no other file can write ledger,
  projection, or audit facts.
- Production build, credential-free E2E, and authenticated staging inbound E2E.

## Stop conditions

- Do not split the ordered posting transaction across externally callable modules.
- Do not create a generic repository interface with one production adapter.
- Do not weaken the exact-file ledger-writer allowlist.
- Do not make callers coordinate validation, idempotency, projection, or audit order.
- Stop after pure/read-only extraction if further splitting reduces locality.

## Project benefit

Read and reconciliation changes become easier to navigate and test, while the
critical posting transaction remains one deep module with one enforced writer.
This yields maintainability without trading away append-only, idempotency, tenant,
or exact-balance guarantees.
