# Kiro review: HR self-service design preview

11 October 2026 · standalone prototype scope (`preview/`, `plan.md`, `review/`)

## Run history

The first Kiro run (`kiro-session.log`) read the artifact and found the defects, then stalled without finishing. It left `app.js` half-edited. It had declared `holidayYear`/`payslipYear`, but the holiday page, holiday CSV, reset and year handler still used an undeclared `year`. Under `'use strict'` those paths would throw. It had also added unused helpers and persona functions.

This retry (`kiro-retry.log`) did not repeat the image, source or baseline inventory. It patched `preview/app.js`, `preview/styles.css` and `plan.md` in place and added `review/kiro-extra-qa.cjs`. Images, prompts, the manifest and application files were not edited. The repository already had application changes (`git status`) before this run; the final root comparison against `application-baseline.json` remains authoritative.

## Findings and fixes

1. **Shared year state.** Holidays and payslips now have separate `holidayYear` and `payslipYear` selections. The leftover `year` references are removed. Reset restores both.
2. **Invalid replacement import.** A file change now does these things before the async read: increments `importToken`, clears staged rows, the period binding and the published state, then renders. When the read finishes, the result is discarded if a newer read, a reset, a role change away from HR, navigation or a period change happened in between. A failure shows the file name, the actual error, and that earlier rows were cleared. Staged rows are bound to the period chosen when they were checked (`importFor`). Changing the period clears them, and Publish requires a match.
3. **Grid card offsets and mobile leave.** `.panel + .panel` margins are now zero for direct children of `.cols`, `.stack`, `.shortcut-grid`, `.balance-grid`, `.sample-lanes`, `.half` and `.gallery-grid`. `.stack` uses `align-content:start`, so stacked items no longer stretch (the review page's info notice had stretched to row height). Leave balances use a new `.balance-grid`: 3 columns on desktop, one full-width column at 700px and below, with one-line Thai headings. Shortcut menus keep 2 columns on mobile.
4. **Correction evidence.** Request detail and the review screen used to always say the original was missing. They now read the matching day and show original (recorded) / effective now / proposed. Approval changes only the effective value. Clocking out now also records `originalEnd`, so day 12 has a real original punch. The attendance CSV exports both values.
5. **Guards and validation.**
   - Preferences: dirty state is calculated by comparing against the saved preferences. Save is disabled when nothing changed, an unsaved indicator is shown, and Cancel discards explicitly.
   - Dates: leave, policy and announcement dates go through `validIso`. A start date after the end date is rejected.
   - Whitespace-only reasons, titles, policy names and search text are rejected or ignored.
   - Policy: carryover cannot exceed the allocation, values must be in 0.5-day steps, and they must be whole days when half-day leave is off. Saving identical v2 values is rejected.
   - Review: a decision on a request that is no longer pending makes no change and shows a toast. Draft re-save updates the same draft, and publishing a loaded draft removes it.
   - Money: imported and payslip totals are summed in integer satang (0.1 + 0.2 shows ฿0.30). Import cells are trimmed, and empty cells never become 0.
   - Roles: actual action handlers check the synthetic role: employee for clock, requests, payslips and notifications; supervisor/HR for decisions; HR for policy, publish and import. A toast labels this as demo-only, not server security.
6. **Drawer and dialog focus.**
   - The closed mobile drawer uses `visibility:hidden`, so Tab and assistive technology cannot reach its links.
   - While the drawer is open, `.shell` and the skip link are `inert`. Escape or a backdrop click returns focus to the menu button. A link to the current page closes the drawer and focuses the main content; a route change focuses the main content.
   - The drawer closes when the viewport widens to desktop.
   - The native dialog returns focus to the button that opened it, or to Hide after verification. Clicking the backdrop closes it, and it closes on route changes.
   - Verification expires after 60 seconds and is cleared on period/page or role changes. The dialog has no inputs, so it never takes a password or PIN.
7. **UI and plan agree.**
   - Policy: after saving, the form keeps the saved v2 values and a version panel lists them.
   - Import: rows are labelled "จะเผยแพร่", "เลือกอยู่ · ต้องไม่เลือก" or "ไม่รวม · ไม่เผยแพร่", and excluded rows are shaded. The Publish button and the success notice name the month and v1.
   - The review heading uses the active persona.
   - `plan.md`'s coverage table and states paragraph now describe these behaviours.

## Checks (final run, after all edits)

| Check | Result |
| --- | --- |
| `node --check` on app.js, preview-qa.cjs, edge-qa.cjs, kiro-extra-qa.cjs | pass |
| `node review/preview-qa.cjs kiro` | 17/17; 0 console errors; no overflow at 1440 or 390 across 23 routes (`kiro/results.json`, screenshots in `kiro/`) |
| `node review/edge-qa.cjs kiro` | 5/5 (`edge-kiro.json`). The two initial failures (years, invalid replacement import) now pass; the 60-second expiry passes |
| `node review/kiro-extra-qa.cjs` | 10/10, 0 errors (`kiro-extra.json`): grid margins/top alignment, matching-day correction evidence, policy persistence/constraints, whitespace and invalid dates, satang rounding/exclusion/period binding, role guards, preference dirty state, dialog focus/no secret input, drawer keyboard/inert/Escape/backdrop/route, mobile leave stack (`kiro/leave-mobile-stack.png`) |

The harness timing and isolation needed no changes; no existing check was weakened. Screenshots of mobile leave, mobile import and desktop review were inspected. The `.stack` stretch and the persona heading were fixed after that inspection, and all three suites were re-run afterwards.

## Remaining limitations

- This is a local synthetic prototype. Role gates, masking and verification are client-side demonstrations, not authorization or security. Real enforcement belongs to the server, as `plan.md` states.
- The policy screen models one scheduled v2 only. Multiple future versions and transition rules are still policy decisions.
- The CSV parser is a simple comma split with no quoted-field support; sample files are synthetic.
- The checks ran in headless Chromium only. Safari/Firefox, real screen readers and physical devices were not tested. Full-page mobile screenshots show the fixed bottom nav over the content, which is a capture artifact.
- Production HR features remain unimplemented.

## Verdict

**Ship** at standalone prototype scope. No rebuild or image recapture is needed. The fixes are in place, and the screenshots in `review/kiro/` come from the final suite run, after every edit.
