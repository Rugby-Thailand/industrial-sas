# HR mobile navigation — implementation report (2026-10-10)

Scope: the bounded mobile-navigation task. Only the six owned files changed. No git
commands, browser tools, servers, builds or broad checks were run. Evidence lives in
`output/hr-kiro-improvement-20261010/ui/mobile-nav/`.

## Changes

**`src/components/ui/sidebar.tsx`.** Adds an optional `onMobileCloseAutoFocus(event)` to
`Sidebar`. It is forwarded only to the mobile `SheetContent.onCloseAutoFocus`. Callers
that don't pass it keep the current behaviour, and the desktop rail and the
`collapsible="none"` path never receive it.

**`src/components/shell/search/SearchTriggers.tsx`.**

- `SidebarSearchTriggers` takes an optional `onOpen(mode)`. Without it, clicks open Search directly through `controls.open`, as before.
- Labels, test IDs and the `aiAvailable` condition are unchanged.
- The header-only `MobileSearchButton` is removed. It had no other users.

**`src/components/examples/c-sidebar-2.tsx`.** Uses the existing `useSidebar().isMobile`
breakpoint (max-width 1023).

- **`ShellHeader`.** On phones the header holds only the menu button, the flag-only `LocaleSwitcher compact` and the unchanged `ThemeToggle`. Desktop keeps `WorkspaceContextBar` on `WORKSPACE_BAR_PATHS`, `TaskWorkspaceContext` elsewhere, and the full language label.
- **Drawer context.** On phones the same `WorkspaceContext` choice renders in the drawer's `SidebarHeader`, between the brand row and the Search rows. It gets the full 18rem drawer width.
  - Only one picker is ever mounted: it lives in the header on desktop and in the drawer on phones.
  - `WorkspaceContextBar` and its workspace logic are untouched.
- **`useDrawerSearchHandoff`.** A drawer Search or AI Search click queues the mode in a ref and closes the drawer. When the sheet's real close focus hand-back runs, the queue is consumed:
  - focus moves to the connected header menu button, through a ref passed from `Pattern`;
  - then `controls.open(mode)` runs, so Search records that button as its opener.
- **Queue clearing.** The queue is cleared on reopening the drawer, a pathname change, an `isMobile` change and unmount. A context-identity change also clears it: a change in organization, selected warehouse or signed-in actor (see "Context-identity fix" below). An ordinary close (Escape, overlay, nav link) has no queue and keeps the default behaviour. There are no timers.
- `GlobalSearchProvider` and `SearchDialog` are unchanged. The accepted-result focus path is the existing `navigated` handling in `SearchDialog`.

**`src/components/shell/LocaleSwitcher.tsx`.**

- **Local Select.** Builds the control from the shared `Select*` primitives inside this file. `SelectControl` cannot render a custom value. The repo's `no-restricted-imports` rule blocks these primitives outside SelectControl, so the import carries one `eslint-disable-next-line` with its reason. No shared primitive or config was edited.
- **Trigger.**
  - `compact` (phones) shows a 48 × 48 px (`size-12`) trigger with only the current flag. There is no visible text and the chevron is hidden.
  - It is named by `aria-labelledby` = the existing label plus the sr-only current language, e.g. "Language English" or "ภาษา ไทย". The explicit `<label htmlFor>` is kept for fixtures.
  - Desktop keeps the flag, the full label, the chevron and the previous compact dimensions.
- **Menu.** Lists the translated language names as text only. Displayed values always come from `useLocale()`.
- **Guard fix.** Selecting the current language does nothing. Otherwise the code snapshots `pathname + location.search + location.hash` at selection time, then runs `startTransition(router.replace(…))` inside `guardedNavigate`. Locale changes now honour the HR dirty and pending guards and the history-buffer release. No new copy was added.

## Context-identity fix (corrective continuation, 2026-10-11)

The earlier queue clearing missed one case. If the workspace or actor changed while the drawer was closing, the queued Search still opened when the close finished. The fix touches only `c-sidebar-2.tsx` and its test.

- **Identity inputs.** `AppSidebar` passes three primitives to `useDrawerSearchHandoff`: `workspace.organization?.id`, `workspace.selectedWarehouseId` and `hr.identityKey`. It does not pass the whole workspace or HR objects, and selection, auth and tenant state are untouched.
- **Context key.** The hook combines the pathname and those three values into one string key (`JSON.stringify`). The key replaces `pathname` in the existing cleanup effect's dependencies. A route, organization, warehouse or actor change therefore clears the queue, as do an `isMobile` change and unmount.
- **Close-time check.** Each queued request records the context key it was made in. At close completion, `onDrawerCloseAutoFocus` drops the request unless that key matches the current one. Radix calls the latest prop, so a stale request cannot open even if the close finishes in the same commit as the change.
- **No new mechanisms.** No listener, timer or provider was added.
- **Unchanged behaviour.** Opener focus on the header menu button, the Escape return, destination focus, direct Search on desktop, layout and locale all work as before.

New regressions in `c-sidebar-2.test.tsx` use the same real Sheet, `GlobalSearchProvider` and `SearchDialog`. Each test renders with `preserveProviders` and clicks the drawer Search row. It asserts that Search has not opened, then rerenders `Pattern` before the deferred close focus hand-back runs:

- **Context changes.** A different organization (`org-b`), selected warehouse (`wh-2`), HR actor (`org-a:user-b`) or route (`/hr/today`). After settling, the drawer is closed and no Search dialog exists.
- **Control.** A rerender in the same context still opens Search. This proves the rerender itself does not cancel the request, so the context cases fail if identity clearing is removed.
- **Unmount.** Unmounting before the close finishes leaves no Search dialog.

Organization ID, warehouse ID and actor key are now mutable mock state, reset in `beforeEach`. The workspace mock lists a second warehouse (`WH-2`). All eight earlier mobile, desktop and focus tests are unchanged and pass.

## Tests (targeted)

**`LocaleSwitcher.test.tsx`.** Existing URL-suffix and resume cases are kept, with option names updated to text-only. New cases:

- the menu lists text-only names in both modes;
- the compact trigger is named after the current language.

Integration cases use the real `DraftGuardProvider`, `useDraftGuard` and an unmocked `guardedNavigate`:

- **Keep editing.** The prompt appears and Keep editing preserves the draft and the current-language trigger, with no `replace` and no `history.back`.
- **Discard.** `history.back` (the buffer release) runs first, and `replace` runs only on the resulting popstate. It uses the selection-time query and hash, including duplicate and encoded params, even though the URL changed while the prompt was open. The draft is cleared.
- **Pending.** The pending notice shows and Discard is disabled. Clicking it does nothing, and the draft and language are kept.
- **Same language.** Choosing the current language shows no prompt.

**`c-sidebar-2.test.tsx` (new).** It renders the real `Pattern` with the real Sidebar mobile Sheet, `SidebarSearchTriggers`, `GlobalSearchProvider`, `SearchDialog` and `DraftGuardProvider`. Only data providers, Convex, routing/Link, the account button, the HR landing redirect and the link-pending indicator are mocked.

- **Phone header.** No Search button, no picker and no warehouse text. The language combobox is named "Language English".
- **Phone drawer.** Exactly one `warehouse-select` in the document, inside the drawer, showing "WH-1 · Main warehouse". There is exactly one Search row and one AI Search row.
- **Task route.** The drawer shows the selected warehouse and no picker.
- **Search handoff.** Search has not opened right after the click. A MutationObserver confirms the drawer and Search were never in the DOM together. The input takes focus, and Escape returns focus to the header menu button. A mutation check that removed the explicit opener focus made this test fail; the source was restored afterwards (sha `044fb74c…`).
- **AI Search handoff.** Opens in AI mode. After a chosen result, `push('/hr/settings?section=holidays')` is called and the destination section keeps focus.
- **Ordinary closes.** Escape and a nav link close the drawer without ever opening Search.
- **Desktop.** The header keeps the picker and the language combobox ("Language", showing "English"). Search stays in the sidebar, once. The task route shows the selected warehouse in the header. The sidebar row opens Search directly.

Not covered in jsdom: geometry, real touch-target size, the chevron and sr-only visuals, theme rendering, and the sheet's CSS exit animation timing. The `matchMedia` stub has no live breakpoint changes.

## Check results

Logs are in `…/mobile-nav/checks/`:

- **`prettier-initial.txt`.** One file needed formatting: `c-sidebar-2.test.tsx`.
- **`prettier-write.txt`.** Prettier fixed that file.
- **`prettier.txt`.** All six files pass, exit 0.
- **`eslint-initial.txt`.** One error: the `no-restricted-imports` rule fired on the Select primitives import. It was resolved as described above.
- **`eslint.txt`.** Six files, exit 0.
- **`vitest.txt`.** `vitest run --project unit` on LocaleSwitcher, c-sidebar-2, SearchDialogFocus and GlobalSearch: 4 files and 49 tests passed, exit 0.
- **`context-fix-vitest.txt`.** After the context fix, `vitest run --project unit` on c-sidebar-2 and LocaleSwitcher only: 2 files and 25 tests passed (c-sidebar-2 14, LocaleSwitcher 11), exit 0. SearchDialogFocus and GlobalSearch were not rerun because the fix does not touch them.
- **`context-fix-eslint.txt`.** ESLint passes on the two owned files, exit 0.
- **`context-fix-prettier.txt`.** Prettier passes on the two owned files and this report, exit 0.

Integrity:

- `before/` copies use the `.tsx.baseline` suffix and match `before-hashes.json` (checked with Python); its `snapshotPath` fields point to the current files.
- `after-hashes.json`, `owned-incremental.patch` (Python difflib against `before/`) and `checks/diff-summary.txt` were written.
- **Context fix.** `before-context-fix/` holds `.tsx.baseline` pre-fix copies of the two files, matching `before-context-fix-hashes.json`; current paths are recorded in `before-context-fix-snapshot-paths.json`. `context-fix-incremental.patch` is the two-file diff against those copies.
- **Final six-file state.** `after-hashes.json` and `owned-incremental.patch` (against `before/`) were regenerated with the final six-file state. The previous versions are kept as `initial-after-hashes.json` and `initial-owned-incremental.patch`. Only the two context-fix files changed: `c-sidebar-2.tsx` is now `c80c565e…` and `c-sidebar-2.test.tsx` is now `ee7e1fdf…`. The other four files keep their first-batch hashes.

## Pending (root-owned, not performed here)

No live browser validation was done. Root still needs to confirm:

- native widths of 375, 390, 768 and 1280 px, in light and dark themes;
- header fit and the 48 px flag target;
- warehouse name legibility in the drawer;
- a language change with a dirty HR draft, through Keep editing, Discard and pending;
- the drawer → Search handoff, including Escape focus and an accepted result, on a real device or browser;
- that a warehouse or organization switch, or a sign-in change, during the drawer close never opens a delayed Search.

The full checks (typecheck, full lint and tests, build) also remain with root.

Evidence snapshots were renamed from `.tsx` to `.tsx.baseline` after root preflight found that TypeScript included them. All nine snapshot bytes and hashes are unchanged; `output/hr-kiro-improvement-20261010/ui/evidence-snapshot-rename-proof.json` records the mapping. Application and test hashes still match the source freeze. Historical prompts and transcripts keep the paths used when executed.
