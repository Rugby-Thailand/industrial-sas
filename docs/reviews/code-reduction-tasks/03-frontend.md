# Task 03 — Frontend

## Objective

Reduce UI and client-state code while keeping every screen and interaction.

## Ownership

- Production files under `src/app/**`
- Production files under `src/components/**`
- Production files under `src/features/**`
- Production files under `src/hooks/**`
- Production files under `src/i18n/**`
- Production files under `src/lib/**`

Exclude `*.test.*`, `*.spec.*`, and `src/lib/convex/clientRef.ts`. Do not edit
backend or generated files.

## Work

1. Remove verified unused exports and UI primitives.
2. Replace repeated page shells, form state, tables, and status rendering with
   existing deep modules.
3. Simplify oversized screens through shared behavior, not file splitting alone.
4. Preserve localization, accessibility, responsive behavior, and generated
   Convex references.
5. Run typecheck, lint, and targeted component tests.

## Done

- Every route and interaction remains.
- No handwritten server contract returns.
- Net production SLOC reduction.
- Return changed files, measurements, and check results to the orchestrator.
