# Schema-policy decomposition

Status: **Candidate 2 — proposed**
Source: [`schemaPolicy.ts`](../../../convex/lib/schemaPolicy.ts)

## Current module and interface

The module deliberately combines the schema's policy metadata, schema
introspection, and violation checks. Its useful composed interface is:

```text
describeSchema(schema)
  → TableFacts[]
schemaPolicyViolations(facts)
  → string[]
```

Named checks and contract constants are also exported so negative-control tests
can attribute a failure to one rule. The module is pure and reads no database.

The size comes mainly from four large policy datasets plus introspection and
checking logic:

- global/tenant table classification and forbidden field vocabulary;
- uniqueness contracts;
- bounded lookup contracts;
- third-normal-form contracts;
- schema introspection;
- composed and named violation checks.

## Target seam

Keep `schemaPolicy.ts` as the single external policy interface. Organize its
implementation behind private in-process modules:

```text
convex/lib/schemaPolicy/
  classification.ts
  uniquenessContracts.ts
  lookupContracts.ts
  normalizationContracts.ts
  introspection.ts
  violations.ts
```

The external module continues to expose the stable composed functions and only
the named metadata/checks that production or negative-control tests genuinely
use. Internal traversal helpers remain private.

## Dependency category

Pure in-process computation. No adapter is needed. Tests pass synthetic
`TableFacts` and real schema definitions through the same external interface.

## Small-commit sequence

1. Inventory every external import and classify it as production interface,
   negative-control test surface, or accidental internal access.
2. Add a compile-time/export-surface characterization test for the interface that
   must remain stable during extraction.
3. Extract classification and forbidden-vocabulary metadata with no behavior change.
4. Extract uniqueness, lookup, and normalization contract datasets one at a time.
5. Extract introspection behind `describeTable`/`describeSchema`.
6. Extract violation implementations while keeping
   `schemaPolicyViolations` as the composed entry point.
7. Remove exports used only by tests after replacing those tests with outcomes
   through a genuine named check or the composed interface.

## Verification

- `schema-contracts.integration.test.ts` against the real schema.
- `schema-policy-guards.isolation.test.ts` negative controls for every rule.
- Tenant schema, table-helper, document-access, and index-policy suites.
- Strict typecheck, because Convex validator introspection types are part of the seam.
- Tenant-boundary guard and production build.

## Stop conditions

- Do not turn each policy rule into a class or registry callback.
- Do not add a port around pure data.
- Do not create pass-through modules with one constant and no locality benefit.
- Preserve the fact that adding a rule to the composed checker makes it active
  everywhere the policy runs.

## Project benefit

Security policy changes become local to their contract family, while callers keep
one small way to describe and validate a schema. Negative controls stay precise,
and reviewers can assess a uniqueness or lookup change without navigating an
unrelated two-thousand-line file.
