# Location picker browser verification

October 13, 2026 (Bangkok). T3 collaborative preview `tab_5l`, real location worker components with synthetic Convex transport and data. This is UI evidence, not a production latency measurement. Initial authenticated hosted observations are retained separately in `browser-initial.md`.

- Blank opening renders 20 choices and a pager.
- Building filter has a 48 × 48 px normal-density hit target. With 61 fixture buildings, the first request lists 50; Show more makes a separate cursor-50 request and exposes building 61. Choosing it closes the popover and requests locations with `buildingId: building-61`, retaining the label and showing a complete empty result.
- First-page reset shows Try again. Activating it makes a new `attempt: 1` subscription and renders 20 choices.
- A ready but incomplete empty prefix page shows an enabled Next control and does not claim the location is unregistered.
- A repeated scan cursor stops automatic requests after the repeated response and offers Try again; it does not spin indefinitely.
- Actual picker rendered in a same-origin constrained iframe at 375 × 812 CSS px: Thai/light and English/dark both have no horizontal document overflow. Thai filter popover stays within the 375 px width (left 204.5, right 348.875). Normal-density filter remains 48 × 48 px.

The shared browser host returned generic errors for snapshots and timeouts for native viewport resizing. Later native click calls also returned success without dispatching an observable click; DOM `click()` through `preview_evaluate` exercised the controls successfully. Responsive evidence therefore uses a constrained CSS viewport, not native device emulation. No final screenshots, touch interaction, camera capture or deployed after-latency claim is made. Earlier successful native keyboard/filter checks are described in the initial report.

After integration at `3da2ac95`, the preview was switched to the combined source. Rechecked exact lookup with broader catalogue transport deliberately pending: F1-L30-16 renders as an exact choice while search continues, and no selection is made automatically. The combined job-scan and public-contract batch passed 180 tests; final repository-wide checks and CI are recorded in README.md.
