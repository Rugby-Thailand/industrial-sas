# Sol final HR UI audit — worker snapshot

October 13, 2026. Reviewed `/Users/macbook/Development/industrial-sas-filter-hr`, based on `11c8c2cc`, after Kiro's product follow-up and the parent's focused corrections. This is the HR UI review for integration, not live-browser/release approval. The auditor made no product edits or browser/production calls. At the parent's explicit request, one independent dedicated inactive-site regression test was added; no existing Kiro test was edited.

## Reviewer conclusion

No unresolved supported-flow blocker was established in the inspected final HR UI snapshot. The previously reported terminal reset/stall, stale retained actions, pinned/unread restoration, shared persisted scope and truncated stack issues have concrete source fixes and focused passing checks. Complete late-site/backend history/export behavior is documented separately in `sol-hr-final.md`.

The audit found one additional historical filter gap: `HrSiteSelect` ignored `includeInactive` when the active preload was complete, and the periods filter was hidden with at most one active site. The parent corrected the selector to use the independent paged query whenever inactive sites are requested and made the periods historical filter unconditional. The dedicated regression below verifies that correction. The all-period list already contained inactive-site records; this was a filtering/discovery gap, not a backend access failure.

## Verified behavior

| Area                          | Source and focused evidence                                                                                                                                                                                                                                                                                                                                         | Assessment                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Terminal reset and real retry | `useHrPagedQuery` exposes `interrupted`; successful stale reset recovery is attempted once, then explicit Start again increments `attempt` on a fresh first-page query. Kiro's screen tests inspect actual query args, including `attempt:1`.                                                                                                                       | Pass for tested reset flows; no indefinitely disabled recovery                        |
| Stalled and paused search     | `useScanRecovery` stops missing/repeated scan cursors, budgets 50 automatic continuations and offers Resume/Start again. Recovery tests exercise repeated cursor and 70-step search, then completion.                                                                                                                                                               | Pass for tested continuation/recovery flows                                           |
| Retained rows while updating  | `HrPagedState` makes the subtree inert and passes `busy`; employee Edit and review selection buttons explicitly disable. Member pickers independently treat retained updating choices as pending and remove them from selectable options. Tests try clicking retained actions and confirm navigation is not invoked.                                                | Pass; filters remain usable                                                           |
| More than 500 cursors         | New stack stores offset, keeps its oldest retained cursor as a floor, exposes accurate page number/Previous availability and explicit First. Existing stack callers use `nav` and `HrStackFirst`, with draft guards where applicable. Tests exercise 500-entry truncation and the actual screen First button.                                                       | Pass; no implicit oldest-page→page1 jump                                              |
| Pinned/unread restoration     | Both flags use `useHrListCriteria` URL parameters and entry identity. Stack criteria include flag plus entry. Tests remount the actual announcement/notification screens and drive popstate restoration of filtered page 2.                                                                                                                                         | Pass for tested flags/history entry flows                                             |
| Independent pager scopes      | Shared `useCursorPagination` persists up to 24 scoped entries and keeps the legacy slot for compatibility. Scope-specific restoration no longer depends solely on the memory map. Hook regression batch passes.                                                                                                                                                     | Prior single-slot defect fixed in source and shared tests                             |
| Employee editor return        | List criteria stay in editor/close URLs; `navigationKey` excludes list fields so typing does not reset an open draft. `useCarriedListState` captures list metadata inside authorized navigation callbacks, then applies it after the exact router URL commits. Close deliberately unmounts the editor and carries metadata through replace.                         | Source coherent; full real-router cold-refresh sequence remains browser verification  |
| Late site choices             | Incomplete preloads use independent `sitesPage`; current/earlier chosen single-site values keep a selected/pinned option; checklists preserve chosen IDs off-page and remember labels for sites chosen from retrieved pages. Paged choices are disabled while unresolved/updating. Kiro screen test selects a late site and verifies retained label through paging. | Pass for tested late single-site selection; announcement checklist reviewed in source |
| Inactive historical sites     | `includeInactive` always takes paged query path; periods filter remains visible with one active site. Dedicated test uses a complete one-active-site preload and confirms a closed branch is offered.                                                                                                                                                               | Parent correction verified                                                            |
| Older period versions         | An incomplete newest-version selector offers All versions. That disclosure queries `periodVersionsPage`, renders the shared pager and disables version buttons while busy. Exact selected old version stays in selector and full preview/export remains independent.                                                                                                | Source connected; backend 151-version traversal already passed                        |
| Older day corrections         | Employee detail links to exact-date paged request history; reviewer detail offers an All requests disclosure backed by `dayCorrectionsPage` and shared pager. The Kiro test verifies exact from/to link; backend 45-correction traversal passed.                                                                                                                    | Source connected; full reviewer disclosure browser traversal remains later            |
| Finite close/export state     | Local period presentation slices do not replace complete preview rows/totals/fingerprint. Close/export use full authoritative exact version operations. Employee draft values remain above selectors.                                                                                                                                                               | No page-only close/export or selector-induced draft clearing found                    |

## Focused checks run by this audit

```sh
pnpm exec vitest run src/features/hr/HrHistoricalSiteSelect.audit.test.tsx src/features/hr/HrPagination.test.tsx src/features/hr/EmployeeForm.memberScope.test.tsx src/hooks/useCursorPagination.test.tsx src/features/hr/HrReviewCompletion.test.tsx src/features/hr/AnnouncementsNotifications.test.tsx src/features/hr/HrScreens.test.tsx
```

**7 files, 56 tests passed**, 4.23 s. The dedicated `HrHistoricalSiteSelect.audit.test.tsx` added by the auditor is independent of Kiro's recovery file. It renders a real `HrSiteSelect` with a complete one-active-site access preload and `includeInactive`; opens its actual option list; asserts the closed OLD branch exists and query args are `includeInactive:true,pageSize:20`.

```sh
pnpm exec vitest run src/features/hr/HrPagedRecovery.test.tsx
```

**1 file, 13 tests passed**, 2.28 s. This is Kiro's new file, run independently by the auditor after its complete source was present. It drives actual screen/hook controls with mocked query outcomes rather than testing a mirrored pure implementation.

## Exact source snapshot

The following SHA-256 hashes were recorded after the focused checks. Later changes require appropriate revalidation; this worker was not yet a committed immutable integration snapshot.

| File                                      | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `src/features/hr/HrPagedList.tsx`         | `3372b5cbb24efd44b6097986fb1845d81f0f9ef5337e7ea78476fd5f65924f07` |
| `src/hooks/useScanRecovery.ts`            | `3e8e052eec13ee19cbe7f45b8761cab3519d02c3c8ce5875db859978c734db19` |
| `src/features/hr/HrListCriteria.ts`       | `66c8b737d0757e1e892cf51db2a49b48175d487cf5133d6c22997a4b8e2884aa` |
| `src/features/hr/HrSiteSelect.tsx`        | `9785cb7fcec845e3215a0118860144ab84cd482a54c6724338b5f19abb2aae44` |
| `src/hooks/useCursorPagination.ts`        | `ab40d67bfc513754119e273bf3ca32c0bd9f9438ba75228a8f267c173d7e9939` |
| `src/features/hr/AnnouncementsScreen.tsx` | `36d15defa6c95dd98123c2f0fa36201c35f7b4f0d08f268eb5bbc6206e9c5e0c` |
| `src/features/hr/NotificationsScreen.tsx` | `627e2591e3ef197e95c8d76cfb3758443442b045f4fb97aa4a297eed1a0b31af` |
| `src/features/hr/EmployeesScreen.tsx`     | `6767c1c979ce918ddfb9e33fe08df7a717980b99383f1ca1b5aa86f468dc6500` |
| `src/features/hr/PeriodDetailScreen.tsx`  | `b7c7adc3efe4bada8f17406842015b988b1e3d4c2defa8df4526f860d7185ad2` |
| `src/features/hr/ReviewDetail.tsx`        | `3004d9c12e0a2f08018d49b4e231a520aeadc3d556257167a19f7ec9cd9b953b` |
| `src/features/hr/DayDetailView.tsx`       | `6768c02b1322396ab4bbf0ac35ec6790afacf82a1b4a0879787d09008488e47f` |

## Remaining limits

Checks used jsdom and mocked frontend query responses. They verify component state transitions, query arguments and disabled controls, not live Convex subscription/network behavior or native browser keyboard/focus enforcement. No new production latency claim is made. A complete real-router editor open→Close→refresh cycle, reviewer old-history traversal, announcement checklist with saved off-page audience, responsive keyboard behavior and integrated schema/API/build checks remain the parent's final verification responsibilities. Source and focused test evidence support integration; they do not replace those checks.
