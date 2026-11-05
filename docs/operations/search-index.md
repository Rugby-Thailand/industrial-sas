# Derived substring-search indexes

Two searches used to read history or the whole location ledger to answer one
page. Both now walk ordinary-index posting rows that contain the needle's rarest
n-gram, and re-check every proposed row with the predicate they always used.

| Search                                                                               | Rows                                                                                                                                       | Gram    | Library                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------ |
| Saved job scans `finishedGoods/jobScans:listJobScans` (`search` ≥ 3 code points)     | `finishedGoodsJobScanSearchRows` (one per scan), `finishedGoodsJobScanTerms`, `finishedGoodsJobScanTermGrams`, `finishedGoodsJobScanGrams` | trigram | `convex/lib/jobScanSearch.ts`  |
| Location picker `finishedGoods/jobScanLocations:searchPage` (`text` ≥ 2 code points) | `locationSearchGrams`                                                                                                                      | bigram  | `convex/lib/locationSearch.ts` |
| Both                                                                                 | `searchIndexReadiness` (per warehouse and `kind`)                                                                                          |         |                                |

## Why not Convex's search index

It failed exact parity on 23 of 537 needles (bounded prefix expansion, Thai
SARA AM after NFKC; `docs/reviews/convex-performance-2026-11-04/evidence/rejected-search-index.md`).
Grams on ordinary indexes have neither problem: grams are cut from the same
normalized text the matcher compares (`NFKC → trim → lower` for scans,
`NFC → upper` for locations), so a needle that occurs in a text has every one of
its grams in that text, and every hit is re-verified.

## Job scans: design

- **Terms.** Each searchable field value (7 fields) is normalized into a term,
  keyed per warehouse and field. Each building name is a term too (field 7,
  key = building ID).
- **Shared versus unshared.** A term linked by more than 8 scans is _shared_:
  its trigrams are posted once (`TermGrams`), and its scans are found through
  the search row's per-field index (`t0`–`t6`, or `buildingId` for names).
  An unshared term (typically the job number) is posted per scan
  (`finishedGoodsJobScanGrams`), in newest-first key order, with the text
  inline so non-matching postings are dropped without reading the scan.
- **Query.** Probe up to 6 needle grams (8 per-scan postings and 17 term
  postings each); take the sparsest per-scan gram and the rarest term gram;
  merge newest first: that gram's per-scan postings, every matching shared
  term's slot stream and the always-merged unposted streams (gram `""`). Each
  candidate is read and passed to the unchanged `accept` (warehouse, filter,
  seven fields, building name). More than 99 term postings or 48 matching
  shared terms: the same engine merges the plain history index instead (exact,
  scan-cost). The cursor is a key position, so plan changes between pages
  cannot skip or repeat records.
- **Completeness invariant.** For every scan and field whose text contains the
  needle, either the term is shared (found through its grams, the scan through
  the slot index) or the scan has per-scan postings for that text (or an
  unposted row listing it).

## Locations: design

Each location keeps bigram postings of the texts the picker compares (a named
registration's code and label; otherwise its first support position's, or its
area's, code and label), keyed `[warehouseId, gram, code]`. `searchPage` runs the
unchanged `keysetScan` phases (code-prefix range first, then the rest, in code
order) over the postings of the needle's rarest bigram plus the unposted gram,
and evaluates each proposed location with the unchanged evaluator. The bigram is
carried in the cursor so a traversal never changes lanes.

## Correctness model

- **Transactional maintenance.** Every audited tenant mutation wraps its writes
  (`convex/lib/searchIndexWrites.ts`); writes to job scans, buildings,
  locations, positions and areas are re-indexed in `flush()`, inside the same
  transaction. Status-only and other irrelevant patches do no work.
- **Bounded writes.** One transaction spends at most 1,500 posting writes
  (`SEARCH_WRITE_BUDGET`) plus one search row per written scan, one unposted
  row per deferred scan or location, and at most 7 new terms per scan. Work
  over the budget gets one unposted row (gram `""`, every text inline): it is
  merged into every search, so results stay exact, and
  `finishedGoods/searchIndexBackfill:reindex` (scheduled by the same
  transaction) posts it gram by gram. Texts over 512 grams stay unposted.
  Postings of deleted rows that do not fit are left for the same job; they only
  propose rows that no longer exist.
- **Derived rows never decide.** Every proposal is re-read and re-matched by the
  original predicate; tenant, warehouse and authorization checks are unchanged.
- **Readiness.** Readers use the index only while the warehouse's
  `searchIndexReadiness` row for that kind is `ready`, not `stale`, and at the
  current version; otherwise the original bounded scans answer (their cursors
  are not interchangeable: a cursor from the other path restarts at page one).
- **Raw writers invalidate.** Staging seeds that insert scans, buildings,
  locations, positions or areas with `ctx.db` call `invalidateSearchIndex`
  (which also poisons a running backfill); the e2e reset deletes all rows of the
  new tables for its warehouses. `staging/locationBuildingBackfill` only sets
  `buildingId`, which no posting depends on.

## Rollout

1. Deploy. New tables start empty; readers keep the original scans.
2. The hourly `finishedGoods/searchIndexBackfill:sweep` cron starts a chained,
   resumable backfill for every warehouse and kind that is not ready. To run one
   immediately:

   ```sh
   npx convex run finishedGoods/searchIndexBackfill:run '{"warehouseId":"<id>","kind":"jobScans","restart":true,"chain":true}'
   npx convex run finishedGoods/searchIndexBackfill:run '{"warehouseId":"<id>","kind":"locations","restart":true,"chain":true}'
   ```

   Continue a manual run by passing back `continueCursor` and `runId`; a
   restart issues a new `runId`, and pages of any older run are refused
   (`superseded: true`). Job scans index building names first, then scans.

3. Profile, then run `scripts/performance/convex/search-parity.mjs` against
   `main` on the same data; it must report 0 mismatches.
4. To stop using an index without a deploy:
   `finishedGoods/searchIndexBackfill:invalidate '{"warehouseId":"<id>"}'`
   (optionally `"kind"`); the next sweep rebuilds it.

## Release constraint

Code that writes job scans or layout rows without this maintenance (`main`, or
any earlier commit of the performance branch) is not detected automatically:
nothing it writes moves a marker these readers check. After running such code,
call `invalidate` for every affected warehouse (both kinds) before relying on the
index again; the sweep rebuilds it. Squash-merge the branch, as for the other
derived stores (`docs/operations/storage-zone-occupancy.md`).
