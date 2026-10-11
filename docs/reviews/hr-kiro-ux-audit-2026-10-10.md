# HR UX — audit and implemented employee editor fix

Date: 2026-10-10. The bounded UX implementation is complete in **two source/test files**: `src/features/hr/EmployeeForm.tsx` and the new `src/features/hr/EmployeeForm.validation.independent.test.tsx`. Focused verification passed **5 files / 40 tests**, including **10 new consequence tests**. The same new tests produce **5 expected failures** against the preserved pre-change editor, then pass on the restored final source.

## Final behavior

A configured employee shift now checks its start and end with the backend's existing `parseLocalTime` parser before saving. Missing or malformed values stop the mutation and show the existing localized `Hr.errors.SCHEDULE_TIME_INVALID` message on the exact time input. Each time `FormField` receives its error, so the shared primitive supplies `aria-invalid` and an attached error description. A server refusal for `startTime` or `endTime` also appears on the corresponding field.

The main employee grid and schedule-time grid now use `items-start`, preventing controls beside helper text from stretching. The outer disabled fieldset uses `min-w-0 space-y-5` instead of `contents`, adding real separation between employee details and the schedule group while retaining the pending/uncertain lock.

No new duration or break validation behavior was added. The original payload, weekday checks, overnight flag, stable request identity, uncertain retry command, draft retention and guard behavior are preserved. Both locale JSON files still match the post-rebase snapshot; existing Thai/English copy is reused. No backend, Review, period-context or Search-focus implementation is part of this UX batch.

## Implementation and verification evidence

The installed Kiro CLI performed both phases with `claude-opus-5.5`, effort `high`, `--trust-all-tools`, `--no-interactive`:

- Initial audit: exit 0 after 12m36s — [run](../../output/hr-kiro-improvement-20261010/ux/kiro-audit-run.json), [findings](../../output/hr-kiro-improvement-20261010/ux/kiro-audit.md).
- Authorized implementation: exit 0 after 8m14s — [run](../../output/hr-kiro-improvement-20261010/ux/kiro-implementation-run.json), [implementation summary](../../output/hr-kiro-improvement-20261010/ux/kiro-implementation.md), [saved prompt](../../output/hr-kiro-improvement-20261010/ux/implementation-prompt.txt).
- [Before proof](../../output/hr-kiro-improvement-20261010/ux/implementation-before.json), [after hashes and test summaries](../../output/hr-kiro-improvement-20261010/ux/implementation-after.json), [exact final patch](../../output/hr-kiro-improvement-20261010/ux/ux-final.exact.patch). Comparison uses the exact post-rebase EmployeeForm baseline, not HEAD; HR source was already untracked.

| Check                                                                                                                                                                                                     | Result                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New actual-EmployeeForm tests: missing start/end, malformed time and correction, no-schedule save, backend time-field refusals, new/stored overnight payloads, pending lock, uncertain same-command retry | 10/10 passed — [log](../../output/hr-kiro-improvement-20261010/ux/kiro-focused-new-test.log)                                                                                                                                                         |
| Same new tests with preserved EmployeeForm temporarily restored, followed by final-source restoration                                                                                                     | 5 expected failures / 5 preservation cases passed — [log](../../output/hr-kiro-improvement-20261010/ux/kiro-new-test-against-baseline.log)                                                                                                           |
| New tests plus `HrReviewCompletion`, `HrSimplification`, `useHrWrite.independent`, `DraftGuardProvider`                                                                                                   | 5 files / 40 tests passed — [log](../../output/hr-kiro-improvement-20261010/ux/kiro-focused-tests.log)                                                                                                                                               |
| File-scoped Prettier and ESLint on the two owned files                                                                                                                                                    | Passed — [format](../../output/hr-kiro-improvement-20261010/ux/kiro-prettier.log), [lint](../../output/hr-kiro-improvement-20261010/ux/kiro-eslint.log)                                                                                              |
| Kiro's temporary narrowed TypeScript check                                                                                                                                                                | Owned files had no reported errors; the command reported the omitted `jest-axe` declaration in `vitest.setup.ts`, so this is not claimed as a passing repository typecheck — [log](../../output/hr-kiro-improvement-20261010/ux/kiro-scoped-tsc.log) |

Independent review of the final diff confirms only the accepted parser/error-binding changes and three layout refinements in the existing component. The new tests exercise mutation prevention, accessible error association and original retry payloads; they do not assert CSS class names. No repeated test run or wider source edit was necessary after the focused results passed.

## Audit context and deferred findings

The initial phase read current HR/Search source, relevant backend behavior, phase-1 requirements, prior final/feature audits, Thai manual `pages.json`, all 20 full-viewport source images and prior route/live-workflow evidence. AGENTS.md, installed Next client-component/forms/navigation guides and impeccable craft-floor principles were read before implementation. The incumbent HR visual authority was preserved; no new context/detector/design run was performed. [Audit preservation proof](../../output/hr-kiro-improvement-20261010/ux/read-only-verification.json) recorded 75/75 relevant files unchanged at the end of the read-only phase.

The selected bounded editor gap was source-confirmed at former `EmployeeForm.tsx:103`, 190–195 and 411–429: time validation and field bindings were absent while the server correctly rejected invalid values. This is now resolved and regression-tested.

Two P2 findings remain outside this implementation:

1. **Return result continuity:** `ReviewDetail` derives pending state from the reactive query and unmounts the child's saved message after Return clears `pendingCorrectionId`. An incomplete day immediately shows a disposition form. This was source-confirmed, but no live Return was performed. Kiro's P1 severity and automatic disposition collapse are not adopted. Its outside-list-notice claim is also not adopted because Review derives `selectedItem` from all queue items rather than the filtered tab. A separate reactive consequence reproduction is required before further implementation.
2. **Search cancellation focus:** prior live evidence recorded BODY focus after Search → dirty employee draft → Keep editing, with draft retention correct. Source explains the disconnected focus target, but the coordinator must reproduce current behavior before a shared-focus change. That work belongs to the separate shared-guard owner.

A next-pending review action and Kiro's broader period-range/return-context proposal are not selected for this editor pass.

## Handoff limits

The coordinator owns native-browser verification of Thai errors, spacing/alignment, narrow screens and final complete checks/build. None was run by the UX agent or this Kiro invocation. The malformed-time test uses an HTML time containing seconds; jsdom may sanitize malformed values, so native partial-input behavior is not claimed. The verified validation contract is the existing server parser's HH:MM form.

The UX agent performed no git command, commit, push, PR, database command/mutation, browser/Playwright action, full check/build or development-server action. CLI transcripts remain local evidence and are not reproduced here. Only the two locked source/test files, this owned report and UX output evidence were written.
