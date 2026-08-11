# UX component research: ReUI and shadcn/ui

Research cutoff: **2026-08-10**. Sources are current first-party documentation,
the official ReUI repository, and W3C standards. This note refines, rather than
replaces, [the approved ReUI authoring selection](./reui-authoring-selection.md).

## Decision summary

Keep ReUI as a copy-and-own **authoring source**, with shadcn/ui as the common
primitive layer. The selected free ReUI examples remain a good visual starting
point, but the implementation should use one responsive navigation model,
purpose-specific search, a card/list presentation on handhelds, persistent scan
feedback, and fully localized form and table affordances. ReUI's official project
describes this as a copy-and-own model rather than an npm runtime dependency, which
matches the repository boundary ([ReUI repository](https://github.com/keenthemes/reui)).

Before vending anything, initialize shadcn and choose **one** primitive flavor
(Radix or Base UI). The repository currently has no `components.json` and no
TanStack Table dependency; mixing code from the Base and Radix documentation would
make generated composition and event APIs inconsistent.

## Recommended component map

| Surface                                 | Recommended composition                                                                                                                                                         | UX adaptation for this WMS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell and navigation                | shadcn `Sidebar`, with the selected ReUI `c-sheet-4` only where a separate long, scrollable sheet is actually needed                                                            | Use one navigation tree and one active-route state. `Sidebar` already exposes desktop collapse, `openMobile`, and a mobile Sheet, plus sticky header/content/footer regions. Put the organization/warehouse switcher and visible current scope in the header; do not maintain a second mobile navigation model ([shadcn Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar), [shadcn Sheet](https://ui.shadcn.com/docs/components/radix/sheet)).                                                                                                                                                                                                                                                                                      |
| Commands and search                     | shadcn `CommandDialog` for routes and supervisor actions; ReUI `Autocomplete` for warehouse, supplier, PO, SKU, lot, HU, and location lookup                                    | Command is a `cmdk`-based action/search palette, while ReUI Autocomplete documents clear, no-result, grouping, form, and async-search patterns. Scanning stays a visible primary task, never hidden in Command. Do not enable ReUI Filters' single-key shortcut in scanner flows, and suspend global shortcuts while an HID scan buffer is active ([shadcn Command](https://ui.shadcn.com/docs/components/radix/command), [ReUI Autocomplete](https://reui.io/docs/components/base/autocomplete), [ReUI Filters](https://reui.io/docs/components/base/filters)).                                                                                                                                                                                |
| Inventory and history                   | Selected `c-data-grid-20` with the current ReUI Data Grid primitive on supervisor/desktop layouts; shadcn `Item` rows or a reduced-column table on handhelds                    | Keep SKU/location, available quantity, and status visible first. Move secondary fields to row detail in a Sheet. Preserve a real table and horizontal-scroll fallback, but do not make a wide desktop grid the primary handheld experience. `Item` explicitly composes content, description, and actions for list-like rows ([ReUI Data Grid](https://reui.io/docs/components/base/data-grid), [shadcn Item](https://ui.shadcn.com/docs/components/radix/item), [shadcn Data Table guide](https://ui.shadcn.com/docs/components/radix/data-table)).                                                                                                                                                                                             |
| Filters                                 | Selected `c-filters-8` and `c-filters-9`                                                                                                                                        | These selections match the official async-data-grid and i18n examples. ReUI supports localized labels/operators, validation, virtualized options, and debounced bounded server lookup. Show active filters as compact chips; edit the full set in a mobile Sheet/Drawer with explicit Apply and Clear actions. Component state is UI state only: query interpretation and tenant scope remain server-side ([ReUI Filters](https://reui.io/docs/components/base/filters)).                                                                                                                                                                                                                                                                       |
| Forms                                   | shadcn `Field`, `FieldGroup`, `FieldSet`, `FieldLegend`, `FieldDescription`, and `FieldError`, paired with selected ReUI Autocomplete, Number Field, and Date Selector examples | Use visible labels and inline errors; associate errors with the control and set `aria-invalid`. Group PO header, line, lot/date, and QC fields semantically. Number Field supports spinner/keyboard entry, min/max, and step constraints, but its spinner buttons must be enlarged to the project 48 px target ([shadcn Field](https://ui.shadcn.com/docs/components/radix/field), [shadcn React Hook Form guide](https://ui.shadcn.com/docs/forms/react-hook-form), [ReUI Number Field](https://reui.io/docs/components/base/number-field)).                                                                                                                                                                                                   |
| Receiving steps                         | Selected `c-stepper-10` and `c-stepper-13`; compact `c-stepper-6` only as secondary progress                                                                                    | Use a controlled vertical stepper on handhelds and horizontal only when the real Thai labels fit. Show text such as “ขั้นตอน 2 จาก 5”, disable unmet prerequisites, preserve entered values, and announce validation/loading transitions. ReUI exposes controlled value, horizontal/vertical orientation, disabled/completed/loading states, and paired content panels ([ReUI Stepper](https://reui.io/docs/components/base/stepper)).                                                                                                                                                                                                                                                                                                          |
| Scanner feedback                        | Selected `c-alert-3`, `c-alert-6`, and `c-alert-8` as persistent inline feedback beside the scan target; shadcn `Sonner` only for secondary confirmations                       | Keep the last scanned value, resolved item/location, outcome, and recovery action visible. Use `role="status"` for pending/success and `role="alert"` only for urgent errors. The current ReUI Alert source defaults every variant to `role="alert"`, but spreads caller props afterward, so the role can and should be overridden for non-urgent states ([ReUI Alert docs](https://reui.io/docs/components/base/alert), [ReUI Alert source](https://github.com/keenthemes/reui/blob/14185b983e9049ac6786e0f69a764bb3ba70a2b5/registry-reui/bases/base/reui/alert.tsx#L35-L47), [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [shadcn Sonner](https://ui.shadcn.com/docs/components/radix/sonner)). |
| Empty, loading, and error               | ReUI grid loading/empty props plus shadcn `Skeleton`, `Spinner`, `Empty`, and actionable Alert                                                                                  | Skeletons should preserve the expected page/table shape on first load; a Spinner belongs inside the control that is waiting. Keep prior rows visible during refresh. Distinguish “ไม่มีสต็อก” from “ไม่พบผลลัพธ์ตามตัวกรอง” and provide Clear filters/Retry actions. shadcn Empty provides title, description, media, and action content; ReUI Data Grid exposes localized loading and empty message slots ([shadcn Empty](https://ui.shadcn.com/docs/components/radix/empty), [shadcn Skeleton](https://ui.shadcn.com/docs/components/radix/skeleton), [shadcn Spinner](https://ui.shadcn.com/docs/components/radix/spinner), [ReUI Data Grid](https://reui.io/docs/components/base/data-grid)).                                               |
| Dashboard and charts                    | Selected `c-card-15`, `c-chart-2`, and `c-chart-13`, with shadcn Chart/Recharts                                                                                                 | Prefer the comparison bar chart for receiving versus putaway and reserve the decorative gradient/stripe area pattern for a single throughput trend. Avoid 3D, glow, and hover-only meaning. Set Recharts `accessibilityLayer`, localize legend/tooltips, and always provide KPI text plus a table/list equivalent; shadcn says the accessibility layer adds keyboard and screen-reader support ([shadcn Chart](https://ui.shadcn.com/docs/components/radix/chart), [ReUI Chart gallery](https://reui.io/components/chart)).                                                                                                                                                                                                                     |
| Drawers, sheets, and responsive details | Sheet for navigation and record detail; bottom Drawer for compact mobile filters, quantity confirmation, and short forms; Dialog on desktop                                     | Keep actions visible while content scrolls. shadcn documents both scrollable drawers with fixed actions and a responsive Dialog-on-desktop/Drawer-on-mobile composition ([shadcn Drawer](https://ui.shadcn.com/docs/components/radix/drawer), [shadcn Dialog](https://ui.shadcn.com/docs/components/radix/dialog)).                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Reconciliation with the selected ReUI examples

The named examples still exist in the current free catalog and their purposes
remain aligned: `c-data-grid-20` is column visibility, `c-filters-8` is async grid
filtering, `c-filters-9` is i18n, `c-stepper-10` supplies step content,
`c-stepper-13` is vertical with descriptions, and `c-sheet-4` is scrollable content
([ReUI component catalog](https://reui.io/components)). Three refinements are
required:

1. **Data Grid is now a v9 integration.** Current ReUI docs specify TanStack Table
   v9, `useTable`, and `dataGridFeatures`; they explicitly say v9 removed
   `useReactTable`. They also require stable `getRowId` for pinned or virtual rows
   and expose `DataGridScrollArea`, skeleton/spinner loading, empty messages,
   pagination, visibility, pinning, and resizing. Pin the installed version, use
   bounded manual server pagination, and do not copy older v8 examples
   ([ReUI Data Grid](https://reui.io/docs/components/base/data-grid)).
2. **`c-data-grid-22` is a CRUD example, not a guaranteed inline spreadsheet.** Use
   it as layout/source inspiration for PO lines, but keep domain validation in
   normal fields and explicit add/edit actions unless the vendored source passes
   the keyboard, focus, Thai-copy, and mobile audits
   ([ReUI Data Grid gallery](https://reui.io/components/data-grid)).
3. **Date Selector needs explicit policy.** It returns a structured
   `DateSelectorValue`, supports custom i18n, and currently defaults to
   `minYear=2015` and `maxYear=2026`. Set rolling business bounds for future PO
   dates, supply Thai month/weekday/operator copy, convert to the domain business
   date centrally, and keep Buddhist Era conversion display-only
   ([ReUI Date Selector](https://reui.io/docs/components/base/date-selector)).

## Accessibility and Thai-first acceptance rules

- Preserve the repository's 48×48 CSS-pixel handheld target. WCAG 2.2 AA requires
  at least 24×24 or sufficient spacing; the stronger project rule is appropriate
  for gloves and imprecise warehouse input ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)).
- Localize visible copy **and** accessible names. Current ReUI Data Grid source has
  English defaults such as “Select row”, “Pin row”, and “Expand row”, so auditing
  only visible strings is insufficient
  ([official Data Grid source](https://github.com/keenthemes/reui/blob/14185b983e9049ac6786e0f69a764bb3ba70a2b5/registry-reui/bases/base/reui/data-grid/data-grid-table.tsx#L1522-L1688)).
- Keep success, waiting, progress, and error updates programmatically determinable
  without moving focus. W3C recommends `role="status"` for ordinary results/state
  and `role="alert"` or a live region for important errors; excessive assertive
  alerts become disruptive ([WCAG 4.1.3 techniques](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)).
- Do not use fixed-height labels or aggressive truncation. Thai spaces separate
  phrases rather than words and its combining marks affect shaping and line layout;
  test real Thai strings at narrow widths and 200% zoom
  ([W3C Thai Layout Requirements](https://www.w3.org/TR/thai-lreq/)).
- Every scanner flow must remain keyboard/HID-completable and must not rely on
  color, sound, vibration, hover, or toast duration alone. These checks remain part
  of [ADR-0010](./adr/0010-thai-first-i18n-and-accessibility.md) and the physical
  acceptance gate, not properties guaranteed merely by choosing a component.
