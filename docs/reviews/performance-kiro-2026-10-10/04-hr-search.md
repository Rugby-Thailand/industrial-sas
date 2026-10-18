# Performance audit 04: HR and global search

Date: 2026-10-10 · Scope: `src/features/hr`, `src/components/shell/search`, `src/lib/search`, `convex/hr`, `convex/model/hr`, `convex/model/search`, and the shared pieces they depend on (`HrAccessProvider`, `DraftGuardProvider`, `convex/lib/tenantDb.ts`, `convex/lib/memberDirectory.ts`, `convex/lib/tenantFunctions.ts`). Read-only audit. No application code, configuration, git state or data was changed.

## Measurement status

I did not measure any runtime performance numbers. I did not run a build, dev server, test suite or browser session. Every "slow" claim below comes from reading the code unless it cites one of these existing artifacts:

- `output/global-search/root-live-eval-shipped.json`: AI provider latency for 60 synthetic queries with `openai/gpt-6-luna`. Summary: p50 2.617 s, p95 4.595 s. Median by intent: OPEN_PAGE 3.27 s (8 cases), HR_SETTINGS_SECTION 2.27 s (8 cases). This measures the provider call only, not the end-to-end dialog.
- `.next/` build: `BUILD_ID` mtime is 2026-10-09 22:27. That is before HEAD (`b232565`, 2026-10-10 14:09) and before the current uncommitted HR/search changes, so the build is stale. Chunk `static/chunks/427q6jcwqas40.js` contains the search dialog (`global-search-input`, `global-search-ai-panel`). It is 54,946 B raw and 17,827 B gzip, and it appears in all 29 `(desktop)` `page_client-reference-manifest.js` files. Use these sizes only as a rough indication.
- Primary source: [Convex best practices, "Don't use `Date.now()` in queries"](https://docs.convex.dev/understanding/best-practices/). It says a subscribed query "is not re-run when `Date.now()` changes" and that using `Date.now()` causes "the query cache to be invalidated more frequently than necessary".

I also read `AGENTS.md` and the installed Next 16.3.8 guides `01-app/02-guides/lazy-loading.md` (`next/dynamic`, top-level declaration for preloading) and `01-app/02-guides/client-side-data-fetching/index.md`.

## Existing mitigations already in place (do not redo)

- Search sends nothing to the server until the dialog is open and text is typed. `SearchBody` mounts only while open (`SearchDialog.tsx:114`). `RecordQueries` mounts only when `canSearch` is true (`results.tsx:466-526`). Record queries are debounced by 250 ms and wait for IME composition to finish (`SearchDialog.tsx:46-57`).
- `RecordQueries` publishes state only when its fingerprint changes (`results.tsx:438-444`), so Convex outcome identity cannot cause render loops.
- Name search is bounded at `MAX_NAME_SCAN = 400`, codes use exact index lookups, and results report `complete` (`convex/hr/search.ts:47`, `128-158`).
- AI Search makes one request with a 12 s deadline and no retry (`provider.ts:20`, `132-174`), uses a persisted per-actor quota of 20 per 10 min (`navigationIntent.ts:25-29`), and discards stale answers by key and sequence (`useAiSearch.ts:62-98`, `125-180`).
- Draft-guard registration is stable: `discard` goes through a ref and the provider skips identical entries (`draftGuard.ts:33-52`, `DraftGuardProvider.tsx:36-55`). Nothing to fix there.
- The authorization layer already avoids `Date.now()` so Convex can reuse reads (`tenantFunctions.ts:318-333`). Finding 1 shows the HR handlers re-introduce it.
- HR writes are idempotent, and uncertain outcomes keep the same request ID (`useHrWrite.ts`). CSV export is a mutation on purpose so it is audited (`periods.ts:629`). Both are kept as they are.
- Review queue, history and periods use hard bounds (31 days, 99 employees per site, 500 items) and show limit errors instead of truncating.

---

## Findings

### 1. Clock-dependent HR queries never refresh at time boundaries, and `Date.now()` defeats the query cache

- **Priority:** P1 · **Effort:** M (S for the `Date.now()` removals) · **Evidence:** inferred from code plus Convex documentation.
- **Where:**
  - `convex/hr/shared.ts:62-72`: `orgClock` calls `Date.now()`.
  - Called from query handlers `access.ts:28`, `self.ts:164` (`today`), `self.ts:215` (`recentCorrections`), `self.ts:397` (`history`), `self.ts:484` (`dayDetail`), `self.ts:508` (`profile`), `review.ts:109` (`queue`), `review.ts:203` (`dayDetail`), `periods.ts:222` (`preview`).
  - `convex/lib/memberDirectory.ts:40` calls `Date.now()` inside `describe`. That reaches `listEmployees` and `employee` (`setup.ts:55`), `memberOptions`, `accessMembers`, `profile` (`self.ts:518`) and every `memberName` call in `dayDetail.ts`.
  - No timer exists in `src/features/hr` or `HrAccessProvider.tsx`. A grep for `setInterval`/`setTimeout` finds only the CSV blob revoke at `PeriodDetailScreen.tsx:662`.
- **Evidence:** `today` derives `state`, `nextAction` and `businessDate` from `clock.now` (`self.ts:82-131`, `177-205`). The client subscribes once with `useQuery(hrRefs.today, {})` (`TodayScreen.tsx:50`). Per Convex, the subscription re-runs only when a document it read changes.
- **Journey:** An employee leaves Today open through the end of a shift.
  - After `openDayDeadline` (`schedule.ts:188-195`), the screen still shows CLOCKED_IN and a Clock-out button. Pressing it returns `HR_OPEN_DAY_EXPIRED` from the fresh mutation.
  - The refusal writes only an audit row, which the query never read, so the screen stays wrong.
  - After local midnight, `businessDate` and `HrAccessProvider.today` stay on yesterday. Normal search then resolves "เมื่อวาน" with the stale `today` (`results.tsx:218`, `SearchDialog.tsx:153`), and History and Review default ranges stay a day behind.
  - Separately, every one of these queries invalidates the Convex query cache often, which adds database work on reconnects, new tabs and shared args.
- **Fix:**
  1. Have each time-dependent query return `refreshAt`: the earliest future instant its answer can change. For `today`, use the minimum of next org-local midnight, the open-day deadline of a CLOCKED_IN day, and plan start/end. For `access.current` and History, use next local midnight. For `queue` and `preview`, use next local midnight and the earliest open-day deadline among rows.
  2. Add a client hook `useRefreshBoundary(refreshAt, serverNow)`. It schedules one timeout for the relative delay `refreshAt - serverNow`, so it does not trust the client wall clock. It also re-checks on `visibilitychange` because background tabs throttle timers. When it fires, it passes `asOf: refreshAt` as an extra, ignored query argument, which forces a re-run. Clients that cross the same boundary share one cache key. The server still computes with its own `Date.now()`, so clock correctness does not change.
  3. Remove `Date.now()` where the result does not need it:
     - In `periods.preview`, call `orgClock` only on the draft branch. `timezoneSupported` can come from `timezoneOffsetMinutes`, which is pure (`calendar.ts:42-53`). Closed versions then become fully cacheable.
     - In `memberDirectory.describe`, reuse the creation-time trick from `tenantFunctions.ts:322-332`: when `effectiveTo` is undefined and `effectiveFrom <= _creationTime`, `active` does not depend on time.
- **Risks and safeguards:**
  - Never use client time for state or writes. Mutations already re-derive state (`self.ts:296-344`, `346-390`).
  - Add 0-2 s jitter after the boundary.
  - Changing args makes `useQuery` return `undefined`. Pair this with Finding 6 so the screen does not flash at midnight.
- **Measure:**
  - Before: in convex-test with `vi.setSystemTime`, clock in, advance past the deadline, and show the subscribed result is unchanged until a document write.
  - After: assert `refreshAt <= deadline`, and that re-querying with `asOf` yields `UNRESOLVED_OPEN`.
  - Staging: leave Today idle for 1 h and count `hr/self:today` executions in the Convex dashboard. Expect about one per boundary, with no polling pattern.
- **Regression tests:**
  - `self.today` returns `refreshAt` for each state.
  - A hook test with fake timers for timer, visibility and skew handling.
  - Playwright `page.clock` jump past midnight: the date header and the search "เมื่อวาน" target both advance.
  - A closed `periods.preview` makes no `Date.now()` call (spy).

### 2. Every clock-in, clock-out, correction, decision and day-detail view reads all of a site's periods

- **Priority:** P1 · **Effort:** S once Finding 3 lands · **Evidence:** inferred.
- **Where:** `shared.ts:439-465`. `sitePeriods` is `.all(MAX_SITE_PERIODS)` with `MAX_SITE_PERIODS = 1000` (`shared.ts:38`), and `closedPeriodCovering` filters the result in memory.
  - Callers: `self.ts:331` (clockIn), `self.ts:372` (clockOut), `self.ts:565` (submitCorrection), `review.ts:318` and `review.ts:470` (decisions), and `dayDetail.ts:138-139` (`locked`, in both self and review detail queries).
- **Journey:**
  - Clock-in is the most frequent HR write. Its read cost and mutation read set grow linearly with site history (about 52 periods a year at weekly cadence), up to 1,000 documents.
  - Every open day-detail view subscribes to every period of the site, so creating, closing or revising any period re-runs all of them.
  - A period close also OCC-conflicts with concurrent clock-ins at that site.
- **Fix:** Use Finding 3's range read on `by_orgId_warehouseId_startDate`: equality on `warehouseId`, then `startDate <= date`, `desc`, `take(1)`. Then check `status === "CLOSED"` and `endDate >= date`. This works because periods of a site never overlap: `create` refuses overlap at `periods.ts:402-403`, and `startRevision` never changes dates.
- **Risks and safeguards:**
  - The lock must stay fail-closed. Before switching the mutations, run a read-only operator check (not a release step) that confirms no overlapping periods exist in production.
  - Add an integration test that overlaps cannot be created.
  - Optionally switch day-detail queries first and mutations second.
- **Measure:** Extend `tests/fixtures/document-reads.ts` to count index reads and returned docs, the way `catalogue-pagination.integration.test.ts:69-77` wraps `query`. Run clockIn with 0, 52 and 260 seeded periods. Before: documents read grows with N. After: constant.
- **Regression tests:**
  - Clock-in is refused inside a closed period at the first day, the last day and a middle day.
  - Clock-in is allowed in a draft or revised period and in the gap between periods.
  - Read count stays at most a constant as N grows.

### 3. The equality-only tenant index API forces per-date point reads, sequentially

- **Priority:** P1 enabler · **Effort:** M (shared, security-sensitive) · **Evidence:** inferred.
- **Where:** `tenantDb.ts:179-185` (`TenantIndexEquality` holds equality terms only) and `byIndex` at `538-620`. Consumers:
  - `shared.ts:388-414` `loadSiteDays`: per date, one index read of up to 198 days plus one holiday `unique`. That is 62 sequential reads for 31 days, run for each site in `review.queue` (`review.ts:134-139`) and for every `periods.preview` / `close` (`periods.ts:73`).
  - `self.ts:414-430` `history`: per date, `dayOf` plus `dayCorrections` (take 21) or `holidayName`. Up to about 93 sequential reads for 31 days.
  - `self.ts:106-114`: `selfState` reads yesterday and today serially.
- **Journey:**
  - Opening Review (default 14 days, up to 31) or a draft period runs this loop.
  - These queries re-run on any attendance-day change in range at the site, so each clock event at a site re-runs the whole loop for every reviewer and period viewer.
  - History opens with a 14-day window.
- **Fix:**
  - Add an optional trailing `range: { field, gte?, gt?, lte?, lt? }` to `byIndex`. Validate that `field === facts.fieldsAfterOrg[equality.length]`, reject `undefined` bounds, and keep the org equality first. Implement it in both the query and mutation ports (`tenantStorage.ts:370`).
  - Then read days with one range read on `by_orgId_warehouseId_businessDate` (or `by_orgId_employeeId_businessDate` for history).
  - Read holidays with one range read on `by_orgId_warehouseId_date`.
  - For history, read corrections with one range read on `hrCorrectionRequests.by_orgId_employeeId_businessDate`, grouping by date and taking the latest `submittedAt` per date. That matches `dayCorrections`, which also folds in the pending request.
  - Wrap any per-site loop that remains (`review.ts:134`) in `Promise.all`.
- **Risks and safeguards:**
  - This is a tenant-isolation primitive. Add unit tests for wrong-field, out-of-order and missing-equality rejection, and confirm `assertOwnedDocument` still checks every row.
  - Keep `.all(limit)` bounds equal to today's worst case (31 × 198), so a bound is exceeded loudly, never truncated.
- **Measure:** With the read-count fixture, compare queue (1 site, 99 employees, 31 days), history (31 days) and preview (50 employees). Before: about 62–93 index reads. After: 2–3. On staging, compare Convex dashboard execution time and bytes read per `hr/review:queue` call.
- **Regression tests:** Existing `hr-workflows`, `hr-review-completion` and `hr-independent-regressions` integration suites must give the same outputs. Add golden-output tests that build queue, history and preview rows with the old and new loaders over the same seed, with holidays, overnight shifts, pending corrections and resubmissions.

### 4. Search menu results wait for the 250 ms debounce, and Enter during that window is silently ignored

- **Priority:** P1 · **Effort:** S · **Evidence:** inferred from code. Tests encode the current behavior.
- **Where:**
  - `SearchDialog.tsx:161-162` feeds `settled` into `useStaticResults` and `useRecordResults`.
  - `SearchDialog.tsx:187-190`: `stale` empties `enabled`.
  - `SearchDialog.tsx:244-247`: Enter finds no result and does nothing in SEARCH mode.
  - `matchDestinations.ts:2-4` says "Runs on every keystroke without the network", yet it is debounced.
  - `GlobalSearch.test.tsx:82-84` waits 300 ms.
- **Journey:** "⌘K, type `today`, Enter" typed quickly does nothing, and the user must press Enter again. Every page and task result appears at least 250 ms after typing stops, even though it is computed locally.
- **Fix:**
  - Compute `useStaticResults` from the live `query` (still gated on `composing`). Keep record queries on `settled`.
  - Let Enter open the active result when it is static and its group ranks above RECORDS. `GROUP_ORDER` is AI, PAGES, RECORDS, TASKS (`SearchDialog.tsx:45`), so a PAGES result cannot be displaced by arriving records.
  - If the top result is a TASK, or nothing local matches, Enter flushes the debounce (`setSettled(query)`) and acts once records for that exact text arrive. That keeps the guarantee that Enter never opens the previous query's record.
- **Risks and safeguards:**
  - Thai IME: keep the `isComposing` / `keyCode 229` guard (`SearchDialog.tsx:235-236`).
  - The own-day task (`results.tsx:218-255`) depends on `hr.today` only, so the live text is safe.
  - Announce result counts politely without per-keystroke chatter. Keep the status tied to `settled`, or throttle it.
- **Measure:** In Playwright, time from the last keystroke to `router.push` for `today⏎`, `ตั้งค่า⏎` and `EMP-001⏎`, with Enter pressed 50 ms after typing. Before: no navigation, or more than 250 ms. After: page results navigate immediately and records navigate after their query settles. React Profiler commit count per keystroke should stay similar.
- **Regression tests:**
  - Update `GlobalSearch.test.tsx` and `SearchDialogFocus.test.tsx`: an immediate Enter opens a PAGE result.
  - An immediate Enter on a query whose first result would be a record does not open the earlier query's record.
  - IME composition plus Enter never submits.
  - `resolveIntent.test.ts` and `registry.test.ts` stay unchanged for Thai/English matching.

### 5. HR screens subscribe to their data only after `hr/access:current` resolves (request waterfall)

- **Priority:** P2 · **Effort:** S–M · **Evidence:** inferred.
- **Where:**
  - `HrAccessProvider.tsx:50-53` waits for auth, then queries access.
  - `HrShared.tsx:34-35`: `HrGate` renders a spinner until READY, and only then mounts children.
  - Children subscribe afterward: `TodayScreen.tsx:49-50`, `ProfileScreen.tsx:32`, `PeriodsScreen.tsx:74`, `EmployeesScreen.tsx:137`.
  - History and Review also need `access.today` to build their args (`HistoryScreen.tsx:101-103`, `ReviewScreen.tsx:82`, `104`, `118`).
  - An HR-only member lands on a storage page first and is then client-redirected (`HrLandingRedirect.tsx:19-37`).
- **Journey:** Every HR page load costs auth, then the access round trip, then the screen query round trip. An HR-only sign-in adds a route hop on top.
- **Fix:**
  - Hoist each screen's `useQuery` above `HrGate`, using `"skip"` only while `useConvexAuth()` is loading or unauthenticated. Keep `HrGate` deciding what renders.
  - Make `history` and `queue` `from`/`to` optional, default the range on the server (today − 13 … today), and echo `{from, to, today}`. That removes the client's dependency on `access.today`.
  - Optionally, resolve the HR-only landing route on the server or in `proxy` later. It is out of scope here.
- **Risks and safeguards:**
  - Authorization is unchanged. Every query authorizes itself and returns `ok:false` on denial, and query denials are not audited (`tenantFunctions.ts:814-816`), so there is no audit noise.
  - Tenant-resolution failures throw for both the access query and the screen query, so the failure mode is unchanged.
  - Never render data before `HrGate` allows it.
- **Measure:** Use Convex client `verbose` logs or Performance marks for "query sent" and "result received" for `hr/access:current` and `hr/self:today` on `/th/hr/today` with the local seed. Before: sequential. After: overlapping. Also compare time-to-first-content on throttled 4G in a Playwright trace.
- **Regression tests:**
  - A denied member still sees `hr-denied` and no data, using the existing `HrScreens.test.tsx` gate cases.
  - Server-default ranges equal today's client defaults (`rangeFor`, `HistoryScreen` −13 days).
  - The linked-date window behavior in Review is unchanged.

### 6. Changing range, site or version blanks the screen to a spinner

- **Priority:** P2 · **Effort:** S–M · **Evidence:** inferred.
- **Where:**
  - `HrShared.tsx:101-102`: `HrQueryState` shows LOADING whenever `outcome === undefined`.
  - Convex `useQuery` returns `undefined` for new args. That affects `HistoryScreen.tsx:103-109`, `ReviewScreen.tsx:118-121` and `230`, and `PeriodDetailScreen.tsx:110-136`.
  - Native `<input type="date">` emits each valid intermediate year while typing (`HistoryScreen.tsx:73-90`), so the list blanks several times.
- **Journey:** A reviewer adjusts the range or site and loses the list, scroll position and context while the next answer loads. The same happens on every Finding 1 refresh.
- **Fix:**
  - Add `useRetainedQuery(ref, args, retainKey)`, which returns `{ outcome, updating }`. While new args load, it keeps the last settled outcome, but only if `retainKey` is unchanged. Use `identityKey` plus route entity (employee, period) as the key.
  - Render the retained outcome with `aria-busy`, a polite "Updating…" status and dimmed rows.
  - Debounce date-field changes by about 300 ms, or commit on blur and Enter.
- **Risks and safeguards:**
  - Never retain across identity, organization or permission changes (`HrAccessProvider` `identityKey`).
  - While `updating`, disable Close, Export and Revise in Period detail. Otherwise the retained view's `versionId` or `fingerprint` could act on the previous version.
  - Review decisions already use the detail query's own revision (`ReviewDetail.tsx:293`, `555`), so retained queue rows are only navigation.
- **Measure:** Count LOADING-state renders and layout shift (CLS) while changing the range 3 times in a Playwright trace. Before: 3 spinners. After: 0 spinners and 3 "updating" states.
- **Regression tests:**
  - Retained data is never shown after an `identityKey` change.
  - Export and close are disabled while updating.
  - The "updating" status is announced, using the a11y project.
  - Typing a year in the date input does not fire intermediate queries.

### 7. Today's "recent requests" panel costs up to 28+ sequential reads of full correction documents

- **Priority:** P2 · **Effort:** S · **Evidence:** inferred.
- **Where:** `self.ts:210-233`. For up to 14 dates, it runs `dayOf`, then `dayCorrections` (`take(21,"desc")`, plus a `get` for the pending request, `dayDetail.ts:33-57`). Each correction carries a `history` array of up to 200 entries (`self.ts:58`).
- **Journey:** It runs on every Today load and on every Today re-run, for example after a clock event.
- **Fix:**
  - Use one read on `hrCorrectionRequests.by_orgId_employeeId_businessDate` with equality `employeeId`, `take(50,"desc")`. This works with today's API.
  - Keep dates in `[today−13, today]`, take the max `submittedAt` per date, and stop after 5 dates.
  - If 50 rows come back, fewer than 5 dates were found, and the oldest row is still inside the window, fall back to the current loop so the result stays exact.
- **Risks and safeguards:**
  - Corrections always belong to a day (`ensureDay` runs before insert, `self.ts:603-604`), so the result is equivalent.
  - Keep the latest-by-`submittedAt` rule, including pending requests.
  - Future-dated corrections are refused (`self.ts:559-560`).
- **Measure:** Use the read-count fixture on a seed with 14 days of attendance and 6 corrections, including one resubmission. Before: about 28–42 reads. After: 1.
- **Regression tests:**
  - The list equals the old algorithm over seeds with resubmitted, returned-then-new and pending-old corrections.
  - At most 5 items, newest date first.

### 8. Period detail: 50 sequential version lookups, and full draft rows shipped on every re-run

- **Priority:** P2 · **Effort:** (a) S, (b) M · **Evidence:** inferred.
- **Where:**
  - (a) `periods.ts:106-118`: `recentVersions` loops `versionNumbered` (an exact `unique`) from `latestClosedVersion` down to 50 versions.
  - (b) `periods.ts:305-340`: a draft preview returns every row, up to `MAX_PERIOD_EMPLOYEES` (50) × 31 = 1,550 (`period.ts:33-34`), and recomputes `sha256` over them (`periods.ts:100-103`) on every re-run. The client uses rows only to summarize per employee (`PeriodDetailScreen.tsx:177-198`, `798`), to list at most 200 open rows (`886`), and to find `firstOpen` (`573`).
- **Journey:** Opening a period or switching version. In a draft, any clock event at the site within the period re-sends the full row set to every viewer.
- **Fix:**
  - (a) Use `byIndex("hrPeriodVersions","by_orgId_periodId_version",[{periodId}]).take(MAX_VERSIONS,"desc")`. Versions are numbered 1…latest without gaps and drafts have no version row, so the set is identical.
  - (b) Return `employeeSummaries` (about 50), `openRows` (the first 200 plus `openTotal`), `firstOpen`, totals, blocker and fingerprint. Do the same for closed views. Keep computing the fingerprint over all rows on the server.
  - Show "200 of N" when `openTotal > 200`. Today the list cuts at 200 silently (`PeriodDetailScreen.tsx:886`).
- **Risks and safeguards:**
  - Close still recomputes rows on the server and requires the fingerprint (`periods.ts:473-488`), and export reads frozen rows on the server, so correctness does not depend on the payload.
  - Keep the per-employee summary math identical, including `days` counting every row.
- **Measure:**
  - (a) Read count with 50 versions: 50 reads before, 1 after.
  - (b) Measure the WebSocket payload size of `hr/periods:preview` for a 50 × 31 draft in DevTools. Expect a reduction from about 1,550 rows to about 250 objects. Also measure React commit time for `PeriodView`.
- **Regression tests:**
  - The version selector lists the same versions.
  - Summary totals match the old client `summarize`.
  - Open-row cap text appears.
  - Close and export flows in `PeriodsScreen.guard.test.tsx` and the HR integration suites stay unchanged.

### 9. AI Search pays 2–5 s of provider latency for queries the local matcher already resolves

- **Priority:** P2 · **Effort:** S–M · **Evidence:** measured provider latency in `output/global-search/root-live-eval-shipped.json` (p50 2.617 s, p95 4.595 s). The local-resolution share is inferred.
- **Where:**
  - In AI mode, Enter calls `ask()` whenever no result is active (`SearchDialog.tsx:197-203`, `223-232`, `247`).
  - `useAiSearch.run` always awaits `interpret` and then one protected lookup (`useAiSearch.ts:125-180`).
  - 16 of the 60 eval queries (27%) are plain page or section navigation, for example "เปิดหน้าลงเวลา", "ตั้งวันหยุด" and "open my attendance history", with OPEN_PAGE median 3.27 s.
- **Journey:** An AI-mode user asks for a page, waits about 3 s, and spends one of 20 quota slots.
- **Fix:** Before calling `interpret`, pre-resolve conservatively on the client. Navigate locally only when all of these hold:
  - `matchDestinations` returns exactly one destination at exact-label or exact-alias score (100 or 90).
  - `recordQuery` finds no text, codes, day or range.
  - No page context is in use.

  Otherwise call the model as today. Show "Opened without AI" so it is transparent. Optionally, run the existing exact-code lookup concurrently with the provider call when the text contains an explicit code. Use the result only if the grounded intent names the same code, which saves one post-AI round trip.

- **Risks and safeguards:**
  - Misrouting is the risk, so start strict (exact matches only).
  - Never short-circuit CLARIFY/UNSUPPORTED-looking text (verbs such as "approve", "อนุมัติ", "ลบ").
  - The model and grounding stay unchanged for everything else, which preserves Thai/English quality.
- **Measure:**
  - Replay the 60 cases from `output/global-search/root-eval-cases.json` through the pre-resolver offline. Report the short-circuit count and agreement with `expectedIntent`/page.
  - Require 100% agreement on short-circuited cases and 0 short-circuits on CLARIFY/UNSUPPORTED cases.
  - Then measure end-to-end time-to-navigate in Playwright for 5 page queries.
- **Regression tests:** A pre-resolver unit table covering Thai, English and mixed text, typos, and destructive verbs. `resolveIntent.test.ts` stays unchanged. Quota is not consumed when the pre-resolver navigates (assert in an action test).

### 10. HR admins run two near-identical scans of up to 400 employees for every settled name query

- **Priority:** P3 · **Effort:** M · **Evidence:** inferred.
- **Where:**
  - `results.tsx:303-310` subscribes to both `searchReviewEmployees` and `searchAdminEmployees` when the member holds both permissions. `HR_ADMIN` holds all HR codes (`permissions.ts:59-60`, `90-93`).
  - For an admin, `reviewEmployees` uses `adminCandidates` (`search.ts:259`), the same per-site loop as `adminEmployees` (`search.ts:161-182`, `297`).
  - Site reads are sequential (`search.ts:85-93`, `168-181`).
- **Journey:** Every pause while an HR admin types a name pays two authorizations, two site lists and up to about 800 employee reads, plus two reactive subscriptions.
- **Fix:**
  - Add one `searchEmployeeTargets` query that scans once and returns per-hit `{ reviewable, editable }` flags. Compute each flag with its existing rule: `reviewBlocker` for review, and in-scope plus active site for edit (`search.ts:288-296`). Gate each flag with `holds(ctx, code)`.
  - Keep the two existing queries for AI lookups, or route AI through the same function.
  - Use `Promise.all` for the per-site reads.
- **Risks and safeguards:**
  - The two sets differ by design: review includes in-scope inactive sites and excludes self. Add an equivalence test between old and new outputs for supervisor-only, admin-only and both roles.
  - The wrapper takes one `permissionCode`. Bind the query to `teamReview` OR `adminManage` only if `queryWithOrg` supports it. Otherwise, bind it to `selfAccess` and compute each flag with `holds()`. That needs a security review.
- **Measure:** Read count for an admin with 3 sites × 99 employees, query "สม": roughly 2× before, 1× after. Measure end-to-end time to records-ready with Playwright.
- **Regression tests:** The `global-search.integration.test.ts` scope cases (self excluded, inactive site, supervisor-only) must give the same visible results and links.

### 11. Search dialog and AI code ship in every desktop route's initial JavaScript

- **Priority:** P3 · **Effort:** S · **Evidence:** stale build artifact (see Measurement status). Current size not measured.
- **Where:**
  - `GlobalSearchProvider.tsx:27` statically imports `SearchDialog`, which pulls in `results.tsx`, `useAiSearch.ts`, `resolveIntent.ts` and `recordQuery.ts`, plus `references.ts`/`dates.ts`.
  - `c-sidebar-2.tsx:30` and `77` mount the provider for all shell routes.
  - The 2026-10-09 build puts `427q6jcwqas40.js` (17.8 KB gzip) in all 29 desktop routes.
- **Fix:**
  - Keep `SearchDialog`, `DialogContent` and the input eager, so focus handling at `SearchDialog.tsx:97-113` keeps working.
  - Load the result and AI parts with a top-level `next/dynamic` declaration (`lazy-loading.md:22-39`, `239`).
  - Preload on idle after first paint, on trigger `pointerenter`/`focus`, and on the ⌘K keydown. The first open is then warm.
- **Risks and safeguards:**
  - First-open latency must not regress, so the trigger preloads before the click.
  - The `SearchDialogFocus.test.tsx` focus-return cases must pass unchanged.
  - The static matcher must be available as soon as the user types (see Finding 4).
- **Measure:** Rebuild and compare per-route first-load JS for `/th/hr/today` and `/th/finished-goods`. Measure dialog open-to-input-ready and first-results time in Playwright under CPU 4× slowdown.
- **Regression tests:** Existing focus and keyboard tests. Add a test that typing immediately after ⌘K is not lost while the chunk loads.

### 12. Employee registry: N+1 member lookups and a duplicated responsive DOM

- **Priority:** P3 · **Effort:** S · **Evidence:** inferred. Only matters at larger scale.
- **Where:**
  - `setup.ts:89-98` loops sites and employees serially, and `employeeItem` (`setup.ts:44-73`) calls `ctx.members.get` (membership index read plus user `get`, `memberDirectory.ts:54-64`) and `memberName` for each employee.
  - The bound is `MAX_SCOPE_SITES` (50) × `MAX_SITE_EMPLOYEES` (99) = 4,950 (`shared.ts:36-37`).
  - `EmployeesScreen.tsx:180-187` renders both the desktop table and the mobile card list and hides one with CSS.
- **Fix:**
  - Run `Promise.all` per site.
  - Cache `members.get` per user within the request, the way `memberName`'s `names` map already does.
  - Folding the `Date.now()` removal from Finding 1 into `memberDirectory` makes this query cacheable.
  - For the DOM, either keep it until sizes justify a change, or render the card list only below `lg` with a hydration-safe media hook (`useSyncExternalStore` with a server snapshot), accepting a one-frame swap.
- **Risks and safeguards:** Avoid a layout flash on hydration. Prefer to leave the DOM as is unless profiling at 300+ employees shows a real cost.
- **Measure:** Read count and execution time for `listEmployees` at 1 × 99 and 3 × 99. React Profiler commit time for `EmployeesScreen` at 300 rows.
- **Regression tests:** Registry output is unchanged, including `linkedActive` with future or expiring memberships, which must still use the real clock.

---

## Ranked top 3

1. **Finding 4, search Enter and menu debounce.** Small effort, and every search use is faster. It also fixes Enter being ignored silently.
2. **Finding 1, refresh boundaries and `Date.now()` hygiene.** Fixes wrong Clock-out, date and "yesterday" states in long-lived tabs and restores Convex query-cache reuse, without polling.
3. **Finding 3 with Finding 2, tenant range reads.** Bounds clock-in cost against period history and cuts queue, history and preview from about 62–93 sequential reads to 2–3.

## Dependencies

- Finding 3's range API is a prerequisite for Finding 2 and for its own loader rewrites (queue, history, preview), and it lowers 8(b) re-run cost. It needs a security review of `tenantDb`.
- Finding 6 should land before or with Finding 1, so boundary refreshes and arg changes do not flash spinners. Finding 5's server-default ranges also benefit from Finding 6.
- Finding 2 depends on a read-only production overlap check and an invariant test before mutations switch.
- Finding 4 should land before Finding 11, because lazy loading must not delay the local matcher.
- Finding 9 reuses `matchDestinations` and `recordQuery`. It is independent of the backend work.
- Findings 7, 8(a), 10 and 12 are independent.

## Recommendations to reject (they trade away UX or correctness)

- **Polling Today, Review or access every N seconds.** It wastes reads and still lags. Use server `refreshAt` boundaries (Finding 1).
- **Trusting client time to compute attendance state, business dates or locks,** or sending client `now` into mutations. The `asOf` argument in Finding 1 is a cache key only.
- **Optimistic "clock-in saved" UI before the server answers.** It breaks the SAVED/REFUSED/UNCERTAIN contract in `useHrWrite.ts`.
- **Removing the stale-result guard so Enter opens whatever is on screen.** Finding 4 relaxes it only for results that cannot be displaced.
- **Raising the debounce or lowering `MAX_SEARCH_RESULTS`/`MAX_NAME_SCAN` to save reads.** Users see slower or less complete results. Also reject truncating names, stripping Thai vowels or tone marks, or prefix-only name matching (`text.ts:4-8`).
- **Caching or retaining search or HR results across `identityKey`, organization or grant changes.**
- **Switching the AI to a cheaper or faster model, or lowering `reasoning` below `low`, without re-running the Thai eval.** Also reject auto-navigating on AI name matches or inferred years.
- **Generating CSV on the client from preview rows.** It bypasses the audited export mutation.
- **Paginating or silently capping the queue or period draft** so `complete`, limits or close readiness stop being visible. Also reject materializing an exception queue table now: freshness and complexity risk with no measured need. Revisit after Finding 3 is measured.
