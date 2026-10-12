# Storage navigation and UI audit — 2026-10-12

**Pass with a bounded follow-up.** The return-to-Scan loading bug and confirmed UI defects are fixed. Kiro implemented the map/inspector/toolbar refinements; the primary agent reviewed the diff, integrated upstream PR #81, corrected narrow location rows, and verified the running app. PD grid-label scaling across panel widths remains a deferred source observation outside the reported simple-cell defect.

## Outcome

After Back/Forward, NavigationProgress retained an already-completed history destination. A subsequent sidebar navigation could hide ready page content indefinitely. The destination now clears when its route commits, a redirect commits, or a new navigation supersedes it. Native non-Next history entries and query-only changes do not gate the whole page. Actual history writes preserve the app index and same-entry draft/catalogue metadata. Sidebar links prefetch their full permitted destinations.

The floor toolbar now has one Display options menu and a direct, labelled Plus action. Simple plan-cell code/status labels use a pure screen-pixel layout helper, so zoom no longer enlarges them past their cells. Inspector, sheet and table hosts own their heading and single closing action. Closing details retains selection; inline table Clear and map Escape can clear it.

Search Clear restores focus. The skip link focuses main without adding a hash history entry. Collapsed navigation loading has a spinner and accessible status text. Location search keeps its icon visible, provides a focus outline, and stacks long context beneath the code on mobile.

## Audit health

Scores apply to the six reviewed surfaces and states, not the entire application.

| Dimension     | Score / 4   | Evidence and limit                                                                                                                                                                 |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility | 3           | No WCAG A/AA axe violations in six captured browser runs; focus and close regressions covered. No assistive-technology user study.                                                 |
| Performance   | 3           | Twelve local warm navigations complete with visible content in 10.8–135.1 ms. No live-production latency or cold-load benchmark.                                                   |
| Theming       | 4           | Thai/English light/dark matrix uses existing tokens and fonts; no new colours or theme mechanism.                                                                                  |
| Responsive    | 3           | Desktop 1440×1000 and mobile 390×844, no document horizontal overflow in all 48 combinations. Physical touch/camera hardware untested.                                             |
| Integrity     | 4           | Small helpers and existing hosts own behaviour; one detector run found no deterministic issues. Geometry, inventory permissions and saving remain governed by existing code/tests. |
| **Total**     | **17 / 20** | **Good**                                                                                                                                                                           |

## Findings and refactor

| Severity | Finding                                                                                 | Owning change                                       | Result                                                                            |
| -------- | --------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| P0       | Ready content stays hidden after returning through browser history and navigating again | NavigationProgress.tsx; navigationClient.tsx        | Resolved with commit/redirect/supersession handling and regression coverage       |
| P1       | Zoomed simple-cell labels overlap or escape cells                                       | planCellLabelLayout.ts; FloorMapDrawing.tsx         | Screen-pixel font sizes, line offsets and fit bounds                              |
| P1       | Two adjacent identical overflow buttons; one opens only an icon                         | FloorWorkspaceToolbar.tsx; StorageLayoutScreens.tsx | One Display menu; direct Plus action; obsolete popover/state removed              |
| P2       | Inspector/sheet repeats heading and close                                               | StorageZonesPanel.tsx; FloorMap.tsx                 | Host owns closing; standalone compact panel retains its own controls              |
| P2       | Clear search drops keyboard focus                                                       | FloorWorkspaceToolbar.tsx                           | Input ref restores focus                                                          |
| P2       | Picker search icon sits beneath opaque input wrapper                                    | Shared input in upstream PR #81                     | Resolved upstream; preserved during integration                                   |
| P2       | Collapsed navigation loading sentence clips                                             | SidebarNavigation.tsx                               | Accessible status with compact spinner                                            |
| P2       | Skip link adds a native fragment entry that Next does not restore as a route            | SkipToContentLink.tsx                               | Focuses main without writing history                                              |
| P3       | Narrow location rows squeeze and clip building/floor context                            | LocationPicker.tsx                                  | Stacked mobile context with room for Thai line height and a visible focus outline |
| P3       | Workspace guard duplicates its history-key literal                                      | useWorkspaceNavigationGuard.tsx                     | Uses shared GUARD_HISTORY_KEY                                                     |
| P3       | Built-in map details also have a second close                                           | FloorMap.tsx                                        | Resolved by Kiro's correction batch; generic desktop/sheet/inline tests added     |
| P3       | PD grid-label size depends on panel width                                               | FloorMapDrawing.tsx                                 | Deferred source observation; PD/group drawing unchanged                           |
| —        | Semantic inventory appeared to show an unnamed location input                           | FormField + ScanCodeInput                           | False positive: associated label and accessible-name tests already exist          |

Kiro's original source audit and exact scoped checks are in [kiro-audit.md](kiro-audit.md). PR #81 moved navigation rows into SidebarNavigation and changed Scan's initial screen; integration preserves those changes and ports the loading status to its new owner.

## Browser evidence

[Complete screenshot gallery](screenshots.md): **79 unedited PNGs** — 17 baseline, 48 final matrix combinations and 14 interaction states. Baseline is a050a851; final app is 4850de86 plus this patch. Saved snapshots were checked against their page/state; early skeleton/stale captures were replaced before delivery.

- Actual authenticated local app with its own Convex backend and synthetic demo inventory. No production inventory was created, saved or deleted. The manual screenshot uses one blank client draft, subsequently removed without submitting.
- F1/F2 uses the production FloorMap component with the saved reference geometry, no inventory. Floor 1 shows 379 positions in 32 groups; its generated 400 location shapes and height values are fixture data, not assertions about current production inventory.
- FG1 at confirmed 200% and 500%: all 15 simple labels' real SVG glyph bounds fit their cells; code remains about 14 CSS px and status at most 11 CSS px. F1/F2 at 500%: 21 simple label nodes fit, including the selected F1-L18-2 region. PD grid-label sizing was not refactored.
- Desktop inspector, mobile sheet, Display menu, map/table/split, location search, selected location, manual draft and Scan after return are captured.
- Native T3 interactions and DOM events exercise the same UI handlers. The 12 timing samples use DOM-triggered sidebar links and native history.back/forward, with visible heading, pathname and absence of loading sampled every 10 ms. They include Back → another sidebar page → Scan, the reported trigger. No sample needed a refresh.
- Skip-link verification keeps URL, history length and app index unchanged while focus moves to main.
- Six browser axe runs have zero violations. These are automated checks, not a claim of exhaustive WCAG compliance.

Raw state, geometry and timing evidence: [browser-checks.json](browser-checks.json). Capture URLs/viewports: [capture-manifest.json](capture-manifest.json).

## Final checks

- pnpm typecheck: pinned Bun 1.4.3 / TypeScript 7.0.2, 907 files, clean.
- pnpm lint: clean, zero warnings.
- pnpm test --maxWorkers 2: **291 files, 3,751 tests passed** after integrating main.
- NEXT_DIST_DIR=.next-build pnpm build with pinned Bun: production build passed; Next's TypeScript 6 gate passed.
- Repository Prettier check and git diff --check pass.
- Kiro correction tests fail against the prior FloorMap implementation and pass with the fix. Existing workspace browser expectations now use the host close and canvas Escape; CI will exercise them.

The root user's dirty workspace is preserved. Only this isolated worktree's scoped changes and review evidence are delivered. No backend, environment, dependency or release-workflow changes are included.
