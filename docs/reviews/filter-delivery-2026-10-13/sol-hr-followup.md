# Sol HR follow-up audit: history stacks, selectors and detail semantics

October 13, 2026. Read-only source/test review of `/Users/macbook/Development/industrial-sas-filter-hr`, first implementation pass based on `11c8c2cc`, while Kiro's known-fix follow-up was running. No product edits, browser, production calls or commits. This report deliberately excludes the already assigned site51, reset/stall recovery, updating-row interaction, older day/version and holiday-range fixes. Existing baseline behavior is identified as such; none of these findings is a claimed permission bypass.

## P1 — Restored cursor stacks do not restore pinned/unread criteria

`AnnouncementsScreen.tsx:133` initializes `pinnedOnly` with `useState(false)`; `NotificationsScreen.tsx:59` does the same for `unreadOnly`. Both pass those local flags into the new `useHrCursorStack`. The hook correctly refuses saved cursors for a different criteria fingerprint, but the **screens** never restore the flag. Therefore a filtered page2 → record detail → Back/remount, or a refresh, requests the unfiltered first page. The saved filtered stack is not usable because the caller supplies false after remount.

The local flags existed before this change. The new delivery now explicitly claims criteria/position restoration for history-backed lists; this is a remaining delivery-contract gap, not a new backend security issue. `HrPagination.test.tsx` currently remounts the hook with the same hard-coded `unreadOnly:false` argument; it does not drive the actual screen's checkbox/remount path.

Minimal fix: persist these flags with the screen's list criteria, using URL parameters or scoped history metadata that restores on remount/popstate. Change the criteria and stack coherently. Do not rely on the stack hook to infer a filter from an arbitrary cursor.

Meaningful regression recipe: render `HrAnnouncementsScreen`, check Pinned only, navigate to its second cursor page, open a visible announcement, return/remount with the same history entry, and assert the checkbox remains checked and the final query contains `pinnedOnly:true` plus the saved second-page cursor. Repeat after refresh and for notifications with `unreadOnly:true`. Back/Forward between filtered and unfiltered entries must restore each entry's correct flag/page. The recipe is source-established and was not executed as a new screen test in this audit.

## P2 — Independent selector/list scopes share only one persisted page slot

The account and supervisor selectors use distinct surfaces (`EmployeeForm.tsx:314,335`, with `:account` and `:supervisor`), so their in-memory cursor states are independent. However all new `useHrPagedQuery` calls delegate to existing `useCursorPagination`, which saves only `window.history.state.cataloguePagination = {scope,value}` (`useCursorPagination.ts:96`). `remembered()` uses the module's `positions` map for every other scope. Paging account/supervisor/history therefore overwrites the persisted employee-list/other-selector page even though those lists are mounted together.

Same-session remount can succeed through the map; a cold refresh/restart cannot reconstruct the overwritten scope. This is a shared-hook baseline limitation newly exercised by the two concurrent selectors; it is not cross-tenant data exposure. For an employee list at page2, opening its editor and paging the member selector causes refresh to lose the employee-list position even though its URL criteria survive. Two paged selectors also cannot both restore their blank-search page positions after cold refresh.

Minimal fix: store bounded cursor positions in history metadata by scope, while accepting the existing single-slot format for compatibility; preserve the existing scope/cursor limits and eviction behavior. Alternatively adapt HR's simultaneous pagers to an equivalent bounded per-scope history map. The account/supervisor scopes are already distinct; adding more scope names does not repair a single persisted slot.

Meaningful regression recipe: on `HrEmployeesScreen`, reach list page2, open an employee, advance account picker to page2 and supervisor picker to page3, and preserve a copy of browser history state. Simulate a cold application/module restart **without clearing that state**; restore the screen and assert the list/account/supervisor queries use all three saved cursors independently. A mere unmount/remount with the module-level map intact misses the defect. Also verify selector pagination preserves edited employee name/code/schedule and closing the editor returns to the original list criteria/page.

The source proves the single-slot overwrite; this audit did not run a cold-module combined-screen test. Persisting all scopes may intentionally preserve only a bounded number; tests must distinguish documented eviction from accidental overwrite.

## P2 — Bounded stack truncation makes Previous jump across missing pages

`useHrCursorStack` keeps `next.slice(-MAX_STACK)` with `MAX_STACK=500` (`HrPagedList.tsx:448,508`), while all callers determine Previous availability solely from `cursors.length`. After 501 Next positions, the oldest saved cursor (page2) is dropped. Repeated Previous reaches the oldest retained cursor (page3); one more Previous removes it and queries with no cursor, jumping directly to page1. There is no indication that page2 was skipped, no offset/truncated flag, and no explicit return-to-first action.

This is caused by the new bounded stack, unlike the original unbounded component `useState` stacks. It does not lose backend records permanently—forward traversal from page1 can reach them—but it breaks predictable backward traversal at a normal long-history boundary. The existing shared `useCursorPagination` separately models truncation and explicit first-page recovery; the new stack should use an equivalent contract.

Minimal fix: retain truncation/offset metadata or an explicit floor cursor/sentinel, stop Previous at the oldest retained page, and offer a clearly labelled return-to-first action. Do not turn a missing prior cursor into an implicit first-page Previous jump.

Meaningful regression recipe: seed a stack with page2 through page502 using the actual hook, assert its 500-entry bound, walk Previous to page3, and confirm another Previous cannot silently query page1 as the preceding page. Verify explicit First recovers and Back/refresh retain truncation state. A smaller configurable test budget is acceptable if it exercises the same bound behavior, rather than repeating `slice` in a test.

## Positive source findings / boundaries

- `useHrCursorStack` scopes history by organization/actor/linked employee, surface and criteria, preserves other stack entries when saving, and listens to popstate. Independent **stack** surfaces (for example announcement management and receipts) do not overwrite each other. For stable criteria it can restore the current cursor after remount; the filter-caller issue above remains separate.
- Backend member search matches normalized NFC/case-insensitive display names across the membership index before logical page readiness. Active/effective membership checks use the current organization directory; selected member IDs and linkage/supervisor authorization are revalidated on employee save. No first200-member cap remains in the new selector endpoint.
- Account/supervisor selectors keep an off-page selected ID/name through `known` and the `chosen` cache. Searches and page changes do not clear draft values. Account linkage restrictions remain visible/disabled, out-of-scope employee linkage metadata stays hidden, and client validation catches choosing one's own linked account as supervisor.
- Employee forms keep draft state above both selector components. `navigationKey` excludes list q/site/status fields, so typing list criteria does not reset the editor URL state/focus token. Editor form keys remain employee ID/version; exact editor queries and saves are independent of list membership. Close preserves list criteria and deliberately discards the editor before navigation; no new draft-loss path was established in that reviewed flow.
- Period UI locally slices only the finite employee/exception presentation. The complete preview rows/fingerprint still feed totals and close validation. Administrative frozen CSV export remains server-generated by exact version ID from all frozen rows; personal frozen export uses the complete ≤31 owned-day detail. No page-only export or close was found.
- Paged history/read-only presentation is separate from finite resubmission/snapshot drafts; no form submission was changed to submit only currently visible selector/table rows.

## Extension to the already assigned updating-row fix

`MemberPickerField` is not nested inside `HrPagedState`. It passes only `pending={view.kind === "loading"}` to `SelectField` (`EmployeeForm.tsx:609`). A retained `kind:"ready", updating:true` page leaves the account/supervisor select enabled even if `HrPagedState` itself becomes inert. Ensure the **existing** updating-row follow-up includes these selectors, by treating retained updating results as disabled/pending. This is coverage of the pending fix, not a duplicate new P1.

## Verification run and limits

Executed in the HR worker:

```sh
pnpm exec vitest run src/features/hr/HrPagination.test.tsx src/features/hr/EmployeeForm.memberScope.test.tsx tests/integration/hr-pagination.integration.test.ts
```

Result: **3 files, 25 tests passed**, 2.88s. These exercise the current pagination/contains/employee authorization and selected-label scenarios. They do not exercise actual screen-local pinned/unread restoration, simultaneous pagers after cold restart, or the 500-entry truncation boundary. Passing them does not resolve the findings above. Full integrated review and live browser verification remain later gates owned by the parent.
