# Iteration 9 preparation record (implementation now recorded in iter9-notes.md)

This records the initial plan. Iteration 8 validation and parity have since
completed; see iter8-validation.md. Iteration 9 implemented the building window,
backfill generation guard, and 500-call threshold cap; see iter9-notes.md.
The 300-selection deletion measurement remains planned for iteration 10.

## Reproduced building-create regression

New test: `tests/integration/search-reconcile-building-window.integration.test.ts`.
It creates 101 existing buildings, builds their actual job-scan search index,
then calls the real authenticated `createStorageBuilding` mutation to add one
building. After the reconciliation margin, `reconcile` returns `rebuilding`
instead of `done`. The regression fails at that exact assertion in 2.07 seconds
(3.67 seconds including Vitest startup). No performance improvement is claimed.

```sh
pnpm exec vitest run --project integration \
  tests/integration/search-reconcile-building-window.integration.test.ts \
  --maxWorkers 1 --testTimeout 120000 --reporter verbose
```

Next change: when the layout generation is current, repair only building names
created in the reconciliation window. Preserve a bounded overflow fallback
and the full repair for a genuinely mismatched layout generation. Add coverage
for unmaintained creation, overflow and generation mismatch before measuring.

## Other review inputs, still open

- Occupancy backfill stamps generations at finish. A legacy layout or summary
  write between pages can be hidden by that final stamp. Add an interleaving
  regression; require a run-start generation and safe maintained-write follow.
- Explicit occupancy backfill budget accepts 16,000 even though its default
  safety analysis assumes 500. Bound supported overrides by the proven budget.
- Measure deletion at the actual 300-selection limit on the real backend.
  Check read-call headroom, not only document or write counts. Defer orphan-term
  inspection once the maintenance budget is exhausted, preserving exact search
  and eventual cleanup.
- Avoid changing complete recommendation ranking or gapless numbering merely
  to obtain a higher score. Their remaining costs must be reported if preserved.

## Documentation checked on 2026-11-05

The official [Convex limits](https://docs.convex.dev/production/state/limits)
distinguish 32,000 documents scanned from 4,096 index ranges (`db.get` and
`db.query` calls). Query/mutation user-code execution is limited to one second;
database time is excluded. Local setup already hit that execution limit at a
50-row search backfill batch. The parity retry uses ten rows per transaction.

The installed Convex package exposes `ctx.meta.getTransactionMetrics()` in
`node_modules/convex/src/server/meta.ts`. Before using it for real-engine
read-call evidence, verify support against the locally running backend; its
availability in types alone does not prove runtime support. See official
[write-performance guidance](https://docs.convex.dev/database/writing-data).
