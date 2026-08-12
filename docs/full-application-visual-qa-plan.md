# Full-application visual QA plan

## Goal

Render every application screen with deterministic preview data at the three
widths the product supports, have Claude Opus 5 inspect every screenshot, fix
confirmed defects, and rerun the identical matrix. The audit is evidence for
responsive layout, Thai/English copy, control quality, visual hierarchy, and
screen-to-screen consistency; it does not replace behavioral or accessibility
tests.

## Matrix

- Locales: Thai (`th`) and English (`en`).
- Viewports:
  - handheld: `360 × 800`;
  - tablet: `768 × 1024`;
  - desktop: `1280 × 900`.
- Colour scheme: dark for the full audit. The existing representative visual
  suite continues to cover light and dark on the dashboard and item form.
- Data: `NEXT_PUBLIC_LOCAL_PREVIEW=1`, warehouse
  `prv_wh_bangpoo`, and stable preview identifiers for detail routes.
- Screens: the 24 page routes below plus the localized not-found state.

| Name                  | Route suffix                          |
| --------------------- | ------------------------------------- |
| Sign in               | `/sign-in`                            |
| Dashboard             | `/dashboard`                          |
| Inventory balances    | `/inventory/balances`                 |
| Inventory history     | `/inventory/history`                  |
| Items                 | `/master-data/items`                  |
| Item detail           | `/master-data/items/prv_item_bolt_m8` |
| Label templates       | `/master-data/label-templates`        |
| Locations             | `/master-data/locations`              |
| Storage classes       | `/master-data/storage-classes`        |
| Suppliers             | `/master-data/suppliers`              |
| Purchase-order import | `/purchasing/import`                  |
| Purchase orders       | `/purchasing/orders`                  |
| Purchase-order detail | `/purchasing/orders/prv_po_2601`      |
| Receiving             | `/receiving`                          |
| Receipt detail        | `/receiving/prv_rcpt_5001`            |
| Quality               | `/quality`                            |
| Putaway               | `/putaway`                            |
| Reports               | `/reports`                            |
| Setup                 | `/setup`                              |
| Handheld home         | `/handheld`                           |
| Handheld inventory    | `/handheld/inventory`                 |
| Handheld receiving    | `/handheld/receive`                   |
| Handheld quality      | `/handheld/quality`                   |
| Handheld putaway      | `/handheld/putaway`                   |
| Not found             | `/visual-audit-not-found`             |

Total: `25 screens × 2 locales × 3 viewports = 150 screenshots`.

## Capture contract

1. Seed the selected warehouse before the first paint.
2. Wait for the page heading and preview banner, or the screen-specific stable
   landmark when a page intentionally has neither.
3. Hide only Next.js development chrome. Do not hide application UI.
4. Disable animations and hide the caret.
5. Capture the application shell at full scroll height, using deterministic
   names: `<screen>--<locale>--<viewport>.png`.
6. Write a machine-readable manifest containing route, locale, viewport,
   dimensions, screenshot path, page title, horizontal overflow measurement,
   and browser console errors.

## Claude image review

Claude Opus 5 reviews every file in the manifest and records only evidence that
is visible in the image or manifest metadata. Each finding must contain:

- screenshot(s) and route;
- severity (`P0` blocking, `P1` major, `P2` material, `P3` polish);
- visible evidence and affected viewport/locales;
- likely component or layout seam;
- proposed correction;
- confidence (`high`, `medium`, or `low`).

The review checks clipping and overflow, unreadable density, broken wrapping,
navigation behavior, control sizing, inconsistent spacing, hierarchy, contrast,
empty/error state clarity, Thai combining-mark safety, and parity between the
desktop and handheld shells. A screenshot difference alone is not a defect.

## Implementation and verification

1. Reproduce every P0–P2 finding in the browser or DOM before editing.
2. Fix the deepest shared component or layout seam that explains the evidence;
   avoid route-local CSS patches when the issue repeats.
3. Add a focused unit, accessibility, or end-to-end regression test for each
   behavior that can be expressed without a pixel baseline.
4. Rerun the 150-image matrix into a separate `after` directory.
5. Have Claude compare the before/after evidence and confirm each issue is fixed
   without introducing new clipping, overflow, or hierarchy regressions.
6. Run the full repository guards and complete Playwright suite.

## Deliverables

- before and after screenshot directories;
- capture manifests;
- Claude's prioritized Markdown audit;
- implemented fixes and regression tests;
- final test totals and a concise residual-risk list.
