# Spacing fixes · 2026-10-16

Resolves G01–G08 from the [spacing audit](../../reviews/design-sheet-spacing-2026-10-16/audit.md) in the standalone sheet only. The audit, its `measurements.json` and screenshots remain the baseline evidence. Field heights (32px fine pointer / 40px small or touch), 2px label, 4px help/error and 8px sibling gaps, text and icon sizes, icon centering, button hover/press rules, focus, copy, palettes and all audited “Keep” relationships are unchanged. No application source, frozen variant, `sheet.js`, `styles.css` or `tokens.css` changed.

| Finding | Fix                                                                                                                                                                                                                                                                                                                  | Where                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| G01     | `#control-feedback` and `#workflow-feedback` stay in the DOM as live regions with no reserved height; empty they have 0 margin, with text an 8px top gap and natural height. Panel minimum height and padding unchanged. Live-region semantics remain present; physical screen-reader announcements were not tested. | `review.css`                 |
| G02     | `picker-help` sits 4px below the date/time row; `picker-note` follows at 8px. Class relationships (`.picker-specimens + .picker-help`, `.picker-help + .picker-note`) outrank the broad `.field-grid + p` rule.                                                                                                      | `index.html`, `review.css`   |
| G03     | Button groups, field grids and `.picker-specimens` all take 16px above from one `.controls-grid :is(…)` rule; the losing duplicate in `controls.css` was removed. 8px sibling and 4px hint gaps unchanged.                                                                                                           | `review.css`, `controls.css` |
| G04     | Pagination markup is two units: `.pagination-size` (label + select) and `.pagination-nav` (Previous + page + Next, `nowrap`). 8px inside each, 12px between. Disabled state and labels unchanged.                                                                                                                    | `review.js`, `review.css`    |
| G05     | Inspector: heading → attributes 8px, 12px between attribute groups and before Inspect; the last `dl` child margin is removed. At ≤520px the grid uses an 8px row gap with no heading margin, and the action keeps its column without extra margin. dt/dd 2px gap kept.                                               | `review.css`                 |
| G06     | `.scan-success-actions` adds 12px above the saved-scan toolbar (the normal toolbar stays at 8px); `.catalogue-no-results` adds 12px above the no-result content. Empty-state internal gaps unchanged.                                                                                                                | `review.js`, `review.css`    |
| G07     | At 801–1100px (screen only): 32px vertical page padding, 24px workspace/foundation/control/layout gutters. Side padding and the 40px stacked separation at ≤800px unchanged.                                                                                                                                         | `review.css`                 |
| G08     | Actions gain the fields' 4px inner gutter; hour/minute grow only if a wider status/action row sets the intrinsic popup width, so the minute field's right edge stays on the same gutter as Done. 8px between action buttons kept.                                                                                    | `controls.css`               |

**Intentional exception (G08):** the time-popup status line keeps its 18px reserve when blank, so the field-to-action gap stays 30px and Done does not move when validation appears. The audit did not count this as a defect.

## Checks

- `pnpm build:design-sheet` — passed; `dist/controls.js` is byte-identical, `dist/controls.css` changed.
- `node docs/design-sheet/evidence/check-controls.cjs` — passed, 159 assertions.
- `node docs/design-sheet/evidence/check-adoption.cjs` — passed, 4,684 assertions.
- Scoped Prettier and ESLint on changed files.
- `index.html` cache keys bumped to `20261016-spacing` for `review.css`, `review.js` and `dist/controls.css`.

## Parent browser verification

The parent verified **37 rendered scenarios with zero spacing failures** in the T3 shared browser. [Recorded measurements](spacing-fixes-browser-2026-10-16.json) cover English at 1280/1024/768/390/320px and Thai at 1280/320px; the affected normal workflows, expanded optional fields, populated/cleared live feedback, completed/empty time popups, scan success and no-result catalogue states were inspected. Native clicks that initially failed while offscreen were excluded; scrolling the target into view resolved the tool failure before capturing the required states.

- G01: empty feedback is 0px high with 0px margin; populated feedback retains role=status and uses an 8px top margin with natural text height.
- G02/G03: 4px picker help, 8px explanatory-note gap, 16px demo-group margins.
- G04: Previous/page/Next stay together on phones, including Thai; the two pagination groups are 12px apart.
- G05: 8px inspector heading gap, 12px attribute groups and desktop action gap; mobile keeps the action alongside attributes.
- G06: saved-scan actions and no-result content both have 12px separation.
- G07: 1024px gutters are 24px and page vertical padding is 32px; stacked chapter gaps remain 40px.
- G08: time fields and actions have matching right edges (0px offset) in both languages/sizes; the 18px status reserve remains and popups do not overflow horizontally.
- Preserved: 32/40px field heights, 2px labels, 4px hints, zero vertical icon-center offset and no page-level horizontal overflow in the recorded scenarios.

[Desktop controls](spacing-controls-2026-10-16.png) · [320px Thai pagination](spacing-pagination-2026-10-16.png)

The browser used emulated viewport widths with a fine pointer. Physical touch devices, screen-reader output, rendered print and production application behavior remain outside this pass. No UI corrections were needed after Kiro's implementation; the parent added the measured evidence and clarified these verification limits.
