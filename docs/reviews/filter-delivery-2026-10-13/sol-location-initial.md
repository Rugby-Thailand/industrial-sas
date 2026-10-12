# Sol initial location audit — tenant range adapter

Initial read-only source audit on October 13, 2026. Audited worktree: `/Users/macbook/Development/industrial-sas-filter-locations`; baseline: `11c8c2cc`. Kiro was actively implementing. This report covers only the current changes to `convex/lib/tenantDb.ts` and `convex/lib/tenantStorage.ts`, with supporting reads of tenant table/index/schema policy, the implementation plan, and `sol-coverage.md`. It is not final delivery or release approval.

## Initial result

No concrete security or correctness defect found in these two changed files during this pass.

- The accessor injects its organization as the first equality term; supplied equality terms must follow the declared index prefix and cannot replace that organization.
- The storage adapter independently requires a nonempty, contiguous equality prefix beginning with a valid organization ID. Explicit `missing: true` terms cannot target `orgId`.
- Schema-derived index policy permits only tenant tables and organization-first indexes with distinct fields.
- A range must target the next declared field after the equality prefix, or `_creationTime` after all declared fields are fixed. It cannot range over `orgId` or skip an intervening equality field.
- Bounds require strings or finite numbers, boolean inclusivity, at least one bound, and matching types when both bounds exist. The adapter applies both bounds after all equality terms.

Generic validation currently accepts string `_creationTime` bounds and inverted bounds. Neither is classified as a defect here: no affected application caller or violated contract was established, and empty ranges can be legitimate. This is not a request to add an unrelated cursor-signing requirement.

## Verification

Executed in the audited location worktree:

```sh
pnpm exec vitest run tests/integration/tenant-storage.integration.test.ts tests/integration/tenant-index-policy.integration.test.ts tests/isolation/tenant-storage.isolation.test.ts tests/isolation/tenant-document-access.isolation.test.ts
```

Result: **4 files passed, 96 tests passed**. These existing tests establish relevant adapter/index-policy/isolation regressions; they do not independently establish complete coverage of the new range API.

An additional read-only Node probe transpiled local TypeScript in memory, created the repository's `createConvexTenantWorld()` fixture, and invoked the actual `createTenantDocumentAccess()` with the actual `createMutationTenantStorage()` against `convex-test`. It did not substitute a mock builder or a mock storage port. The fixture includes tenant A's `ALPHA`, `BRAVO`, `CHARLIE`, `DELTA` warehouses and tenant B's `ALPHA` warehouse.

Probe reproduction logic inside `world.t.run(ctx => ...)`, using an accessor scoped to `world.orgA`:

```ts
const access = createTenantDocumentAccess(
  { orgId: world.orgA, requestId: "audit" },
  createMutationTenantStorage(ctx, "audit"),
);

// Returned ALPHA and BRAVO, both owned by tenant A.
await access
  .byIndex("warehouses", "by_orgId_code", [], {
    field: "code",
    lower: { value: "A", inclusive: true },
    upper: { value: "C", inclusive: false },
  })
  .take(100);

// Returned tenant A's ALPHA only, excluding tenant B's equal-code row.
await access
  .byIndex("warehouses", "by_orgId_code", [{ field: "code", value: "ALPHA" }], {
    field: "_creationTime",
    lower: { value: 0, inclusive: true },
  })
  .take(100);

// Returned an empty array, because every fixture warehouse has a code.
await access
  .byIndex("warehouses", "by_orgId_code", [{ field: "code", missing: true }])
  .take(100);
```

Each of these three attempts raised `TenantDbError` with `INVALID_INDEX_QUERY`:

1. Empty equality prefix with a range on `orgId`, lower bound `world.orgB`.
2. Supplied equality `{ field: "orgId", value: world.orgB }` after the accessor's injected organization.
3. Empty equality prefix with a range on `_creationTime` while declared `code` is not fixed.

## Exact limits and pending review

- The probes ran actual local accessor/adapter code through the Convex test emulator, not a deployed Convex database or public authenticated location handler. They establish the observed local behavior only.
- No browser session, production call, production write, commit, deployment, or product-file edit was performed. This Markdown report is the sole requested write.
- The files were reviewed while implementation was in progress; incomplete work was not treated as final defects.
- This pass does not establish location projection parity, migration/backfill readiness, synchronization of every writer, rename/archive/delete invalidation, physical/support relationships, building/floor filtering, location cursor lifecycle, picker UI behavior, contains-search completeness, or performance scaling.
- Full location diff and backend writer/filter/cursor lifecycle review remain pending until Kiro completes the slice. Deployment measurements and final release verification remain parent-owned.
