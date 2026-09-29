# Catalogue query optimization

Baseline: `c9a3ff6` (2026-09-29).

## Changes

- Catalogue and legacy-unit pages share product reads within one query.
- Location pages, search hydration and the compatibility list share building
  and floor reads within one query.
- The building inventory reader uses the same small document-reader helper in
  place of its separate pallet/product cache implementations.
- Sorted catalogue requests create one locale collator and parse the sort key
  once, instead of doing both for every comparison.

The reader caches promises, including null results, so concurrent hydration
deduplicates pending reads. Each reader is created inside an authorized query;
it never persists between requests. It calls the existing tenant document
adapter, preserving tenant checks and reactive dependencies. Do not reuse it
across writes in a mutation. Convex queries read a consistent snapshot; see
[query consistency](https://docs.convex.dev/functions/query-functions#caching--reactivity--consistency).

## Measurements

| Fixture                                                        |   Before | After |
| -------------------------------------------------------------- | -------: | ----: |
| Product document gets for 100 pallets sharing one product      |      100 |     1 |
| Product document gets for 100 legacy units sharing one product |      100 |     1 |
| Building/floor gets for 20 locations on one floor              |       40 |     2 |
| Median time for 500 sorts of 100 rows, Thai numeric name order | 1,173 ms | 58 ms |

Read counts come from instrumentation around the database adapter in the
integration tests. The three new read-count regressions were also run against
the baseline implementations and failed on the repeated reads. The optimized
queries pass, including renamed/deleted products and renamed buildings on the
next request. Existing occupancy and tenant-isolation fixtures remain in use.
These counts cover the named joins, not every read or billed byte in a request.

The sorting microbenchmark used Node 24.19.0 on the local development machine,
seven samples per implementation, and deterministic row names
`กล่อง ${((i * 37) % 100) + 1}` for `i` from 0 through 99. Each after-sort creates
its own comparator, matching query scope. Fourteen before/after parity cases
covered English and Thai, default order, ascending/descending names, quantities
and missing dimensions. The roughly 20x sorting improvement is not an
end-to-end page latency claim.

## Validation

Targeted tests cover read counts, per-request freshness, missing products,
location search, occupancy response parity, tenant isolation, numeric text
ordering, stable identity ties, unit grouping and missing dimensions.
No schema, index, migration or client response shape changes are required.
