# Full-application visual audit

## Scope

This audit reviews the 150 screenshots captured by
`tests/e2e/full-app.visual-audit.preview.e2e.spec.ts`:

- 25 distinct product screens
- Thai and English locales
- 360 x 800, 768 x 1024, and 1280 x 900 viewports
- dark theme, deterministic preview data, and hidden development chrome

The baseline corpus is stored outside the repository at
`/Users/macbook/Development/industrial-sas-visual-audit/before`.

All screenshots were inspected at full resolution by Claude Opus 5 with high
effort. The capture manifest reported no unexpected console errors and no
page-level horizontal overflow. The six expected missing-route captures emitted
only the browser's 404 resource error.

## Prioritized findings

### P0 — broken experience

1. **The localized not-found route is blank.** All six locale/viewport variants
   render as a solid black page with no shell, explanation, or recovery action.

### P1 — repeated usability defects

1. **Status badges wrap into tall pills.** Shared badges need to keep their glyph
   and label on one line. Thai labels are especially prone to word splitting.
2. **Wide tables hide important trailing content on phones.** UOM, dates, line
   counts, and action controls are outside the initial viewport with no strong
   visible scroll affordance. The trailing action column should remain reachable
   and preferably visible.
3. **Stock-bucket labels are ambiguous.** Multiple inventory rows collapse to
   the same abbreviated text, hiding the segment that distinguishes the bucket.
4. **Inbound identifiers are truncated from the wrong side.** Values such as
   `…m_resin_hd` wrap poorly and discard the differentiating prefix. Render the
   real identifier without destructive string abbreviation and allow the table
   to scroll.
5. **Purchase-order detail reports contradictory line counts.** The page heading
   says zero lines while its table contains two.
6. **Receiving exposes an internal purchase-order ID.** The register shows a
   human order number (`PO-2601`), while receiving shows `prv_po_2601`.
7. **Purchase-order quantities mix units.** Ordered quantity is shown in cases,
   while received and outstanding values omit their base-unit labels.
8. **Label evidence exposes untranslated enums.** `GENERATED`, `INITIAL`, and
   `REPRINT` appear directly in both locales.
9. **Singular counts use plural nouns.** Examples include `1 lots` and
   `1 received lines`.

### P2 — clarity and consistency

1. Setup repeats the same introductory sentence twice.
2. Dashboard repeats “What works today” as both a section and card title.
3. Purchase import repeats “Check the file” in the heading, card, and action.
4. Quality approval repeats its instruction several times.
5. The dashboard warning uses a multi-line rounded pill; it should be a callout.
6. The “Already claimed” control looks actionable when it represents a terminal
   state.
7. English order and line states both render as “Open,” losing a distinction
   preserved by the Thai copy.
8. Select placeholders sometimes repeat the field label rather than stating the
   expected choice.
9. Empty cells, reversal state, long descriptions, header wrapping, and action
   placement are inconsistent across screens.

### P3 — lower-priority polish

1. The handheld shell grows too wide on desktop instead of resembling a handheld
   workspace.
2. Context-bar labels, occupancy cells, card headers, and item-detail actions
   could be aligned more consistently.
3. Calendar presentation differs between Thai dashboard dates and some history
   timestamps; the product should adopt one explicit locale/calendar policy.

## Implementation contract

1. Fix shared primitives first (`StatusBadge`, `EntityTable`, identifier cells,
   and shared count/status formatting).
2. Preserve semantic HTML, keyboard access, localization, and the existing
   glyph-plus-text status treatment.
3. Prefer honest horizontal scrolling over hiding columns. Add a visible cue and
   keep the trailing action column usable on narrow screens.
4. Do not hide production UI merely to make screenshots pass.
5. Add or update focused tests for every behavior change.
6. Re-capture the same 150-image matrix into an `after` corpus and re-audit it.
7. Run formatting, lint, type checking, unit tests, architecture guards, and the
   preview browser suite before declaring the work complete.

## Strengths to preserve

- The audited screens have no unexpected runtime errors or page-level overflow.
- Thai coverage is extensive, with only a small number of raw enum leaks.
- Forms reflow well at all three sizes; tables are the main responsive seam.
- Status is communicated with both a glyph and text rather than color alone.
- Preview behavior is explicit and honest, and empty states are generally clear.
- Numeric precision and disabled pagination states are consistent.

## Remediation and retest — 2026-08-12

The prioritized P0–P2 work above was implemented and reviewed against the same
matrix. The final corpus is stored at
`/Users/macbook/Development/industrial-sas-visual-audit/after-final`.

### Implemented improvements

- Added a localized not-found page with a clear route back to the dashboard.
- Kept status glyphs and labels on one line and localized raw domain enums.
- Replaced opaque stock-bucket strings with labelled item, location, and lot
  dimensions.
- Restored complete inbound identifiers, human purchase-order numbers, line
  counts, quantity units, and English singular/plural forms.
- Removed repeated setup, dashboard, import, and quality instructions; converted
  the dashboard warning pill into a titled notice.
- Replaced label-like select placeholders with instructions and made all form
  columns respond to their container rather than the browser viewport.
- Added a shared, keyboard-focusable table scroller with a localized cue that
  follows container width. Action columns pin only when the table has enough
  room, so an opaque pinned cell cannot hide a status or quantity on handheld
  and tablet layouts.
- Bounded the handheld shell to a centred 448-pixel workspace on larger screens,
  let its header wrap at phone width, and allowed the desktop shell's main area
  to shrink without producing page-level overflow.
- Formatted report row counts consistently in Thai and English.

### Claude after-review

Claude Opus 5 (high effort) inspected all 150 first-pass after images and their
matching baselines. Those reports are:

- `/Users/macbook/Development/industrial-sas-visual-audit/after/claude-after-core.md`
- `/Users/macbook/Development/industrial-sas-visual-audit/after/claude-after-master.md`
- `/Users/macbook/Development/industrial-sas-visual-audit/after/claude-after-inbound.md`
- `/Users/macbook/Development/industrial-sas-visual-audit/after/claude-after-handheld.md`

That review caught two shared regressions before completion: a non-wrapping
handheld header produced 21–50 pixels of page overflow, and an always-pinned
table action cell could cover the end of quantities and statuses. It also found
that viewport breakpoints squeezed a form inside the bounded handheld shell.
All three were corrected at the shared shell, table, and form seams.

Claude then inspected 22 affected final screenshots plus eight before/first-pass
comparators at full resolution. The final report is
`/Users/macbook/Development/industrial-sas-visual-audit/after-final/claude-regression-recheck.md`.
Its verdict is **PASS**: all four targeted regressions are fixed, no P0/P1 issue
remains, and no new regression was found.

### Final evidence

- Final screenshots: **150/150 captured**.
- Page-level horizontal overflow: **0/150**.
- Unexpected console errors: **0**. The six missing-route variants contain only
  their expected 404 resource response.
- Wide tables remain deliberately horizontally scrollable on narrow containers.
  Their region is keyboard-focusable and their localized cue remains visible
  whenever the container lacks desktop room. This preserves complete identifiers
  and quantities instead of crushing or abbreviating them.
- Remaining observations are polish or explicit trade-offs: some initial table
  views require sideways scrolling; Thai bucket labels wrap more than English;
  and very wide table content can make rows taller than their visible first
  columns. These no longer hide content behind an opaque action cell or create
  document-level overflow.

### Verification

- Production build: passed.
- Reviewed visual snapshots: **24 passed** after intentional baseline refresh.
- Complete Playwright suite: **174 passed, 1 intentionally skipped**.
- Unit, integration, property, isolation, and accessibility suites: **2,440
  passed across 147 files**.
- Formatting, ESLint, TypeScript, workflow configuration, tenant-boundary,
  native-select, and environment-contract guards: passed.
