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
  `searchIndexReadiness` row for that kind is `ready`, not `stale`, at the
  current version (2) and carries both markers below; otherwise the original
  bounded scans answer (their cursors are not interchangeable: a cursor from
  the other path restarts at page one).
- **Raw writers invalidate.** Staging seeds that insert scans, buildings,
  locations, positions or areas with `ctx.db` call `invalidateSearchIndex`
  (which also poisons a running backfill); the e2e reset deletes all rows of the
  new tables for its warehouses. `staging/locationBuildingBackfill` only sets
  `buildingId`, which no posting depends on. Audited (iteration 8): every raw
  writer of scans, buildings, locations, positions and areas under `convex/`
  is one of these; the `LOCAL-DRAFT` building of `staging/annexDemo:ensure`
  was the only one outside an invalidated branch and now invalidates too.
  The importers (`storageLayouts/fg1Import`, `pdImport`) write through the
  tracked tenant writer.

## Writers that do not maintain the indexes

Code without this maintenance can run after a build: `main`, or any commit
before the index existed, deployed in a rollback and then rolled forward. Its
writes leave no postings, and readiness alone cannot see them. A layout marker
on the readiness row makes the layout ones visible at once, and a reconcile
job repairs every kind without an operator (`convex/lib/searchReadiness.ts`).

- **Layout counter.** Every tracked layout write (buildings, floors, areas,
  positions) bumps the warehouse's `storageCatalogueSignals.generation` once,
  in `main` and in this branch alike. The readiness row keeps a copy,
  `layoutGeneration`, that only maintained transactions move along: the
  search write tracker reads the counter before the write and after the
  finished-goods flush, and follows only when it moved by exactly one (this
  transaction was its only writer). A difference means a layout write that
  did not maintain the index. Readers compare the two (one extra read, which
  changes only on layout writes): job-scan search then answers from history
  (same engine, same cursors) and the picker uses its keyset scan.
- **Watermark.** Rows written at or after the watermark may lack postings.
  It lives on `searchIndexReconcile`, which readers never read, so advancing
  it re-runs no search. Reconcile finds rows by time: scans by `updatedAt` and
  by `_creationTime` (indexes `finishedGoodsJobScans.by_orgId_warehouseId_updatedAt`
  and `by_orgId_warehouseId`), locations and buildings by `_creationTime`
  (`by_orgId_warehouseId`).

Readers do not merge recent rows themselves: that would make every search pay
for writes by maintained code too, and send searches to history after any
burst of saves.

**Repair.** `finishedGoods/searchIndexBackfill:reconcileSweep` runs every
minute. For each built index with something to do it schedules `reconcile`;
idle indexes cost their readiness and reconcile rows, the counter and one
empty index probe per phase, and write nothing.

- Counter differs: job scans re-derive every building name of the warehouse
  in one transaction (≤ 100 buildings; more restarts the build); the picker
  restarts its build (it keeps the keyset scan meanwhile).
- Window `[watermark, now − 30 s)`: scans whose search row was built from
  other field values (`sourceHash`, a digest of the fields postings derive
  from) are re-indexed; the others cost two reads. New locations are compared
  posting by posting; new buildings get their names re-derived. Up to 50 rows
  per phase run in one transaction; larger windows run one page per
  transaction, chained, under a fixed window. The watermark moves to the
  window's end only when every phase is done.
- A build (`run` with `restart`) records the current counter and sets
  `watermark = start − 30 s`.

**Guarantee.** While an index is current, a search returns exactly the rows,
in exactly the order, of the scan it replaces, for every write through this
branch's tracked tenant writer (every tenant mutation; derived rows are
written in the same transaction), and for every layout write by any code's
tracked writer (readers fall back at once). After a rollback-and-forward, a
job scan or location that the old code inserted or changed is missing from
search results until the next reconcile has looked at it: within about two
minutes (the cron runs every minute; rows become eligible 30 s after they
were written). Deletes by any code are harmless (postings only propose rows).
To make readers fall back at once instead, call `invalidate` after the
roll-forward (rollout, step 5).

The 30 s margin assumes no transaction lives longer (Convex mutations are
limited to seconds): the watermark only moves to 30 s before the reconcile
that verified the rows, so a write whose clock reading is older has committed
before that reconcile read the window.

Not covered by reconcile, and needing `invalidate`: a raw `ctx.db` patch by
old code that changes searchable fields of an existing scan, location or
layout row without moving `updatedAt` or the counter, and a rollback to a
commit of this branch before version 2 (it maintains postings but neither
marker nor digest). `main` has no such raw patch today: its raw writers are
staging seeds that insert, and `locationBuildingBackfill`, which only sets
`buildingId`. Rows of scans and locations that old code deleted keep their
search rows and postings: they only propose missing rows and are not
collected.

## Rollout

1. Deploy. New tables start empty; readers keep the original scans. Version 2
   (iteration 8) adds the markers: existing version-1 indexes are not current
   and are rebuilt the same way (postings that are already right are not
   rewritten; every scan is read once).
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

5. After a rollback to `main` and back: within about two minutes of the
   roll-forward the reconcile cron repairs what `main` wrote; until then,
   scans and locations `main` wrote may be missing from search results
   (previous section). For exact results at once, run `invalidate` for the
   warehouse (readers use the original scans until the sweep rebuilds), or
   run reconcile immediately:
   `finishedGoods/searchIndexBackfill:reconcile '{"warehouseId":"<id>","kind":"jobScans"}'`.

## Release constraint

Squash-merge the branch, as for the other derived stores
(`docs/operations/storage-zone-occupancy.md`): intermediate commits of this
branch before version 2 are not covered by the markers (see above).

## Test measurements (convex-test, not the real backend)

Documents read through `ctx.db` (including the authorization reads) for the
first 50-row page, on the 2,200-scan generated corpus of
`tests/integration/job-scan-search-index.integration.test.ts` (iteration-8
run; the index path now also reads the layout counter and probes the
watermark ranges, empty here):

| Needle                 | Matches | Index path      | Scan path          |
| ---------------------- | ------: | --------------- | ------------------ |
| One job number         |       1 | 78 docs, 1 req  | 2,911 docs, 22 req |
| Thai lot text (miss)   |       0 | 40 docs, 1 req  | 2,899 docs, 22 req |
| Miss                   |       0 | 9 docs, 1 req   | 2,899 docs, 22 req |
| Job-number fragment    |      94 | 253 docs, 1 req | 1,322 docs, 10 req |
| Building name          |     144 | 127 docs, 1 req | 1,251 docs, 8 req  |
| Common customer        |     482 | 222 docs, 1 req | 474 docs, 3 req    |
| Every record ("box-0") |   2,200 | 278 docs, 1 req | 127 docs, 1 req    |
| Two code points ("c1") |     295 | scan path       | 604 docs, 4 req    |

Documents written (base → base + derived): `saveJobScans` with 1 item 4 → 60,
with 50 items 53 → 1,534 (50 long unique texts: 1,547); a 60-ticket remap
63 → 144; deleting 30 tickets 33 → 963. Parity: 0 mismatches over 187
needle/filter traversals at 900 scans (iteration 8; iteration 7: 240 at 2,200
and 264 at 900); the picker matched the keyset scan page for page in 114
traversals over 640 locations.

Writes that bypass maintenance (same file, 300 scans): a rare needle reads
367 documents while building names come from history, 29 once reconciled. A
reader that trusted readiness alone returned nothing for the bypassing rows.
The picker reads its keyset scan plus 2 documents (246 → 248) until a new
location is reconciled, then 52.

Picker, 640 locations, every page of a 20-row search (all requests summed):

| Needle          | Matches | Index path       | Keyset scan        |
| --------------- | ------: | ---------------- | ------------------ |
| `NO-SUCH-PLACE` |       0 | 25 docs, 1 req   | 1,010 docs, 2 req  |
| `F1-L30-0123`   |       0 | 138 docs, 1 req  | 1,089 docs, 2 req  |
| `Shelf 3`       |      18 | 289 docs, 1 req  | 1,096 docs, 2 req  |
| `ปลายทาง`       |      63 | 566 docs, 4 req  | 1,217 docs, 4 req  |
| `R0`            |     203 | 886 docs, 11 req | 1,286 docs, 11 req |

Hydrating a match (location, source, area and parents) is unchanged, so
match-heavy searches keep about four reads per match.

### Write cost under the budget (iteration 8)

`tests/integration/search-index-write-costs.integration.test.ts`, documents
written through `ctx.db` by the real mutations ("derived": search tables and
readiness rows; "base": everything else), on a 300-scan warehouse whose
customers, parts and barcodes repeat:

| Write                                       | Base | Derived                         | Deferred to re-index      |
| ------------------------------------------- | ---: | ------------------------------- | ------------------------- |
| 20 consecutive 50-ticket saves, each        |   53 | 1,518 → 499–500 from save 6     | 23 + 10 items (saves 1–2) |
| 50 consecutive one-ticket corrections, each |    4 | 25–26 (36 derived reads)        | 0                         |
| Remap of 300 tickets (selection limit)      |  303 | 200 (search rows only)          | 0                         |
| Delete of 100 tickets                       |  103 | 1,000 (2,220 derived reads)     | 0                         |
| FG1 import, apply (15 cells, geometry only) |   49 | 2 (readiness markers)           | 0                         |
| FG1 import, rollback (replaces every row)   |   49 | 2 (95 derived reads)            | 0                         |
| 100-slot rack (100 locations and positions) |  603 | 1,541 (1,539 location postings) | 64 locations              |

The first saves create and promote the repeating terms; from then on a save
costs about 10 derived writes per ticket (search row, job-number term and its
8 trigram postings). The scheduled re-index drained every backlog (no
unposted rows left), deleted tickets kept no postings, and every search row's
`sourceHash` matched its scan afterwards. Reconciling the 1,000 ingested scans
read two documents each and wrote no derived row; reconciling the rack's new
locations compared their postings and changed none.
