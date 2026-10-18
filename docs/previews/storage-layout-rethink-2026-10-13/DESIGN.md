---
name: "Storage Planner — PD workspace preview"
description: "Scoped record of the standalone lookup, stock operations and layout editing prototype."
colors:
  canvas: "#f7f8fa"
  surface: "#ffffff"
  raised: "#eef0f3"
  text: "#20242c"
  muted: "#596170"
  border: "#dce0e6"
  control-edge: "#8b939f"
  accent: "#2444cf"
  selected: "#edf1ff"
  stored: "#16613e"
  stored-surface: "#edf6f0"
  reserved: "#86530b"
  reserved-surface: "#fff5df"
  unknown: "#63409b"
  unknown-surface: "#f5eefc"
  danger: "#af3029"
  canvas-dark: "#101215"
  surface-dark: "#191c21"
  raised-dark: "#262a31"
  text-dark: "#eef0f5"
  muted-dark: "#b0b7c3"
  border-dark: "#383e48"
  control-edge-dark: "#818b9b"
  accent-dark: "#4768e8"
  link-dark: "#a7b9ff"
  selected-dark: "#253252"
  stored-dark: "#91d8b0"
  stored-surface-dark: "#213b2c"
  reserved-dark: "#f3cc7e"
  reserved-surface-dark: "#44351c"
  unknown-dark: "#d3b1ff"
  unknown-surface-dark: "#382844"
  danger-dark: "#ffaaa4"
typography:
  headline:
    fontFamily: "Geist, Thai, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, Thai, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Geist, Thai, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, Thai, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  location: "5px"
  control: "6px"
  surface: "8px"
  dialog: "10px"
spacing:
  related: "8px"
  compact: "12px"
  content: "16px"
  panel: "18px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  location-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.accent}"
    rounded: "{rounded.location}"
    padding: "9px 5px"
---

# Design System: PD workspace preview

## Overview

This document describes only [index.html](index.html), following the [surface direction contract](../../../.impeccable/surfaces/rage-layout-rethink-2026-10-13-index-html-ebb5f90e.md). It extends Storage Planner's familiar blue actions, neutral task surfaces, bilingual sans typography and restrained operational colors. It does not establish a new project identity.

The composition gives lookup, storing/moving stock, and layout editing three visible task entry points on one workspace. Search, labeled Map/List controls, shared selection and contextual details keep each task understandable. The [README](README.md) records behavior, research and production integration limits.

Authority remains with [application globals](../../../src/app/globals.css); the [earlier design sheet](../../design-sheet/DESIGN.md) is another scoped proposal. The standalone prototype's hex values follow application **roles**, but are not exact imported application tokens. Its tokens are descriptive of this artifact only. Root product-context drift is outside this work.

This record is source based. Final mobile screenshot review was blocked by the T3 screenshot service failure; this document does not claim final visual approval.

## Colors

Blue identifies a selected location, current task, links and the primary action. Dark mode separates bright link/focus ink from the stronger button fill. Neutral canvas, white or dark surfaces, dividers and stronger control edges establish hierarchy without decorative panels.

Green marks stored stock, amber marks reservations and draft warnings, purple marks unknown contents, and red marks errors. Empty positions use neutral treatment. Status labels and small markers accompany color; reservations also use dashed location borders. These are local mappings, not changes to the production status taxonomy.

**The Explicit State Rule.** Keep state text visible when selection changes a location's fill; color alone must not carry the meaning.

## Typography

Local Geist serves Latin text and local Noto Sans Thai is registered under the CSS family name `Thai`; the fallback is the system sans stack. Copy uses compact operational hierarchy rather than display typography. The page heading becomes 20px on mobile; section headings use the title token, subsection headings use 15px semibold, and secondary labels generally use 12px. Identifiers use semibold sans, with tabular numerals where specified.

Mobile search and dialog inputs use 16px text. The implementation also has 10–11px secondary map labels at narrow widths; these are prototype density choices requiring legibility review, not a new application minimum type size.

## Layout

The centered workspace has a 1600px maximum width and 28px desktop side padding. A compact building/floor heading precedes task navigation, search/view controls and filters. The main surface holds either the floor overview with a group detail or a paginated list. Selecting a location adds a sticky 302px detail pane, changing to 280px at the intermediate breakpoint and 330px on wide screens.

The whole-floor SVG retains the approved PD plan ratio and all 198 positions across 12 groups. Group detail preserves row membership and ordering while enlarging targets; it is explicitly a schematic, not a measured drawing. Shared selected location connects map and list.

At 760px and below, the default view is List unless the URL selects a view. The workspace becomes one column, details open in a bottom sheet, and the optional group map scrolls horizontally with a 520px minimum width. Search spans the row; filters and group navigation can scroll. Intermediate and wide adjustments occur at 1050px and 1500px.

The prototype uses 36px default controls and selected 44px mobile controls, with smaller filter/view utilities. Production's shared control rule is 48px for touch and 36px only on wide fine-pointer screens. This difference must be resolved during adoption; the prototype breakpoint is not a replacement density standard. Field labels use a 5px gap here, differing from the incumbent 2px rule.

## Elevation & Depth

Working surfaces are flat, separated by borders, neutral fills and whitespace. Dialogs and notifications alone receive the shared soft shadow: `0 12px 40px #13243d24` in light mode and `0 12px 40px #0006` in dark mode. Dialog backdrops dim the workspace. Selection uses an outline rather than elevation.

## Shapes

Small rounded rectangles distinguish controls, positions and containers using the frontmatter radii. Status markers are small squares with gently rounded corners. Dialogs have softer corners, while mobile sheets use 12px top corners and meet the bottom edge. Task tabs remain flat with a blue underline; list rows share the parent container instead of becoming separate cards.

## Components

- **Task navigation:** three labeled buttons expose Find & inspect, Store / move and Edit layout. Selection is underlined and uses `aria-pressed`. Each task reveals its own actions without changing the workspace identity.
- **Search and view choice:** a prominent search field, visible Map/List labels, status filters and count text support finding a location. One status filter is active at a time; counts can overlap because a location can have several statuses.
- **Locations and details:** enlarged position buttons and list rows share selection. The detail pane/sheet shows location facts, stock units and the appropriate next action. Unknown content remains explicit. The overview and schematic have distinct purposes and labels.
- **Stock workflow:** incoming stock and per-unit Move actions lead through destination choice, reservation, collection where applicable, destination code verification and confirmation. Progress and cancellation are visible. All changes are synthetic tab memory; the empty-destination model does not implement production fit, overlap or support checks.
- **Layout editor:** label/height fields, a draft count, Save/Cancel and an unsaved-change dialog make edit scope visible. Height is locked for occupied or reserved locations. Geometry dragging, zone/floor creation and backend writes are outside this simulation.
- **Buttons and fields:** neutral borders at rest, blue primary actions, clear disabled treatment and a 3px keyboard focus outline. Search uses its own focus-within outline. Hover changes fill/edge; enabled presses move down one pixel. Color transitions and toast entrance animation are enabled only when reduced motion is not requested.
- **Dialogs, notices and feedback:** native dialogs contain settings, pending stock, guards and mobile detail. Inline error text, a live announcement region and transient status notifications explain local outcomes. Locale, theme and Reset remain prototype controls.

## Do's and Don'ts

- **Do** preserve the three task entry points and shared selection when evaluating this proposal.
- **Do** distinguish true floor proportions from enlarged schematic targets, and label synthetic inventory.
- **Do** keep status text, keyboard focus and cancellation visible in both themes and languages.
- **Do** reuse production tokens, density rules, permissions and workflow guards when adopting the composition.
- **Don't** promote this standalone token snapshot or its small secondary labels into global design authority.
- **Don't** mistake simulated reservations or layout saves for server validation or persisted operations.
- **Don't** infer final mobile visual approval from source inspection or earlier screenshots.
