# Convex schema decomposition

Status: **Candidate 3 — proposed**
Source: [`schema.ts`](../../../convex/schema.ts)

## Current module and interface

The schema contains 115 table definitions across identity, platform work,
master data, inbound, inventory, fulfillment, transfers, engineering, production,
HR, and integrations. Its external interface is already narrow:

- the default Convex schema definition;
- the derived `DataModel` type.

Approximately 44 production/test files import `DataModel`, while schema-policy
tests import the schema value. Those callers must not learn how table definitions
are grouped internally.

## Target seam

Keep `convex/schema.ts` as the only external interface and composition root. Move
cohesive table-definition groups into internal in-process modules:

```text
convex/schema/
  identityTables.ts
  platformTables.ts
  masterDataTables.ts
  inboundTables.ts
  inventoryTables.ts
  fulfillmentTables.ts
  transferTables.ts
  engineeringTables.ts
  productionTables.ts
  hrTables.ts
  integrationTables.ts
```

Each internal module returns or exports one frozen record of table definitions.
`schema.ts` composes those records once, calls `defineSchema`, exports the default,
and derives `DataModel`. Table names, validators, indexes, and composition order
remain unchanged.

This is implementation organization behind the existing interface, not a new
schema abstraction for callers.

## Dependency category

Pure in-process schema construction. No adapter or runtime service seam is
needed. Convex type inference and the schema-policy guard are the verification
surface.

## Grouping rule

Group a table with the module that owns its lifecycle and invariants, not merely
with the file that currently reads it. Cross-domain references remain validator
IDs and do not justify combining unrelated table families.

The first extraction should be the smallest, lowest-coupling family, such as
integration delivery tables. Identity/authorization and inventory ledger tables
move only after the composition pattern is proven.

## Small-commit sequence

1. Add a schema snapshot/characterization helper that records table names,
   field/index facts, and policy violations without serializing unstable Convex
   implementation details.
2. Extract one low-coupling table family and prove generated `DataModel` consumers
   still typecheck.
3. Extract remaining operational families one per commit.
4. Extract master-data and inbound families.
5. Extract platform/identity and inventory families last.
6. Remove temporary compatibility code and keep `schema.ts` as the small
   composition root.

## Verification

- Convex code generation and strict TypeScript typecheck.
- Schema contracts and schema-policy negative controls.
- Tenant table classification and every `orgId`-first index guard.
- All integration/isolation suites using `DataModel` or the real schema.
- Production build and a clean generated diff.
- Authenticated staging E2E before and after the full series.

## Stop conditions

- Stop if spreading table records widens validators or loses precise `DataModel`
  inference.
- Do not export table-family internals to feature functions.
- Do not rename tables, fields, or indexes during the decomposition.
- Do not combine extraction with a migration or schema behavior change.
- Prefer the current monolith over a composition pattern that requires casts to
  recover Convex types.

## Project benefit

Schema changes become reviewable by domain, merge conflicts decrease, and the
external Convex schema/DataModel interface remains stable. Security reviewers can
still validate the complete composed schema through one policy seam.
