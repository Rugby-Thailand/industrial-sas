# Documentation review

Reviewed on 2026-10-11 after the final preview correction. This is the ordinary-extension documentation finish pass for the standalone HR employee self-service design prototype. It records the built artifact and its relationship to the incumbent app; it does not establish a new visual world or an approved design-system change.

## Later narrow revision

The user subsequently requested drag-only shortcut ordering. Root rechecked the scoped preview changes: arrow controls were removed; one six-dot grip now handles pointer/touch/keyboard reordering using existing selected/link/neutral tokens. Fonts, global theme values and incumbent source files were preserved. The fourth board was edited through ImageGen. [Current evidence](shortcut-drag/review.md) supersedes the customization captures and artifact hashes sampled by the original documentation pass below. This note is a root follow-up, not a new independent documentation review.

## Overview

`PRODUCT.md` and `review/direction.md` require friendly hrzoft-inspired grouping inside Storage Planner's existing identity. The implemented preview follows that direction through labelled shortcuts, rounded icon pads, quiet task panels and an immediately available attendance action. The four component studies and ten page boards are composition and critique references. User approval has not been recorded; their image-generated typography, copy and pixels are not authoritative production specifications.

The existing app code remains the visual authority. No root `DESIGN.md` or `.impeccable/design.json` existed at this pass, and neither was created. The sole write from this pass is this report. No production source, token, component or incumbent design file was changed.

## Evidence checked

- Final artifact: `preview/index.html`; all of `preview/styles.css`; the shared icon, button, badge, shell, panel and Action Card functions in `preview/app.js:36–43, 120–124`, customization at `:143`, component showcase at `:164`, route rendering and theme handling at `:166–179`, and local preference behavior at `:68–77, 189`.
- Incumbent colors, semantic aliases, typography, density, spacing, focus, motion and radius definitions: `src/app/globals.css:9–69, 146–255, 258–319, 345–428`.
- Incumbent components: `src/components/ui/Panel.tsx`; `StatusBadge.tsx`; `buttonVariants.ts`; `input.tsx`.
- Incumbent font and shell sources: `src/app/[locale]/layout.tsx:1–29, 77–89`; `src/components/shell/DesktopShell.tsx`; `src/components/examples/c-sidebar-2.tsx:88–125, 240–269, 419–462`; `src/components/ui/sidebar.tsx:22–26, 158–246, 336–354`; `src/hooks/use-mobile.ts`; `messages/en.json` and `messages/th.json` (`App.name` is Storage Planner in both).
- Visually opened final captures: `review/final/customize-desktop.png` (1440 × 1105), `components-desktop.png` (1440 × 1166), `home-mobile.png` and `home-dark-mobile.png` (both 390 × 2623). These are full-page images from the declared 1440 × 960 and 390 × 844 browser viewports. The fixed mobile navigation appears at the viewport boundary inside the tall capture; that placement is not the page's footer.
- SHA-256 checks matched the current `index.html`, `styles.css`, `app.js` and `plan.md` to `review/final/artifact-hashes.json`. The twelve incumbent source files listed above matched their entries in `review/application-baseline.json`. This verifies the sampled sources, not every unrelated working-tree change.

## Colors

The preview copies the app's semantic palette into local CSS aliases. White expressed as `#fff` is equivalent to the source's white hex and achromatic `oklch(1 0 0)` surfaces; abbreviated decimal notation below preserves the same CSS value.

| Role | Light preview and incumbent | Dark preview and incumbent |
|---|---|---|
| Canvas / surface / raised | white / white / `#f6f7f9` | black / `oklch(.145 0 0)` / `oklch(.23 0 0)` |
| Text / muted text | `#17212f` / `#475569` | `oklch(.946 0 0)` / `oklch(.72 0 0)` |
| Primary action / hover | `#1d4ed8` / `#1e40af` | `oklch(.46 .22 266)` / `#2948cd` |
| On-primary / primary border | white / `#1d4ed8` | `oklch(.985 0 0)` / `#8298ed` |
| Selected surface / link | `#eff6ff` / `#1d4ed8` | `oklch(.32 0 0)` / `#a9baff` |
| Border / control edge | `oklch(.92 0 0)` / `#808080` | `oklch(.26 0 0)` / `#858585` |

Success, warning, danger and pending text/surface pairs also copy the incumbent values: the preview's green, amber, red and purple encode workflow states rather than categories. The final dark selected surface, on-primary foreground, hover and primary border match `globals.css:365–366, 401, 406` exactly. The visible dark home keeps its selected icon pads neutral and its primary action blue with a pale border.

**Source-role rule:** copied values retain their source roles; the preview does not license a second brand palette. It omits unused app roles such as warehouse occupancy bands and overlay-specific primitives rather than inventing replacements. Primary button foreground uses on-primary; selected-card content uses the link role, matching the app's active button and accent badge usage.

## Typography

The incumbent uses Geist and Geist Mono from `next/font`, with Noto Sans Thai in the sans fallback stack. The preview uses those same families through local font files and explicit `@font-face` rules. Providing the Thai font locally makes the prototype self-contained; this is not a production font-loader change. The sampled production layout loads the two Geist families; production Thai font loading was not verified here.

The observed preview hierarchy is a page title (28px, weight 650, line-height 1.35), section title (20px, 650, 1.5), row title (16px, 650), body (15px, line-height 1.6), secondary text (12–14px), and numeric emphasis (22–40px). Below 550px, page and section titles reduce to 24px and 18px, and the clock to 36px. Geist Mono and tabular numerals align time, counts and statement amounts. These sizes describe this artifact, not a new global type scale.

The app's shared fields use 16px text for touch and 14px on dense desktop; preview fields inherit its 15px base. The preview's current type ramp and field typography therefore remain local decisions that must be reconciled with production controls during implementation. The six previously reported detector warnings about Geist/Geist Mono are documented in the direction contract; the existing identity takes precedence over changing the font to silence them. This pass ran no detector.

## Layout

The desktop preview keeps Storage Planner naming, a blue line-icon brand tile, a left navigation column, a top header and an account footer. It models that shell rather than duplicating it: the prototype sidebar is expanded at 224px (204px below 1150px), while the app configures a 13rem expanded sidebar and 4rem icon rail with an initially collapsed desktop state. The preview's sidebar uses the surface role; the app uses its dedicated sidebar role. The preview's box glyph also differs from the app's Building2 glyph. None of these local substitutions records a rebrand or a shell replacement.

Main content has a 1280px maximum, 32px horizontal desktop padding, a 24px column gap, and a two-column task layout. Below 900px the sidebar becomes a drawer, content becomes one column, and four persistent mobile destinations appear. Below 550px the page uses 20px horizontal padding, titles and secondary rows compact, and the attendance action occupies the card width. The source shell changes to mobile below 1024px; the preview's 900px threshold and bottom navigation are prototype composition choices.

The mobile home captures place Today, recorded punches and the next action ahead of secondary tasks. They show a saved five-shortcut preference state; the initial source definition contains six shortcuts. The customization capture shows all six and retains the attendance action independently of shortcut visibility.

**Task-first rule:** the attendance action remains in Today when shortcuts are hidden. **Local-width rule:** the narrow customization preview uses the same stacked card anatomy as mobile at every width; its scoped two-column grid, wrapped copy and top-right count keep labels readable without changing other Action Card contexts (`styles.css:19–20`).

## Elevation & Depth

Task surfaces are flat, using borders and neutral or selected fills for separation. Action Card hover adds a link-colored edge and selected fill. The only explicit preview shadow is the transient toast (`0 4px 16px rgb(0 0 0/.12)`). Dialogs and drawers use translucent backdrops. The app has a broader shadow vocabulary, so this artifact's restraint does not establish a global ban on elevation. Brief transitions and a loading spinner are disabled by the preview's reduced-motion rule; the app preserves the same preference with its own shorter-duration implementation.

## Shapes

The preview uses friendly local corners: task panels (16px), Action Cards and icon pads (14px), buttons (12px), inputs (10px), and badges (8px). Padding varies with content and viewport, typically 24px on desktop panels, 18px on mobile panels, and 16px on shortcut cards. This is the requested reference-inspired grouping expressed with incumbent colors; these literal values do not replace the app's rem-based radius and spacing tokens.

The incumbent Panel supports surface, plain and divided appearances and defaults to the section spacing token (1rem). Its task rhythm explicitly uses 2px label gaps, 8px field gaps, 16px section gaps and 24px group gaps. The preview instead uses direct component values and more framed panels to make the design boards inspectable. This report records that local adaptation without canonizing nested panels as a production rule.

## Components

The shared Action Card has an SVG icon pad, a labelled destination, supporting copy and an optional count. The same local class supplies shortcuts, summary metrics and component-state examples; request rows share its icon/text/status language through a separate list-row renderer. It is an HTML/CSS prototype pattern, not an added React component or an expanded production component API.

Desktop destination cards default to horizontal anatomy (minimum height 86px); mobile cards stack icon above text (minimum height 138px), while metrics keep a horizontal compact arrangement. Current and hover states use selected fill and a link-colored edge; unavailable examples use disabled semantics and reduced opacity. Ordinary preview buttons and fields have a 48px minimum height. Review controls and some table actions use smaller local variants; this does not reproduce the app's pointer-aware density system, which preserves 48px touch targets and permits 36px controls only on fine-pointer desktop.

Pending, certified and returned request badges pair Thai words with a clock, check or return shape (`app.js:40–42`), preserving the incumbent StatusBadge principle that status is not color alone. The preview's rounded rectangular badges omit the production pill border and differ in padding and weight. This is a visual adaptation, not a replacement for `StatusBadge.tsx`.

The preview has a 3px separated link-colored focus outline, native dialog semantics, a skip link, labelled icon controls, current navigation semantics and local drawer focus handling. Production uses a 2px outline and a close field-edge focus treatment. The local implementation supports review of these behaviors; source and screenshots alone do not certify comprehensive accessibility.

## Do's and Don'ts

- Do use incumbent semantic tokens and shared controls when implementing the approved production flow; treat this report's direct values as evidence of the prototype.
- Do retain words and recognizable shapes alongside workflow colors and keep original attendance evidence distinct from effective or proposed values.
- Do preserve the reusable shortcut anatomy and its scoped narrow-panel stacking when assessing this prototype.
- Don't infer user approval from an image, this documentation pass, or a finish review of listed fixes.
- Don't promote preview-only shell dimensions, font sizes, radii, badge variants or synthetic HR rules into global design tokens without an approved system change.

## Drift and limitations

Pre-existing documentation drift was observed in `Panel.tsx`: its comment describes a 12px surface radius, while the current `rounded-xl` token formula is `0.5rem × 1.4 = 0.7rem`. The code is the evidence; neither that comment nor the preview's 16px radius was repaired or made normative. No other durable system drift is asserted from this sample.

The unused `.eyebrow` declaration and tracked uppercase navigation group labels in the preview are not adopted as new system-wide typography rules. Source typography and existing navigation grouping remain the authority; a declaration's presence alone does not make it a reusable standard.

This pass compared source and four supplied final captures. It did not run new browser tests, a second detector, backend checks, policy validation, a pixel comparison to an approved comp, or a full-surface finish verdict. The separate fresh reviewer returned `ship` for the three listed fixes, each scored resolved; this documentation pass does not broaden that verdict or record user approval. Prototype roles, verification, downloads, forms and local state are synthetic demonstrations; they provide no authentication, authorization, payroll or persistence guarantee. Final source hashes match the capture manifest, but any later implementation or visual edit requires the relationship documented here to be checked again.
