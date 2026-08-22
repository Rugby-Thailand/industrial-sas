# Task 01 — Inbound backend

## Objective

Reduce repeated handlers and wire envelopes while preserving the inbound,
inventory, and master-data behavior.

## Ownership

- `convex/masterData/**`
- `convex/purchasing/**`
- `convex/receiving/**`
- `convex/quality/**`
- `convex/putaway/**`
- `convex/labels/**`
- `convex/inventory/**`
- `convex/lib/listEnvelope.ts`
- `convex/lib/writeEnvelope.ts`

Do not edit tests, `convex/model/**`, `convex/schema.ts`, or other paths.

## Work

1. Find repeated list, page, refusal, write-outcome, and write-context code.
2. Deepen the two shared envelope modules instead of adding new wrappers.
3. Migrate owned callers and delete their local copies.
4. Keep domain rules visible in their feature modules.
5. Run typecheck and the closest inbound/master-data tests.

## Done

- Same exported behavior and permissions.
- No unbounded read or tenant-boundary change.
- Net production SLOC reduction.
- Return changed files, measurements, and check results to the orchestrator.
