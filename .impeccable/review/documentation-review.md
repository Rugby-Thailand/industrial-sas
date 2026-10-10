# AI usage documentation handoff

Disposition: preserve incumbent system. This is a code-led extension of the existing application, with no approved visual-world change or token change. The independent finish review at `finish-review-final.md` records **ship**. This pass records the source and supplied evidence checked; it does not replace that review or rerun its browser capture or detector.

## Authority and evidence checked

- Read the shipped documenter role and `reference/document.md`, `PRODUCT.md`, and `.impeccable/surfaces/ai-usage.md`.
- Read `src/features/aiUsage/AiUsageScreen.tsx` and `RecentActivity.tsx`, including the three feature labels, report filters, summary, contribution rows, recent operations, notices, and FX settings.
- Checked `src/app/globals.css`, the locale and desktop layouts, the AI usage route layout, `PageContainer`, `PageHeader`, `Panel`, `Button`, `Input`, `FormField`, `SelectControl`, `select`, and `Notice`. Sampled `HrHistoryScreen` for the incumbent desktop-table/mobile-row and tabular-number patterns. Checked the shell's independently scrolling main pane in `DesktopShell` and `c-sidebar-2`.
- Git diff inspection found no changes to those shared tokens, components, locale layout, or shell sources. The report uses their existing palette, typography, focus treatments, forms, and panel language.
- Independently opened `desktop.png`, `desktop-lower.png`, `mobile.png`, and `mobile-lower.png`. The supplied Thai dark-theme evidence covers desktop at 1280 × 800 and mobile at 390 × 844 CSS pixels (780 × 1688 image pixels, DPR 2). Top/lower pairs retain the real main-pane scroll model. The images show the incumbent shell, three distinct feature summaries, estimated-baht disclosure, contribution rows, and recent operations without visible horizontal page overflow at the supplied widths. The displayed calls and accounts are designated local synthetic QA evidence, not production activity.

## Observed system retained

Palette: existing semantic CSS tokens; the reviewed dark state uses black canvas, near-black panels, pale text, muted gray copy, blue controls, and existing success/warning/danger/pending tones. The source also retains its light theme.

Type ramp: Geist with the existing Noto Sans Thai/sans-serif fallback; shared page title is 22px on mobile and 24px from `sm`, section titles 18px, report body 14px, supporting labels 12px, and values use tabular numerals.

Layout rule observed: the wide `PageContainer` remains inside the scrolling shell. Report sections use the existing spacing scale; filters expand from one to two to three columns, advanced mobile filters fold, and desktop tables become paired mobile data rows below `md`.

Shape/depth rule observed: shared panels retain the 8px radius, subtle semantic borders, and 16px padding; shared controls retain their existing smaller radius. Panel separation comes from borders and tonal surfaces; the report adds no new shadow or decorative material.

State rule observed: shared outlined/primary controls retain their focus, hover, disabled, and validation treatments. Recent outcomes reuse semantic status colors with translated labels, and unknown costs remain explicit rather than being styled as confirmed zero.

These are descriptive observations of existing code, not newly approved global rules. `PRODUCT.md` receives only factual wording for the actual location-label feature and the three separate reporting classifications. The surface contract already records that distinction and needs no further correction.

## Preserved files and limitations

`DESIGN.md` and `.impeccable/design.json` are absent. The task identifies this as pre-existing documentation absence. Neither is created: this ordinary extension preserves the incumbent source authority and does not authorize a new world, retrospective system invention, or repair of existing documentation drift.

The two report table headers reference `bg-surface-subtle`, but no corresponding semantic token declaration was found in the scanned source. That unresolved utility is recorded as a source inconsistency, not canonized as a design-system color or repaired in this documentation-only pass; the supplied screenshots show the existing plain panel treatment.

Only the supplied Thai dark-theme viewports were visually checked. Light theme, English, other widths, interactive/error states, and accounting correctness were not independently exercised here. No code, tokens, system files, plans, operations documents, browser captures, detector results, comments, PRs, or remote branches were changed by this pass.
