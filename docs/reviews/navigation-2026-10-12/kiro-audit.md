# Navigation audit: industrial-sas (read-only, Kiro, 2026-10-12)

## Scope and method

- Read `AGENTS.md` and Next 16.3.8 docs (`01-app/01-getting-started/04-linking-and-navigating.md`), plus the Next client router source used here (`next/dist/client/components/app-router.js`, `segment-cache/navigation.js`, `app-dir/link.js`, the reducers).
- Nothing in the repository was edited, committed or pushed. I started no browsers or servers and changed no environment.
- Harness: `/private/tmp/nav-audit`. It runs the real app modules from two snapshots taken outside the repo:
  - `head/`: `git archive HEAD` (733c6aca).
  - `wt/`: a working-tree copy taken at 20:30:52. Its `git status --porcelain` hash was `28de8193…`.
- Run it with:

  ```
  SRC=head|wt WITH_PROVIDER=0|1 node node_modules/vitest/vitest.mjs run --config ./vitest.config.mts
  ```

  The vitest cache lives in `/tmp`.

- How the tests are written: each test asserts the defect. "Pass" means the defect reproduces. "Fail" means it does not reproduce in that tree.
- What is real and what is a model:
  - Real: React, jsdom session history, and the app's `NavigationProgress`, `navigationClient`, `useNavigationGuard`, `PageBackButton` and `useGuardedUrl`.
  - Modelled: Next's router, built from source. On commit, `HistoryUpdater` writes `{__NA, __PRIVATE_NEXTJS_INTERNALS_TREE}` (app-router.js:50-66). Custom state is dropped because `preserveCustomHistoryState:false` (navigation.js:459-462). On popstate, Next returns when `!event.state` (app-router.js:284-288).
- Other sessions edited the working tree during the audit. They changed `NavigationProgress.tsx`, `appHistory.ts`, `history.ts`, `useNavigationGuard.tsx`, HR screens and `tsconfig.json`. A `next-server` on port 3110, owned by another session, was running; I did not touch it. Results are reported against both snapshots.
- Baseline: the existing navigation tests pass on both trees (HEAD 77/77, wt 86/86). They cover NavigationProgress, useNavigationGuard, PageBackButton, DraftGuardProvider, LocaleSwitcher, history, useCatalogueState and useCursorPagination. None of them catch D4 or D5.

## Confirmed defects

### D1. Back/Forward leaves a stale destination, and later navigations stay on the loader (HEAD; fixed in wt)

- Where: `src/components/system/NavigationProgress.tsx` (HEAD):
  - :43-44 `historyPending = dest !== null && dest !== pathname`
  - :86-92 popstate sets `dest`
  - :59-62 `prepare` never clears it
- Trigger:
  1. Link A → B.
  2. Browser Back to A completes. `dest` stays `"A"`.
  3. Click any Link to C.
- Result: `R4`. On HEAD, after C commits, `RouteLoading` stays up and the page is `hidden`. It stays that way until the next popstate or a return to A.
- Status: in wt, a render-phase clear and `prepare()` clear the destination, and R4 no longer reproduces.
- Fix: already present in wt. Keep it, and add R4 as a regression test.

### D2. A same-URL navigation erases `appNavigationIndex`, so in-app Back goes to the parent instead (HEAD; fixed in wt)

- Where:
  - HEAD `NavigationProgress.tsx:66-80`: the index is written only when `[pathname, locationKey]` changes.
  - `src/components/ui/PageBackButton.tsx:20-21`.
- Trigger:
  1. Navigate to a page that has a Back button, e.g. `/master-data/storage-layouts`.
  2. Click its active sidebar item again (repeated navigation). Next does not short-circuit a same-URL click (`link.js:51-88`). It refreshes, and `replaceState` drops the custom keys.
- Result: `R2`. On HEAD, the state becomes `{__NA, tree}` with no index. The in-app Back button then calls `router.replace("/")` instead of `router.back()`.
- Status: wt's `trackAppHistory` (`appHistory.ts`) re-attaches the index, and R2 no longer reproduces.
- Fix: in wt. Add R2 as a regression test.

### D3. A same-URL navigation while a draft is dirty erases the guard buffer marker; Back → Discard does nothing (HEAD; fixed in wt when the shell provider is mounted)

- Where: `src/components/system/useNavigationGuard.tsx` (HEAD line numbers):
  - :209-213 a same path+search click is not intercepted.
  - :160 the restore check needs `state.__storageWorkspaceGuard === id`.
  - :178 `forward()`.
  - :122-125 `removeBuffer` is deferred forever while `restoring`.
- Trigger:
  1. A DraftGuard form is dirty (for example HR Settings).
  2. Click the active sidebar link. Next's same-URL `replaceState` drops the marker from the buffer entry.
  3. Press Back. The prompt appears.
  4. Choose Discard.
- Result: `R1`. On HEAD:
  - The dialog closes and the draft is discarded, but the page stays on `/en/hr/settings`.
  - The next Back lands on the same URL again.
  - Only the second extra Back reaches the previous page.
  - Control (no same-URL click): Discard reaches `/en/hr/today`.
  - With `SRC=wt WITH_PROVIDER=1`, the marker survives because `trackedReplace` merges state for same-URL replaces. R1 does not reproduce.
- Note: the hook alone (`WITH_PROVIDER=0`) still reproduces in wt, so the fix depends on `NavigationProgressProvider` wrapping history.
- Fix: in wt. Either make the guard self-sufficient (re-stamp its key in `onPopState` instead of requiring it), or keep the dependency and add R1 with the provider as a test.

### D4. Back onto a native hash entry leaves RouteLoading up permanently and hides the page (HEAD and wt)

- Where:
  - The skip link `<a href="#main-content">` at `src/components/examples/c-sidebar-2.tsx:106-111`. It creates a fragment entry with null state.
  - `NavigationProgress.tsx` (wt:76-83, HEAD:86-92). On any popstate whose pathname differs, it sets a pending destination.
  - Next ignores popstate when there is no state (`app-router.js:284-288`), so the route never commits.
- Trigger:
  1. On `/en/finished-goods`, activate "Skip to content". The entry is now `#main-content` with null state.
  2. Click a Link to `/en/finished-goods/scan`.
  3. Press browser Back.
- Result: `R3`, on both trees:
  - The URL is `/en/finished-goods#main-content`, but the router still shows `/scan`.
  - `[role=status][aria-busy=true]` is shown and the page is `hidden`. It is still stuck after 1.5 s. The in-page Back button is hidden too.
  - A second Back recovers.
- Fix (scoped):
  - (a) In `onHistory`, set no destination when `!event.state?.__NA`. Next will not traverse for such entries, or it reloads.
  - (b) Make the skip link `preventDefault()` and focus `#main-content`, so it creates no history entry.

### D5. A query-only record selection blanks the whole page until the RSC response (HEAD and wt)

- Where:
  - `src/lib/deepLink.ts:39-47`: `useGuardedUrl` calls `router.push(href, {scroll:false})`.
  - `src/i18n/navigationClient.tsx:49-60`: the wrapper puts every push or replace in the provider's `useTransition`.
  - `NavigationProgress.tsx`, `NavigationContent` (wt:101-108): `hidden={pending}`.
  - Callers: `ReviewScreen.tsx:82`, `EmployeesScreen.tsx:68`, `PeriodDetailScreen.tsx:96`.
- Trigger: select a row in HR Review, Employees or Period detail (for example `?employee=…&date=…`). The pathname does not change. A new search string is a new page segment, so Next needs a dynamic response. No `loading.tsx` sits below `(desktop)`, so the transition stays pending until the response arrives.
- Result: `R5`, on both trees. While the response is pending, the queue/list is hidden and `RouteLoading` is shown. Both clear after the response. The popstate path in the same file deliberately shows no loader for query-only changes ("Query-only navigation is already synchronous").
- Effect: every repeated selection costs a full-page skeleton for the full server round-trip, which matches "repeated navigation loads". The ~10 s duration itself was not measured.
- Fix (scoped): in the wrapper, call the base router directly, without the provider transition, when the target pathname equals the current one. Alternatively, use `run` only for pathname changes. Next's own transition then keeps the current UI visible.

## Uncertain leads (not accepted as defects)

### L1. Save → `router.push` races the guard's buffer removal

- Repro: `R6`, with jsdom semantics only.
- Where:
  - `useAsyncOperation.ts:54-79`: `router.push` runs inside `run`, and `setBusy(false)` runs in `finally`.
  - `useDraftGuard(..., op.busy)`: `ProductScreen.tsx:260/301`, `PalletScreens.tsx:324/390`, `PeriodsScreen.tsx:204/225`.
  - `useNavigationGuard.tsx` wt:253-258 → `removeBuffer` → `history.back()` (:135).
- Sequence: a pending save arms a buffer entry. On success, pending clears, and `removeBuffer` calls an async `history.back()` while Next commits the push.
- jsdom result: `pushState` cancels the queued traversal. The buffer entry stays, and `removing` is stuck at `true`. The user's next Back from the destination is swallowed by `stopImmediatePropagation`: the URL becomes the form page, the router still shows the destination, and Next sees no popstate.
- Not verified: the ordering and cancellation in real browsers. If the traversal runs after the push instead, the URL and content still diverge. A fast prefetched destination makes this more likely, and wt sets `prefetch={true}` on sidebar links.
- Suggestion: navigate after pending clears, through `guardedNavigate` (`removeBuffer(action)` orders back → popstate → push). Or reset `removing` when another history write happens before its popstate.

### L2. ~10 s navigations (server side)

- Not measured. I started no server and did not use another session's server.
- Candidates:
  - `pnpm dev` uses `next dev --webpack`, with on-demand compiles and no prefetch in dev.
  - `(desktop)/layout.tsx` is dynamic (`auth()` and `headers()`) on every RSC request through Clerk and next-intl proxy.
  - No `loading.tsx` below `(desktop)`. Next docs, "Dynamic routes without loading.tsx": navigations within a section wait for the full render, and D5 turns that wait into a blank page.
- Needed: a production-build timing (click → destination `h1`) in a browser.

### L3. Sidebar `prefetch={true}` (uncommitted change in `SidebarNavigationLink.tsx`)

Every visible menu item now does a full dynamic prefetch in production. The server cost and the effect on the contention behind the 10 s report were not measured.
