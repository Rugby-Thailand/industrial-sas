# Task 05 — Tests and fixtures

## Objective

Reduce test SLOC by 50% while retaining evidence for every important contract.

## Ownership

- `tests/**`
- `vitest.setup.ts`
- Every `*.test.*` and `*.spec.*` file under `src/**` and `convex/**`

Production edits require orchestrator approval.

## Work

1. Inventory tenant isolation, authorization, idempotency, bounded reads,
   accessibility, and feature workflows.
2. Keep one test at the lowest layer that proves each contract.
3. Convert repeated examples to tables or properties.
4. Share fixture worlds and remove tests that inspect implementation past the
   module interface.
5. Use targeted fault injection to prove retained tests catch the same defects.
6. Run every Vitest project and end-to-end checks available locally.

## Done

- All named test tiers remain.
- Tenant and authorization negative controls remain blocking.
- Test SLOC is at or below 21,872, or the evidence-backed ceiling is reported.
- Return deleted coverage mappings, measurements, and check results.
