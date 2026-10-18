---
name: "Industrial SAS employee LINE preview"
description: "Artifact-local record of the authorized Drease / EasePOS UI extension"
colors:
  blue: "#2d55eb"
  blue-soft: "#edf2ff"
  ink: "#1a1a1f"
  muted: "#58585c"
  line: "#e2e5eb"
  canvas: "#f6f7f9"
  surface: "#fff"
  input: "#fff"
  green: "#065f3e"
  green-bg: "#e9f5ef"
  amber: "#92400e"
  amber-bg: "#fff5e7"
  red: "#991b1b"
  red-bg: "#feeeee"
  chat: "#8fa9cf"
  card-head: "#1b5e4b"
  blue-dark: "#9bb4ff"
  blue-soft-dark: "#26314c"
  ink-dark: "#f0f0f3"
  muted-dark: "#bdc1cc"
  line-dark: "#3c414c"
  canvas-dark: "#17191e"
  surface-dark: "#22252c"
  input-dark: "#272b33"
  green-dark: "#9bd9b8"
  green-bg-dark: "#19382a"
  amber-dark: "#ffd49b"
  amber-bg-dark: "#3c2d1a"
  red-dark: "#ffb0b0"
  red-bg-dark: "#412323"
  primary-hover: "#2244cb"
  phone-white: "white"
  phone-shell: "#111319"
  phone-ink: "#17212f"
  card-title: "#14213f"
  employee-bubble: "#ddf5d1"
  assistant-note: "#e9f0fc"
typography:
  body:
    fontFamily: "Sarabun, Thonburi, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  headline:
    fontFamily: "Sarabun, Thonburi, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  headline-mobile:
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Sarabun, Thonburi, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.5
  subheading:
    fontSize: "16px"
    fontWeight: 600
  label:
    fontSize: "14px"
    fontWeight: 600
  card-body:
    fontSize: "13px"
    lineHeight: 1.8
rounded:
  control: "8px"
  navigation: "9px"
  panel: "12px"
  card: "13px"
  dialog: "14px"
  status: "20px"
  phone: "36px"
  phone-mobile: "25px"
spacing:
  field-label-gap: "6px"
  action-gap: "8px"
  field-gap: "18px"
  panel-padding: "23px"
  panel-padding-mobile: "18px"
  split-gap: "34px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.phone-white}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.phone-white}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.blue}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  field:
    backgroundColor: "{colors.input}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  navigation-active:
    backgroundColor: "{colors.blue-soft}"
    textColor: "{colors.blue}"
    rounded: "{rounded.navigation}"
    padding: "9px 12px"
  status-good:
    backgroundColor: "{colors.green-bg}"
    textColor: "{colors.green}"
    rounded: "{rounded.status}"
    padding: "3px 9px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "23px"
  flex-card:
    backgroundColor: "{colors.phone-white}"
    textColor: "{colors.phone-ink}"
    rounded: "{rounded.card}"
---

# Design System: Industrial SAS employee LINE preview

## Overview

**Creative North Star: "Drease / EasePOS employee extension"**

This record applies only to the standalone preview in this directory. It captures the finished HTML and CSS in Operate mode, following the user’s authorized reuse of Drease / EasePOS. It is not a replacement identity or a design authority for the Industrial SAS production application. The local CSS remains the source of truth; frontmatter records its light defaults and observed dark overrides.

The preview combines a flat settings rail and blue selected controls with a LINE Card and a playable employee chat. Neutral surfaces, readable Thai type and explicit labels carry the work. The signature interaction is the same publication moving from HR composition to employee acknowledgment and back to HR tracking.

**Key Characteristics:**

- Flat rail and content plane separated by a hairline.
- Blue selection and primary actions; neutral body text.
- Sarabun typography with generous Thai text leading.
- White Card with a clear message title inside a blue LINE chat illustration.
- Visible sample-state and receipt semantics throughout the employee flow.

## Colors

The palette preserves the inspected Drease royal blue and neutral text, alongside the reference LINE chat blue and green sender initials. Frontmatter values are exact observed source values, not a proposed global palette.

### Primary

- **Blue** (`blue`): selected rail rows, links, focus, and fixed royal-blue primary buttons. The `blue-dark` value is the light ink used by theme-aware controls in dark appearance.
- **Soft blue** (`blue-soft`): active navigation, selected choices, notices and HR reply bubbles. Its dark counterpart belongs to the workspace theme.

### Secondary

- **Sender green** (`card-head`): sender avatar initials in the illustrative chat. The legacy token name remains; the Card banner was removed at the user’s request on 14 October 2026.
- **LINE chat blue** (`chat`): the phone’s conversation ground. The phone chat stays light when the workspace switches appearance.

### Semantic and neutral

- **Green / amber / red** and their background pairs distinguish success, pending/warning, and refusal/error with visible wording.
- **Ink / muted** carry primary and secondary workspace text. **Canvas / surface / input / line** distinguish the page, flat surfaces, fields and borders.
- Fixed phone colors are extracted separately because the simulated LINE chrome and message bubbles do not consume workspace dark overrides. Primary buttons also remain royal blue with white text in both themes.

**The Scope Rule.** Apply this record within this preview only; production identity, navigation and authorization remain governed by the application.

## Typography

Sarabun is locally loaded as regular and semibold, with Thonburi and sans-serif fallbacks. No separate display or mono family is introduced. The semibold font face supplies the requested 500–700 weight range in this artifact.

The source hierarchy is page headline (28px, 600, 1.4), section/Card title (19px, 600, 1.5), subheading (16px, 600), body (15px, 1.65), and field/action label (14px, 600). At 720px and below, page headlines become 24px and form/compose input text becomes 16px. Card body text uses 13px with 1.8 leading. Paragraphs have an observed maximum width of 72ch. Smaller simulated phone chrome and metadata are not generalized into a body-text standard.

## Layout

The desktop shell has a 236px rail and a flexible workspace. Main content is capped at 1500px with 31px 34px 50px padding. Card composition uses a flexible form beside a 350px preview, separated by a 34px gap. The employee layout places a 320–385px phone beside the task content. Forms use two columns with 18px gaps; panels use 23px padding.

At 1180px, the rail becomes 210px and split gaps narrow. At 1020px, composition and employee layouts become a single column; the phone preview loses sticky positioning and the employee task content precedes it. At 720px, the shell becomes a stacked layout, navigation becomes a horizontally scrolling row, form fields become one column, and the main gutter is 16px. Employee tables switch to cards; the inbox stacks its thread navigation above the conversation.

The final mobile/coarse-pointer rules raise the listed scenario, navigation, role, employee, readiness, tracking-row, compose, Back and disclosure controls to a minimum 48px height. Main mobile buttons and fields also use 48px. Icon and phone-send controls gain a minimum 48px width. These values describe the checked preview; they do not certify unmeasured physical devices or every future control.

## Elevation & Depth

The rail, workspace and panels use borders and tonal states rather than floating elevation. The shared source shadow is `0 12px 35px rgba(0, 0, 0, 0.13)` in light appearance and `0 12px 35px rgba(0, 0, 0, 0.3)` in dark appearance. It belongs to the phone, toast and dialog. The mobile phone has no shadow. The native dialog backdrop uses `rgba(15, 20, 35, 0.38)`.

**The Flat Shell Rule.** Keep the rail and workspace free of decorative elevation; reserve the observed neutral shadow for the phone illustration, toast and dialog.

## Shapes

Controls use gently curved 8px corners, selected rail rows 9px, flat panels 12px, Cards 13px, and dialogs 14px. Status badges use 20px corners. The illustrated phone has a 36px outer radius and a 29px clipped screen, becoming 25px and 20px on mobile. These role-specific shapes do not form a new repository-wide radius scale.

## Components

### Buttons and fields

Primary buttons use fixed royal blue, white text, 8px corners and 8px 15px padding; hover uses `primary-hover`. Secondary buttons use themed surface and ink with a one-pixel border; quiet actions remove the border/background while keeping themed blue text. Disabled buttons use opacity 0.5 and a not-allowed cursor. Fields use the themed input background, a line border, 8px corners, 9px 12px padding and a 43px desktop minimum height. The shared `:focus-visible` treatment is a 3px blue outline offset by 3px.

### Navigation, status and containers

Rail rows have stroke icons, regular muted labels and a blue-soft selected row with semibold blue text. Mobile navigation scrolls horizontally; the actual source centers the selected row. Status chips pair semantic text/background with explicit status words. Panels stay flat with a line border; roster tables, mobile employee cards and the HR inbox retain the same neutral treatment.

### LINE Card and chat

The phone is an illustration of the employee channel. It has fixed white chrome, a blue chat ground, sender initials and a company sender label. Cards start directly with their message body, a 19px semibold title, and stacked blue primary/quiet detail actions. The light Card colors and white primary-button text remain fixed across workspace themes; frontmatter records their fixed `phone-white` separately from the workspace surface.

A Card composer updates the live preview; published messages retain their version. Employee acknowledgment updates the same publication’s HR tracking. Employee and HR compose drafts are retained by employee/thread in local session state and are cleared only on successful send. These are behavioral patterns in a local simulation, not production integration guarantees.

**The Receipt Rule.** Preserve separate labels for provider acceptance, an in-app detail opening and explicit acknowledgment.

Toast opacity/translation transitions use 0.18s; the pending indicator rotates over 0.8s linear. Reduced-motion rules remove the toast transition and pending animation. No broader motion language is inferred.

## Do's and Don'ts

### Do

- Do keep blue selected controls, neutral text and the flat two-pane relationship.
- Do preserve native labels, visible keyboard focus and the final 48px mobile touch-target treatment.
- Do distinguish the illustrative LINE chat from the HR workspace and label sample operations.
- Do retain publication/version context in employee and HR receipt views.

### Don't

- Don’t promote these local tokens into a production or repository-wide identity change.
- Don’t conflate provider acceptance, opening and acknowledgment.
- Don’t copy the source references’ customer booking workflow into this employee HR preview.
- Don’t infer live authentication, delivery or persistence from the local account selector or sample transitions.
