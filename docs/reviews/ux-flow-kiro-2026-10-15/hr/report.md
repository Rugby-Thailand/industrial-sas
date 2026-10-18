# HR UX flow review — Kiro, 15 October 2026

Reviewer: Kiro CLI, `claude-opus-5.5`, high effort. This review covered the current working tree, including uncommitted changes. It was discovery only. No application source, tests, config or translations were changed. No server, browser, seed or production command was run. The only files written are in this directory.

Evidence levels used below:

- **probe-backend:** real registered Convex handlers in convex-test.
- **probe-rendered:** production React components in jsdom.
- **source-traced:** read in source only.

Nothing in this report is browser-verified.

## Findings

| ID         | P   | Finding                                                                                                           | Evidence                                  | Novelty |
| ---------- | --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------- |
| K-UX-HR-01 | P2  | Linking an account/supervisor completes "setup" but grants no HR access, and the admin is never told              | probe-backend + source-traced UI          | new     |
| K-UX-HR-02 | P2  | Certify/Return confirmation is lost; after Return the reviewer sees "Account for this day" or "Nothing to decide" | probe-rendered + Convex client source     | new     |
| K-UX-HR-03 | P2* | Day → Back resets the History month/filter; request → Back resets the Requests status/page                        | probe-rendered remount + Next config/docs | new     |
| K-UX-HR-04 | P3  | The returned-request resubmission hides the return reason below the form and starts from the original punch       | probe-rendered                            | new     |
| K-UX-HR-05 | P3  | Saving an employee closes the editor with no confirmation                                                         | source-traced                             | new     |

\* K-UX-HR-03 is borderline P2/P3: there is no data loss, but every return breaks the earlier view the employee chose.

### K-UX-HR-01 — Employee setup misses the HR role step (P2)

**Who and trigger.**

1. An HR admin adds or edits an employee.
2. They choose a member under **Linked account** and another member under **Supervisor**, then save.
3. Neither member holds `HR_EMPLOYEE` or `HR_SUPERVISOR`. This is true of a newly invited member and of a member with only a planner role.

**Expected.** One of these:

- the linked member can use self-service and the supervisor can review; or
- the form or list says that access still has to be granted, ideally with a direct action.

**Actual.**

- The save succeeds and the list shows the account as linked.
- The employee sees "You do not have access to this page / Ask your organization's HR administrator for access" on HR pages.
- The supervisor cannot open Review.
- The admin's member options return only `userId` and `displayName`, so the form cannot warn. The grant lives only in Settings > HR access.

**Where.**

- Member options without access state: `convex/hr/setup.ts:194`, `:213`.
- The save neither grants nor checks a role: `convex/hr/setup.ts:237`.
- The access read requires `hr.self.access`: `convex/hr/access.ts:24`.
- Role definitions: `convex/lib/permissions.ts:78`.
- Form hint: `src/features/hr/EmployeeForm.tsx:335`.
- Supervisor options: `src/features/hr/EmployeeForm.tsx:251`.
- List account cell: `src/features/hr/EmployeesScreen.tsx:475`.
- Denial path: `src/components/providers/HrAccessProvider.tsx:60` → `src/features/hr/HrShared.tsx:46`.
- The demo seed grants `HR_EMPLOYEE` separately (`convex/staging/hrDemo.ts:169`), which hides this gap in fixtures.

**Cause.** Employee linkage and HR roles are independent records, and no step connects them.

**Smallest fix (product decision).**

- Preferred, if policy allows: auto-grant `HR_EMPLOYEE` on link and `HR_SUPERVISOR` on supervisor assignment.
- Otherwise: return an access flag with member options and the list, and show an inline warning with a "Grant self-service" action.

**Test needed.** An integration test for link → `access.current` / `review.queue`, plus a rendered missing-access state.

**Confidence.** High.

**Evidence.** `hr-setup.probe.ts`:

- Expected case fails with `{"saveWritten":true,"memberOptionKeys":["displayName","userId"],"employeeAccessOk":false,"employeeTodayOk":false,"supervisorQueueOk":false}`.
- The control passes: after `setMemberAccess` grants `HR_EMPLOYEE`, the same member's `access.current` succeeds.

### K-UX-HR-02 — Review decisions lose their confirmation and show a misleading next step (P2)

**Who and trigger.**

1. A reviewer opens a day with a pending correction.
2. They choose Return, enter a reason and select Confirm return. Certify and the disposition form behave the same way.

**Expected.** A persistent, announced confirmation, for example "Returned to employee", separated from any further action.

**Actual.** The decision form unmounts as soon as live data drops `pendingCorrectionId`, so "Returned"/"Certified" is never shown. What appears instead:

- If the day was otherwise complete: "Nothing on this day needs a decision." On desktop, the list also notes that the open day is not in the list.
- For a missing clock-out: "Account for this day" appears at once. It reads as if the return failed or still needs a disposition, even though the employee should now resubmit.
- Disposition: success is also lost, because its form key includes `detail.revision`.

**Where.**

- Render switch: `src/features/hr/ReviewDetail.tsx:103`, `:116`, `:123`, `:140`.
- Per-correction write and its saved feedback: `src/features/hr/ReviewDetail.tsx:274`, `:481`.
- Backend clears the pending correction: `convex/hr/review.ts:386`.
- The status falls back once no correction is pending: `convex/model/hr/attendance.ts:217`.
- The Convex client resolves a successful mutation only after the reflecting transition: `node_modules/convex/dist/esm/browser/sync/request_manager.js:100`.

**Cause.** The feedback lives inside a component that the successful write itself removes. The existing test passes only because its query never changes.

**Smallest fix.** Keep the last decision receipt in `ReviewDetail`, keyed by employee/date, and render it above the next state. For returned days, say that the employee can resubmit before offering disposition. Optionally add "Next open day".

**Test needed.** A reactive-store `ReviewDetail` test covering Return on READY and MISSING_END days, Certify, and Dispose.

**Confidence.** High.

**Evidence.** `hr-ui.probe.tsx`:

- Control (static query) shows "Returned".
- Live update on a complete day: `statuses:["Nothing on this day needs a decision."]`.
- Live update on a missing clock-out: no status, and `accountForDay:true`.

### K-UX-HR-03 — History and Requests lose their context on Back (P2, borderline P3)

**Who and trigger.**

- History: an employee chooses September (optionally the "Needs review" filter), opens a day and presses Back.
- Requests: an employee sets a status filter or moves to page N, opens a request and presses Back.

**Expected.** Back restores the earlier view, as AGENTS.md says ("restores the earlier workflow").

**Actual.**

- History returns to the current month and All.
- Requests returns to page 1 and All.

**Where.**

- History state: `src/features/hr/HistoryScreen.tsx:116`, `:166`; day link at `:284`.
- Requests state: `src/features/hr/RequestsScreen.tsx:59`; request link at `:163`.
- `next.config.ts:15` has no `cacheComponents`, so the previous route unmounts. Per `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`, state is preserved only with Activity/cacheComponents.

**Cause.** This state is local and not in the URL. Review and Period already use URL-backed state for comparable context.

**Smallest fix.** Move the History month/from/to/filter and the Requests status/cursor stack into query parameters with `useUrlBackedState` and replace updates. Update the Back inventory for the changed state.

**Test needed.** Caller tests for History month/filter → Day → native Back, and Requests page → detail → Back. Cover direct entry and locale.

**Confidence.** High for the mechanism; the browser path is not yet observed.

**Evidence.** `hr-ui.probe.tsx`: the query moved to `from 2026-09-01`, the URL search stayed empty, and after the remount the month was `2026-10` with the query from `2026-10-01`. Requests is source-traced.

### K-UX-HR-04 — Returned-request resubmission lacks its context (P3)

**Who and trigger.** An employee whose request was returned opens the day. The form reads "Resubmit the returned request".

**Expected.** The reviewer's reason is visible at or above the form. The form starts from the returned proposal, or this is an explicit product choice.

**Actual.**

- The start time shows the original 08:29, not the proposed 07:45.
- The reason field is empty.
- The return reason appears only in the Requests log, after the form and the events panel.

**Where.** `src/features/hr/CorrectionForm.tsx:93`, `:106`, `:172`; `src/features/hr/DayScreen.tsx:68`; `src/features/hr/DayDetailView.tsx:54`, `:61`.

**Smallest fix.** When `returnedId` is set, show a Notice with the latest RETURNED reason. Optionally seed the times and reason from the returned proposal, keeping untouched-side retention.

**Confidence.** High for the behaviour; medium that prefilling is the intended rule.

**Evidence.** `hr-resubmit.probe.tsx`: 2 expected-behaviour failures (`formStart=08:29`, `formReason=''`, reason positioned after the form).

### K-UX-HR-05 — Employee save is silent (P3)

**Trigger.** Save employee succeeds.

**Actual.** `onDone` runs immediately (`src/features/hr/EmployeeForm.tsx:227`). The editor is unmounted with `flushSync` and history is traversed or replaced (`src/features/hr/EmployeesScreen.tsx:129`–`130`). WriteFeedback's "Saved" never renders. Other HR writes do show a saved state.

**Fix.** Show a dismissible role=status receipt on the list after closing, without adding a history entry. This is also a natural place for the K-UX-HR-01 warning.

**Confidence.** Medium.

**Evidence.** Source-traced only.

## Rejected or not counted

- **Clock-in blocked while an earlier open day's correction is pending.** Product rule (HR-021). It is documented at `convex/hr/self.ts:100` and explained in the UI.
- **Holiday delete without confirmation.** Already known: `frontend-consistency-2026-10-13/README.md:210`.
- **Requests custom paging.** Already known (frontend-consistency A07).
- **Withdrawing a pending correction.** Not in HR-030/031 scope; product decision.
- **DAILY-02 and DAILY-03.** Appear fixed in source: `ShortcutCustomizeScreen.tsx:534` uses `returnFromTask(..., router.replace)`, and `:192-200` adopts newer live preferences when clean. Source-traced only.
- **HR codes without `Hr.errors` messages.** Unreachable from the client or handled elsewhere: `PREFERENCES_STALE` has its own notice, year/page-size are client-guarded, and the reconcile-only codes keep the UNCERTAIN state.
- **Correction "submitted" panel replaced by the pending notice.** The replacement is adequate explicit feedback.
- **Unlinked HR admin landing on Today.** The sidebar still offers admin destinations; friction only.
- **Period "Review open days" opens a 14-day window.** Repeating the link from the period reaches later exceptions.
- **Previously documented and not repeated:** SOL-01, SOL-02, KIRO-07, KIRO-10, DAILY-01, ROOT-01, K-HR-01/02/03.

## Reproduction

```sh
pnpm exec vitest run --config docs/reviews/ux-flow-kiro-2026-10-15/hr/probes/vitest.config.mts --reporter=verbose
```

**Current result.** 3 files, **6 failed / 2 passed** (8 cases), exit 1, as expected. The failures assert the desired behaviour; the passes are controls. A failure here is evidence of the defect, never a fix. The full log is in `evidence/probes.log`.

Other checks:

| Check                                                                                  | Result                                              |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm exec tsc -p docs/reviews/ux-flow-kiro-2026-10-15/hr/probes/tsconfig.probes.json` | Passed                                              |
| ESLint on the three probe files                                                        | Passed                                              |
| Existing `HrScreens`, `SelfService` and `HrReviewCompletion` tests                     | **30/30 passed** (`evidence/existing-hr-tests.log`) |

The existing tests passing alongside these probes confirms the gaps are not covered by the current suite.

## Coverage

Read:

- AGENTS.md, PRODUCT.md, the Back contract and the HR inventory entries.
- The 14 Oct system audit and the 13 Oct daily/expanded reports.
- Next 16.3.8 docs: preserving UI state, cacheComponents and Vitest.

Reviewed:

- Today/clock and `useHrWrite`.
- History, Day, corrections and time sides.
- Requests list/detail, Profile and Holidays.
- Review queue, detail, decision and disposition, traced to `review.ts` and the attendance model.
- Employees list/editor/history, `setup.ts` and `access.ts`, permissions, and HrAccessProvider/HrGate.
- Periods create/close/export/revise.
- Settings holidays/access/policy and shortcut customization.
- HR error-code catalogue parity.

## Limitations

- Nothing was browser-verified. The parent should confirm K-UX-HR-02 and K-UX-HR-03 in the T3 browser.
- The UI probes use an in-memory reactive store. The order "query update before mutation resolves" comes from the Convex client source, not from a live deployment.
- The backend probe uses convex-test fixture roles, not Clerk.
- Mobile layout, keyboard focus order, screen-reader output and contrast were assessed from source only.
- The Requests part of K-UX-HR-03, K-UX-HR-05, and the shell navigation visibility for role-less linked members are source-traced only.
- Line numbers refer to the 2026-10-15 working tree, which has many concurrent uncommitted changes.
