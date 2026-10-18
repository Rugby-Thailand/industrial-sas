# Reviewed design-sheet audit · 15 October 2026

Kiro (`claude-opus-5.5`, high effort) returned 20 findings. Codex reviewed the evidence, qualified several claims, and added one issue measured in the T3 browser. **21 observations: 1 P1, 8 P2, 12 P3.** These include defects, implementation risks and design-coverage gaps; they are not 21 independently proven accessibility violations.

No design-sheet or application source was changed. Raw [Kiro report](report.md) and [findings](findings.json) are preserved; [reviewed findings](reviewed-findings.json) contain the adjustments and full references.

## All findings

| ID     | Priority | Finding                                                                                                                                                            |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DS-A01 | P1       | Opening a populated date and confirming the selected day with Enter clears the value.                                                                              |
| DS-A02 | P2       | Hour/minute choices commit immediately; Escape keeps the change, contrary to the plan’s cancel contract.                                                           |
| DS-A03 | P2       | Visible Thai dates say 2569; grid/day accessible labels say 2026.                                                                                                  |
| DS-A04 | P2       | Products/Storage units, capture method and Filters lack a distinct pressed appearance.                                                                             |
| DS-A05 | P2       | Locked text fields keep their enabled appearance while scanner slots gain grey fill; neighboring selects look disabled.                                            |
| DS-A08 | P2       | Dark badge inks survive the light print palette; calculated badge contrast is only 1.27–1.41:1. Print rendering untested.                                          |
| DS-A09 | P2       | Components use real shadcn/Radix behavior, but Tailwind utilities are not built; a separate CSS layer supplies their appearance.                                   |
| DS-A11 | P2       | An empty time is not reachable through the current UI. Under a controlled empty-value probe it can emit :45 or silently assume 30 minutes; no clear action exists. |
| DS-A21 | P2       | At 640×320 the calendar extends below the screen; Clear date is outside the viewport and there is no internal scroll area.                                         |
| DS-A06 | P3       | The HR pending example uses disabled grey styling and lacks aria-busy, unlike the documented saving treatment.                                                     |
| DS-A07 | P3       | Focused and selected rows use the same fill. A checkmark distinguishes selection, but focus could be clearer.                                                      |
| DS-A10 | P3       | Menu sizes, calendar conventions and adjacent button sizing need an explicit preview-to-app differences list; some differences are already intentional.            |
| DS-A12 | P3       | Selected dates become 18px versus 14px, chevrons get filled, and muted text retains extra opacity.                                                                 |
| DS-A13 | P3       | A valid Job No. retains aria-invalid=false but regains the error message after changing language.                                                                  |
| DS-A14 | P3       | If picker CSS loads but its script fails, sources are hidden and replacement controls never appear.                                                                |
| DS-A15 | P3       | Some accessible names omit visible labels; the theme toggle combines changing action labels with pressed semantics.                                                |
| DS-A16 | P3       | Several accessible labels and the proposal date remain English in Thai mode.                                                                                       |
| DS-A17 | P3       | Loading statistics are only ellipses, without loading text or aria-busy on the totals.                                                                             |
| DS-A18 | P3       | Vite copies scanner WASM, reference pages, icons and manifest into the design-sheet output unnecessarily.                                                          |
| DS-A19 | P3       | Large vanilla DOM checks exclude React islands; picker tests pass while missing the reproduced date/time/locale failures.                                          |
| DS-A20 | P3       | Invalid, pending, read-only, empty-time and bounded-date examples are incomplete. Disabled select/date examples do exist in Reading mode.                          |

## Interpretation and evidence

- Fix selected-date clearing first, then picker semantics, Thai accessible years, pressed/disabled states and popup height. Resolve the preview/app visual contract before copying the sheet across the application.
- DS-A06, DS-A07 and DS-A10 are P3 here rather than Kiro’s P2: the existing Saving text/checkmarks still convey information, and some plan differences are deliberate.
- DS-A11 is a latent empty-value defect and coverage gap, not a failure users can trigger through the current time specimen.
- DS-A20 was corrected: Reading mode does include disabled select/date controls. Proposed manufacturing-date restrictions were not verified as business requirements.
- DS-A19 does not treat the historical revision date or Git baseline hash alone as false evidence. The real issue is test scope and missing cases.
- Parent browser evidence corroborates DS-A01/02/03/05/12/13 and adds DS-A21. [Browser notes](browser-notes.md) distinguish native input, DOM inspection, geometry and remaining uncertainty.
- Settled-state axe scans and page-width checks passed 136 combinations (17 workflow states × 2 languages × 2 themes × 2 widths). That matrix did not cover open popups or all interaction paths; it does not disprove the behavioral defects. Axe had incomplete SVG-contrast and one ARIA case.
- Print contrast is based on CSS and arithmetic, not a rendered printout. The calendar text contrast estimate was not flagged by browser axe; it remains qualified.
- One native-browser Review-state selection left a listbox open, while Kiro’s jsdom probe returned focus correctly. This remains a follow-up risk, not a counted confirmed finding.
- Generic detector warnings about Geist/Geist Mono were rejected because those are the approved existing fonts. Compact field sizes, no-hover field icons, synthetic data and absent backend/camera are intentional.

## Foundations worth retaining

Civil-date storage avoids UTC conversion; retained drafts, normal popup focus return, nested Escape, text-button color-only hover and static field icons work. The palette provenance and real shadcn/Radix behavior are present.

Physical touch devices, actual screen readers, print rendering and production application flows remain untested. The audit-only asset server was stopped; the existing design-sheet preview remains available.
