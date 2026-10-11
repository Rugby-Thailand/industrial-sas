---
name: "Storage Planner — quieter design sheet"
description: "Scoped composition proposal with the 2026-10-09 session palette snapshot."
colors:
  primary: "oklch(0.4901 0.2875 264.3293)"
  primary-dark: "oklch(0.46 0.22 266)"
  primary-hover: "#1024c4"
  primary-hover-dark: "#2948cd"
  primary-contrast: "oklch(0.985 0 0)"
  primary-border-dark: "#8298ed"
  link-dark: "#a9baff"
  selected: "oklch(0.92 0.04 272)"
  selected-dark: "oklch(0.32 0 0)"
  canvas: "oklch(0.985 0 0)"
  canvas-dark: "oklch(0 0 0)"
  surface: "oklch(1 0 0)"
  surface-dark: "oklch(0.145 0 0)"
  raised: "oklch(0.97 0 0)"
  raised-dark: "oklch(0.23 0 0)"
  text: "oklch(0.205 0 0)"
  text-dark: "oklch(0.946 0 0)"
  muted: "oklch(0.44 0 0)"
  muted-dark: "oklch(0.72 0 0)"
  divider: "oklch(0.92 0 0)"
  divider-dark: "oklch(0.26 0 0)"
  control-edge: "#808080"
  control-edge-dark: "#858585"
  focus: "oklch(0.46 0.22 266)"
  success: "#0f6b3f"
  success-dark: "#58d19a"
  success-surface: "#e3f3ea"
  success-surface-dark: "#183c2e"
  warning: "#8a5300"
  warning-dark: "#f0b357"
  warning-surface: "#fff0d0"
  warning-surface-dark: "#49361c"
  danger: "#b3261e"
  danger-dark: "#ff9a90"
  danger-surface: "#fee9e7"
  danger-surface-dark: "#492725"
  pending: "#5a3fb8"
  pending-dark: "#b3a0ff"
  pending-surface: "#eeeaff"
  pending-surface-dark: "#312b50"
  badge-success: "#084d2c"
  badge-success-dark: "#8be3b7"
  badge-warning: "#643900"
  badge-warning-dark: "#ffd08a"
  badge-danger: "#851c16"
  badge-danger-dark: "#ffbbb4"
  badge-pending: "#3e258a"
  badge-pending-dark: "#d0c0ff"
typography:
  display:
    fontFamily: "Geist, Noto Sans Thai, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, Noto Sans Thai, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, Noto Sans Thai, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "Geist, Noto Sans Thai, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Geist, Noto Sans Thai, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  control:
    fontFamily: "Geist, Noto Sans Thai, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  mono:
    fontFamily: "Geist Mono, Noto Sans Thai, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  badge:
    fontFamily: "Geist, Noto Sans Thai, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
  input-touch:
    fontFamily: "Geist, Noto Sans Thai, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
rounded:
  small: "4px"
  control: "6.4px"
  surface: "8px"
  specimen: "12px"
  pill: "999px"
spacing:
  field-label: "2px"
  base: "4px"
  related: "8px"
  compact: "12px"
  content: "16px"
  section: "16px"
  group: "24px"
  wide: "48px"
  chapter: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-contrast}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.raised}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "36px"
  button-destructive:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "36px"
  input-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
    height: "36px"
  workflow-tab:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    height: "36px"
  badge-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.badge-success}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "4px 9px"
  task-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.specimen}"
    padding: "20px"
  button-primary-touch:
    padding: "10px 16px"
    height: "48px"
  input-neutral-touch:
    typography: "{typography.input-touch}"
    padding: "10px 10px"
    height: "48px"
  workflow-tab-touch:
    height: "48px"
  statistic-strip:
    textColor: "{colors.text}"
  attendance-times:
    textColor: "{colors.text}"
---

# Design System: Storage Planner quieter design sheet

## Overview

**Creative North Star: "Clear work. Quiet surfaces."**

This document describes the completed [standalone design sheet](index.html), a quieter composition proposal selected by the user. The familiar blue, neutral surfaces, bilingual type and visible controls support warehouse tasks and people operations. Headings, spacing and a small number of dividers provide hierarchy; related work shares a surface.

**Scope and authority:** the frontmatter is normative only for this sheet. It records the palette extracted at the start of the 2026-10-09 session, as preserved in [tokens.css](tokens.css), and the typography, shapes and component values implemented in [styles.css](styles.css) and root-only [review.css](review.css). The `badge-*` colors are explicitly proposed foreground additions from the final stylesheet, requested for stronger status contrast; they are not part of the original token extraction. The proposed layout rules below are reviewable recommendations, not shipped application rules. This file does not create or replace project-wide design authority. [README.md](README.md) maps every specimen to its application sources.

**Dated palette snapshot and current application:** at documentation time, `src/app/globals.css` has a different light-theme blue, canvas, text, raised surface, muted text and several semantic/hover values. For example, its blue is `#1d4ed8`, canvas is `#ffffff`, text is `#17212f`, raised surface is `#f6f7f9`, and muted text is `#475569`. Those current working-tree values are not the sheet's session snapshot. The sheet remains a composition proposal; it does not authorize a palette migration or revert other work. The current application stylesheet owns current application tokens.

**Key Characteristics:**

- Familiar blue for primary action, with neutral secondary controls.
- One task surface with divided sections and unboxed totals.
- Thai and English, fixed operating type sizes and numeric clarity.
- Distinct status, loading, empty and failed-save presentations.

## Colors

The session snapshot pairs a vivid blue with grayscale operating surfaces. Frontmatter values retain their original CSS format; `-dark` keys record the sheet's dark overrides. The sidecar's eight-step tonal ramps are generated panel previews, not extracted application scales or approved replacements for semantic colors.

### Primary

- **Operating blue** (`primary`): primary task actions and the brand mark. Its dark counterpart remains blue, while `primary-border-dark` keeps the action boundary visible.
- **Action hover blue** (`primary-hover`): a darker button hover state; it is not a second accent.
- **Primary contrast** (`primary-contrast`): light text on blue controls in both themes.
- **Selected surface** (`selected`): quiet selection and the floor-plan selection specimen, not the default fill for an entire form.
- **Dark link blue** (`link-dark`): readable dark-theme links and active tabs. Dark focus uses this value; light focus uses `focus`.

### Neutral

- **Canvas** (`canvas`): document background outside the workspace specimen.
- **Task surface** (`surface`): fields and the shared workspace specimen.
- **Raised neutral** (`raised`): specimen context, subtle hover fills and disabled controls.
- **Operating text** (`text`): headings, labels and primary content.
- **Supporting text** (`muted`): summaries, metadata and hints.
- **Divider** (`divider`): occasional task or section boundaries; not the visible edge of an input.
- **Control edge** (`control-edge`): stronger neutral input and outline-button boundaries. It remains visible in both themes.

### Semantic status

Success, warning, danger and pending each have a text color and quiet surface pair. The specimen uses success for completed or mapped states, warning for review and waiting, danger for errors or destructive actions, and purple for pending work. These are operational meanings, not additional brand accents. At the user's request, status badges use stronger `badge-*` foreground inks, semibold text and slightly stronger icon strokes. Those proposed inks are defined by the sheet's `--sheet-status-*` variables in `styles.css`; `tokens.css` retains the original session palette for other semantic uses. Physical floor area colors and occupancy colors retain their independent domain meaning; the schematic walkway color is not a global UI token.

**The Meaningful Color Rule.** Pair status color with an icon and readable text. Preserve area identity separately from selection, occupancy and status.

## Typography

**Display and body font:** Geist with Noto Sans Thai and sans-serif fallbacks. **Numeric font:** Geist Mono with Noto Sans Thai and monospace fallbacks. The sheet loads these fonts locally.

The operating scale is compact and familiar. The document's larger introductory headline belongs to this reading surface; it is not a proposed application page-heading size.

### Hierarchy

- **Display:** the sheet introduction only (40px / 1.15 on desktop and at widths of 800px and below). It uses 36px / 42px below 520px.
- **Headline:** the operating page specimen and workflow titles (24px / 32px, 600). Narrow workflow titles use 22px / 30px in this sheet.
- **Title:** operating section specimen (18px / 28px, 600). Document subheadings also use a small negative tracking adjustment.
- **Body:** operating body specimen and controls (14px / 20px). The sheet's document body uses a 1.5 line height; supporting explanatory copy sometimes uses longer line heights.
- **Label:** operating metadata specimen (12px / 16px). Field labels use medium weight; longer hints and captions use 18–19px line heights.
- **Mono:** identities, measurements and clock times. Attendance values are a signature specimen (36px / 48px, 500; 30px / 42px below 520px).

**The Numeric Identity Rule.** Use monospace for codes, times and measurements, and tabular figures for aligned quantities. Preserve natural Thai wrapping.

## Layout

**Proposed layout rules:** related task content shares a surface. Use a heading and summary before the working content, then place the task action where its scope is clear. The job scan is the default first specimen; workflow tabs, locale and theme controls let the reader compare the proposal directly.

The sheet itself is capped at 1440px. Its workspace pairs an explanatory column with a flexible specimen. Foundation and control chapters use two columns; state examples use three. At the user's request, required field grids use an 8px gap and optional details use flexible rows with an 8px gap and 120px numeric-field basis. In-task sections use 16px, major task groups use 24px, and documentation chapters are separated by 40px. These are proposed density rules for the completed sheet; the general rhythm remains based on 4px.

At 1100px and below, page padding and workspace gaps tighten. At 800px and below, the workspace and explanatory chapters stack; documentation navigation moves to its own row. At 520px and below, fields and floor inspector content stack, the statistic strip becomes two columns, and key task actions fill the content width. Tabs and tables scroll inside their own regions. These are this sheet's measured breakpoints, not replacements for the application's breakpoints.

**The Task Surface Rule.** Within this proposal, group with spacing and selective dividers before adding another container. Keep a surface when it defines a workspace or map boundary.

**Responsive control density:** fields, buttons, tabs and disclosure summaries use 36px targets only at widths of at least 768px with a fine primary pointer. All other contexts use 48px targets and 16px / 24px input text. The root-only [review.css](review.css) follows the application query; the 800px and 520px layout breakpoints remain independent. Frontmatter control heights describe the dense state, not the default touch state.

## Elevation & Depth

**Proposed depth rule:** the sheet has no box shadows. Neutral tonal changes, explicit control edges and occasional dividers provide separation. The single workspace specimen frame gives the interactive examples a boundary, while the statistics and HR receipts remain unboxed. The application defines a shadow vocabulary in its stylesheet; this sheet does not remove or redefine that vocabulary.

**The Flat Task Rule.** Keep task content flat in this proposal. Use surface tone and hierarchy to separate content, reserving borders for controls, boundaries and meaningful divisions.

## Shapes

Frontmatter component heights describe desktop defaults; named touch variants record the responsive overrides. Controls preserve gently rounded application corners (6.4px). Color strips and the floor schematic use broader corners (8px); the document's workspace frame uses 12px. Status badges are pills, while small document labels and skeletons use 4px corners. These shape values describe actual sheet components and do not turn the specimen frame into a new global card default.

Visible input and outline-button edges are one pixel. The active workflow tab uses a two-pixel underline. Keyboard focus uses a two-pixel outline with a two-pixel offset for buttons, tabs and other controls. Fields and search inputs retain a blue border and use the same two-pixel outline with a negative one-pixel offset, touching the border and extending one pixel outward.

## Components

### Buttons

Clear and familiar. Buttons use the control radius, 6px / 12px desktop padding (10px / 16px in touch density), a 36px desktop minimum height and width, increasing to 48px unless the ≥768px fine-pointer query matches, and medium-density 14px text. The blue primary action leads; outlined and quiet actions stay neutral. Destructive actions use the danger surface and a danger edge. Disabled controls use raised neutral, muted text and the weaker divider edge.

Hover changes the fill. A press moves an enabled button down by one pixel. Color transitions run for 160ms; reduced motion removes transitions. Keyboard focus remains visible. Loading and disabled specimens are visually distinct.

**The Scoped Action Rule.** Give each task one primary next action, and keep secondary actions neutral.

### Chips

Readable operational status. Badges combine a small inline SVG, label, semantic surface and one-pixel edge matching the text. Their padding is 4px / 9px; type is 12px / 16px at semibold weight, and the icon stroke is 2.25px. They are passive status indicators, not action targets.

### Cards / Containers

A shared task surface. The workspace specimen has one surrounding frame with the specimen radius and a divider edge. Its neutral context bar, tab strip, working content and explanatory caption share that frame. The content padding is 20px on desktop, with 20px / 16px on phones. No nested ticket, statistic or attendance cards are introduced in the proposal.

### Inputs / Fields

Neutral and legible. Fields have a task-surface fill, strong neutral edge, control radius, 6px / 10px desktop padding and a 36px desktop minimum height, increasing to 48px unless the ≥768px fine-pointer query matches. Touch-density inputs use 10px vertical padding and 16px / 24px text. At the user's request, labels sit very close to their inputs (2px). This is a proposed field detail, not a replacement for the general 4px spacing rhythm. Hint and recovery text sit below. Focus changes the edge and shows the sheet's outline. Invalid fields receive a danger edge and explanatory recovery copy.

Job scan keeps its location first, two required identities and seven optional fields. AI origin is a small warning-colored label immediately beside the relevant field name, with a 6px inline gap and a review advisory. Editing that field clears its origin label in the interactive sheet. The entire field is not tinted to express origin.

### Navigation

The document header provides section links, locale, theme and print controls. Workflow tabs are the signature navigation: muted text at rest, operating text on hover, blue text and an underline when selected. They support keyboard arrow, Home and End navigation in the sheet. Locale changes maintain the selected workflow; theme changes update both the live specimens and displayed palette values. The print control exports the current workflow and uses a light print presentation.

### Statistic strip

Totals are unboxed and aligned in a four-column strip, with small supporting labels and 24px medium-weight numerals. Phones use two columns. The live specimen shows explicitly synthetic, scoped totals; this composition does not change how production totals or pagination are computed.

### Attendance times

Actual clock-in and clock-out values sit in two divided columns, with monospace emphasis and explicit recorded/unrecorded treatment. Planned shift and site remain separately labeled below. One next clock action leads the task; the sheet's action changes only its synthetic local state.

### States and floor inspection

Empty and failed-save examples pair a clear description with a neutral recovery action. Finished-goods errors, refused HR writes and uncertain HR writes have separate examples; only uncertainty offers an exact safe retry. View-only hides write controls. The Review state selector belongs to documentation and is not application navigation. Loading/unavailable totals never become zero. The floor schematic has three keyboard-selectable locations; its inspector follows the selected fixture, and unknown contents are unavailable. Actual narrow floor details open in a sheet. This is not a production geometry or 3D renderer.

## Do's and Don'ts

### Do:

- **Do** preserve the familiar palette roles, bilingual fonts and visible control boundaries when reviewing this composition.
- **Do** group related work with headings, spacing and selective dividers inside the shared task surface.
- **Do** keep field labels 2px above inputs, with AI origin beside the field name as requested for this proposal.
- **Do** pair status color with text and an icon, and keep physical area identity separate.
- **Do** keep planned and actual attendance times separately labeled, and make save scope clear.
- **Do** check Thai and English, both themes, keyboard focus, narrow layouts, reduced motion and long identifiers before implementing a proposal.

### Don't:

- **Don't** treat this sheet or its session token snapshot as shipped application behavior or project-wide design authority.
- **Don't** add repeated nested cards or boxed totals to the quieter specimens merely to group related content.
- **Don't** replace neutral fields with broad AI-origin color fills in this proposal.
- **Don't** confuse synthetic local specimen actions with backend writes, scanning, authorization or persisted attendance receipts.

## Adoption revision · 2026-10-11

An independent Kiro audit checked the original sheet and implementation plan against source at `733c6aca`. The approved no-inner-rail composition remains intact. [review.js](review.js) corrects specimen semantics and adds local review states without editing application code. Comparison layouts now use frozen assets; earlier screenshots/checks describe `8b0ef538`, not this revision.

Scan keeps the single-ticket source/removal row, per-field scanning actions, Unit type, Change and stock note. Save is disabled for reading, incomplete identities or invalid quantities; seven optional values report the actual filled count. Product records show Ready/Draft, while storage-unit records carry workflow statuses. Warehouse totals are deliberately independent of the three synthetic rows and filters. Attendance uses factual Clocked in/out states, Buddhist-era Thai dates, missing-time hints, a confirmed receipt and correction links. Uncertain, refused, denied, pending and unlinked examples preserve the distinction in the source.

The [revised adoption plan](implementation-plan.md) chooses stronger badge ink and restrained invalid edges as shared implementation work; catalogue quantities are a separate slice. The application palette remains authoritative. Floor and HR are verification/handoff steps; the separate HR self-service plan owns attendance screen edits. Root `PRODUCT.md` and project-wide design authority were not changed.

Fresh visual layout/axe checks need a connected collaborative preview automation host. DOM evidence for this revision is separate from the historical screenshots.
