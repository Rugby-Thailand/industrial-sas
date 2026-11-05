# Iteration 7: changes, trade-offs and what to verify

Code: `perf/convex-backend-audit` at the commit named in `iter7.md`, range
`e0b011fb..HEAD` (iteration 6 ended at `f4baced9`; `4e9824f3` and `e0b011fb` were
fixes made after audit 6 and are part of this iteration). Measurements:
`iter7.md`/`.json` (dataset-L, same as earlier iterations) and `iter7-xl.md`/`.json`
(dataset-XL: dataset-L grown on `main` by `scripts/performance/convex/seed-grow.mjs`,
about 5× job-scan history and 5× employees; same pallets, zones and products).

## Changes

| Commit(s)                         | Change                                                                                                                                                                                                                                                                                    | Findings addressed      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `4c79e6b6`                        | Catalogue, batch and legacy-unit first pages read the warehouse change token only to resume a scan or continue a sorted page; no zero-delta totals writes (one net delta per product).                                                                                                    | Opus 3                  |
| `54b4149b`                        | Building readers check the zone rows for an overflowed or cross-building zone through two indexes instead of sticky flags; the hourly sweep re-checks overflowed zones one per transaction; backfill transactions stop at ~4,000 reads and resume the same page; internal `health` query. | Opus 6, Sol 5, Sol 8    |
| `a0bf04c1`                        | Resumable catalogue totals build for any catalogue size (500 products per transaction in creation order; writes apply deltas only to counted products; pages and writes serialize on the readiness row). The 2,000-product refusal is gone.                                               | Sol 7, Opus 8c          |
| `b3315247`                        | Roster page: one bounded frozen-plan range read per employee over open dates (point-lookup fallback past the bound), only periods ending in or after the month, employees hydrated 10 at a time.                                                                                          | Opus 5a                 |
| `1e7652f4`…`d3628717`, `23092043` | Recommendation list (`view: "list"`) without per-zone geometry; `recommendationZone` returns one zone's geometry; the list carries the zones a screen opens on. Old tabs (no `view`) still get the full payload.                                                                          | Opus 1, Sol 2 (partial) |
| `11b2cc10`…`78bae3d9`             | Index-backed exact substring search: job scans (term dictionary + trigram postings, 3+ code points) and the location picker (bigram postings, 2+ code points), maintained in the writing transaction, resumable backfill, readiness fallback.                                             | Sol 1, Opus 2, Opus 4   |
| `02cc7c13`, `38f4d044`            | Profiler: settled re-subscription after recovery, terminal settling assertions, three-round bursts, a cross-product burst, each target subscribed with its own client's arguments.                                                                                                        | Sol 10                  |
| `cec81afb`                        | `seed-grow.mjs` builds dataset-XL.                                                                                                                                                                                                                                                        | both: "5× fixture"      |

## Trade-offs to weigh

- **Search postings cost writes.** Measured on dataset-L (`iter7.md`, write flows): a
  one-item `saveJobScans` writes 28 documents (base 4), a 50-item save 1,253 (base 53,
  184 ms), `updateJobScan` 31 (4), `deleteJobScans` 24 (4). In exchange the saved-scan
  search reads 61 documents in one request instead of 2,389 over 22, and the picker 39
  instead of 896. Per-transaction posting writes are capped at 1,500; overflow is held
  in an always-searched row and re-indexed by a scheduled job.
- **Recommendation list still reads every active zone** (687 docs, 1.28 MB) and still
  re-runs on any held-placement write, because the picker shows, counts and filters
  every candidate. Returned bytes fell 238 KB → 128 KB, and the open zone preview
  (0.6 KB) no longer re-runs on writes in other zones. Switching to another zone now
  loads its preview in one round trip.
- **Pallet creation contention is inherent.** Same-product and different-product
  `createPallet` bursts retry about as often as on `main`. Every creation increments
  the warehouse's gapless pallet sequence (`finishedGoodsCounters`), and same-product
  creations also share the product summary. Removing it would mean gaps or a new code
  format. Splitting pallet and position sequences into separate rows was rejected:
  code that predates the split would reuse position numbers after a rollback.

## Behaviour that differs, by design

- Job-scan search: the last non-empty page reports `isDone: true` (one-match
  look-ahead) where the scan could return one more empty page; clients without
  `progressive` get full pages; a cursor from the other path resets to page one.
- Catalogue sorted continuation pages reset when the token moved (as before); first
  pages no longer re-run on unrelated writes.
- Building readers take the fallback path for one extra document (the zone row that
  shows why).

## Rollout constraint

Squash-merge (see `docs/operations/storage-zone-occupancy.md` and
`docs/operations/search-index.md`). After any deploy of code that does not maintain a
derived store, call its `invalidate`; the hourly sweeps rebuild.

## Search: real-engine parity and scaling

- `search-parity.mjs` against `main` on identical restored data (dataset-L):
  300 needles, 537 needle/filter traversals paged to completion, **0 mismatches**;
  379 of them answered by the index in one request per page (the rest are needles
  under 3 code points, which keep the bounded scan, or empty results).
  `evidence/iter7-search-parity.json`.
- Scaling (saved-scan search "FO6907", first page): dataset-L 61 docs / 1 request
  (base 2,389 / 22); dataset-XL 70 / 1 (base 10,352 / 95). Picker: 39 docs on both
  (base 896). Roster page: 84 docs on both (765 employees on XL).
- Latency caveat, measured directly on dataset-XL with the backends idle (five
  calls each, median, whole answer): the index path takes 17 ms for a miss, 133–195 ms
  for common or fragment needles and up to ~390 ms for multi-word part names, against
  ~125 ms for each of base's bounded requests (base needs up to 95 of them). User code
  is ~14 ms; the rest is index-query waits (up to 12 probes plus term streams), which
  the local backend makes slower as the database grows (plain listing also rose from
  36 to 130 ms on both targets).
- The XL dataset line reports `jobScans: 8000` because the counter reads at most 8,000
  rows; the snapshot holds ~11,000.

## Not measured here

Payroll/package paths and actions remain outside the profile.
