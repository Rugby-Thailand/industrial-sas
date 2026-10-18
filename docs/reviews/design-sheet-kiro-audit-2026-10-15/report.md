# Design sheet audit · Kiro · 2026-10-15

Scope: the current root sheet `docs/design-sheet/index.html` and every asset it loads, in cascade order: `tokens.css` → `styles.css` → `review.css` → `dist/controls.css` (react-day-picker `style.css` + `controls.css`). Scripts run in this order: `sheet.js` → `review.js` → `dist/controls.js`, built from `controls.tsx`, `ui/calendar.tsx`, `ui/popover.tsx` and `vite.config.mjs`. I also checked README, DESIGN.md, the evidence README/JSON, both check scripts and the adoption plan (whose served mirror is byte-identical) for consistency. Frozen variants and historical screenshots were treated as context only.

Evidence labels:

- **source-traced:** read in code or the cascade.
- **executed-probe:** a jsdom run or arithmetic in `probes/`.
- **browser-verified:** none. The parent T3 session owns browser checks and the detector.

Machine-readable form: [findings.json](findings.json).

## Summary

The sheet's foundations are careful. Civil dates are never passed through UTC. Focus returns correctly after selection and Escape. Nested popups dismiss in layers. The quiet-button and field-icon rules win the cascade as intended.

The serious problems are concentrated in the new picker behavior:

- **DS-A01:** confirming the already-selected date with Enter (the natural keyboard path) erases it.
- **DS-A02:** the time picker commits each Select change immediately, so Escape cannot cancel. The plan cites this preview as its model but specifies the opposite behavior.
- **DS-A03:** Thai users see 2569 while assistive technology announces 2026.

Several states are also invisible or contradict the sheet's own rules: toggle selection (DS-A04), the Reading lock (DS-A05), pending versus disabled (DS-A06), select focus (DS-A07) and dark-mode printing (DS-A08). One architecture caveat sits under many of these: the "actual shadcn" components share behavior with the app but not its styling (DS-A09).

Counts: 1 × P1, 10 × P2, 9 × P3. No P0.

Provisional score (impeccable audit rubric, source and probe evidence only, not a certification): Accessibility 2 · Performance 3 · Theming 3 · Responsive 3 (unverified layout) · Implementation integrity 2 = **13/20, Acceptable**.

## Confirmed defects

### P1

**DS-A01 · Confirming the already-selected date clears it** (`controls.tsx:155,160,169`; `react-day-picker/dist/esm/selection/useSingle.js:21`)

- **Trigger:** open any date picker. Focus lands on the selected day; press Enter or click that day.
- **Actual:** the Calendar runs in `mode="single"` without `required`, so react-day-picker deselects the day and calls `onSelect(undefined)`. The handler commits `""` and closes the popover; the trigger reads "Pick a date". In the scan ticket this erases the delivery or MFG date from the draft.
- **Expected:** re-confirming keeps the value. Clearing happens only through Clear date.
- **Evidence:** executed-probe `probe-controls.cjs` A: `sourceValue:""`, `triggerText:"Pick a date"` for both Enter and click.
- **Fix:** pass `required`, or ignore `undefined` in `onSelect`, and add a regression case.
- **Confidence:** high.

### P2

**DS-A02 · Time picker commits every Select change; Escape, outside click and Done cannot cancel** (`controls.tsx:120,137,144`; plan line 177)

- **Actual:** choosing hour 23 sets the source to `23:30` while the popover is still open, and Escape leaves it at `23:30`. Done only closes the popover.
- **Expected:** the plan's TimeField, described as "ตาม preview", keeps a popup draft. It commits on Done only, disables Done while incomplete, and lets Escape or outside click discard the draft.
- **Evidence:** executed-probe `probe-time-focus.cjs`.
- **Fix:** local draft state initialised when the popover opens. If the immediate-commit behavior is intended, correct the plan instead.
- **Confidence:** high.

**DS-A03 · Thai calendar is announced in Gregorian years** (`controls.tsx:158,163,70`; `react-day-picker/dist/esm/locale/th.js:9`; README:16; plan:171)

- **Actual:** only `formatCaption` is overridden. Visible text shows `14 ต.ค. 2569` and `ตุลาคม 2569`, but the grid is named `ตุลาคม 2026` and days are named like `วันพุธที่ 14 ตุลาคม 2026, เลือกแล้ว`. In English, display uses en-GB while the calendar uses enUS labels and starts weeks on Sunday; the plan specifies Monday and `react-day-picker/buddhist`.
- **Evidence:** executed-probe B.
- **Fix:** use the Buddhist calendar or override the labels with the th-TH Intl formatter, align the locales, and assert Thai accessible names in the controls check.
- **Confidence:** high.

**DS-A04 · Selected and pressed toggle states are invisible** (`review.js:406,332,407`)

- **Actual:** the Products / Storage units switch toggles `btn secondary` / `btn ghost`, and neither class is defined in any loaded stylesheet. The capture-method buttons and Filters set `aria-pressed`, which nothing styles. Active and inactive look the same, unlike the workflow tabs (`styles.css:405`).
- **Evidence:** source-traced (rg finds no rules); executed-probe H.
- **Fix:** an explicit selected/pressed treatment.
- **Confidence:** high.

**DS-A05 · Reading lock leaves text inputs looking editable** (`review.js:367`; `styles.css:491,253`; `review.css:82`; `controls.css:50`; README:16)

- **Actual:** all inputs become disabled, but `.field input` author styles override the UA disabled look and no `:disabled` rule exists, so the text fields look enabled. In the same field group, Select and date triggers look disabled. The scanner button gets the `.btn:disabled` fill, because `styles.css:253` follows `.btn.quiet` at equal specificity, so a grey slab appears inside an enabled-looking field.
- **Evidence:** cascade source-traced; executed-probe G confirms the disabled flags.
- **Fix:** add `.field input:disabled` and keep the in-field action transparent.
- **Confidence:** high for the cascade, medium for exact rendering.

**DS-A06 · Pending write is shown as disabled** (`review.js:521`; `index.html:381`; DESIGN.md:281; plan:55)

- **Actual:** Pending renders a `disabled` "Saving…" button with no `aria-busy` and the grey disabled surface. This contradicts the sheet's own "Disabled, saving, and destructive states remain distinct", DESIGN.md's "pending actions keep their resting appearance", and the plan.
- **Evidence:** executed-probe H.
- **Fix:** primary surface plus spinner, `aria-busy`/`aria-disabled`, and clicks ignored.
- **Confidence:** high.

**DS-A07 · Keyboard-highlighted and checked options look the same** (`controls.css:100,113`)

- **Actual:** one rule gives `[data-highlighted]` and `[data-state=checked]` the same accent fill, and items have `outline: none`. In long lists (60 minutes) keyboard position is ambiguous; the only difference is the small check icon.
- **Evidence:** source-traced.
- **Fix:** separate the two treatments.
- **Confidence:** high for source, medium for perceived impact.

**DS-A08 · Printing from dark mode keeps dark-only inks** (`styles.css:1429,31`; `tokens.css:29`; `review.css:164,172`; `sheet.js:657`; DESIGN.md:303)

- **Actual:** the print block resets the `--token-*` surfaces but not `--sheet-status-*`, `--token-disabled*`, `.dark .badge.accent` or `.dark .badge.app-success`. Printed badges calculate to 1.27–1.41:1 and the earlier-ink example to 1.91:1. The disabled specimen prints as a #1d1d1d slab, and the token list prints dark values beside light swatches.
- **Evidence:** cascade source-traced; contrast arithmetic `probe-contrast.cjs`. Not printed in a browser.
- **Fix:** complete the print resets, or switch theme on `beforeprint`.
- **Confidence:** high.

**DS-A09 · shadcn/Tailwind styling is inert in the sheet** (`vite.config.mjs:5`; `ui/calendar.tsx:39`; `ui/popover.tsx:31`; `src/components/ui/select.tsx:31`; `controls.css:13`)

- **Actual:** the island has no Tailwind build; `dist/controls.css` contains no utilities. Every app class contract is a no-op, including placeholder muting, `focus:bg-selected`, `disabled:*`, `aria-invalid:*`, the focused-day ring and the popover shadow. `controls.css` plus rdp defaults supply all visuals; for example, "HH" and "Pick a date" render in body ink.
- **Impact:** behavior parity is real; visual parity is not. Visual decisions approved here will not carry over to the app.
- **Fix:** compile a scoped app theme for the island, or document the split and style each state on purpose.
- **Confidence:** high.

**DS-A10 · Preview diverges from the plan contracts it is cited as modelling** (`controls.css:95,145`; `review.css:115`; `controls.tsx:153`; plan:43,171,346; DESIGN.md:261)

- Select items are 32/40px; the plan keeps menu items at 36/48.
- Calendar days are 32/36px; DESIGN.md says standalone targets keep 36/48.
- The Filters button is shrunk to field height; the plan says don't shrink buttons beside fields.
- DateField: the preview has Sunday start, no min/max, the system clock as today and caption-only BE; the plan specifies all of these differently.
- Time draft semantics differ (DS-A02).
- **Fix:** one source of truth per item, or a deviations list in the plan.
- **Confidence:** high.

### P3

**DS-A12 · Calendar inherits un-reset react-day-picker defaults** (`controls.css:142,178,160,194`; rdp `style.css:157,286`)

- **Actual:**
  - The selected day inherits `.rdp-selected { font-size: large }` through `font: inherit`, so its numeral is about 18px.
  - `.rdp-chevron { fill: accent }` fills the open lucide chevron paths into blue wedges.
  - Weekday headers and outside days keep 0.75 opacity, which calculates to about 4.09:1 on white (arithmetic only).
- **Evidence:** executed-probe B (classes); source-traced. Rendering not verified.
- **Confidence:** medium-high.

**DS-A13 · Job No. error text comes back after a locale switch while the field is valid** (`index.html:413`; `sheet.js:693,844`)

- **Actual:** `#required-error` carries `data-i18n`, so the locale switch rewrites it regardless of validity. The error reappears while `aria-invalid="false"` and the input still references it.
- **Evidence:** executed-probe D.
- **Confidence:** high.

**DS-A14 · Script failure removes fields with no fallback** (`controls.css:2`; `index.html:17`; `controls.tsx:228`)

- **Actual:** `display: none !important` hides the selects and date/time sources whether or not a replacement mounted. With the CSS loaded but `controls.js` failed, Review state, Unit type, Per page, Date and Time vanish without a message. They are also hidden before the deferred mount runs.
- **Evidence:** executed-probe N (computed `display: none` for all four).
- **Fix:** gate the rule on a ready class set by `controls.js`.
- **Confidence:** high.

**DS-A15 · Accessible names omit visible text or mix toggle semantics** (`index.html:57`; `sheet.js:661`; `review.js:407`)

- "ไทย" is named "Switch to Thai".
- The "Ready only" chip is named "Clear filters".
- The theme button combines `aria-pressed` with a flipping "Switch to … mode" label.
- This conflicts with the intent of WCAG 2.5.3; not certified.
- **Confidence:** high.

**DS-A16 · Thai mode leaves English accessible names and an English date** (`index.html:26,47,97,155,368`)

- **Actual:** the wordmark, nav, tablist and "Saving example" names stay English, and the proposal date stays "9 October 2026". The saving specimen's `aria-label` sits on a role-less span, where it is not reliably exposed.
- **Confidence:** high.

**DS-A17 · Loading totals are bare "…"** (`review.js:405`)

- **Actual:** no accessible loading text and no `aria-busy`.
- **Confidence:** medium.

**DS-A18 · Build copies the app's `public/` into the sheet's dist** (`vite.config.mjs:12–13`; README:18)

- **Actual:** dist holds the 966 KB zxing wasm, F1/F2 reference HTML, icons and the manifest, next to the 406 KB minified IIFE. `emptyOutDir` deletes anything else placed there.
- **Fix:** `publicDir: false`.
- **Confidence:** high.

**DS-A19 · Evidence and status text overstate coverage** (`check-adoption.cjs:11,47`; README:59; `review.js:120`)

- **Actual:**
  - Both checks still pass when re-run as copies (1,624/68/16 and 18/18).
  - check-adoption never loads `controls.js`, so its axe and label checks examine the hidden native fallbacks, not the Radix triggers users operate. README:59 omits that caveat; `evidence/README.md` states it.
  - The JSON keeps `date: 2026-10-11` and `sourceBaseline: 733c6aca`.
  - No check covers DS-A01/02/03/04/11.
  - The in-sheet adoption copy omits the 2026-10-15 text-button rule.
- **Confidence:** high.

## Design and coverage gaps

**DS-A11 (P2) · Time value cannot be empty or cleared; the composition defaults silently or emits invalid values (latent)** (`controls.tsx:69,72,137`; `index.html:426`)

- **Trigger:** not reachable from the current UI, because the only time field starts at 08:30 and has no clear action. Probe: set the source to `""`.
- **Actual:** `[hour = "08", minute = "30"] = "".split(":")` gives hour `""` and minute `30`. Picking minute 45 first commits `:45`; picking hour 09 first commits `09:30` with an unchosen minute. The empty trigger is named "Time: --:--".
- **Expected:** the plan forbids silent defaults and requires clearable times when the caller allows.
- **Evidence:** executed-probe C.
- **Confidence:** high.

**DS-A20 (P3) · Field-state coverage omits invalid, disabled, read-only and pending controls** (`index.html:419`; `controls.css:13`; `controls.tsx:201`)

- **Actual:** there are no invalid, disabled, pending or read-only specimens for Select, Date or Time. No `[aria-invalid]` trigger style exists, `invalid`/`describedBy`/`pending` are never passed, and no read-only text field appears anywhere. There is no min/max date, so an MFG date after the delivery date, or in the future, is accepted.
- **Expected:** the plan's line 241 state matrix.
- **Confidence:** high.

## Unverified risks and questions

- **Truncated Thai unit type at 801–900px:** in the three-column scan row the Unit type column bottoms out at 120px, and "หีบห่อ / กล่อง" plus the icon slot may truncate with an ellipsis. Needs browser layout.
- **Quiet icon-only buttons:** the theme toggle and Remove #1 keep a hover fill and the 1px press movement. The confirmed direction covers text-only quiet buttons and field icons only. Should icon-only quiet buttons follow either rule?
- **Live regions:** `review-notice` (Refused, Denied, Not confirmed) uses `role="status"` and is injected together with its content, so announcements on a state switch are unreliable, and errors are polite rather than assertive. That is acceptable for a state browser, but confirm the intended semantics for adoption.
- **Re-render cost:** `refresh()` re-renders every React root with `flushSync` on each keystroke in the scan form (`review.js:604`). It is cheap at six roots and not measured.
- **Touch and physical devices:** Radix Select inside a Popover on real touch hardware, coarse-pointer density and physical camera paths are not exercised here.

## Rejected suspects

- **Quiet text buttons still get a hover fill (`styles.css:230`) or the 1px press (`styles.css:250`):** overridden by `review.css:24–36`, which is later and at equal or higher specificity.
- **Field-scan hover or movement:** neutralised by `controls.css:57–70`, which loads last.
- **768–800px fine-pointer viewports picking up the `styles.css` @800px touch sizes:** the later `review.css` media rule wins, so fields are 32px/14px and buttons 36px.
- **Stale dist:** the build (22:18:30) is newer than every source, and the new strings are present in the bundle.
- **Plan mirror drift:** the mirror is byte-identical (cmp).
- **"Application primary #1d4ed8" being wrong:** it matches `src/app/globals.css:217`.
- **Nested Select closing the time popover:** it doesn't. Escape closes only the listbox (probe Q).
- **Focus loss after a date selection or Review-state change:** no loss. Focus returns to the trigger and to `#review-state-control`.
- **Floor schematic scale:** consistent at 20 units per metre.
- **Thai mid-word breaks from `overflow-wrap: anywhere`:** dictionary line breaking applies first, so this is not substantiated.
- **40px touch fields:** confirmed user direction, not a WCAG failure.
- **Missing camera, backend or persistence:** intentional for a synthetic preview.

## Positive foundations

- `parseCivilDate` and `civilValue` build dates at local noon and validate round-trips, never via `toISOString`.
- Draft values survive tab, locale and Review-state changes.
- Popovers return focus on selection and on Escape. Nested Escape is layered correctly. Disabling closes an open picker.
- The text-only quiet button and field-icon rules are correct in the actual cascade.
- The density query is consistent across the 768/800/520 breakpoints.
- Reduced motion, local fonts and no runtime CDN.
- Both existing checks pass. `evidence/README.md` and `shadcn-ui-checks` state their limits honestly.

## Probe files

All files are in `probes/`, read-only against the sheet:

- `probe-controls.cjs`
- `probe-time-focus.cjs`
- `probe-contrast.cjs`
- `check-adoption-copy.cjs` (output redirected to `probes/adoption-checks-rerun.json`)
- `check-controls-copy.cjs`

Run them from the repository root with `node <file>`.
