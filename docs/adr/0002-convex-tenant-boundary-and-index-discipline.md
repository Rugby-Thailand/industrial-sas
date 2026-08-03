# ADR-0002 — Tenant-bound Convex public API and index discipline

- ID: `ADR-0002`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-18, D-19),
  §5 Q3, Q31, Q36, Q49, §6.1, §6.2, §12
- Covers plan ADR backlog (§11) items: 1
- Implementation status: **Partial.** Decision 1 (`orgId` first, everywhere) has a
  schema and an automated guard: `convex/schema.ts` declares every tenant table
  through `tenantFields`/`byOrg`, and `convex/lib/schemaPolicy.ts` proves the
  property by reading the finished schema
  (`tests/isolation/tenant-schema-boundary.isolation.test.ts`,
  `tests/isolation/schema-policy-guards.isolation.test.ts`). Decisions 2–6 are
  **not implemented**: there is no tenant-bound accessor, no exported Convex
  function, no `convex/model/**`, no pagination, no lint rule, and no deployment.
  Nothing enforces isolation at runtime, because nothing reads or writes a
  document yet.

## Context

Row-level multi-tenancy (ADR-0001) makes every Convex function a potential
cross-tenant leak. Convex has no row-level security primitive: isolation is a
property of the code that reads and writes documents. Two habits leak data —
fetching a client-supplied document ID directly, and selecting a tenant with
`.filter()` over a scan instead of an index.

The plan also requires that domain rules stay portable, both to keep them
testable without a Convex runtime and to bound vendor lock-in (§5 Q49, plan §13).

## Decision

1. **`orgId` first, everywhere.** Every tenant table has a required `orgId`
   field, and every tenant index begins with `orgId` (D-18). Tables that are
   deliberately global (code-owned reference data such as the permission
   catalogue) are explicitly listed as non-tenant tables.
2. **One tenant-bound accessor.** All document reads and writes go through a
   tenant-bound database wrapper (`convex/lib/tenantDb.ts`) that resolves the
   actor and organization once, revalidates `orgId` after every `get`, and
   revalidates warehouse scope where the document is warehouse-bound (§6.1,
   §6.2).
3. **Thin public functions.** Exported Convex queries, mutations, and actions are
   thin: they validate arguments (Zod/Convex validators), call the wrapper, call
   pure domain modules, and return serializable results (D-19).
4. **Pure domain modules.** `convex/model/**` contains no Convex imports — ledger
   algebra, UOM conversion, GS1 parsing, putaway scoring, and QC rules are pure
   TypeScript (§6.2). Next.js Server Actions may orchestrate presentation but
   must not perform domain mutations (D-19).
5. **No unbounded reads.** Tenant list queries are paginated and index-driven.
   Full-table scans and tenant selection by `.filter()` are prohibited (§5 Q36,
   §12).
6. **Escape hatch preserved.** The pure domain layer, logical export jobs, and
   Convex self-hosting remain the documented mitigation for vendor lock-in (§5
   Q49). Region selection and hosting evidence belong to
   [ADR-0008](./0008-adapter-ports-and-release-gates.md).

## Invariants

### Code-owned guarantees

- `INV-0002-01` Every exported Convex function that touches tenant data is
  constructed by the auth/tenant wrapper; a raw `query`/`mutation`/`action`
  export over tenant tables fails the merge gate (§12).
- `INV-0002-02` Every tenant table declares `orgId`, and every index used for
  tenant queries has `orgId` as its first field (D-18).
- `INV-0002-03` A document fetched by a client-supplied ID is rejected unless its
  `orgId` equals the active organization; warehouse-bound documents are also
  checked against the actor's warehouse scope (§6.1).
- `INV-0002-04` No tenant list query performs a full scan or selects a tenant
  with `.filter()`; list endpoints are paginated with an explicit page size cap.
- `INV-0002-05` `convex/model/**` imports nothing from `convex/_generated` or the
  Convex server API, so it is unit-testable in isolation.
- `INV-0002-06` Mutations never update or delete ledger or audit documents
  ([ADR-0003](./0003-append-only-inventory-ledger.md), §12).
- `INV-0002-07` Errors crossing the public API are structured, non-leaking, and
  carry a request ID; internal messages are not passed to the client verbatim.

### Operational assumptions

- `OPS-0002-01` Convex keeps serializable transactions and OCC semantics as
  documented (§5 Q30).
- `OPS-0002-02` Reviewers treat any new exported function without the wrapper as
  a blocking review defect until the automated check exists.
- `OPS-0002-03` Convex platform limits (document size, transaction size, index
  count) stay within the B-11 envelope; this needs measurement, not assumption.

## Consequences

- Adding a table costs more: schema, index, wrapper coverage, and isolation test.
  That cost is the point.
- The wrapper is a single point of failure for isolation, so it needs the highest
  test density in the codebase.
- Pure domain modules cannot read the database, so callers must load inputs
  first. Function bodies become "load, decide, write".
- Queries are always paginated, so the UI must handle pages from the first
  screen.
- Keeping the model layer Convex-free makes a future backend change survivable
  without making it cheap.

## Rejected alternatives

| Alternative                                 | Why rejected                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Per-function ad-hoc `orgId` checks          | Correct only until someone forgets; there is no single place to test or audit.                                 |
| Trusting Convex document IDs as unguessable | Opacity is not authorization; IDs travel through URLs, logs, exports, and support tickets.                     |
| `.filter()` for tenant selection            | Reads the whole table, so cost and latency grow with total data and isolation depends on a predicate (§5 Q36). |
| Domain logic inside Convex functions        | Untestable without the runtime, unportable, and it entangles invariants with transport concerns (D-19).        |
| Next.js Server Actions writing domain state | Moves invariant enforcement outside the transactional boundary and duplicates authorization (D-19).            |
| Deferring self-hosting evaluation entirely  | Lock-in is the deepest single risk in the plan (§5 Q49); the escape hatch must stay documented and plausible.  |

## Verification

Mostly planned. What exists today checks the schema's shape only.

- Present — isolation tier over the schema declaration: every tenant table
  declares a required `orgId` first, every declared index begins with `orgId`, the
  no-`orgId` allowlist is exactly `organizations`, `users`, `permissions`, no field
  at any depth is named after credential material, and every uniqueness key has an
  exact index. The guards are themselves tested against synthetic bad schemas, so
  they are known to fail when they should
  (`tests/isolation/schema-policy-guards.isolation.test.ts`).
- Present — integration tier over the construction helpers: a caller cannot supply
  `orgId` to `tenantFields`, at the type level or at runtime.
- Missing — isolation tier (`tests/isolation/`, blocking gate): two-tenant fixture
  per exported function family; cross-tenant ID rejection; warehouse-scope
  rejection. None of this is possible until exported functions exist, so `RG-013`
  and `RG-031` remain open.
- Missing — integration tier (`convex-test`): wrapper behaviour, pagination caps,
  structured errors, request-ID propagation.
- Missing — unit tier: pure model modules tested with no Convex runtime.
- Missing — static checks: repository guard that every exported tenant function
  uses the wrapper, that `convex/model/**` has no Convex imports, and that no
  mutation patches/deletes ledger or audit tables (§12 merge gates).

## Release gates

- `RG-012` Every exported tenant function uses the auth/tenant wrapper.
- `RG-013` Cross-tenant IDs are rejected in automated tests.
- `RG-031` Isolation suite is a blocking merge gate.
- `RG-032` No exported Convex function bypasses access wrappers (static check).
- `RG-033` No mutation updates or deletes ledger/audit tables (static check).
- `RG-034` No tenant list query uses an unbounded scan or tenant `.filter()`.
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-18, D-19), §5 Q3, Q31, Q36, Q49, §6.1, §6.2, §8, §12, §13.
- [ADR-0001 — Multi-tenant SaaS and identity ownership](./0001-multi-tenant-saas-and-identity-ownership.md)
- [ADR-0003 — Append-only balanced inventory ledger](./0003-append-only-inventory-ledger.md)
- [ADR-0008 — Adapter ports, cloud and hardware release gates](./0008-adapter-ports-and-release-gates.md)
- [Integration contract INT-02 — Convex hosting](../integration-contracts/convex-hosting.md)
- [Specification coverage matrix](../specification-coverage.md)
