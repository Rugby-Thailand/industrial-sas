# UI component migration: implementation notes

Companion to [`ui-component-migration-plan.md`](./ui-component-migration-plan.md).
It records the decisions the plan asked to have written down — the primitive
flavour check (Phase A.6), the exceptions taken, and what was deliberately left
alone.

## 1. What was installed

`shadcn init --base radix --preset nova` produced `components.json` with
`"style": "radix-nova"`, and the following were vendored into
`src/components/ui/`:

Select, Button, Input, Textarea, Field, Card, Badge, Separator, Skeleton, Empty,
Sheet, Sidebar, plus the Label and Tooltip that Sidebar depends on, and
`src/hooks/use-mobile.ts`.

Runtime dependencies added: `radix-ui`, `class-variance-authority`, `clsx`,
`tailwind-merge`, `lucide-react`, `tw-animate-css`, and `shadcn` (for the
`shadcn/tailwind.css` variants stylesheet the `radix-nova` source is written
against).

## 2. Tokens: aliases, not a second palette

`shadcn init` writes a hard-coded oklch palette into `globals.css` and adds
`@custom-variant dark (&:is(.dark *))`. Both were reverted.

- The shadcn colour names (`--color-popover`, `--color-muted-foreground`,
  `--color-input`, the `--color-sidebar-*` family, …) are **aliases onto the
  repository's `--token-*` semantic tokens**. There are no literal colours in
  `globals.css` outside the two existing `:root` blocks, and no component paints
  anything the semantic system does not define.
- The `dark` custom variant was **not** added. This application has no theme
  toggle and no `.dark` class; the colour scheme follows the device. Adding the
  override would have disabled every `dark:` utility in the vendored source,
  which is precisely the failure the migration exists to fix.
- One token was added: `--token-danger-contrast`, because `danger` is a pale
  salmon in the dark scheme and white-on-danger would fail 4.5:1 there.

Three shadcn names collide with existing repository names and were resolved
rather than renamed:

| Name     | In this repository    | Resolution                                                       |
| -------- | --------------------- | ---------------------------------------------------------------- |
| `accent` | the **action** colour | kept; `accent-foreground` paired with `accent-contrast`          |
| `muted`  | a **text** colour     | `muted-foreground` maps to it; vendored `bg-muted` → `bg-raised` |
| `input`  | (new)                 | maps to `border-strong`, the interactive-control boundary        |

## 3. Deviations from the generated registry source

Each is a deliberate edit to vendored code, made for a constraint this
repository already had:

1. **`Button` defaults to a 48×48 `touch` size.** The registry default is a
   32-pixel control. This markup is shared with the handheld shell, where 48 is
   `INV-0010-06` rather than a preference, and a default that must be remembered
   at every call site will be forgotten at one.
2. **`Select` trigger and items are `min-h-touch`, and labels wrap.** The
   registry's `whitespace-nowrap` trigger and `line-clamp-1` value would truncate
   a Thai warehouse name at 360 pixels. `position="popper"` and `align="start"`
   are the defaults, because the registry's `item-aligned` puts the menu
   half off-viewport on a narrow screen.
3. **The Sidebar's `Ctrl`/`Cmd`+`B` global shortcut was removed.** A HID scanner
   is a keyboard and types into the document; a global single-letter accelerator
   is one scan away from collapsing the navigation mid-task.
4. **Hard-coded English accessible names became required props.** `"Toggle
Sidebar"`, `"Sidebar"`, `"Displays the mobile sidebar"`, and the Sheet's
   `"Close"` are copy, and this application ships Thai and English.
5. **`useIsMobile` breakpoint is 1024, not 768,** matching the `lg:` the shell
   already used, and it is a `useSyncExternalStore` rather than
   `useState` + effect (the repository's lint rules reject the latter, correctly).
6. **The desktop shell does not use the Sidebar's own desktop branch.** That
   branch is `fixed inset-y-0 h-svh`, which would overlap this shell's workspace
   header. The rail is rendered in flow with `collapsible="none"` and the
   mobile Sheet is composed explicitly, so exactly one navigation tree exists at
   any width.

## 4. Compatibility exception: the ReUI examples are Base UI

**This is the Phase A.6 finding.** The plan requires one primitive flavour and
names Radix. Checked against the live registry on 2026-08-12:

| Source                                                                 | Result                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `@reui/autocomplete`                                                   | 200 — depends on `@base-ui/react`                             |
| `@reui/badge`                                                          | 200 — depends on `@base-ui/react`                             |
| `@reui/c-card-15`, `c-chart-2`, `c-chart-13`, `c-sheet-4`, `c-alert-3` | 200 — reachable, but each depends on a `@reui/*` primitive    |
| `dashboard-1` (application block)                                      | **401** — "Provide your license key via Authorization header" |

So the free ReUI examples selected in
[`reui-authoring-selection.md`](./reui-authoring-selection.md) cannot be vendored
under a Radix-only rule: the ones that are not themselves Base UI depend on
`@reui/badge` or `@reui/alert`, which are. `c-chart-2` additionally imports
`@/app/(create)/components/icon-placeholder`, a scaffold path that does not exist
outside ReUI's own repository.

**They remain a composition reference**, which §2 of the plan explicitly permits,
and the premium application dashboard is unreachable without an entitlement,
which §6 says to continue past rather than block on. Nothing inaccessible was
copied and no Base UI package was installed.

Consequence for Phase D.3: the "already approved ReUI chart examples" are not
available under the chosen flavour, so the capacity visualization is built from
the repository's own tokens — a proportional band bar over the occupancy counts
the page already reads, sitting directly above the legend and the accessible
table that carry the same figures as text. It adds no runtime charting
dependency, invents no metric, and encodes nothing in colour or hover alone.

## 5. Dashboard composition

ReUI Dashboard 1's operations hierarchy, implemented with local primitives:
page heading → current warehouse scope → KPI/backlog cards (`Card`, `Badge`) →
capacity (band bar + accessible occupancy table) → work queue → system notices.

Every figure is a maintained rollup or a count of drawn locations. There is no
revenue, growth, or trend section and there cannot be one from this data: the
rollups have no history, so a sparkline would be a shape invented to fill a card.

## 6. Visual regression baselines are per platform

`tests/e2e/visual.preview.e2e.spec.ts` captures the dashboard and the
master-data item form at 360/768/1280, in Thai and English, in light and dark —
24 snapshots. Playwright suffixes each with the operating system that recorded
it, and that is kept: Linux and macOS rasterise Thai glyphs differently, so one
shared baseline would either fail everywhere it was not recorded or need a
tolerance wide enough to stop catching anything.

**A platform running this suite for the first time records its own baselines**
with `pnpm test:e2e --update-snapshots`, and those files are committed. The
baselines in the repository today were recorded on darwin; CI (ubuntu-24.04)
needs one such run before the visual project is green there.

## 7. What was deliberately not changed

- **Semantic HTML that was already correct.** Tables stay tables, forms stay
  forms, the label-template reprint checkbox stays a checkbox. ReUI Data Grid was
  not adopted: no current desktop surface needs filtering, sorting, or column
  visibility, and the plan gates it on that.
- **The handheld shell.** Still task-oriented, still not a compressed desktop
  dashboard.
- **Enforcement beyond selects.** The static guard
  (`pnpm verify:native-select`) forbids production `<select>` only. Raw buttons
  and inputs are not forbidden yet, because the scanner and semantic exceptions
  are not documented — the plan calls for incremental enforcement, and one raw
  input (the keyboard-wedge scan field) plus one raw checkbox remain by choice.
- **Domain, authorization, tenancy, ledger, and preview/real-mode contracts.** No
  file under `convex/` was touched.
