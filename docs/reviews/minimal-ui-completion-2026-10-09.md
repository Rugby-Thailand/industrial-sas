# Compact packing completion — 2026-10-09

The `12-units-created` screen now presents the success icon beside the quantity, followed by one short instruction. Unit destinations use underlined text links with small arrows. Product/batch, review/edit and prepare-another actions sit in a wrapping row beneath a divider. Simple packing retains one compact primary **Scan Packages** button. State-changing actions remain semantic buttons, with visible keyboard focus.

The enclosing padded card and oversized outlined action buttons were removed. The completion section measures **125 px high on desktop** and **245 px on mobile** for the two-unit example. All five mobile actions retain **44 px** touch targets. English has zero document/main horizontal overflow at 1440 × 1000, 390 × 844 and 320 × 844. Thai also has zero overflow at 320 px, with desktop and 390 px layouts visually checked below. Readable helper text uses the muted foreground token in both themes. [Actual DOM measurements](assets/minimal-ui-2026-10-09/completion-metrics.json).

Chrome captured the real production build using local demo records. The captures below contain **13 desktop/mobile pairs plus two narrow-mobile checks**. The [standalone gallery](minimal-ui-gallery-2026-10-08.html) and [main walkthrough](minimal-ui-walkthrough-2026-10-08.md) now use the updated state-12 images; the old screenshots are retained as before evidence.

## Before and after

| State  | Desktop                                                                                   | Mobile                                                                                  |
| ------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Before | ![Previous desktop completion](assets/minimal-ui-2026-10-08/12-units-created-desktop.png) | ![Previous mobile completion](assets/minimal-ui-2026-10-08/12-units-created-mobile.png) |
| After  | ![Compact desktop completion](assets/minimal-ui-2026-10-09/12-units-created-desktop.jpg)  | ![Compact mobile completion](assets/minimal-ui-2026-10-09/12-units-created-mobile.jpg)  |

## Actions and alternate layouts

The first storage link was activated with Enter after tabbing to it. The other destinations were opened through the visible controls. Review/edit restored the created batch's quantity and checked measurements. Prepare another returned to an empty preparation form. Both viewport sizes were captured after each action.

| Check                                   | Desktop                                                                                                   | Mobile                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Keyboard focus on the first unit link   | ![Desktop keyboard focus](assets/minimal-ui-2026-10-09/completion-keyboard-desktop.jpg)                   | ![Mobile keyboard focus](assets/minimal-ui-2026-10-09/completion-keyboard-mobile.jpg)                   |
| Find storage: pallet 1, P-000006        | ![Desktop first storage destination](assets/minimal-ui-2026-10-09/completion-unit-1-storage-desktop.jpg)  | ![Mobile first storage destination](assets/minimal-ui-2026-10-09/completion-unit-1-storage-mobile.jpg)  |
| Find storage: pallet 2, P-000007        | ![Desktop second storage destination](assets/minimal-ui-2026-10-09/completion-unit-2-storage-desktop.jpg) | ![Mobile second storage destination](assets/minimal-ui-2026-10-09/completion-unit-2-storage-mobile.jpg) |
| Product and batches                     | ![Desktop product destination](assets/minimal-ui-2026-10-09/completion-product-batches-desktop.jpg)       | ![Mobile product destination](assets/minimal-ui-2026-10-09/completion-product-batches-mobile.jpg)       |
| Review or edit this batch               | ![Desktop restored batch](assets/minimal-ui-2026-10-09/completion-review-batch-desktop.jpg)               | ![Mobile restored batch](assets/minimal-ui-2026-10-09/completion-review-batch-mobile.jpg)               |
| Prepare another batch                   | ![Desktop empty preparation form](assets/minimal-ui-2026-10-09/completion-prepare-another-desktop.jpg)    | ![Mobile empty preparation form](assets/minimal-ui-2026-10-09/completion-prepare-another-mobile.jpg)    |
| Light theme                             | ![Desktop light completion](assets/minimal-ui-2026-10-09/completion-light-desktop.jpg)                    | ![Mobile light completion](assets/minimal-ui-2026-10-09/completion-light-mobile.jpg)                    |
| Thai labels                             | ![Desktop Thai completion](assets/minimal-ui-2026-10-09/completion-thai-desktop.jpg)                      | ![Mobile Thai completion](assets/minimal-ui-2026-10-09/completion-thai-mobile.jpg)                      |
| Simple packing: review before creation  | ![Desktop simple packing review](assets/minimal-ui-2026-10-09/completion-simple-review-desktop.jpg)       | ![Mobile simple packing review](assets/minimal-ui-2026-10-09/completion-simple-review-mobile.jpg)       |
| Simple packing: one primary scan action | ![Desktop simple completion](assets/minimal-ui-2026-10-09/completion-simple-created-desktop.jpg)          | ![Mobile simple completion](assets/minimal-ui-2026-10-09/completion-simple-created-mobile.jpg)          |
| View package label: P-000008 details    | ![Desktop package detail destination](assets/minimal-ui-2026-10-09/completion-simple-label-desktop.jpg)   | ![Mobile package detail destination](assets/minimal-ui-2026-10-09/completion-simple-label-mobile.jpg)   |
| Scan Packages: scanner destination      | ![Desktop scanner destination](assets/minimal-ui-2026-10-09/completion-simple-scan-desktop.jpg)           | ![Mobile scanner destination](assets/minimal-ui-2026-10-09/completion-simple-scan-mobile.jpg)           |

| English at 320 px                                                                                   | Thai at 320 px                                                                                |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ![English narrow-mobile completion](assets/minimal-ui-2026-10-09/completion-english-320-mobile.jpg) | ![Thai narrow-mobile completion](assets/minimal-ui-2026-10-09/completion-thai-320-mobile.jpg) |

## Validation

- Existing PackingScreen and shared Button suites: **47 tests passed**.
- Type checking and affected-source lint: passed with zero warnings.
- Final production build: `NEXT_DIST_DIR=.next pnpm build` passed; Chrome checked this build on port 3187.
- A review caught an incorrect helper-text color token; it was corrected to `text-muted` before the final build and screenshots.
- Source formatting, diff whitespace, image inventory and embedded-gallery byte checks passed.

The follow-up created lot `QA-COMPACT-1009` with two measured 12-PCS pallets and lot `QA-COMPACT-SIMPLE-1009` with one unmeasured 1-PCS pallet. These three units remain awaiting placement. No reservation, physical placement, movement or deletion was performed during this follow-up. The QA product now has five batches and eight units; earlier screenshots record their earlier totals. No production deployment was used. Mobile verification uses browser viewports, without a physical phone camera or software keyboard. The temporary Chrome viewport override was cleared after verification.
