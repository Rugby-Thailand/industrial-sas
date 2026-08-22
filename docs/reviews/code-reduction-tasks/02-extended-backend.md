# Task 02 — Extended backend

## Objective

Reduce repetition in Phase 5A, storage planning, reporting, and workspace code
without removing any capability.

## Ownership

- `convex/sales/**`
- `convex/engineering/**`
- `convex/production/**`
- `convex/storageLayouts/**`
- `convex/reporting/**`
- `convex/workspace/**`

Do not edit tests, shared envelope modules, `convex/model/**`, or
`convex/schema.ts`. Request shared-helper changes from the orchestrator.

## Work

1. Replace repeated pagination, status-transition, uniqueness, and outcome
   plumbing with existing shared interfaces.
2. Consolidate local helpers only when callers learn less.
3. Preserve every route-facing function, permission, transition, and result.
4. Run typecheck and the closest Phase 5A, storage, and reporting tests.

## Done

- All owned features remain available.
- No schema or stored-data change.
- Net production SLOC reduction.
- Return changed files, measurements, and check results to the orchestrator.
