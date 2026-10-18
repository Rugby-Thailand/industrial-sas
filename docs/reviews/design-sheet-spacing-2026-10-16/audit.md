# Design sheet spacing audit — 16 October 2026

The spacing system is mostly consistent inside fields, but **eight issues remain: five P2 issues and three P3 refinements**. No blocking spacing problem was found in the inspected scenarios. The main causes are reserved empty feedback rows, broad CSS selectors overriding local spacing, stacked margin/gap rules, and wrapping controls without preserving their semantic groups.

This is a **spacing audit**, not a full accessibility, performance, or production-app audit. No UI source was changed during this audit.

## Scope and evidence

- Current standalone preview: `docs/design-sheet/index.html`, its shared styles, `review.css`, `controls.css`, and dynamically rendered Scan, Catalogue, Floor plan, and My day specimens.
- **62 rendered scenarios**, **110 selector families**, and **971 repeated field measurements**. These counts include repeat observations across sizes and states, not 971 unique controls.
- English at **1280, 1024, 768, 390, and 320 CSS px**; Thai at **1280 and 320 px**. All four normal workflows at 1280/390/320 in English and 1280/320 in Thai; Scan and Catalogue at 1024/768.
- All selectable non-normal review states at 1280 and 320 in English: scan reading/view-only; catalogue loading/unavailable/view-only; floor unknown/view-only; HR pending/uncertain/refused/denied/unlinked/unresolved.
- Expanded optional fields; populated/empty time popups; date and select popups; filtered/no-result catalogue and successful scan states.
- Real browser layout measurements, with desktop/mobile viewport emulation and the browser's fine pointer. Physical touch devices, actual browser zoom, print, frozen variants and production pages were not exercised.
- Geometry is in **CSS pixels**, not screenshot pixels. The mobile screenshots have a 2× pixel ratio. A line-box gap is different from the optical gap between the border and actual glyphs.
- [Measurements and inventory](measurements.json) contain computed margins, padding, gaps, field/icon measurements and the relevant element rectangles.
- The Impeccable layout detector returned `[]`. It did not detect the cascade, reserved-space or semantic grouping issues below; browser inspection supplied that evidence.

## Findings

### G01 · P2 · Empty feedback rows add space even when nothing happened

**Where:** [styles.css:792](../../design-sheet/styles.css#L792), [styles.css:991](../../design-sheet/styles.css#L991); `#control-feedback` and `#workflow-feedback`.

**Measured:** the workflow status reserves **18px height + 12px margin = 30px** while empty. With the panel's 20px bottom padding, the last action sits **50px from the panel's bottom edge**. The controls status reserves **18px + 16px = 34px**. Including the next chapter's 40px margin, border and 24px top padding, the next heading is **99px below the last field-state group** on desktop.

**Impact:** empty space looks like excessive section padding and makes compact tasks taller without showing useful information.

**Correction:** keep the live-status DOM node for announcements, but make its height/margin zero when there is no message. Add an **8px** message gap only when content exists. Keep normal panel padding and chapter separation. Do not remove the panel's independent minimum height merely to eliminate this feedback-row spacing.

### G02 · P2 · Date/time help is farther from its fields than from an unrelated explanation

**Where:** [styles.css:782](../../design-sheet/styles.css#L782); `.controls-grid .field-grid + p`.

**Measured:** the date/time input row is **16px** above “Select a date or a 24-hour time.” That paragraph has **0px** additional gap before the general “Errors explain recovery…” explanation. Actual field hint/error elements now correctly use **4px**.

**Impact:** proximity associates the picker instruction with the general design note instead of the controls it describes.

**Correction:** use **4px** from the date/time group to its help text, then **8px** before the separate explanatory note. Use a specific relationship/class rather than a broad adjacent-paragraph selector.

### G03 · P3 · Field-demo row spacing overrides its own 16px rule

**Where:** [styles.css:772](../../design-sheet/styles.css#L772), [styles.css:779](../../design-sheet/styles.css#L779), [controls.css:356](../../design-sheet/controls.css#L356).

**Measured:** both field-grid examples get **20px** above them. The intended `.picker-specimens { margin-top: 16px }` loses to the more specific `.controls-grid .field-grid` selector. Button-example groups also use 20px while the documented task-section rhythm is 16px.

**Impact:** the stylesheet declares one value and renders another; sample groups feel looser than the task-section rhythm taught by the sheet.

**Correction:** use **16px** for heading-to-demo and between these demo groups, keeping **8px** between adjacent fields/buttons and **4px** for their help. Scope the rule so the picker setting actually wins. This is a refinement, not a reason to reduce every documentation gutter.

### G04 · P2 · Mobile pagination separates controls that belong together

**Where:** [review.css:329](../../design-sheet/review.css#L329), [review.js:460](../../design-sheet/review.js#L460); `.pagination-example`.

**Measured:** at 390px English, “Previous” and “Page 1” stay on the first line while **“Next” sits alone on the second line**. At 320px English, “Previous” is on one row and “Page 1 / Next” on the next. The pagination group becomes **104px tall**, with a 130px footer. Thai at 320px also leaves “Next” alone.

**Impact:** raw flex wrapping breaks the relationship between previous/page/next and consumes unnecessary height.

**Correction:** create two wrapping units: **page-size label + select**, and **Previous + page + Next**. Use **8px within each unit** and **12px between units**. Keep the navigation trio together on phones; its measured width fits the available area.

### G05 · P2 · Floor-inspector margins compound with its mobile grid gap

**Where:** [styles.css:1095](../../design-sheet/styles.css#L1095), [styles.css:1388](../../design-sheet/styles.css#L1388).

**Measured:** the inspector heading-to-details gap is **8px on desktop**, but **20px on mobile** because the existing 8px heading margin adds to the new 12px grid gap. The desktop details-to-Inspect separation also reaches **20px** through the trailing detail margin and button margin.

**Impact:** related location attributes become more disconnected on the smaller layout, despite having less space.

**Correction:** give each relationship one spacing owner. Use **8px heading → attributes**, **12px between attribute groups / before the action**, and reset the child margins that duplicate those gaps when the inspector becomes a grid. Keep the 2px attribute-label/value gap.

### G06 · P2 · Success and no-result content have missing separation

**Where:** [review.js:374](../../design-sheet/review.js#L374), [review.js:510](../../design-sheet/review.js#L510).

**Measured:** after saving a scan, the explanatory stock note directly touches the action toolbar with **0px box gap**. In a no-result catalogue, the empty-state heading begins **0px after the table/header region**.

**Impact:** actions run into the preceding explanation; the no-result message looks attached to the table header rather than presented as the result state.

**Correction:** add **12px** above the successful-scan action group and **12px** above the no-result content. Keep the empty-state's existing internal **8px** text spacing and **16px** copy-to-action spacing.

### G07 · P3 · Intermediate-width gutters expand while the design guide says they tighten

**Where:** [styles.css:1144](../../design-sheet/styles.css#L1144), [DESIGN.md:257](../../design-sheet/DESIGN.md#L257).

**Measured at 1280 → 1024px:** workspace gutter **24 → 32px**; foundation/control/layout column gutters **32 → 40px**; page vertical padding **32 → 40px**. The layout still has two columns in this range.

**Impact:** the narrower screen loses additional usable content width, and implementation contradicts the stated responsive rule.

**Correction:** at 801–1100px, use **24px** column/workspace gutters and keep **32px** page vertical padding. The **40px vertical separation after columns stack** is a different relationship and can stay.

### G08 · P3 · Time-picker fields and actions use different inner gutters

**Where:** [controls.css:324](../../design-sheet/controls.css#L324), [controls.css:350](../../design-sheet/controls.css#L350).

**Measured:** the minute field's right edge is **4px inward** from the Done button/action group's right edge, because the fields have 4px inner padding and the action group does not. This occurs at both inspected widths.

The completed picker also has **30px from field bottom to action top**, including a blank 18px status line. That reserved line can intentionally prevent Done from moving when validation copy appears, so it is **not counted as a separate defect**.

**Correction:** align fields, status and actions to the same inner gutter. If compacting the empty validation area, target **12px** field-to-action separation and deliberately handle validation appearing/disappearing; otherwise retain the stable status slot and document that exception.

## Element-by-element disposition

“Keep” means no spacing defect was established in this audit. Values are CSS layout gaps or padding; borders and text line boxes can add optical space. The 110-family raw inventory is in `measurements.json`; related selectors are grouped below for readability.

| Element / relationship                    | Observed spacing                                                                   | Disposition                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Page side padding                         | 32px desktop; 24px intermediate stacked layout; 16px phone                         | Keep                                                                                |
| Page top/bottom padding                   | 32px normally; 40px at 801–1100px                                                  | G07                                                                                 |
| Header outer padding                      | 12px vertical; 32/24/16px horizontal                                               | Keep                                                                                |
| Brand icon → wordmark                     | 12px desktop; 8px phone                                                            | Keep                                                                                |
| Wordmark title → subtitle                 | Two adjacent 20px line boxes                                                       | Keep; one identity group                                                            |
| Header navigation links                   | 24px normally; 16px intermediate                                                   | Keep                                                                                |
| Header controls                           | 8px; 0px between full-size hit areas on phone                                      | Keep; visible icons remain separated inside their targets                           |
| Intro columns / stacked blocks            | 48px desktop; 24px stacked                                                         | Keep; documentation composition                                                     |
| Intro headline → description              | 20px desktop; 16px phone                                                           | Keep; hero copy is not a compact form                                               |
| Proposal note text/date                   | 12px spacing; date changes to inline on smaller layouts                            | Keep                                                                                |
| Intro → workspace                         | 32px normally; 40px at the intermediate stacked breakpoint                         | Keep                                                                                |
| Section title/subtitle                    | 12px flex gap; 4px on phone                                                        | Keep                                                                                |
| Section heading → content                 | 16px; 12px phone                                                                   | Keep                                                                                |
| Workspace explanation → specimen          | 24px normally; 32px at intermediate width                                          | G07                                                                                 |
| Direction title → description             | 16px desktop; 8px stacked                                                          | Keep                                                                                |
| Principle items / title → detail          | 12px between entries; 4px title → detail                                           | Keep                                                                                |
| Specimen context bar                      | 12px vertical; 24px horizontal, 16px phone                                         | Keep                                                                                |
| Context icon → warehouse code             | 8px                                                                                | Keep                                                                                |
| Workflow tabs                             | 24px apart, 24px horizontal inset / 16px phone                                     | Keep                                                                                |
| Review-state label → select               | 8px; row padding 8px × 20px, 16px phone inset                                      | Keep                                                                                |
| Task-panel padding                        | 20px; phone 20px vertical / 16px horizontal                                        | Keep                                                                                |
| Workflow title → subtitle                 | 4px                                                                                | Keep                                                                                |
| Workflow heading → content                | 16px; 12px phone                                                                   | Keep                                                                                |
| Location icon/code/status/action          | 12px; 8px phone                                                                    | Keep                                                                                |
| Location row → stock note                 | 4px effective gap                                                                  | Keep                                                                                |
| Stock note → capture toolbar              | 8px normally; 0px after successful save                                            | G06 for success state                                                               |
| Capture toolbar buttons                   | 8px; 4px phone                                                                     | Keep                                                                                |
| Button icon → text                        | 8px                                                                                | Keep                                                                                |
| Toolbar → review advisory                 | 12px                                                                               | Keep                                                                                |
| Advisory icon → text / next group         | 8px horizontal; 16px below                                                         | Keep                                                                                |
| Ticket heading → required fields          | 8px                                                                                | Keep                                                                                |
| Field label → input                       | **2px** in every measured field                                                    | Keep                                                                                |
| Field → helper/error                      | **4px** in every measured helper/error field                                       | Keep                                                                                |
| Horizontal/vertical required-field gap    | 8px                                                                                | Keep                                                                                |
| Optional field grid                       | 8px; 8px top/bottom padding                                                        | Keep                                                                                |
| Quantity pair group label                 | 2px to its row desktop; 8px when stacked                                           | Keep; nested group, not the individual input label                                  |
| Desktop optional-row alignment            | Taller quantity group adds 20px above neighboring field labels                     | Keep; input bottoms align, not an accidental extra row margin                       |
| Scanner icon vertical alignment           | **0px center offset**, 16px icon                                                   | Keep                                                                                |
| Select/date/time/read-only icon alignment | **0px center offset**, 16px icons                                                  | Keep                                                                                |
| Search icon vertical alignment            | **0px center offset**, 16px icon                                                   | Keep                                                                                |
| Input text insets                         | 10px ordinary start; 38px for search; scanner reserves trailing slot               | Keep                                                                                |
| Field heights                             | 32px desktop fine pointer; 40px small viewport                                     | Preserve; size changes are outside this spacing audit                               |
| Disclosure spacing                        | 8px above; summary retains its control height                                      | Keep; do not shrink its hit area to remove optical space                            |
| Save divider/action row                   | 12px above divider + 12px inner top padding                                        | Keep; two sides of a separator                                                      |
| Empty workflow feedback                   | 30px reserved, plus panel padding                                                  | G01                                                                                 |
| Specimen caption                          | 12px × 20px; 16px phone; 8px icon/text gap                                         | Keep                                                                                |
| Chapter boundary                          | 40px outer margin + 24px inner top padding + border; 32px outer on smaller screens | Keep as document structure; do not treat all 65/57px boundaries as input-level gaps |
| Foundation/control/layout columns         | 32px desktop; 40px intermediate and after stacking                                 | G07 only while still side by side                                                   |
| Section heading → explanatory copy        | 8px                                                                                | Keep                                                                                |
| Color strip                               | 24px above; cell padding 16/12/10px                                                | Keep                                                                                |
| Token list                                | 20px outer margin; 7px row padding; 16px columns / 8px phone                       | Keep; deliberate compact rows                                                       |
| Status chips                              | 8px between chips; 6px icon/text; 4px × 9px padding                                | Keep                                                                                |
| Typography specimens                      | 16px vertical row padding; 16px/6px internal gap                                   | Keep                                                                                |
| Action/field demo groups                  | 20px above                                                                         | G03: standardize these task demonstrations to 16px                                  |
| Date/time row → its help                  | 16px                                                                               | G02: 4px                                                                            |
| Picker help → general field explanation   | 0px                                                                                | G02: 8px                                                                            |
| Field-states heading → description        | 4px                                                                                | Keep                                                                                |
| Field-state grid                          | 12px above; 16px row / 8px column gap                                              | Keep                                                                                |
| State tag → field label                   | Flexible separation within same label row, 8px minimum                             | Keep                                                                                |
| Empty controls feedback                   | 34px reserved                                                                      | G01                                                                                 |
| State specimens                           | 24px grid gaps; 32px when vertically stacked on phone                              | Keep; separate example scenarios                                                    |
| Empty/error title → explanatory text      | 8px                                                                                | Keep                                                                                |
| Empty/error text → action                 | 16px effective gap                                                                 | Keep                                                                                |
| Skeleton rows                             | 12px; 12px to explanation                                                          | Keep                                                                                |
| Review notices                            | 12px outer margins; 8px vertical padding; 4px title/copy gap                       | Keep                                                                                |
| Empty / unlinked workflow minimum         | Panel retains 280px minimum height                                                 | Keep as stable preview frame; independent of G01's blank status row                 |
| Statistics                                | 16px cells; 4px metric label/value gap                                             | Keep                                                                                |
| Statistics → scope explanation            | 16px                                                                               | Keep                                                                                |
| Totals explanation disclosure             | 4px above                                                                          | Keep                                                                                |
| Catalogue view switch                     | 4px between buttons; 12px above / 8px below                                        | Keep                                                                                |
| Search → filter button                    | 8px; same field-height alignment                                                   | Keep                                                                                |
| Search → table                            | 16px                                                                               | Keep                                                                                |
| Active filter chip                        | 16px from search; 8px before table; 8px icon/text                                  | Keep                                                                                |
| Table cell padding                        | 10px vertical; 12px trailing                                                       | Keep                                                                                |
| Table main value → detail                 | 2px                                                                                | Keep                                                                                |
| Table → footer                            | 16px                                                                               | Keep                                                                                |
| Pagination internal gaps                  | 8px, with ungrouped wrapping                                                       | G04                                                                                 |
| Table header → no-results message         | 0px                                                                                | G06: 12px                                                                           |
| Floor map → inspector                     | 20px                                                                               | Keep; distinct map and metadata regions                                             |
| Floor map inset                           | 12px                                                                               | Keep                                                                                |
| Floor legend                              | 12px above and between entries; 5px swatch/text                                    | Keep; small optical exception                                                       |
| Inspector heading → attributes            | 8px desktop; 20px phone                                                            | G05                                                                                 |
| Inspector attribute label → value         | 2px                                                                                | Keep                                                                                |
| Inspector attribute groups                | 12px                                                                               | Keep                                                                                |
| Inspector attributes → action             | 20px desktop                                                                       | G05: one 12px owner                                                                 |
| Attendance columns                        | 24px; 16px phone                                                                   | Keep                                                                                |
| Attendance divider → label                | 12px padding after border                                                          | Keep                                                                                |
| Clock label → value                       | Adjacent line boxes; unrecorded hint has 2px margin                                | Keep; hierarchy comes from type size                                                |
| Attendance → View this day                | 16px                                                                               | Keep                                                                                |
| View this day → shift text                | 0px box gap, with space inside the button's full-height target                     | Keep; not equivalent to the bare text/action collision in G06                       |
| Shift metadata                            | 8px row / 24px column gaps                                                         | Keep                                                                                |
| Shift → HR action                         | 12px                                                                               | Keep                                                                                |
| HR action → policy                        | 20px                                                                               | Keep; separate policy note                                                          |
| Correction requests separator             | 16px outer + 12px inner top padding                                                | Keep                                                                                |
| Correction heading/action                 | 8px minimum horizontal gap; shared full-height action row                          | Keep                                                                                |
| Dropdown anchor → popup                   | 4px side offset in the adapter                                                     | Keep                                                                                |
| Dropdown list inset                       | 4px                                                                                | Keep                                                                                |
| Dropdown option inset                     | 10px start / 32px end; checkmark slot 8px from right                               | Keep                                                                                |
| Date/time popover inset                   | 8px                                                                                | Keep                                                                                |
| Calendar caption → grid                   | 4px                                                                                | Keep                                                                                |
| Calendar day grid                         | Contiguous aligned cells; no extra grid spacing                                    | Keep; intentional calendar structure                                                |
| Calendar → Clear                          | 4px                                                                                | Keep                                                                                |
| Time labels → hour/minute fields          | 2px                                                                                | Keep                                                                                |
| Time fields / separator                   | 8px between items; 4px inner field-row padding                                     | Keep                                                                                |
| Time fields → actions                     | 30px with reserved validation line                                                 | Design tradeoff noted in G08; do not silently remove stability                      |
| Time action right alignment               | 4px farther right than minute field                                                | G08                                                                                 |
| Time action buttons                       | 8px                                                                                | Keep                                                                                |
| Spacing-scale specimens                   | 24px between samples; 12px bar/label                                               | Keep                                                                                |
| Responsive-rule list                      | 12px between rows; 16px columns / 12px phone                                       | Keep                                                                                |
| Adoption block                            | 40px outer + 24px inner top spacing; 8px paragraphs; 12px before links             | Keep                                                                                |
| Adoption links                            | 16px                                                                               | Keep                                                                                |
| Footer                                    | 32px outer + 24px inner top spacing; 24px item gap                                 | Keep                                                                                |

## Positive findings and limits

All measured individual field labels remain 2px from their controls, and all measured hint/error elements remain 4px away. All measured in-field and search icons have **zero vertical center offset**. No page-level horizontal overflow was measured in the recorded scenarios. Tables and tabs use their own intentional horizontal scrolling regions.

The larger documentation gutters, stable minimum-height preview frames, control hit areas, and line-height whitespace are not automatically defects. Avoid a global “reduce every gap” change.

The screenshots support visual inspection; computed geometry and source rules establish the exact numbers:

- [Desktop controls and chapter separation](controls-desktop.png)
- [Desktop time-picker gutter and reserved status area](time-picker-desktop.png)
- [Thai mobile catalogue overview](catalogue-mobile-th.png)

## Suggested implementation order

1. **G01, G02, G04, G05, G06 — `$impeccable layout`:** remove empty feedback spacing, attach help to its fields, preserve pagination groups, remove compounded margins, and add missing state spacing.
2. **G03, G07, G08 — `$impeccable layout`:** reconcile the CSS cascade, intermediate-width rhythm and picker gutter alignment.
3. **`$impeccable polish`:** one bounded desktop/mobile confirmation pass with English/Thai text and the affected open popups.

Recommended field rhythm stays **2px label → field, 4px field → help, 8px sibling fields, 16px task sections, 24px task groups**. Keep deliberate document-level spacing separate.
