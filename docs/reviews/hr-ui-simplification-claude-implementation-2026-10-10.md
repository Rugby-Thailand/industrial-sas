# HR UI simplification — Claude implementation report

Date: 2026-10-10. Status: implemented in source and covered by focused component tests; **not inspected in a browser by Claude**. After four QA-found pre-existing P1 fixes (Today clock guard, create-period guard, second-holiday guard, deep-link scroll), one desktop button-height fix and one P2 Search handoff focus fix, app source and tests are frozen again. QA's post-fix native verification of the Search handoff focus and root's final combined check are pending. The combined `pnpm check` / `pnpm build` is owned by the coordinator and its outcome is pending. No commit, push, PR or deployment. The Claude implementation run completed with no permission denials.

Plan: [hr-ui-simplification-claude-codex-2026-10-10.md](../plans/hr-ui-simplification-claude-codex-2026-10-10.md).

## Comparing against the baseline

Compare against the pre-pass snapshot, not `git HEAD` (the HR work is untracked). As reported by the coordinator after this pass:

- `output/hr-simplification-implementation/manifest-before.json` — SHA-256 of every file before the pass.
- `output/hr-simplification-implementation/baseline-exact.tar.gz` — the exact original source mirrors.
- `output/hr-simplification-implementation/baseline/` — the same mirrors unpacked. Its 39 `.ts`/`.tsx` files are now named `.ts.baseline` / `.tsx.baseline` with bytes and hashes unchanged; `baseline-paths.json` maps each mirror to its app path. Diff a file with, for example, `diff output/hr-simplification-implementation/baseline/src/features/hr/ReviewDetail.tsx.baseline src/features/hr/ReviewDetail.tsx`.
- The coordinator also produced an exact HR-pass patch and a task-owned change manifest: 14 modified and 2 new files, matching the first list below. That count predates the second guard fix, which adds one modified app file and one new test file.

## What changed

### Review (first priority)

- The record is one panel in this order: date and employee, status, unlinked note, **decision area**, then a closed "Details and history" disclosure.
- A correction request shows **one** Original → Requested table (clock-in and clock-out rows, planned shift as its caption, changed cells marked), then the employee's reason, then Certify / Return. The second "Original (as recorded)" card that the day summary used to repeat above it is no longer rendered in Review.
- The comment field is not shown until asked for ("Add a comment"). Return reveals the same field as a required, labelled "Reason for returning" and moves focus into it; "Confirm return" validates it. A reason that is already typed (3+ characters) is sent on the first press of Return, so the return flow has no more presses than before.
- Typed text is never hidden: the field stays visible whenever it holds text, so nothing unseen is sent with a decision. Text survives Add comment → Return → Cancel, opening and closing the history, a validation failure and a server refusal. The draft/pending guard is registered by the decision component, not by the field, so it does not depend on what is expanded.
- Certifying is still one press with no confirmation dialog.
- Days without a request show the planned shift and recorded in/out once, ahead of the disposition form. A current certification stays in the main flow; a superseded one, earlier decisions, calculated times, clock events and request history are in the read-only disclosure.
- Recovery states are always visible, not only when opened from a link: the locked notice now shows with its "HR must start a revision" instruction, and "Nothing on this day needs a decision" shows whenever that is the case. Stale and unlinked are unchanged.
- Removed always-on text: "Original records and history are kept", the disposition intro sentence, the comment placeholder; the re-review hint is one short sentence.
- Queue: the split layout now depends on the **width of the review pane** (container query, 48rem) instead of the window (`xl`, 1280px), so the queue stays beside the record in a ~1061px pane. Queue column is 16–22rem. Below that width the existing single-record view with "Back to the list" is unchanged. Queue cards switch to their one-row layout by their own width.

### Periods

- One state chip for the version on screen ("Draft · v2" / "Closed · v1"), with the close time beneath a closed version. It replaces the period-level status badge, which could disagree with the version being viewed.
- An earlier version says so and offers "Show the current version".
- One compact totals strip: worked, needs review (draft only), employees, days, absent, leave.
- One next action:
  - blocked draft → the blocker and, for open days, "Review open days" linking to the first open employee/date in Review. No Close button.
  - ready draft → Close period → the existing single inline confirmation naming the version.
  - closed version → "Download CSV v{N}" for the version shown.
- "Versions" (picker, number picker, revision reason) and "Breakdown by employee" are labelled disclosures. The versions list opens by itself for a linked `?version=`, and when the draft cannot be shown (unsupported timezone, over limit), and follows Back/Forward.
- "Start a revision" is a disclosure on the latest closed version only. Its reason field stays mounted when collapsed, and its guard no longer depends on the section being open.
- Open days of a blocked draft stay visible as a list; each open day now links to that employee/date in Review.
- Removed: lifecycle stepper, the permanently disabled draft Export button, and the export-after-close, re-verification, CSV-format and frozen-figures notes on this page. The one outside-shift note remains beside the outside-shift column.

### Today

- Order is now: date and state, recorded in/out, **clock action with its feedback directly beneath it**, then planned shift and site on one line.
- An open earlier day shows "Request a correction" as a full button in the action slot, linking to that day's correction form (`?focus=correction`).
- Removed: the ticking current-time readout and its two explanatory sentences (server-time and no-location-check). The clock-method statement remains in Settings.
- Command submit, retry, pinned intent, idempotency key and saved receipt code is unchanged.
- **Added a pending guard on the clock write** (`usePendingGuard(write.pending)`). This is a behaviour fix, not presentation: see "Concurrent changes" below.
- **Clock button height on desktop (found by Codex in the live app, fixed after the second freeze).** Codex measured the primary clock button at 38px tall on desktop, against 48px at 390px wide. The button's `min-h-14` was overridden from the `md` breakpoint up by the shared Button touch size (`md:min-h-9`). The class was already on the button in the baseline, so the defect predates this pass. Root authorized a scoped fix: `md:min-h-14` added to that one button in `TodayScreen.tsx`. The shared Button, global styles and every other file are untouched. **Not verified by Claude:** no command or browser was available for this change, so the rendered height, formatting and tests have not been re-run; root's computed-height check and changed-file format/full checks are pending.

### Periods list — create-period guard (second pre-existing P1, fixed after the first freeze)

- Codex QA found that the baseline `CreatePeriodForm` in `PeriodsScreen.tsx` registered no navigation guard: a changed, unsent site or date range was lost when Search or a link left the page, and a creation in flight could be left, losing its result. Its test `PeriodCreateGuard.independent.test.tsx` reproduced both. Root authorized the fix within HR app scope.
- The form now registers the existing `useDraftGuard`. It is dirty when the site or range differs from the values the form opened with and the write is not saved; Discard restores those opening values; a pending create blocks leaving and cannot be discarded.
- Unchanged: labels, layout, the write key, same-command retry with the same request ID, and the automatic `router.push` to the created period. The suggested default range is not treated as unsent work, so an untouched form prompts nothing. Cancel stays an explicit abandon with no prompt, as before.
- No visual change, so the detector run over the 9 initial UI targets was not repeated for this file.

### Settings

- Holidays and access stay open and prominent. Policy, limits, re-verification, CSV columns and the holiday-edit rule are in one closed "Pilot policy and export format" disclosure.
- `?section=policy` opens that disclosure in the same render that reads the URL, so it is open before focus moves to it; this holds for direct load, reload and Back/Forward. Nothing is unmounted when it closes.

### Settings — second holiday draft guard (third pre-existing P1, fixed after later freezes)

- Codex QA reproduced, in `HolidayDraftGuard.independent.test.tsx`, that after one holiday saved, a second typed holiday could be left without a prompt (`leave` called once, expected 0). I did not run that test before the fix; the failure is QA's result. The baseline `SiteHolidays` has the same code, so it predates this pass.
- Cause: the write key is fixed per site, so its state stayed SAVED after the fields were cleared, and the guard's dirty flag is gated on "not SAVED".
- Fix, in `SiteHolidays` only: editing the date or name while the write is SAVED calls the existing `adding.reset()`. The new text then registers as unsent, and the stale "Saved" line no longer sits beside the new draft. Pending and uncertain states are untouched: the fields are disabled then, so the reset cannot run, and the pinned payload and request ID are retried as before.
- No label, layout, routing, backend or shared-guard change. The saved state itself looks as it did.

### Deep-link scroll (fourth pre-existing P1; protected-helper exception in `src/lib/deepLink.ts`)

- QA's native trace, on both a direct full load and the real AI handoff to an employee's schedule: the correct section took focus and nothing overwrote it, but the page did not scroll. The main scroll stayed at 0 and the section sat at top 547.5 / bottom 922 in an 800px viewport, still so after 3.4s. Calling `scrollIntoView({ block: "start", behavior: "auto" })` on the same element by hand moved it to the top at once.
- Fix, authorized by root as a narrow exception to the HR/Search scope: `useDeepLinkFocus` now always scrolls with `behavior: "auto"`. The reduced-motion branch is removed because it is now dead; an immediate jump has no motion. The ready gate, key, run-once, tabindex, focus, highlight and timers are unchanged. The baseline helper has the same smooth scroll, so the defect predates this pass.
- This affects every HR deep-link target (correction, decision, schedule, details, export, settings sections), which is the intended effect: the linked section is in view when it takes focus.
- Why the smooth scroll did not move the page is not established. The fix avoids it rather than explains it.
- **Not verified in a browser by Claude.** QA's native re-run of direct load, reload and AI handoff after this change is pending. I added no unit test: jsdom does not lay out or scroll, so a test could only assert the option passed.

### Search handoff focus (confirmed P2; `SearchDialog.tsx` only, freeze reopened by root)

- QA's native trace, Settings holidays → normal Search → "policy" → ArrowDown/Enter: focus went Search button → search input → `hr-settings-policy`, then back to the Search button about a second later. The URL, the open section and the scroll were all correct, and a direct reload kept focus on the section. The slower AI employee load had avoided the race.
- Cause: the shared dialog returns focus to its opener when the close completes, which here is after the destination has already taken focus.
- Fix: `SearchDialog` records, per open, whether `onNavigate` returned `true`, and only then prevents its own close autofocus through the existing `DialogContent` prop. The flag is cleared on every open and every close. Normal Search and AI use the same wrapper. A refused target (`false`) sets nothing, so Escape, the close button and outside dismissal still return focus to the opener.
- Unchanged: `GlobalSearchProvider`, the shared `dialog.tsx`, `deepLink.ts`, resolver, provider, guards, labels and layout.
- One consequence to know: if an accepted navigation is then held by the unsaved-work prompt and the user chooses "Keep editing", focus is not returned to the search opener, because the search dialog has already closed. Not covered by a test.
- **Not verified in a browser by Claude**; QA's post-fix native run is pending.

### Earlier diagnoses, corrected by QA's trace

- **Correction to the correction below.** The opener-refocus hypothesis was wrong for the schedule scroll defect, but QA later confirmed it as the cause of this separate focus defect on a fast handoff.

- **Schedule handoff.** My read-only diagnosis ranked focus being taken back after the fact (the dialog refocusing its opener, Next's navigation scroll, or a remounted target). QA's trace shows focus was correct and stable and the fault was the scroll alone, on direct load as well. Those hypotheses were wrong for this defect. `GlobalSearchProvider`, `SearchDialog` and `dialog.tsx` are unchanged.
- **Employees URL staying on `?mode=new`.** In QA's controlled runs, new and existing employee Save → Edit → Cancel URLs all passed once settled. The first observation is not treated as a reliable defect, and no employee, history or guard code was changed for it.

### Search

- The provider disclosure is now visible whenever the AI button is, including in normal search before the first ask: "Ask AI sends your typed text (including any names) and the current page type to the AI provider. No records are sent." I checked this against `convex/model/search/provider.ts`: the request carries the query, the page key and three booleans.
- In AI mode the panel shows a one-line prompt with examples only while the query is empty, then only the context in use and the current outcome. It is not rendered when it would be empty.
- No change to `useAiSearch`, `results.tsx`, the provider, resolver or guard code.

### Shared

- `HrDisclosure` in `HrUi.tsx`: a button with `aria-expanded`/`aria-controls`; content stays mounted and is hidden with the `hidden` attribute.
- `DayDetailView.tsx` is split into exported parts. The self-service day page composes the same parts and renders as before.
- `ReasonField` accepts an optional `inputRef`.

## Changed files

Modified (lines removed / added against the baseline mirror, counted when the implementation finished):

| File                                                | −   | +   |
| --------------------------------------------------- | --- | --- |
| `src/features/hr/ReviewDetail.tsx`                  | 110 | 277 |
| `src/features/hr/ReviewScreen.tsx`                  | 12  | 17  |
| `src/features/hr/DayDetailView.tsx`                 | 212 | 283 |
| `src/features/hr/PeriodDetailScreen.tsx`            | 248 | 258 |
| `src/features/hr/TodayScreen.tsx`                   | 82  | 74  |
| `src/features/hr/SettingsScreen.tsx`                | 33  | 54  |
| `src/features/hr/HrUi.tsx`                          | 2   | 76  |
| `src/features/hr/CorrectionForm.tsx`                | 1   | 5   |
| `src/components/shell/search/SearchDialog.tsx`      | 21  | 36  |
| `messages/en.json`                                  | 29  | 25  |
| `messages/th.json`                                  | 28  | 24  |
| `src/features/hr/HrScreens.test.tsx`                | 2   | 10  |
| `src/features/hr/HrReviewCompletion.test.tsx`       | 0   | 17  |
| `src/components/shell/search/GlobalSearch.test.tsx` | 0   | 38  |

Added: `src/features/hr/HrSimplification.test.tsx` (761 lines when written), this report.

Second guard fix, after the first freeze: modified `src/features/hr/PeriodsScreen.tsx` (−7 / +24 against `PeriodsScreen.tsx.baseline`); added `src/features/hr/PeriodsScreen.guard.test.tsx` (145 lines when written). Task-owned total after that fix was 15 modified and 3 new files.

Holiday guard fix: `src/features/hr/SettingsScreen.tsx` modified again (already in the list above; its line counts there are from the first pass); added `src/features/hr/SettingsHoliday.guard.test.tsx`. Task-owned total after that fix was 15 modified and 4 new files.

Deep-link scroll fix: modified `src/lib/deepLink.ts` (compare with `output/hr-simplification-implementation/baseline/src/lib/deepLink.ts.baseline`; the scroll call, its comment and the doc comment only). Claude-owned count at that point: 16 modified and 4 new files. The three QA-owned `*.independent.test.tsx` files are not counted. Root regenerates the exact patch and manifest.

Search handoff focus fix: `src/components/shell/search/SearchDialog.tsx` modified again (already counted); added `src/components/shell/search/SearchDialogFocus.test.tsx`. **Final Claude-owned count: 16 modified and 5 new files.**

Message keys (both locales, `Hr.*` and `Search.*` only). Added: `review.details`, `recordedIn`, `recordedOut`, `changed`, `returnReason`, `returnConfirm`, `returnCancel`, `commentAdd`; `period.shownDraft`, `shownClosed`, `earlierVersion`, `versions`, `reviewOpen`; `settings.holidayEdits`. Reworded: `review.comment`, `review.reviewAgainHint`, `period.readyHint`, `period.byEmployee` (EN), `period.reviseIntro`, `settings.policy`, `settings.accessIntro`, `Search.aiIntro`, `Search.aiPrivacy`. Removed as unused: `review.commentPlaceholder`, `decisionNote`, `disposeIntro`; `period.lifecycle`, `stepReview`, `stepClose`, `stepExport`, `export`, `exportDraftDisabled`, `reverifyNote`, `frozenNote`, `openDaysHint`, `keepClosed`, `csvNote`, `ready`; `today.currentTime`, `currentTimeHint`, `methodNote`.

### Concurrent changes that are not mine

The manifest comparison also shows these, which I did not write or edit:

- `src/features/hr/TodayPendingGuard.independent.test.tsx`, `src/features/hr/PeriodCreateGuard.independent.test.tsx` and `src/features/hr/HolidayDraftGuard.independent.test.tsx` (new, from the Codex audit; all left unchanged by me).
- `docs/reviews/hr-ui-simplification-codex-audit-2026-10-10.md`, `docs/reviews/hr-user-guide-th-verification-2026-10-10.md` (new).
- `docs/design-sheet/*` (5 files) and `src/components/ui/ScanCodeInput.tsx` (modified).

The Codex test appeared mid-session and failed: a clock write in flight did not hold Search/AI/link navigation. The baseline `TodayScreen.tsx` has the same gap, so it predates this pass. The audit notes record it as P1 with the fix authorized; I added the one-line pending guard and left the test file untouched. It now passes.

## Tests

Existing tests adapted for intentionally changed layout, with domain assertions kept or tightened:

- `HrScreens.test.tsx` — return flow: Return reveals the required reason, "Confirm return" validates and sends; same payload assertions.
- `HrReviewCompletion.test.tsx` — prior decisions are asserted hidden, then visible after opening the disclosure (the old assertion would have passed on hidden content); current certification asserted visible; version tests open "Versions" first and assert the shown-version chip.
- `GlobalSearch.test.tsx` — members without AI see no disclosure; two new tests for the disclosure before asking and examples only while empty.

New `HrSimplification.test.tsx` (12 tests): one comparison and evidence ahead of actions; draft and guard retention across comment/return/cancel/history toggles and a refusal; keyboard operation of the disclosure and return flow; stale/locked/unlinked/nothing-to-decide visibility; blocked draft → review link with employee/date, no close, no draft export; ready draft → one version-named confirmation; linked earlier version → correct chip, exports that version's ID, no revise/close; revision reason and guard survive collapse; settings policy opens and takes focus on load and after a URL change back to it; holiday draft survives policy toggles; Today action order and feedback placement; open-day correction link.

Commands Claude ran during implementation, before the source freeze, and their results:

| Command                                                                                                                                          | Result                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --project unit src/features/hr src/components/shell/search` (before any edit)                                              | 6 files, 53 tests passed                                                                       |
| same, after all edits                                                                                                                            | 8 files, 68 tests passed                                                                       |
| `pnpm exec vitest run --project unit --project unit-node src/features/hr src/components/shell/search src/i18n src/lib/search src/lib/navigation` | 13 files, 206 tests passed                                                                     |
| `pnpm exec eslint` on the 13 changed/added `.tsx` files                                                                                          | no errors or warnings                                                                          |
| `pnpm exec prettier --check` on all 15 changed/added source and message files                                                                    | all formatted                                                                                  |
| `pnpm exec tsc --noEmit -p .`                                                                                                                    | 0 errors in the app; 142 errors, all under `output/hr-simplification-implementation/baseline/` |

After the second guard fix (source frozen again afterwards):

| Command                                                                                                                        | Result                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --project unit` on `PeriodCreateGuard.independent.test.tsx` and `TodayPendingGuard.independent.test.tsx` | 2 files, 3 tests passed (the 2 create-period reproductions and the Today regression)                                                                      |
| `pnpm exec vitest run --project unit src/features/hr/PeriodsScreen.guard.test.tsx`                                             | first run 1 of 3 passed; the 2 failures were my test not dispatching the guard's history step before asserting. After that test-only correction, 3 passed |
| `pnpm exec vitest run --project unit src/features/hr src/components/shell/search`                                              | 10 files, 73 tests passed                                                                                                                                 |
| `pnpm exec eslint` on `PeriodsScreen.tsx` and `PeriodsScreen.guard.test.tsx`                                                   | no errors or warnings                                                                                                                                     |
| `pnpm exec prettier --check` on the same two files                                                                             | formatted                                                                                                                                                 |

`PeriodsScreen.guard.test.tsx` (3 tests) adds: an untouched form prompts nothing and Discard restores the opening range before leaving; Cancel abandons a changed range without a prompt and leaves nothing registered; a lost creation is retried with an identical payload and request ID, opens the period, and no longer holds navigation once saved.

No typecheck was run for this fix.

After the holiday guard fix:

| Command                                                                                                                | Result                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `pnpm exec vitest run --project unit` on `HolidayDraftGuard.independent.test.tsx` and `SettingsHoliday.guard.test.tsx` | 2 files, 3 tests passed (QA file byte-for-byte unchanged) |
| `pnpm exec vitest run --project unit src/features/hr src/components/shell/search`                                      | 12 files, 76 tests passed                                 |
| `pnpm exec eslint` on `SettingsScreen.tsx` and `SettingsHoliday.guard.test.tsx`                                        | no errors or warnings                                     |
| `pnpm exec prettier --write` on the same two files                                                                     | already formatted                                         |

`SettingsHoliday.guard.test.tsx` (2 tests) adds: a saved, empty form holds nothing; typing the next date clears "Saved" and is guarded; Discard clears both fields before leaving; a lost save is retried with an identical payload and request ID; the draft after that is guarded and saves as a new command with a new request ID.

No typecheck, `pnpm check` or `pnpm build` was run for this fix. The Today `md:min-h-14` change before it was made without any command; it has since been exercised only by these unit runs, not measured in a browser.

After the deep-link scroll fix (final source freeze follows):

| Command                                                                                                                                | Result                     |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `pnpm exec vitest run --project unit --project unit-node src/features/hr src/components/shell/search src/components/providers src/lib` | 33 files, 317 tests passed |
| `pnpm exec eslint src/lib/deepLink.ts`                                                                                                 | no errors or warnings      |
| `pnpm exec prettier --check src/lib/deepLink.ts`                                                                                       | formatted                  |

Root's last full `pnpm check` (162 files, 1,498 tests) and production build passed before the holiday and deep-link repairs. That is root's earlier independent result, not a result for the current source; root's final combined run is pending.

After the Search handoff focus fix (app and tests frozen again afterwards):

| Command                                                                                                                                           | Result                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm exec vitest run --project unit src/components/shell/search/SearchDialogFocus.test.tsx`                                                      | 3 tests passed                                                                 |
| same, with the one `preventDefault` line temporarily disabled, then restored                                                                      | 2 of 3 failed (destination lost focus), confirming the tests detect the defect |
| `pnpm exec vitest run --project unit --project unit-node src/features/hr src/components/shell src/components/providers src/components/ui src/lib` | 47 files, 368 tests passed                                                     |
| `pnpm exec eslint` and `prettier --check` on `SearchDialog.tsx` and `SearchDialogFocus.test.tsx`                                                  | clean                                                                          |

`SearchDialogFocus.test.tsx` uses the real dialog and provider with a stand-in destination that focuses itself from an effect after navigation: focus stays on the destination after a chosen result and after an AI navigation; a later Escape returns focus to the opener; a refused target followed by Escape returns focus to the opener.

Root's full check and build remain pending for the current source.

### TypeScript

The 142 errors above are a historical, artifact-only result: the baseline mirror then held `.ts`/`.tsx` files inside the TypeScript project, and their relative imports could not resolve. None was in app source. The coordinator has since resolved this by renaming the mirrors to `.ts.baseline` / `.tsx.baseline`; `tsconfig.json` and the ESLint config were not modified.

No typecheck has been run by Claude since that rename, so this report does not claim a fresh passing typecheck. The coordinator's single combined `pnpm check` and `pnpm build` is the authoritative result and is pending.

### Other review after the app edits

Reported by the coordinator, not run by Claude:

- The Impeccable detector ran once over the 9 changed app `.tsx` files and exited 0 with no findings or advisories.
- A React best-practices source review checked stable hook order, mounted disclosure state and guards, and URL-derived toggles.

Both are source-level checks and do not replace browser QA.

## Not done, and real limits

- **No browser inspection and no screenshots by Claude.** The preview was unreachable during implementation. The native server has since been restored and independent QA and manual captures are starting; no result from them is claimed here. Nothing here about fold positions, the 390×844 first view, the 1061px pane, Thai wrapping, dark mode, touch-target sizes or focus rings has been seen rendered. The screenshots in `output/hr-polish/final` are of the earlier UI and are historical.
- The 48rem split threshold and 16–22rem queue width were chosen from arithmetic, not from a measured pane. Tailwind container-query classes (`@container`, `@3xl:`, `@md:`) are new to this codebase and have not been seen rendered.
- `pnpm check` and `pnpm build` were not run by Claude, by instruction; the coordinator's combined run is pending.
- No integration tests were run; no backend, schema, seed, auth or navigation-registry file was changed.
- The settings Back/Forward test changes the mocked query string and re-renders; real browser history was not exercised.
- Hidden disclosure content relies on the `hidden` attribute. A caller that passes a display utility such as `grid` or `flex` in `contentClassName` would depend on Tailwind's `[hidden]` rule winning; current callers pass spacing classes only.
- The employee editor, history, profile and employees list were not changed. The periods list changed only by the create-form guard.
- While a create outcome is uncertain, Discard on a changed form resets the site and range, which changes the write key and so drops the "Try again safely" offer for that command. Choosing the same site and range again resends the original command. This follows from the existing write key, which I was asked to preserve; it is not covered by a test.

## Removed, and where it went

| Removed from | What                                                             | Now                                                                     |
| ------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Review       | second Original card, "history is kept" notes, disposition intro | Original times once in the decision area; history in the disclosure     |
| Periods      | lifecycle stepper, disabled draft Export, four caveat notes      | page summary line and the ready-state sentence; policy text in Settings |
| Today        | live clock, server-time and no-location sentences                | clock-method statement in Settings policy                               |
| Settings     | always-open policy panel, holiday-edit note under the form       | closed policy disclosure                                                |
| Search       | intro and privacy paragraphs inside the AI panel                 | one visible disclosure line; prompt only with examples                  |
