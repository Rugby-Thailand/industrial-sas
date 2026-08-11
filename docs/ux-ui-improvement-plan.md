# UX/UI improvement plan

Status: **planning proposal**, prepared 2026-08-10 from the accepted product
decisions, a current primary-source component review, and a Claude CLI
`claude-opus-5` planning pass. It does not authorize feature implementation or
change the immutable [`PROJECT_PLAN.md`](../PROJECT_PLAN.md).

Supporting research:
[`ux-component-research.md`](./ux-component-research.md). Existing selection:
[`reui-authoring-selection.md`](./reui-authoring-selection.md).

## 1. Product direction

Industrial SSA should look and behave like a warehouse execution system, not a
generic analytics dashboard.

- **Desktop supervisor shell:** dense but calm; optimized for search, comparison,
  exception handling, approvals, imports, audit, and reporting.
- **Android handheld shell:** scan-first and task-specific; one decision per
  screen, one dominant action, persistent feedback, and minimal typing.
- **Shared truth:** both shells use the same routes, permissions, terminology,
  formatters, status model, and navigation data, but not the same page composition.
- **Operational clarity:** current organization and warehouse, connectivity,
  current step, last scan, and server-confirmation state outrank decoration.

The product must never imply that inventory changed before the server confirms
the ledger transaction. Safe queued intents are visibly pending; operations that
require fresh stock or location state stop when connectivity is unavailable.

## 2. UX principles

1. **Scan first, touch second, typing as recovery.** Every handheld flow is
   completable with a keyboard-wedge scanner and keyboard alone.
2. **Server confirmation is part of the interface.** Write actions expose
   `idle -> validating -> pending -> confirmed | rejected`, with the pending
   state labeled rather than represented by a spinner alone.
3. **Exceptions are designed alongside the happy path.** Over-receipt,
   unexpected items, unreadable or duplicate scans, QC holds, printer failure,
   offline state, and putaway overrides have explicit recovery paths.
4. **No state is color-only or transient-only.** Pair status color with text and
   an icon; keep scan outcomes visible near the scan target. Toasts are secondary.
5. **Thai is the layout baseline.** Use real reviewed Thai copy from the first
   component test; allow taller wrapping and do not rely on Latin placeholder
   lengths.
6. **Progressive disclosure by device.** Desktop may use dense grids and side
   panels. Handheld shows compact task cards and reveals secondary detail on
   demand.
7. **Permissions guide, never prove, access.** Hide or disable unavailable actions
   with a useful explanation, while Convex remains authoritative.

## 3. Information architecture

### Desktop supervisor

Use one shadcn `Sidebar` navigation model with the current organization and
warehouse permanently visible. Collapse it to an icon rail on wide screens and
use its mobile Sheet state on narrow supervisory screens.

| Area           | Primary surfaces                                                                        |
| -------------- | --------------------------------------------------------------------------------------- |
| Dashboard      | Receiving volume, open QC, putaway backlog, occupancy, low stock, reconciliation health |
| Inbound        | PO list/detail, PO authoring/import preview, receiving queue, receipt detail            |
| Quality        | QC work queue, inspection/disposition, approval state, evidence                         |
| Putaway        | Task queue, recommendation explanation, override review                                 |
| Inventory      | On-hand by SKU/lot/location/status, stock detail, handling units                        |
| History        | Immutable inventory transactions, ledger lines, reversals, audit trail                  |
| Jobs           | Import/export/print jobs, progress, retry/dead-letter outcomes                          |
| Administration | Warehouses, locations, roles, policies, devices, printers                               |

`CommandDialog` supports route navigation and safe shortcuts such as finding a PO,
SKU, lot, LPN, or location. It must not contain destructive actions, and global
shortcuts must be suspended while a scanner buffer or editable control is active.

### Handheld operator

The handheld home is a task launcher, not a small dashboard:

- Receive goods
- Perform QC
- Build or continue a handling unit
- Put away stock
- Scan to look up an item, lot, LPN, or location
- Resume the operator's current task

Each task route uses a compact header (warehouse, connectivity, task identifier),
a vertical progress summary, the active work surface, persistent scan feedback,
and a sticky primary action that does not obscure focus. Navigation away from an
unfinished task requires an explicit choice when work would be lost.

## 4. Inbound flow and exception UX

| Stage               | Main interaction                                                                                  | Required exception treatment                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| PO author/import    | Desktop fields or previewed CSV/XLSX import; row-level validation before commit                   | Duplicate external reference, invalid UOM/date, unknown supplier/SKU, and partial import resume                                                |
| Select receipt      | Scan or search PO; show supplier, expected lines, prior receipts, and receipt status              | Cancelled/closed PO, blind or unexpected receipt, wrong warehouse                                                                              |
| Receive line        | Scan SKU/GS1, resolve item/lot/dates, enter exact quantity and UOM, review expected vs received   | Unknown/ambiguous scan, broken internal LPN, duplicate/plausible duplicate, inexact UOM conversion, shelf-life exception                       |
| Confirm receipt     | Explicit summary followed by server confirmation; lock only confirmed milestones                  | Over tolerance requires the configured approval; under-close requires a reason; rejected writes restore the entered context                    |
| QC                  | Show sampling obligation, captured evidence, stock bucket, and one disposition decision           | QC hold remains unmistakable; maker-checker and step-up states name what is needed without exposing authorization internals                    |
| Build handling unit | Scan confirmed receipt lines, show pallet composition and mixed-content policy                    | Reject prohibited mixed SKU/lot; preserve valid work when one scan fails                                                                       |
| Print               | Preview the audited template/version and submit one print job                                     | Show queued/sent/failed separately; reprint is explicit and audited; whether label failure blocks putaway is an open operating-policy decision |
| Putaway             | Show recommended location and short explanation; scan LPN then destination; confirm server result | Wrong location preserves task context; hard constraints cannot be overridden; allowed overrides require a reason and audit record              |
| Inventory/history   | Read-only balances plus immutable transaction and ledger detail                                   | Clearly distinguish reversal/correction from editing history; display reconciliation warnings without changing authoritative values            |

For scanner feedback, keep the raw scan, resolved entity, outcome, and next action
visible. Use one polite live region (`role="status"`) for progress and success and
one assertive error region only when immediate attention is required. Optional
audio and haptics reinforce, but never replace, visible feedback.

## 5. Visual system

- Extend semantic tokens before feature screens: canvas, surface, raised surface,
  border, text, muted text, focus, accent, success, warning, danger, pending, QC
  hold, and disabled. Verify text contrast at 4.5:1 and meaningful non-text/focus
  contrast at 3:1.
- Keep the existing Thai-capable system stack until a real-device font comparison
  justifies adding a webfont. Use tabular numerals for quantities and codes.
- Favor flat surfaces, clear borders, and subtle background bands over heavy
  shadows, gradients, glass effects, or 3D charts; these retain hierarchy in harsh
  lighting.
- Handheld body copy begins at 16px, with scan results and quantities larger.
  Desktop grids may be denser, but handheld targets remain at least 48 by 48 CSS
  pixels with glove-compatible spacing.
- Use a prominent, never-removed focus ring. Do not truncate critical Thai labels,
  item identity, lot, quantity, status, or recovery instructions.
- Motion communicates continuity only. Respect `prefers-reduced-motion`, avoid
  celebratory animation, and never delay the next scan for animation.

## 6. Component decisions

| Need                       | Recommended source                                                    | Decision and caveat                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Responsive navigation      | shadcn `Sidebar`                                                      | One shared navigation tree; it already owns mobile Sheet state, so do not add a second ReUI nav model                                     |
| Desktop actions/search     | shadcn `CommandDialog`                                                | Routes and safe actions only; scan remains a visible primary action                                                                       |
| Domain lookup              | ReUI `Autocomplete` / selected autocomplete examples                  | Async, bounded supplier/PO/SKU/lot/LPN/location search with Thai no-result and recovery copy                                              |
| Desktop inventory/history  | ReUI Data Grid and `c-data-grid-20`                                   | Current integration is TanStack Table v9 using `useTable` and `dataGridFeatures`; use stable row IDs and manual bounded server pagination |
| Handheld result lists      | shadcn `Item` or task cards                                           | Do not shrink a wide grid into the primary handheld UI                                                                                    |
| Filtering                  | ReUI `c-filters-8`, `c-filters-9`                                     | Active chips on the page; full editor in a mobile Sheet/Drawer; server interprets and scopes queries                                      |
| Forms                      | shadcn `Field*` plus ReUI Number Field, Autocomplete, Date Selector   | Visible label/description/error wiring; enlarge number controls; set explicit rolling date bounds and convert via the domain formatter    |
| Workflow progress          | ReUI `c-stepper-10`, `c-stepper-13`; `c-stepper-6` as compact summary | Controlled vertical form on handheld; horizontal only after real Thai labels fit                                                          |
| Scanner feedback           | ReUI `c-alert-3`, `c-alert-6`, `c-alert-8`                            | Override the component's default `role="alert"` with `role="status"` for non-urgent states                                                |
| Loading/empty/error        | shadcn `Skeleton`, `Spinner`, `Empty`; persistent Alert               | Preserve old data during refresh; distinguish no data from no filter results; every error offers a next action                            |
| Record details/short forms | shadcn `Sheet`, responsive `Dialog`/`Drawer`                          | Right Sheet for desktop detail; bottom Drawer for short handheld forms with visible fixed actions                                         |
| Dashboard                  | selected ReUI cards/charts plus shadcn Chart                          | Restrained bar/line charts only; KPI text and equivalent table/list are mandatory                                                         |

Before vending, run a small Radix-versus-Base-UI compatibility spike against the
current ReUI source and choose one shadcn primitive flavor in `components.json`.
Do not mix examples across flavors. Treat `c-data-grid-22` as CRUD layout
inspiration, not guaranteed spreadsheet editing. ReUI remains a local copy-and-own
authoring source; premium blocks are not assumed. See the
[official ReUI overview](https://reui.io/docs),
[Data Grid documentation](https://reui.io/docs/components/base/data-grid), and
[shadcn Sidebar documentation](https://ui.shadcn.com/docs/components/radix/sidebar).

## 7. Responsive, state, accessibility, and i18n rules

- Route groups choose the desktop or handheld shell. Within each shell, responsive
  CSS adapts layout; viewport sniffing must not silently move an operator into a
  different workflow.
- Test at 320, 360, 768, and 1280 CSS-pixel widths, 200% zoom, portrait/landscape,
  long Thai strings, slow network, offline, and large result counts.
- Sticky headers and action bars must not obscure focused controls. Sheets and
  Drawers trap focus, close with Escape where applicable, and restore focus.
- Use semantic HTML tables for desktop grids and accessible names for icon-only
  actions. Audit vendored ReUI strings such as row selection, pinning, expansion,
  pagination, and empty/loading messages.
- `next-intl` supplies Thai and English catalogues with identical key sets.
  Missing Thai keys fail verification rather than silently leaking English into a
  Thai screen.
- Central formatters own quantities, Gregorian storage/business dates, optional
  tenant/document-specific Buddhist Era display, and Thai collation.
- Scanner handling belongs behind `ScannerPort`. Avoid an unconditional global
  key listener; prove focus, terminator, shortcut suppression, and incomplete-scan
  behavior on the pilot device.
- Charts enable keyboard/screen-reader support and expose the same data in a table
  or list. Loading and status changes do not move focus.

## 8. Implementation sequence

1. **Compatibility spike:** choose one shadcn primitive flavor; vend one ReUI
   primitive and one composite; record dependency versions and accessibility gaps.
2. **Foundations:** create semantic tokens, focus/target rules, `next-intl`
   catalogue parity, shared formatters, state vocabulary, and real-Thai fixtures.
3. **Shells:** implement locale routing, desktop Sidebar/header/CommandDialog, and
   the handheld task launcher/header/connectivity treatment.
4. **State primitives:** implement scan target, persistent feedback, pending and
   offline blockers, Skeleton/Empty/Error, responsive Sheet/Drawer, and tests.
5. **Desktop read path:** ship a bounded PO list/detail and inventory/history grid
   to validate navigation, filters, pagination, Thai copy, and accessibility.
6. **PO author/import:** fields, domain lookups, preview, validation, resumable job
   progress, and exception rows.
7. **Handheld receive:** scan resolution, vertical stepper, exact quantity/UOM,
   duplicate handling, and server-confirmed completion.
8. **QC, handling unit, and print:** maker-checker/step-up UI, evidence, pallet
   composition, print queue, and audited reprint.
9. **Putaway and ledger:** explainable recommendation, scan confirmation, override,
   immutable history, and reversal surfaces.
10. **Dashboard and hardening:** rollup-backed widgets, accessible chart
    alternatives, device/glove/lighting checks, and pilot measurement.

Do not vend all components up front. Add and review them only when the relevant
surface begins, as required by the existing ReUI authoring decision.

## 9. Acceptance evidence

- The full handheld inbound happy path completes using keyboard/HID input alone,
  with at least 95% pilot receipt-line completion without desktop fallback.
- A network loss during correctness-sensitive work blocks submission, writes no
  inventory transaction, preserves safe local context, and resumes from
  server-confirmed progress.
- Duplicate scans/retries never double-post; rejected writes retain enough context
  for recovery and do not display false balances.
- Over-receipt, under-close, unexpected receipt, QC hold/disposition, printer
  failure, and putaway override each pass an E2E exception scenario.
- Every shipped route has zero automated axe violations plus manual keyboard,
  screen-reader, focus-obscuring, 200% zoom, Thai wrapping, contrast, and
  color-independent status checks.
- Playwright verifies 48-by-48 handheld targets from computed layout, scan focus,
  live-region behavior, and Thai/English screenshots at the target widths.
- Data grids use stable row IDs, bounded server pagination, loading/empty/error
  states, keyboard operation, and localized visible and accessible labels.
- Every chart has a keyboard-reachable equivalent data table/list.
- Actual Android scanner, printer, label stock, gloves, lighting, and warehouse
  Wi-Fi complete the existing physical release gates.

## 10. Explicit non-goals

No outbound picking/shipping, cycle count, reservation UI, native app, true offline
inventory writes, RFID, 3D warehouse view, inline spreadsheet editing, custom
label designer, paid ReUI dependency, decorative dashboard redesign, or new
domain behavior beyond the approved inbound MVP.

## 11. Open product decisions

1. Which current ReUI examples and transitive primitives pass the
   Radix/Base-UI spike with the least local patching?
2. Which handheld models, Android browser/WebView, scanner terminator, and viewport
   represent the pilot fleet?
3. Does a failed label print block putaway, permit a controlled PDF/manual path, or
   create a separate relabel task?
4. Are over-receipt and putaway approvals performed on-device, through a remote
   approval queue, or both?
5. Which QC evidence is required, and is photo capture in the MVP?
6. Which tenant documents display Buddhist Era, and which remain Gregorian?
7. Which visual density and contrast mode do Thai operators prefer under actual
   warehouse lighting?

## 12. Ten highest-value first actions

1. Run and record the shadcn primitive-flavor/ReUI compatibility spike.
2. Approve the desktop and handheld information architecture with real operator
   roles and permissions.
3. Map every inbound domain error/result to Thai operator copy and a recovery
   action.
4. Create Thai/English message catalogues and long-Thai test fixtures.
5. Define semantic color, focus, spacing, typography, status, and motion tokens.
6. Prototype the handheld scan target, feedback, connectivity blocker, and sticky
   action on the actual pilot device.
7. Build the two shells from one navigation and scope model.
8. Validate the current ReUI Data Grid version with a bounded server-paginated PO
   list before adopting it elsewhere.
9. Implement the PO-to-receipt happy path and its duplicate/over-receipt/offline
   tests before adding dashboard polish.
10. Schedule the physical scanner, printer, Thai glyph, glove, lighting, and Wi-Fi
    acceptance session early enough to change the design.
