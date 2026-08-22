# Task 04 — Domain and schema

## Objective

Reduce repeated validation and type declarations without weakening domain
invariants or changing stored data.

## Ownership

- Production files under `convex/model/**`
- `convex/schema.ts`
- `convex/lib/validators.ts`

Exclude `*.test.*`. Do not edit feature handlers, frontend code, or generated
files.

## Work

1. Inventory duplicate closed sets, validators, guards, and wire types.
2. Establish one source for each contract where inference stays precise.
3. Reuse small in-process validation modules; avoid a universal schema engine.
4. Preserve table names, fields, indexes, runtime validation, and public results.
5. Run schema, model, property, typecheck, and tenant-boundary checks.

## Done

- No migration or data-shape change.
- Forged-input and fail-closed behavior remain covered.
- Net production SLOC reduction.
- Return changed files, measurements, and check results to the orchestrator.
