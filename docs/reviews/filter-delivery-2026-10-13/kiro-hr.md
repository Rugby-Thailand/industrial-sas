# HR record lists: pagination, search and query bounds (Kiro slice)

Worktree `industrial-sas-filter-hr` on `main` `11c8c2cc`, uncommitted, for parent review and integration. No commit, push, deploy, production or browser action was taken.

This revision resolves the mandatory findings in `sol-hr-initial.md` (site 51, terminal reset/stall, actionable retained rows), the `sol-coverage.md` HR gaps (leave queue beyond 501, older day corrections, period versions beyond 50, complete member/site options, holiday range) and the `sol-hr-followup.md` findings (pinned/unread restoration, bounded stack floor and First, MemberPickerField busy). The shared single-slot `useCursorPagination` finding (P2) belongs to the parent and is not edited here.

## Ownership

**Owned (this slice):** `convex/hr/{pagination,shared,setup,review,periods,leave,self,access}.ts`, `convex/schema.ts` (one HR index), `convex/_generated/api.d.ts` (hand edit, see note 1), `src/lib/convex/hrApi.ts`, `src/features/hr/{HrPagedList,HrListCriteria,HrSiteSelect}.ts(x)` and the HR screens that use them, `messages/{en,th}.json` (HR keys), `tests/integration/hr-pagination.integration.test.ts`, the leave/public-API/contract test edits and fixtures, `src/features/hr/{HrPagination,HrPagedRecovery}.test.tsx` and the updated HR tests.

**Not owned. Parent-provided or parent-edited, excluded from this delivery:** `src/hooks/useScanRecovery.ts` (operations), `convex/lib/tenantDb.ts` and `tenantStorage.ts` (locations), `src/hooks/useCursorPagination.ts` (parent's multi-scope fix, changed in this worktree during the session) and `src/features/hr/{HrHistoricalSiteSelect,HrRepeatedCursorReset}.audit.test.tsx` (parent audit probes; both pass). `src/features/hr/HrSiteSelect.tsx` also has a parent edit for historical (`includeInactive`) filters. It is preserved and covered by the audit probe.

## Design

- **Server:** `hrScanPage` (`convex/hr/pagination.ts`) walks ordered tenant index ranges ("lanes"). Each request makes one native page read plus a few bounded `take` reads. Criteria and authorization run before hydration, and overflow matches carry over as IDs. A page stays `scanning` until it is full or every lane is exhausted. A cursor binds organization, actor, surface, criteria and page size. Its lane must still resolve to a currently authorized lane, and every carried ID is re-read and re-matched. Anything else answers `reset`. Page sizes are 20 or 50; other sizes are refused, not clamped. Every owned paged endpoint accepts an ignored optional `attempt`, so Retry opens a fresh subscription.
- **Authorized sites without a cap** (`shared.ts`):
  - `siteAllowed` and `siteResolver` authorize a site exactly. Grants beyond the preloaded 50 are confirmed with one exact grant lookup, cached per request, and a revoked grant is denied immediately.
  - `authorizedSiteLanes` is an incrementally read lane source:
    - Organization-wide actors: the site index in code order. The lane key is `[code, _creationTime, id]` and resumes through the checked range adapter, so duplicate codes keep a deterministic total order. A changed code or status resets the cursor.
    - Warehouse-scoped actors with a complete scope: unchanged static lanes in code order.
    - Warehouse-scoped actors beyond 50 grants: the actor's grants in site-ID order (`by_orgId_membershipId_warehouseId`).
  - The order variant is part of the cursor binding. No whole-tenant expansion and no widening of warehouse grants.
- **Client** (`HrPagedList.tsx`):
  - `useHrPagedQuery` composes `useCursorPagination`, the operations-owned `useScanRecovery` and `useCatalogueSync`. It owns the single automatic return to page 1 after a `reset`. A second reset, a reset on a fresh page 1, a non-advancing scan (`stalled`) or an exhausted automatic budget (`paused`) becomes an explicit `interrupted` view. `HrInterrupted` offers **Start again from page 1** (a real new request through `attempt` or a logical reset) and, when paused, **Keep searching**.
  - The page-size control stays enabled when interrupted. First is offered when history is truncated or the page is interrupted.
  - `HrPagedState` keeps a previous page's rows visible but `inert` and `aria-busy`, and passes `{ busy }` to row renderers.
- **Ordering contracts, stated rather than implied.** Employees: site order (as above), then employee code. Review queue: the same site order or the supervisor's reports index, by employee. Periods: start date, newest first. Holidays: date, newest first. Members and access: account ID across pages; the alphabetical sort applies **within a page only**, which is not a global name order. Site options: code order (organization-wide) or grant site-ID order (scoped beyond 50). No name projection was introduced.

## Resolved findings

| Finding                                                           | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 site 51 (`employeesPage` used `scopedSites`/`MAX_SCOPE_SITES`) | `employeesPage`, `review.queuePage` and `periods.listPage` use `authorizedSiteLanes`/`siteResolver`. A selected site resolves exactly wherever it sorts, and `sitesComplete` is now `true` because every authorized site is reachable. `review.queuePage` no longer refuses an incomplete scope. The editor (`employee`), history, holiday delete, employee save, period preview/export, review detail/decisions/day corrections and leave queue/detail/decisions use exact authorization (`siteAllowed`/`reviewAccess`). |
| Selector completeness                                             | New `access.sitesPage` (search, `includeInactive`, `selectedId` label resolution). `HrSiteSelect`/`HrSiteChecklist` keep the plain preloaded select while it is complete and switch to paged, searchable choices beyond it. Used by the Employees/Review/Periods filters, period creation, the employee form site, Settings holidays and the announcement audience. Member options link visibility uses exact site authorization.                                                                                         |
| P1 terminal reset/stall leaves perpetual loading                  | `interrupted` view with enabled recovery (see Design). Denied, refused and query-failure states stay distinct.                                                                                                                                                                                                                                                                                                                                                                                                            |
| P1 retained rows actionable                                       | Inert subtree plus `busy`: Employees Edit, review queue selection, period version buttons and site checklists are disabled while updating. `MemberPickerField` treats `updating` as pending and offers no options from the previous page.                                                                                                                                                                                                                                                                                 |
| Leave queue beyond 501                                            | `leave.queuePage` (cursor pages, pending then cancellation lanes) no longer refuses an incomplete scope and uses `reviewAccess`.                                                                                                                                                                                                                                                                                                                                                                                          |
| Day correction history (newest 20)                                | Employee day view: a "See every request for this date" link to `/hr/requests?from=<date>&to=<date>` (existing full, paged request history). Reviewer: new `review.dayCorrectionsPage`, shown in a disclosure.                                                                                                                                                                                                                                                                                                             |
| Period versions beyond 50                                         | New `periods.versionsPage` (desc by version) as an "All versions" paged list. Open-by-number is kept. Close/export/fingerprint semantics are unchanged.                                                                                                                                                                                                                                                                                                                                                                   |
| Calendar range                                                    | `yearHolidays` is one checked date-range read (`.all(366)` fails rather than truncates). The former newest/oldest-edge/366-lookup fallback is removed. The `holidaysPage` year filter is also a range lane (only that year is read).                                                                                                                                                                                                                                                                                      |
| Pinned/unread restoration                                         | `pinned=1` / `unread=1` are URL criteria through `useHrListCriteria`, with the entry marker in the stack criteria. Back, reload and history traversal restore the flag and its page together.                                                                                                                                                                                                                                                                                                                             |
| Bounded stack truncation                                          | `useHrCursorStack` returns `[cursors, set, nav]` and keeps an `offset` floor in history metadata. `nav.previous` stops at the oldest retained page, page numbers count dropped pages, and `HrStackFirst` gives an explicit First. All seven stack screens use `nav`. Draft-guarded screens wrap First with `guardedNavigate`.                                                                                                                                                                                             |
| Editor Close metadata                                             | `useCarriedListState` copies the list's paging metadata into the router-created editor entry and back into the list entry on Close, once that exact URL is committed. Reloading either keeps the list page. Previous navigation and draft-guard behavior is unchanged.                                                                                                                                                                                                                                                    |

## Tests (actual runs)

- **Integration** `hr-pagination.integration.test.ts`: 19 passed (5 new).
  - 55 active sites with duplicate codes, organization-wide: the employee at the 51st+ site is reached by traversal, search, direct filter and the editor. Periods, review and holidays accept that site. `sitesPage` lists all 55 (active only, with an inactive variant), finds the site by search and resolves `selectedId`. A forged lane key from another tenant resets.
  - Warehouse-scoped with 56 grants: all 56 employees are reachable, an ungranted site stays hidden, filters resolve the 55th and 56th grants, and review no longer refuses. Revoking the cursor's current grant removes that employee from every list and the exact editor lookup.
  - 60 period versions are traversed in exact descending order; foreign or unknown periods return NOT_FOUND.
  - 33 corrections on a day are traversed beyond the newest 20; an out-of-scope employee returns NOT_FOUND.
  - A year buried under 150 holidays on each side is one request that reads 7 rows.
- **Integration** `hr-policy-leave.integration.test.ts`: 26 passed (+1). A warehouse-scoped reviewer with 55 grants reaches a request at the last grant through `queuePage` and `detail`; after revocation, both hide it.
- **React** `HrPagedRecovery.test.tsx`: 14 passed (new), through the real screens and hooks.
  - Terminal reset after one automatic return, and recovery with `attempt: 1`.
  - Fresh-page-1 reset with no retry loop.
  - A stalled scan is followed once, then restarts.
  - A paused search after 50 steps, then Keep searching.
  - Employees rows inert, Edit disabled and the click ignored; review item not selectable; member select pending until the next page.
  - Pinned only and page 2 across remount and popstate; unread only across remount.
  - 501 Next steps keep 500 cursors with floor page 3 and no implicit page-1 jump; the floor persists across remount and First clears it; screen-level First on a truncated notifications stack.
  - Paged site filter choosing a late site; the day-requests link.
  - Editor open/Close carries the list position, and reload resumes page 2.
- **Mutation check:** removing the busy lock, the inert attribute, the stack floor, terminal-reset detection or the URL pinned flag made 7 of these tests fail; removing the Close carry failed the editor test. Every mutation was reverted.
- **Parent audit probes:** `HrHistoricalSiteSelect.audit.test.tsx` and `HrRepeatedCursorReset.audit.test.tsx` both pass.
- **Scoped runs:**
  - `vitest run src/features/hr src/components/shell src/components/providers src/components/system src/hooks src/lib`: 78 files, 693 tests passed.
  - Integration (all `hr-*`, global search, search provider, public API coverage and contract, schema contracts and production compatibility, generated artifacts, CI discovery, registered boundaries, tenant index policy, storage and table helpers): 24 files, 507 passed.
  - `bun --check` with the pinned Bun 1.4.3: no type errors in 917 files. `tsc --noEmit` (root and `convex/`), `eslint --max-warnings=0` on all owned changed files and `prettier --check` all pass.
- **Contract:** public example `hr/access:sitesPage` added (inventory 36). Snapshot refreshed with `UPDATE_PUBLIC_CONTRACT=1`. The change is additive: an optional `attempt` on paged endpoints, plus `access.sitesPage`, `periods.versionsPage` and `review.dayCorrectionsPage`.
- **Not run:** full suite, `pnpm build`, `ci:codegen`, browser checks (parent owns them).

## Measured request counts (actual handlers, convex-test)

1,000 employees in 2 sites, sequential requests including scan steps:

| Scenario                                   | Requests |
| ------------------------------------------ | -------- |
| Employees, blank first page (20)           | 1        |
| Employees, full traversal at 50            | 22       |
| Employees, sparse search (1 hit at end)    | 12       |
| Employees, no-match search                 | 12       |
| Employees, status filter first page        | 2        |
| Review, 14 days, first page                | 1        |
| Review, full traversal at 50               | 53       |
| 57 sites, 1 employee at the last, traverse | 7        |

The full traversal at 50 rose from 21 to 22 because the lane source discovers the end of the site index with one extra bounded read. These are local harness counts, not production latency.

## Remaining limits and integration notes

1. `convex/_generated/api.d.ts` was edited by hand to add `hr/pagination`. Confirm with `pnpm ci:codegen` (needs the local backend).
2. Schema: new index `hrPeriods.by_orgId_startDate`. It is built on deploy and needs no backfill.
3. Substring search remains a bounded scan: about ⌈rows/99⌉ requests per lane for a sparse search or a miss. Fast arbitrary substring search would need a maintained projection.
4. All-sites lists for scoped actors: the period registry scans the organization date index and skips sites outside scope. Site lanes walk sites in order, and empty sites cost a bounded peek each (57 sites took 7 requests).
5. Exact authorization beyond 50 grants is applied to the surfaces above. Announcement management (which requires a complete scope by design), payslip import matching, policy leave adjustments and global search suggestions still use the conservative preloaded check: grants beyond 50 are denied there, never widened. The HR access banner still reports `sitesComplete: false` for scoped actors beyond 50.
6. Concurrent changes: a site added before the current lane mid-traversal appears on the next traversal. A retained row that no longer matches is dropped, so a page can be short, but its continuation stays navigable.
7. The single-slot cold-refresh overwrite between simultaneous pagers (`sol-hr-followup` P2) depends on the parent's `useCursorPagination` change. The parent's version is present in this worktree and the HR suites pass against it. This slice did not modify or separately verify it.
