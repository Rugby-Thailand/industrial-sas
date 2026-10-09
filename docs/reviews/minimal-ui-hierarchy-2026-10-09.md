# Packing completion hierarchy — 2026-10-09

The approved [desktop and mobile imagegen concepts](../designs/packing-completion-hierarchy-2026-10-09/prompts.md) are implemented in the real app. Measured packing gives the first storage destination one compact filled primary action. Other unit destinations are underlined links. Product/batches, review/edit and prepare-another actions use neutral underlined text; prepare-another also has a small plus icon. Simple packing gives **Scan Packages** the sole primary treatment.

`PackingCompletion` now owns this presentation. `PackingScreen` retains the business state, permission/recovery guards, draft persistence and navigation callbacks. Destinations remain anchors and state changes remain buttons. Existing translation keys, semantic color tokens and keyboard focus styles are retained.

## Real layout measurements

Chrome checked the production build from source commit `55c4927` at 1440 × 1000 and 390 × 844 CSS viewports, with additional 320 px checks. The two-unit completion section is **131 px high on desktop** and **245 px on mobile**. The primary action's painted surface is **32 px high**, with a **44 px mobile interaction area**. All five mobile actions have 44 px targets. English at all three widths and Thai at 320 px have zero document/main horizontal overflow. [DOM measurements](assets/minimal-ui-hierarchy-2026-10-09/completion-metrics.json), [Thai measurement](assets/minimal-ui-hierarchy-2026-10-09/thai-metrics.json) and [dark-theme colors](assets/minimal-ui-hierarchy-2026-10-09/dark-metrics.json) are saved alongside the screenshots.

The light theme's primary text/background contrast is approximately **6.7:1** and neutral utility text/canvas contrast is approximately **7.6:1**. Dark mode was also visually checked. The first storage destination was reached with Enter after Shift+Tab from the second link; the actual focused anchor reported `:focus-visible` and the shared focus ring.

The gallery's state 12 now uses the screenshots below. Its 156 embedded images were decoded and checked against their linked files; the standalone gallery retains its embedded-image fix. The [earlier flat completion version](minimal-ui-completion-2026-10-09.md) remains as historical evidence.

## Action walkthrough

These are **17 real desktop/mobile screenshot pairs plus two narrow-mobile captures**. Generated design images are kept separately as concepts. Review/edit restored the saved batch and checked measurements without submitting a repack. Prepare-another returned to empty quantity/lot fields and a disabled create action. The storage destinations were previewed without reserving space or confirming physical storage.

| State/action                         | Desktop                                                                                               | Mobile                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Measured completion                  | ![Desktop completion](assets/minimal-ui-hierarchy-2026-10-09/12-units-created-desktop.jpg)            | ![Mobile completion](assets/minimal-ui-hierarchy-2026-10-09/12-units-created-mobile.jpg)            |
| Keyboard focus on primary            | ![Desktop keyboard focus](assets/minimal-ui-hierarchy-2026-10-09/completion-keyboard-desktop.jpg)     | ![Mobile keyboard focus](assets/minimal-ui-hierarchy-2026-10-09/completion-keyboard-mobile.jpg)     |
| First storage destination: P-000009  | ![Desktop first storage](assets/minimal-ui-hierarchy-2026-10-09/unit-1-storage-desktop.jpg)           | ![Mobile first storage](assets/minimal-ui-hierarchy-2026-10-09/unit-1-storage-mobile.jpg)           |
| Second storage destination: P-000010 | ![Desktop second storage](assets/minimal-ui-hierarchy-2026-10-09/unit-2-storage-desktop.jpg)          | ![Mobile second storage](assets/minimal-ui-hierarchy-2026-10-09/unit-2-storage-mobile.jpg)          |
| Product and batches destination      | ![Desktop product](assets/minimal-ui-hierarchy-2026-10-09/product-batches-desktop.jpg)                | ![Mobile product](assets/minimal-ui-hierarchy-2026-10-09/product-batches-mobile.jpg)                |
| Saved batch and total                | ![Desktop saved batch](assets/minimal-ui-hierarchy-2026-10-09/saved-batch-desktop.jpg)                | ![Mobile saved batch](assets/minimal-ui-hierarchy-2026-10-09/saved-batch-mobile.jpg)                |
| Review/edit measured batch           | ![Desktop review](assets/minimal-ui-hierarchy-2026-10-09/review-batch-desktop.jpg)                    | ![Mobile review](assets/minimal-ui-hierarchy-2026-10-09/review-batch-mobile.jpg)                    |
| Restored dimensions and confirmation | ![Desktop dimensions](assets/minimal-ui-hierarchy-2026-10-09/review-dimensions-desktop.jpg)           | ![Mobile dimensions](assets/minimal-ui-hierarchy-2026-10-09/review-dimensions-mobile.jpg)           |
| Prepare another: cleared form        | ![Desktop cleared form](assets/minimal-ui-hierarchy-2026-10-09/prepare-another-desktop.jpg)           | ![Mobile cleared form](assets/minimal-ui-hierarchy-2026-10-09/prepare-another-mobile.jpg)           |
| Review before measured creation      | ![Desktop creation review](assets/minimal-ui-hierarchy-2026-10-09/measured-create-review-desktop.jpg) | ![Mobile creation review](assets/minimal-ui-hierarchy-2026-10-09/measured-create-review-mobile.jpg) |
| Thai completion                      | ![Desktop Thai](assets/minimal-ui-hierarchy-2026-10-09/thai-completion-desktop.jpg)                   | ![Mobile Thai](assets/minimal-ui-hierarchy-2026-10-09/thai-completion-mobile.jpg)                   |
| Dark completion                      | ![Desktop dark](assets/minimal-ui-hierarchy-2026-10-09/dark-completion-desktop.jpg)                   | ![Mobile dark](assets/minimal-ui-hierarchy-2026-10-09/dark-completion-mobile.jpg)                   |
| Simple completion                    | ![Desktop simple](assets/minimal-ui-hierarchy-2026-10-09/simple-completion-desktop.jpg)               | ![Mobile simple](assets/minimal-ui-hierarchy-2026-10-09/simple-completion-mobile.jpg)               |
| Simple package label: P-000008       | ![Desktop label](assets/minimal-ui-hierarchy-2026-10-09/simple-label-desktop.jpg)                     | ![Mobile label](assets/minimal-ui-hierarchy-2026-10-09/simple-label-mobile.jpg)                     |
| Simple scan destination              | ![Desktop scanner](assets/minimal-ui-hierarchy-2026-10-09/simple-scan-desktop.jpg)                    | ![Mobile scanner](assets/minimal-ui-hierarchy-2026-10-09/simple-scan-mobile.jpg)                    |
| Simple review/edit                   | ![Desktop simple review](assets/minimal-ui-hierarchy-2026-10-09/simple-review-batch-desktop.jpg)      | ![Mobile simple review](assets/minimal-ui-hierarchy-2026-10-09/simple-review-batch-mobile.jpg)      |
| Simple prepare another               | ![Desktop simple reset](assets/minimal-ui-hierarchy-2026-10-09/simple-prepare-another-desktop.jpg)    | ![Mobile simple reset](assets/minimal-ui-hierarchy-2026-10-09/simple-prepare-another-mobile.jpg)    |

| English at 320 px                                                                       | Thai at 320 px                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ![English narrow layout](assets/minimal-ui-hierarchy-2026-10-09/english-320-mobile.jpg) | ![Thai narrow layout](assets/minimal-ui-hierarchy-2026-10-09/thai-320-mobile.jpg) |

## Standards

The parallel read-only Standards audit reviewed `0e9ea3a...55c4927`: **zero hard violations and zero actionable smell findings**. It confirmed semantic links/buttons, localized labels and colors, keyboard focus, mobile targets, preserved callback ownership and conformance to the installed Next.js guides. No source release blocker was identified.

## Spec

The parallel read-only Spec audit reviewed the same pinned range: **zero actionable findings**. It confirmed the approved hierarchy and unchanged destinations, permission/recovery/stale-completion guards, pending-submission protections and draft persistence. The wider source diff retains scan acquisition locks, duplicate review, quantity parsing, retry identities and main's record deletion behavior.

## Validation and limits

- `pnpm check`: type checking and lint passed; **137 test files / 1,140 tests passed**.
- Focused PackingScreen/shared Button suites: **47 tests passed**. The existing accessibility test now exercises the completed state; simple-mode assertions verify label and scan destinations.
- `NEXT_DIST_DIR=.next pnpm build`: passed. Chrome exercised this production build on port 3187.
- `pnpm audit:prod`: no known vulnerabilities found.
- Changed-file formatting, whitespace and screenshot/link inventory checks passed.
- Manual React review found no new state/effects, request waterfalls or nested interactive elements in the extraction.

This follow-up created local demo lot `QA-HIERARCHY-1009`, batch `jn7fp7z8np477bgb8td9rytak18fyvh6`, with two 12-PCS pallets, each measured and checked at 1 × 1 × 1.2 m. Both remain awaiting placement. The QA product now has **six batches, ten units and 98 PCS**. Earlier screenshots retain the counts from their capture time. Existing records were not repacked, reserved, moved or deleted during this follow-up. Browser viewport checks do not exercise a physical phone camera or software keyboard. The temporary viewport override was reset and the QA tab closed after verification.
