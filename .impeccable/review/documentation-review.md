# AI usage documentation review

## Decision

Ordinary extension of the incumbent application. No design-system changes are warranted. Preserve `docs/plans/design-system.md`, `src/app/globals.css`, and the shared primitives; do not create a root `DESIGN.md` or `.impeccable/design.json` merely to mark this pass complete. The feature introduces reporting composition and behavior, not an approved visual identity or reusable token change. Page strategy remains in `.impeccable/surfaces/ai-usage.md`.

This report is the only file written by the documentation pass. No implementation, theme, product context, surface brief, or existing design documentation was changed.

## Evidence checked

- Shipped operating instructions: `impeccable_documenter.toml` and `reference/document.md` from the incumbent Impeccable skill.
- Product and direction: `PRODUCT.md`, `.impeccable/surfaces/ai-usage.md`.
- Incumbent system: `docs/plans/design-system.md`, `src/app/globals.css`, `src/app/[locale]/layout.tsx`, the desktop route layout, and the shared application shell.
- Shared component sample: `PageHeader`, `PageContainer`, `Panel`, `Button`, `Input`, `FormField`, `SelectControl` and its select primitive, and `Notice`.
- Finished artifact: `src/features/aiUsage/AiUsageScreen.tsx` and `src/app/[locale]/(desktop)/ai-usage/{page,layout}.tsx`.
- Visual evidence: `.impeccable/review/desktop.png`, `desktop-lower.png`, `mobile.png`, and `mobile-lower.png`; independent disposition in `finish-review.md` is `ship`.

The four images were inspected directly. They show Thai dark-theme desktop and mobile layouts, with the existing sidebar/header, controls, borders, and surfaces. Desktop uses a comparison table; narrow mobile uses paired cost rows and folds advanced filters. The lower captures show an edited unsaved FX source without stale success feedback and a restored source after a successful save. Source inspection confirms rate, fee, and source changes all reset feedback to idle. Images do not establish light-theme or English visual coverage; source uses the incumbent localized primitives and theme variables.

`git diff` shows no changes to the sampled shared primitives, global stylesheet, or incumbent design-system document. `git show HEAD` confirms the responsive heading and control dimensions described below predate this extension.

## Five-line system summary

Palette: incumbent white/light and black/charcoal dark surfaces, neutral borders and text, blue actions/focus, and semantic success, warning, danger, and pending colors; preserve the CSS source formats.
Typography: Geist sans with Noto Sans Thai fallback; page heading 22px narrow/24px wider with 32px line height, section heading 18px, body 14px, metadata 12px, and tabular numeric reporting.
Source authority rule: shared CSS variables and incumbent components remain authoritative; reuse the existing shell, panels, fields, selects, and buttons.
Spacing and surface rule: 4px base rhythm, 16px panel padding, 24px report sections, modest rounded borders, and flat resting panels; reserve existing shadows for floating content.
Responsive containment rule: wrap or stack controls and metadata, retain 48px mobile touch targets, use existing desktop compact sizes, and keep table scrolling within its own container.

## Defects and drift not canonized or repaired

The incumbent design-system prose gives a uniform 24px page heading and 48px controls, while committed `PageHeader` uses 22px below `sm` and shared buttons/inputs compact to 36px at `md`. These are pre-existing documentation differences, not changes authorized by this feature. The copied `jobscan-prototype-add-location-index-html-ca274fa2.md` brief points to an absent prototype; it is unrelated and remains untouched. The feature table contains `bg-surface-subtle`, for which no local color token was found; the reviewed table uses the incumbent surface appearance, and this class is not promoted into a normative color. No new design rule is written to legitimize any of these observations.
