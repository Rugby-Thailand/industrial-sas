# Query correctness and performance audit (Kiro), 15 Oct 2026

Scope: the current working tree at HEAD `733c6aca`, including the 272 existing uncommitted changes, which were preserved. No production file or normal test was edited. Nothing was committed, deployed or run against a live or admin Convex endpoint, and no secrets were read.

Audit-only probes are in `docs/reviews/query-performance-2026-10-15/kiro/`:

- `measure.ts`: a counting proxy over `ctx.db` and a scan driver that mirrors `useCatalogueSync`.
- 4 `*.probe.ts` files.
- `vitest.config.mts` and `tsconfig.probes.json`.

The `.probe.ts` suffix keeps these files out of the default Vitest projects. Each probe asserts the expected behaviour, so a failure reproduces the defect.

The probes call real registered functions through `_handler` inside convex-test, so tenant resolution and authorization run too. The counts are handler-level database operations: ranges (`take`/`paginate`/`first`/`unique`), documents returned, and `get`s. They are regression proxies only. They are not billed bytes, production latency, or Convex limit behaviour.

Replay:

```sh
pnpm exec vitest run --config docs/reviews/query-performance-2026-10-15/kiro/vitest.config.mts --reporter=verbose
# current tree: Test Files 4 failed (4); Tests 7 failed | 2 passed (9)
# log: /tmp/industrial-query-audit-WL7PkU/kiro-probes.log
```

The 2 passing tests are a control (Q1) and a recorded observation (Q3). Supporting checks:

- `tsc -p docs/reviews/query-performance-2026-10-15/kiro/tsconfig.probes.json` passed.
- ESLint and Prettier on the new directory passed.
- Baseline existing integration tests passed: `catalogue-pagination`, `hr-backend-bugfix`, `storage-location-catalogue`, 3 files / 37 tests. Log: `baseline-integration.log`.

## Summary

| ID  | Priority | Finding                                                                                                                                                          | Status                                       |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Q1  | P2       | Sorting the FG catalogue by quantity skips some products and duplicates others when unit spellings differ only by case. Observed: 7 of 45 missing, 6 duplicated. | New. In HEAD.                                |
| Q2  | P2       | Any product-tab search with fewer matches than a page checks one product per request. 105 products → 111 sequential requests.                                    | New. In HEAD.                                |
| Q3  | P2       | HR reviewer search reads every candidate's full legacy audit history before name matching. An unrelated long history marks the result incomplete.                | New regression in uncommitted `convex/hr/*`. |
| Q4  | P3       | Registered-location list with a DRAFT/ARCHIVED filter scans every ACTIVE registration to return nothing.                                                         | New. In HEAD.                                |
| Q5  | P3       | The legacy-unit list on product detail runs 2 move lookups for every batch unit it then discards. 101 units → 202 move ranges.                                   | New. In HEAD.                                |

## Q1 (P2): quantity sort is non-transitive, so sorted pages lose and repeat rows

- **Where:**
  - `convex/finishedGoods/catalogueFilters.ts:75-76`: `if (field === "quantity" && a.unit !== b.unit) return collator.compare(a.unit, b.unit) || a.id.localeCompare(b.id);`, with the collator at `:70-73` (`sensitivity: "base"`).
  - The keyset boundary that depends on a total order is `convex/lib/cataloguePagination.ts:204`: `compare(row, anchor) > 0`.
  - Units are free text, only trimmed: `convex/finishedGoods/workflow.ts:241` and the `ProductScreen.tsx:408-414` text field.
- **Trigger:**
  - Two or more products whose units differ only by case or accent (`PCS`/`pcs`, `Box`/`BOX`, `KG`/`kg`).
  - Quantity sort (asc or desc) on the Products or Storage units tab.
  - More rows than one page.
- **Expected:** every product appears exactly once across the pages.
- **Observed:** with 45 products alternating `PCS`/`pcs`, Next across the pages returned 44 rows: 38 unique, 6 duplicated, 7 never shown. Both directions behave the same. A control with only `PCS` returns all 45 exactly once.
- **Root cause:** units that differ are ordered by `collator.compare`. When the collator says they are equal, the code falls back to ID order instead of quantity. Rows with exactly the same unit, however, are ordered by quantity. This creates cycles: z(PCS,1) < x(PCS,5) by quantity, x < y(pcs,3) by ID, and y < z by ID. That breaks the in-request `.sort`, the best-N retention and the anchor filter.
- **Fix:**
  - Use one lexicographic key: `collator.compare(unit)`, then a code-point tie-break on the exact unit, then quantity × direction, then a code-point ID tie-break.
  - Add a regression test that pages through mixed-case units in both directions.
  - Separately, unit normalisation could be a product decision; the exact unit filter (`catalogueFilters.ts:51`) treats spellings as distinct.
- **Verification:**
  - `Q1 … createRowComparator is transitive`: `expected [-1,-1,-1] to not deeply equal [-1,-1,-1]`.
  - `Q1 … sorted product pages …`: `[Q1] sort=quantity:asc: rows=44 unique=38 duplicates=6 missing=7`, and the same for desc.
  - Control `✓`.
- **Already documented?** No. `catalogue-query-optimization.md` covers collator reuse only, and the 10-10/10-13 reviews do not mention it.

## Q2 (P2): product search costs about one round trip per product

- **Where:** `convex/finishedGoods/catalogue.ts`, `readSearchedProducts`:
  - `:222`: reads 20 products.
  - `:238-246`: keeps the leading name/SKU matches and **breaks at the first non-match**; every remaining product in the chunk becomes `pending`.
  - `:261-312`: each later request handles exactly one pending product (`state.products[0]`): its name check plus one native unit page (`limit: 50`).
  - Driver: `useCatalogueSync` in `FinishedGoodsCatalogue.tsx`, one sequential client round trip per `scanning` result.
- **Trigger:** any settled product-tab search with fewer matches than the page size (default 20). This covers unit-code/lot searches and also name searches. N products cost N + ⌈N/20⌉ requests.
- **Expected:** about ⌈N/20⌉ bounded requests. The probe allows ≤12 for N=105.
- **Observed:**
  - Unit-lot search: `requests=111`, 1,338 ranges in total. Each request repeats the tenant/auth chain of about 12 ranges and 3 gets, plus readiness.
  - Control name search matching the first product: `requests=110`, 1,540 ranges.
  - The user sees Loading until all of these finish.
- **Root cause:** one product per request is used to avoid a second native `paginate`. The adapter already serves non-native bounded reads with `take`, which does not consume the native pagination call (`convex/lib/tenantStorage.ts:251-257`).
- **Fix:**
  - Per request, evaluate up to `min(20, limit)` pending products.
  - For each product, read units with a bounded `take(51)` on `by_orgId_warehouseId_productId_updatedAt`, and keep the existing tail and retired/cancelled rules.
  - Fall back to the current native per-product continuation only when a product has more than 50 live units.
  - Keep the result and ordering identical; parity tests can reuse `catalogue-pagination.integration.test.ts:425`.
- **Verification:** `Q2 …`: `expected 111 to be less than or equal to 12`, with per-table stats in the log.
- **Already documented?** No. Performance-kiro F4 is the same pattern for the **location** catalogue (`searchLocationChunk`); this product search path is not covered in any reviewed document.

## Q3 (P2, uncommitted regression): legacy identity scan before name matching

- **Where:**
  - `convex/hr/search.ts:256-266` authorizes every candidate with the now-async `reviewBlocker` **before** `matchOf` filters by the needle (`:233`). Up to `MAX_NAME_SCAN = 400` candidates are checked per search.
  - `convex/hr/shared.ts:240-279` (`employeeReviewIdentities`): for every employee without `reviewExcludedUserIds` (`:247`), it reads the employee's whole audit range (`:250`, `.all(budget.remaining)` at `:259`) and filters the action in memory (`:262`).
  - The only writer of `reviewExcludedUserIds` is the next employee save (`convex/hr/setup.ts:354`). There is no backfill, so every pre-rollout employee stays on this path.
  - The same per-employee scan runs in `convex/hr/review.ts:111` (queue) and `:246`/`:301`.
- **Trigger:**
  - Global search reviewer lookups (`src/components/shell/search/results.tsx:304`) by an HR reviewer or admin over legacy employees.
  - Every debounced keystroke creates a new query.
- **Expected:** only matched employees need the self-review identity check. A fully checked match is reported as complete.
- **Observed:**
  - 60 legacy employees with 5 audits each, searching "Zed Target": `auditEvents ranges=60 docs=300` for 1 result (`expected 300 ≤ 5`).
  - Adding one unrelated employee with 10,001 audits gives `complete=false items=1 auditEvents docs=10001`. The UI then shows "Some records may not be shown…" for a result that was fully checked.
  - Observation, not counted as a defect: the review queue reads 60 audit ranges / 300 documents per execution, and each audit insert for those employees invalidates it.
- **Root cause:**
  - The check order: authorization before cheap name filtering.
  - A shared 10,000-row budget is spent on unrelated candidates.
  - The fallback is permanent until a manual save of each employee.
  - The audit range also contains authorization rows, because `tenantFunctions.ts:399-412` audits with `entityTable`/`entityId`.
- **Fix:**
  - Run `matchOf` first and call `reviewBlocker` only for matches. Exact-code hits are already few. Keep `complete=false` only when a **matched** employee's history is incomplete.
  - Add a resumable, bounded internal backfill that persists `reviewExcludedUserIds` (from the same audit rule) for all employees, so queue, search and decisions stop reading audits.
  - Keep the security semantics unchanged: unreadable or incomplete history still refuses.
- **Verification:** two failing probes plus one observation in `hr-review-identity.probe.ts`; output above. HEAD's version is a synchronous filter with zero audit reads (`git diff convex/hr/search.ts`).
- **Already documented?** The fallback and its shared budget are described in `daily-bug-search-2026-10-13/implementation/hr-backend.md:7`. That note calls it the "exact `hr.employee.save` audit index", but the index is entity-wide. The read amplification, the match-order issue and the false-incomplete outcome are not documented.

## Q4 (P3): constant-false status filter scans all registered locations

- **Where:**
  - `convex/finishedGoods/jobScanLocations.ts:473-487`: `matches` contains `(!args.status || args.status === "ACTIVE")`, but `locationPage` still pages the ACTIVE `NAMED_STORAGE` index (`:271-279`) and hydrates each row (building/floor reads).
  - The caller is always mounted in both catalogue views with the shared status preference: `StorageLocationCatalogue.tsx:450-453`.
- **Trigger:** the storage catalogue status filter set to DRAFT or ARCHIVED.
- **Expected:** one request and zero location reads.
- **Observed:** 120 registrations take `requests=6`, read 120 location documents and 66 ranges, and return 0 rows. DRAFT and ARCHIVED behave the same; the ACTIVE control needs 1 request.
- **Fix:** in `page`, when `args.status` is set and not `"ACTIVE"`, return a ready empty page (`isDone: true`, empty cursor) before `paginatedScan`.
- **Verification:** `Q4 …` soft assertions: `{requests: 6, locationDocs: 120}` versus expected `{1, 0}`.
- **Already documented?** No. The 10-13 subscriptions review notes this catalogue is always mounted (a UX question), not the empty scan.

## Q5 (P3): legacy units are hydrated before the cheap filter

- **Where:**
  - `convex/finishedGoods/batches.ts:550-552`: `hydrate: createUnitReader(ctx)`, which runs `activeMove` with two status `first()`s per unit (`catalogue.ts:62-77,86`), before `matches: !unit.preparationBatchId && unit.retiredAt === undefined`.
  - `paginatedScan` hydrates every chunk row before matching (`convex/lib/cataloguePagination.ts:192-194`).
  - Always mounted on product detail: `ProductBatches.tsx:91-101`.
- **Trigger:** a product whose units mostly come from preparation batches (the normal flow), or that has retired units.
- **Expected:** 2 move ranges per **shown** legacy unit.
- **Observed:** 100 batch units plus 1 legacy unit take `requests=6`, read 101 pallet documents and issue 202 move ranges, for 1 row. The pallet scan itself stays proportional to all units.
- **Fix:**
  - Short term: add an optional raw-document predicate to `paginatedScan`, applied before `hydrate` (and to retained IDs), and use it for `preparationBatchId`/`retiredAt`.
  - If unit counts grow: add an index that isolates legacy units, so the scan disappears.
- **Verification:** `Q5 …`: `expected 202 to be less than or equal to 2`.
- **Already documented?** No. F10 covers the same two-range cost in building inventory, a different function where the move state is actually displayed.

## Rejected or already documented

- **Totals "second reset" lockout** (`FinishedGoodsCatalogue.tsx:117-130`): still present, but already documented as performance-kiro F3 (`03-backend-warehouse.md:286`).
- **Readiness-generation invalidation, recommendation fan-out, building row subscriptions, stack/job-scan history scans, active-hold history scans:** documented in 10-10 (F1-F11) and 10-13 (codex-queries #1-#7). Not re-reported.
- **Job-scan search** (uncommitted `jobScans.ts:398-425`): it now filters one native page, so pages can be sparse or empty with Next. This is intentional: it shows `searchContinue` and has truthful cursors. It is a UX trade-off, not a correctness bug.
- **Comparator ID tie-break with `numeric: true` + `sensitivity: "base"`:** distinct Convex IDs could theoretically collate equal (for example digit runs with leading zeros). This was not reproducible in practice; it is folded into the Q1 fix as hardening.
- **`jobScanLocations.options` reads archived buildings, then filters** (`:324-361`): small cardinality, generic optimization. Rejected.
- **Location catalogue status/building residual scans:** documented as F4.

## Limits

- convex-test counts operations and documents through the adapter. It does not model Convex billing, the cache, OCC, network latency, or the 4,096-range, 16 MiB and 32k-document limits.
- Fixture sizes (45, 60, 100, 105, 120 rows) are illustrative; production cardinalities were not inspected.
- No browser session was used. Request counts assume the client loop in `useCatalogueSync`, which is source-traced, not executed.
