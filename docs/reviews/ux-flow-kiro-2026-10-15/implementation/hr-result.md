# HR implementation result — K-UX-HR-01…05

Worktree: `/Users/macbook/Development/industrial-sas-ux-flow-20261015-hr`, base `origin/main` `faca0cf5927dbe3e72da572cf1290d57d7d91511`. Changes are uncommitted for Codex review. No browser, server, seed, deployment, credential or production command was run. No browser behaviour is claimed.

## Revalidation on current source

The parent's probes were copied to a temporary directory (later deleted). Their import depth was adjusted, and they were run against the unmodified tree first: K-UX-HR-01, 02 (both live cases), 03 (History) and 04 (both cases) still reproduced. Current `memberOptions` returns `linked`, but still no access state. The Requests part of K-UX-HR-03 was already fixed: status/from/to/text are URL criteria (`useHrListCriteria`) and the page cursor lives in history metadata (`useCursorPagination`).

## Findings

| ID         | Result                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-UX-HR-01 | Fixed (display + handoff, no grants)  | `employeeItem` (`employeesPage`, `employee`, `listEmployees`; all `hr.admin.manage`) now returns `linkedSelfAccess` / `supervisorReviewAccess` (`false` = an active member's active roles lack `hr.self.access` / `hr.team.review`; omitted for unlinked/inactive). The rule mirrors `grantedPermissionsAmong`. Rows show "No HR self-service access" / "No HR review access". The save receipt names each member and links to the existing `/hr/settings?section=access&mq=<name>`. The account hint says that HR access is granted separately. `saveEmployee` and `setMemberAccess` are unchanged, so nothing is granted automatically. HR admins already see every active member's HR roles in Settings, so the flags expose no new data. |
| K-UX-HR-02 | Fixed                                 | `DecisionArea` owns a `receipt` state (Certified / Returned + "The employee can correct the request and send it again." / Decision saved). It is a role=status Notice above the next state (Nothing to decide, or the missing clock-out disposition), so the confirmation survives the decision's own live update. A newer pending correction, or the resubmitted version, clears it. Child forms pass `saved={null}` to avoid duplicates. The existing retry, stale and held-draft behaviour is unchanged.                                                                                                                                                                                                                                  |
| K-UX-HR-03 | History fixed; Requests already fixed | History month/range/status moved from `useState` to `useHrListCriteria` (`from`, `to`, `status`). Malformed URL ranges fall back to the current month; the server still validates ranges. Requests needed no code change; a new caller test proves it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| K-UX-HR-04 | Fixed (no prefill change)             | The resubmission form now shows a warning Notice ahead of the time fields: "Returned for changes", the return reason (`decisionReason`, else the latest RETURNED history entry), and "Returned request: hh:mm – hh:mm". The fields still start from the original punches with an empty reason, as before.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| K-UX-HR-05 | Fixed (modest)                        | Saving closes the editor through the existing owned-entry closure. The list then shows a dismissible "Employee saved" receipt (role=status, name · code) that hosts the K-UX-HR-01 handoff. It adds no history entry; opening another editor replaces it, and Cancel does not restore it.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Files

- `convex/hr/setup.ts`
- `src/features/hr/{EmployeeForm,EmployeesScreen,ReviewDetail,HistoryScreen,CorrectionForm}.tsx`
- `messages/en.json`, `messages/th.json`. New keys: `Hr.employees.{noSelfAccess,noReviewAccess,savedTitle,dismiss,accessMissingTitle,accessMissingSelf,accessMissingReview,grantAccess}`, `Hr.review.{disposed,returnedHint}`, `Hr.correction.{returnedTitle,returnedProposal}`. `Hr.employees.accountHint` was extended.
- `docs/contracts/back-navigation.json`:
  - Removed the stale `HistoryContent:range` and `HistorySummary:filter` (now URL criteria).
  - Re-audited render targets for `CorrectionForm:loadedReturn` (new Notice), `DecisionArea:action` and `CorrectionDecision:loaded` (dropped `p[role=status]`).
  - Added presentation entries `DecisionArea:receipt` and `EmployeesContent:receipt`.
  - Added the new caller cases to the `/hr/time` and `/hr/requests` route entries.
- Tests:
  - New: `tests/integration/hr-employee-access-handoff.integration.test.ts`, `src/features/hr/HrListReturn.test.tsx`.
  - Extended: `src/features/hr/HrLiveDayDrafts.test.tsx`, `src/features/hr/EmployeesNavigation.test.tsx`.

## Tests (production callers/handlers)

- Backend, real registered handlers in convex-test: "reports a linked account and supervisor without HR roles until Settings grants them" and "omits access facts for an unlinked employee and never exposes them to the employee". The first **fails with `setup.ts` reverted**.
- Review, simulating the Convex order of query transition, then mutation resolution: five cases (Return on a complete day, Return on a missing clock-out, Certify, disposition, resubmission clears the receipt). All five **fail with `ReviewDetail.tsx` reverted**.
- History/Requests (`HrListReturn.test.tsx`): a pathname-keyed route stand-in remounts the screens, and a Link mock pushes real history entries. Cases: History month+status → Day → native Back → Forward (en and th, unrelated query/hash kept); a direct link plus malformed-range fallback; Requests status + older page → request → native Back. The three History cases **fail with `HistoryScreen.tsx` reverted**. The Requests case passes on the original code, which is the evidence that it was already fixed.
- Resubmission: reason and returned proposal shown before the fields with no prefill; history fallback; no notice for a new request.
- Employees (en and th): save → owned entry consumed, list URL/hash restored, receipt and Settings links, next native Back reaches the caller; receipt replaced by the next editor, with no handoff when access exists.

## Checks run

- `pnpm check:navigation`: 68/68 fixtures; contract OK (58 routes, 293 owners, 26 actions).
- `pnpm lint`, `pnpm format:check` and `pnpm typecheck:ts6` all passed.
- `pnpm test`: 369 files, 4872 tests passed.
- The pinned-Bun `pnpm typecheck` was not run; it is left to the parent.

## Limitations

- Nothing was browser-verified; the parent should check the Employees receipt and the Settings link, the Review receipt after a real Convex round-trip, and History Back in the T3 browser.
- The access flags check role permissions only. A warehouse-scoped supervisor without that site's warehouse grant still cannot review, and the flag does not report that.
- The member picker inside the editor does not warn on selection; the warning appears on the list rows and in the post-save receipt.
- Prefilling the resubmission from the returned proposal was deliberately not done (product decision). The parent's original `hr-resubmit` "starts from the returned proposal" probe therefore still fails by design.
- The parent's original K-UX-HR-02 probe regex (`/\bReturned\b/` over concatenated textContent "ReturnedThe employee…") does not match the new title+body Notice, although "Returned" is shown. Use the new caller tests instead. The original History probe's precondition `search === ""` intentionally no longer holds.
- Rendering in tests used jsdom with mocked Convex and a router stand-in, not App Router.
